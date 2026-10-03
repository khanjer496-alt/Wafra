import type { StatementImportCoverage } from '@/lib/cloud-import-contract';

/** Only the queue facts this presentation workflow consumes. */
interface StatementQueueOutcome {
  kind: string;
  source?: string;
  transactions?: number;
  reviewAlerts?: number;
  moreQueued?: boolean;
  deferredReviews?: number;
  queueBlocked?: boolean;
}

/** A local commit succeeded, but retiring its remote copy did not. */
export class StatementFilingError extends Error {
  constructor(readonly original: unknown, readonly imported: number, readonly review: number) {
    super(original instanceof Error ? original.message : 'Statement filing did not finish');
    this.name = 'StatementFilingError';
  }
}

export interface StatementDrainResult {
  imported: number;
  review: number;
  complete: boolean;
  reason?: 'review' | 'interrupted' | 'not-hydrated' | 'needs-setup' | 'failed';
  error?: unknown;
}

/** Queue progress is not completion; preserve committed counts across retries. */
export async function drainStatementQueue(
  execute: () => Promise<StatementQueueOutcome>,
  isCurrent: () => boolean = () => true,
): Promise<StatementDrainResult> {
  let imported = 0;
  let review = 0;
  try {
    for (let page = 0; page < 50; page += 1) {
      if (!isCurrent()) return { imported, review, complete: false, reason: 'interrupted' };
      const outcome = await execute();
      if (outcome.kind === 'not-hydrated' || outcome.kind === 'needs-setup') {
        return { imported, review, complete: false, reason: outcome.kind };
      }
      if ((outcome.kind !== 'imported' && outcome.kind !== 'up-to-date') || outcome.source !== 'relay') {
        return { imported, review, complete: false, reason: 'interrupted' };
      }
      if (!Number.isSafeInteger(outcome.transactions) || outcome.transactions! < 0 ||
          !Number.isSafeInteger(outcome.reviewAlerts) || outcome.reviewAlerts! < 0) {
        return { imported, review, complete: false, reason: 'failed' };
      }
      imported += outcome.transactions!;
      review += outcome.reviewAlerts!;
      if (!isCurrent()) return { imported, review, complete: false, reason: 'interrupted' };
      if (!outcome.moreQueued) {
        if (outcome.deferredReviews && outcome.deferredReviews > 0) return { imported, review, complete: false, reason: 'review' };
        if (outcome.queueBlocked) return { imported, review, complete: false, reason: 'interrupted' };
        return { imported, review, complete: true };
      }
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    return { imported, review, complete: false, reason: 'failed' };
  } catch (error) {
    if (error instanceof StatementFilingError) {
      return { imported: imported + error.imported, review: review + error.review,
        complete: false, reason: 'failed', error: error.original };
    }
    return { imported, review, complete: false, reason: 'failed', error };
  }
}

/** A reupload cannot create a new range under changed interpretation settings. */
export function newStatementRange(
  accepted: { statementImportId?: string; alreadyProcessed: boolean; coverage: StatementImportCoverage | null },
  transactions: readonly { statementImportId?: string; statementOccurrences?: readonly { importId: string }[] }[],
): StatementImportCoverage | null {
  if (!accepted.statementImportId || accepted.alreadyProcessed ||
      transactions.some(row => row.statementImportId === accepted.statementImportId ||
        row.statementOccurrences?.some(claim => claim.importId === accepted.statementImportId))) return null;
  return accepted.coverage;
}
