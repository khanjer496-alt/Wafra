import { daysBetweenISO, shiftISO, toISODate } from '@/lib/format';
import { waitForForegroundHistoryIdle } from '@/lib/foreground-history-priority';
import { isIncome, isSpending } from '@/lib/ledger';
import type { Account, Bill, CategoryId, Transaction } from '@/lib/types';

export type Cadence = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly' | 'as-needed';

/**
 * subscription — cancellable online/lifestyle services (streaming, apps, gym);
 * utility — recurring DEWA/telecom-style bills; housing — rent;
 * commitment — anything else that recurs (suppliers, fees, transfers to people).
 * Kept separate so "subscriptions total" only counts what you could cancel.
 */
export type RecurringGroup = 'subscription' | 'utility' | 'housing' | 'commitment';

export interface Subscription {
  title: string;
  /** Provider service identity, retaining only a closed kind and masked tail. */
  billIdentity?: string;
  category: CategoryId;
  group: RecurringGroup;
  /** stopped = silent for well past its cadence (likely cancelled). */
  status: 'active' | 'stopped';
  cadence: Cadence;
  avgAmountFils: number;
  /**
   * The latest charge at the plan's price. A lone outlier — a misparse, a
   * one-off purchase on the same descriptor, or the first charge of an annual
   * plan after months of monthly ones — is not what the plan will charge next,
   * so it is skipped here exactly as it is in `priceIncreased`.
   */
  lastAmountFils: number;
  lastChargedISO: string;
  nextExpectedISO: string;
  chargeCount: number;
  /** Every observation is a bank-confirmed registered-biller payment receipt. */
  paymentHistory: boolean;
  /** Latest charge is >10% above the average of prior charges. */
  priceIncreased: boolean;
  /**
   * What the prior charges typically were — the figure `priceIncreased` was
   * decided against, and therefore the only honest thing to show beside the
   * new price. `avgAmountFils` includes the latest charge, so quoting THAT
   * produced "Last charge AED 386 vs the usual AED 386": a rise announced
   * against a number that had already absorbed it.
   */
  priorTypicalFils: number;
  /** Monthly-equivalent cost for totals (yearly/12, quarterly/3, weekly*4.33). */
  monthlyEquivalentFils: number;
  /**
   * Present only when one billing descriptor carries several concurrent plans
   * (Apple bills iCloud+ and Apple Music alike as "Apple"): the stable price
   * points of the plan this row describes, oldest first. The first one is part
   * of `subscriptionKey`, so the plans keep separate reminders, dismissals and
   * cancellations; `matchesRecurringTransaction` uses all of them.
   */
  priceTrackFils?: number[];
}

/**
 * Account/card evidence safe enough to print beside a recurring payment.
 *
 * A registered-payee receipt names the biller and amount but often no funding
 * instrument. Import keeps the money visible on a fallback account because a
 * ledger row cannot be unattached; that fallback is routing, not proof. Show
 * a receipt account only when the alert named it or the user selected it.
 * Ordinary card alerts carry their own instrument evidence and remain visible
 * as before.
 */
export const recurringPaymentAccount = (
  transaction: Transaction,
  accounts: Account[],
): Account | undefined => {
  if (transaction.paymentFlowSide === 'receipt' && !transaction.paymentInstrumentSource) {
    return undefined;
  }
  return accounts.find((account) => account.id === transaction.accountId);
};

interface CadenceWindow {
  cadence: Cadence;
  minDays: number;
  maxDays: number;
  typicalDays: number;
  /**
   * Days past the expected renewal before a silent subscription reads as
   * stopped. One whole missed cycle plus this grace is the evidence; the old
   * "2.2 cycles" rule kept a cancelled yearly plan active for 26 months.
   */
  graceDays: number;
  /** Bills are paid by hand, early or late, so they get a longer grace. */
  billGraceDays: number;
}

const WINDOWS: CadenceWindow[] = [
  { cadence: 'weekly', minDays: 6, maxDays: 8, typicalDays: 7, graceDays: 10, billGraceDays: 10 },
  { cadence: 'biweekly', minDays: 13, maxDays: 15, typicalDays: 14, graceDays: 14, billGraceDays: 14 },
  { cadence: 'monthly', minDays: 26, maxDays: 35, typicalDays: 30, graceDays: 15, billGraceDays: 30 },
  { cadence: 'quarterly', minDays: 84, maxDays: 97, typicalDays: 91, graceDays: 30, billGraceDays: 45 },
  { cadence: 'yearly', minDays: 350, maxDays: 380, typicalDays: 365, graceDays: 45, billGraceDays: 60 },
];

/**
 * A gap of two or three cycles is a skipped renewal (a declined card, a month
 * paused), not a different cadence. Without this, a third charge after one
 * skipped month ERASED a subscription that two charges had already proven.
 *
 * Only where there is subscription evidence (a named service or a software
 * category). For an ordinary merchant a long gap is just a gap: counting it
 * made irregular pharmacy visits a "monthly commitment".
 */
const SKIPPED_CYCLE_MULTIPLES = [2, 3];

/** Silence after which an as-needed top-up reads as stopped. */
const AS_NEEDED_STOP_DAYS = 75;

const monthOrdinal = (iso: string): number =>
  Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;

/**
 * The latest one-payment-per-month run from a registered bill-payee.
 *
 * Bills are commonly paid early or late, so their day gaps can be 20 then 40
 * even though one obligation was settled in every calendar month. Looking at
 * calendar coverage preserves that evidence. Requiring exactly one payment in
 * each month keeps an on-demand wallet top-up out of the monthly bucket.
 */
const latestMonthlyReceiptRun = (charges: Transaction[]): Transaction[] => {
  const byMonth = new Map<number, Transaction[]>();
  for (const charge of charges) {
    const ordinal = monthOrdinal(charge.date);
    const month = byMonth.get(ordinal) ?? [];
    month.push(charge);
    byMonth.set(ordinal, month);
  }
  const lastMonth = Math.max(...byMonth.keys());
  const descending: Transaction[] = [];
  // One early or late payment moves a bill into its neighbouring month: two
  // payments in August and none in September is still one per month. Accept
  // exactly one such pair per run; a wallet topped up at will produces more.
  let pairAllowance = 1;
  for (let month = lastMonth; ; month -= 1) {
    const rows = byMonth.get(month) ?? [];
    if (rows.length === 1) {
      descending.push(rows[0]);
      continue;
    }
    if (pairAllowance === 0) break;
    const earlier = byMonth.get(month - 1) ?? [];
    if (rows.length === 0 && earlier.length === 2) {
      // This month's payment was made early, at the end of the month before.
      descending.push(earlier[1], earlier[0]);
    } else if (rows.length === 2 && earlier.length === 0) {
      // Last month's payment was made late, in this month.
      descending.push(rows[1], rows[0]);
    } else {
      break;
    }
    pairAllowance -= 1;
    month -= 1;
  }
  return descending.length >= 3 ? descending.reverse() : [];
};

/**
 * Repeated registered payments with no honest calendar cadence.
 *
 * A prepaid toll/phone wallet can be topped up several times in one month and
 * not at all in another. It is still a real repeating commitment, but it must
 * be labelled "as needed" and must never generate a made-up due-date alert.
 */
const latestAsNeededReceiptRun = (charges: Transaction[]): Transaction[] => {
  const last = charges.at(-1);
  if (!last) return [];
  const cutoff = shiftISO(last.date, -120);
  const recent = charges.filter((charge) => charge.date >= cutoff);
  const months = new Set(recent.map((charge) => charge.date.slice(0, 7)));
  return recent.length >= 4 && months.size >= 3 ? recent : [];
};

/**
 * Merchants that are subscriptions by nature: one observed interval (or even a
 * single charge for monthly staples) is enough to surface them.
 */
const KNOWN_SUBSCRIPTION_MERCHANTS =
  // Word-bounded: an unbounded /canva/ made "Canvas Home Llc" a subscription
  // at AED 1,290 a month. The optional suffixes keep the parser's own joined
  // canonical names ("StarzPlay", "OSN+", "Disney+") matching.
  /\b(?:netflix|spotify|anghami|osn|shahid|starz(?:play)?|you\s*tube|yt premium|apple\.com|apple services|icloud|google one|google storage|amazon prime|prime video|openai|chat\s*gpt|claude|anthropic|real-?debrid|all-?debrid|disney(?:plus)?|hbo(?:\s*max)?|deezer|audible|kindle|linkedin|dropbox|adobe|canva|microsoft 365|office 365|discord|notion|github|telegram premium|xbox game pass|playstation plus|psn plus|fitness first|gymnation|fitness time|classpass|etisalat postpaid|du postpaid|home internet)\b/i;

/**
 * The parser titles every APPLE.COM/BILL and ITUNES charge "Apple", so this is
 * where iCloud+, Apple Music and Apple One arrive. It is ALSO where an Apple
 * Store purchase arrives, so the title alone is not enough: it counts as a
 * known service only once its price is stable (see `analyzeRecurringCharges`).
 */
const APPLE_BILLING_TITLE = /^\s*apple\s*$/i;

/** A title that names a subscription service (Apple subject to price stability). */
function isKnownServiceTitle(title: string): boolean {
  return KNOWN_SUBSCRIPTION_MERCHANTS.test(title) || APPLE_BILLING_TITLE.test(title);
}

// Both of these used to be local copies. Date arithmetic re-implemented per
// module is how the app ended up with two different answers for "when is this
// due", so there is now one of each, in format.ts. Kept as local aliases so the
// call sites below still read as prose; they are not second implementations.
const daysBetween = daysBetweenISO;
const addDays = shiftISO;

/** Calendar renewals preserve their billing day instead of drifting by 30/365 days. */
function nextRenewalISO(charges: Transaction[], window: CadenceWindow): string {
  const last = charges[charges.length - 1].date;
  const monthsAhead =
    window.cadence === 'monthly' ? 1 : window.cadence === 'quarterly' ? 3 : window.cadence === 'yearly' ? 12 : 0;
  if (monthsAhead === 0) {
    return addDays(last, window.typicalDays);
  }
  const [year, month, day] = last.split('-').map(Number);
  let billingDay = day;
  const monthLength = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day === monthLength) {
    // A January 31 renewal can post February 28. Retain the recent day that
    // was clamped so March returns to 31, without changing an ordinary day 28.
    // An annual leap-day anchor must survive all three intervening years.
    const recent = window.cadence === 'yearly'
      ? charges.filter((charge) => Number(charge.date.slice(5, 7)) === month)
      : charges.slice(-3);
    billingDay = Math.max(day, ...recent.map((charge) => Number(charge.date.slice(8, 10))));
  }
  const target = new Date(Date.UTC(year, month - 1 + monthsAhead, 1));
  const targetLastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(billingDay, targetLastDay));
  return target.toISOString().slice(0, 10);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Software-service charges can corroborate subscription cadence. Shopping,
 * entertainment and health also contain ordinary visits and purchases, so
 * those categories require a named subscription provider instead.
 *
 * `software` is here because it had to be: every AI assistant, domain renewal
 * and design tool used to be categorised `entertainment`, and moving them to
 * their own category would otherwise have quietly demoted the app's most
 * canonical subscriptions — ChatGPT, Claude, Vercel, Google One — from
 * "subscription" to "commitment", emptying the tab the user manages them from.
 * A per-seat licence is the definition of a subscription.
 *
 * `investing` is deliberately NOT here. A monthly transfer into a brokerage is
 * recurring, but it is not a service anyone would want prompted to cancel, and
 * listing it beside Netflix invites exactly that.
 */
const SUBSCRIPTION_CATEGORIES = new Set<CategoryId>([
  'software',
]);

/**
 * Real subscription detection: per-merchant charge cadence with amount
 * stability, boosted by a known-subscription merchant list. Merchants the
 * user marked "not a subscription" are skipped entirely.
 *
 * `liveAccounts`/`internalTransfers` are optional so callers working from a
 * bare transaction list (tests) still get the base transfer-flag rule, but
 * every screen with the accounts to hand should pass both — otherwise a
 * recurring own-account sweep that predates the transfer flag (caught only by
 * `internalTransferIds`' structural title match) reads as a monthly
 * commitment instead of the user's own money moving pockets.
 */
/** Materially different — the same threshold the rise test uses. */
function differs(a: number, b: number): boolean {
  return Math.abs(a - b) > Math.min(a, b) * 0.1;
}

/**
 * The contiguous run of charges, ending just before the current price began,
 * that were charged at a different price. Empty when the price never changed.
 *
 * amounts is oldest-first, so this walks backwards past every charge at the
 * current price, then collects the run of the price before it.
 */
function previousPriceRun(amounts: number[]): number[] {
  if (amounts.length < 2) return [];
  const current = amounts[amounts.length - 1];
  let i = amounts.length - 1;
  while (i >= 0 && !differs(amounts[i], current)) i -= 1;
  if (i < 0) return []; // never anything else
  const previous = amounts[i];
  const run: number[] = [];
  while (i >= 0 && !differs(amounts[i], previous)) {
    run.unshift(amounts[i]);
    i -= 1;
  }
  return run;
}

/**
 * Stable provider identity for recurring utility payments.
 *
 * Bank acquirers describe the payment channel as part of the merchant — the
 * same line appears as "Etisalat Digital App", "Etisalat Quickpay" and
 * "Utility payment-Etisalat". Grouping on the raw title makes every variant a
 * one-off, so the fixed-bills tab stays empty even though the provider is paid
 * every month. Keep this deliberately closed to named UAE providers and to
 * parser-assigned utility/telecom rows; an arbitrary shop containing "internet"
 * must never become a household bill.
 */
export function recurringProviderTitle(transaction: Pick<Transaction, 'title' | 'category' | 'userEdited'>): string {
  if (transaction.userEdited ||
    (transaction.category !== 'utilities' && transaction.category !== 'telecom')) {
    return transaction.title.trim();
  }
  const title = transaction.title.trim();
  if (/\betisalat\b/i.test(title) || /^e\s*&\s*$/i.test(title)) return 'E&';
  if (/\bdu\b/i.test(title)) return 'du';
  if (/\bsewa\b/i.test(title)) return 'SEWA';
  if (/\bdewa\b/i.test(title)) return 'DEWA';
  if (/\b(?:fewa|etihadwe)\b/i.test(title)) return 'EtihadWE';
  return title;
}

type RecurringIdentity = Pick<Subscription, 'title' | 'billIdentity' | 'priceTrackFils'>;

/** Keep kinds distinct: a matching last four alone does not prove one service. */
function normalizedBillIdentity(identity: string | undefined): string | undefined {
  return typeof identity === 'string' && /^(?:account|consumer|party|customer|contract|service):[a-z0-9]{4}$/i.test(identity)
    ? identity.toLowerCase()
    : undefined;
}

/** The plan anchor of a concurrent-plan row: its oldest stable price. */
function priceTrackAnchor(sub: RecurringIdentity): number | undefined {
  const anchor = sub.priceTrackFils?.[0];
  return typeof anchor === 'number' && Number.isSafeInteger(anchor) && anchor > 0 ? anchor : undefined;
}

/** Stable persistence/navigation key; legacy unidentified providers keep their old key. */
export function subscriptionKey(sub: RecurringIdentity): string {
  const provider = sub.title.trim().toLowerCase();
  const identity = normalizedBillIdentity(sub.billIdentity);
  const anchor = priceTrackAnchor(sub);
  if (anchor !== undefined) return `track:${JSON.stringify([provider, identity ?? null, anchor])}`;
  if (identity) return `service:${JSON.stringify([provider, identity])}`;
  // Raw merchant names are user-editable. Keep their namespace separate from
  // encoded service keys, including names resembling another escaped name.
  return /^(?:service|provider|track):/.test(provider) ? `provider:${JSON.stringify(provider)}` : provider;
}

/** The same provider/service key with any concurrent-plan anchor removed. */
function serviceKey(sub: RecurringIdentity): string {
  return subscriptionKey({ title: sub.title, billIdentity: sub.billIdentity });
}

/** Only canonical service (and concurrent-plan) keys may persist scoped undo markers. */
export function isScopedSubscriptionKey(key: string): boolean {
  if (key.startsWith('track:')) {
    try {
      const value: unknown = JSON.parse(key.slice('track:'.length));
      if (!Array.isArray(value) || value.length !== 3) return false;
      const [title, identity, anchor] = value as unknown[];
      if (typeof title !== 'string' || title.trim().length === 0) return false;
      if (typeof anchor !== 'number' || !Number.isSafeInteger(anchor) || anchor <= 0) return false;
      let billIdentity: string | undefined;
      if (typeof identity === 'string') {
        if (normalizedBillIdentity(identity) === undefined) return false;
        billIdentity = identity;
      } else if (identity !== null) {
        return false;
      }
      return subscriptionKey({ title, billIdentity, priceTrackFils: [anchor] }) === key;
    } catch {
      return false;
    }
  }
  if (!key.startsWith('service:')) return false;
  try {
    const value: unknown = JSON.parse(key.slice('service:'.length));
    return Array.isArray(value) && value.length === 2 &&
      typeof value[0] === 'string' && value[0].trim().length > 0 && typeof value[1] === 'string' &&
      normalizedBillIdentity(value[1]) !== undefined &&
      subscriptionKey({ title: value[0], billIdentity: value[1] }) === key;
  } catch {
    return false;
  }
}

/** Human-facing discriminator without changing the provider used by merchant logos. */
export function subscriptionLabel(sub: RecurringIdentity): string {
  const identity = normalizedBillIdentity(sub.billIdentity);
  return identity ? `${sub.title} · •••• ${identity.slice(-4).toUpperCase()}` : sub.title;
}

/** The detail history uses exactly the same provider/service boundary as detection. */
export function matchesRecurringTransaction(sub: RecurringIdentity, transaction: Transaction): boolean {
  if (serviceKey(sub) !== subscriptionKey({
    title: recurringProviderTitle(transaction),
    billIdentity: transaction.billIdentity,
  })) return false;
  // One of several plans on a shared descriptor owns only its own prices.
  const track = sub.priceTrackFils;
  return !track?.length || track.some((price) => !differs(price, transaction.amountFils));
}

/** An identified bill replaces only its own service; old manual reminders cover the provider. */
export function subscriptionMatchesBill(
  sub: RecurringIdentity,
  bill: Pick<Bill, 'title' | 'category' | 'importIdentity'>,
): boolean {
  const provider = recurringProviderTitle(bill).trim().toLowerCase();
  if (sub.title.trim().toLowerCase() !== provider) return false;
  if (!bill.importIdentity) return true;
  const identity = normalizedBillIdentity(bill.importIdentity);
  return identity !== undefined && identity === normalizedBillIdentity(sub.billIdentity);
}

/** Scoped choices coexist with provider-wide choices saved by earlier versions. */
export function isSubscriptionDismissed(
  sub: RecurringIdentity,
  dismissed: readonly string[] | ReadonlySet<string>,
): boolean {
  const keys: ReadonlySet<string> = Array.isArray(dismissed)
    ? new Set(dismissed.map((key) => key.trim().toLowerCase()))
    : dismissed as ReadonlySet<string>;
  return keys.has(subscriptionKey(sub)) || keys.has(serviceKey(sub)) ||
    keys.has(subscriptionKey({ title: sub.title }));
}

type SubscriptionDetectionKey = {
  transactions: Transaction[];
  notSubscriptions: string[];
  todayKey: string;
  liveAccounts?: Set<string>;
  internalTransfers?: Set<string>;
};

type SubscriptionDetectionCacheEntry = SubscriptionDetectionKey & { value: Subscription[] };
type SubscriptionDetectionInFlight = SubscriptionDetectionKey & {
  promise: Promise<Subscription[] | null>;
  /** Every caller's cancellation probe; the default one never cancels. */
  waiters: (() => boolean)[];
  /** A newer ledger snapshot has started its own projection since. */
  superseded: boolean;
};

// A single-entry cache let an unrelated caller evict Bills' projection, so
// switching tabs could restart a 15k-row scan even though the ledger had not
// changed. Keep a tiny LRU instead. Store snapshots are immutable, so the
// transaction/dismissal array references are an exact semantic key and need no
// O(n) fingerprint.
const SUBSCRIPTION_CACHE_MAX = 4;
let subscriptionDetectionCache: SubscriptionDetectionCacheEntry[] = [];
let subscriptionDetectionInFlight: SubscriptionDetectionInFlight[] = [];

/**
 * The detector reads the live/internal sets only through membership, so two
 * sets with the same members give the same answer. Comparing members (after
 * the free identity check) is what lets Bills, reminders and Ask share one job:
 * each builds its own Set for the same ledger, and a capture that re-stamps an
 * identical transfer receipt mints a new one. An identity-only key made every
 * such caller start its own full-ledger scan beside the others.
 */
function sameMembers(a?: Set<string>, b?: Set<string>): boolean {
  if (a === b) return true;
  if (!a || !b || a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

function sameDetectionKey(
  entry: SubscriptionDetectionKey,
  transactions: Transaction[],
  notSubscriptions: string[],
  todayKey: string,
  liveAccounts?: Set<string>,
  internalTransfers?: Set<string>,
): boolean {
  return entry.transactions === transactions &&
    entry.notSubscriptions === notSubscriptions &&
    entry.todayKey === todayKey &&
    sameMembers(entry.liveAccounts, liveAccounts) &&
    sameMembers(entry.internalTransfers, internalTransfers);
}

function cachedSubscriptionDetection(
  transactions: Transaction[],
  notSubscriptions: string[],
  todayKey: string,
  liveAccounts?: Set<string>,
  internalTransfers?: Set<string>,
): Subscription[] | null {
  const index = subscriptionDetectionCache.findIndex((entry) =>
    sameDetectionKey(entry, transactions, notSubscriptions, todayKey, liveAccounts, internalTransfers));
  if (index < 0) return null;
  const [entry] = subscriptionDetectionCache.splice(index, 1);
  subscriptionDetectionCache.push(entry);
  return entry.value;
}

function cacheSubscriptionDetection(
  transactions: Transaction[],
  notSubscriptions: string[],
  todayKey: string,
  liveAccounts: Set<string> | undefined,
  internalTransfers: Set<string> | undefined,
  value: Subscription[],
): Subscription[] {
  subscriptionDetectionCache = subscriptionDetectionCache.filter((entry) =>
    !sameDetectionKey(entry, transactions, notSubscriptions, todayKey, liveAccounts, internalTransfers));
  subscriptionDetectionCache.push({
    transactions,
    notSubscriptions,
    todayKey,
    liveAccounts,
    internalTransfers,
    value,
  });
  if (subscriptionDetectionCache.length > SUBSCRIPTION_CACHE_MAX) subscriptionDetectionCache.shift();
  return value;
}

/**
 * The finished projection for exactly this input, if one is cached; never
 * starts work. Lets a screen that mounts after another caller (reminders, a
 * previous visit) finished the scan paint that answer on its first frame.
 */
export function peekSubscriptionDetection(
  transactions: Transaction[],
  notSubscriptions: string[] = [],
  today: Date = new Date(),
  liveAccounts?: Set<string>,
  internalTransfers?: Set<string>,
): Subscription[] | null {
  return cachedSubscriptionDetection(
    transactions,
    notSubscriptions,
    toISODate(today),
    liveAccounts,
    internalTransfers,
  );
}

/** Whether a cooperative projection for exactly this input is already running. */
export function subscriptionDetectionRunning(
  transactions: Transaction[],
  notSubscriptions: string[] = [],
  today: Date = new Date(),
  liveAccounts?: Set<string>,
  internalTransfers?: Set<string>,
): boolean {
  const todayKey = toISODate(today);
  return subscriptionDetectionInFlight.some((entry) =>
    sameDetectionKey(entry, transactions, notSubscriptions, todayKey, liveAccounts, internalTransfers));
}

/** Categories whose recurring charges are bills: their amounts are never stable. */
const isBillLikeCategory = (category: CategoryId): boolean =>
  category === 'utilities' || category === 'telecom' || category === 'rent' || category === 'loan';

const byDate = (a: Transaction, b: Transaction): number => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

/** How long after a charge a same-merchant credit of the same amount is its refund. */
const REFUND_MATCH_DAYS = 10;

/**
 * The charges left once each same-merchant refund has cancelled the charge it
 * returned. A duplicate charge refunded two days later otherwise read as a
 * price rise (AED 78 against the usual 39), and a final charge refunded after
 * cancelling kept predicting a renewal the user had already stopped.
 *
 * Deliberately narrow: a credit nets out one charge of the same amount (within
 * 2% for card FX) from the preceding ten days, latest first. Partial refunds
 * and credits with no matching charge change nothing.
 */
function withoutRefundedCharges(charges: Transaction[], refunds: Transaction[] | undefined): Transaction[] {
  if (!refunds || refunds.length === 0) return charges;
  const refunded = new Set<Transaction>();
  for (const refund of [...refunds].sort(byDate)) {
    let match: Transaction | undefined;
    for (const charge of charges) {
      if (refunded.has(charge) || charge.date > refund.date) continue;
      if (daysBetween(charge.date, refund.date) > REFUND_MATCH_DAYS) continue;
      const tolerance = Math.max(1, Math.round(charge.amountFils * 0.02));
      if (Math.abs(charge.amountFils - refund.amountFils) > tolerance) continue;
      if (!match || charge.date > match.date) match = charge;
    }
    if (match) refunded.add(match);
  }
  return refunded.size === 0 ? charges : charges.filter((charge) => !refunded.has(charge));
}

/**
 * Whether the amounts are a short sequence of stable prices: every price held
 * for at least two charges, and the current one for `minCurrentRun`. That is
 * what a plan with a price change looks like — 36.73 four times, then 110.19 —
 * and what a shop visited at random amounts does not. A whole-history ±15%
 * test hid every subscription whose price had ever moved.
 */
function stableByPriceRuns(amounts: number[], minCurrentRun: number): boolean {
  const runs: number[][] = [];
  for (const amount of amounts) {
    const run = runs[runs.length - 1];
    if (run && amount >= run[0] * 0.85 && amount <= run[0] * 1.15) run.push(amount);
    else runs.push([amount]);
  }
  return runs.length > 0 && runs.length <= 3 &&
    runs.every((run) => run.length >= 2) &&
    runs[runs.length - 1].length >= minCurrentRun;
}

interface PriceTrack {
  charges: Transaction[];
  prices: number[];
}

/** Both plans were charged at least twice while the other one was running. */
function interleaved(a: Transaction[], b: Transaction[]): boolean {
  const from = a[0].date > b[0].date ? a[0].date : b[0].date;
  const aEnd = a[a.length - 1].date;
  const bEnd = b[b.length - 1].date;
  const to = aEnd < bEnd ? aEnd : bEnd;
  if (from > to) return false;
  const inside = (rows: Transaction[]) => rows.filter((row) => row.date >= from && row.date <= to).length;
  return inside(a) >= 2 && inside(b) >= 2;
}

/**
 * Separate plans billed under one descriptor, or null when there is only one.
 *
 * Apple bills iCloud+ (3.69) and Apple Music (21.99) both as "Apple". Mixed
 * together, two different days a month read as a 14/16-day rhythm and nothing
 * was detected; on the same day they merged into one 25.68 charge.
 *
 * Charges are clustered by stable price (within the 10% `differs` threshold).
 * A price that follows another one's last charge is the same plan repriced, so
 * it extends that plan rather than starting a new one. Only clusters of two or
 * more charges take part, so a one-off purchase on the descriptor is ignored,
 * and the split happens only when two plans genuinely ran side by side.
 */
function concurrentPriceTracks(charges: Transaction[]): PriceTrack[] | null {
  const byAmount = [...charges].sort((a, b) => a.amountFils - b.amountFils);
  const clusters: Transaction[][] = [];
  for (const charge of byAmount) {
    const cluster = clusters[clusters.length - 1];
    if (cluster && !differs(cluster[0].amountFils, charge.amountFils)) cluster.push(charge);
    else clusters.push([charge]);
  }
  const priced = clusters.filter((cluster) => cluster.length >= 2).map((cluster) => cluster.sort(byDate));
  if (priced.length < 2) return null;
  priced.sort((a, b) => byDate(a[0], b[0]));

  const tracks: PriceTrack[] = [];
  for (const cluster of priced) {
    let target: PriceTrack | undefined;
    for (const track of tracks) {
      const end = track.charges[track.charges.length - 1].date;
      if (end < cluster[0].date &&
        (!target || end > target.charges[target.charges.length - 1].date)) target = track;
    }
    const price = median(cluster.map((charge) => charge.amountFils));
    if (target) {
      target.charges.push(...cluster);
      target.prices.push(price);
    } else {
      tracks.push({ charges: [...cluster], prices: [price] });
    }
  }
  if (tracks.length < 2) return null;
  const concurrent = tracks.some((a, i) =>
    tracks.some((b, j) => j > i && interleaved(a.charges, b.charges)));
  return concurrent ? tracks : null;
}

/**
 * Analyse one merchant/service group (oldest first) as a recurring payment.
 * Returns null when the charges are not evidence of recurrence.
 */
function* analyzeRecurringCharges(
  txs: Transaction[],
  todayISO: string,
  priceTrackFils?: number[],
): Generator<void, Subscription | null, void> {
  const title = txs[txs.length - 1].title;
  const knownService = KNOWN_SUBSCRIPTION_MERCHANTS.test(title);
  const appleBilling = APPLE_BILLING_TITLE.test(title);
  // This evidence belongs to every source observation, not to the collapsed
  // row below. A receipt and an ordinary purchase on the same day are mixed
  // evidence; whichever happens to sort first must not decide for both.
  const registeredReceipt =
    txs.length > 0 && txs.every((transaction) => transaction.paymentFlowSide === 'receipt');

  // Collapse same-day duplicates (split payments) into one charge.
  const charges: Transaction[] = [];
  for (let index = 0; index < txs.length; index += 1) {
    if (index > 0 && (index & 127) === 0) yield;
    const t = txs[index];
    const prev = charges[charges.length - 1];
    if (prev && prev.date === t.date) prev.amountFils += t.amountFils;
    else charges.push({ ...t });
  }

  const monthlyReceiptRun = registeredReceipt ? latestMonthlyReceiptRun(charges) : [];
  const asNeededReceiptRun =
    registeredReceipt && monthlyReceiptRun.length === 0
      ? latestAsNeededReceiptRun(charges)
      : [];
  const cadenceCharges = monthlyReceiptRun.length > 0
    ? monthlyReceiptRun
    : asNeededReceiptRun.length > 0
      ? asNeededReceiptRun
      : charges;
  const latestCategory = cadenceCharges[cadenceCharges.length - 1].category;

  // A utility bill is recurring precisely BECAUSE it is a bill, and its
  // amount is never stable — SEWA is 280 one month and 450 the next. The
  // ±15% gate below is the right test for a subscription and the wrong one
  // for a bill, and applying it to both left the Utilities tab empty for a
  // user who pays four of them every month. For these, cadence alone is the
  // evidence.
  const billLike = isBillLikeCategory(latestCategory);
  const softwareService = SUBSCRIPTION_CATEGORIES.has(latestCategory);

  const amounts = cadenceCharges.map((c) => c.amountFils);
  const mid = median(amounts);
  if (mid <= 0) return null;

  // Known merchants skip the stability gate, which let a single misparsed
  // charge set the price: one bad row put Canva on the list at AED 18,313 a
  // month. The typical charge is what the subscription costs, so a LONE charge
  // more than 3x or less than a third of the median is an outlier and takes
  // no part in the price, the average or the price-rise comparison. A charge
  // repeated at the next renewal is a real new price (a tier upgrade), not an
  // outlier, however far it moved.
  const loneOutlier = (amount: number, index: number) =>
    (amount < mid / 3 || amount > mid * 3) &&
    !(index > 0 && !differs(amounts[index - 1], amount)) &&
    !(index < amounts.length - 1 && !differs(amounts[index + 1], amount));
  const steadySeries = amounts.filter((amount, index) => !loneOutlier(amount, index));
  // A sharp DROP on the latest charge is kept as the price: a plan downgraded
  // from 399 to 89 renews at 89, and quoting the old price would overstate
  // the next charge. A sharp latest RISE is the annual-plan / misparse shape
  // and waits for a second charge to confirm it.
  const latestIndex = amounts.length - 1;
  const priceSeries = amounts.filter((amount, index) =>
    !loneOutlier(amount, index) || (index === latestIndex && amount < mid / 3));
  if (steadySeries.length === 0 || priceSeries.length === 0) return null;

  // Stability is judged on the current price, not the whole history: a plan
  // that moved from 36.73 to 110.19 is as stable as one that never moved.
  const wholeStable = amounts.every((a) => a >= mid * 0.85 && a <= mid * 1.15);
  const stable = wholeStable || stableByPriceRuns(amounts, 3);
  // "Apple" is a service only at a stable price; the Apple Store shares it.
  const known = knownService || (appleBilling && stableByPriceRuns(steadySeries, 2));

  // A bill varies, but it varies like a bill. Waiving the ±15% gate for
  // anything the parser called a utility waived it entirely, so a merchant
  // that happened to be charged twice a month apart became a standing
  // monthly commitment at whatever the larger charge was — one shop was
  // listed at AED 20,918/mo on two unrelated payments.
  //
  // Same band the outlier guard uses: a third to triple the median. SEWA at
  // 280 one month and 450 the next passes; two payments that have nothing to
  // do with each other do not.
  const billShaped = amounts.every((a) => a >= mid / 3 && a <= mid * 3);
  if (
    !stable &&
    !known &&
    !(billLike && billShaped) &&
    !((monthlyReceiptRun.length > 0 || asNeededReceiptRun.length > 0) && billShaped)
  ) return null;

  const gaps: number[] = [];
  for (let i = 1; i < cadenceCharges.length; i++) {
    if ((i & 127) === 0) yield;
    gaps.push(daysBetween(cadenceCharges[i - 1].date, cadenceCharges[i].date));
  }

  let window: CadenceWindow | null = null;
  // Intervals that are exactly one cycle long. Skipped cycles support a
  // cadence but never prove one on their own.
  let cycleIntervals = gaps.length;
  if (monthlyReceiptRun.length > 0) {
    window = WINDOWS.find((candidate) => candidate.cadence === 'monthly') ?? null;
  } else if (asNeededReceiptRun.length > 0) {
    window = {
      cadence: 'as-needed',
      minDays: 0,
      maxDays: Number.POSITIVE_INFINITY,
      typicalDays: median(gaps.filter((gap) => gap > 0)),
      graceDays: 0,
      billGraceDays: 0,
    };
  } else if (gaps.length > 0) {
    const skipsAllowed = known || softwareService;
    for (const w of WINDOWS) {
      let exact = 0;
      let consistent = 0;
      for (const gap of gaps) {
        if (gap >= w.minDays && gap <= w.maxDays) {
          exact += 1;
          consistent += 1;
        } else if (skipsAllowed &&
          SKIPPED_CYCLE_MULTIPLES.some((k) => gap >= w.minDays * k && gap <= w.maxDays * k)) {
          consistent += 1;
        }
      }
      if (exact >= 1 && consistent >= Math.max(1, Math.ceil(gaps.length * 0.6))) {
        window = w;
        cycleIntervals = exact;
        break;
      }
    }
  }

  // One charge is not evidence of recurrence, however well-known the
  // merchant is. Treating it as one invented subscriptions from a single
  // Prime Video rental or a one-off app-store purchase, and an imaginary
  // monthly commitment is worse than a real one surfacing a cycle late.
  // Known merchants still get the easier bar: one interval rather than two.
  // So does a yearly software renewal (a domain, a licence): waiting for a
  // third year of evidence hid it for two years.
  if (!window) return null;
  const requiredIntervals =
    known || billLike || (softwareService && window.cadence === 'yearly') ? 1 : 2;
  if (cycleIntervals < requiredIntervals) return null;

  const last = cadenceCharges[cadenceCharges.length - 1];
  // The price the plan charges now: the latest charge that is not a lone
  // outlier. An annual plan's first charge after six monthly ones is not the
  // monthly price, and is not a monthly price RISE either.
  const lastPriceFils = priceSeries[priceSeries.length - 1];
  // Compare against the MEDIAN of prior charges, and only once there are at
  // least two of them. A mean over one prorated first charge made every
  // steady subscription look like a price rise — Google One was flagged
  // "price up" in a month its price went down.
  // The latest charge against THE PRICE IT WAS BEFORE — the most recent
  // run of charges that differed from what is being paid now.
  //
  // Neither obvious window works. A lifetime median answers the wrong
  // question: Google One ran at AED 7.99 for a year, went to 76.99 on a
  // tier change, then down to 37, and the median of all sixteen prior
  // charges is still the 7.99 era — so a price that had just HALVED wore a
  // "price up" badge. A fixed window of the last three is no better: it
  // hides a rise that happened three charges ago, which is a rise the user
  // has been paying ever since.
  //
  // Walking back to the previous distinct price answers what was actually
  // asked. 37 after a run of 77 is a fall. 76.99 after a run of 7.99 is a
  // rise, however long ago it started. And a steady price has no previous
  // run at all, so there is nothing to announce.
  //
  // The run is taken whole rather than a single charge, so one bad parse
  // cannot masquerade as the old price.
  const priorAmounts = previousPriceRun(priceSeries);
  const priorTypical = priorAmounts.length ? median(priorAmounts) : lastPriceFils;
  // What it costs NOW, not what it averaged over its life. A lifetime average
  // reports a price the user no longer pays: Google One went from AED 7.99
  // to AED 76.99 on a tier upgrade and the app kept showing 7, because the
  // outlier guard treats a genuine new price the same as a misparse.
  //
  // The median of the last three charges tracks an upgrade immediately —
  // once two of the three are the new amount — while still absorbing a
  // single bad parse, which is all the outlier guard was ever needed for.
  const recent = priceSeries.slice(-3);
  const avg = median(recent);
  const monthlyEquivalentFils =
    window.cadence === 'as-needed'
      ? Math.round(
          amounts.reduce((sum, amount) => sum + amount, 0) /
            (120 / 30.4375),
        )
      : window.cadence === 'monthly'
      ? avg
      : window.cadence === 'weekly'
        ? Math.round(avg * 4.33)
        : window.cadence === 'biweekly'
          ? Math.round((avg * 30.4375) / 14)
          : window.cadence === 'quarterly'
            ? Math.round(avg / 3)
            : Math.round(avg / 12);

  const group: RecurringGroup =
    last.category === 'rent'
      ? 'housing'
      : last.category === 'utilities' || last.category === 'telecom'
        ? 'utility'
        : known || SUBSCRIPTION_CATEGORIES.has(last.category)
          ? 'subscription'
          : 'commitment';

  // Stopped once a whole cycle has been missed and its grace has run out: a
  // monthly plan is stopped about 45 days after its last charge, a yearly
  // one about 410. Bills, which are paid by hand, get a longer grace.
  const nextExpectedISO = nextRenewalISO(cadenceCharges, window);
  const status: Subscription['status'] =
    window.cadence === 'as-needed'
      ? daysBetween(last.date, todayISO) > AS_NEEDED_STOP_DAYS ? 'stopped' : 'active'
      : daysBetween(nextExpectedISO, todayISO) >
          (billLike || registeredReceipt ? window.billGraceDays : window.graceDays)
        ? 'stopped'
        : 'active';

  return {
    title,
    ...(normalizedBillIdentity(last.billIdentity) ? { billIdentity: normalizedBillIdentity(last.billIdentity) } : {}),
    category: last.category,
    group,
    status,
    cadence: window.cadence,
    avgAmountFils: avg,
    lastAmountFils: lastPriceFils,
    lastChargedISO: last.date,
    nextExpectedISO,
    chargeCount: cadenceCharges.length,
    paymentHistory: registeredReceipt,
    priceIncreased:
      window.cadence !== 'as-needed' &&
      priorAmounts.length >= 2 &&
      lastPriceFils > priorTypical * 1.1,
    priorTypicalFils: priorTypical,
    monthlyEquivalentFils,
    ...(priceTrackFils ? { priceTrackFils } : {}),
  };
}

/**
 * The recurrence projection is deliberately expressed as a cooperative worker.
 * A 15k-row imported ledger is normal on Android, and running the complete scan
 * in one React render can hold the JS thread long enough for the first Bills tap
 * to look frozen. The synchronous public API drives this worker to completion
 * for existing callers/tests; Android Bills drives the same worker in short
 * slices so navigation and touch handling keep getting turns.
 */
function* subscriptionDetectionWorker(
  transactions: Transaction[],
  notSubscriptions: string[] = [],
  today: Date = new Date(),
  liveAccounts?: Set<string>,
  internalTransfers?: Set<string>,
): Generator<void, Subscription[], void> {
  const dismissed = new Set(notSubscriptions.map((s) => s.trim().toLowerCase()));
  const todayISO = toISODate(today);
  const groups = new Map<string, Transaction[]>();
  // Same-merchant credits, keyed exactly like the charge groups they refund.
  const refunds = new Map<string, Transaction[]>();
  // Persisted/store transaction order is newest-first. Remember whether this
  // input has that invariant so each merchant group can be reversed in O(n)
  // rather than independently sorted. Callers with arbitrary arrays still get
  // the old comparator path.
  let newestFirst = true;
  for (let index = 1; index < transactions.length; index += 1) {
    if ((index & 127) === 0) yield;
    if (transactions[index - 1].date < transactions[index].date) {
      newestFirst = false;
      break;
    }
  }
  for (let index = 0; index < transactions.length; index += 1) {
    if ((index & 127) === 0) yield;
    const t = transactions[index];
    const spending = isSpending(t, liveAccounts, internalTransfers);
    if (!spending && !isIncome(t, liveAccounts, internalTransfers)) continue;
    const providerTitle = recurringProviderTitle(t);
    const providerKey = providerTitle.toLowerCase();
    const service = { title: providerTitle, billIdentity: normalizedBillIdentity(t.billIdentity) };
    // A raw merchant title can resemble a public service key. Keep the internal
    // partition structurally distinct so such a title cannot merge ledger rows.
    const k = JSON.stringify([providerKey, service.billIdentity ?? null]);
    if (!providerKey || isSubscriptionDismissed(service, dismissed)) continue;
    if (!spending) {
      const list = refunds.get(k) ?? [];
      list.push(t);
      refunds.set(k, list);
      continue;
    }
    // A fee alert proves a posted fee, not a future commitment. Even an annual
    // fee needs stable card/account identity carried through the Subscription
    // model before it can safely become a recurring bill. Until then every
    // parser-minted fee stays out of automatic recurrence detection.
    if (/fee$/.test(providerKey) || providerKey === 'service charge') continue;
    const list = groups.get(k) ?? [];
    list.push(providerTitle === t.title ? t : { ...t, title: providerTitle });
    groups.set(k, list);
  }

  const subs: Subscription[] = [];
  for (const [key, grouped] of groups) {
    const txs = withoutRefundedCharges(grouped, refunds.get(key));
    // A single observation can never satisfy the recurrence rules below, even
    // for a known subscription provider. Skip it before yielding into the
    // expensive per-merchant cadence path. Large imported ledgers contain
    // thousands of one-off merchants; yielding once for every impossible group
    // turns a bounded scan into seconds of timer churn on Android.
    if (txs.length < 2) continue;

    // Unknown ordinary merchants need two intervals (three charges). With only
    // two observations the only groups that can possibly qualify are known
    // subscription providers, bill-like categories, whose existing rule uses
    // a single interval, and yearly software renewals. This is a conservative
    // prefilter: checking ANY row for a category cannot drop a group whose
    // latest row would qualify.
    if (txs.length === 2) {
      const knownTwoChargeProvider = isKnownServiceTitle(txs[0].title);
      // Bill-like or software: the software case is a yearly renewal.
      const billLikeTwoChargeGroup = txs.some((transaction) =>
        isBillLikeCategory(transaction.category) || SUBSCRIPTION_CATEGORIES.has(transaction.category));
      if (!knownTwoChargeProvider && !billLikeTwoChargeGroup) continue;
    }

    yield;
    if (newestFirst) txs.reverse();
    else txs.sort(byDate);

    // Several concurrent plans on one descriptor are analysed one plan at a
    // time. Only where there is subscription evidence (a named service or a
    // software category) and never for bills, whose amounts vary by nature.
    const latest = txs[txs.length - 1];
    const tracks =
      (isKnownServiceTitle(latest.title) || SUBSCRIPTION_CATEGORIES.has(latest.category)) &&
      !isBillLikeCategory(latest.category) &&
      !txs.every((transaction) => transaction.paymentFlowSide === 'receipt')
        ? concurrentPriceTracks(txs)
        : null;
    if (!tracks) {
      const sub = yield* analyzeRecurringCharges(txs, todayISO);
      if (sub) subs.push(sub);
      continue;
    }
    for (const track of tracks) {
      const sub = yield* analyzeRecurringCharges(track.charges, todayISO, track.prices);
      // A plan the user dismissed on its own key stays dismissed.
      if (sub && !isSubscriptionDismissed(sub, dismissed)) subs.push(sub);
    }
  }

  subs.sort((a, b) => b.monthlyEquivalentFils - a.monthlyEquivalentFils);
  return subs;
}

export function detectSubscriptions(
  transactions: Transaction[],
  notSubscriptions: string[] = [],
  today: Date = new Date(),
  liveAccounts?: Set<string>,
  internalTransfers?: Set<string>,
): Subscription[] {
  const todayKey = toISODate(today);
  const cached = cachedSubscriptionDetection(
    transactions,
    notSubscriptions,
    todayKey,
    liveAccounts,
    internalTransfers,
  );
  if (cached) return cached;

  const worker = subscriptionDetectionWorker(
    transactions,
    notSubscriptions,
    today,
    liveAccounts,
    internalTransfers,
  );
  let step = worker.next();
  while (!step.done) step = worker.next();
  return cacheSubscriptionDetection(
    transactions,
    notSubscriptions,
    todayKey,
    liveAccounts,
    internalTransfers,
    step.value,
  );
}

// A slice is measured on the device's own clock, so these are phone
// milliseconds. The previous 2 ms slice + 16 ms timer spent ~90% of the job's
// wall time asleep: a 15k-row ledger needs ~110 ms of Hermes CPU, which became
// ~55 slices and 1-7 s of wall time on a busy phone, long enough for the next
// capture to replace the ledger before Bills ever received an answer. Six
// milliseconds still leaves most of a 120 Hz frame to input and rendering, and
// the short yield returns the thread to them on every slice.
const SUBSCRIPTION_DETECTION_SLICE_MS = 6;
const SUBSCRIPTION_DETECTION_YIELD_MS = 8;

/**
 * Same answer as detectSubscriptions(), but never intentionally monopolises a
 * foreground JS turn. Returning null means the caller invalidated this exact
 * ledger snapshot while it was being analysed.
 */
export function detectSubscriptionsCooperatively(
  transactions: Transaction[],
  notSubscriptions: string[] = [],
  today: Date = new Date(),
  liveAccounts?: Set<string>,
  internalTransfers?: Set<string>,
  cancelled: () => boolean = () => false,
): Promise<Subscription[] | null> {
  const todayKey = toISODate(today);
  const cached = cachedSubscriptionDetection(
    transactions,
    notSubscriptions,
    todayKey,
    liveAccounts,
    internalTransfers,
  );
  if (cached) return Promise.resolve(cancelled() ? null : cached);

  const existing = subscriptionDetectionInFlight.find((entry) =>
    sameDetectionKey(entry, transactions, notSubscriptions, todayKey, liveAccounts, internalTransfers));
  if (existing) {
    existing.waiters.push(cancelled);
    return existing.promise.then((value) => value === null || cancelled() ? null : value);
  }

  // A projection for an older snapshot that nobody is waiting for any more is
  // pure waste: every capture used to leave one running beside the new one, so
  // Bills and reminders ended up time-slicing several full-ledger scans of
  // ledgers that no longer existed. A job keeps running while ANY caller still
  // wants it (a tab merely losing focus on an unchanged ledger still joins it
  // on return); it stops only once a newer snapshot exists and every one of
  // its callers has cancelled.
  for (const entry of subscriptionDetectionInFlight) entry.superseded = true;

  const worker = subscriptionDetectionWorker(
    transactions,
    notSubscriptions,
    today,
    liveAccounts,
    internalTransfers,
  );
  const waiters: (() => boolean)[] = [cancelled];
  const flight: SubscriptionDetectionInFlight = {
    transactions,
    notSubscriptions,
    todayKey,
    liveAccounts,
    internalTransfers,
    // Assigned below, before any caller can observe the entry.
    promise: null as unknown as Promise<Subscription[] | null>,
    waiters,
    superseded: false,
  };

  // One shared projection per immutable ledger snapshot. A tab losing focus no
  // longer aborts the underlying worker and makes the next visit start from row
  // zero; callers simply ignore the eventual value when their own view is gone.
  const promise = new Promise<Subscription[] | null>((resolve) => {
    const runSlice = () => {
      if (flight.superseded && waiters.every((waiter) => waiter())) {
        resolve(null);
        return;
      }
      const startedAt = Date.now();
      let step = worker.next();
      while (!step.done && Date.now() - startedAt < SUBSCRIPTION_DETECTION_SLICE_MS) {
        step = worker.next();
      }
      if (step.done) {
        resolve(cacheSubscriptionDetection(
          transactions,
          notSubscriptions,
          todayKey,
          liveAccounts,
          internalTransfers,
          step.value,
        ));
        return;
      }
      void waitForForegroundHistoryIdle(SUBSCRIPTION_DETECTION_YIELD_MS).then(runSlice);
    };
    runSlice();
  }).finally(() => {
    subscriptionDetectionInFlight = subscriptionDetectionInFlight.filter((entry) => entry.promise !== promise);
  });
  flight.promise = promise;

  subscriptionDetectionInFlight.push(flight);
  return promise.then((value) => value === null || cancelled() ? null : value);
}

/** Monthly-equivalent total of what is still charging (stopped ones cost nothing). */
export function subscriptionsMonthlyTotal(subs: Subscription[]): number {
  return subs.reduce((s, sub) => (sub.status === 'active' ? s + sub.monthlyEquivalentFils : s), 0);
}

/** Only the cancellable online/lifestyle subscriptions. */
export function trueSubscriptions(subs: Subscription[]): Subscription[] {
  return subs.filter((s) => s.group === 'subscription');
}

/** Still-charging subscriptions. */
export function activeSubscriptions(subs: Subscription[]): Subscription[] {
  return subs.filter((s) => s.status === 'active');
}

/**
 * Likely-cancelled subscriptions (no charge for well past their cadence).
 * Restricted to KNOWN services: a shop you simply stopped visiting is not a
 * cancelled subscription, and listing it as one reads as a bug.
 */
export function stoppedSubscriptions(subs: Subscription[]): Subscription[] {
  return subs.filter((s) => s.status === 'stopped' && isKnownServiceTitle(s.title));
}

/** Rent + utilities/telecom recurring commitments. */
export function fixedCommitments(subs: Subscription[]): Subscription[] {
  return subs.filter((s) => s.group !== 'subscription');
}

/**
 * The bills proper: rent, utilities, telecom, loans. What a "fixed bills"
 * heading promises.
 */
export function billCommitments(subs: Subscription[]): Subscription[] {
  return subs.filter(
    (s) => s.group === 'utility' || s.group === 'housing' || s.category === 'loan',
  );
}

/**
 * Everything else that recurs: a supplier, a school, a shop visited on a
 * cycle, a standing transfer to a person. Real, worth listing, and not a
 * utility — filing a grocer under "Utilities & fixed bills" reads as a bug
 * even when the recurrence is genuine.
 */
export function otherCommitments(subs: Subscription[]): Subscription[] {
  return subs.filter((s) => s.group === 'commitment' && s.category !== 'loan');
}

/** Days until the next expected charge; negative if the date passed. */
export function daysUntilNext(sub: Subscription, today: Date): number {
  return daysBetween(toISODate(today), sub.nextExpectedISO);
}

/**
 * Whether the user has said this subscription is cancelled, and no charge
 * since has contradicted them.
 *
 * `cancelled` maps a service key (or legacy provider key) to the date the user said so. A
 * charge dated AFTER that day is the bank saying it is still being paid, so
 * the subscription counts again rather than hiding money that is still going
 * out. A charge on the same day is the one the user just cancelled after.
 */
export function isCancelledByUser(
  sub: Pick<Subscription, 'title' | 'billIdentity' | 'lastChargedISO'>,
  cancelled: Readonly<Record<string, string | null>> | undefined,
): boolean {
  const on = subscriptionCancellationDate(sub, cancelled);
  return on !== null && sub.lastChargedISO <= on;
}

/** An explicit scoped undo (null) takes precedence over an older provider cancellation. */
export function subscriptionCancellationDate(
  sub: RecurringIdentity,
  cancelled: Readonly<Record<string, string | null>> | undefined,
): string | null {
  if (!cancelled) return null;
  // Most specific first: one plan, then its service, then the provider.
  for (const key of [subscriptionKey(sub), serviceKey(sub), subscriptionKey({ title: sub.title })]) {
    if (!Object.prototype.hasOwnProperty.call(cancelled, key)) continue;
    const on = cancelled[key];
    return typeof on === 'string' ? on : null;
  }
  return null;
}

/** Subscriptions still in play: the user has not marked them cancelled. */
export function withoutCancelled<T extends Pick<Subscription, 'title' | 'billIdentity' | 'lastChargedISO'>>(
  subs: T[],
  cancelled: Readonly<Record<string, string | null>> | undefined,
): T[] {
  if (!cancelled || Object.keys(cancelled).length === 0) return subs;
  return subs.filter((sub) => !isCancelledByUser(sub, cancelled));
}

/** The ones the user marked cancelled, for the reversible "Cancelled by you" list. */
export function cancelledByUser<T extends Pick<Subscription, 'title' | 'billIdentity' | 'lastChargedISO'>>(
  subs: T[],
  cancelled: Readonly<Record<string, string | null>> | undefined,
): T[] {
  if (!cancelled || Object.keys(cancelled).length === 0) return [];
  return subs.filter((sub) => isCancelledByUser(sub, cancelled));
}

/**
 * Monthly-equivalent total of the true subscriptions still charging: active,
 * not marked cancelled. The figure behind "Subscriptions · X / month".
 */
export function subscriptionsMonthlyEquivalent(
  subs: Subscription[],
  cancelled?: Readonly<Record<string, string | null>>,
): number {
  return subscriptionsMonthlyTotal(withoutCancelled(activeSubscriptions(trueSubscriptions(subs)), cancelled));
}
