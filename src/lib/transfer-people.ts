import { onePerPair, transferPartnerIds, transferQuestionQueue, type TransferActivityRecord } from '@/lib/transfer-activity';
import { isTransferEvidence } from '@/lib/transfer-reconciliation';
import type { Transaction } from '@/lib/types';

/**
 * Transfers waiting for an answer, grouped by the person the money went to or
 * came from, so one answer covers that person ("Mariam S: your own account or
 * someone else?").
 *
 * A person group holds only rows the reconciler found nothing to say about:
 * ownership unknown, not in its review queue (no likely own-account pair, no
 * ambiguous candidates, no card repayment), no decision yet. Rows with any
 * own-account evidence keep their own question, so a person's answer is never
 * mixed with a suggestion that one of their transfers was a move between the
 * person's accounts. Read-only: nothing here pairs rows, changes a total or
 * stores anything.
 */
export interface TransferPersonGroup {
  /** `person:` and the normalised name; stable across renders for the same name. */
  key: string;
  /** The name as the bank wrote it most often (the newest spelling on a tie). */
  name: string;
  /** The first letter of the name, for the avatar. */
  initial: string;
  /** Every waiting entry with this person, newest first. */
  ids: string[];
  incoming: number; outgoing: number;
  inFils: number; outFils: number;
  /** All money in, all money out, or both (one answer then names both directions). */
  direction: 'income' | 'expense' | 'between';
  /** Dates of the newest and oldest entry. */
  newest: string; oldest: string;
  newestTs: number;
}

// Arabic short vowels, the superscript alef and the tatweel: how a name is
// drawn, not who it names.
const ARABIC_MARKS = /[ً-ْٰـ]/g;

/**
 * The key a name is grouped under: the same letters, ignoring case, spacing
 * and the punctuation banks scatter through names ("MARIAM S." = "Mariam S",
 * "AL-HASHIMI" = "Al Hashimi"). Deliberately nothing more: no titles dropped,
 * no accents or alef forms folded, no initials expanded. Two spellings left
 * apart cost one extra question; two people merged would let one answer
 * decide for both. Undefined when no letter is left.
 */
export function transferPersonKey(name: string): string | undefined {
  const key = name.normalize('NFKC').replace(ARABIC_MARKS, '').replace(/[.'’`-]+/g, ' ')
    .replace(/\s+/g, ' ').trim().toLowerCase();
  return /\p{L}/u.test(key) ? key : undefined;
}

/**
 * The person a transfer went to or came from, as the bank alert named them.
 * Only a well-formed evidence record's name counts (the same validation the
 * reconciler applies); nothing is ever inferred from a title.
 */
export function transferPersonName(transaction: Transaction): string | undefined {
  const evidence = transaction.transferEvidence;
  return evidence && isTransferEvidence(evidence) ? evidence.counterpartyName : undefined;
}

/**
 * A row waiting for an answer that the reconciler does not queue: ownership
 * unknown, nothing linking it to another of the person's accounts.
 */
export function isUnqueuedWaiting(record: TransferActivityRecord): boolean {
  return !record.confirmed && !record.needsReview && record.assessment.status === 'ownership-unknown' &&
    !record.transaction.transferDecision &&
    (record.transaction.type === 'income' || record.transaction.type === 'expense');
}

const newestFirst = (a: Transaction, b: Transaction): number =>
  b.date.localeCompare(a.date) || (b.ts ?? 0) - (a.ts ?? 0) || a.id.localeCompare(b.id);

/**
 * One person's group from their rows, newest first (the caller sorts). Also
 * used to narrow a group to the entries a search matched: the counts, totals
 * and dates then describe exactly the entries an answer would change.
 */
export function personGroup(key: string, name: string, rows: readonly Transaction[]): TransferPersonGroup {
  let incoming = 0, outgoing = 0, inFils = 0, outFils = 0;
  for (const row of rows) {
    if (row.type === 'income') { incoming += 1; inFils += row.amountFils; } else { outgoing += 1; outFils += row.amountFils; }
  }
  return { key, name, initial: (Array.from(name.trim())[0] ?? '?').toLocaleUpperCase(),
    ids: rows.map(row => row.id), incoming, outgoing, inFils, outFils,
    direction: incoming && outgoing ? 'between' : incoming ? 'income' : 'expense',
    newest: rows[0]?.date ?? '', oldest: rows[rows.length - 1]?.date ?? '', newestTs: rows[0]?.ts ?? 0 };
}

const peopleCache = new WeakMap<readonly TransferActivityRecord[], TransferPersonGroup[]>();

/**
 * The person groups for one activity list, most transfers first (then the
 * most recent, then the name). One pass over the records plus a sort per
 * group: no pairwise comparison. Cached per activity array, which the screens
 * already keep per reconciliation (one per stored transfer receipt).
 */
export function transferPeople(activity: readonly TransferActivityRecord[]): TransferPersonGroup[] {
  const cached = peopleCache.get(activity);
  if (cached) return cached;
  const byKey = new Map<string, { rows: Transaction[]; spellings: Map<string, { count: number; newest: Transaction }> }>();
  for (const record of activity) {
    if (!isUnqueuedWaiting(record)) continue;
    const name = transferPersonName(record.transaction);
    const key = name ? transferPersonKey(name) : undefined;
    if (!name || !key) continue;
    let entry = byKey.get(key);
    if (!entry) { entry = { rows: [], spellings: new Map() }; byKey.set(key, entry); }
    entry.rows.push(record.transaction);
    const spelling = entry.spellings.get(name);
    if (!spelling) entry.spellings.set(name, { count: 1, newest: record.transaction });
    else {
      spelling.count += 1;
      if (newestFirst(record.transaction, spelling.newest) < 0) spelling.newest = record.transaction;
    }
  }
  const groups: TransferPersonGroup[] = [];
  for (const [key, { rows, spellings }] of byKey) {
    rows.sort(newestFirst);
    let name = '', best: { count: number; newest: Transaction } | undefined;
    for (const [spelling, seen] of spellings) {
      if (!best || seen.count > best.count || (seen.count === best.count && newestFirst(seen.newest, best.newest) < 0)) {
        best = seen; name = spelling;
      }
    }
    groups.push(personGroup(`person:${key}`, name, rows));
  }
  groups.sort((a, b) => b.ids.length - a.ids.length || b.newest.localeCompare(a.newest) || b.newestTs - a.newestTs ||
    a.key.localeCompare(b.key));
  peopleCache.set(activity, groups);
  return groups;
}

/** How many transfers wait for an answer, and with how many people. */
export interface TransferWaitingSummary {
  /**
   * Every transfer kept out of the totals until the person answers: the
   * reconciler's queue and every other unconfirmed transfer. A linked or
   * likely own-account pair with both legs waiting counts once, as the
   * Transactions summary counts it.
   */
  transfers: number;
  /** People with transfers waiting (person groups). */
  people: number;
  /** The transfers in those person groups. */
  withPeople: number;
}

const summaryCache = new WeakMap<readonly TransferActivityRecord[], TransferWaitingSummary>();

/**
 * The one count of transfers waiting, for Home's Needs you pill, the Transfers
 * card and (filtered by the same rule) the Transactions summary. A record
 * waits when its ownership is not settled (`confirmed` is false). A leg whose
 * pair partner (`transferPartnerIds`) was already counted adds nothing.
 */
export function transferWaitingSummary(activity: readonly TransferActivityRecord[]): TransferWaitingSummary {
  const cached = summaryCache.get(activity);
  if (cached) return cached;
  const partners = transferPartnerIds(activity);
  const counted = new Set<string>();
  let transfers = 0;
  for (const record of activity) {
    if (record.confirmed) continue;
    const partner = partners.get(record.transaction.id);
    if (partner === undefined || !counted.has(partner)) transfers += 1;
    if (partner !== undefined) counted.add(record.transaction.id);
  }
  const people = transferPeople(activity);
  const summary = { transfers, people: people.length, withPeople: people.reduce((sum, group) => sum + group.ids.length, 0) };
  summaryCache.set(activity, summary);
  return summary;
}

/** One thing the Transfers card asks: a person (every transfer with them), or one entry. */
export type TransferQuestion<T extends TransferActivityRecord = TransferActivityRecord> =
  | { kind: 'person'; key: string; person: TransferPersonGroup }
  | { kind: 'entry'; key: string; record: T };

/**
 * The card's questions in order: people first, most transfers first (one
 * answer settles the most), then the reconciler's queue (newest first, one
 * question per movement), then every other waiting transfer with no name,
 * newest first. Together they are every transfer waiting except the ones
 * only the review groups reach (duplicate ids, archived accounts, likely card
 * repayments), which `unaskedPendingIds` counts.
 */
export function transferQuestions<T extends TransferActivityRecord>(activity: readonly T[]): TransferQuestion<T>[] {
  const people = transferPeople(activity);
  const named = new Set(people.flatMap(group => group.ids));
  const unnamed = onePerPair(activity.filter(record => isUnqueuedWaiting(record) && !named.has(record.transaction.id)))
    .sort((a, b) => newestFirst(a.transaction, b.transaction));
  return [
    ...people.map(person => ({ kind: 'person' as const, key: person.key, person })),
    ...transferQuestionQueue(activity).map(record => ({ kind: 'entry' as const, key: record.transaction.id, record })),
    ...unnamed.map(record => ({ kind: 'entry' as const, key: record.transaction.id, record })),
  ];
}
