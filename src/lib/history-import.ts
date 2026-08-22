/** Durable, body-free progress for Android's first inbox history import. */
export type HistoryImportStatus = 'paused' | 'running' | 'failed' | 'complete';
export type HistoryImportError = 'page-failed' | 'inbox-access';

export interface HistoryImportCursor {
  beforeDateMs: number;
  beforeId: number;
}

export interface HistoryImportProgress {
  status: HistoryImportStatus;
  cursor: HistoryImportCursor | null;
  scanned: number;
  found: number;
  startedAt: number;
  updatedAt: number;
  error: HistoryImportError | null;
}

export interface HistoryImportPage {
  scanned: number;
  found: number;
  complete: boolean;
  nextCursor: HistoryImportCursor | null;
}

export interface HistoryImportCoordinatorDependencies<Page extends HistoryImportPage> {
  getProgress(): HistoryImportProgress | null;
  /** Changes only when restore/erase/hydration replaces the whole ledger. */
  getGeneration?(): number;
  shouldContinue(): boolean;
  now(): number;
  scanPage(cursor: HistoryImportCursor | null): Promise<Page>;
  /** Persist the page's ledger changes and `next` in one durable snapshot. */
  commitPage(
    page: Page,
    next: HistoryImportProgress,
    canCommit: () => boolean,
  ): Promise<void | boolean>;
  /** Status-only transition; never advances a provider cursor. */
  persistProgress(next: HistoryImportProgress): Promise<void>;
  classifyError?(error: unknown): HistoryImportError;
}

export interface HistoryImportCoordinator {
  /** Concurrent callers join the same operation. */
  run(): Promise<HistoryImportProgress | null>;
}

const finiteNonNegativeInteger = (value: unknown): number | null =>
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;

const cursorFrom = (value: unknown): HistoryImportCursor | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<HistoryImportCursor>;
  const beforeDateMs = finiteNonNegativeInteger(candidate.beforeDateMs);
  const beforeId = finiteNonNegativeInteger(candidate.beforeId);
  return beforeDateMs === null || beforeId === null ? null : { beforeDateMs, beforeId };
};

export function createHistoryImportProgress(now: number): HistoryImportProgress {
  const timestamp = finiteNonNegativeInteger(now) ?? Date.now();
  return {
    status: 'paused',
    cursor: null,
    scanned: 0,
    found: 0,
    startedAt: timestamp,
    updatedAt: timestamp,
    error: null,
  };
}

/** A process cannot still be running after hydration, so that state resumes paused. */
export function normalizeHistoryImportProgress(value: unknown): HistoryImportProgress | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<HistoryImportProgress>;
  if (!['paused', 'running', 'failed', 'complete'].includes(candidate.status ?? '')) return null;
  const status = candidate.status as HistoryImportStatus;
  const scanned = finiteNonNegativeInteger(candidate.scanned);
  const found = finiteNonNegativeInteger(candidate.found);
  const startedAt = finiteNonNegativeInteger(candidate.startedAt);
  const updatedAt = finiteNonNegativeInteger(candidate.updatedAt);
  if (scanned === null || found === null || found > scanned || startedAt === null || updatedAt === null) {
    return null;
  }
  const complete = status === 'complete';
  const cursor = complete ? null : cursorFrom(candidate.cursor);
  if (candidate.cursor !== null && !complete && cursor === null) return null;
  return {
    status: status === 'running' ? 'paused' : status,
    cursor,
    scanned,
    found,
    startedAt,
    updatedAt,
    error: status === 'failed' &&
      (candidate.error === 'page-failed' || candidate.error === 'inbox-access')
      ? candidate.error
      : null,
  };
}

export function createHistoryImportCoordinator<Page extends HistoryImportPage>(
  dependencies: HistoryImportCoordinatorDependencies<Page>,
): HistoryImportCoordinator {
  let inFlight: Promise<HistoryImportProgress | null> | null = null;

  const execute = async (): Promise<HistoryImportProgress | null> => {
    const generation = dependencies.getGeneration?.() ?? 0;
    const generationIsCurrent = () => (dependencies.getGeneration?.() ?? 0) === generation;
    const canContinue = () => generationIsCurrent() && dependencies.shouldContinue();
    const currentProgress = () => normalizeHistoryImportProgress(dependencies.getProgress());
    let progress = normalizeHistoryImportProgress(dependencies.getProgress());
    if (!progress || progress.status === 'complete') return progress;

    progress = {
      ...progress,
      status: 'running',
      updatedAt: dependencies.now(),
      error: null,
    };
    await dependencies.persistProgress(progress);
    if (!generationIsCurrent()) return currentProgress();

    for (;;) {
      if (!generationIsCurrent()) return currentProgress();
      if (!dependencies.shouldContinue()) {
        progress = {
          ...progress,
          status: 'paused',
          updatedAt: dependencies.now(),
          error: null,
        };
        await dependencies.persistProgress(progress);
        return progress;
      }

      try {
        const page = await dependencies.scanPage(progress.cursor);
        if (!generationIsCurrent()) return currentProgress();
        if (!dependencies.shouldContinue()) {
          progress = {
            ...progress,
            status: 'paused',
            updatedAt: dependencies.now(),
            error: null,
          };
          await dependencies.persistProgress(progress);
          return progress;
        }
        const complete = page.complete;
        const next: HistoryImportProgress = {
          ...progress,
          status: complete ? 'complete' : 'running',
          cursor: complete ? null : page.nextCursor,
          scanned: progress.scanned + page.scanned,
          found: progress.found + page.found,
          updatedAt: dependencies.now(),
          error: null,
        };
        if (!complete && !next.cursor) throw new Error('History page did not provide a cursor');
        const committed = await dependencies.commitPage(page, next, canContinue);
        if (!generationIsCurrent()) return currentProgress();
        if (committed === false) {
          progress = {
            ...progress,
            status: 'paused',
            updatedAt: dependencies.now(),
            error: null,
          };
          await dependencies.persistProgress(progress);
          return progress;
        }
        progress = next;
        if (complete) return progress;
      } catch (error) {
        if (!generationIsCurrent()) return currentProgress();
        if (!dependencies.shouldContinue()) {
          const paused: HistoryImportProgress = {
            ...progress,
            status: 'paused',
            updatedAt: dependencies.now(),
            error: null,
          };
          await dependencies.persistProgress(paused);
          return paused;
        }
        const failed: HistoryImportProgress = {
          ...progress,
          status: 'failed',
          updatedAt: dependencies.now(),
          error: dependencies.classifyError?.(error) ?? 'page-failed',
        };
        await dependencies.persistProgress(failed);
        throw error;
      }
    }
  };

  return {
    run() {
      if (inFlight) return inFlight;
      const operation = execute().finally(() => {
        if (inFlight === operation) inFlight = null;
      });
      inFlight = operation;
      return operation;
    },
  };
}
