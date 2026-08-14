/**
 * Durable capture execution.
 *
 * Callers choose why they are draining capture, then receive facts suitable
 * for UI feedback. Queue identifiers, setup-probe reservations, persistence
 * barriers, and acknowledgement ordering never cross this interface.
 */
import { buildImportPlan, type ImportPlan, type ScannedSms } from '@/lib/auto-import';
import { collectNewMessages, type CaptureResult, type CaptureSource } from '@/lib/capture';
import {
  ackRelay,
  getBackgroundRelayConfig,
  getRelayConfig,
  markRelayVerified,
  syncRelay,
  type BackgroundRelayConfig,
  type RelayConfig,
  type RelaySyncResult,
} from '@/lib/relay';
import type { AppState, ImportBatchInput } from '@/lib/types';
import type { ReviewAlert } from '@/lib/alert-review-tray';

export type CaptureIntent = 'routine' | 'supplemental' | 'setup-verification' | 'background';

export interface CaptureImportSummary {
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
  importBatch: (input: ImportBatchInput) => { ids: string[]; durable: Promise<void> };
  ensureDurable: () => Promise<void>;
  /** Persist a launch pack selected from strong per-alert AED/SAR evidence. */
  setMarket?: (id: 'AE' | 'SA') => boolean;
  stageReviewAlerts?: (items: ReviewAlert[]) => { admitted: number; durable: Promise<void> };
}

export interface BackgroundCaptureAdapter {
  /** Persist parsed rows in the after-first-unlock encrypted inbox. */
  stage: (rows: ScannedSms[]) => Promise<ScannedSms[]>;
  /** Announce only rows that were not already staged. */
  announce: (fresh: ScannedSms[]) => Promise<void>;
  recordAutomationProof: (cfg: BackgroundRelayConfig) => Promise<void>;
}

interface CaptureExecutorDependencies {
  collectRoutine: (state: AppState) => Promise<CaptureResult>;
  planRows: typeof buildImportPlan;
  getRelay: () => Promise<RelayConfig | null>;
  getBackgroundRelay: () => Promise<BackgroundRelayConfig | null>;
  sync: (cfg: Pick<RelayConfig, 'baseUrl' | 'syncToken' | 'privateKey'>) => Promise<RelaySyncResult>;
  acknowledge: (
    cfg: Pick<RelayConfig, 'baseUrl' | 'syncToken'>,
    ids: string[],
  ) => Promise<void>;
  markVerified: (cfg: RelayConfig) => Promise<RelayConfig>;
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
  (plan.batch.newBills?.length ?? 0) > 0;

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
): string[] => {
  const reserved = new Set(queued.testIds);
  if (!includeReviews) {
    for (const id of queued.reviewIds ?? []) reserved.add(id);
  }
  return queued.ids.filter((id) => !reserved.has(id));
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

  const executeRoutine = async (): Promise<CaptureExecutionOutcome> => {
    const activeLedger = requireLedger();
    const state = activeLedger.getState();
    if (!state.hydrated) return { kind: 'not-hydrated' };

    const collected = await dependencies.collectRoutine(state);
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
    if (captureStopped(activeLedger, collected.source)) {
      return { kind: 'up-to-date', source: 'none', ...EMPTY_SUMMARY };
    }
    const reviewCandidates = collected.reviewCandidates ?? [];
    let reviewAlerts = 0;
    if (reviewCandidates.length > 0) {
      if (!activeLedger.stageReviewAlerts) {
        throw new Error('Capture executor requires review staging for review candidates');
      }
      // Review first, before an SMS cursor can advance. The authoritative
      // ledger is read again after this durability await: Restore may replace
      // the entire ledger while encrypted review staging is in flight.
      const reviewReceipt = activeLedger.stageReviewAlerts(reviewCandidates);
      reviewAlerts = reviewReceipt.admitted;
      await reviewReceipt.durable;
      if (captureStopped(activeLedger, collected.source)) {
        return { kind: 'up-to-date', source: 'none', ...EMPTY_SUMMARY };
      }
    }

    alignLedgerMarket(activeLedger, collected.detectedLaunchMarket);
    // This is deliberately after the final pre-import await. importBatch
    // dispatches synchronously below, so a stale plan can never stamp a
    // restored ledger as having completed a historical parser migration.
    const stateAtPlan = activeLedger.getState();
    if (!stateAtPlan.hydrated) return { kind: 'not-hydrated' };
    const plan = dependencies.planRows(
      collected.parsed,
      stateAtPlan,
      collected.newestTs,
      new Date(),
      collected.declined,
    );
    // The parser version is a durable migration receipt. Only the collection
    // that actually started at the beginning of the Android inbox may carry
    // it into the atomic ledger write. A routine scan can finish after an old
    // backup is restored; stamping that partial scan would prevent the next
    // launch from repairing the restored history.
    const importBatch: ImportBatchInput = collected.historicalReread
      ? { ...plan.batch, parserRereadComplete: true }
      : plan.batch;

    if (!hasChanges(plan)) {
      // A review-only Android scan still consumed the inbox up to newestTs.
      // Persist that cursor after the sanitized tray is durable; otherwise it
      // rereads the same bounded review window forever. Alerts older than the
      // privacy cap are intentionally not retained. Relay rows use ACKs.
      if (collected.source === 'sms' &&
        (importBatch.lastScanTs > stateAtPlan.lastScanTs ||
          importBatch.parserRereadComplete === true)) {
        const cursorReceipt = activeLedger.importBatch(importBatch);
        await cursorReceipt.durable;
        if (captureStopped(activeLedger, collected.source)) {
          return { kind: 'up-to-date', source: 'none', ...EMPTY_SUMMARY };
        }
      }
      // A deduplicated relay row may only exist in current React state because
      // an earlier encrypted write failed. Flush before dropping its sealed copy.
      if (collected.source === 'relay' && reviewCandidates.length === 0) {
        await activeLedger.ensureDurable();
        if (captureStopped(activeLedger, collected.source)) {
          return { kind: 'up-to-date', source: 'none', ...EMPTY_SUMMARY };
        }
      }
      if (captureStopped(activeLedger, collected.source)) {
        return { kind: 'up-to-date', source: 'none', ...EMPTY_SUMMARY };
      }
      await collected.commit();
      return {
        kind: 'up-to-date',
        source: collected.source,
        ...EMPTY_SUMMARY,
        reviewAlerts,
      };
    }

    const receipt = activeLedger.importBatch(importBatch);
    await receipt.durable;
    if (captureStopped(activeLedger, collected.source)) {
      return { kind: 'up-to-date', source: 'none', ...EMPTY_SUMMARY };
    }
    await collected.commit();
    return {
      kind: 'imported',
      source: collected.source,
      ...summary(plan, receipt.ids, reviewAlerts),
    };
  };

  const executeSupplemental = async (): Promise<CaptureExecutionOutcome> => {
    const activeLedger = requireLedger();
    if (!activeLedger.getState().hydrated) return { kind: 'not-hydrated' };

    const cfg = await dependencies.getRelay();
    if (!cfg) return { kind: 'needs-setup' };

    const queued = await dependencies.sync(cfg);
    alignLedgerMarket(activeLedger, launchMarketForRows(queued.parsed, cfg.market));
    // Network collection can overlap a foreground import or an edit. Plan
    // against the authoritative ledger after that wait, not the snapshot that
    // happened to be current when the request started.
    const state = activeLedger.getState();
    if (!state.hydrated) return { kind: 'not-hydrated' };
    let reviewAlerts = 0;
    const reviewCandidates = queued.reviewCandidates ?? [];
    if (reviewCandidates.length > 0) {
      if (!activeLedger.stageReviewAlerts) {
        throw new Error('Capture executor requires review staging for review candidates');
      }
      const reviewReceipt = activeLedger.stageReviewAlerts(reviewCandidates);
      reviewAlerts = reviewReceipt.admitted;
      await reviewReceipt.durable;
    }
    const newestTs = queued.parsed.reduce(
      (max, row) => Math.max(max, row.smsTs ?? 0),
      state.lastScanTs,
    );
    const plan = dependencies.planRows(queued.parsed, state, newestTs);
    let transactionIds: string[] = [];
    if (queued.parsed.length > 0) {
      const receipt = activeLedger.importBatch(plan.batch);
      transactionIds = receipt.ids;
      await receipt.durable;
    } else if (reviewCandidates.length === 0) {
      await activeLedger.ensureDurable();
    }

    const acknowledge = acknowledgementsFor(queued, true);
    if (acknowledge.length > 0) await dependencies.acknowledge(cfg, acknowledge);
    return hasChanges(plan)
      ? { kind: 'imported', source: 'relay', ...summary(plan, transactionIds, reviewAlerts) }
      : { kind: 'up-to-date', source: 'relay', ...summary(plan, transactionIds, reviewAlerts) };
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
    if (queued.parsed.some((row) => row.captureSource === 'shortcut')) {
      await background.recordAutomationProof(cfg);
    }
    const acknowledge = acknowledgementsFor(queued);
    if (acknowledge.length > 0) await dependencies.acknowledge(cfg, acknowledge);
    return { kind: 'background', received: queued.parsed.length, fresh: fresh.length };
  };

  const executeSetupVerification = async (): Promise<CaptureExecutionOutcome> => {
    const activeLedger = requireLedger();
    if (!activeLedger.getState().hydrated) return { kind: 'not-hydrated' };

    const cfg = await dependencies.getRelay();
    if (!cfg) return { kind: 'needs-setup' };
    const queued = await dependencies.sync(cfg);
    alignLedgerMarket(activeLedger, launchMarketForRows(queued.parsed, cfg.market));
    const shortcutRow = queued.parsed.find((row) => row.captureSource === 'shortcut');
    const proofObserved = queued.testReceived > 0 || shortcutRow !== undefined;

    const reviewCandidates = queued.reviewCandidates ?? [];
    if (reviewCandidates.length > 0) {
      if (!activeLedger.stageReviewAlerts) {
        throw new Error('Capture executor requires review staging for review candidates');
      }
      await activeLedger.stageReviewAlerts(reviewCandidates).durable;
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
      const plan = dependencies.planRows(queued.parsed, state, newestTs);
      if (hasChanges(plan)) {
        await activeLedger.importBatch(plan.batch).durable;
      } else {
        // A retry can dedupe against an in-memory import whose first write
        // failed. The relay copy remains the recovery source until this flush.
        await activeLedger.ensureDurable();
      }
    }

    if (!proofObserved) {
      // Setup owns probe ids. Unreadable rows are unrecoverable and are also
      // retired here so they cannot block the next valid test for 30 days.
      if (queued.ids.length > 0) await dependencies.acknowledge(cfg, queued.ids);
      return { kind: 'setup-waiting' };
    }

    // Persist the verified state before retiring its only proof. A Keychain
    // failure then leaves the relay row available for a retry instead of
    // forcing the user to run the Shortcut again.
    const verified = await dependencies.markVerified(cfg);
    if (queued.ids.length > 0) await dependencies.acknowledge(cfg, queued.ids);
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
      if (intent === 'supplemental') return executeSupplemental();
      if (intent === 'setup-verification') return executeSetupVerification();
      return executeBackground();
    },
  };
};
