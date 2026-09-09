import type { Account, Transaction } from '@/lib/types';
import type { TransferReviewGroup } from '@/lib/transfer-reconciliation-types';

export type TransferHistoryScope = 'recent' | 'all';
export const TRANSFER_HISTORY_PAGE_SIZE = 20;

/** Display only: never use a label, search match or date window as ownership evidence. */
export function transferSearchText(value: string): string {
  return value.normalize('NFKC').replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x6f0))
    .replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/٬|,/g, '').replace(/٫/g, '.').toLowerCase().trim();
}

/** Do not append ••2615 to an account already displayed as “Wio Account ·2615”. */
export function transferAccountLabel(account: Pick<Account, 'name' | 'last4'>): string {
  const name = account.name.trim();
  const tail = account.last4;
  if (!tail || !/^\d{4}$/.test(tail)) return name;
  if (new RegExp(`(?:^|[^0-9])${tail}$`).test(transferSearchText(name))) return name;
  return [name, `••${tail}`].filter(Boolean).join(' · ');
}

/** Calendar dates, inclusive of today. This is a browsing filter, not a retention cutoff. */
export function transferRecentStart(todayISO: string): string {
  const date = new Date(`${todayISO}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(todayISO) || !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== todayISO) throw new Error('Invalid transfer history date');
  date.setUTCDate(date.getUTCDate() - 89);
  return date.toISOString().slice(0, 10);
}

export function newestTransferFirst(a: Transaction, b: Transaction): number {
  return b.date.localeCompare(a.date) || (b.ts ?? 0) - (a.ts ?? 0) || a.id.localeCompare(b.id);
}

export type TransferBrowseGroup = TransferReviewGroup & { rows: Transaction[] };

/** One reusable, source-free search index per ledger/account/denomination snapshot. */
export function indexTransferHistory(groups: readonly TransferReviewGroup[], rowsById: ReadonlyMap<string, Transaction>,
  accountLabels: ReadonlyMap<string, string>, moneyLabel: (amount: number) => string): Map<string, string> {
  const index = new Map<string, string>();
  for (const group of groups) for (const id of group.transactionIds) {
    const row = rowsById.get(id);
    if (!row) continue;
    index.set(id, transferSearchText([row.title, row.date, accountLabels.get(row.accountId), group.counterpartyName,
      group.counterparty?.bankIdentity, group.counterparty?.last4, row.transferEvidence?.reference,
      moneyLabel(row.amountFils)].filter(Boolean).join(' ')));
  }
  return index;
}

/** Projects immutable, already-assessed groups. Filtering cannot create a new bulk permission. */
export function projectTransferHistory({ groups, rowsById, accountLabels, scope, todayISO,
  query = '', focusedId, moneyLabel, searchIndex,
}: {
  groups: readonly TransferReviewGroup[];
  rowsById: ReadonlyMap<string, Transaction>;
  accountLabels: ReadonlyMap<string, string>;
  scope: TransferHistoryScope;
  todayISO: string;
  query?: string;
  focusedId?: string;
  moneyLabel: (amount: number) => string;
  searchIndex?: ReadonlyMap<string, string>;
}): { groups: TransferBrowseGroup[]; count: number; outsideRecentCount: number } {
  const from = transferRecentStart(todayISO);
  const terms = transferSearchText(query).split(/\s+/).filter(Boolean);
  const index = terms.length ? searchIndex ?? indexTransferHistory(groups, rowsById, accountLabels, moneyLabel) : undefined;
  let count = 0, outsideRecentCount = 0;
  const projected: TransferBrowseGroup[] = [];
  for (const group of groups) {
    const rows: Transaction[] = [];
    for (const id of group.transactionIds) {
      const row = rowsById.get(id);
      if (!row || (focusedId && row.id !== focusedId)) continue;
      if (!focusedId && terms.length) {
        // Source message text is deliberately not indexed or disclosed here.
        const haystack = index?.get(id) ?? '';
        if (!terms.every(term => haystack.includes(term))) continue;
      }
      const recent = row.date >= from && row.date <= todayISO;
      if (!recent) outsideRecentCount += 1;
      if (!focusedId && scope === 'recent' && !recent) continue;
      rows.push(row);
    }
    if (!rows.length) continue;
    rows.sort(newestTransferFirst);
    count += rows.length;
    projected.push({ ...group, transactionIds: rows.map(row => row.id), rows });
  }
  projected.sort((a, b) => newestTransferFirst(a.rows[0], b.rows[0]) || a.id.localeCompare(b.id));
  return { groups: projected, count, outsideRecentCount };
}

export type TransferHistoryItem<G extends TransferBrowseGroup> =
  | { kind: 'group'; key: string; group: G }
  | { kind: 'entry'; key: string; group: G; transaction: Transaction }
  | { kind: 'more'; key: string; group: G; shown: number };

/** Collapsed by default; expanding one account must not mount its entire multi-year history. */
export function transferHistoryItems<G extends TransferBrowseGroup>(
  groups: readonly G[], expanded: ReadonlySet<string>, limits: Readonly<Record<string, number>>,
  focused = false,
): TransferHistoryItem<G>[] {
  const items: TransferHistoryItem<G>[] = [];
  for (const group of groups) {
    items.push({ kind: 'group', key: `group:${group.id}`, group });
    if (!focused && !expanded.has(group.id)) continue;
    const requested = limits[group.id];
    const limit = Number.isSafeInteger(requested) && requested > 0 ? requested : TRANSFER_HISTORY_PAGE_SIZE;
    for (const transaction of group.rows.slice(0, limit)) {
      items.push({ kind: 'entry', key: `entry:${group.id}:${transaction.id}`, group, transaction });
    }
    if (group.rows.length > limit) items.push({ kind: 'more', key: `more:${group.id}`, group, shown: limit });
  }
  return items;
}
