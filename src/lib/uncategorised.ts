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
   * change: the reducer matches `t.title.trim().toLowerCase() === key`.
   */
  key: string;
  /** What to put on screen: the spelling these rows most often arrive with. */
  merchant: string;
  /** How many rows carry this merchant. One tap moves all of them. */
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
 */
export function uncategorisedMerchants(state: AppState): UncategorisedSummary {
  const live = liveAccountIds(state.accounts);
  const internal = internalTransferIds(state.transactions, live);

  // Spelling counts are kept per group so the displayed name is the one the
  // user has actually seen most, not whichever arrived first. Banks send the
  // same shop as "CARREFOUR HYPER" and "Carrefour Hyper Dubai" often enough
  // that first-wins picks a stranger.
  interface Group extends UncategorisedMerchant {
    spellings: Map<string, number>;
  }
  const groups = new Map<string, Group>();

  for (const t of state.transactions) {
    if (!isCandidate(t, state.merchantOverrides, live, internal)) continue;
    const title = t.title.trim();
    const key = title.toLowerCase();
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
