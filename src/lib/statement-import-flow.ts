import type { StatementImportCoverage } from '@/lib/cloud-import-contract';

/** Only the queue facts this presentation workflow consumes. */
interface StatementQueueOutcome {
  kind: string;
  source?: string;
  transactions?: number;
  reviewAlerts?: number;
  /** New card dues and bills the page filed; not transactions, not duplicates. */
  dues?: number;
  bills?: number;
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
  /** New dues and bills filed alongside the transactions (see alreadyInWafra). */
  filedOther?: number;
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
  let filedOther = 0;
  try {
    for (let page = 0; page < 50; page += 1) {
      if (!isCurrent()) return { imported, review, filedOther, complete: false, reason: 'interrupted' };
      const outcome = await execute();
      if (outcome.kind === 'not-hydrated' || outcome.kind === 'needs-setup') {
        return { imported, review, filedOther, complete: false, reason: outcome.kind };
      }
      if ((outcome.kind !== 'imported' && outcome.kind !== 'up-to-date') || outcome.source !== 'relay') {
        return { imported, review, filedOther, complete: false, reason: 'interrupted' };
      }
      if (!Number.isSafeInteger(outcome.transactions) || outcome.transactions! < 0 ||
          !Number.isSafeInteger(outcome.reviewAlerts) || outcome.reviewAlerts! < 0) {
        return { imported, review, filedOther, complete: false, reason: 'failed' };
      }
      imported += outcome.transactions!;
      review += outcome.reviewAlerts!;
      for (const filed of [outcome.dues, outcome.bills]) {
        if (Number.isSafeInteger(filed) && filed! > 0) filedOther += filed!;
      }
      if (!isCurrent()) return { imported, review, filedOther, complete: false, reason: 'interrupted' };
      if (!outcome.moreQueued) {
        if (outcome.deferredReviews && outcome.deferredReviews > 0) return { imported, review, filedOther, complete: false, reason: 'review' };
        if (outcome.queueBlocked) return { imported, review, filedOther, complete: false, reason: 'interrupted' };
        return { imported, review, filedOther, complete: true };
      }
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    return { imported, review, filedOther, complete: false, reason: 'failed' };
  } catch (error) {
    if (error instanceof StatementFilingError) {
      return { imported: imported + error.imported, review: review + error.review, filedOther,
        complete: false, reason: 'failed', error: error.original };
    }
    return { imported, review, filedOther, complete: false, reason: 'failed', error };
  }
}

/**
 * Whether the ledger holds any transaction of the statement upload `importId`
 * names (as its own row, or as a claim on a row it matched). When it holds
 * none — a reinstall, an erase, a restore from an older backup — a refusal
 * about that earlier read is not a reason to stop: the file is read again.
 */
export function holdsStatementRows(
  transactions: readonly { statementImportId?: string; statementOccurrences?: readonly { importId: string }[] }[],
  importId: string,
): boolean {
  return transactions.some((row) => row.statementImportId === importId ||
    row.statementOccurrences?.some((claim) => claim.importId === importId) === true);
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
