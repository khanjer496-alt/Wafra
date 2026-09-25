import { monthKey, toISODate } from '@/lib/format';
import { iosCaptureHealthMode, isCaptureTimestamp, type IosCaptureHealth } from '@/lib/ios-capture-health';
import type { Account, Transaction } from '@/lib/types';

/**
 * "Working" is a claim about recency, so it is made only when the queue was
 * processed recently. The automation hands Wafra every incoming message (not
 * only bank alerts), so on a phone that receives messages at all a processing
 * gap this long is worth a look; it is still not proof of a fault, and the
 * screen says so.
 */
export const CAPTURE_WORKING_WINDOW_MS = 72 * 60 * 60 * 1000;

export type CaptureHealthStatus =
  | { kind: 'working'; lastHandledAt: number }
  | { kind: 'quiet'; lastHandledAt: number }
  | { kind: 'never' }
  | { kind: 'off' | 'paused' | 'attention' | 'unknown' };

export function captureHealthStatus(health: IosCaptureHealth | null, now: number): CaptureHealthStatus {
  const mode = iosCaptureHealthMode(health);
  if (!health || mode === 'unknown') return { kind: 'unknown' };
  if (mode === 'off' || mode === 'paused' || mode === 'attention') return { kind: mode };
  const at = health.lastHandledAt;
  if (!isCaptureTimestamp(at)) return { kind: 'never' };
  // A clock set backwards reads as recent, not as a fault.
  return now - at <= CAPTURE_WORKING_WINDOW_MS
    ? { kind: 'working', lastHandledAt: at }
    : { kind: 'quiet', lastHandledAt: at };
}

/** A statement row is a past import, not a capture. */
const isStatementRow = (tx: Transaction): boolean =>
  tx.captureSource === 'pdf' || tx.captureSource === 'csv' || tx.statementImportId !== undefined;

/**
 * Entries recorded from bank alerts in the current reporting month. Manual
 * entries and statement imports are not captures and are not counted.
 */
export function capturedThisMonth(transactions: readonly Transaction[], today: Date = new Date()): number {
  const month = monthKey(toISODate(today));
  let count = 0;
  for (const tx of transactions) {
    if (tx.source !== 'sms' || isStatementRow(tx)) continue;
    if (monthKey(tx.date) === month) count += 1;
  }
  return count;
}

/**
 * Bank names on accounts that have at least one entry recorded from a bank
 * alert — evidence that Wafra has read that bank, not a list of senders it
 * listens to (the automation is not per sender) and not a coverage claim.
 */
export function banksSeenInAlerts(accounts: readonly Account[], transactions: readonly Transaction[]): string[] {
  const captured = new Set<string>();
  for (const tx of transactions) if (tx.source === 'sms' && !isStatementRow(tx)) captured.add(tx.accountId);
  const names = new Map<string, string>();
  for (const account of accounts) {
    const name = account.bankName?.trim();
    if (!name || account.archived || !captured.has(account.id)) continue;
    const key = name.toLowerCase();
    if (!names.has(key)) names.set(key, name);
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}
