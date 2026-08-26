import type { WafraLiveCaptureNativeModule } from '../../modules/wafra-live-capture';

import type { CaptureLedgerAdapter } from '@/lib/capture-executor';
import { buildImportPlan, type ImportPlan } from '@/lib/import-plan';
import { createLaunchAlertSession } from '@/lib/launch-alert-parser';
import {
  parseLocalMessageRecord,
  preflightLocalMessageRecord,
  type LocalMessageParseOutcome,
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

export interface IosLocalCaptureOutcome {
  scanned: number;
  imported: number;
  reviews: number;
  declined: number;
  ignored: number;
  invalid: number;
  firstCapturedAt: number | null;
  retirement: 'not-needed' | 'complete' | 'retry-needed';
}

export interface IosLocalCaptureCoordinator {
  drain(): Promise<IosLocalCaptureOutcome>;
  retryRetirementIfNeeded(): Promise<'not-needed' | 'complete' | 'retry-needed'>;
}

interface CoordinatorInput {
  native: WafraLiveCaptureNativeModule;
  ledger: CaptureLedgerAdapter;
  retireShortcutCapture: () => Promise<'not-needed' | 'complete'>;
}

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
      if (status.firstCapturedAt === null) return 'not-needed';
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
    let firstCapturedAt = initialStatus.firstCapturedAt;
    if (captureOptedOut(input.ledger)) return stopped(firstCapturedAt);

    for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex += 1) {
      const serializedPage = await input.native.listPendingRecords(PAGE_SIZE);
      if (captureOptedOut(input.ledger)) return stopped(firstCapturedAt);
      if (serializedPage.length === 0) break;
      if (serializedPage.length > PAGE_SIZE) {
        throw sourceFreePageError('Local capture page exceeds the native limit');
      }

      // Complete, source-free preflight precedes setMarket, parser staging,
      // ledger planning, review mutation and acknowledgement.
      const now = new Date();
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
          .flatMap((record) => record.preflight.attribution?.market ?? []),
      );
      const ledgerMarket = input.ledger.getState().marketId;
      const currentMarket = ledgerMarket === 'AE' || ledgerMarket === 'SA'
        ? ledgerMarket
        : null;
      const pageMarket = markets.size === 0
        ? null
        : currentMarket && markets.has(currentMarket)
          ? currentMarket
          : completePage.find((record) =>
              record.preflight.valid && record.preflight.attribution?.market)?.preflight
              .attribution?.market ?? null;
      const page = completePage.filter((record) =>
        !record.preflight.valid || !record.preflight.attribution?.market ||
          record.preflight.attribution.market === pageMarket);
      for (const record of completePage) {
        if (page.includes(record)) continue;
        record.serialized = '';
        serializedPage[record.sourceIndex] = '';
      }
      const pageGeneration = readLedgerGeneration(input.ledger);

      if (pageMarket) {
        const current = input.ledger.getState();
        if (!current.hydrated) {
          throw sourceFreePageError('Local capture ledger is not hydrated');
        }
        if (current.marketId !== pageMarket) {
          if (captureOptedOut(input.ledger)) return stopped(firstCapturedAt);
          if (!input.ledger.setMarket || !input.ledger.setMarket(pageMarket)) {
            throw sourceFreePageError('Local capture does not match this ledger currency');
          }
          if (input.ledger.getState().marketId !== pageMarket) {
            throw sourceFreePageError('Local capture ledger currency did not change');
          }
          requireLedgerGeneration(input.ledger, pageGeneration);
        }
      }

      const outcomes: LocalMessageParseOutcome[] = [];
      const session = pageMarket
        ? createLaunchAlertSession({
            overrides: input.ledger.getState().merchantOverrides ?? {},
            activeMarket: pageMarket,
            pinnedCurrency: pageMarket === 'AE' ? 'AED' : 'SAR',
          })
        : null;
      for (let recordIndex = 0; recordIndex < page.length; recordIndex += 1) {
        const record = page[recordIndex];
        let serialized = record.serialized;
        let outcome: LocalMessageParseOutcome = { kind: 'invalid', milestone: 'none' };
        try {
          if (session && pageMarket && record.preflight.valid) {
            outcome = parseLocalMessageRecord(serialized, now, pageMarket, session);
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

      totals.scanned += outcomes.length;
      totals.invalid += outcomes.filter((outcome) => outcome.kind === 'invalid').length;
      totals.ignored += outcomes.filter((outcome) => outcome.kind === 'ignored').length;
      const parsed = outcomes.flatMap((outcome) =>
        outcome.kind === 'parsed' ? [outcome.row] : []);
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
        outcome.kind === 'review'
          ? [{
              item: outcome.item,
              qualification: {
                id: page[index].preflight.id,
                kind: 'review' as const,
                observedAt: outcome.item.observedAt,
              },
            }]
          : []);
      const reviews = reviewCandidates.map((candidate) => candidate.item);
      const reviewQualifications: LocalCaptureReviewQualificationCandidate[] =
        reviewCandidates.map((candidate) => ({
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

      // Review staging is the final await before this state read. Planning must
      // always see the latest aligned ledger rather than the alignment snapshot.
      const stateAtPlan = input.ledger.getState();
      if (!stateAtPlan.hydrated || (pageMarket && stateAtPlan.marketId !== pageMarket)) {
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
      const plan = buildImportPlan(
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
      const reconciledDeclineMappings = exactDeclineQualificationMappings(
        plan.declineReconciliations,
        allDeclineQualifications,
        reconciledDeclineIds,
        stateAtPlan,
        plan,
      );
      const reconciledDeclineQualifications = reconciledDeclineMappings.map(
        (mapping) => mapping.qualification,
      );

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
      } else {
        // This is load-bearing for ignored/invalid pages and semantic-only
        // duplicates: ACK still waits behind a real encrypted-ledger barrier.
        if (captureOptedOut(input.ledger)) return stopped(firstCapturedAt);
        await input.ledger.ensureDurable();
        if (captureOptedOut(input.ledger)) return stopped(firstCapturedAt);
        requireLedgerGeneration(input.ledger, pageGeneration);
      }

      totals.imported += imported;
      totals.reviews += admittedReviews;
      totals.declined += plan.declineReconciledCount;
      totals.ignored += Math.max(0, reviews.length - admittedReviews) +
        Math.max(0, declined.length - plan.declineReconciledCount);

      const qualifyingReviewIds = new Set([...priorReviewIds, ...admittedReviewIds]);
      const qualifyingDeclineIds = new Set([...priorDeclineIds, ...importedDeclineIds]);
      const qualifying = [
        earliestObservedAt(outcomes, 'parsed'),
        earliestQualification(allReviewQualifications, qualifyingReviewIds),
        earliestQualification(allDeclineQualifications, qualifyingDeclineIds),
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
      await input.native.acknowledgeRecords(page.map((record) => record.preflight.id));
      if (captureOptedOut(input.ledger)) return stopped(firstCapturedAt);
      if (pageIndex + 1 < MAX_PAGES) await yieldBetweenPages();
      if (captureOptedOut(input.ledger)) return stopped(firstCapturedAt);
    }

    if (captureOptedOut(input.ledger)) return stopped(firstCapturedAt);
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
