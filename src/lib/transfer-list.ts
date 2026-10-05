import type { TransferActivityRecord } from '@/lib/transfer-activity';
import type { TransferPair } from '@/lib/transfer-pairs';
import type { Transaction } from '@/lib/types';

export type TransferTag = 'own' | 'external' | 'needs-answer' | 'unconfirmed';
export type RouteEnd = { kind: 'account'; accountId: string } | { kind: 'party'; name: string } | { kind: 'unknown' };
export interface TransferListItem {
  key: string; transactionId: string; date: string; ts: number;
  from: RouteEnd; to: RouteEnd; amountFils: number; direction: 'out' | 'in' | 'between';
  tag: TransferTag; linked: boolean;
}
export type TransferTile = 'own' | 'sent' | 'received';

const account = (tx: Transaction): RouteEnd => ({ kind: 'account', accountId: tx.accountId });
const other = (tx: Transaction): RouteEnd => {
  const name = tx.transferEvidence?.counterpartyName;
  return name ? { kind: 'party', name } : { kind: 'unknown' };
};
const tagOf = (record: TransferActivityRecord): TransferTag => record.confirmed
  ? record.ownership === 'own' ? 'own' : 'external'
  : record.needsReview ? 'needs-answer' : 'unconfirmed';

/** One row per transfer: a linked pair collapses to its outgoing leg's route. */
export function transferListItems(
  records: readonly TransferActivityRecord[], pairs: readonly TransferPair[],
): TransferListItem[] {
  const byId = new Map(records.map(record => [record.transaction.id, record]));
  const used = new Set<string>();
  const items: TransferListItem[] = [];
  for (const pair of pairs) {
    const outRecord = byId.get(pair.out.id);
    if (!outRecord || !byId.has(pair.in.id)) continue;
    used.add(pair.out.id); used.add(pair.in.id);
    items.push({ key: pair.key, transactionId: pair.out.id, date: pair.out.date, ts: pair.out.ts ?? 0,
      from: account(pair.out), to: account(pair.in), amountFils: pair.out.amountFils,
      direction: 'between', tag: tagOf(outRecord), linked: true });
  }
  for (const record of records) {
    const tx = record.transaction;
    if (used.has(tx.id)) continue;
    const incoming = tx.type === 'income';
    items.push({ key: tx.id, transactionId: tx.id, date: tx.date, ts: tx.ts ?? 0,
      from: incoming ? other(tx) : account(tx), to: incoming ? account(tx) : other(tx),
      amountFils: tx.amountFils, direction: incoming ? 'in' : 'out', tag: tagOf(record), linked: false });
  }
  return items.sort((a, b) => b.date.localeCompare(a.date) || b.ts - a.ts);
}

/** How far apart (in days) two unlinked legs of one own transfer can be dated. */
const OWN_LEG_DAYS = 3;
const dayGap = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

export function transferTotals(items: readonly TransferListItem[]) {
  let ownFils = 0; let sentFils = 0; let receivedFils = 0;
  // An own transfer seen from both sides but not linked shows as an 'out' row
  // and an 'in' row; it moved the money once. An own 'in' row with no such
  // outgoing partner (the debit was never captured, e.g. cash logged by hand
  // after an ATM withdrawal) still moved that money, so it counts.
  const unpairedOut = items.filter(item => item.tag === 'own' && item.direction === 'out');
  for (const item of items) {
    if (item.tag === 'own') {
      if (item.direction !== 'in') { ownFils += item.amountFils; continue; }
      const toAccount = item.to.kind === 'account' ? item.to.accountId : null;
      const partner = unpairedOut.findIndex(out => out.amountFils === item.amountFils &&
        !(out.from.kind === 'account' && out.from.accountId === toAccount) && dayGap(out.date, item.date) <= OWN_LEG_DAYS);
      if (partner >= 0) unpairedOut.splice(partner, 1);
      else ownFils += item.amountFils;
    }
    else if (item.tag === 'external' && item.direction === 'out') sentFils += item.amountFils;
    else if (item.tag === 'external' && item.direction === 'in') receivedFils += item.amountFils;
  }
  return { ownFils, sentFils, receivedFils };
}

export function filterTransferItems(items: readonly TransferListItem[], tile: TransferTile | null): TransferListItem[] {
  if (!tile) return [...items];
  return items.filter(item => tile === 'own' ? item.tag === 'own'
    : item.tag === 'external' && item.direction === (tile === 'sent' ? 'out' : 'in'));
}
