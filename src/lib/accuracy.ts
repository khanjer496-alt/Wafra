import type { AppState, Transaction } from '@/lib/types';

/**
 * Why a message ended up on this list — two very different failures that were
 * being reported as one.
 *
 * A real export of 177 entries turned out to be almost entirely `uncategorized`:
 * the merchant name was read correctly every time, it just had no category
 * rule. Calling all of that "could not read" overstated the problem and buried
 * the handful of messages the grammar genuinely cannot parse.
 */
export type UnreadReason = 'unread' | 'uncategorized';

/** The title the parser falls back to when it cannot find a merchant at all. */
const GENERIC_MERCHANT = 'Card purchase';

export interface UnreadFormat {
  /** One representative message for this format. */
  raw: string;
  title: string;
  category: string;
  /** How many transactions share this format. */
  count: number;
  amountFils: number;
  reason: UnreadReason;
}

/**
 * Bank message formats the parser could not read confidently, one entry per
 * format rather than per transaction.
 *
 * Digits are blanked to build the key, so ten Carrefour charges that differ
 * only in amount and date collapse into a single row. That is what makes the
 * list short enough to act on: a user with 400 unparsed rows usually has
 * three unrecognised formats.
 */
export function unreadFormats(
  transactions: Transaction[],
  categoryLabel: (id: Transaction['category']) => string,
): UnreadFormat[] {
  const byFormat = new Map<string, UnreadFormat>();
  for (const tx of transactions) {
    if (!tx.raw) continue;
    const key = tx.raw.replace(/\d/g, '#');
    const cur = byFormat.get(key);
    if (cur) {
      cur.count += 1;
      continue;
    }
    byFormat.set(key, {
      raw: tx.raw,
      title: tx.title,
      category: categoryLabel(tx.category),
      count: 1,
      amountFils: tx.amountFils,
      reason: tx.title === GENERIC_MERCHANT ? 'unread' : 'uncategorized',
    });
  }
  // Unread first: those are the ones where the app shows the user nothing
  // useful at all, and they are usually the short list.
  return [...byFormat.values()].sort(
    (a, b) => Number(b.reason === 'unread') - Number(a.reason === 'unread') || b.count - a.count,
  );
}

/** Long digit runs never leave the device intact. Same rule as the other export. */
function maskLongDigits(s: string): string {
  return s.replace(/\d{5,}/g, (m) => `····${m.slice(-4)}`);
}

const fmt = (fils: number): string =>
  (fils / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Everything the ledger believes about this phone's cards, as text to share.
 *
 * The "Improve accuracy" export cannot answer the two questions actually being
 * asked of it — "is this counted twice" and "why is my card wrong" — for two
 * reasons. It lists only messages the parser was UNSURE about, and `raw` is
 * deliberately dropped for anything parsed confidently. A card statement that
 * parsed cleanly and was then filed against the wrong account leaves no trace
 * there at all.
 *
 * So this reports the OUTCOME rather than the input: every card account, every
 * statement, every row the ledger associated with a card, and — last — what
 * each of those rows was actually counted as. A double count is visible in that
 * final block and nowhere else, because the bug is never that a message was
 * unreadable; it is that two readable messages describing one movement of money
 * were both added up.
 *
 * `raw` is included where it survived, but it usually has not, and the report
 * says so rather than looking empty.
 */
export function cardDiagnostics(state: {
  accounts: AppState['accounts'];
  transactions: AppState['transactions'];
  cardDues: AppState['cardDues'];
}): string {
  const cards = state.accounts.filter((a) => a.kind === 'card');
  const cardIds = new Set(cards.map((a) => a.id));
  const accountLabel = (id: string | undefined): string => {
    const a = state.accounts.find((x) => x.id === id);
    return a ? `${a.name}${a.last4 ? ` ·${a.last4}` : ''}` : (id ?? '—');
  };

  // Generous on purpose: a row filed against the WRONG account is exactly the
  // bug being hunted, so selecting only by card account would hide it. Anything
  // carrying a card-payment side, or whose surviving raw text talks about a
  // card, is in.
  const cardish = state.transactions.filter(
    (t) =>
      cardIds.has(t.accountId) ||
      t.cardPaymentSide !== undefined ||
      (t.raw ? /\bcard\b|statement|minimum due|credit limit|avl\.?\s*(?:cr|limit)|outstanding/i.test(t.raw) : false),
  );

  const out: string[] = ['WAFRA CARD DIAGNOSTIC', ''];

  out.push(`CARDS (${cards.length})`);
  if (!cards.length) out.push('  none — the app has not recognised any card account');
  for (const c of cards) {
    out.push(
      `  ${c.name} ·${c.last4 ?? '????'}  ${c.cardType ?? 'unknown type'}  bank ${c.bankName ?? '—'}`,
    );
  }
  out.push('');

  out.push(`STATEMENTS (${state.cardDues.length})`);
  if (!state.cardDues.length) out.push('  none — no statement has been read for any card');
  for (const d of state.cardDues) {
    out.push(
      `  ${accountLabel(d.accountId)}  total ${fmt(d.totalDueFils)}  min ${fmt(d.minDueFils)}` +
        `${d.minDueEstimated ? ' (estimated)' : ''}  due ${d.dueDate}  paid ${fmt(d.paidFils)}` +
        `  ${d.settledAt ? `settled ${d.settledAt}` : 'NOT settled'}`,
    );
  }
  out.push('');

  out.push(`CARD-RELATED ROWS (${cardish.length})`);
  for (const t of cardish) {
    const side = t.cardPaymentSide ? ` [${t.cardPaymentSide}]` : '';
    const transfer = t.isTransfer ? ' [transfer]' : '';
    out.push(
      `  ${t.date}  ${t.type === 'expense' ? '-' : '+'}${fmt(t.amountFils)}  ${t.title}` +
        `${transfer}${side}  in ${accountLabel(t.accountId)}`,
    );
    if (t.raw) out.push(`      raw: ${maskLongDigits(t.raw)}`);
  }
  out.push('');

  // The block that answers the question. `isTransfer` is what keeps a card
  // payment out of the totals; a row missing it is counted, and a PAIR of rows
  // missing it is the same money counted twice.
  const counted = cardish.filter((t) => !t.isTransfer);
  const countedOut = counted.filter((t) => t.type === 'expense');
  const countedIn = counted.filter((t) => t.type === 'income');
  out.push('WHAT THESE WERE COUNTED AS');
  out.push(
    `  counted as spending: ${countedOut.length} row(s), ${fmt(countedOut.reduce((s, t) => s + t.amountFils, 0))}`,
  );
  out.push(
    `  counted as income:   ${countedIn.length} row(s), ${fmt(countedIn.reduce((s, t) => s + t.amountFils, 0))}`,
  );
  out.push(`  excluded as transfer: ${cardish.length - counted.length} row(s)`);
  out.push('');
  out.push(
    'Raw text is present only for messages the parser was unsure about; it is',
    'discarded for anything read confidently, so most rows above show no raw.',
  );

  return out.join('\n');
}

/**
 * Distinct unrecognised formats. Cheap enough to call on every Home render —
 * it walks transactions once and allocates a set of keys, not the full rows.
 */
export function unreadFormatCount(state: AppState): number {
  const keys = new Set<string>();
  for (const tx of state.transactions) {
    if (tx.raw) keys.add(tx.raw.replace(/\d/g, '#'));
  }
  return keys.size;
}

/**
 * Below this, staying quiet is the right call: one stray format is usually a
 * one-off promo the parser was right to skip, and nagging over it trains
 * people to ignore the prompt that matters.
 */
export const REPORT_PROMPT_THRESHOLD = 3;
