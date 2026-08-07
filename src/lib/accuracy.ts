import { netWorthFils, reliableBalanceFils } from '@/lib/balances';
import { DORMANT_AFTER_DAYS } from '@/lib/cards';
import { toISODate } from '@/lib/format';
import { STRUCTURAL_TITLES } from '@/lib/sms-parser';
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

  /* ── What the headline figure is made of ────────────────────────────
   *
   * "How was net worth calculated?" could not be answered from this report,
   * or from the app. The number is a sum over accounts, and the two ways it
   * goes wrong are both invisible in a total:
   *
   *  - one physical card held as several account rows, each carrying its own
   *    balance snapshot, so one balance is added more than once. Liv is
   *    Emirates NBD's digital bank, and a card shows up under both names;
   *    the app will not merge them on similar metadata alone, because two
   *    real cards can share a bank and a last four.
   *  - an account dormant for months is hidden from Wallet's list but still
   *    counted here, so the total is built from accounts the user cannot see.
   *
   * Both are visible the moment the sum is shown as its parts, which is what
   * this block is. Excluded accounts are listed WITH THE REASON: an account
   * silently contributing nothing is the third way the number goes wrong.
   */
  // Last activity for every account in one pass — this is a one-shot export,
  // but the per-account scan it replaces is the same quadratic shape that made
  // the Wallet tab slow, and there is no reason to write it twice.
  const lastActivity = new Map<string, string>();
  for (const t of state.transactions) {
    const seen = lastActivity.get(t.accountId);
    if (!seen || t.date > seen) lastActivity.set(t.accountId, t.date);
  }
  const today = toISODate(new Date());
  const daysSince = (iso: string): number =>
    Math.round(
      (new Date(`${today}T12:00:00`).getTime() - new Date(`${iso}T12:00:00`).getTime()) / 86400000,
    );

  const netWorth = netWorthFils(state);
  out.push(`NET WORTH  AED ${fmt(netWorth)}`);
  out.push(
    '  Only figures the BANK quoted count. A credit card can only subtract its',
    '  outstanding or count nothing — an available limit is not money you have.',
    '  An account with SMS history but no quoted figure contributes nothing',
    '  rather than a balance derived from a partial message history.',
    '',
  );
  const contribution = (a: AppState['accounts'][number]) => reliableBalanceFils(state, a);
  const countedAccounts = state.accounts.filter((a) => !a.archived && contribution(a) !== null);
  const excluded = state.accounts.filter((a) => a.archived || contribution(a) === null);

  out.push(`  COUNTED (${countedAccounts.length})`);
  if (!countedAccounts.length) out.push('    none — every account is excluded, so net worth is 0');
  for (const a of countedAccounts) {
    const fils = contribution(a) ?? 0;
    const quoted =
      a.snapshotKind && a.snapshotFils !== undefined
        ? `${a.snapshotKind} quoted by the bank`
        : 'manual account — opening balance plus your own entries';
    const last = lastActivity.get(a.id) ?? null;
    const dormant = last !== null && daysSince(last) > DORMANT_AFTER_DAYS;
    out.push(
      `    ${fils < 0 ? '-' : '+'}${fmt(Math.abs(fils))}  ${accountLabel(a.id)}  (${quoted})` +
        `${dormant ? `  [SILENT SINCE ${last} — hidden from Wallet's list, still counted here]` : ''}`,
    );
  }
  out.push('');
  out.push(`  NOT COUNTED (${excluded.length})`);
  for (const a of excluded) {
    const why = a.archived
      ? 'you hid this account'
      : a.cardType === 'credit'
        ? a.snapshotKind
          ? `the bank quoted a ${a.snapshotKind}, not an outstanding balance`
          : 'no outstanding figure from the bank'
        : a.snapshotKind
          ? `the bank quoted a ${a.snapshotKind}, not a balance`
          : 'no balance from the bank, and SMS history alone cannot be trusted';
    out.push(`    ${accountLabel(a.id)}  — ${why}`);
  }
  out.push('');

  // The double-count check. Same last four on more than one account that
  // CONTRIBUTES is the shape of the bug; same last four where only one
  // contributes is harmless and is shown anyway so nothing looks hidden.
  const byLast4 = new Map<string, AppState['accounts']>();
  for (const a of state.accounts) {
    if (!a.last4) continue;
    byLast4.set(a.last4, [...(byLast4.get(a.last4) ?? []), a]);
  }
  const shared = [...byLast4.entries()].filter(([, list]) => list.length > 1);
  out.push(`  SAME LAST FOUR ON MORE THAN ONE ACCOUNT (${shared.length})`);
  if (!shared.length) out.push('    none — every account has a distinct last four');
  for (const [last4, list] of shared) {
    // A contributor is one adding a NON-ZERO figure. A manual account with no
    // history is legitimately zero, and zero cannot be double-counted — letting
    // it qualify fired this warning on pairs where nothing was at stake, which
    // is how a warning stops being read.
    const contributors = list.filter((a) => !a.archived && (contribution(a) ?? 0) !== 0);
    const flag =
      contributors.length > 1
        ? '   <-- MORE THAN ONE OF THESE IS COUNTED. If they are one physical card, its balance is in the total more than once.'
        : '';
    out.push(`    ·${last4}${flag}`);
    for (const a of list) {
      const fils = contribution(a);
      const counts = !a.archived && fils !== null;
      out.push(
        `      ${counts ? `${fils < 0 ? '-' : '+'}${fmt(Math.abs(fils))}` : 'not counted'}` +
          `  ${a.name}  ${a.cardType ?? 'unknown type'}  bank ${a.bankName ?? '—'}`,
      );
    }
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

/**
 * Why the list came back empty — which is not always good news.
 *
 * Both functions above start from `tx.raw`, and there are two whole classes of
 * device where raw is absent for reasons that have nothing to do with how well
 * the parser did:
 *
 *  - **The iOS relay never delivers it.** The Worker drops Message Content
 *    before sealing the row, which is why `ParsedRelayRow` in relay.ts is
 *    typed `raw?: never`. Every row on an iPhone therefore carries no source
 *    text, `unreadFormatCount` is structurally 0, and Settings answered
 *    "Everything reads clean" — a clean bill of health for a check that never
 *    ran, on the one platform whose parser feedback never reaches anyone.
 *  - **Private mode strips it.** store.tsx keeps `raw: base.privateMode ?
 *    undefined : t.raw`, so an Android user who chose local-only retention is
 *    told the same thing for the same wrong reason.
 *
 * Zero-because-clean and zero-because-blind are opposite facts and the screens
 * have to be able to tell them apart, so this returns the reason rather than a
 * boolean.
 *
 * The platform flag is passed IN rather than read here: this module is
 * compiled and exercised in the Node test build, which has no react-native,
 * and `isRelayPlatform()` in relay.ts is already the single definition of it.
 *
 * iOS is checked FIRST on purpose. Turning private mode off on an iPhone does
 * not bring the text back — nothing does — so naming private mode there would
 * point the user at a switch that cannot fix it.
 */
export type NoFormatsReason = 'none-found' | 'relay' | 'private';

export function noFormatsReason(opts: {
  relayPlatform: boolean;
  privateMode: boolean;
}): NoFormatsReason {
  if (opts.relayPlatform) return 'relay';
  if (opts.privateMode) return 'private';
  return 'none-found';
}

/* ═══════════════════ How well the parser read THIS ledger ═══════════════════
 *
 * Everything above this line answers "which formats can I report?", and it can
 * only answer it where the source text survived. Nobody ever learns the parser
 * is failing except by a user writing in: two have, and the third never will.
 *
 * The app already holds the answer. Every row it imported carries what the
 * parser made of that message — a shop name or the generic fallback, a
 * category or the neutral one — and those fields arrive on EVERY platform,
 * including the relay, which strips only the message body. So the measurement
 * below works on the phones where `unreadFormats` is structurally blind, which
 * is exactly where the feedback was never reaching anyone.
 *
 * THE DENOMINATOR IS THE WHOLE PROBLEM. A metric that reads correct behaviour
 * as failure gets dismissed the first time a user looks at it, and then it is
 * worth less than nothing. So a row is measured only when there was something
 * for the parser to get right:
 *
 *  - **Manual rows are not the parser's work.** `source !== 'sms'` (which
 *    includes pre-v2 rows, where absent means manual) measures the user.
 *  - **Transfers and card payments name no shop.** Money moving between the
 *    user's own places has no merchant and no spending category; `isTransfer`
 *    and `cardPaymentSide` are how the ledger already says so.
 *  - **Structurally-titled rows are understood.** `STRUCTURAL_TITLES` is the
 *    parser's own list of "I know exactly what this is, and no shop is named
 *    in it" — ATM withdrawal, Bank fee, VAT fee, Cheque, Refund. Counting
 *    those as misses is what buried the real ones in the 177-entry export.
 *    'Card statement', 'Bill payment' and the 'Card •1234 payment' shape are
 *    the same thing under different names; `namesNoMerchant()` in sms-parser
 *    is the sibling of the check below.
 *  - **Income is not a purchase.** `categoryOf` can only answer salary,
 *    business, or a DELIBERATE other (a refund, a reversal, a chargeback,
 *    cashback, bank interest). Its one non-deliberate income answer is
 *    reserved for structural titles, which are already out. So every `other`
 *    on a surviving credit is an answer, not a shrug, and including credits
 *    would only ever count deliberate behaviour as failure. This also keeps
 *    the measurement in step with `lowConfidence` in import-plan.ts, which
 *    gates on `type === 'expense'` for the same reason.
 *  - **A row the user corrected no longer reports on the parser.** Counting a
 *    hand-typed shop name as a parser success is the vanity direction, and it
 *    is the one that makes a number untrustworthy.
 *  - **A category the user decided is decided.** `merchantOverrides` is the
 *    stored half of `categoryDeliberate`: if the user pinned this merchant to
 *    a category — `other` included — the parser is not being asked.
 *
 * WHAT IS STILL COUNTED PESSIMISTICALLY, on purpose. `categoryDeliberate` is
 * computed during parsing and never written to the ledger, so the handful of
 * expense rules that answer `other` DELIBERATELY (a card-verification
 * `wallet temp` hold, the bank's own Liv. Prime fee, a bare PayPal
 * verification) cannot be told apart here from a row that simply failed every
 * rule, and they read as category misses. That is a few rows in a ledger of
 * hundreds, and it errs toward reporting a miss that is not one rather than
 * hiding one that is — the safe direction for a number whose entire job is to
 * surface failure.
 *
 * Nothing here leaves the device. This is a measurement the user can read
 * about their own phone, not telemetry.
 */

/** Titles the parser mints for rows that name no shop and never could. */
const NO_MERCHANT_TITLES = new Set(['Card statement', 'Bill payment']);

/** The 'Card •1234 payment' shape, minted per card so it cannot be a set. */
const CARD_PAYMENT_TITLE_RE = /^Card •/;

function namesNoMerchant(title: string): boolean {
  const t = title.trim();
  return STRUCTURAL_TITLES.has(t) || NO_MERCHANT_TITLES.has(t) || CARD_PAYMENT_TITLE_RE.test(t);
}

export interface ParserCoverage {
  /** Ledger rows the parser itself wrote, from a bank message. */
  imported: number;
  /**
   * Of `imported`, rows where there was nothing for the parser to get right —
   * transfers, card payments, structural rows, credits, and rows the user has
   * since corrected. Reported so the two figures below can be read against a
   * denominator the user can see rather than one they have to trust.
   */
  skipped: number;
  /** Purchases where a shop name was expected. Never a divisor without a guard. */
  measured: number;
  /** Of `measured`, rows carrying a real merchant rather than the fallback. */
  named: number;
  /** Of `measured`, rows whose category the parser was actually asked for. */
  categoryMeasured: number;
  /** Of `categoryMeasured`, rows filed under something other than `other`. */
  categorised: number;
}

/**
 * How much of this ledger the parser actually read — computed on the device,
 * from the device's own rows. Pure: no clock, no platform, no I/O.
 *
 * See the block comment above for what is in the denominator and why. Both
 * figures are returned as counts, never as a ratio: "492 of 505" is something
 * a person can act on and check, and 97% is not.
 */
export function parserCoverage(state: {
  transactions: Transaction[];
  merchantOverrides?: AppState['merchantOverrides'];
}): ParserCoverage {
  const overrides = state.merchantOverrides ?? {};
  const cov: ParserCoverage = {
    imported: 0,
    skipped: 0,
    measured: 0,
    named: 0,
    categoryMeasured: 0,
    categorised: 0,
  };

  for (const tx of state.transactions) {
    // Absent `source` means manual — pre-v2 data, entered by hand. Either way
    // the parser never saw it.
    if (tx.source !== 'sms') continue;
    cov.imported += 1;

    if (
      tx.isTransfer ||
      tx.cardPaymentSide !== undefined ||
      tx.type !== 'expense' ||
      tx.userEdited ||
      namesNoMerchant(tx.title)
    ) {
      cov.skipped += 1;
      continue;
    }

    cov.measured += 1;
    if (tx.title !== GENERIC_MERCHANT) cov.named += 1;

    // The user's own pin on this merchant IS the decision, so there is no
    // parser guess left to score. Same trim/lowercase key the parser reads
    // overrides by, or the two would disagree about which rows are pinned.
    if (overrides[tx.title.trim().toLowerCase()] !== undefined) continue;
    cov.categoryMeasured += 1;
    if (tx.category !== 'other') cov.categorised += 1;
  }

  return cov;
}
