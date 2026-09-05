import type { CategoryId } from '@/lib/types';
import { REVIEW_ALERT_CAP, type ReviewEntry } from '@/lib/alert-review-tray';
import { createLaunchAlertSession } from '@/lib/launch-alert-parser';
import { MAX_HISTORICAL_RECORDS, parseHistoricalMessageRecords } from '@/lib/historical-import';
import type { DeclinedSms, ScannedSms } from '@/lib/import-plan';
import type { CompletedHistorySession, WafraHistoryNativeModule } from '../../modules/wafra-message-history/src/WafraMessageHistory.types';
const SESSION_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;
const MAX_CHUNK_RECORDS = 50;
const MAX_SESSION_CHUNKS = Math.ceil(MAX_HISTORICAL_RECORDS / MAX_CHUNK_RECORDS);
export type IosHistoryImportErrorCode =
  | 'invalid-session'
  | 'session-unavailable'
  | 'invalid-descriptor'
  | 'invalid-chunk'
  | 'record-mismatch'
  | 'duplicate-record'
  | 'record-count-mismatch'
  | 'cancelled'
  | 'native-failure'
  | 'cleanup-failed';

const ERROR_MESSAGES: Record<IosHistoryImportErrorCode, string> = {
  'invalid-session': 'The history session identifier is invalid.',
  'session-unavailable': 'The completed history session is unavailable.',
  'invalid-descriptor': 'The completed history session is inconsistent.',
  'invalid-chunk': 'A history session chunk is invalid.',
  'record-mismatch': 'The history session records are inconsistent.',
  'duplicate-record': 'The history session contains a duplicate record.',
  'record-count-mismatch': 'The history session record count is inconsistent.',
  cancelled: 'The history import was cancelled.',
  'native-failure': 'The history session could not be loaded.',
  'cleanup-failed': 'The history session could not be discarded.',
};

export class IosHistoryImportError extends Error {
  readonly code: IosHistoryImportErrorCode;

  constructor(code: IosHistoryImportErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'IosHistoryImportError';
    this.code = code;
  }
}

export interface IosHistoryImportSummary {
  found: number;
  attempted: number;
  accepted: number;
  skipped: number;
  parsed: number;
  reviewed: number;
  declined: number;
  ignored: number;
  duplicates: number;
}

export interface LoadedIosHistorySession {
  sessionId: string;
  summary: IosHistoryImportSummary;
  parsed: ScannedSms[];
  reviewCandidates: ReviewEntry[];
  declined: DeclinedSms[];
}

export interface IosHistoryReviewStageReceipt {
  admitted: number;
  durable: Promise<void>;
}

/** Persist source-free review rows before their protected Message source can be discarded. */
export async function persistIosHistoryReviewCandidates(
  items: ReviewEntry[],
  stage: (items: ReviewEntry[]) => IosHistoryReviewStageReceipt,
): Promise<number> {
  if (items.length === 0) return 0;
  const receipt = stage(items);
  if (!Number.isSafeInteger(receipt.admitted) ||
    receipt.admitted < 0 || receipt.admitted > items.length ||
    !(receipt.durable instanceof Promise)) {
    throw new IosHistoryImportError('native-failure');
  }
  await receipt.durable;
  return receipt.admitted;
}

const isNonNegativeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

const validateSessionId = (sessionId: string): void => {
  if (!SESSION_ID_RE.test(sessionId)) {
    throw new IosHistoryImportError('invalid-session');
  }
};

const validateDescriptor = (
  descriptor: CompletedHistorySession,
): CompletedHistorySession => {
  const counts = [
    descriptor.found,
    descriptor.attempted,
    descriptor.accepted,
    descriptor.skipped,
  ];
  if (counts.some((count) => !isNonNegativeInteger(count))) {
    throw new IosHistoryImportError('invalid-descriptor');
  }
  if (
    descriptor.found !== descriptor.attempted ||
    descriptor.found > MAX_HISTORICAL_RECORDS ||
    descriptor.attempted > MAX_HISTORICAL_RECORDS ||
    descriptor.accepted > MAX_HISTORICAL_RECORDS ||
    !Number.isSafeInteger(descriptor.accepted + descriptor.skipped) ||
    descriptor.accepted + descriptor.skipped !== descriptor.attempted
  ) {
    throw new IosHistoryImportError('invalid-descriptor');
  }
  if (
    !Array.isArray(descriptor.chunkIndices) ||
    descriptor.chunkIndices.length > MAX_SESSION_CHUNKS ||
    (descriptor.found === 0 && descriptor.chunkIndices.length !== 0) ||
    !descriptor.chunkIndices.every((value, index) => value === index)
  ) {
    throw new IosHistoryImportError('invalid-descriptor');
  }
  return descriptor;
};

const coordinatorFailure = (error: unknown): IosHistoryImportError => {
  if (error instanceof IosHistoryImportError) return error;
  if (
    error !== null &&
    typeof error === 'object' &&
    'name' in error &&
    error.name === 'AbortError'
  ) {
    return new IosHistoryImportError('cancelled');
  }
  return new IosHistoryImportError('native-failure');
};

const failureRequiresDiscard = (failure: IosHistoryImportError): boolean => [
  'session-unavailable',
  'invalid-descriptor',
  'invalid-chunk',
  'record-mismatch',
  'duplicate-record',
  'record-count-mismatch',
].includes(failure.code);

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export async function discardIosHistorySession(
  native: WafraHistoryNativeModule,
  sessionId: string,
): Promise<void> {
  validateSessionId(sessionId);
  try {
    await native.discardSession(sessionId);
  } catch {
    throw new IosHistoryImportError('cleanup-failed');
  }
}

export async function loadIosHistorySession(input: {
  sessionId: string;
  native: WafraHistoryNativeModule;
  overrides: Record<string, CategoryId>;
  onProgress?: (value: { scanned: number; matched: number }) => void;
  now?: Date;
}): Promise<LoadedIosHistorySession> {
  validateSessionId(input.sessionId);

  try {
    await input.native.purgeExpired();
    const completed = await input.native.getCompletedSession(input.sessionId);
    if (!completed) throw new IosHistoryImportError('session-unavailable');
    const descriptor = validateDescriptor(completed);
    const now = input.now ?? new Date();
    const seen = new Set<string>();
    const launchSession = createLaunchAlertSession({ overrides: input.overrides });
    const parsed: ScannedSms[] = [];
    const reviewCandidates: ReviewEntry[] = [];
    const declined: DeclinedSms[] = [];
    let readRecords = 0;
    let ignored = 0;

    for (let offset = 0; offset < descriptor.chunkIndices.length; offset += 1) {
      const chunkIndex = descriptor.chunkIndices[offset];
      const records = await input.native.readChunk(input.sessionId, chunkIndex);
      if (!Array.isArray(records) || records.length > MAX_CHUNK_RECORDS) {
        throw new IosHistoryImportError('invalid-chunk');
      }
      const part = parseHistoricalMessageRecords(
        records,
        input.overrides,
        now,
        seen,
        launchSession,
      );
      if (part.duplicateCount > 0) {
        throw new IosHistoryImportError('duplicate-record');
      }
      if (part.invalidCount > 0) {
        throw new IosHistoryImportError('record-mismatch');
      }
      readRecords += records.length;
      parsed.push(...part.parsed);
      reviewCandidates.push(...part.reviewCandidates);
      declined.push(...part.declined);
      ignored += part.ignoredCount;
      input.onProgress?.({
        scanned: readRecords,
        matched: parsed.length + reviewCandidates.length,
      });
      if (offset + 1 < descriptor.chunkIndices.length) await yieldToEventLoop();
    }

    if (readRecords !== descriptor.accepted) {
      throw new IosHistoryImportError('record-count-mismatch');
    }
    parsed.sort((left, right) => (left.smsTs ?? 0) - (right.smsTs ?? 0));
    reviewCandidates.sort((left, right) => left.observedAt - right.observedAt);
    if (reviewCandidates.length > REVIEW_ALERT_CAP) {
      reviewCandidates.splice(0, reviewCandidates.length - REVIEW_ALERT_CAP);
    }
    declined.sort((left, right) => left.smsTs - right.smsTs);
    return {
      sessionId: input.sessionId,
      summary: {
        // V2 may stage overlapping newest/oldest references deliberately.
        // Native normalization removes exact GUID duplicates before this
        // coordinator reads chunks, so `accepted` is the distinct readable
        // Message count users actually had checked. `attempted`/`skipped`
        // remain available for integrity diagnostics without inflating UX.
        found: descriptor.accepted,
        attempted: descriptor.attempted,
        accepted: descriptor.accepted,
        skipped: descriptor.skipped,
        parsed: parsed.length,
        reviewed: reviewCandidates.length,
        declined: declined.length,
        ignored,
        duplicates: 0,
      },
      parsed,
      reviewCandidates,
      declined,
    };
  } catch (error) {
    const failure = coordinatorFailure(error);
    // A bridge/I/O interruption or UI cancellation does not prove the
    // protected source is corrupt. Keep it available for retry; explicit user
    // cancellation still calls discardIosHistorySession. Only integrity and
    // reconciliation failures tombstone the session here.
    if (!failureRequiresDiscard(failure)) throw failure;
    try {
      await input.native.discardSession(input.sessionId);
    } catch {
      throw new IosHistoryImportError('cleanup-failed');
    }
    throw failure;
  }
}
