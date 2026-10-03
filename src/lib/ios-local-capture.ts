import type { WafraLiveCaptureNativeModule } from '../../modules/wafra-live-capture';

import { isCaptureTimestamp } from '@/lib/ios-capture-health';

import type { CaptureLedgerAdapter } from '@/lib/capture-executor';
import { buildImportPlan, type ImportPlan } from '@/lib/import-plan';
import { createLaunchAlertSession } from '@/lib/launch-alert-parser';
import {
  emptyAlertReviewTray,
  isUniversalReviewAlert,
  partitionReviewsByCapacity,
  reviewCaptureBacklog,
} from '@/lib/alert-review-tray';
import { migrateLegacyLedgerMoney } from '@/lib/ledger-money';
import { settleWalletNearMatches, walletNearMatchesRetained } from '@/lib/wallet-near-match';
import { createIosNotificationReplayGuard } from '@/lib/ios-notification-replay';
import {
  convertCurrencyConflictRow,
  currencyConflictFxNeed,
  currencyConflictReview,
  parseLocalMessageRecord,
  parseLocalApplePayRecord,
  preflightLocalMessageRecord,
  type LocalMessageParseOutcome,
  type LocalApplePayParseOutcome,
} from '@/lib/local-message-record';
import {
  isLocalCaptureQualificationCandidate,
  normalizeLocalCaptureQualifications,
  type AppState,
  type LocalCaptureDeclineQualificationMapping,
  type LocalCaptureQualificationCandidate,
  type LocalCaptureReviewQualificationCandidate,
} from '@/lib/types';

const PAGE_SIZE = 50;
const MAX_PAGES = 40;
/** Native bound on held records one drain may page past (MAX_PAGES * PAGE_SIZE). */
const MAX_EXCLUDED_RECORDS = 2000;
const MAX_APPLE_PAY_PAGES = 4;

export interface IosLocalCaptureOutcome {
  scanned: number;
  imported: number;
  reviews: number;
  declined: number;
  ignored: number;
  invalid: number;
  firstCapturedAt: number | null;
  retirement: 'not-needed' | 'complete' | 'retry-needed';
  /** Refused reviews remain in the native queue; retry after Review has room. */
  deferredReviews?: number;
  /** Unsupported payloads and reviews without durable space stay native. */
  deferredApplePay?: number;
  /** Apple Pay reviews among deferredApplePay that wait only for Review space. */
  deferredApplePayReviews?: number;
  /**
   * Declines and informational facts (statements, bill reminders) acknowledged
   * as ignored because their own launch-market currency conflicts with the
   * stored ledger money. Conflicting money-moving rows are never counted here:
   * they become durable Review items instead. Never imported.
   */
  currencyConflicts?: number;
}

export interface IosLocalCaptureCoordinator {
  drain(): Promise<IosLocalCaptureOutcome>;
  retryRetirementIfNeeded(): Promise<'not-needed' | 'complete' | 'retry-needed'>;
}

interface CoordinatorInput {
  native: WafraLiveCaptureNativeModule;
  ledger: CaptureLedgerAdapter;
  retireShortcutCapture: () => Promise<'not-needed' | 'complete'>;
  /** Wall clock for record expiry checks; tests pin it to their fixture date. */
  now?: () => number;
  /**
   * Dated reference rate for a launch-market purchase on a ledger kept in
   * another currency. Resolves null when no rate is available (offline,
   * Private Mode); the purchase then stays a Review item as before. Absent:
   * every such purchase goes to Review.
   */
  fxQuote?: (base: string, quote: string, date: string) => Promise<{
    base: string; quote: string; rate: number; date: string;
  } | null>;
}

/** Distinct pair/day rate lookups one page may make; the rest wait in Review. */
const MAX_FX_LOOKUPS_PER_PAGE = 8;

interface SharedCoordinatorEntry {
  input: CoordinatorInput;
  coordinator: IosLocalCaptureCoordinator;
}

interface PageRecord {
  serialized: string;
  sourceIndex: number;
  preflight: NonNullable<ReturnType<typeof preflightLocalMessageRecord>>;
}

// Coordinator instances can be recreated as hooks/dependencies change. Each
// instance owns exact joining for its callers, while this resolving tail only
// serializes different instances so one can never borrow another's result or
// dependency set. Both fulfillment and rejection release the next waiter.
let drainQueueTail: Promise<void> = Promise.resolve();
const sharedCoordinators = new WeakMap<
  CaptureLedgerAdapter['getState'],
  SharedCoordinatorEntry
>();

const sameLedgerAdapter = (
  left: CaptureLedgerAdapter,
  right: CaptureLedgerAdapter,
): boolean => left.getState === right.getState &&
  left.getStateGeneration === right.getStateGeneration &&
  left.importBatch === right.importBatch &&
  left.ensureDurable === right.ensureDurable &&
  left.setMarket === right.setMarket &&
  left.stageReviewAlerts === right.stageReviewAlerts;

const captureOptedOut = (ledger: CaptureLedgerAdapter): boolean =>
  ledger.getState().captureOptOut === true;

const yieldBetweenPages = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

const MARKET_CURRENCY = { AE: 'AED', SA: 'SAR' } as const;

/**
 * The stored accounting currency, read before any market alignment. A legacy
 * ledger derives it from its current marketId, so it must never be re-read
 * after setMarket. Unreadable money metadata keeps the prior behaviour.
 */
const storedLedgerCurrency = (state: AppState): string | null => {
  try {
    return migrateLegacyLedgerMoney(state)?.currency ?? null;
  } catch {
    return null;
  }
};

const planHasChanges = (plan: ImportPlan): boolean =>
  plan.txCount > 0 || plan.dueCount > 0 || plan.healedCount > 0 ||
  plan.newAccountCount > 0 || (plan.batch.newBills?.length ?? 0) > 0;

const earliestObservedAt = (
  outcomes: readonly LocalMessageParseOutcome[],
  kind: LocalMessageParseOutcome['kind'],
): number | null => {
  const timestamps = outcomes.flatMap((outcome) => {
    if (outcome.kind !== kind) return [];
    if (outcome.kind === 'parsed' || outcome.kind === 'declined') {
      return outcome.row.smsTs === undefined ? [] : [outcome.row.smsTs];
    }
    if (outcome.kind === 'review') return [outcome.item.observedAt];
    return [];
  });
  return timestamps.length > 0 ? Math.min(...timestamps) : null;
};

const sourceFreePageError = (message: string): Error => {
  const error = new Error(message);
  error.name = 'IosLocalCaptureError';
  return error;
};

const readLedgerGeneration = (ledger: CaptureLedgerAdapter): number => {
  if (!ledger.getStateGeneration) {
    throw sourceFreePageError('Local capture ledger generation is unavailable');
  }
  let generation: number;
  try {
    generation = ledger.getStateGeneration();
  } catch {
    throw sourceFreePageError('Local capture ledger generation is unavailable');
  }
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw sourceFreePageError('Local capture ledger generation is invalid');
  }
  return generation;
};

const requireLedgerGeneration = (
  ledger: CaptureLedgerAdapter,
  expected: number,
): void => {
  if (readLedgerGeneration(ledger) !== expected) {
    throw sourceFreePageError('Local capture ledger was replaced during the page');
  }
};

const exactQualificationIds = (
  value: unknown,
  candidates: readonly LocalCaptureQualificationCandidate[],
  expectedCount: number,
  label: 'review' | 'decline',
): string[] => {
  if (!Array.isArray(value) || value.length !== expectedCount) {
    throw sourceFreePageError(`Local capture ${label} qualification receipt was refused`);
  }
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  const ids = new Set<string>();
  for (const id of value) {
    if (typeof id !== 'string' || ids.has(id) || !candidateIds.has(id)) {
      throw sourceFreePageError(`Local capture ${label} qualification receipt was refused`);
    }
    ids.add(id);
  }
  return [...ids];
};

const exactDeclineQualificationMappings = (
  value: unknown,
  candidates: readonly LocalCaptureQualificationCandidate[],
  expectedIds: readonly string[],
  state: AppState,
  plan: ImportPlan,
): LocalCaptureDeclineQualificationMapping[] => {
  if (!Array.isArray(value) || value.length !== expectedIds.length) {
    throw sourceFreePageError('Local capture decline qualification mapping was refused');
  }
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const expected = new Set(expectedIds);
  const localIds = new Set<string>();
  const removedIds = new Set<string>();
  const mappings: LocalCaptureDeclineQualificationMapping[] = [];
  const planUpdates = plan.batch.updates ?? [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw sourceFreePageError('Local capture decline qualification mapping was refused');
    }
    const mapping = entry as Record<string, unknown>;
    const keys = Object.keys(mapping).sort();
    const localRecordId = mapping.localRecordId;
    const removedTransactionId = mapping.removedTransactionId;
    if (keys.length !== 2 || keys[0] !== 'localRecordId' ||
      keys[1] !== 'removedTransactionId' ||
      typeof localRecordId !== 'string' || !expected.has(localRecordId) ||
      localIds.has(localRecordId) ||
      typeof removedTransactionId !== 'string' || removedTransactionId.length === 0 ||
      removedIds.has(removedTransactionId)) {
      throw sourceFreePageError('Local capture decline qualification mapping was refused');
    }
    const qualification = candidateById.get(localRecordId);
    const rows = state.transactions.filter((row) => row.id === removedTransactionId);
    const updates = planUpdates.filter((update) => update.id === removedTransactionId);
    if (!qualification || qualification.kind !== 'decline' || rows.length !== 1 ||
      updates.length !== 1 || updates[0].remove !== true) {
      throw sourceFreePageError('Local capture decline qualification mapping was refused');
    }
    localIds.add(localRecordId);
    removedIds.add(removedTransactionId);
    mappings.push({ qualification: { ...qualification, kind: 'decline' }, removedTransactionId });
  }
  if (localIds.size !== expected.size) {
    throw sourceFreePageError('Local capture decline qualification mapping was refused');
  }
  return mappings;
};

const persistedQualificationIds = (
  state: AppState,
  candidates: readonly LocalCaptureQualificationCandidate[],
  now: number,
): string[] => {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const matched: string[] = [];
  for (const receipt of normalizeLocalCaptureQualifications(
    state.localCaptureQualifications,
    now,
  )) {
    const candidate = byId.get(receipt.id);
    if (!candidate) continue;
    if (receipt.kind !== candidate.kind || receipt.observedAt !== candidate.observedAt) {
      throw sourceFreePageError('Local capture qualification receipt does not match its record');
    }
    matched.push(receipt.id);
  }
  return matched;
};

const uniqueQualificationCandidates = (
  candidates: readonly LocalCaptureQualificationCandidate[],
): void => {
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (!isLocalCaptureQualificationCandidate(candidate) || ids.has(candidate.id)) {
      throw sourceFreePageError('Local capture qualification candidate is invalid');
    }
    ids.add(candidate.id);
  }
};

const earliestQualification = (
  candidates: readonly LocalCaptureQualificationCandidate[],
  ids: ReadonlySet<string>,
): number | null => {
  const timestamps = candidates
    .filter((candidate) => ids.has(candidate.id))
    .map((candidate) => candidate.observedAt);
  return timestamps.length > 0 ? Math.min(...timestamps) : null;
};

/** Drain the native queue through one serialized, durable acknowledgement path. */
export function createIosLocalCaptureCoordinator(
  input: CoordinatorInput,
): IosLocalCaptureCoordinator {
  let instanceInFlight: Promise<IosLocalCaptureOutcome> | null = null;
  let retirementInFlight: Promise<'not-needed' | 'complete' | 'retry-needed'> | null = null;
  const performRetirementRetry = async (): Promise<
    'not-needed' | 'complete' | 'retry-needed'
  > => {
    try {
      if (captureOptedOut(input.ledger)) return 'not-needed';
      const status = await input.native.getCaptureStatus();
      if (captureOptedOut(input.ledger)) return 'not-needed';
      if (!isCaptureTimestamp(status.firstCapturedAt)) return 'not-needed';
      return await input.retireShortcutCapture();
    } catch {
      return 'retry-needed';
    }
  };
  const retryRetirementIfNeeded = (): Promise<
    'not-needed' | 'complete' | 'retry-needed'
  > => {
    if (retirementInFlight) return retirementInFlight;
    const pending = performRetirementRetry();
    retirementInFlight = pending;
    void pending.then(
      () => {
        if (retirementInFlight === pending) retirementInFlight = null;
      },
      () => {
        if (retirementInFlight === pending) retirementInFlight = null;
      },
    );
    return pending;
  };

  const performDrain = async (): Promise<IosLocalCaptureOutcome> => {
    const totals: Omit<IosLocalCaptureOutcome, 'firstCapturedAt' | 'retirement'> = {
      scanned: 0,
      imported: 0,
      reviews: 0,
      declined: 0,
      ignored: 0,
      invalid: 0,
    };
    // Record identities, so a deferred record re-listed by a later page is
    // counted once.
    const deferredReviewRecords = new Set<string>();
    const currencyConflictRecords = new Set<string>();
    const stopped = (firstCapturedAt: number | null): IosLocalCaptureOutcome => ({
      ...totals,
      firstCapturedAt,
      retirement: 'not-needed',
    });

    if (captureOptedOut(input.ledger)) return stopped(null);
    readLedgerGeneration(input.ledger);
    if (captureOptedOut(input.ledger)) return stopped(null);
    await input.native.purgeExpired();
    if (captureOptedOut(input.ledger)) return stopped(null);
    const initialStatus = await input.native.getCaptureStatus();
    let firstCapturedAt = isCaptureTimestamp(initialStatus.firstCapturedAt)
      ? initialStatus.firstCapturedAt : null;
    if (captureOptedOut(input.ledger)) return stopped(firstCapturedAt);

    // Older JS must never see a new source it would reject and acknowledge.
    // New binaries expose notification rows only through this opt-in API.
    // When held notification reviews fill a whole page, the Message-only
    // reader continues behind them so SMS capture is never starved by Review.
    let includeNotifications = input.native.notificationCaptureSupported === true &&
      !!input.native.listPendingRecordsIncludingNotifications;
    // Newer binaries let the drain name the records it is holding (reviews
    // waiting for Review space, undescribable money rows) so each later page
    // reaches newer records instead of re-reading the same held page. Held
    // records are never acknowledged here; they stay queued natively.
    const pagePastHeld = includeNotifications &&
      typeof input.native.listPendingRecordsExcluding === 'function';
    const heldRecordIds = new Set<string>();
    for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex += 1) {
      const serializedPage = pagePastHeld && heldRecordIds.size > 0 && input.native.listPendingRecordsExcluding
        ? await input.native.listPendingRecordsExcluding(PAGE_SIZE, [...heldRecordIds])
        : includeNotifications && input.native.listPendingRecordsIncludingNotifications
          ? await input.native.listPendingRecordsIncludingNotifications(PAGE_SIZE)
          : await input.native.listPendingRecords(PAGE_SIZE);
      if (captureOptedOut(input.ledger)) return stopped(firstCapturedAt);
      if (serializedPage.length === 0) break;
      if (serializedPage.length > PAGE_SIZE) {
        throw sourceFreePageError('Local capture page exceeds the native limit');
      }

      // Complete, source-free preflight precedes setMarket, parser staging,
      // ledger planning, review mutation and acknowledgement.
      const now = new Date(input.now?.() ?? Date.now());
      const completePage: PageRecord[] = [];
      for (let sourceIndex = 0; sourceIndex < serializedPage.length; sourceIndex += 1) {
        const serialized = serializedPage[sourceIndex];
        const preflight = preflightLocalMessageRecord(serialized, now);
        if (!preflight) {
          throw sourceFreePageError('Local capture page contains an unreadable record');
        }
        completePage.push({ serialized, sourceIndex, preflight });
      }
      if (new Set(completePage.map((record) => record.preflight.id)).size !== completePage.length) {
        throw sourceFreePageError('Local capture page contains a duplicate record identity');
      }
      const markets = new Set(
        completePage.filter((record) => record.preflight.valid)
          .flatMap((record) => record.preflight.market ?? []),
      );
      const ledgerState = input.ledger.getState();
      const ledgerMarket = ledgerState.marketId;
      const currentMarket = ledgerMarket === 'AE' || ledgerMarket === 'SA'
        ? ledgerMarket
        : null;
      // A ledger that already holds money has a fixed currency. A market
      // whose currency conflicts can never import here, so it must neither
      // select the page ahead of a compatible market nor move marketId.
      const ledgerCurrency = storedLedgerCurrency(ledgerState);
      const conflictsWithLedger = (market: 'AE' | 'SA'): boolean =>
        ledgerCurrency !== null && MARKET_CURRENCY[market] !== ledgerCurrency;
      const validMarkets = completePage.flatMap((record) =>
        record.preflight.valid && record.preflight.market ? [record.preflight.market] : []);
      const pageMarket = currentMarket && markets.has(currentMarket) && !conflictsWithLedger(currentMarket)
        ? currentMarket
        : validMarkets.find((market) => !conflictsWithLedger(market)) ?? validMarkets[0] ?? null;
      // Only conflicting markets remain on this page. Reviews still reach the
      // tray; automatic rows and declines are acknowledged as ignored below.
      const pageCurrencyConflict = pageMarket !== null && conflictsWithLedger(pageMarket);
      const page = completePage.filter((record) =>
        !record.preflight.valid || record.preflight.market === pageMarket || record.preflight.market === null);
      for (const record of completePage) {
        if (page.includes(record)) continue;
        record.serialized = '';
        serializedPage[record.sourceIndex] = '';
      }
      const pageGeneration = readLedgerGeneration(input.ledger);

      const outcomes: LocalMessageParseOutcome[] = [];
      const session = createLaunchAlertSession({
            overrides: input.ledger.getState().merchantOverrides ?? {},
            // iOS live capture is review-only for unverified formats: nothing
            // here may be auto-added by the best-effort policy.
            bestEffort: { enabled: false, country: null },
            ...(pageMarket ? {
              activeMarket: pageMarket,
              pinnedCurrency: pageMarket === 'AE' ? 'AED' : 'SAR',
            } : {}),
          });
      const replayState = input.ledger.getState();
      const reviewPossibleReplay = createIosNotificationReplayGuard(replayState.transactions ?? [], [
        ...(replayState.reviewTray?.pending ?? []).map(item => item.sourceKey),
        ...(replayState.reviewTray?.tombstones ?? []).filter(item => item.expiresAt > now.getTime())
          .map(item => item.sourceKey),
      ]);
      for (let recordIndex = 0; recordIndex < page.length; recordIndex += 1) {
        const record = page[recordIndex];
        let serialized = record.serialized;
        let outcome: LocalMessageParseOutcome = { kind: 'invalid', milestone: 'none' };
        try {
          if (record.preflight.source === 'apple-pay') {
            // Defensive handling if a native reader ever mixes lanes: an
            // unknown/refused Wallet payload must never become invalid-ACK.
            outcome = parseLocalApplePayRecord(serialized, now);
          } else if (record.preflight.valid) {
            outcome = parseLocalMessageRecord(serialized, now, record.preflight.market, session);
          }
        } finally {
          // Clear every JavaScript-owned copy before review/import durability
          // can suspend this drain with Message content still reachable.
          serialized = '';
          record.serialized = '';
          serializedPage[record.sourceIndex] = '';
        }
        outcomes.push(outcome);
      }

      // Records whose OWN market conflicts with the stored ledger currency.
      // Converted before replay seeding, planning, and milestones: such a row
      // must not import, reconcile a decline, or prove the Message automation.
      // A money-moving row becomes a durable Review item (shown with its own
      // currency, refused at promotion) and is acknowledged only once that
      // item is retained. A decline or informational fact moves no money and
      // is acknowledged as ignored with the visible count. A record without
      // its own market is never converted.
      const currencyConflictReviewIds = new Set<string>();
      let convertedConflicts = 0;
      if (pageCurrencyConflict) {
        // A purchase with a dated reference rate is CONVERTED into the ledger
        // currency (original amount, rate, effective date and source kept on
        // the row) instead of waiting in Review for a promotion that used to
        // refuse it. Rates are looked up after the source text is gone; only
        // two currency codes and a day leave the device.
        let ledgerMoney: ReturnType<typeof migrateLegacyLedgerMoney> = null;
        try {
          ledgerMoney = migrateLegacyLedgerMoney(input.ledger.getState());
        } catch {
          ledgerMoney = null;
        }
        const quotes = new Map<string, Awaited<ReturnType<NonNullable<CoordinatorInput['fxQuote']>>>>();
        for (let index = 0; index < outcomes.length; index += 1) {
          const outcome = outcomes[index];
          if (outcome.kind !== 'parsed' || !ledgerMoney || !input.fxQuote) continue;
          const ownMarket = page[index].preflight.market;
          if (ownMarket === null || outcome.market !== ownMarket || !conflictsWithLedger(ownMarket)) continue;
          const need = currencyConflictFxNeed(outcome, ledgerMoney.currency);
          if (!need) continue;
          const key = `${need.base}|${need.quote}|${need.date}`;
          if (!quotes.has(key)) {
            if (quotes.size >= MAX_FX_LOOKUPS_PER_PAGE) continue;
            let quote = null;
            try {
              quote = await input.fxQuote(need.base, need.quote, need.date);
            } catch {
              quote = null;
            }
            quotes.set(key, quote);
            if (captureOptedOut(input.ledger)) return stopped(firstCapturedAt);
            // The ledger may have been erased, restored or re-denominated
            // while the rate was in flight. Nothing on this page may be
            // converted against a ledger other than the one it was read for.
            requireLedgerGeneration(input.ledger, pageGeneration);
            const after = input.ledger.getState();
            let afterMoney: ReturnType<typeof migrateLegacyLedgerMoney> = null;
            try {
              afterMoney = migrateLegacyLedgerMoney(after);
            } catch {
              afterMoney = null;
            }
            if (!after.hydrated || !afterMoney || afterMoney.currency !== ledgerMoney.currency ||
              afterMoney.exponent !== ledgerMoney.exponent) {
              throw sourceFreePageError('Local capture ledger changed while a rate was loading');
            }
          }
          const converted = convertCurrencyConflictRow(outcome, ledgerMoney, quotes.get(key));
          if (converted) {
            outcomes[index] = converted;
            convertedConflicts += 1;
          }
        }
        for (let index = 0; index < outcomes.length; index += 1) {
          const outcome = outcomes[index];
          if (outcome.kind !== 'parsed' && outcome.kind !== 'declined') continue;
          const ownMarket = page[index].preflight.market;
          if (ownMarket === null || outcome.market !== ownMarket || !conflictsWithLedger(ownMarket)) continue;
          if (outcome.kind === 'parsed' && ledgerMoney && outcome.row.currency === ledgerMoney.currency) continue;
          const recordId = page[index].preflight.id;
          const review = outcome.kind === 'parsed' ? currencyConflictReview(outcome, recordId) : null;
          if (review) {
            currencyConflictReviewIds.add(recordId);
            // Marked for its own bounded Review lane: it can never be posted,
            // so it must never occupy Message review space or wait natively.
            outcomes[index] = isUniversalReviewAlert(review.item)
              ? { ...review, item: { ...review.item, currencyConflict: true as const } }
              : review;
            continue;
          }
          if (outcome.kind === 'parsed' && (outcome.row.kind === 'transaction' || outcome.row.kind === 'cardPayment')) {
            // A money row that cannot be described for Review stays queued.
            outcomes[index] = { kind: 'held', market: null, milestone: 'none' };
            continue;
          }
          currencyConflictRecords.add(recordId);
          outcomes[index] = { kind: 'ignored', market: outcome.market, milestone: 'none' };
        }
      }

      // Seed every authoritative SMS before comparing notifications, regardless
      // of native queue order. Source text has already been cleared above.
      for (let index = 0; index < outcomes.length; index += 1) {
        const outcome = outcomes[index];
        if (outcome.kind === 'parsed' && outcome.row.channel !== 'push') {
          reviewPossibleReplay(outcome, page[index].preflight.id);
        }
      }
      for (let index = 0; index < outcomes.length; index += 1) {
        const outcome = outcomes[index];
        if (outcome.kind !== 'parsed' || outcome.row.channel === 'push') {
          outcomes[index] = reviewPossibleReplay(outcome, page[index].preflight.id);
        }
      }

      totals.scanned += outcomes.length;
      totals.invalid += outcomes.filter((outcome) => outcome.kind === 'invalid').length;
      totals.ignored += outcomes.filter((outcome) => outcome.kind === 'ignored').length;
      const parsed = outcomes.flatMap((outcome) =>
        outcome.kind === 'parsed' ? [outcome.row] : []);
      // A reviewable fact is not permission to select a ledger currency.
      // Align only an actual automatic-import page, after source text is gone.
      let restoreMarket: 'AE' | 'SA' | null = null;
      // A conflict page reaches here with parsed rows only when they were
      // converted into the ledger currency above; aligning the parser pack
      // then changes vocabulary only, never the ledger's money.
      if (parsed.length > 0 && pageMarket && (!pageCurrencyConflict || convertedConflicts > 0)) {
        const current = input.ledger.getState();
        if (!current.hydrated) throw sourceFreePageError('Local capture ledger is not hydrated');
        if (current.marketId !== pageMarket) {
          if (captureOptedOut(input.ledger)) return stopped(firstCapturedAt);
          if (!input.ledger.setMarket || !input.ledger.setMarket(pageMarket)) {
            throw sourceFreePageError('Local capture does not match this ledger currency');
          }
          if (input.ledger.getState().marketId !== pageMarket) {
            throw sourceFreePageError('Local capture ledger currency did not change');
          }
          requireLedgerGeneration(input.ledger, pageGeneration);
          restoreMarket = current.marketId === 'AE' || current.marketId === 'SA' ? current.marketId : null;
        }
      }
      const declineCandidates = outcomes.flatMap((outcome, index) =>
        outcome.kind === 'declined'
          ? [{
              row: { ...outcome.row, localRecordId: page[index].preflight.id },
              qualification: {
                id: page[index].preflight.id,
                kind: 'decline' as const,
                observedAt: outcome.row.smsTs,
              },
            }]
          : []);
      const declined = declineCandidates.map((candidate) => candidate.row);
      const reviewCandidates = outcomes.flatMap((outcome, index) =>
        outcome.kind === 'review' && outcome.milestone === 'review-candidate' && !isUniversalReviewAlert(outcome.item)
          ? [{
              item: outcome.item,
              qualification: {
                id: page[index].preflight.id,
                kind: 'review' as const,
                observedAt: outcome.item.observedAt,
              },
            }]
          : []);
      const allUnqualifiedReviews = outcomes.flatMap((outcome) =>
        outcome.kind === 'review' && (outcome.milestone !== 'review-candidate' || isUniversalReviewAlert(outcome.item))
          ? [outcome.item] : []);
      // Legacy-lane admission evicts the oldest review once fifty are pending.
      // This caller can leave its record queued, so refuse instead of evicting
      // an already acknowledged review; the deferred record stays native.
      const { deferred: capacityDeferred } = partitionReviewsByCapacity(
        input.ledger.getState().reviewTray ?? emptyAlertReviewTray(),
        [...reviewCandidates.map((candidate) => candidate.item), ...allUnqualifiedReviews],
        now.getTime(),
      );
      const capacityDeferredItems = new Set(capacityDeferred);
      const capacityDeferredIds = new Set(outcomes.flatMap((outcome, index) =>
        outcome.kind === 'review' && capacityDeferredItems.has(outcome.item)
          ? [page[index].preflight.id] : []));
      const reviews = reviewCandidates
        .filter((candidate) => !capacityDeferredItems.has(candidate.item))
        .map((candidate) => candidate.item);
      const unqualifiedReviews = allUnqualifiedReviews.filter((item) => !capacityDeferredItems.has(item));
      const reviewQualifications: LocalCaptureReviewQualificationCandidate[] =
        reviewCandidates.filter((candidate) => !capacityDeferredItems.has(candidate.item)).map((candidate) => ({
          reviewId: candidate.item.id,
          qualification: candidate.qualification,
        }));
      const allReviewQualifications = reviewCandidates.map((candidate) => candidate.qualification);
      const allDeclineQualifications = declineCandidates.map((candidate) => candidate.qualification);
      uniqueQualificationCandidates(allReviewQualifications);
      uniqueQualificationCandidates(allDeclineQualifications);

      let admittedReviews = 0;
      let admittedReviewIds: string[] = [];
      if (reviews.length > 0) {
        if (!input.ledger.stageReviewAlerts) {
          throw sourceFreePageError('Local capture requires review staging');
        }
        if (captureOptedOut(input.ledger)) return stopped(firstCapturedAt);
        const reviewReceipt = input.ledger.stageReviewAlerts(reviews, reviewQualifications);
        await reviewReceipt.durable;
        if (captureOptedOut(input.ledger)) return stopped(firstCapturedAt);
        requireLedgerGeneration(input.ledger, pageGeneration);
        if (!Number.isInteger(reviewReceipt.admitted) || reviewReceipt.admitted < 0 ||
          reviewReceipt.admitted > reviews.length) {
          throw sourceFreePageError('Local capture review receipt was refused');
        }
        admittedReviews = reviewReceipt.admitted;
        admittedReviewIds = exactQualificationIds(
          reviewReceipt.qualificationIds,
          allReviewQualifications,
          admittedReviews,
          'review',
        );
      }
      if (unqualifiedReviews.length > 0) {
        if (!input.ledger.stageReviewAlerts) throw sourceFreePageError('Local capture requires review staging');
        if (captureOptedOut(input.ledger)) return stopped(firstCapturedAt);
        // Generic review can be useful without proving a known-bank automation.
        // It receives no qualification mapping and cannot set firstCapturedAt.
        const receipt = input.ledger.stageReviewAlerts(unqualifiedReviews);
        await receipt.durable;
        if (captureOptedOut(input.ledger)) return stopped(firstCapturedAt);
        requireLedgerGeneration(input.ledger, pageGeneration);
        if (!Number.isInteger(receipt.admitted) || receipt.admitted < 0 ||
          receipt.admitted > unqualifiedReviews.length) throw sourceFreePageError('Local capture review receipt was refused');
        admittedReviews += receipt.admitted;
      }

      // Review staging is the final await before this state read. Planning must
      // always see the latest aligned ledger rather than the alignment snapshot.
      const stateAtPlan = input.ledger.getState();
      if (!stateAtPlan.hydrated || (parsed.length > 0 && pageMarket && stateAtPlan.marketId !== pageMarket)) {
        throw sourceFreePageError('Local capture ledger changed before planning');
      }
      const priorReviewIds = persistedQualificationIds(
        stateAtPlan,
        allReviewQualifications,
        now.getTime(),
      );
      const priorDeclineIds = persistedQualificationIds(
        stateAtPlan,
        allDeclineQualifications,
        now.getTime(),
      );
      let plan: ImportPlan;
      let reconciledDeclineMappings: LocalCaptureDeclineQualificationMapping[];
      try {
        plan = buildImportPlan(
          parsed,
          stateAtPlan,
          stateAtPlan.lastScanTs,
          now,
          declined,
        );
        if (!Number.isInteger(plan.declineReconciledCount) ||
          plan.declineReconciledCount < 0 ||
          plan.declineReconciledCount > declined.length) {
          throw sourceFreePageError('Local capture decline receipt was refused');
        }
        const reconciledDeclineIds = exactQualificationIds(
          plan.declineReconciledIds,
          allDeclineQualifications,
          plan.declineReconciledCount,
          'decline',
        );
        reconciledDeclineMappings = exactDeclineQualificationMappings(
          plan.declineReconciliations,
          allDeclineQualifications,
          reconciledDeclineIds,
          stateAtPlan,
          plan,
        );
      } catch (error) {
        // Nothing on this page was imported or acknowledged. Do not leave a
        // market switch behind that the next page would treat as settled.
        if (restoreMarket && input.ledger.setMarket &&
          input.ledger.getState().marketId === pageMarket) {
          input.ledger.setMarket(restoreMarket);
        }
        throw error;
      }
      const reconciledDeclineQualifications = reconciledDeclineMappings.map(
        (mapping) => mapping.qualification,
      );

      // Messages withheld as possible Apple Pay duplicates. Their Review items
      // are staged in this same synchronous turn as the import below, and each
      // record is acknowledged only once its item is retained. A Review lane
      // that cannot hold one without evicting money keeps the record queued.
      const nearMatchSettlement = settleWalletNearMatches(
        plan, input.ledger.getState().reviewTray, now.getTime(), 'defer');
      const nearMatchRecords = (plan.walletNearMatches ?? []).map((match) => {
        const index = outcomes.findIndex((outcome) => outcome.kind === 'parsed' && outcome.row === match.row);
        if (index < 0) throw sourceFreePageError('Local capture Apple Pay review lost its record');
        return { id: page[index].preflight.id, review: match.review,
          deferred: nearMatchSettlement.deferred.includes(match) };
      });
      let nearMatchReceipt: { admitted: number; durable: Promise<void> } | null = null;
      if (nearMatchSettlement.reviews.length > 0) {
        if (!input.ledger.stageReviewAlerts) throw sourceFreePageError('Local capture requires review staging');
        if (captureOptedOut(input.ledger)) return stopped(firstCapturedAt);
        nearMatchReceipt = input.ledger.stageReviewAlerts(nearMatchSettlement.reviews);
      }

      let imported = 0;
      let importedDeclineIds: string[] = [];
      if (planHasChanges(plan)) {
        if (captureOptedOut(input.ledger)) return stopped(firstCapturedAt);
        const importReceipt = input.ledger.importBatch(
          plan.batch,
          reconciledDeclineMappings,
        );
        await importReceipt.durable;
        if (captureOptedOut(input.ledger)) return stopped(firstCapturedAt);
        requireLedgerGeneration(input.ledger, pageGeneration);
        imported = importReceipt.ids.length;
        importedDeclineIds = exactQualificationIds(
          importReceipt.qualificationIds ?? [],
          reconciledDeclineQualifications,
          reconciledDeclineQualifications.length,
          'decline',
        );
        if (parsed.length > 0 && imported === 0) {
          if (captureOptedOut(input.ledger)) return stopped(firstCapturedAt);
          await input.ledger.ensureDurable();
          if (captureOptedOut(input.ledger)) return stopped(firstCapturedAt);
          requireLedgerGeneration(input.ledger, pageGeneration);
        }
      } else if (!outcomes.every((outcome, index) =>
        outcome.kind === 'held' || capacityDeferredIds.has(page[index].preflight.id))) {
        // This is load-bearing for ignored/invalid pages and semantic-only
        // duplicates: ACK still waits behind a real encrypted-ledger barrier.
        // A page whose every record stays held changes nothing and ACKs
        // nothing, so it skips the write while the reader pages past it.
        if (captureOptedOut(input.ledger)) return stopped(firstCapturedAt);
        await input.ledger.ensureDurable();
        if (captureOptedOut(input.ledger)) return stopped(firstCapturedAt);
        requireLedgerGeneration(input.ledger, pageGeneration);
      }

      if (nearMatchReceipt) {
        await nearMatchReceipt.durable;
        if (captureOptedOut(input.ledger)) return stopped(firstCapturedAt);
        requireLedgerGeneration(input.ledger, pageGeneration);
        if (!Number.isInteger(nearMatchReceipt.admitted) || nearMatchReceipt.admitted < 0 ||
          nearMatchReceipt.admitted > nearMatchSettlement.reviews.length) {
          throw sourceFreePageError('Local capture review receipt was refused');
        }
        totals.reviews += nearMatchReceipt.admitted;
      }

      totals.imported += imported;
      totals.reviews += admittedReviews;
      totals.declined += plan.declineReconciledCount;
      totals.ignored += Math.max(0, reviews.length + unqualifiedReviews.length - admittedReviews) +
        Math.max(0, declined.length - plan.declineReconciledCount);

      const qualifyingReviewIds = new Set([...priorReviewIds, ...admittedReviewIds]);
      const qualifyingDeclineIds = new Set([...priorDeclineIds, ...importedDeclineIds]);
      // Notification delivery cannot prove the Message automation or retire
      // its older relay. Keep the existing milestone exclusively for SMS.
      const messageOutcomes = outcomes.filter(outcome =>
        outcome.kind === 'parsed' || outcome.kind === 'declined' ? outcome.row.channel !== 'push'
          : outcome.kind === 'review' ? outcome.item.channel !== 'push' : false);
      const messageIds = new Set(outcomes.flatMap((outcome, index) =>
        messageOutcomes.includes(outcome) ? [page[index].preflight.id] : []));
      const qualifying = [
        earliestObservedAt(messageOutcomes, 'parsed'),
        earliestQualification(allReviewQualifications.filter(value => messageIds.has(value.id)), qualifyingReviewIds),
        earliestQualification(allDeclineQualifications.filter(value => messageIds.has(value.id)), qualifyingDeclineIds),
      ].filter((value): value is number => value !== null);
      if (qualifying.length > 0) {
        const observedAt = Math.min(...qualifying);
        if (firstCapturedAt === null || observedAt < firstCapturedAt) {
          if (captureOptedOut(input.ledger)) return stopped(firstCapturedAt);
          await input.native.recordFirstCapturedAt(observedAt);
          if (captureOptedOut(input.ledger)) return stopped(firstCapturedAt);
          requireLedgerGeneration(input.ledger, pageGeneration);
          firstCapturedAt = observedAt;
        }
      }

      // Use the immutable page snapshot, never a fresh list, so an App Intent
      // append that raced this page cannot be removed by its acknowledgement.
      requireLedgerGeneration(input.ledger, pageGeneration);
      if (captureOptedOut(input.ledger)) return stopped(firstCapturedAt);
      const reviewTray = input.ledger.getState().reviewTray;
      const deferredReviewIds = new Set(outcomes.flatMap((outcome, index) => {
        if (outcome.kind === 'held') return [page[index].preflight.id];
        if (capacityDeferredIds.has(page[index].preflight.id)) return [page[index].preflight.id];
        if (outcome.kind !== 'review') return [];
        // Notification reviews and currency-conflict money rows are ACKed only
        // behind their retained Review item (pending or a live tombstone).
        if (outcome.item.channel !== 'push' &&
          !currencyConflictReviewIds.has(page[index].preflight.id)) return [];
        const item = outcome.item;
        const retained = reviewTray?.pending?.some(entry => entry.sourceKey === item.sourceKey && entry.observedAt === item.observedAt) ||
          reviewTray?.tombstones?.some(entry => entry.sourceKey === item.sourceKey && entry.expiresAt > now.getTime());
        return retained ? [] : [page[index].preflight.id];
      }));
      for (const record of nearMatchRecords) {
        if (record.deferred ||
          !walletNearMatchesRetained(reviewTray, [record.review], now.getTime())) {
          deferredReviewIds.add(record.id);
          deferredReviewRecords.add(record.id);
        }
      }
      const acknowledgedIds = page.map(record => record.preflight.id).filter(id => !deferredReviewIds.has(id));
      if (acknowledgedIds.length > 0) await input.native.acknowledgeRecords(acknowledgedIds);
      if (captureOptedOut(input.ledger)) return stopped(firstCapturedAt);
      if (deferredReviewIds.size > 0) {
        // Staged-but-refused reviews were counted as ignored above; reviews
        // deferred before staging never were.
        const stagedDeferred = outcomes.filter((outcome, index) =>
          outcome.kind === 'review' && deferredReviewIds.has(page[index].preflight.id) &&
          !capacityDeferredIds.has(page[index].preflight.id)).length;
        totals.ignored = Math.max(0, totals.ignored - stagedDeferred);
        outcomes.forEach((outcome, index) => {
          if (outcome.kind === 'review' && deferredReviewIds.has(page[index].preflight.id)) {
            deferredReviewRecords.add(page[index].preflight.id);
          }
        });
        for (const id of deferredReviewIds) heldRecordIds.add(id);
        if (pagePastHeld) {
          // The next page names every held record and reaches newer ones.
          if (heldRecordIds.size + PAGE_SIZE > MAX_EXCLUDED_RECORDS) break;
        } else if (acknowledgedIds.length === 0) {
          // Older binary: held records fill this whole page. Continue behind
          // notification rows with the Message-only reader; if Messages
          // themselves wait for Review space, stop and give Wallet its turn.
          if (!includeNotifications) break;
          includeNotifications = false;
        }
      }
      if (pageIndex + 1 < MAX_PAGES) await yieldBetweenPages();
      if (captureOptedOut(input.ledger)) return stopped(firstCapturedAt);
    }

    if (deferredReviewRecords.size > 0) totals.deferredReviews = deferredReviewRecords.size;
    if (currencyConflictRecords.size > 0) totals.currencyConflicts = currencyConflictRecords.size;
    if (input.native.applePayCaptureSupported === true && input.native.listPendingApplePayRecords) {
      const heldIds = new Set<string>();
      const waitingReviewIds = new Set<string>();
      const seenIds = new Set<string>();
      let unreadableHeld = 0;
      for (let pageIndex = 0; pageIndex < MAX_APPLE_PAY_PAGES; pageIndex += 1) {
        if (captureOptedOut(input.ledger)) return stopped(firstCapturedAt);
        const generation = readLedgerGeneration(input.ledger);
        const serializedPage = await input.native.listPendingApplePayRecords(PAGE_SIZE);
        if (captureOptedOut(input.ledger)) return stopped(firstCapturedAt);
        requireLedgerGeneration(input.ledger, generation);
        if (serializedPage.length === 0) break;
        if (serializedPage.length > PAGE_SIZE) throw sourceFreePageError('Apple Pay page exceeds the native limit');
        const now = new Date(input.now?.() ?? Date.now());
        const page: { id: string | null; outcome: LocalApplePayParseOutcome }[] = [];
        for (let index = 0; index < serializedPage.length; index += 1) {
          let serialized = serializedPage[index];
          try {
            const preflight = preflightLocalMessageRecord(serialized, now);
            page.push({ id: preflight?.id ?? null, outcome: parseLocalApplePayRecord(serialized, now) });
          } finally {
            serialized = '';
            serializedPage[index] = '';
          }
        }
        const pageIds = page.flatMap(record => record.id ? [record.id] : []);
        if (new Set(pageIds).size !== pageIds.length) throw sourceFreePageError('Apple Pay page contains a duplicate record identity');
        const unreadable = page.filter(record => record.id === null).length;
        totals.scanned += Math.max(0, unreadable - unreadableHeld);
        unreadableHeld = unreadable;
        for (const id of pageIds) {
          if (!seenIds.has(id)) totals.scanned += 1;
          seenIds.add(id);
        }
        const reviews = page.flatMap(record => record.outcome.kind === 'review' ? [record.outcome.item] : []);
        if (!input.ledger.getState().hydrated) throw sourceFreePageError('Apple Pay ledger is not hydrated');
        if (reviews.length > 0) {
          if (!input.ledger.stageReviewAlerts) throw sourceFreePageError('Apple Pay requires review staging');
          if (captureOptedOut(input.ledger)) return stopped(firstCapturedAt);
          const receipt = input.ledger.stageReviewAlerts(reviews);
          await receipt.durable;
          if (captureOptedOut(input.ledger)) return stopped(firstCapturedAt);
          requireLedgerGeneration(input.ledger, generation);
          if (!Number.isInteger(receipt.admitted) || receipt.admitted < 0 || receipt.admitted > reviews.length) {
            throw sourceFreePageError('Apple Pay review receipt was refused');
          }
          totals.reviews += receipt.admitted;
        }
        // Also protect duplicate/tombstoned receipts with a durable barrier.
        // No financial planner, market selector or SMS milestone runs here.
        await input.ledger.ensureDurable();
        if (captureOptedOut(input.ledger)) return stopped(firstCapturedAt);
        requireLedgerGeneration(input.ledger, generation);
        const state = input.ledger.getState();
        const ack: string[] = [];
        for (const record of page) {
          if (!record.id) continue;
          const item = record.outcome.kind === 'review' ? record.outcome.item : null;
          const retained = item && (
            state.reviewTray?.pending.some(entry => entry.id === item.id && entry.sourceKey === item.sourceKey && entry.observedAt === item.observedAt) ||
            state.reviewTray?.tombstones.some(entry => entry.sourceKey === item.sourceKey && entry.expiresAt > now.getTime())
          );
          if (retained) { ack.push(record.id); heldIds.delete(record.id); waitingReviewIds.delete(record.id); }
          else {
            heldIds.add(record.id);
            if (item) waitingReviewIds.add(record.id);
          }
        }
        totals.deferredApplePay = heldIds.size + unreadableHeld;
        if (waitingReviewIds.size > 0) totals.deferredApplePayReviews = waitingReviewIds.size;
        else delete totals.deferredApplePayReviews;
        if (ack.length === 0) break;
        if (captureOptedOut(input.ledger)) return stopped(firstCapturedAt);
        requireLedgerGeneration(input.ledger, generation);
        await input.native.acknowledgeRecords(ack);
        if (pageIndex + 1 < MAX_APPLE_PAY_PAGES) await yieldBetweenPages();
      }
    }

    if (captureOptedOut(input.ledger)) return stopped(firstCapturedAt);
    // Presentation only: the records themselves remain in the native queue.
    reviewCaptureBacklog.publish({
      waiting: (totals.deferredReviews ?? 0) + (totals.deferredApplePayReviews ?? 0),
      currencyConflicts: totals.currencyConflicts ?? 0,
    });
    const retirement = await retryRetirementIfNeeded();
    return { ...totals, firstCapturedAt, retirement };
  };

  const drain = (): Promise<IosLocalCaptureOutcome> => {
    if (instanceInFlight) return instanceInFlight;
    const predecessor = drainQueueTail;
    const pending = predecessor.then(performDrain);
    instanceInFlight = pending;
    drainQueueTail = pending.then(
      () => undefined,
      () => undefined,
    );
    void pending.then(
      () => {
        if (instanceInFlight === pending) instanceInFlight = null;
      },
      () => {
        if (instanceInFlight === pending) instanceInFlight = null;
      },
    );
    return pending;
  };

  return { drain, retryRetirementIfNeeded };
}

/**
 * One coordinator per authoritative Store ledger adapter. Multiple mounted
 * surfaces build lightweight adapter objects, but their stable method
 * identities name the same ledger and must join both drains and retirement.
 */
export function getSharedIosLocalCaptureCoordinator(
  input: CoordinatorInput,
): IosLocalCaptureCoordinator {
  const existing = sharedCoordinators.get(input.ledger.getState);
  if (existing && existing.input.native === input.native &&
    existing.input.retireShortcutCapture === input.retireShortcutCapture &&
    sameLedgerAdapter(existing.input.ledger, input.ledger)) {
    return existing.coordinator;
  }
  const coordinator = createIosLocalCaptureCoordinator(input);
  sharedCoordinators.set(input.ledger.getState, { input, coordinator });
  return coordinator;
}
