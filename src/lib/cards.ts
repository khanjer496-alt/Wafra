import { reliableBalanceFils } from '@/lib/balances';
import { toISODate } from '@/lib/format';
import { tf, type Lang } from '@/lib/i18n';
import { isSpending } from '@/lib/ledger';
import type { Account, AppState, CardDue, Transaction } from '@/lib/types';

export type DueStatus = 'overdue' | 'urgent' | 'upcoming' | 'settled';

export interface DueWithStatus {
  due: CardDue;
  status: DueStatus;
  /** Days until dueDate; negative when overdue. */
  daysLeft: number;
  /** What is still owed on this statement after payments. */
  remainingFils: number;
  /** True while payments are below a minimum the bank actually stated. */
  belowMinimum: boolean;
  /** False when the bank never stated a minimum, so `due.minDueFils` is a
   *  fallback estimate rather than a figure. Never present it as one. */
  minimumKnown: boolean;
  /** Long overdue and kept only because no later statement replaced it. */
  stale: boolean;
}

/**
 * Accounting identity is the persisted account id, never inferred card data.
 *
 * Bank, last four digits and card type are not a unique instrument identifier:
 * two active cards can legitimately share all three. Empty parser artifacts
 * are removed by `mergeDuplicateAccounts`, and a user-confirmed reissue/link
 * is physically remapped by `mergeRenewedCard`. Until one of those operations
 * has happened, pooling dues or payments would silently move money between two
 * possibly real cards.
 */
/**
 * The minimum a UAE bank asks for when the statement did not say.
 *
 * A guess, and the app must never present it as the bank's figure — which is
 * what `minDueEstimated` and `minimumKnown` are for. It lives here rather
 * than at the import site because two places that must agree about what an
 * "estimated minimum" IS is exactly the arrangement that goes wrong quietly:
 * change one and the estimate stops matching the thing that decides whether
 * to trust it.
 */
export const ESTIMATED_MINIMUM_RATE = 0.05;

/* ── Memoisation ─────────────────────────────────────────────────────────
 *
 * WHY THIS FILE, AND WHY IDENTITY.
 *
 * Everything below is a pure read of `state.accounts`, `state.transactions`
 * and `state.cardDues`. That made it easy to call from anywhere, and it was
 * called from everywhere — the cost is quadratic in a way none of the call
 * sites can see:
 *
 *  - `cardFigure` calls `openDues` and then `.find()`s one row out of it. The
 *    Wallet screen calls `cardFigure` once per card. On a real ledger — 49
 *    accounts, 14 statements, 14,500 rows — that is 17 full payment
 *    allocations, each walking the whole ledger once per statement, to answer
 *    17 questions that share one answer. Measured at 45ms on desktop V8, which
 *    on Hermes is most of a second of blocked JS on every render of the tab.
 *  - `accountLastActivityISO` walks all 14,500 rows for ONE account id, and
 *    `isInactiveAccount` calls it per account while Wallet filters the list.
 *  - `leavingSoon` calls `openDues` again in the same render pass Home already
 *    called it, and Bills calls it a third time.
 *
 * The store is a reducer: every mutation produces new arrays, and nothing
 * writes through an existing one. So array IDENTITY is an exact, free change
 * detector — `===` on three references decides whether last frame's answer is
 * still the right answer. Not a heuristic; if any of the three inputs changed,
 * the reference changed with it.
 *
 * One entry each, deliberately. These are render-path caches: the question
 * asked 17 times in a row is the same question, and the frame after a
 * dispatch asks a different one. A larger cache would hold ledgers nobody is
 * looking at anymore.
 */

/** Identity of everything a card derivation can read. */
interface CardInputs {
  accounts: Account[];
  transactions: Transaction[];
  cardDues: CardDue[];
}

function sameInputs(a: CardInputs, b: CardInputs): boolean {
  return (
    a.accounts === b.accounts &&
    a.transactions === b.transactions &&
    a.cardDues === b.cardDues
  );
}

let openDuesCache: (CardInputs & { day: string; value: DueWithStatus[] }) | null = null;
let paymentsCache: { transactions: Transaction[]; accounts: Account[]; byKey: Map<string, Transaction[]> } | null =
  null;
let activityCache: { transactions: Transaction[]; byAccount: Map<string, string> } | null = null;

export function estimatedMinimumFils(totalFils: number): number {
  return Math.round(totalFils * ESTIMATED_MINIMUM_RATE);
}

export function cardIdentity(_accounts: Account[]): (accountId: string) => string {
  return (accountId: string) => `id:${accountId}`;
}

/**
 * Merge statement rows at the ingestion boundary.
 *
 * A parser-version rescan can see the same reminder again, and several UAE
 * banks send both an issue alert and a due-date reminder. Those are one
 * statement only when the resolved account id and due date both agree.
 * Payment evidence is monotonic and is never reset by a reminder whose
 * imported `paidFils` starts at zero.
 */
export function mergeImportedCardDues(
  existing: CardDue[],
  incoming: CardDue[],
  accounts: Account[],
): CardDue[] {
  const keyOf = cardIdentity(accounts);
  const merged: CardDue[] = [];

  for (const due of [...existing, ...incoming]) {
    const key = `${keyOf(due.accountId)}|${due.dueDate}`;
    const at = merged.findIndex((row) => `${keyOf(row.accountId)}|${row.dueDate}` === key);
    if (at < 0) {
      merged.push(due);
      continue;
    }

    const prior = merged[at];
    const priorKnown = !prior.minDueEstimated;
    const nextKnown = !due.minDueEstimated;
    // A figure the bank stated always beats one this app guessed. Between two
    // figures the bank BOTH stated, the later one is its correction of the
    // earlier — `existing` is walked before `incoming`, so `due` is the fresher
    // reading. Math.max here meant a bank revising a minimum DOWN never landed,
    // and `belowMinimum` went on accusing the user of underpaying against a
    // figure the bank itself had superseded. Two positive guesses still take
    // the larger: neither is evidence, and the larger one is the safer thing
    // to show. A newer zero estimate is different: zero is the explicit
    // "minimum not stated" sentinel used where no market-specific estimate is
    // valid, so it removes an older invented fallback instead of merging it.
    const minimum =
      priorKnown && !nextKnown
        ? prior.minDueFils
        : !priorKnown && nextKnown
          ? due.minDueFils
          : priorKnown && nextKnown
            ? due.minDueFils
            : due.minDueFils === 0
              ? 0
              : Math.max(prior.minDueFils, due.minDueFils);
    const settledAt = [prior.settledAt, due.settledAt]
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1);

    merged[at] = {
      ...prior,
      totalDueFils: Math.max(prior.totalDueFils, due.totalDueFils),
      minDueFils: minimum,
      minDueEstimated: priorKnown || nextKnown ? undefined : true,
      paidFils: Math.max(prior.paidFils, due.paidFils),
      settledAt,
    };
  }

  return merged;
}

/**
 * The account ids whose payments may settle `accountId`.
 *
 * Confirmed links are remapped before accounting runs, so a surviving account
 * id is the only safe member. Similar bank metadata is never proof of identity.
 */
function cardAccountIds(state: AppState, accountId: string): Set<string> {
  const keyOf = cardIdentity(state.accounts);
  const key = keyOf(accountId);
  const ids = new Set<string>([accountId]);
  for (const a of state.accounts) if (keyOf(a.id) === key) ids.add(a.id);
  return ids;
}

/**
 * Money arriving on a card, whichever direction it was stored in.
 *
 * The income-side transfer is the shape the importer produces today. The
 * expense side is the shape it produced for years: a card payment whose
 * wording the parser did not recognize was imported as an EXPENSE carrying a
 * transfer hint, and `allocatePayments` credited income-side rows only, so
 * those statements could never settle.
 *
 * Those rows cannot heal themselves. `raw` is kept only for rows that look
 * low-confidence, and a transfer hint disqualifies a row from that — so the
 * launch-time re-parse, which reads `raw`, never sees them. They are reachable
 * only by a full inbox re-read, which needs both the message still in the
 * inbox and a PARSER_VERSION bump.
 *
 * Reading them here costs nothing, because on a CREDIT CARD a transfer can
 * only be a payment toward the card: purchases are plain expenses and the
 * bank-side leg of the payment is filed against the bank account, not this
 * one. (A cash transfer out of a card would be misread as a payment. No
 * message in the corpus takes that shape, and one that did would have to have
 * been read as a transfer to get here.)
 */
/**
 * The single eligibility rule for "is this transaction a payment toward this
 * card" — shared by every caller that allocates, totals, or lists payments.
 * `cardStatementView` used to run its own, narrower copy for the payments it
 * *displayed* while `duePaidFils` allocated through this one, so a statement
 * could be marked paid by a compat-branch row that never appeared in the
 * "Payments Made" list and never counted toward `paidTotalFils` — outstanding
 * said settled while the total shown next to it said otherwise.
 */
function isCardPayment(t: Transaction, ids: Set<string>, creditIds: Set<string>): boolean {
  return (
    t.isTransfer === true &&
    ids.has(t.accountId) &&
    // Nothing in a group with no credit card in it can be a payment TOWARD a
    // card, because there is no bill to pay. Without this, the income branch
    // below read every incoming transfer to a current account as a settlement:
    // a user's Liv DEBIT card •4822 showed "Payments made 360,054" — their
    // salary, their deposits, and the inbound leg of their own outgoing
    // telegraphic transfers — under a Statements section that said, honestly
    // and forever, "no statement message has arrived for this card yet". A
    // debit card does not issue statements, so that section could never
    // resolve and the figure beside it could never be right.
    //
    // Deliberately keyed on the GROUP, not on `t.accountId`. One physical card
    // can appear as both a debit and a credit row (see cardAccountIds), and a
    // real settlement is often filed against the debit sibling — narrowing to
    // `creditIds.has(t.accountId)` here would drop those.
    creditIds.size > 0 &&
    (t.cardPaymentSide !== undefined ||
      t.type === 'income' ||
      // Older builds stored card payments in the wrong direction. Keep
      // that compatibility path, but only for a row whose title says it
      // is a card settlement. Treating every transfer OUT of a credit card
      // as a payment can falsely settle the bill after a cash transfer.
      (creditIds.has(t.accountId) &&
        /(?:card.*(?:payment|settlement)|(?:payment|settlement).*card)/i.test(t.title)))
  );
}

function cardPaymentsOf(state: AppState, ids: Set<string>): Transaction[] {
  // The full-ledger filter + sort, memoised per card. `allocatePayments` runs
  // once per statement and `openDues` runs it for all of them, so on a ledger
  // with several statements per card this is the same walk repeated. The key
  // is the id set, sorted so it does not depend on insertion order.
  const key = [...ids].sort().join(',');
  if (
    !paymentsCache ||
    paymentsCache.transactions !== state.transactions ||
    paymentsCache.accounts !== state.accounts
  ) {
    paymentsCache = {
      transactions: state.transactions,
      accounts: state.accounts,
      byKey: new Map(),
    };
  }
  const hit = paymentsCache.byKey.get(key);
  if (hit) return hit;

  const creditIds = new Set(
    state.accounts.filter((a) => a.cardType === 'credit' && ids.has(a.id)).map((a) => a.id),
  );
  const matched = state.transactions.filter((t) => isCardPayment(t, ids, creditIds));

  /**
   * One settlement, two rows, counted as two payments.
   *
   * A reported ledger had AED 5,645.07 paid onto card •3749 and BOTH of these
   * against it on the same day:
   *
   *   +5,645.07  Card •3749 payment   [transfer] [debit]
   *   -5,645.07  Card payment         [transfer]
   *
   * The first is a settlement the parser recognised. The second is the
   * compatibility shape this function deliberately still reads — a payment
   * whose wording the parser could not place, imported as an expense carrying
   * a transfer hint. Both pass `isCardPayment`, so allocation saw AED
   * 11,290.14 of payments against a AED 5,645.07 statement.
   *
   * It settled the right statement, because `allocatePayments` never takes
   * more than a statement owes. The surplus is the problem: it spills onto the
   * NEXT statement and marks a bill paid that nobody paid.
   *
   * A sided row is the parser's considered answer about a settlement. An
   * unsided compat row on the same card, same day, same amount is that same
   * money read a second time, less well — so the sided row wins and the compat
   * row is dropped.
   *
   * Same DATE, not a window. Both rows here describe one movement and carry
   * its date; widening to ±1 day would start collapsing genuine repeat
   * payments, and this direction of error is the cheap one — dropping a real
   * second payment leaves a balance showing that the user can clear with Mark
   * paid, while counting one twice quietly settles a bill they still owe.
   */
  const value = canonicalCardPayments(matched);
  paymentsCache.byKey.set(key, value);
  return value;
}

/**
 * Every distinct payment toward a credit card.
 *
 * A card settlement can be observed twice: once when money leaves the bank
 * account and once when the card acknowledges receipt. `cardPaymentsOf`
 * already owns the conservative side/manual collapsing rules used to settle
 * statements, so cash-flow reporting consumes that same answer rather than
 * inventing a second dedupe policy.
 */
export function cardPaymentRows(state: AppState): Transaction[] {
  const creditIds = new Set(
    state.accounts.filter((account) => account.cardType === 'credit').map((account) => account.id),
  );
  const byAccount = new Map<string, Transaction[]>();

  // One ledger walk, not one full walk per card. Home projects this on every
  // durable state change and a large imported inbox can hold thousands of
  // rows; multiplying that by the number of cards made a correctness figure
  // into a render-path performance regression.
  for (const transaction of state.transactions) {
    if (!creditIds.has(transaction.accountId)) continue;
    if (!isCardPayment(transaction, new Set([transaction.accountId]), creditIds)) continue;
    const rows = byAccount.get(transaction.accountId) ?? [];
    rows.push(transaction);
    byAccount.set(transaction.accountId, rows);
  }

  const canonicalEntries = [...byAccount.values()].flatMap((rows) => {
    const collapsed = canonicalCardPaymentsWithEvidence(rows);
    return collapsed.rows.map((row) => ({
      row,
      receipt: collapsed.receiptByCanonicalId.get(row.id),
    }));
  });
  const canonical = canonicalEntries.map(({ row }) => row);

  /**
   * Older builds filed the debit observation on the funding bank account and
   * the receipt observation on the card. Card allocation cannot safely attach
   * that bank row to a statement, but whole-ledger Cash out can still prove
   * that explicit opposite sides are one movement: exact amount, ±1 day, one
   * debit consumed by one receipt. Unmatched debit observations remain real
   * cash movements and are returned as their own canonical rows.
   */
  const receiptSlots = canonicalEntries
    .map(({ row, receipt }, index) => ({ row, receipt, index }))
    .filter(
      (entry): entry is { row: Transaction; receipt: Transaction; index: number } =>
        entry.receipt !== undefined,
    );
  const externalDebits = state.transactions
    .filter(
      (row) =>
        row.isTransfer === true &&
        row.cardPaymentSide === 'debit' &&
        !creditIds.has(row.accountId),
    )
    .slice()
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || (a.ts ?? 0) - (b.ts ?? 0) || a.id.localeCompare(b.id),
    );

  const receiptSlotsByAmount = new Map<number, typeof receiptSlots>();
  for (const slot of receiptSlots) {
    const bucket = receiptSlotsByAmount.get(slot.receipt.amountFils) ?? [];
    bucket.push(slot);
    receiptSlotsByAmount.set(slot.receipt.amountFils, bucket);
  }
  const externalDebitsByAmount = new Map<number, Transaction[]>();
  for (const debit of externalDebits) {
    const bucket = externalDebitsByAmount.get(debit.amountFils) ?? [];
    bucket.push(debit);
    externalDebitsByAmount.set(debit.amountFils, bucket);
  }
  const matchedExternalDebitIds = new Set<string>();
  for (const [amountFils, debits] of externalDebitsByAmount) {
    const slots = (receiptSlotsByAmount.get(amountFils) ?? []).slice().sort(
      (a, b) =>
        a.receipt.date.localeCompare(b.receipt.date) ||
        (a.receipt.ts ?? 0) - (b.receipt.ts ?? 0) ||
        a.receipt.id.localeCompare(b.receipt.id),
    );
    for (const [debitIndex, receiptIndex] of preferredObservedPairs(
      debits,
      slots.map((slot) => slot.receipt),
    )) {
      const debit = debits[debitIndex];
      const slot = slots[receiptIndex];
      matchedExternalDebitIds.add(debit.id);
      canonical[slot.index] = {
        ...slot.row,
        cashOutDate: debit.cashOutDate ?? debit.date,
        cashOutAccountId: debit.accountId,
      };
    }
  }
  for (const debit of externalDebits) {
    if (!matchedExternalDebitIds.has(debit.id)) canonical.push(debit);
  }

  return canonical;
}

function canonicalCardPayments(rows: Transaction[]): Transaction[] {
  return canonicalCardPaymentsWithEvidence(rows).rows;
}

interface CanonicalCardPaymentEvidence {
  rows: Transaction[];
  /**
   * Receipt observations survive even when a prior manual "Mark paid" row is
   * the canonical representative. Whole-ledger cash flow needs that evidence
   * to absorb the funding-bank debit instead of counting the same payment a
   * second time.
   */
  receiptByCanonicalId: ReadonlyMap<string, Transaction>;
}

function canonicalCardPaymentsWithEvidence(rows: Transaction[]): CanonicalCardPaymentEvidence {
  // Older ledgers can contain one unsided compatibility copy beside the newer
  // explicit debit/receipt evidence. Consume at most one compat copy per
  // explicit movement; a Set-based filter used to erase every same-key row,
  // including two deliberate same-day "Mark paid" taps.
  const sidedCounts = new Map<string, { debit: number; receipt: number }>();
  for (const row of rows) {
    if (row.cardPaymentSide === undefined) continue;
    const key = `${row.date}|${row.amountFils}`;
    const counts = sidedCounts.get(key) ?? { debit: 0, receipt: 0 };
    counts[row.cardPaymentSide] += 1;
    sidedCounts.set(key, counts);
  }
  const compatCopiesToConsume = new Map(
    [...sidedCounts].map(([key, counts]) => [key, Math.max(counts.debit, counts.receipt)]),
  );
  const retained = rows.filter((row) => {
    if (row.cardPaymentSide !== undefined || settlementLeg(row) === 'manual') return true;
    const key = `${row.date}|${row.amountFils}`;
    const remaining = compatCopiesToConsume.get(key) ?? 0;
    if (remaining <= 0) return true;
    compatCopiesToConsume.set(key, remaining - 1);
    return false;
  });
  return collapseSettlementLegsWithEvidence(retained);
}

/** Which half of a settlement a row is: the parser's answer, or its origin. */
type SettlementLeg = 'debit' | 'receipt' | 'manual' | 'unsided';

function settlementLeg(t: Transaction): SettlementLeg {
  if (t.cardPaymentSide) return t.cardPaymentSide;
  return t.source === 'manual' ? 'manual' : 'unsided';
}

interface OpenSettlement {
  row: Transaction;
  leg: SettlementLeg;
  keptIndex: number;
  /** Legs already folded in. One movement has one of each, never two. */
  absorbed: Set<SettlementLeg>;
  /** Bank-observed legs retained even when a manual claim stays canonical. */
  observed: Partial<Record<'debit' | 'receipt', Transaction>>;
}

/**
 * One movement, two rows, and the clock is the only thing keeping them apart.
 *
 * The rule above collapses a compat row against a sided one on the same day.
 * Two rows carrying OPPOSITE sides are the same shape of error and were not
 * caught by it at all, because both are sided. `dedupe.ts` is supposed to pair
 * them at import, but it insists the two captures be within 30 minutes of each
 * other, and the two legs of one card payment are not reliably that close:
 *
 *   'AED 1,000.00 has been debited from your account XXX0004 towards the
 *    payment of your Credit Card 1234.'                  15:00, side=debit
 *   'Payment of AED 1,000.00 received towards your Credit Card ending 1234.'
 *                                            next morning 08:00, side=receipt
 *
 * At a 29-minute gap that imported as ONE payment; at 31 minutes it imported
 * as two, and the second AED 1,000 poured into the following month's AED 800
 * statement and marked it settled. The user is shown a card that owes nothing
 * and gets no reminder for a bill they still owe — from nothing but how long
 * the bank took to send its second SMS.
 *
 * A manual "Mark paid" row is the same story told from the other end. It is by
 * construction a claim about a payment the bank is about to confirm, and it is
 * stamped with the device's today while the bank's receipt carries the
 * provider's date — so the two disagree by a day roughly whenever the payment
 * is made in the evening. dedupe.ts matches a manual row on its exact date
 * only, so that one-day skew imports the bank's confirmation as a second
 * payment of the same money.
 *
 * Both are handled here as well as at import, because a ledger that already
 * holds the phantom row cannot heal itself: the second leg is a legitimately
 * distinct SMS, so no rescan will ever decline to import it, and reading the
 * pair correctly is the only thing that puts the balance back.
 *
 * Each settlement absorbs each leg at most once, so two genuine payments that
 * both arrive in two legs stay two payments. The residual error — two
 * same-amount payments a few days apart that EACH lost a leg, folded into one
 * — is the direction this file already prefers: a payment dropped leaves a
 * balance the user can clear with Mark paid, while a payment counted twice
 * quietly settles a bill they still owe.
 *
 * THE WINDOW IS NOT ONE NUMBER, because the two cases are not one case.
 *
 * Two bank alerts are two OBSERVATIONS of a movement the bank is timestamping
 * itself, so they land within hours of each other and ±1 day is already
 * generous. Widening that would start folding genuine repeat payments — a
 * standing instruction that pays the same amount on consecutive days is a real
 * shape — so it stays at 1.
 *
 * A manual "Mark paid" row is not an observation at all. It is the user's
 * ASSERTION that this statement has been paid, stamped with the device's today,
 * and the bank's confirmation of the same money can be days away: a payment
 * initiated on a Thursday evening settles and texts on Sunday, and a user who
 * taps Mark paid when the reminder fires may be a day either side of the
 * transfer. At ±1 day the pair imported as two payments of the same money and
 * the surplus poured into the NEXT month's statement and settled it — the
 * repro is a July statement of 1,000 marked paid on the 10th, the bank's
 * receipt landing on the 12th, and August's 800 reading as nothing owed.
 *
 * So a manual claim absorbs a matching bank leg over ±7 days. It is still
 * matched on amount and card — the bucket is keyed by `amountFils` and
 * `cardPaymentsOf` has already narrowed to this card's account ids — which is
 * every axis available here; the parser captures no statement date, so
 * matching by statement is not on the table.
 */
/** Two bank alerts describing one movement. Deliberately tight — see above. */
const OBSERVED_COLLAPSE_DAYS = 1;
/** A manual claim and the bank's confirmation of it. */
const ASSERTED_COLLAPSE_DAYS = 7;

interface ObservedSettlementCluster {
  debit?: Transaction;
  receipt?: Transaction;
}

interface MatchScore {
  count: number;
  distance: number;
  pairs: [number, number][];
}

function isoDayDistance(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000;
}

/**
 * Pair two chronological observation streams without letting a locally-nearest
 * choice strand a later valid pair. The score mirrors the manual matcher:
 * preserve as many real movements as possible, then prefer the least date
 * skew among those maximum-cardinality answers.
 */
function preferredObservedPairs(
  debits: Transaction[],
  receipts: Transaction[],
): [number, number][] {
  const memo = new Map<string, MatchScore>();
  const solve = (debitIndex: number, receiptIndex: number): MatchScore => {
    if (debitIndex >= debits.length || receiptIndex >= receipts.length) {
      return { count: 0, distance: 0, pairs: [] };
    }
    const key = `${debitIndex}:${receiptIndex}`;
    const cached = memo.get(key);
    if (cached) return cached;

    const distance = isoDayDistance(debits[debitIndex].date, receipts[receiptIndex].date);
    let best: MatchScore | null = null;
    if (distance <= OBSERVED_COLLAPSE_DAYS) {
      const tail = solve(debitIndex + 1, receiptIndex + 1);
      best = {
        count: tail.count + 1,
        distance: tail.distance + distance,
        pairs: [[debitIndex, receiptIndex], ...tail.pairs],
      };
    }
    const consider = (candidate: MatchScore) => {
      if (
        best === null ||
        candidate.count > best.count ||
        (candidate.count === best.count && candidate.distance < best.distance)
      ) best = candidate;
    };
    consider(solve(debitIndex + 1, receiptIndex));
    consider(solve(debitIndex, receiptIndex + 1));
    const resolved = best ?? { count: 0, distance: 0, pairs: [] };
    memo.set(key, resolved);
    return resolved;
  };
  return solve(0, 0).pairs;
}

function observedSettlementClusters(ordered: Transaction[]): ObservedSettlementCluster[] {
  const debits = ordered.filter((row) => settlementLeg(row) === 'debit');
  const receipts = ordered.filter((row) => settlementLeg(row) === 'receipt');
  const clusters: ObservedSettlementCluster[] = [];
  const usedDebits = new Set<number>();
  const usedReceipts = new Set<number>();

  for (const [debitIndex, receiptIndex] of preferredObservedPairs(debits, receipts)) {
    usedDebits.add(debitIndex);
    usedReceipts.add(receiptIndex);
    clusters.push({ debit: debits[debitIndex], receipt: receipts[receiptIndex] });
  }
  debits.forEach((debit, index) => {
    if (!usedDebits.has(index)) clusters.push({ debit });
  });
  receipts.forEach((receipt, index) => {
    if (!usedReceipts.has(index)) clusters.push({ receipt });
  });

  return clusters.sort((a, b) => {
    const aRow = a.debit ?? a.receipt!;
    const bRow = b.debit ?? b.receipt!;
    return (
      aRow.date.localeCompare(bRow.date) ||
      (aRow.ts ?? 0) - (bRow.ts ?? 0) ||
      aRow.id.localeCompare(bRow.id)
    );
  });
}

function preferredObservedMatches(rows: Transaction[]): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  const byAmount = new Map<number, Transaction[]>();
  for (const row of rows) {
    const leg = settlementLeg(row);
    if (leg !== 'debit' && leg !== 'receipt') continue;
    const bucket = byAmount.get(row.amountFils) ?? [];
    bucket.push(row);
    byAmount.set(row.amountFils, bucket);
  }
  for (const amountRows of byAmount.values()) {
    const ordered = amountRows.slice().sort(
      (a, b) => a.date.localeCompare(b.date) || (a.ts ?? 0) - (b.ts ?? 0) || a.id.localeCompare(b.id),
    );
    const debits = ordered.filter((row) => settlementLeg(row) === 'debit');
    const receipts = ordered.filter((row) => settlementLeg(row) === 'receipt');
    for (const [debitIndex, receiptIndex] of preferredObservedPairs(debits, receipts)) {
      result.set(debits[debitIndex].id, receipts[receiptIndex].id);
      result.set(receipts[receiptIndex].id, debits[debitIndex].id);
    }
  }
  return result;
}

/**
 * Match manual claims to observed bank movements globally for each amount.
 *
 * A nearest-row greedy choice can lose cardinality: claims on days 1/2 and
 * receipts on days 8/9 must pair twice, while claims on days 1/7 and one
 * receipt on day 8 should choose day 7. The dynamic program maximizes valid
 * pairs first, then minimizes total date distance, preserving chronological
 * order. Both observed legs of one movement receive the same preferred claim.
 */
function preferredManualMatches(rows: Transaction[]): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  const byAmount = new Map<number, Transaction[]>();
  for (const row of rows) {
    const leg = settlementLeg(row);
    if (leg !== 'manual' && leg !== 'debit' && leg !== 'receipt') continue;
    const bucket = byAmount.get(row.amountFils) ?? [];
    bucket.push(row);
    byAmount.set(row.amountFils, bucket);
  }

  for (const amountRows of byAmount.values()) {
    const ordered = amountRows.slice().sort(
      (a, b) => a.date.localeCompare(b.date) || (a.ts ?? 0) - (b.ts ?? 0) || a.id.localeCompare(b.id),
    );
    const manuals = ordered.filter((row) => settlementLeg(row) === 'manual');
    const clusters = observedSettlementClusters(ordered);

    const memo = new Map<string, MatchScore>();
    const solve = (manualIndex: number, clusterIndex: number): MatchScore => {
      if (manualIndex >= manuals.length || clusterIndex >= clusters.length) {
        return { count: 0, distance: 0, pairs: [] };
      }
      const key = `${manualIndex}:${clusterIndex}`;
      const cached = memo.get(key);
      if (cached) return cached;
      const manual = manuals[manualIndex];
      const cluster = clusters[clusterIndex];
      const observed = [cluster.debit, cluster.receipt].filter(
        (row): row is Transaction => row !== undefined,
      );
      const distance = Math.min(...observed.map((row) => isoDayDistance(manual.date, row.date)));
      let best: MatchScore | null = null;
      if (distance <= ASSERTED_COLLAPSE_DAYS) {
        const tail = solve(manualIndex + 1, clusterIndex + 1);
        best = {
          count: tail.count + 1,
          distance: tail.distance + distance,
          pairs: [[manualIndex, clusterIndex], ...tail.pairs],
        };
      }
      const consider = (candidate: MatchScore) => {
        if (
          best === null ||
          candidate.count > best.count ||
          (candidate.count === best.count && candidate.distance < best.distance)
        ) best = candidate;
      };
      consider(solve(manualIndex + 1, clusterIndex));
      consider(solve(manualIndex, clusterIndex + 1));
      const resolved = best ?? { count: 0, distance: 0, pairs: [] };
      memo.set(key, resolved);
      return resolved;
    };

    for (const [manualIndex, clusterIndex] of solve(0, 0).pairs) {
      const manualId = manuals[manualIndex].id;
      const cluster = clusters[clusterIndex];
      if (cluster.debit) result.set(cluster.debit.id, manualId);
      if (cluster.receipt) result.set(cluster.receipt.id, manualId);
    }
  }
  return result;
}

function collapseSettlementLegsWithEvidence(rows: Transaction[]): CanonicalCardPaymentEvidence {
  const ordered = rows
    .slice()
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || (a.ts ?? 0) - (b.ts ?? 0) || a.id.localeCompare(b.id),
    );
  // Bucketed by amount so a card with hundreds of same-size payments does not
  // turn this into a quadratic walk on the render path.
  const open = new Map<number, OpenSettlement[]>();
  const kept: Transaction[] = [];
  const receiptByCanonicalId = new Map<string, Transaction>();
  const preferredManualByObservedId = preferredManualMatches(ordered);
  const preferredObservedById = preferredObservedMatches(ordered);

  for (const row of ordered) {
    const leg = settlementLeg(row);
    // 'unsided' is a compat row the same-day rule above already had its say
    // about; nothing else may fold it in on a guess.
    if (leg === 'unsided') {
      kept.push(row);
      continue;
    }
    // Pruned at the WIDER window; `fits` applies the right one per pair, so an
    // SMS-vs-SMS pair six days apart is still two payments.
    const oppositeObserved = (s: OpenSettlement): Transaction | undefined =>
      leg === 'debit' ? s.observed.receipt : leg === 'receipt' ? s.observed.debit : undefined;
    const bucket = (open.get(row.amountFils) ?? []).filter((s) => {
      if (s.row.date >= shiftISO(row.date, -ASSERTED_COLLAPSE_DAYS)) return true;
      const opposite = oppositeObserved(s);
      return opposite !== undefined && opposite.date >= shiftISO(row.date, -OBSERVED_COLLAPSE_DAYS);
    });
    const fits = (s: OpenSettlement) => {
      if (s.leg === leg || s.leg === 'unsided' || s.absorbed.has(leg)) return false;
      // A manual claim explains bank alerts; two bank alerts explain each
      // other. Two manual rows are two deliberate taps, not one movement.
      if (s.leg === 'manual' && leg === 'manual') return false;
      const span = s.leg === 'manual' || leg === 'manual'
        ? ASSERTED_COLLAPSE_DAYS
        : OBSERVED_COLLAPSE_DAYS;
      if (s.row.date >= shiftISO(row.date, -span)) return true;
      // A manual assertion can be a week before the bank confirms it. Once
      // one observed side is attached, the opposite side may arrive the next
      // day and must join that evidence rather than be measured again from the
      // older manual date.
      const opposite = oppositeObserved(s);
      return opposite !== undefined && opposite.date >= shiftISO(row.date, -OBSERVED_COLLAPSE_DAYS);
    };
    const fitting = bucket.filter(fits);
    const preferredManualId =
      leg === 'debit' || leg === 'receipt'
        ? preferredManualByObservedId.get(row.id)
        : undefined;
    const bankLegAgainstManual = preferredManualId
      ? fitting.find(
          (candidate) => candidate.leg === 'manual' && candidate.row.id === preferredManualId,
        )
      : undefined;
    const observedAgainstManual =
      leg === 'manual'
        ? fitting.find((candidate) =>
            Object.values(candidate.observed).some(
              (observed) =>
                observed !== undefined && preferredManualByObservedId.get(observed.id) === row.id,
            ),
          )
        : undefined;
    const preferredObservedId =
      leg === 'debit' || leg === 'receipt' ? preferredObservedById.get(row.id) : undefined;
    const containsObservedId = (candidate: OpenSettlement, id: string) =>
      candidate.row.id === id || Object.values(candidate.observed).some((value) => value?.id === id);
    const observedPreferredPartner = preferredObservedId
      ? fitting.find((candidate) => containsObservedId(candidate, preferredObservedId))
      : undefined;
    const nonManualFitting = fitting.filter(
      (candidate) =>
        candidate.leg !== 'manual' &&
        Object.values(candidate.observed).every(
          (observed) => observed === undefined || preferredObservedById.get(observed.id) === undefined,
        ),
    );
    const partner =
      bankLegAgainstManual ??
      observedAgainstManual ??
      observedPreferredPartner ??
      (preferredObservedId === undefined
        ? nonManualFitting.find((s) => s.row.date === row.date) ??
      // Nearest in time, not oldest. Rows are walked in date order, so the last
      // fitting entry is the closest one — and with a seven-day window a bucket
      // can hold more than the two candidates the ±1 day rule ever saw.
          nonManualFitting.at(-1)
        : undefined);
    if (partner) {
      if (leg === 'receipt') receiptByCanonicalId.set(partner.row.id, row);
      partner.absorbed.add(leg);
      if (leg === 'debit' || leg === 'receipt') partner.observed[leg] = row;
      const explicitMovementDate = partner.row.cashOutDate ?? row.cashOutDate;
      const debit = partner.leg === 'debit' ? partner.row : leg === 'debit' ? row : undefined;
      const manual = partner.leg === 'manual' ? partner.row : leg === 'manual' ? row : undefined;
      // A bank debit is the evidence for when cash actually left. It must
      // replace the provisional date inherited from an earlier manual claim.
      const cashOutDate = debit?.cashOutDate ?? debit?.date ?? explicitMovementDate ?? manual?.date;
      const cashOutAccountId = debit?.cashOutAccountId ?? debit?.accountId;
      if (
        (cashOutDate && partner.row.cashOutDate !== cashOutDate) ||
        (cashOutAccountId && partner.row.cashOutAccountId !== cashOutAccountId)
      ) {
        partner.row = { ...partner.row, cashOutDate, cashOutAccountId };
        kept[partner.keptIndex] = partner.row;
      }
      open.set(row.amountFils, bucket);
      continue;
    }
    bucket.push({
      row,
      leg,
      keptIndex: kept.length,
      absorbed: new Set(),
      observed: leg === 'debit' || leg === 'receipt' ? { [leg]: row } : {},
    });
    open.set(row.amountFils, bucket);
    kept.push(row);
    if (leg === 'receipt') receiptByCanonicalId.set(row.id, row);
  }

  return { rows: kept, receiptByCanonicalId };
}

/** A card's statements: one per due date, however many rows describe each. */
interface Statement {
  dueDate: string;
  /** The largest figure any copy of this statement quotes. */
  totalFils: number;
  /** Allocated so far — seeded with manual "Mark paid" amounts. */
  paidFils: number;
  /** Date part of settledAt, when the user marked this statement paid. */
  settledOn: string | null;
  dueIds: string[];
  /** The payment rows any part of which was credited to this statement. */
  rows: Transaction[];
}

/** What allocation concluded about one statement. */
interface Allocation {
  paidFils: number;
  payments: Transaction[];
}

/**
 * Payments spread across a card's statements, each payment counted once.
 *
 * A due's matching window begins around statement issue. Consecutive
 * statements overlap until the next one is issued. Crediting every
 * payment inside the window to each due independently meant one payment could
 * settle two statements at once — the second month's balance silently
 * vanished from the app while it was still owed.
 *
 * Payments are walked oldest-first and poured into the oldest statement they
 * could belong to, so an overpayment still spills onto the next one.
 *
 * Three things the plain window got wrong, all of which read to the user as
 * "I paid this and it still says I owe it":
 *
 *  - The same statement stored twice is two rows with one due date. Pouring
 *    into them in turn split the payment across the copies, and the display
 *    keeps whichever copy owes more — so a fully paid statement showed its
 *    full balance. Copies are one statement here, and share one allocation.
 *
 *  - A statement stops taking payments once the next one has been issued
 *    (~25 days before ITS due date, the same approximation used throughout).
 *    Without that the June statement was still eligible three weeks into July
 *    and swallowed the payment made for the July bill, leaving July unpaid —
 *    and June's balance is inside July's total anyway.
 *
 *  - "Mark paid" on a statement already a month late records the transfer
 *    dated today, which fell outside that statement's window and landed on the
 *    NEXT one instead: one tap settled a statement nobody had paid. A
 *    statement the user marked paid accepts payments up to the day they
 *    marked it.
 */
function allocatePayments(
  state: AppState,
  accountId: string,
  /** Included even when absent from state — callers may hold a due directly. */
  target?: CardDue,
): Map<string, Allocation> {
  const ids = cardAccountIds(state, accountId);
  const known = state.cardDues.filter((d) => ids.has(d.accountId));
  const dues = target && !known.some((d) => d.id === target.id) ? [...known, target] : known;

  const byDate = new Map<string, Statement>();
  for (const d of dues) {
    const s = byDate.get(d.dueDate);
    const settledOn = d.settledAt ? d.settledAt.slice(0, 10) : null;
    if (!s) {
      byDate.set(d.dueDate, {
        dueDate: d.dueDate,
        totalFils: d.totalDueFils,
        paidFils: d.paidFils,
        settledOn,
        dueIds: [d.id],
        rows: [],
      });
      continue;
    }
    s.totalFils = Math.max(s.totalFils, d.totalDueFils);
    // Manual "Mark paid" happened once, to the statement, not to each copy.
    s.paidFils = Math.max(s.paidFils, d.paidFils);
    if (settledOn && (!s.settledOn || settledOn > s.settledOn)) s.settledOn = settledOn;
    s.dueIds.push(d.id);
  }
  const statements = [...byDate.values()].sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  for (const payment of cardPaymentsOf(state, ids)) {
    let left = payment.amountFils;
    for (let i = 0; i < statements.length && left > 0; i++) {
      const s = statements[i];
      const outstanding = s.totalFils - s.paidFils;
      if (outstanding <= 0) continue;
      if (payment.date < shiftISO(s.dueDate, -40)) continue;
      const next = statements[i + 1]?.dueDate;
      // A newer statement closes this one's allocation window when it was
      // issued. The newest known statement has no arbitrary +20-day cutoff:
      // people pay late, and until a replacement exists that payment still
      // settles the only balance Wafra knows about.
      let until = next ? shiftISO(next, -25) : null;
      if (s.settledOn && (!until || s.settledOn > until)) until = s.settledOn;
      if (until && payment.date > until) continue;
      const take = Math.min(outstanding, left);
      s.paidFils += take;
      s.rows.push(payment);
      left -= take;
    }
  }

  const allocated = new Map<string, Allocation>();
  for (const s of statements) {
    for (const id of s.dueIds) allocated.set(id, { paidFils: s.paidFils, payments: s.rows });
  }
  return allocated;
}

/**
 * What has been paid toward a due: explicit paidFils (manual "Mark paid")
 * plus payments made to its resolved card account. Confirmed links have
 * already remapped every ledger reference onto that one account id.
 */
export function duePaidFils(state: AppState, due: CardDue): number {
  return allocatePayments(state, due.accountId, due).get(due.id)?.paidFils ?? due.paidFils;
}

/**
 * The payment rows credited to THIS statement, newest first.
 *
 * "3 payments matched" is a claim about one statement, and the card sheet used
 * to answer it with its own filter: every income-side transfer ever made to the
 * account, lifetime-wide, with no statement and no date in it. On a card paid
 * monthly for six months that read "6 payments matched" beside a statement one
 * payment had settled. It also disagreed with the allocation in three
 * directions at once — it missed the compat expense-side rows `isCardPayment`
 * deliberately still credits, it counted both halves of a settlement that
 * `collapseSettlementLegs` folds into one, and it counted payments the
 * allocator had already spent on an earlier statement.
 *
 * One rule, one answer: these are exactly the rows `duePaidFils` poured into
 * this statement. A payment that spilled across two statements appears against
 * both, because it really did pay into both.
 */
export function duePayments(state: AppState, due: CardDue): Transaction[] {
  const rows = allocatePayments(state, due.accountId, due).get(due.id)?.payments ?? [];
  return rows.slice().sort((a, b) => b.date.localeCompare(a.date));
}

function shiftISO(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function dueWithStatus(
  state: AppState,
  due: CardDue,
  today: Date,
  /** Set by openDues, which knows how long this has been the current one. */
  stale = false,
): DueWithStatus {
  const todayISO = toISODate(today);
  const paid = duePaidFils(state, due);
  const remainingFils = Math.max(0, due.totalDueFils - paid);
  const msPerDay = 86400000;
  const daysLeft = Math.round(
    (new Date(`${due.dueDate}T12:00:00`).getTime() - new Date(`${todayISO}T12:00:00`).getTime()) /
      msPerDay,
  );

  let status: DueStatus;
  if (due.settledAt || remainingFils === 0) status = 'settled';
  else if (daysLeft < 0) status = 'overdue';
  else if (daysLeft <= 3) status = 'urgent';
  else status = 'upcoming';

  // A minimum the bank never stated is an estimate, and "you are under your
  // minimum due" is a claim about the bank's terms. Making that claim from a
  // percentage the app invented tells the user they are about to incur a late
  // fee on a figure no bank ever quoted, so an estimate never triggers it.
  const minimumKnown = !due.minDueEstimated;

  return {
    due,
    status,
    daysLeft,
    remainingFils,
    belowMinimum: minimumKnown && paid < due.minDueFils && status !== 'settled',
    minimumKnown,
    stale: stale && status !== 'settled',
  };
}

/** How long an unpaid due stays actionable before it needs a reason to stay. */
const STALE_OVERDUE_DAYS = 30;

/**
 * Open dues (not settled, on credit cards), most urgent first.
 *
 * A month-old unpaid statement used to be dropped outright, on the theory that
 * the bank had since issued a new one that replaced it. That theory is only
 * true when a newer statement actually exists — and when it did not, the app
 * quietly stopped showing a debt the user still owed, with no trace anywhere
 * that it had decided to stop mentioning it.
 *
 * So the supersession is now checked rather than assumed: an old statement
 * goes only when a later one on the same card has taken over. Otherwise it
 * survives, flagged `stale`, and the caller can present it as old news instead
 * of the app pretending it never happened. Cards that have gone silent
 * altogether are handled by `isInactiveAccount`, not by hiding their debts.
 *
 * The other half of that rule is that supersession is not about age. A card
 * carries one obligation — the newest statement, whose total already contains
 * whatever went unpaid before it. Two open statements on one card was the app
 * charging the user twice for the same money.
 */
export function openDues(state: AppState, today: Date): DueWithStatus[] {
  const day = toISODate(today);
  if (openDuesCache && openDuesCache.day === day && sameInputs(openDuesCache, state)) {
    // A copy, not the cached array. Callers sort and splice their own lists,
    // and one caller mutating this in place would corrupt every later reader
    // for the rest of the frame. Copying ≤ a few dozen references is free
    // beside the allocation walk it replaces.
    return openDuesCache.value.slice();
  }
  const value = computeOpenDues(state, today);
  openDuesCache = {
    accounts: state.accounts,
    transactions: state.transactions,
    cardDues: state.cardDues,
    day,
    value,
  };
  return value.slice();
}

function computeOpenDues(state: AppState, today: Date): DueWithStatus[] {
  const creditIds = new Set(
    state.accounts.filter((a) => a.cardType === 'credit' && !a.archived).map((a) => a.id),
  );
  const keyOf = cardIdentity(state.accounts);

  // Latest statement date per card, to tell "replaced" from "still owed".
  const newestByCard = new Map<string, string>();
  for (const d of state.cardDues) {
    const k = keyOf(d.accountId);
    const seen = newestByCard.get(k);
    if (!seen || d.dueDate > seen) newestByCard.set(k, d.dueDate);
  }

  const open = state.cardDues
    .filter((d) => creditIds.has(d.accountId))
    // One card owes one statement. A credit card rolls its unpaid balance into
    // the next statement, so a superseded statement is not a second debt — its
    // total is already inside the newer one, and listing both said the user
    // owed the same money twice. This used to hold only for statements more
    // than 30 days overdue, which let reminder rows on one resolved account
    // count the same rolling obligation twice on Home.
    //
    // The newer statement supersedes whether or not it is settled: what
    // settles it is a payment covering a total that included the older one.
    .filter((d) => (newestByCard.get(keyOf(d.accountId)) ?? d.dueDate) <= d.dueDate)
    .map((d) => {
      const daysLeft = Math.round(
        (new Date(`${d.dueDate}T12:00:00`).getTime() -
          new Date(`${toISODate(today)}T12:00:00`).getTime()) /
          86400000,
      );
      // Nothing replaced it and it is long overdue: kept, but said to be old
      // news rather than passed off as this month's bill.
      return dueWithStatus(state, d, today, daysLeft < -STALE_OVERDUE_DAYS);
    })
    .filter((d) => d.status !== 'settled')
    .sort((a, b) => a.daysLeft - b.daysLeft);

  // One statement, one row. A card has a single statement per due date, so two
  // records that agree on the account and the date are the same statement
  // stored twice — a reminder SMS read as a fresh statement, or state written
  // before importBatch collapsed dues per account. Home was listing the same
  // Emirates NBD statement twice and counting it twice in the total.
  //
  // The larger balance wins: a due and its reminder can disagree, and the one
  // still owing more is the one quoting the fuller total. Payments no longer
  // decide this — copies of one statement share one allocation now, so the two
  // rows only differ in what the bank said they were for.
  //
  // Keyed on the resolved account id. Two records on that same account and due
  // date are one statement; similar metadata on different active accounts is
  // not enough to hide either obligation.
  const byStatement = new Map<string, DueWithStatus>();
  for (const d of open) {
    const key = `${keyOf(d.due.accountId)}|${d.due.dueDate}`;
    const seen = byStatement.get(key);
    if (!seen || d.remainingFils > seen.remainingFils) byStatement.set(key, d);
  }
  return [...byStatement.values()].sort((a, b) => a.daysLeft - b.daysLeft);
}

/**
 * Everything the card detail sheet shows about one physical card.
 *
 * This lived in the component, which is why it could disagree with the rest of
 * the app without any test noticing: nothing in the harness can load a .tsx.
 * The rules it has to keep are the same ones `openDues` and `allocatePayments`
 * keep, and each of the three was got wrong in the component at least once:
 *
 *  - Scope is the resolved card account. Similar account metadata never pulls
 *    another active card's statements into this sheet.
 *  - A payment is credited through `duePaidFils`. A `paidFils` read raw, or a
 *    lookup whose key set was built from a narrower list, shows a settled
 *    statement at 0% paid with its full balance still owed.
 *  - A card carries ONE obligation — the newest statement, whose total already
 *    contains whatever went unpaid before it. Summing the unpaid history
 *    charged the user twice for the same money.
 *
 * Unlike `openDues` this does NOT drop archived accounts. Hiding a card is a
 * statement about the list it appears in, not about the debt; the sheet is
 * reached by opening that very card, and answering 0 there is how a balance
 * disappears with nothing anywhere saying it was dropped.
 */
export interface CardStatementView {
  /** Every statement on this physical card, newest due date first. */
  statements: CardDue[];
  /** Payments onto the card, newest first. */
  payments: Transaction[];
  paidTotalFils: number;
  /** Due id → what has been paid toward it. Covers every row in `statements`. */
  paidByDueId: Map<string, number>;
  /** The single statement the card currently owes, or empty when settled. */
  open: CardDue[];
  outstandingFils: number;
  billedFils: number;
  /**
   * Whether this card can have a bill at all.
   *
   * False for a debit-only card, and then `statements` and `payments` are both
   * empty BY DEFINITION rather than by accident — which is a different thing
   * from "none have arrived yet", and the screen has to be able to tell them
   * apart. It could not: a debit card showed an empty Statements list under
   * "no statement message has arrived for this card YET", a sentence that
   * promises one is coming when none ever can.
   */
  billable: boolean;
}

export function cardStatementView(state: AppState, accountId: string): CardStatementView {
  const keyOf = cardIdentity(state.accounts);
  const cardKey = keyOf(accountId);

  const statements = state.cardDues
    .filter((d) => keyOf(d.accountId) === cardKey)
    .slice()
    .sort((a, b) => b.dueDate.localeCompare(a.dueDate));

  // Same eligibility rule `duePaidFils`/`allocatePayments` use to decide what
  // has settled a statement, via the shared `cardPaymentsOf`/`isCardPayment`.
  // A second, narrower copy here is how a statement could read "settled" while
  // the payment that settled it was invisible in this very list.
  const ids = cardAccountIds(state, accountId);
  const payments = cardPaymentsOf(state, ids).sort((a, b) => b.date.localeCompare(a.date));
  // The group, not the one row the sheet was opened on: one physical card can
  // appear as both a debit and a credit row, and opening the debit one must
  // not hide the bill the credit one carries.
  const billable = state.accounts.some((a) => ids.has(a.id) && a.cardType === 'credit');

  const paidByDueId = new Map(statements.map((d) => [d.id, duePaidFils(state, d)] as const));

  const newestDueDate = statements[0]?.dueDate;
  const open = statements
    .filter(
      (d) =>
        d.dueDate === newestDueDate && !d.settledAt && (paidByDueId.get(d.id) ?? 0) < d.totalDueFils,
    )
    // Two records agreeing on the card and the date are one statement stored
    // twice; the copy still owing more is the one quoting the fuller total.
    .sort(
      (a, b) =>
        b.totalDueFils -
        (paidByDueId.get(b.id) ?? 0) -
        (a.totalDueFils - (paidByDueId.get(a.id) ?? 0)),
    )
    .slice(0, 1);

  return {
    statements,
    payments,
    paidTotalFils: payments.reduce((s, t) => s + t.amountFils, 0),
    paidByDueId,
    open,
    billable,
    outstandingFils: open.reduce(
      (s, d) => s + Math.max(0, d.totalDueFils - (paidByDueId.get(d.id) ?? 0)),
      0,
    ),
    billedFils: open.reduce((s, d) => s + d.totalDueFils, 0),
  };
}

/**
 * ISO date of the last known activity on an account: newest transaction or
 * the bank's latest snapshot SMS, whichever is later. Null = no history.
 */
export function accountLastActivityISO(state: AppState, accountId: string): string | null {
  // One pass over the ledger builds the answer for EVERY account, because the
  // caller that matters asks for all of them: Wallet filters its card list
  // through `isInactiveAccount`, which lands here once per card. Per-account
  // scanning made that 49 walks of 14,500 rows to compute 49 maxima that a
  // single walk produces.
  if (!activityCache || activityCache.transactions !== state.transactions) {
    const byAccount = new Map<string, string>();
    for (const t of state.transactions) {
      const seen = byAccount.get(t.accountId);
      if (!seen || t.date > seen) byAccount.set(t.accountId, t.date);
    }
    activityCache = { transactions: state.transactions, byAccount };
  }
  let latest: string | null = activityCache.byAccount.get(accountId) ?? null;
  const acc = state.accounts.find((a) => a.id === accountId);
  if (acc?.snapshotTs) {
    const snapISO = toISODate(new Date(acc.snapshotTs));
    if (!latest || snapISO > latest) latest = snapISO;
  }
  return latest;
}

/** No charge and no bank SMS for this long = the card is expired or unused. */
export const DORMANT_AFTER_DAYS = 90;

/**
 * Hidden from the main lists: manually hidden, or silent for months. A
 * full-history scan resurrects every card the user ever owned; the dead ones
 * identify themselves by never texting again. Accounts with no history at all
 * (freshly added by hand) are left alone.
 */
export function isInactiveAccount(state: AppState, account: Account, today: Date): boolean {
  if (account.archived) return true;
  const last = accountLastActivityISO(state, account.id);
  if (!last) return false;
  const silentDays = Math.round(
    (new Date(`${toISODate(today)}T12:00:00`).getTime() - new Date(`${last}T12:00:00`).getTime()) /
      86400000,
  );
  return silentDays > DORMANT_AFTER_DAYS;
}

/**
 * Display name for an auto-created card account.
 *
 * `language` exists for one caller: the iOS headless relay wake, which builds
 * a notification before StoreProvider has hydrated and therefore before the
 * module-level language in i18n.ts has been set. Everything on a screen leaves
 * it alone and gets the current language, as before.
 */
export function cardAccountName(
  last4: string,
  kind: 'credit' | 'debit' | 'account' | 'unknown',
  language?: Lang,
): string {
  if (kind === 'credit') return tf('creditCardWithDigits', { last4 }, language);
  if (kind === 'debit') return tf('debitCardWithDigits', { last4 }, language);
  if (kind === 'unknown') return tf('cardWithDigits', { last4 }, language);
  return tf('accountWithDigits', { last4 }, language);
}

const HINT_COLORS = ['#60A5FA', '#F472B6', '#A78BFA', '#FB923C', '#22D3EE', '#4ADE80'];

export function colorForHint(last4: string): string {
  const n = Number(last4) || 0;
  return HINT_COLORS[n % HINT_COLORS.length];
}

/** Bank identity from an SMS sender ID, per the active market pack. */
export { bankFromSender } from '@/lib/markets';

/**
 * A statement-only card row and the row that may hold its spending history.
 *
 * When a UAE bank renews a credit card the account survives and the last four
 * digits change. The app has no notion of that, so the two halves of one card
 * sit as two rows and never meet: the OLD number holds every purchase and
 * payment ever made, and the NEW number holds the statement — because the
 * card is new, so nothing has been spent on it yet.
 *
 * That split is why a statement stays open forever. The due is on a row no
 * payment will ever land on, and the payments are on a row with no due.
 *
 * The common case is a reissue with changed digits. Another is parser
 * fragmentation: bare card wording sat under debit/unknown while its statement
 * sat under credit, including Liv/ENBD issuer aliases. None is proof. This only
 * suggests; merging two real cards corrupts the ledger invisibly.
 */
export interface ReissueSuggestion {
  /** The row holding the statement and nothing else. */
  newAccountId: string;
  /** The row holding the history, best candidate first. */
  candidateIds: string[];
}

export function reissueSuggestions(state: AppState, today: Date): ReissueSuggestion[] {
  const spendingCount = new Map<string, number>();
  for (const t of state.transactions) {
    if (isSpending(t)) {
      spendingCount.set(t.accountId, (spendingCount.get(t.accountId) ?? 0) + 1);
    }
  }
  const hasOpenDue = new Set(openDues(state, today).map((d) => d.due.accountId));
  const issuerCandidate = (bankName: string | undefined): string | undefined => {
    if (bankName === 'Liv' || bankName === 'Emirates NBD') return 'Emirates NBD issuer';
    return bankName;
  };

  const out: ReissueSuggestion[] = [];
  for (const a of state.accounts) {
    if (a.cardType !== 'credit' || a.archived) continue;
    // Already answered — the user linked it, or said these are different.
    if (a.renewedFrom) continue;
    // A payment row on the statement account is not spending history. It must
    // not suppress the repair prompt that can finally put that payment beside
    // the purchases and settle the statement.
    if (!hasOpenDue.has(a.id) || (spendingCount.get(a.id) ?? 0) > 0) continue;

    const candidates = state.accounts
      .filter(
        (b) => {
          if (b.id === a.id || b.kind !== 'card' || b.archived) return false;
          if ((spendingCount.get(b.id) ?? 0) === 0) return false;
          const sameBank = !a.bankName || !b.bankName || a.bankName === b.bankName;
          const sameDigits = Boolean(a.last4 && b.last4 === a.last4);
          // Liv/ENBD is issuer context only. It may make a same-number split
          // worth asking about, but it is never proof and never auto-merges.
          const sameIssuer =
            issuerCandidate(a.bankName) !== undefined &&
            issuerCandidate(a.bankName) === issuerCandidate(b.bankName);
          const sameNumberAlias = sameDigits && (sameBank || sameIssuer);
          const possibleReissue = b.cardType === 'credit' && sameBank;
          return sameNumberAlias || possibleReissue;
        },
      )
      // Most recently used first: a card renewed last month is a likelier
      // predecessor than one silent since 2023.
      .sort((x, y) => (accountLastActivityISO(state, y.id) ?? '').localeCompare(accountLastActivityISO(state, x.id) ?? ''))
      .map((b) => b.id);

    if (candidates.length > 0) out.push({ newAccountId: a.id, candidateIds: candidates });
  }
  return out;
}

/**
 * The one figure a card row should lead with.
 *
 * Wallet showed a different quantity depending on what happened to be known:
 * a bank-quoted balance where there was one, this month's spending where
 * there was not — in the same column, at the same weight, distinguished only
 * by a caption underneath. One row read "21,933 per bank SMS" and the row
 * above it "466 spent this month", and nothing about the layout said those
 * were different kinds of number.
 *
 * A credit card leads with what is OWED, because that is what a person opens
 * a wallet to check and the only figure they can act on. In order of
 * authority: the statement still to be paid, then the bank's own outstanding
 * quote. A debit card leads with its balance. Spending belongs on the second
 * line, where it reads as context rather than as money you have.
 */
export type CardFigureKind = 'owed' | 'balance' | 'unknown';

export interface CardFigure {
  kind: CardFigureKind;
  /** Null when nothing authoritative is known — never a guess. */
  fils: number | null;
}

export function cardFigure(state: AppState, account: Account, today: Date): CardFigure {
  if (account.cardType === 'credit') {
    // An open statement is the most useful answer: it is what the bank will
    // take, on a date, and the app knows how much of it is already paid.
    const due = openDues(state, today).find((d) => d.due.accountId === account.id);
    if (due) return { kind: 'owed', fils: due.remainingFils };
    // Failing that, a figure the bank itself quoted as outstanding.
    if (account.snapshotKind === 'outstanding' && account.snapshotFils !== undefined) {
      return { kind: 'owed', fils: Math.abs(account.snapshotFils) };
    }
    // A credit card with nothing owed owes nothing. That is a real answer.
    return { kind: 'owed', fils: 0 };
  }
  const balance = reliableBalanceFils(state, account);
  return balance !== null ? { kind: 'balance', fils: balance } : { kind: 'unknown', fils: null };
}

/**
 * Cards grouped under the bank that issued them, banks ordered by how much is
 * on them.
 *
 * Eleven rows of which six said "FAB Credit Card" was the whole readability
 * problem: nothing told the user whether that was six cards or one card the
 * app had failed to recognise. Under a FAB heading, six FAB cards are
 * obviously six FAB cards — and if that is wrong, it is obviously wrong.
 */
export interface BankGroup {
  bank: string;
  accounts: Account[];
}

export function groupCardsByBank(accounts: Account[]): BankGroup[] {
  const groups = new Map<string, Account[]>();
  for (const a of accounts) {
    // Cards the app has never seen a sender for gather under one heading
    // rather than each inventing a bank of its own.
    const bank = a.bankName?.trim() || 'Other cards';
    groups.set(bank, [...(groups.get(bank) ?? []), a]);
  }
  return [...groups.entries()]
    .map(([bank, list]) => ({ bank, accounts: list }))
    .sort((a, b) => b.accounts.length - a.accounts.length || a.bank.localeCompare(b.bank));
}
