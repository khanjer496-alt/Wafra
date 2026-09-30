/**
 * Durable capture execution.
 *
 * Callers choose why they are draining capture, then receive facts suitable
 * for UI feedback. Queue identifiers, setup-probe reservations, persistence
 * barriers, and acknowledgement ordering never cross this interface.
 */
import { buildImportPlan, type ImportPlan, type ScannedSms } from '@/lib/auto-import';
import { StatementFilingError } from '@/lib/statement-import-flow';
import { collectNewMessages, type CaptureSource } from '@/lib/capture';
import {
  ackRelay,
  getBackgroundRelayConfig,
  getRelayConfig,
  markRelayVerified,
  recordRelayAutomationProof,
  syncRelay,
  type BackgroundRelayConfig,
  type RelayConfig,
  type RelaySyncResult,
} from '@/lib/relay';
import type {
  AppState,
  ImportBatchInput,
  LocalCaptureDeclineQualificationMapping,
  LocalCaptureReviewQualificationCandidate,
} from '@/lib/types';
import { emptyAlertReviewTray, partitionReviewsByCapacity, type ReviewEntry } from '@/lib/alert-review-tray';
import { stageWalletNearMatches } from '@/lib/wallet-near-match';
import type { ReviewSourceBinding } from '@/lib/review-source-bindings';
import { captureTrace, captureTraceEnabled } from '@/lib/capture-trace';
import { recordRuntimeOperation } from '@/lib/runtime-performance';
import { canonicalCaptureSourceKey } from '@/lib/capture-source-identity';

export type CaptureIntent = 'routine' | 'notification-only' | 'supplemental' | 'setup-verification' | 'background';

export interface CaptureImportSummary {
  /** Relay returned a full page; supplemental callers should drain another page after yielding. */
  moreQueued?: boolean;
  /** Review rows retained on the relay, so filing is not complete. */
  deferredReviews?: number;
  /** A full page is retained but cannot progress until another flow resolves it. */
  queueBlocked?: boolean;
  transactions: number;
  dues: number;
  bills: number;
  healed: number;
  newAccounts: number;
  transactionIds: string[];
  reviewAlerts: number;
}

export type CaptureExecutionOutcome =
  | { kind: 'not-hydrated' }
  | { kind: 'needs-setup' }
  | ({ kind: 'up-to-date'; source: CaptureSource } & CaptureImportSummary)
  | ({ kind: 'imported'; source: CaptureSource } & CaptureImportSummary)
  | { kind: 'setup-waiting' }
  | {
      kind: 'setup-observed';
      merchant: string;
      isTest: boolean;
      verifiedAt: number;
    }
  | { kind: 'background'; received: number; fresh: number };

export interface CaptureExecutor {
  execute(intent: CaptureIntent): Promise<CaptureExecutionOutcome>;
}

export interface CaptureLedgerAdapter {
  getState: () => AppState;
  /** Replacement generation; local iOS capture refuses to drain without it. */
  getStateGeneration?: () => number;
  importBatch: (
    input: ImportBatchInput,
    qualifications?: readonly LocalCaptureDeclineQualificationMapping[],
  ) => { ids: string[]; qualificationIds?: string[]; durable: Promise<void> };
  ensureDurable: () => Promise<void>;
  /** Persist a launch pack selected from strong per-alert AED/SAR evidence. */
  setMarket?: (id: 'AE' | 'SA') => boolean;
  stageReviewAlerts?: (
    items: ReviewEntry[],
    qualifications?: readonly LocalCaptureReviewQualificationCandidate[],
    sourceBindings?: readonly ReviewSourceBinding[],
  ) => { admitted: number; qualificationIds?: string[]; durable: Promise<void> };
}

export interface BackgroundCaptureAdapter {
  /** Persist parsed rows in the after-first-unlock encrypted inbox. */
  stage: (rows: ScannedSms[]) => Promise<ScannedSms[]>;
  /** Announce only rows that were not already staged. */
  announce: (fresh: ScannedSms[]) => Promise<void>;
  recordAutomationProof: (
    cfg: BackgroundRelayConfig,
    marker: NonNullable<ScannedSms['captureAutomation']>,
  ) => Promise<void>;
}

interface CaptureExecutorDependencies {
  collectRoutine: typeof collectNewMessages;
  planRows: typeof buildImportPlan;
  getRelay: () => Promise<RelayConfig | null>;
  getBackgroundRelay: () => Promise<BackgroundRelayConfig | null>;
  sync: (cfg: Pick<RelayConfig, 'baseUrl' | 'syncToken' | 'privateKey'>) => Promise<RelaySyncResult>;
  acknowledge: (
    cfg: Pick<RelayConfig, 'baseUrl' | 'syncToken'>,
    ids: string[],
  ) => Promise<void>;
  markVerified: (cfg: RelayConfig) => Promise<RelayConfig>;
  recordAutomationProof: (
    cfg: Pick<RelayConfig, 'deviceId' | 'syncToken' | 'automationGeneration'>,
    marker: NonNullable<ScannedSms['captureAutomation']>,
  ) => Promise<void>;
}

export interface CaptureExecutorOptions {
  ledger?: CaptureLedgerAdapter;
  background?: BackgroundCaptureAdapter;
  /** Internal seams used by interface-level tests. Production callers omit this. */
  dependencies?: Partial<CaptureExecutorDependencies>;
}

const EMPTY_SUMMARY: CaptureImportSummary = {
  transactions: 0,
  dues: 0,
  bills: 0,
  healed: 0,
  newAccounts: 0,
  transactionIds: [],
  reviewAlerts: 0,
};

const hasChanges = (plan: ImportPlan): boolean =>
  plan.txCount > 0 || plan.dueCount > 0 || plan.healedCount > 0 ||
  plan.newAccountCount > 0 ||
  (plan.batch?.newBills?.length ?? 0) > 0 ||
  Object.keys(plan.batch?.snapshots ?? {}).length > 0 ||
  Object.keys(plan.batch?.bankNames ?? {}).length > 0 ||
  Object.keys(plan.batch?.cardTypes ?? {}).length > 0;

const stageNearMatches = (activeLedger: CaptureLedgerAdapter, plan: ImportPlan) =>
  stageWalletNearMatches(
    plan,
    () => activeLedger.getState().reviewTray,
    activeLedger.stageReviewAlerts
      ? (items) => activeLedger.stageReviewAlerts!(items)
      : undefined,
  );

const yieldForegroundTurn = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

const summary = (
  plan: ImportPlan,
  transactionIds: string[] = [],
  reviewAlerts = 0,
): CaptureImportSummary => ({
  transactions: plan.txCount,
  dues: plan.dueCount,
  bills: plan.batch.newBills?.length ?? 0,
  healed: plan.healedCount,
  newAccounts: plan.newAccountCount,
  transactionIds,
  reviewAlerts,
});

const acknowledgementsFor = (
  queued: RelaySyncResult,
  includeReviews = false,
  deferredReviewSourceKeys: readonly string[] = [],
  includeTests = false,
): string[] => {
  const reserved = new Set(includeTests ? [] : queued.testIds);
  if (!includeReviews) {
    for (const id of queued.reviewIds ?? []) reserved.add(id);
  } else if (deferredReviewSourceKeys.length > 0) {
    const deferred = new Set(deferredReviewSourceKeys.map(key => canonicalCaptureSourceKey(key)));
    const reviewsBySource = new Map((queued.reviewCandidates ?? []).map(item => [item.sourceKey, item]));
    for (const id of queued.reviewIds ?? []) {
      const sourceKey = queued.reviewSourceKeysById?.get(id);
      const review = sourceKey ? reviewsBySource.get(sourceKey) : undefined;
      if (!sourceKey || !review || deferred.has(canonicalCaptureSourceKey(sourceKey, review.observedAt))) reserved.add(id);
    }
  }
  return queued.ids.filter((id) => !reserved.has(id));
};

const reviewSourceClaims = (state: AppState): Set<string> => {
  const now = Date.now();
  return new Set([
    ...(state.reviewTray?.pending ?? []).filter(item => item.expiresAt > now),
    ...(state.reviewTray?.tombstones ?? []).filter(item => item.expiresAt > now &&
      (item.outcome === 'added' || item.outcome === 'dismissed' || item.outcome === 'duplicate')),
  ].map(item => canonicalCaptureSourceKey(item.sourceKey, 'observedAt' in item ? item.observedAt : undefined)));
};

const launchMarketForRows = (
  rows: readonly ScannedSms[],
  fallback?: string | null,
): 'AE' | 'SA' | null => {
  const fallbackMarket = fallback === 'AE' || fallback === 'SA' ? fallback : null;
  const markets = new Set<'AE' | 'SA'>();
  for (const row of rows) {
    if (row.market === 'AE' || row.market === 'SA') markets.add(row.market);
    else if (fallbackMarket) markets.add(fallbackMarket);
  }
  if (markets.size > 1) throw new Error('Relay page contains more than one ledger currency');
  if (markets.size === 1) return [...markets][0];
  return null;
};

const alignLedgerMarket = (
  ledger: CaptureLedgerAdapter,
  market: 'AE' | 'SA' | null,
): void => {
  if (!market || market === ledger.getState().marketId) return;
  if (!ledger.setMarket || !ledger.setMarket(market)) {
    throw new Error('Captured money does not match this ledger currency');
  }
};

export const createCaptureExecutor = ({
  ledger,
  background,
  dependencies: overrides,
}: CaptureExecutorOptions): CaptureExecutor => {
  const dependencies: CaptureExecutorDependencies = {
    collectRoutine: collectNewMessages,
    planRows: buildImportPlan,
    getRelay: getRelayConfig,
    getBackgroundRelay: getBackgroundRelayConfig,
    sync: syncRelay,
    acknowledge: ackRelay,
    markVerified: markRelayVerified,
    recordAutomationProof: recordRelayAutomationProof,
    ...overrides,
  };

  const requireLedger = (): CaptureLedgerAdapter => {
    if (!ledger) throw new Error('Capture executor requires a ledger adapter');
    return ledger;
  };

  const captureStopped = (
    activeLedger: CaptureLedgerAdapter,
    source: CaptureSource,
  ): boolean => {
    const current = activeLedger.getState();
    return !current.hydrated || current.captureOptOut ||
      (current.privateMode && source === 'relay');
  };

  const recordForegroundAutomationProof = async (
    rows: readonly ScannedSms[],
    knownConfig?: RelayConfig,
  ): Promise<void> => {
    const active = knownConfig ?? await dependencies.getRelay();
    if (!active || active.setupState === 'paired' || !active.automationGeneration) return;
    const marker = rows.find((row) =>
      row.captureSource === 'shortcut' &&
      row.captureAutomation?.kind === 'message' &&
      row.captureAutomation.sourceDeviceId === active.deviceId &&
      row.captureAutomation.generation === active.automationGeneration
    )?.captureAutomation;
    if (!marker) return;
    await dependencies.recordAutomationProof(active, marker);
  };

  const executeRoutine = async (notificationOnly = false): Promise<CaptureExecutionOutcome> => {
    const activeLedger = requireLedger();
    const state = activeLedger.getState();
    if (!state.hydrated) return { kind: 'not-hydrated' };
    const generation = activeLedger.getStateGeneration?.();
    const routineStopped = (source: CaptureSource) => captureStopped(activeLedger, source) ||
      (generation !== undefined && activeLedger.getStateGeneration?.() !== generation);
    // A current in-memory claim can avoid crowding out older inbox reviews,
    // but is not an ACK receipt until ensureDurable succeeds. Do not use this
    // optimization on adapters without a replacement-generation guard.
    const currentReviewClaims = () => reviewSourceClaims(activeLedger.getState());
    const knownReviewSourceKeys = generation === undefined ? [] : [...currentReviewClaims()];
    const knownPendingReviewSources = new Set((state.reviewTray?.pending ?? [])
      .map(item => canonicalCaptureSourceKey(item.sourceKey, item.observedAt)));

    const tracing = captureTraceEnabled();
    const traceStarted = tracing ? Date.now() : 0;
    captureTrace('routine:start');
    const collectStarted = Date.now();
    const collected = await dependencies.collectRoutine(state, { notificationOnly, knownReviewSourceKeys });
    recordRuntimeOperation('capture-collect', Date.now() - collectStarted);
    captureTrace('collect:done', collected.parsed.length, tracing ? Date.now() - traceStarted : 0);
    if (collected.needsSetup) return { kind: 'needs-setup' };
    // Inbox/relay I/O can overlap a hand edit or another import. Do not use
    // the state that was read only to choose the scan watermark and parser
    // overrides for any mutation below.
    if (!activeLedger.getState().hydrated) return { kind: 'not-hydrated' };
    // A user can turn capture off while an inbox or relay read is awaiting.
    // Recheck the authoritative preference before staging, importing, moving
    // a cursor, changing the ledger market, or acknowledging remote rows.
    // Leaving the relay copy unacknowledged is intentional: it can be retried
    // only after the user explicitly enables capture again.
    if (routineStopped(collected.source)) {
      return { kind: 'up-to-date', source: 'none', ...EMPTY_SUMMARY };
    }
    // Native and relay collectors can retain observations in encrypted queues.
    // Never evict existing money evidence merely to make room for this page.
    const candidates = collected.reviewCandidates ?? [];
    const capacity = collected.source === 'sms' || collected.source === 'push' || collected.source === 'relay'
      ? partitionReviewsByCapacity(activeLedger.getState().reviewTray ?? emptyAlertReviewTray(), candidates, Date.now())
      : { admit: candidates, deferred: [] };
    const reviewCandidates = capacity.admit;
    const deferredReviewSourceKeys = capacity.deferred.map(item => item.sourceKey);
    const finalDeferredReviewSources = () => {
      const currentClaims = currentReviewClaims();
      return [...deferredReviewSourceKeys,
        ...[...knownReviewSourceKeys, ...reviewCandidates.map(item => canonicalCaptureSourceKey(item.sourceKey, item.observedAt))]
          .filter(key => !currentClaims.has(canonicalCaptureSourceKey(key)))];
    };
    const skippedInboxSources = collected.skippedKnownInboxReviewSourceKeys ?? [];
    const skippedInboxNeedsRetry = () => {
      const claims = currentReviewClaims();
      return skippedInboxSources.some(key => knownPendingReviewSources.has(canonicalCaptureSourceKey(key)) ||
        !claims.has(canonicalCaptureSourceKey(key)));
    };
    // Pending claims can disappear during any later persistence await without
    // a ledger replacement. Keep the monotonic cursor and parser receipts
    // unchanged for this scan rather than advancing and trying to rewind.
    // Known-source filtering still exposes older cropped rows; completion
    // resumes once the overlapping pending reviews have final decisions.
    let deferInbox = collected.deferredInboxReviews || capacity.deferred.some(item => item.channel !== 'push') ||
      skippedInboxNeedsRetry();
    let reviewAlerts = 0;
    if (reviewCandidates.length > 0 || (collected.reviewSourceBindings?.length ?? 0) > 0) {
      if (!activeLedger.stageReviewAlerts) {
        throw new Error('Capture executor requires review staging for review candidates');
      }
      // Review first, before an SMS cursor can advance. The authoritative
      // ledger is read again after this durability await: Restore may replace
      // the entire ledger while encrypted review staging is in flight.
      const reviewStarted = tracing ? Date.now() : 0;
      captureTrace('reviews:start', reviewCandidates.length);
      const reviewReceipt = activeLedger.stageReviewAlerts(reviewCandidates, undefined, collected.reviewSourceBindings);
      reviewAlerts = reviewReceipt.admitted;
      await reviewReceipt.durable;
      captureTrace('reviews:done', reviewAlerts, tracing ? Date.now() - reviewStarted : 0);
      if (routineStopped(collected.source)) {
        return { kind: 'up-to-date', source: 'none', ...EMPTY_SUMMARY };
      }
    }

    alignLedgerMarket(activeLedger, collected.detectedLaunchMarket);
    // Native inbox collection returns a whole page at once. Even though parsing
    // itself yields cooperatively, its final promise can resolve in the same JS
    // turn as planning/reconciliation. Give pending input/render work one turn
    // before the synchronous money planner, matching the relay path below.
    if (collected.parsed.length > 0 || collected.declined.length > 0) {
      await yieldForegroundTurn();
    }
    if (routineStopped(collected.source)) {
      return { kind: 'up-to-date', source: 'none', ...EMPTY_SUMMARY };
    }
    let stateAtPlan = activeLedger.getState();
    if (!stateAtPlan.hydrated) return { kind: 'not-hydrated' };
    // Runtime diagnostics are always on for Android tester builds, independently
    // of the verbose capture trace flag. Starting this clock at zero when trace
    // was disabled produced epoch-sized "capture-plan" durations and hid the
    // real operation that could be blocking the JS thread.
    let planMs = 0;
    const planAgainst = (ledgerState: AppState): ImportPlan => {
      deferInbox ||= skippedInboxNeedsRetry();
      const planStarted = Date.now();
      captureTrace('plan:start', collected.parsed.length);
      const result = dependencies.planRows(
        collected.parsed,
        ledgerState,
        deferInbox ? ledgerState.lastScanTs : collected.newestTs,
        new Date(),
        collected.declined,
      );
      planMs = Date.now() - planStarted;
      recordRuntimeOperation('capture-plan', planMs);
      return result;
    };
    let planned = planAgainst(stateAtPlan);
    // Planning and applying a batch each walk the whole ledger. Run in one JS
    // turn they were the longest freeze of a capture on a 15k-row phone, so
    // input and rendering get a turn between them. The plan that is applied is
    // still exactly the plan for the ledger it is applied to: importBatch
    // dispatches synchronously below, and if anything replaced the ledger
    // during this yield (an edit, another import, a restore) the batch is
    // re-planned against the new snapshot in that same final turn. A stale plan
    // therefore still cannot stamp a restored ledger as having completed a
    // historical parser migration.
    if (hasChanges(planned) || (planned.walletNearMatches?.length ?? 0) > 0) {
      await yieldForegroundTurn();
      if (routineStopped(collected.source)) {
        return { kind: 'up-to-date', source: 'none', ...EMPTY_SUMMARY };
      }
      const current = activeLedger.getState();
      if (!current.hydrated) return { kind: 'not-hydrated' };
      if (current !== stateAtPlan) {
        stateAtPlan = current;
        planned = planAgainst(current);
      }
    }
    // Possible Apple Pay duplicates were withheld from the batch. Stage them in
    // this same turn so the importBatch below (and its cursor) persist with
    // them, and settle before any commit/ACK below.
    const nearMatches = stageNearMatches(activeLedger, planned);
    const plan = nearMatches.plan;
    reviewAlerts += nearMatches.admitted;
    captureTrace('plan:done', plan.txCount + plan.healedCount, tracing ? planMs : 0);
    // The parser version is a durable migration receipt. Only the collection
    // that actually started at the beginning of the Android inbox may carry
    // it into the atomic ledger write. A routine scan can finish after an old
    // backup is restored; stamping that partial scan would prevent the next
    // launch from repairing the restored history.
    const importBatch: ImportBatchInput = {
      ...plan.batch,
      ...(collected.historicalReread && !deferInbox ? { parserRereadComplete: true } : {}),
      ...(collected.historyImport && !deferInbox ? { historyImport: collected.historyImport } : {}),
      ...(collected.recentRereadParserVersion !== undefined && !deferInbox
        ? { recentRereadParserVersion: collected.recentRereadParserVersion } : {}),
    };

    if (!hasChanges(plan)) {
      // A review-only Android scan still consumed the inbox up to newestTs.
      // Persist that cursor after the sanitized tray is durable; otherwise it
      // rereads an already handled review window forever. Cropped/deferred
      // inbox evidence keeps the existing watermark above. Relay rows use ACKs.
      if (collected.source === 'sms' &&
        (importBatch.lastScanTs > stateAtPlan.lastScanTs ||
          importBatch.parserRereadComplete === true || importBatch.historyImport !== undefined ||
          (importBatch.recentRereadParserVersion ?? 0) > (stateAtPlan.recentRereadParserVersion ?? 0))) {
        // Runtime diagnostics are always active in tester builds. Do not zero
        // this clock when verbose capture tracing is off; that records an
        // epoch-sized fake duration and hides the real save cost.
        const saveStarted = Date.now();
        captureTrace('save:start');
        const cursorReceipt = activeLedger.importBatch(importBatch);
        await cursorReceipt.durable;
        recordRuntimeOperation('capture-save', Date.now() - saveStarted);
        captureTrace('save:done', cursorReceipt.ids.length, tracing ? Date.now() - saveStarted : 0);
        if (routineStopped(collected.source)) {
          return { kind: 'up-to-date', source: 'none', ...EMPTY_SUMMARY };
        }
      }
      // A deduplicated relay row may only exist in current React state because
      // an earlier encrypted write failed. Flush before dropping its sealed copy.
      if (
        collected.source === 'relay' &&
        (reviewCandidates.length === 0 || collected.parsed.length > 0)
      ) {
        await activeLedger.ensureDurable();
        if (routineStopped(collected.source)) {
          return { kind: 'up-to-date', source: 'none', ...EMPTY_SUMMARY };
        }
      }
      // A push row can dedupe against a transaction that is still only in
      // React state after a pending/failed save. Flush that state before
      // deleting its sole encrypted native copy, even in a mixed SMS scan.
      if (collected.requiresDurableCommit) {
        await activeLedger.ensureDurable();
        if (routineStopped(collected.source)) {
          return { kind: 'up-to-date', source: 'none', ...EMPTY_SUMMARY };
        }
      }
      if (routineStopped(collected.source)) {
        return { kind: 'up-to-date', source: 'none', ...EMPTY_SUMMARY };
      }
      if (collected.source === 'relay') {
        await recordForegroundAutomationProof(collected.parsed);
        if (routineStopped(collected.source)) {
          return { kind: 'up-to-date', source: 'none', ...EMPTY_SUMMARY };
        }
      }
      await nearMatches.settle();
      if (routineStopped(collected.source)) {
        return { kind: 'up-to-date', source: 'none', ...EMPTY_SUMMARY };
      }
      await collected.commit(finalDeferredReviewSources());
      captureTrace('routine:done', 0, tracing ? Date.now() - traceStarted : 0);
      return {
        kind: 'up-to-date',
        source: collected.source,
        ...EMPTY_SUMMARY,
        reviewAlerts,
      };
    }

    const saveStarted = Date.now();
    captureTrace('save:start', plan.txCount + plan.healedCount);
    const receipt = activeLedger.importBatch(importBatch);
    await receipt.durable;
    recordRuntimeOperation('capture-save', Date.now() - saveStarted);
    captureTrace('save:done', receipt.ids.length, tracing ? Date.now() - saveStarted : 0);
    if (routineStopped(collected.source)) {
      return { kind: 'up-to-date', source: 'none', ...EMPTY_SUMMARY };
    }
    if (collected.source === 'relay') {
      await recordForegroundAutomationProof(collected.parsed);
      if (routineStopped(collected.source)) {
        return { kind: 'up-to-date', source: 'none', ...EMPTY_SUMMARY };
      }
    }
    await nearMatches.settle();
    if (routineStopped(collected.source)) {
      return { kind: 'up-to-date', source: 'none', ...EMPTY_SUMMARY };
    }
    await collected.commit(finalDeferredReviewSources());
    captureTrace('routine:done', receipt.ids.length, tracing ? Date.now() - traceStarted : 0);
    return {
      kind: 'imported',
      source: collected.source,
      ...summary(plan, receipt.ids, reviewAlerts),
    };
  };

  const executeSupplemental = async (): Promise<CaptureExecutionOutcome> => {
    const activeLedger = requireLedger();
    const startingState = activeLedger.getState();
    if (!startingState.hydrated) return { kind: 'not-hydrated' };
    const generation = activeLedger.getStateGeneration?.();
    // Supplemental statement import is an explicit foreground action. A user
    // who disabled automatic capture can still choose a statement file. If
    // they opt out during an import that started enabled, honor that new choice
    // before any later persistence/proof/ACK. Private Mode always blocks relay.
    const startedOptedOut = startingState.captureOptOut === true;
    const supplementalStopped = (): boolean => {
      const current = activeLedger.getState();
      return !current.hydrated || current.privateMode ||
        (generation !== undefined && activeLedger.getStateGeneration?.() !== generation) ||
        (!startedOptedOut && current.captureOptOut === true);
    };
    const stopped = (): CaptureExecutionOutcome => ({
      kind: 'up-to-date',
      source: 'none',
      ...EMPTY_SUMMARY,
    });

    const cfg = await dependencies.getRelay();
    if (supplementalStopped()) return stopped();
    if (!cfg) return { kind: 'needs-setup' };

    const queued = await dependencies.sync(cfg);
    if (supplementalStopped()) return stopped();
    alignLedgerMarket(activeLedger, launchMarketForRows(queued.parsed, cfg.market));
    // Network collection can overlap a foreground import or an edit. Plan
    // against the authoritative ledger after that wait, not the snapshot that
    // happened to be current when the request started.
    let state = activeLedger.getState();
    if (!state.hydrated) return { kind: 'not-hydrated' };
    let reviewAlerts = 0;
    const candidates = queued.reviewCandidates ?? [];
    const capacity = partitionReviewsByCapacity(state.reviewTray ?? emptyAlertReviewTray(), candidates, Date.now());
    const reviewCandidates = capacity.admit;
    if (reviewCandidates.length > 0) {
      if (!activeLedger.stageReviewAlerts) {
        throw new Error('Capture executor requires review staging for review candidates');
      }
      if (supplementalStopped()) return stopped();
      const reviewReceipt = activeLedger.stageReviewAlerts(reviewCandidates);
      reviewAlerts = reviewReceipt.admitted;
      await reviewReceipt.durable;
      if (supplementalStopped()) return stopped();
      state = activeLedger.getState();
    }
    if (queued.parsed.length > 0) await yieldForegroundTurn();
    if (supplementalStopped()) return stopped();
    state = activeLedger.getState();
    const planAgainst = (snapshot: AppState) => dependencies.planRows(queued.parsed, snapshot,
      queued.parsed.reduce((max, row) => Math.max(max, row.smsTs ?? 0), snapshot.lastScanTs));
    const supplementalTracing = captureTraceEnabled();
    const planStarted = supplementalTracing ? Date.now() : 0;
    captureTrace('plan:start', queued.parsed.length);
    let plan = planAgainst(state);
    captureTrace('plan:done', plan.txCount + plan.healedCount,
      supplementalTracing ? Date.now() - planStarted : 0);
    let transactionIds: string[] = [];
    let nearMatchSettle: () => Promise<void> = async () => {};
    if (queued.parsed.length > 0 && (hasChanges(plan) || (plan.walletNearMatches?.length ?? 0) > 0)) {
      await yieldForegroundTurn();
      if (supplementalStopped()) return stopped();
      const current = activeLedger.getState();
      if (current !== state) {
        state = current;
        plan = planAgainst(current);
      }
    }
    // No await separates the authoritative replan from staging/application.
    // Normal account edits and competing imports do not change generation.
    if (queued.parsed.length > 0 && hasChanges(plan)) {
      // Same synchronous turn as the importBatch below.
      const nearMatches = stageNearMatches(activeLedger, plan);
      plan = nearMatches.plan;
      reviewAlerts += nearMatches.admitted;
      nearMatchSettle = nearMatches.settle;
      const saveStarted = supplementalTracing ? Date.now() : 0;
      captureTrace('save:start', plan.txCount + plan.healedCount);
      const receipt = activeLedger.importBatch(plan.batch);
      transactionIds = receipt.ids;
      await receipt.durable;
      captureTrace('save:done', receipt.ids.length,
        supplementalTracing ? Date.now() - saveStarted : 0);
      if (supplementalStopped()) return stopped();
    } else if ((plan.walletNearMatches?.length ?? 0) > 0) {
      // Only possible Apple Pay duplicates: nothing to post, but their review
      // items must be durable before the relay copies are acknowledged.
      if (supplementalStopped()) return stopped();
      const nearMatches = stageNearMatches(activeLedger, plan);
      plan = nearMatches.plan;
      reviewAlerts += nearMatches.admitted;
      nearMatchSettle = nearMatches.settle;
      if (hasChanges(plan)) {
        const receipt = activeLedger.importBatch(plan.batch);
        transactionIds = receipt.ids;
        await receipt.durable;
      }
      if (supplementalStopped()) return stopped();
    } else if (reviewCandidates.length === 0 || queued.parsed.length > 0) {
      if (supplementalStopped()) return stopped();
      const saveStarted = supplementalTracing ? Date.now() : 0;
      captureTrace('save:start');
      await activeLedger.ensureDurable();
      captureTrace('save:done', 0, supplementalTracing ? Date.now() - saveStarted : 0);
      if (supplementalStopped()) return stopped();
    }

    let acknowledge: string[] = [];
    try {
      await nearMatchSettle();
      if (supplementalStopped()) return stopped();
      await recordForegroundAutomationProof(queued.parsed, cfg);
      if (supplementalStopped()) return stopped();
      const finalClaims = reviewSourceClaims(activeLedger.getState());
      const deferredReviewSources = [
        ...capacity.deferred.map(item => canonicalCaptureSourceKey(item.sourceKey, item.observedAt)),
        ...candidates.map(item => canonicalCaptureSourceKey(item.sourceKey, item.observedAt)).filter(key => !finalClaims.has(key)),
      ];
      acknowledge = acknowledgementsFor(queued, true, deferredReviewSources);
      if (acknowledge.length > 0) {
        if (supplementalStopped()) return stopped();
        await dependencies.acknowledge(cfg, acknowledge);
      }
    } catch (error) {
      throw new StatementFilingError(error, plan.txCount, reviewAlerts);
    }
    const pageSummary = {
      ...summary(plan, transactionIds, reviewAlerts),
      // A full page held entirely for Review capacity cannot make progress
      // until a decision frees space; do not spin a caller's page-drain loop.
      moreQueued: queued.pageFull === true && acknowledge.length > 0,
      queueBlocked: queued.pageFull === true && acknowledge.length === 0,
      deferredReviews: (queued.reviewIds ?? []).filter(id => !acknowledge.includes(id)).length,
    };
    return hasChanges(plan)
      ? { kind: 'imported', source: 'relay', ...pageSummary }
      : { kind: 'up-to-date', source: 'relay', ...pageSummary };
  };

  const executeBackground = async (): Promise<CaptureExecutionOutcome> => {
    if (!background) throw new Error('Capture executor requires a background adapter');
    const cfg = await dependencies.getBackgroundRelay();
    if (!cfg || cfg.setupState === 'paired') {
      return { kind: 'background', received: 0, fresh: 0 };
    }

    const queued = await dependencies.sync(cfg);
    const fresh = await background.stage(queued.parsed);
    try {
      await background.announce(fresh);
    } catch {
      // A quiet banner is never allowed to strand a row that is already safe
      // in the encrypted inbox. Delivery can retry; financial capture must not.
    }
    const marker = queued.parsed.find((row) =>
      row.captureSource === 'shortcut' &&
      row.captureAutomation?.kind === 'message' &&
      row.captureAutomation.sourceDeviceId === cfg.deviceId &&
      row.captureAutomation.generation === cfg.automationGeneration
    )?.captureAutomation;
    if (marker) await background.recordAutomationProof(cfg, marker);
    const acknowledge = acknowledgementsFor(queued);
    if (acknowledge.length > 0) await dependencies.acknowledge(cfg, acknowledge);
    return { kind: 'background', received: queued.parsed.length, fresh: fresh.length };
  };

  const executeSetupVerification = async (): Promise<CaptureExecutionOutcome> => {
    const activeLedger = requireLedger();
    const startingState = activeLedger.getState();
    if (!startingState.hydrated) return { kind: 'not-hydrated' };
    const generation = activeLedger.getStateGeneration?.();
    const setupStopped = () => {
      const current = activeLedger.getState();
      return !current.hydrated || current.privateMode ||
        (generation !== undefined && activeLedger.getStateGeneration?.() !== generation) ||
        (!startingState.captureOptOut && current.captureOptOut === true);
    };

    const cfg = await dependencies.getRelay();
    if (setupStopped()) return { kind: 'setup-waiting' };
    if (!cfg) return { kind: 'needs-setup' };
    const queued = await dependencies.sync(cfg);
    if (setupStopped()) return { kind: 'setup-waiting' };
    alignLedgerMarket(activeLedger, launchMarketForRows(queued.parsed, cfg.market));
    const shortcutRow = queued.parsed.find((row) =>
      row.captureSource === 'shortcut' &&
      row.captureAutomation?.kind === 'message' &&
      row.captureAutomation.sourceDeviceId === cfg.deviceId &&
      row.captureAutomation.generation === cfg.automationGeneration
    );
    const proofObserved = queued.testReceived > 0 || shortcutRow !== undefined;

    const candidates = queued.reviewCandidates ?? [];
    const capacity = partitionReviewsByCapacity(activeLedger.getState().reviewTray ?? emptyAlertReviewTray(), candidates, Date.now());
    const reviewCandidates = capacity.admit;
    const acknowledgeSetup = async () => {
      if (setupStopped()) return;
      const claims = reviewSourceClaims(activeLedger.getState());
      const deferred = [
        ...capacity.deferred.map(item => canonicalCaptureSourceKey(item.sourceKey, item.observedAt)),
        ...candidates.map(item => canonicalCaptureSourceKey(item.sourceKey, item.observedAt)).filter(key => !claims.has(key)),
      ];
      const ids = acknowledgementsFor(queued, true, deferred, true);
      if (ids.length > 0) await dependencies.acknowledge(cfg, ids);
    };
    if (reviewCandidates.length > 0) {
      if (!activeLedger.stageReviewAlerts) {
        throw new Error('Capture executor requires review staging for review candidates');
      }
      await activeLedger.stageReviewAlerts(reviewCandidates).durable;
      if (setupStopped()) return { kind: 'setup-waiting' };
    }

    if (queued.parsed.length > 0) {
      // The sync can overlap another import. Plan only after it returns, using
      // the same authoritative-state rule as supplemental collection.
      const state = activeLedger.getState();
      if (!state.hydrated) return { kind: 'not-hydrated' };
      const newestTs = queued.parsed.reduce(
        (max, row) => Math.max(max, row.smsTs ?? 0),
        state.lastScanTs,
      );
      const nearMatches = stageNearMatches(
        activeLedger, dependencies.planRows(queued.parsed, state, newestTs));
      const plan = nearMatches.plan;
      if (hasChanges(plan)) {
        await activeLedger.importBatch(plan.batch).durable;
      } else {
        // A retry can dedupe against an in-memory import whose first write
        // failed. The relay copy remains the recovery source until this flush.
        await activeLedger.ensureDurable();
      }
      if (setupStopped()) return { kind: 'setup-waiting' };
      await nearMatches.settle();
      if (setupStopped()) return { kind: 'setup-waiting' };
    }

    if (!proofObserved) {
      // Setup owns probe ids. Unreadable rows are unrecoverable and are also
      // retired here so they cannot block the next valid test for 30 days.
      await acknowledgeSetup();
      return { kind: 'setup-waiting' };
    }

    // Persist the verified state before retiring its only proof. A Keychain
    // failure then leaves the relay row available for a retry instead of
    // forcing the user to run the Shortcut again.
    const verified = await dependencies.markVerified(cfg);
    if (setupStopped()) return { kind: 'setup-waiting' };
    await recordForegroundAutomationProof(queued.parsed, verified);
    if (setupStopped()) return { kind: 'setup-waiting' };
    await acknowledgeSetup();
    return {
      kind: 'setup-observed',
      merchant: queued.testReceived > 0 ? 'Wafra Capture' : shortcutRow!.merchant,
      isTest: queued.testReceived > 0,
      verifiedAt: verified.verifiedAt ?? Date.now(),
    };
  };

  return {
    execute: async (intent) => {
      if (intent === 'routine') return executeRoutine();
      if (intent === 'notification-only') return executeRoutine(true);
      if (intent === 'supplemental') return executeSupplemental();
      if (intent === 'setup-verification') return executeSetupVerification();
      return executeBackground();
    },
  };
};
