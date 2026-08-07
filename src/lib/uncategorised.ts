/**
 * The merchants the app knows by name but not by kind.
 *
 * WHY THIS EXISTS. The parser is good at reading a merchant NAME out of a bank
 * SMS and structurally incapable of knowing what that merchant SELLS. No rule
 * list will ever contain "AL BAIT ALHAMAWI SUP" — there are hundreds of
 * thousands of shops in this market and a new one opens every day. One real
 * export carried 182 transactions with a perfectly correct merchant name and
 * the category `other`. That number is not a parser defect that a release can
 * fix; it grows with every user, and no user is going to email their SMS
 * inbox to a developer.
 *
 * The app already has the machinery to fix it: `setMerchantOverride(merchant,
 * category, applyToExisting)` learns a merchant → category rule and, when
 * asked, rewrites every row that already carries that merchant. Until now it
 * only fired if the user happened to OPEN the one row. This module inverts
 * that: here is the list of merchants that need a category, ranked, so the
 * user can spend one tap each and be done forever.
 *
 * PURE ON PURPOSE. No react-native, no expo, no store — same split as
 * daily-summary.ts and reminders.ts, and for the same reason: the part that
 * can be wrong (which rows count, what the totals are, what order they come
 * in) has to be reachable from `scripts/test`, and anything importing a native
 * module is not.
 */
import { internalTransferIds, isSpending, liveAccountIds } from '@/lib/ledger';
import { STRUCTURAL_TITLES } from '@/lib/sms-parser';
import type { AppState, Transaction } from '@/lib/types';

/**
 * The parser's own words for "a card was charged and the message never named
 * a payee". It is not a merchant, so it must never become an override: a rule
 * keyed on "Card purchase" would file every future unnamed charge in this
 * market under whatever the user picked once.
 *
 * Spelled here rather than imported because sms-parser.ts keeps it as a bare
 * literal at its several fallback sites and accuracy.ts keeps its own copy for
 * the same reason. `heal.ts` tests the same string.
 */
const GENERIC_MERCHANT = 'Card purchase';

/**
 * A merchant whose rows are sitting in `other` and could be moved with one
 * tap.
 */
export interface UncategorisedMerchant {
  /**
   * The key `setMerchantOverride` stores rules under — the title trimmed and
   * lowercased. Grouping on this rather than on the displayed spelling is what
   * makes the count on the row equal the number of rows the tap will actually
   * change: the reducer matches on this key through `overrideAppliesTo`.
   */
  key: string;
  /** What to put on screen: the spelling these rows most often arrive with. */
  merchant: string;
  /**
   * How many rows this merchant's tap MOVES — `overrideAppliesTo`, not
   * candidacy. See that predicate for why the two are different questions and
   * why this number is the one printed on the row.
   */
  count: number;
  /** What those rows add up to, in fils. */
  totalFils: number;
  /** Newest of those rows, so the screen can say when it was last seen. */
  lastDate: string;
}

/** The whole answer: the ranked list, plus what it is worth in total. */
export interface UncategorisedSummary {
  /** Ranked — see `rank` below. Empty when there is nothing to assign. */
  merchants: UncategorisedMerchant[];
  /** Rows that would be recategorised if every merchant here were assigned. */
  rowCount: number;
  /** What those rows add up to, in fils. */
  totalFils: number;
}

/**
 * Below this many merchants, Home says nothing.
 *
 * The same reasoning as `REPORT_PROMPT_THRESHOLD` in accuracy.ts, which is
 * worth repeating because it is the whole difference between a prompt and a
 * nag. One or two unknown merchants is the normal steady state of a working
 * parser — a shop nobody has ever heard of, seen once. Surfacing a row on the
 * first screen of the app for that teaches the user that this row is noise,
 * and the cost is paid later, on the day the list is forty merchants deep and
 * genuinely worth two minutes. A prompt that is always there is a prompt that
 * is never read.
 *
 * Three is also the point where the SCREEN is a better tool than the ledger:
 * one or two merchants are faster to fix by tapping the rows the user is
 * already looking at.
 */
export const CATEGORISE_PROMPT_THRESHOLD = 3;

/**
 * Merchants sitting in `other`, ranked, with what each one is worth.
 *
 * RANKING: total money, with the row count as the tiebreak.
 *
 * The alternative was occurrence count, and the argument for money is that
 * money ALREADY CONTAINS the count — `totalFils` is count × average, so a
 * merchant seen 33 times ranks high the moment those 33 charges amount to
 * anything. Ranking on count alone throws the amount away entirely, and the
 * result is a list led by the AED 3 parking barrier seen forty times while an
 * AED 9,000 clinic sits below the fold. The user taps the barrier, watches
 * their Flow breakdown move by nothing, and stops.
 *
 * The point of a category is to divide MONEY. A merchant is worth a tap in
 * proportion to how much of the user's spending is currently unattributed to
 * it, and that is exactly `totalFils`.
 *
 * Count is the tiebreak rather than the ranking because of what it predicts:
 * between two merchants holding the same amount, the one seen more often is
 * the one more likely to be seen AGAIN, so the rule bought by that tap keeps
 * paying. And the merchant name is the final tiebreak so the order is stable
 * across renders rather than dependent on ledger insertion order.
 *
 * WHAT IS EXCLUDED, and why each one would otherwise be a wrong question to
 * put in front of the user:
 *
 *  - **Income.** This is about spending. An `other` credit is a refund, a
 *    reversal or a payer the parser could not name — all of which the parser
 *    marks deliberate, none of which a merchant category improves.
 *  - **Transfers**, both the flagged kind and the two halves of a move between
 *    the user's own accounts. That money was never spent; asking what kind of
 *    shop it was has no answer.
 *  - **Structural titles** (`STRUCTURAL_TITLES`): "ATM withdrawal", "Bank
 *    fee", "Cheque". These are the parser's own vocabulary for "there is no
 *    payee in this message", not a shop that failed to be recognised. An
 *    override on one is a rule about the app's own words.
 *  - **The generic "Card purchase"** fallback, for the same reason and more
 *    sharply: it is the title on every charge whose merchant was never found,
 *    so a rule keyed on it is a rule about unrelated strangers.
 *  - **Merchants already in `state.merchantOverrides`.** The user has answered
 *    this one. If rows still read `other` it is because the answer WAS
 *    `other`, or the rule was set for future rows only — either way, asking
 *    again is asking a question that has been answered.
 *  - **Rows the user edited by hand** (`userEdited`). `other` on one of those
 *    is a decision, not a gap. This is the persisted stand-in for the parser's
 *    `categoryDeliberate`, which never reaches storage: `ParsedSms` carries it
 *    but `Transaction` has no such field, so at read time the deliberate cases
 *    are exactly the three above — transfer, structural title, user decision.
 *  - **Split rows.** Their categories were assigned by hand, part by part.
 *  - **Archived accounts**, via `isSpending`. Hiding a card hides its rows
 *    everywhere else; it must not go on generating chores here.
 *  - **Titles under three characters**, which is the same floor
 *    `entry-detail-sheet.tsx` puts on offering to remember a merchant. A
 *    one-letter override key would match far too much.
 *
 * TWO QUESTIONS, TWO PREDICATES, AND THEY ARE NOT THE SAME QUESTION. The list
 * above answers "should we put this merchant in front of the user at all".
 * `count`, `totalFils` and `lastDate` answer something else: "what does this
 * tap MOVE". `isCandidate` decides the first, `overrideAppliesTo` decides the
 * second, and the rows are gathered in two passes accordingly — candidacy
 * picks the keys, the override predicate fills in the numbers printed beside
 * them. Conflating them is what shipped a screen that said "TALABAT · 2
 * entries" over a tap that rewrote five.
 */
export function uncategorisedMerchants(state: AppState): UncategorisedSummary {
  const live = liveAccountIds(state.accounts);
  const internal = internalTransferIds(state.transactions, live);

  // Pass 1 — WHICH MERCHANTS ARE WORTH ASKING ABOUT. Candidacy only; nothing
  // here is counted or totalled, because a candidate row is evidence that the
  // merchant needs a category, not a measure of what answering costs.
  const asked = new Set<string>();
  for (const t of state.transactions) {
    if (isCandidate(t, state.merchantOverrides, live, internal)) {
      asked.add(t.title.trim().toLowerCase());
    }
  }

  // Pass 2 — WHAT EACH TAP MOVES. Exactly the rows `setMerchantOverride`
  // rewrites, by the same predicate the reducer uses.
  //
  // Spelling counts are kept per group so the displayed name is the one the
  // user has actually seen most, not whichever arrived first. Banks send the
  // same shop as "CARREFOUR HYPER" and "Carrefour Hyper Dubai" often enough
  // that first-wins picks a stranger.
  interface Group extends UncategorisedMerchant {
    spellings: Map<string, number>;
  }
  const groups = new Map<string, Group>();

  for (const t of state.transactions) {
    const title = t.title.trim();
    const key = title.toLowerCase();
    if (!asked.has(key)) continue;
    if (!overrideAppliesTo(t, key)) continue;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        merchant: title,
        count: 0,
        totalFils: 0,
        lastDate: t.date,
        spellings: new Map(),
      };
      groups.set(key, g);
    }
    g.count += 1;
    g.totalFils += t.amountFils;
    if (t.date > g.lastDate) g.lastDate = t.date;
    g.spellings.set(title, (g.spellings.get(title) ?? 0) + 1);
  }

  const merchants: UncategorisedMerchant[] = [];
  let rowCount = 0;
  let totalFils = 0;
  for (const g of groups.values()) {
    let best = g.merchant;
    let bestSeen = 0;
    for (const [spelling, seen] of g.spellings) {
      if (seen > bestSeen) {
        best = spelling;
        bestSeen = seen;
      }
    }
    merchants.push({
      key: g.key,
      merchant: best,
      count: g.count,
      totalFils: g.totalFils,
      lastDate: g.lastDate,
    });
    rowCount += g.count;
    totalFils += g.totalFils;
  }

  merchants.sort(
    (a, b) => b.totalFils - a.totalFils || b.count - a.count || a.key.localeCompare(b.key),
  );

  return { merchants, rowCount, totalFils };
}

/**
 * Is this one row a piece of evidence that a merchant needs a category?
 *
 * Split out so the exclusion list is one readable sequence rather than a
 * condition buried in an accumulator loop. Every clause is explained on
 * `uncategorisedMerchants` above.
 */
function isCandidate(
  t: Transaction,
  overrides: Record<string, unknown>,
  live: Set<string>,
  internal: Set<string>,
): boolean {
  if (t.category !== 'other') return false;
  if (t.type !== 'expense') return false;
  if (!isSpending(t, live, internal)) return false;
  // Named explicitly even though a card-payment leg is normally flagged
  // `isTransfer` too, so that candidacy stays a strict subset of
  // `overrideAppliesTo`. A merchant on the list whose tap moves nothing would
  // be an unanswerable question printed as "0 entries".
  if (t.cardPaymentSide !== undefined) return false;
  if (t.userEdited) return false;
  if (t.splits && t.splits.length > 0) return false;

  const title = t.title.trim();
  if (title.length < 3) return false;
  if (title === GENERIC_MERCHANT) return false;
  if (STRUCTURAL_TITLES.has(title)) return false;
  if (overrides[title.toLowerCase()] !== undefined) return false;
  return true;
}

/**
 * Does the merchant rule stored under `key` rewrite THIS row?
 *
 * ONE DEFINITION, THREE CALLERS. The `setMerchantOverride` reducer in
 * store.tsx, `sameMerchantCount` in entry-detail-sheet.tsx and `count` above
 * all have to agree, because two of them PRINT a number and the third acts on
 * it. They did not: the reducer matched the bare key and rewrote everything
 * that carried it, while the screen counted through `isCandidate`, which drops
 * rows on purpose. Five rows titled TALABAT — two plain `other` expenses, one
 * hand-filed under `dining`, one income refund, one on an archived card —
 * printed "2 entries" over a tap that rewrote all five, reverting the hand
 * filing and stamping an expense category onto income. `key` is already
 * trimmed and lower-cased by the caller, exactly as the store stores it.
 *
 * WHAT IS EXCLUDED, and why the reducer must not touch it:
 *
 *  - **`userEdited` rows.** store.tsx states the invariant out loud — every
 *    transaction transform treats `userEdited` as immutable — and every other
 *    transform in that file honours it. A user who hand-filed one TALABAT
 *    charge under `dining` answered this question already; a merchant rule is
 *    a default, and a default does not get to overrule an answer. This is also
 *    the exact exclusion `isCandidate` makes ("a decision, not a gap"), so
 *    honouring it there and ignoring it here meant the screen refused to ask
 *    about a row it then went and rewrote.
 *  - **Anything that is not an expense.** `EXPENSE_CATEGORIES` and
 *    `INCOME_CATEGORIES` are disjoint sets. Stamping `shopping` on a TALABAT
 *    refund does not merely mis-file it, it puts the row off-list: reopen it
 *    and the sheet renders the income chips, none of them selected, so the
 *    category it actually holds is invisible to the person trying to fix it.
 *  - **Transfers and card-payment legs.** Neither is spending, so "what kind
 *    of shop was this" has no answer to apply.
 *  - **Split rows.** Their parts were allocated by hand, and `category` on a
 *    split row is not a free-standing label — types.ts pins it to the largest
 *    part. Overwriting it desynchronises the row from its own splits.
 *
 * WHAT IS DELIBERATELY INCLUDED, and where that makes this WIDER than
 * candidacy — which is correct, not a leak:
 *
 *  - **Rows already carrying a non-`other` category.** An override means "this
 *    merchant is Shopping", full stop. Re-filing a row the parser guessed into
 *    `dining` is the feature working, not a misfire; the user is overruling a
 *    guess, which is precisely what they came to the screen to do.
 *  - **Rows on archived accounts.** The merchant → category mapping is global
 *    and those rows still render everywhere they always did. `isCandidate`
 *    excludes them from the LIST so that hiding a card stops it generating
 *    chores, and that is a different decision from letting a rule the user did
 *    set skip half its rows.
 *
 * So `count` is legitimately larger than the number of candidate rows behind
 * a merchant. That is the point: candidacy answers "should we nag about this
 * merchant", `count` answers "what does this tap move".
 */
export function overrideAppliesTo(t: Transaction, key: string): boolean {
  if (t.title.trim().toLowerCase() !== key) return false;
  if (t.userEdited) return false;
  if (t.type !== 'expense') return false;
  if (t.isTransfer) return false;
  if (t.cardPaymentSide !== undefined) return false;
  if (t.splits && t.splits.length > 0) return false;
  return true;
}

/**
 * Is it worth interrupting Home for this?
 *
 * A separate question from "what is on the list", and it is asked separately
 * because the answer has a floor under it — see `CATEGORISE_PROMPT_THRESHOLD`.
 * Home calls this; the screen itself does not, because a user who has opened
 * the screen has asked, and showing them one merchant they can fix is a better
 * answer than showing them nothing.
 */
export function worthPrompting(summary: UncategorisedSummary): boolean {
  return summary.merchants.length >= CATEGORISE_PROMPT_THRESHOLD;
}
