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

export function transferTotals(items: readonly TransferListItem[]) {
  let ownFils = 0; let sentFils = 0; let receivedFils = 0;
  for (const item of items) {
    // Own money counts via 'out'/'between' items so unlinked legs never double; an in-only capture is left out.
    if (item.tag === 'own') { if (item.direction !== 'in') ownFils += item.amountFils; }
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
