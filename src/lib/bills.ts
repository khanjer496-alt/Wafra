import { daysBetweenISO, getMonthStartDay, monthEndISO, monthKey, monthStartISO, toISODate } from '@/lib/format';
import { isSpending } from '@/lib/ledger';
import type { Bill, Transaction } from '@/lib/types';

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/**
 * Where a YEARLY bill falls inside a given money month, or null when its
 * anniversary is not in this month at all.
 *
 * The year in `anchorISO` is ignored on purpose — it records which anniversary
 * was observed, not the only one that counts — so an anchor from a charge that
 * already happened still places the bill correctly next year.
 *
 * A money month can span two calendar years (Dec 25 – Jan 24), so both are
 * tried. 29 February falls back to the 28th in the years that have no 29th,
 * the same clamping `dueDateInMonth` does for a monthly bill on the 31st.
 */
export function yearlyDueInMonth(key: string, anchorISO: string): string | null {
  const startISO = monthStartISO(key);
  const endISO = monthEndISO(key);
  const month = anchorISO.slice(5, 7);
  const day = anchorISO.slice(8, 10);
  for (const year of new Set([Number(startISO.slice(0, 4)), Number(endISO.slice(0, 4))])) {
    const clamped = month === '02' && day === '29' && !isLeapYear(year) ? '28' : day;
    const iso = `${year}-${month}-${clamped}`;
    if (iso >= startISO && iso <= endISO) return iso;
  }
  return null;
}

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

// Home already projects the user's manual bills for the Upcoming card before
// the Bills tab is opened. On a large imported ledger, recomputing that exact
// answer on the navigation tap means tokenising/scanning the complete history
// once per bill again. Store snapshots are immutable and live/internal scope
// sets are identity-cached, so these references + money day are an exact cache
// key rather than a heuristic.
let billsForMonthCache: {
  bills: Bill[];
  transactions: Transaction[];
  key: string;
  monthStartDay: number;
  day: string;
  live?: Set<string>;
  internal?: Set<string>;
  value: BillWithStatus[];
} | null = null;

function normalize(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Unicode-safe identity for imported billers; Arabic titles must not all collapse to "". */
function billIdentity(s: string): string {
  return s.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function noticeObservedAt(bill: Bill): number | undefined {
  return Number.isSafeInteger(bill.noticeObservedAt) && bill.noticeObservedAt! > 0
    ? bill.noticeObservedAt : undefined;
}

/** Import order is not source chronology: history pages can arrive backwards. */
function canRefreshNotice(prior: Bill, incoming: Bill): boolean {
  if (!prior.statedDueDate) return true;
  // An undated estimate cannot erase a bank-stated obligation. Its existing
  // amount remains an estimate automatically outside the recorded cycle.
  if (!incoming.statedDueDate) return false;
  if (incoming.statedDueDate !== prior.statedDueDate) {
    return incoming.statedDueDate > prior.statedDueDate;
  }
  const before = noticeObservedAt(prior);
  const after = noticeObservedAt(incoming);
  if (before !== undefined && after !== undefined && after < before) return false;
  // Matching facts can acquire missing source metadata on a reread. A changed
  // total needs positive chronology, including for downward bank corrections;
  // a legacy notice with no clock cannot establish which version came first.
  return incoming.amountFils === prior.amountFils ||
    (before !== undefined && after !== undefined && after > before);
}

/**
 * Merge bill reminders learned during an encrypted capture.
 *
 * A manual reminder is the user's decision and is never rewritten. An
 * automatically detected reminder is refreshed by the newest bank notice so
 * its amount and due day do not stay frozen at last month's values. An
 * explicitly chosen account and unrelated paid months survive that refresh.
 */
export function mergeImportedBills(existing: Bill[], incoming: Bill[]): Bill[] {
  const merged = existing.slice();
  // One existing reminder may satisfy at most one reminder in this capture.
  // Without this claim set, two current SEWA/e& accounts with the same title
  // both select index 0 and the later one silently overwrites the earlier.
  const claimed = new Set<number>();
  const initialLength = merged.length;
  for (const bill of incoming) {
    const key = billIdentity(bill.title);
    // A manual reminder remains the user's single source of truth for that
    // named provider, matching the pre-import behavior.
    if (merged.slice(0, initialLength).some(
      (row) => !row.autoDetected && billIdentity(row.title) === key,
    )) continue;
    const sameTitle = merged
      .slice(0, initialLength)
      .map((row, index) => ({ row, index }))
      .filter(({ row, index }) => !claimed.has(index) && billIdentity(row.title) === key);
    const exact = bill.importIdentity
      ? sameTitle.find(({ row }) => row.importIdentity === bill.importIdentity)
      : sameTitle.find(({ row }) => !row.importIdentity);
    // Migrate one pre-identity automatic reminder in place rather than making
    // an upgrade show both its legacy and newly identified form.
    const legacy = bill.importIdentity
      ? sameTitle.find(({ row }) => !row.importIdentity)
      : undefined;
    const match = exact ?? legacy;
    const index = match?.index ?? -1;
    if (index < 0) {
      merged.push(bill);
      continue;
    }
    claimed.add(index);
    const prior = merged[index];
    if (!canRefreshNotice(prior, bill)) continue;
    const { statedDueDate: _priorDeadline, noticeObservedAt: _priorObservedAt, ...priorFields } = prior;
    const observedAt = noticeObservedAt(bill) ??
      (bill.statedDueDate === prior.statedDueDate ? noticeObservedAt(prior) : undefined);
    // A manual claim covered the prior expected total. When an accepted bank
    // notice raises that total, its money month needs payment evidence again.
    // Keep the actual expense; receipt reconciliation can still cover the new
    // figure. The import/store boundary detaches any revoked payment link.
    const reopenedMonth = bill.statedDueDate && bill.amountFils > prior.amountFils
      ? monthKey(bill.statedDueDate) : undefined;
    merged[index] = {
      ...priorFields,
      title: bill.title,
      category: bill.category,
      amountFils: bill.amountFils,
      dueDay: bill.dueDay,
      autoDetected: true,
      paidMonths: reopenedMonth ? prior.paidMonths.filter((month) => month !== reopenedMonth) : prior.paidMonths,
      ...(bill.statedDueDate ? { statedDueDate: bill.statedDueDate } : {}),
      ...(observedAt !== undefined ? { noticeObservedAt: observedAt } : {}),
      ...(bill.importIdentity ? { importIdentity: bill.importIdentity } : {}),
    };
  }
  return merged;
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
  // Arabic service/type words are no more specific than "bill" or "phone".
  'فاتورة', 'فواتير', 'الفاتورة', 'الفواتير', 'دفع', 'سداد', 'شهري', 'شهريا',
  'اشتراك', 'الاشتراك', 'خدمة', 'خدمات', 'الخدمة', 'الخدمات', 'رسوم', 'الرسوم',
  'مبلغ', 'المبلغ', 'مستحق', 'المستحق', 'كهرباء', 'الكهرباء', 'مياه', 'المياه',
  'هاتف', 'الهاتف', 'انترنت', 'الانترنت', 'الإنترنت', 'جوال', 'الجوال',
]);

/** Tokens that could name a payee: 4+ characters and not a kind-word. */
function payeeTokens(title: string): Set<string> {
  return new Set(
    normalize(title)
      .split(' ')
      .filter((w) => w.length >= 4 && !GENERIC_BILL_WORDS.has(w)),
  );
}

/** Last four from a parser-owned bill identity; malformed/legacy values fail closed. */
function billIdentityTail(identity: string | undefined): string | null {
  const match = identity?.match(/^(?:account|consumer|party|customer|contract|service):([A-Z0-9]{4})$/i);
  return match?.[1].toUpperCase() ?? null;
}

function exactBillAccount(bill: Bill, transaction: Transaction): boolean {
  const tail = billIdentityTail(bill.importIdentity);
  return tail !== null && tail === billIdentityTail(transaction.billIdentity);
}

/** Provider spellings already emitted by bank alerts, including Arabic SEWA. */
function providerTitle(title: string): string {
  const key = normalize(title.replace(/&/g, ' and '));
  if (/^(?:e and(?: uae)?|etisalat|e digital app)$/.test(key)) return 'etisalat';
  if (key === 'كهرباء الشارقة') return 'sewa';
  return key;
}

function sameBillProvider(billTitle: string, transactionTitle: string): boolean {
  const b = providerTitle(billTitle);
  const x = providerTitle(transactionTitle);
  if (!b || !x) return false;
  if (b === x) return true;
  // Short provider names need equality: E& must never match every title with e.
  if (b.length >= 4 && x.length >= 4 && (x.includes(b) || b.includes(x))) return true;
  const tokens = payeeTokens(b);
  return [...payeeTokens(x)].some((token) => tokens.has(token));
}

/** Single-service descriptors, not marketplaces such as Apple or Amazon. */
const DIRECT_SUBSCRIPTIONS = new Set([
  'chatgpt', 'claude', 'google one', 'netflix', 'spotify', 'alldebrid', 'real debrid',
  'disney', 'disney plus', 'youtube premium', 'anghami', 'shahid', 'osn', 'starzplay',
  'deezer', 'audible', 'dropbox', 'canva', 'microsoft 365', 'office 365',
]);

type RenewalCycle = { dueISO: string; ordinal: number; rows: Transaction[]; confirmed: boolean };
type RenewalHistory = Map<number, RenewalCycle>;
let renewalHistoryCache: {
  bills: Bill[]; transactions: Transaction[]; live?: Set<string>; internal?: Set<string>;
  value: Map<Bill, RenewalHistory>; monthStartDay: number;
} | undefined;

function renewalOrdinal(bill: Bill, date: string): number {
  const year = Number(date.slice(0, 4));
  return bill.yearlyOnISO ? year : year * 12 + Number(date.slice(5, 7)) - 1;
}

function renewalAnchor(bill: Bill, ordinal: number): string {
  const year = bill.yearlyOnISO ? ordinal : Math.floor(ordinal / 12);
  const month = bill.yearlyOnISO ? Number(bill.yearlyOnISO.slice(5, 7)) - 1 : ordinal % 12;
  const day = Math.min(bill.dueDay, new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

const serviceIdentity = (identity?: string): string | undefined | null => identity === undefined
  ? undefined : /^(?:account|consumer|party|customer|contract|service):[a-z0-9]{4}$/i.test(identity)
    ? identity.toLowerCase() : null;
const timelyRenewal = (bill: Bill, row: Transaction, dueISO: string): boolean =>
  (row.source === 'manual' && row.billPayment?.billId === bill.id &&
    row.billPayment.month === monthKey(dueISO) && bill.paidMonths.includes(row.billPayment.month)) ||
  Math.abs(daysBetweenISO(row.date, dueISO)) <= 5;

/**
 * A single-service subscription (ChatGPT, Netflix…) is settled by the one
 * charge from that exact service within five days of its calendar anchor, at
 * whatever price was charged: plans change price and providers bill a few days
 * early. That holds for a saved estimate and for a bill the person added. Two
 * charges in one cycle, a competing bill for the same service, or a
 * bank-stated exact total keep the cycle on the stricter rules.
 *
 * Each raw charge belongs to ONE nearest calendar anchor, even when it posts
 * across a reporting-month boundary. Do not also offer it to the legacy
 * same-month matcher: September 30 must not settle both September and October.
 * Scan targeted histories once per immutable ledger snapshot, not once per
 * forecast month or once per bill on a large imported ledger.
 */
function renewalHistories(
  bills: Bill[], transactions: Transaction[], live?: Set<string>, internal?: Set<string>,
): Map<Bill, RenewalHistory> {
  if (renewalHistoryCache?.bills === bills && renewalHistoryCache.transactions === transactions &&
      renewalHistoryCache.live === live && renewalHistoryCache.internal === internal &&
      renewalHistoryCache.monthStartDay === getMonthStartDay()) {
    return renewalHistoryCache.value;
  }
  const value = new Map<Bill, RenewalHistory>();
  const byTitle = new Map<string, Bill[]>();
  for (const bill of bills) {
    if (bill.statedDueDate || serviceIdentity(bill.importIdentity) === null ||
        !DIRECT_SUBSCRIPTIONS.has(normalize(bill.title))) continue;
    // Legacy matching compares masked tails, even across identity kinds.
    // Unknown/malformed identities or equal tails therefore remain competing
    // claims; only distinct valid tails are disjoint from that matcher.
    if (bills.some(other => other !== bill && sameBillProvider(other.title, bill.title) &&
        (!billIdentityTail(other.importIdentity) || !billIdentityTail(bill.importIdentity) ||
          billIdentityTail(other.importIdentity) === billIdentityTail(bill.importIdentity)))) continue;
    value.set(bill, new Map());
    const title = normalize(bill.title);
    byTitle.set(title, [...(byTitle.get(title) ?? []), bill]);
  }
  if (value.size) for (const transaction of transactions) {
    const targets = byTitle.get(normalize(transaction.title));
    if (!targets || !isSpending(transaction, live, internal) || transaction.amountFils <= 0) continue;
    for (const bill of targets) {
      // Unknown identity cannot stand in for an explicitly identified service.
      if (serviceIdentity(transaction.billIdentity) === null ||
          serviceIdentity(bill.importIdentity) !== serviceIdentity(transaction.billIdentity)) continue;
      if (transaction.billPayment) {
        const claim = transaction.billPayment;
        if (transaction.source !== 'manual' || claim.billId !== bill.id || !bill.paidMonths.includes(claim.month)) continue;
        const dueISO = bill.yearlyOnISO ? yearlyDueInMonth(claim.month, bill.yearlyOnISO)
          : dueDateInMonth(claim.month, bill.dueDay);
        if (!dueISO) continue;
        const ordinal = renewalOrdinal(bill, dueISO);
        const history = value.get(bill)!;
        const cycle = history.get(ordinal) ?? { dueISO, ordinal, rows: [], confirmed: false };
        cycle.rows.push(transaction);
        history.set(ordinal, cycle);
        continue;
      }
      const ordinal = renewalOrdinal(bill, transaction.date);
      const anchors = [ordinal - 1, ordinal, ordinal + 1].map(index => ({
        ordinal: index, dueISO: renewalAnchor(bill, index),
      }));
      const distance = (anchor: { dueISO: string }) => Math.abs(daysBetweenISO(transaction.date, anchor.dueISO));
      const minimum = Math.min(...anchors.map(distance));
      // A midpoint is ambiguous evidence for both adjacent cycles.
      for (const anchor of anchors.filter(candidate => distance(candidate) === minimum)) {
        const history = value.get(bill)!;
        const cycle = history.get(anchor.ordinal) ?? { ...anchor, rows: [], confirmed: false };
        cycle.rows.push(transaction);
        history.set(anchor.ordinal, cycle);
      }
    }
  }
  for (const [bill, history] of value) {
    for (const cycle of [...history.values()].sort((a, b) => a.ordinal - b.ordinal)) {
      const row = cycle.rows.length === 1 ? cycle.rows[0] : undefined;
      // A rise is a new plan price; a fall below half the saved price could
      // be an add-on, a top-up or a card check, so it counts only once the
      // previous cycle already renewed through this service.
      cycle.confirmed = Boolean(row && timelyRenewal(bill, row, cycle.dueISO) &&
        (row.amountFils * 2 >= bill.amountFils || history.get(cycle.ordinal - 1)?.confirmed));
    }
  }
  renewalHistoryCache = { bills, transactions, live, internal, value, monthStartDay: getMonthStartDay() };
  return value;
}

/**
 * Transactions that could be this bill's payment: same month, amount within
 * ±15% for manual estimates, and a title that either CONTAINS the bill's (or is contained by it) or
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
function candidatePayments(
  bill: Bill,
  transactions: Transaction[],
  key: string,
  live?: Set<string>,
  internal?: Set<string>,
): Transaction[] {
  const billTitle = normalize(bill.title);
  if (!billTitle) return [];
  const billTail = billIdentityTail(bill.importIdentity);
  // A notice is exact only for its stated cycle. Recurring averages and later
  // cycles keep estimate tolerance; a partial payment cannot settle this one.
  const hasStatedTotal = bill.autoDetected && bill.statedDueDate !== undefined &&
    bill.statedDueDate === dueDateInMonth(key, bill.dueDay);
  const minimumPayment = hasStatedTotal ? bill.amountFils : bill.amountFils * 0.85;
  const out: Transaction[] = [];
  for (const t of transactions) {
    // `live`/`internal` are what stop a bill settling against money the rest
    // of the app does not count. Without them a charge on an archived card
    // flipped a bill to "Paid" while Flow's Total out never moved — the user
    // stops looking at a bill that says paid, which is the expensive direction
    // of this error. Optional, so a caller with no accounts to hand (tests,
    // the importer) still gets the transfer rule; see ledger.ts.
    if (!isSpending(t, live, internal) || monthKey(t.date) !== key) continue;
    if (t.amountFils < minimumPayment || t.amountFils > bill.amountFils * 1.15) continue;
    // "Account 1849" and "consumer number 1849" can describe one provider's
    // customer, but the same four digits can occur at another provider. Amount
    // and month cannot establish who was paid. Require provider evidence even
    // for matching tails; a user-confirmed bill alias supplies it for a bank
    // nickname that otherwise tells us nothing about the provider.
    const paymentTail = billIdentityTail(t.billIdentity);
    // Matching provider names cannot override an explicitly different account.
    if (billTail && paymentTail && billTail !== paymentTail) continue;
    if (sameBillProvider(bill.title, t.title)) out.push(t);
  }
  return out;
}

/**
 * Same-month spending for bill reconciliation. Home's leaving-soon and Bills
 * both call `billsForMonth` on first paint; walking 14k rows per bill froze
 * that path. A newest-first ledger can stop once the current money month is
 * behind us. Unsorted callers still get a full scan — a sorted prefix is not
 * enough, or a later in-month payment after an older row would be missed.
 */
function datesAreNewestFirst(transactions: readonly Transaction[]): boolean {
  for (let index = 1; index < transactions.length; index += 1) {
    if (transactions[index - 1].date < transactions[index].date) return false;
  }
  return true;
}

function spendingInMonth(
  transactions: Transaction[],
  key: string,
  live?: Set<string>,
  internal?: Set<string>,
): Transaction[] {
  const newestFirst = datesAreNewestFirst(transactions);
  const out: Transaction[] = [];
  let seenInMonth = false;
  for (const t of transactions) {
    if (monthKey(t.date) !== key) {
      if (seenInMonth && newestFirst) break;
      continue;
    }
    seenInMonth = true;
    if (!isSpending(t, live, internal)) continue;
    out.push(t);
  }
  return out;
}

/** Status of each bill for the month containing `today`, sorted most urgent first. */
export function billsForMonth(
  bills: Bill[],
  transactions: Transaction[],
  today: Date,
  live?: Set<string>,
  internal?: Set<string>,
): BillWithStatus[] {
  const key = monthKey(today);
  const todayISO = toISODate(today);
  if (billsForMonthCache &&
      billsForMonthCache.bills === bills &&
      billsForMonthCache.transactions === transactions &&
      billsForMonthCache.key === key &&
      billsForMonthCache.monthStartDay === getMonthStartDay() &&
      billsForMonthCache.day === todayISO &&
      billsForMonthCache.live === live &&
      billsForMonthCache.internal === internal) {
    // The result is a shared projection. Return a shallow copy so a caller
    // sorting/splicing its own list cannot poison the next screen's cache hit.
    return billsForMonthCache.value.slice();
  }

  /**
   * The bills that fall due inside THIS money month, and where.
   *
   * A yearly bill is due in one month of twelve. It used to be due in all of
   * them, because `Bill` had no way to say otherwise and every bill was run
   * through `dueDateInMonth` — so an Amazon Prime renewal of AED 310 a YEAR
   * was listed, and notified, as AED 310 every month.
   */
  const scheduled: { bill: Bill; dueISO: string }[] = [];
  for (const bill of bills) {
    if (bill.yearlyOnISO) {
      const iso = yearlyDueInMonth(key, bill.yearlyOnISO);
      if (iso) scheduled.push({ bill, dueISO: iso });
      continue;
    }
    scheduled.push({ bill, dueISO: dueDateInMonth(key, bill.dueDay) });
  }

  /**
   * How many bills a given transaction could be the payment for.
   *
   * A token match is circumstantial, and the case it goes wrong on is a
   * household with two bills from the same company — an Etisalat internet
   * line and an Etisalat mobile line both share "etisalat", and if their
   * amounts are close enough to both clear the ±15% band, one charge would
   * mark both paid. An explicit account match outranks a provider-name guess.
   * Multiple claims of the same strength are not evidence for any one bill.
   * Better an unreconciled bill the user marks by hand than a
   * bill that says paid while the money is still owed.
   */
  const monthRows = spendingInMonth(transactions, key, live, internal);
  const histories = renewalHistories(bills, transactions, live, internal);
  const candidates = scheduled.map(({ bill, dueISO }) => {
    const history = histories.get(bill);
    if (!history) return candidatePayments(bill, monthRows, key, live, internal);
    const ordinal = renewalOrdinal(bill, dueISO);
    const cycle = history.get(ordinal);
    if (cycle?.confirmed) return cycle.rows;
    if (bill.autoDetected) return [];
    // A bill the person added keeps its same-month match for a charge off
    // the anchor, but never one that settled a neighbouring cycle: a
    // September 27 renewal for October must not also settle September.
    const elsewhere = new Set<string>();
    for (const [other, { rows, confirmed }] of history) if (other !== ordinal && confirmed) for (const row of rows) elsewhere.add(row.id);
    return candidatePayments(bill, monthRows, key, live, internal).filter(row => !elsewhere.has(row.id));
  });
  const explicitlyClaimed = new Set<string>();
  candidates.forEach((rows, index) => {
    for (const transaction of rows) {
      if (exactBillAccount(scheduled[index].bill, transaction)) explicitlyClaimed.add(transaction.id);
    }
  });
  const eligible = candidates.map((rows, index) => rows.filter((transaction) =>
    !explicitlyClaimed.has(transaction.id) || exactBillAccount(scheduled[index].bill, transaction)));
  const claims = new Map<string, number>();
  for (const rows of eligible) {
    for (const t of rows) {
      claims.set(t.id, (claims.get(t.id) ?? 0) + 1);
    }
  }

  const rows = scheduled.map(({ bill, dueISO }, index) => {
    // The paid flag is keyed to the MONEY month, so the date has to be found
    // inside that same month. It was calendar arithmetic — `bill.dueDay -
    // today.getDate()` — which describes a different month entirely once the
    // month starts on a salary day. With a start of the 25th, a bill due on
    // the 28th and paid on 28 June read "Paid" all through July while its
    // countdown talked about 28 July, and the July payment stayed invisible
    // until the 25th. `dueISO` is settled above, per cadence.
    const daysLeft = Math.round(
      (new Date(`${dueISO}T12:00:00`).getTime() - new Date(`${todayISO}T12:00:00`).getTime()) /
        86400000,
    );
    const manuallyPaid = bill.paidMonths.includes(key);
    const autoReconciled =
      !manuallyPaid &&
      eligible[index].some(
        (t) => (claims.get(t.id) ?? 0) === 1,
      );
    let status: BillStatus;
    if (manuallyPaid || autoReconciled) status = 'paid';
    else if (daysLeft < 0) status = 'overdue';
    else if (daysLeft <= 5) status = 'due-soon';
    else status = 'upcoming';
    const history = histories.get(bill);
    const ordinal = renewalOrdinal(bill, dueISO);
    const current = history?.get(ordinal);
    const prior = history?.get(ordinal - 1);
    const evidence = current?.confirmed ? current : !current && prior?.confirmed ? prior : undefined;
    const projectedBill = evidence ? { ...bill, amountFils: evidence.rows[0].amountFils } : bill;
    return { bill: projectedBill, status, daysLeft, dueISO, autoReconciled };
  });

  const rank: Record<BillStatus, number> = { overdue: 0, 'due-soon': 1, upcoming: 2, paid: 3 };
  rows.sort((a, b) => rank[a.status] - rank[b.status] || a.daysLeft - b.daysLeft);
  billsForMonthCache = { bills, transactions, key, day: todayISO, live, internal, value: rows,
    monthStartDay: getMonthStartDay() };
  return rows.slice();
}
