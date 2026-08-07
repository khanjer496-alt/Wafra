import { monthEndISO, monthKey, monthStartISO, toISODate } from '@/lib/format';
import { isSpending } from '@/lib/ledger';
import type { Bill, Transaction } from '@/lib/types';

/**
 * The calendar date a monthly bill falls due inside a given money month.
 *
 * A money month starting on the 25th spans two calendar months, so "day 3"
 * belongs to the second of them and "day 28" to the first. Clamped to the
 * month's own end, so a bill on the 31st still lands on a day that exists.
 */
export function dueDateInMonth(key: string, dueDay: number): string {
  const startISO = monthStartISO(key);
  const endISO = monthEndISO(key);
  const startDay = Number(startISO.slice(8, 10));
  const base = dueDay >= startDay ? startISO : endISO;
  const [y, m] = [Number(base.slice(0, 4)), Number(base.slice(5, 7))];
  const lastOfThatMonth = new Date(y, m, 0).getDate();
  const day = Math.min(dueDay, lastOfThatMonth);
  const iso = `${base.slice(0, 7)}-${String(day).padStart(2, '0')}`;
  // Never outside the month it is supposed to describe.
  return iso < startISO ? startISO : iso > endISO ? endISO : iso;
}

/**
 * The same date, with the argument order the reminder planner reads it in.
 *
 * Both branches arrived at this function independently and proved equal —
 * identical output over every probed case (Feb day-31 clamping, day 1/24/25/28/
 * 31, Apr-31, Jun-30, Jun-3) at both monthStartDay 1 and 25 — so this is an
 * alias, not a second implementation. It is deliberately NOT a second copy of
 * the arithmetic: "date arithmetic re-implemented per module is how the app
 * ended up with two different answers for 'when is this due'", and a duplicate
 * here would be the third.
 */
export function billDueISO(dueDay: number, key: string): string {
  return dueDateInMonth(key, dueDay);
}

export type BillStatus = 'paid' | 'overdue' | 'due-soon' | 'upcoming';

export interface BillWithStatus {
  bill: Bill;
  status: BillStatus;
  /** Days until due this month; negative when overdue. */
  daysLeft: number;
  /** The actual calendar date this bill falls due, inside the money month. */
  dueISO: string;
  /** True when paid was inferred from an imported transaction, not marked manually. */
  autoReconciled?: boolean;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Words that identify a KIND of bill rather than who it is owed to.
 *
 * A shared token is only evidence if it names the payee. Two bills called
 * "Internet" and "Home internet" share a word and may be owed to entirely
 * different companies; "Etisalat internet" and an "Etisalat Telep" charge
 * share the one that matters.
 */
const GENERIC_BILL_WORDS = new Set([
  'bill', 'bills', 'payment', 'monthly', 'subscription', 'internet', 'mobile',
  'phone', 'home', 'card', 'account', 'service', 'fee', 'fees', 'charge',
  'charges', 'plan', 'postpaid', 'prepaid', 'renewal', 'auto', 'my', 'the',
]);

/** Tokens that could name a payee: 4+ characters and not a kind-word. */
function payeeTokens(title: string): Set<string> {
  return new Set(
    normalize(title)
      .split(' ')
      .filter((w) => w.length >= 4 && !GENERIC_BILL_WORDS.has(w)),
  );
}

/**
 * Transactions that could be this bill's payment: same month, amount within
 * ±15%, and a title that either CONTAINS the bill's (or is contained by it) or
 * shares a token that names the payee.
 *
 * Containment alone was the whole rule, and it is exact where it applies —
 * but it needs the two names to nest. A bill the user called "Etisalat
 * internet" never reconciled against a charge the bank described as "MB BILL
 * DR:ETISALAT TELEP DUBAI", because neither string contains the other. The
 * bill sat overdue with the money already gone.
 *
 * The token rule is looser, so it does not decide anything on its own — see
 * `billsForMonth`, which drops a token match the moment more than one bill
 * claims the same transaction. Marking a bill paid that was not is the
 * expensive direction of this error: the user stops looking at it.
 */
function candidatePayments(bill: Bill, transactions: Transaction[], key: string): Transaction[] {
  const billTitle = normalize(bill.title);
  if (!billTitle) return [];
  const billTokens = payeeTokens(bill.title);
  const out: Transaction[] = [];
  for (const t of transactions) {
    if (!isSpending(t) || monthKey(t.date) !== key) continue;
    if (t.amountFils < bill.amountFils * 0.85 || t.amountFils > bill.amountFils * 1.15) continue;
    const txTitle = normalize(t.title);
    // Every string contains "", so a title that normalizes to nothing (a row
    // titled "—" or "***") would otherwise mark any similar-sized bill paid.
    if (!txTitle) continue;
    if (txTitle.includes(billTitle) || billTitle.includes(txTitle)) {
      out.push(t);
      continue;
    }
    for (const token of payeeTokens(t.title)) {
      if (billTokens.has(token)) {
        out.push(t);
        break;
      }
    }
  }
  return out;
}

/** True when the two titles nest, which needs no corroboration. */
function nests(bill: Bill, t: Transaction): boolean {
  const b = normalize(bill.title);
  const x = normalize(t.title);
  return Boolean(b) && Boolean(x) && (x.includes(b) || b.includes(x));
}

/** Status of each bill for the month containing `today`, sorted most urgent first. */
export function billsForMonth(
  bills: Bill[],
  transactions: Transaction[],
  today: Date,
): BillWithStatus[] {
  const key = monthKey(today);
  const todayISO = toISODate(today);

  /**
   * How many bills a given transaction could be the payment for.
   *
   * A token match is circumstantial, and the case it goes wrong on is a
   * household with two bills from the same company — an Etisalat internet
   * line and an Etisalat mobile line both share "etisalat", and if their
   * amounts are close enough to both clear the ±15% band, one charge would
   * mark both paid. So a claim on a transaction that more than one bill wants
   * is not evidence for either of them, and only the exact nesting rule
   * survives that. Better an unreconciled bill the user marks by hand than a
   * bill that says paid while the money is still owed.
   */
  const claims = new Map<string, number>();
  for (const bill of bills) {
    for (const t of candidatePayments(bill, transactions, key)) {
      claims.set(t.id, (claims.get(t.id) ?? 0) + 1);
    }
  }

  const rows = bills.map((bill) => {
    // The paid flag is keyed to the MONEY month, so the date has to be found
    // inside that same month. It was calendar arithmetic — `bill.dueDay -
    // today.getDate()` — which describes a different month entirely once the
    // month starts on a salary day. With a start of the 25th, a bill due on
    // the 28th and paid on 28 June read "Paid" all through July while its
    // countdown talked about 28 July, and the July payment stayed invisible
    // until the 25th.
    const dueISO = dueDateInMonth(key, bill.dueDay);
    const daysLeft = Math.round(
      (new Date(`${dueISO}T12:00:00`).getTime() - new Date(`${todayISO}T12:00:00`).getTime()) /
        86400000,
    );
    const manuallyPaid = bill.paidMonths.includes(key);
    const autoReconciled =
      !manuallyPaid &&
      candidatePayments(bill, transactions, key).some(
        (t) => nests(bill, t) || (claims.get(t.id) ?? 0) === 1,
      );
    let status: BillStatus;
    if (manuallyPaid || autoReconciled) status = 'paid';
    else if (daysLeft < 0) status = 'overdue';
    else if (daysLeft <= 5) status = 'due-soon';
    else status = 'upcoming';
    return { bill, status, daysLeft, dueISO, autoReconciled };
  });

  const rank: Record<BillStatus, number> = { overdue: 0, 'due-soon': 1, upcoming: 2, paid: 3 };
  rows.sort((a, b) => rank[a.status] - rank[b.status] || a.daysLeft - b.daysLeft);
  return rows;
}
