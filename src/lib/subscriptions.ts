import { daysBetweenISO, shiftISO, toISODate } from '@/lib/format';
import { waitForForegroundHistoryIdle } from '@/lib/foreground-history-priority';
import { isSpending } from '@/lib/ledger';
import type { Account, CategoryId, Transaction } from '@/lib/types';

export type Cadence = 'weekly' | 'monthly' | 'yearly' | 'as-needed';

/**
 * subscription — cancellable online/lifestyle services (streaming, apps, gym);
 * utility — recurring DEWA/telecom-style bills; housing — rent;
 * commitment — anything else that recurs (suppliers, fees, transfers to people).
 * Kept separate so "subscriptions total" only counts what you could cancel.
 */
export type RecurringGroup = 'subscription' | 'utility' | 'housing' | 'commitment';

export interface Subscription {
  title: string;
  category: CategoryId;
  group: RecurringGroup;
  /** stopped = silent for well past its cadence (likely cancelled). */
  status: 'active' | 'stopped';
  cadence: Cadence;
  avgAmountFils: number;
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
  /** Monthly-equivalent cost for totals (yearly/12, weekly*4.33). */
  monthlyEquivalentFils: number;
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
}

const WINDOWS: CadenceWindow[] = [
  { cadence: 'weekly', minDays: 6, maxDays: 8, typicalDays: 7 },
  { cadence: 'monthly', minDays: 26, maxDays: 35, typicalDays: 30 },
  { cadence: 'yearly', minDays: 350, maxDays: 380, typicalDays: 365 },
];

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
  for (let month = lastMonth; ; month -= 1) {
    const rows = byMonth.get(month);
    if (!rows || rows.length !== 1) break;
    descending.push(rows[0]);
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
  /netflix|spotify|anghami|osn|shahid|starz|youtube|yt premium|apple\.com|apple services|icloud|google one|google storage|amazon prime|prime video|openai|chat\s*gpt|claude|anthropic|real-?debrid|all-?debrid|disney|hbo|deezer|audible|kindle|linkedin|dropbox|adobe|canva|microsoft 365|office 365|discord|notion|github|telegram premium|xbox game pass|playstation plus|psn plus|fitness first|gymnation|fitness time|classpass|etisalat postpaid|du postpaid|home internet/i;

// Both of these used to be local copies. Date arithmetic re-implemented per
// module is how the app ended up with two different answers for "when is this
// due", so there is now one of each, in format.ts. Kept as local aliases so the
// call sites below still read as prose; they are not second implementations.
const daysBetween = daysBetweenISO;
const addDays = shiftISO;

/** Calendar renewals preserve their billing day instead of drifting by 30/365 days. */
function nextRenewalISO(charges: Transaction[], window: CadenceWindow): string {
  const last = charges[charges.length - 1].date;
  if (window.cadence !== 'monthly' && window.cadence !== 'yearly') {
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
  const target = new Date(Date.UTC(
    year + (window.cadence === 'yearly' ? 1 : 0),
    month - 1 + (window.cadence === 'monthly' ? 1 : 0),
    1,
  ));
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
function recurringProviderTitle(transaction: Transaction): string {
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

type SubscriptionDetectionKey = {
  transactions: Transaction[];
  notSubscriptions: string[];
  todayKey: string;
  liveAccounts?: Set<string>;
  internalTransfers?: Set<string>;
};

type SubscriptionDetectionCacheEntry = SubscriptionDetectionKey & { value: Subscription[] };
type SubscriptionDetectionInFlight = SubscriptionDetectionKey & { promise: Promise<Subscription[]> };

// A single-entry cache let an unrelated caller evict Bills' projection, so
// switching tabs could restart a 15k-row scan even though the ledger had not
// changed. Keep a tiny identity-keyed LRU instead. Store snapshots are immutable,
// so these references are an exact semantic key and need no O(n) fingerprint.
const SUBSCRIPTION_CACHE_MAX = 4;
let subscriptionDetectionCache: SubscriptionDetectionCacheEntry[] = [];
let subscriptionDetectionInFlight: SubscriptionDetectionInFlight[] = [];

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
    entry.liveAccounts === liveAccounts &&
    entry.internalTransfers === internalTransfers;
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
  const groups = new Map<string, Transaction[]>();
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
    if (!isSpending(t, liveAccounts, internalTransfers)) continue;
    const providerTitle = recurringProviderTitle(t);
    const k = providerTitle.toLowerCase();
    if (!k || dismissed.has(k)) continue;
    // A fee alert proves a posted fee, not a future commitment. Even an annual
    // fee needs stable card/account identity carried through the Subscription
    // model before it can safely become a recurring bill. Until then every
    // parser-minted fee stays out of automatic recurrence detection.
    if (/fee$/.test(k) || k === 'service charge') continue;
    const list = groups.get(k) ?? [];
    list.push(providerTitle === t.title ? t : { ...t, title: providerTitle });
    groups.set(k, list);
  }

  const subs: Subscription[] = [];
  for (const txs of groups.values()) {
    // A single observation can never satisfy the recurrence rules below, even
    // for a known subscription provider. Skip it before yielding into the
    // expensive per-merchant cadence path. Large imported ledgers contain
    // thousands of one-off merchants; yielding once for every impossible group
    // turns a bounded scan into seconds of timer churn on Android.
    if (txs.length < 2) continue;

    // Unknown ordinary merchants need two intervals (three charges). With only
    // two observations the only groups that can possibly qualify are known
    // subscription providers or bill-like categories, whose existing rule uses
    // a single interval. This is a conservative prefilter: checking ANY row for
    // a bill-like category cannot drop a group whose latest row would qualify.
    if (txs.length === 2) {
      const knownTwoChargeProvider = KNOWN_SUBSCRIPTION_MERCHANTS.test(txs[0].title);
      const billLikeTwoChargeGroup = txs.some((transaction) =>
        transaction.category === 'utilities' ||
        transaction.category === 'telecom' ||
        transaction.category === 'rent' ||
        transaction.category === 'loan');
      if (!knownTwoChargeProvider && !billLikeTwoChargeGroup) continue;
    }

    yield;
    if (newestFirst) txs.reverse();
    else txs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const title = txs[txs.length - 1].title;
    const known = KNOWN_SUBSCRIPTION_MERCHANTS.test(title);
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

    // A utility bill is recurring precisely BECAUSE it is a bill, and its
    // amount is never stable — SEWA is 280 one month and 450 the next. The
    // ±15% gate below is the right test for a subscription and the wrong one
    // for a bill, and applying it to both left the Utilities tab empty for a
    // user who pays four of them every month. For these, cadence alone is the
    // evidence.
    const billLike =
      cadenceCharges[cadenceCharges.length - 1].category === 'utilities' ||
      cadenceCharges[cadenceCharges.length - 1].category === 'telecom' ||
      cadenceCharges[cadenceCharges.length - 1].category === 'rent' ||
      cadenceCharges[cadenceCharges.length - 1].category === 'loan';

    const amounts = cadenceCharges.map((c) => c.amountFils);
    const mid = median(amounts);
    if (mid <= 0) continue;
    const stable = amounts.every((a) => a >= mid * 0.85 && a <= mid * 1.15);
    // A bill varies, but it varies like a bill. Waiving the ±15% gate for
    // anything the parser called a utility waived it entirely, so a merchant
    // that happened to be charged twice a month apart became a standing
    // monthly commitment at whatever the larger charge was — one shop was
    // listed at AED 20,918/mo on two unrelated payments.
    //
    // Same band the outlier guard below already uses: a third to triple the
    // median. SEWA at 280 one month and 450 the next passes; two payments that
    // have nothing to do with each other do not.
    const billShaped = amounts.every((a) => a >= mid / 3 && a <= mid * 3);
    if (
      !stable &&
      !known &&
      !(billLike && billShaped) &&
      !((monthlyReceiptRun.length > 0 || asNeededReceiptRun.length > 0) && billShaped)
    ) continue;

    // Known merchants skip the stability gate, which let a single misparsed
    // charge set the price: one bad row put Canva on the list at AED 18,313 a
    // month. The typical charge is what the subscription costs, so anything
    // more than 3x or less than a third of the median is an outlier and takes
    // no part in the average or the price-rise comparison.
    const typical = amounts.filter((a) => a >= mid / 3 && a <= mid * 3);
    if (typical.length === 0) continue;

    const gaps: number[] = [];
    for (let i = 1; i < cadenceCharges.length; i++) {
      if ((i & 127) === 0) yield;
      gaps.push(daysBetween(cadenceCharges[i - 1].date, cadenceCharges[i].date));
    }

    let window: CadenceWindow | null = null;
    if (monthlyReceiptRun.length > 0) {
      window = WINDOWS.find((candidate) => candidate.cadence === 'monthly') ?? null;
    } else if (asNeededReceiptRun.length > 0) {
      window = {
        cadence: 'as-needed',
        minDays: 0,
        maxDays: Number.POSITIVE_INFINITY,
        typicalDays: median(gaps.filter((gap) => gap > 0)),
      };
    } else if (gaps.length > 0) {
      for (const w of WINDOWS) {
        const inWindow = gaps.filter((g) => g >= w.minDays && g <= w.maxDays).length;
        if (inWindow >= Math.max(1, Math.ceil(gaps.length * 0.6))) {
          window = w;
          break;
        }
      }
    }

    // One charge is not evidence of recurrence, however well-known the
    // merchant is. Treating it as one invented subscriptions from a single
    // Prime Video rental or a one-off app-store purchase, and an imaginary
    // monthly commitment is worse than a real one surfacing a cycle late.
    // Known merchants still get the easier bar: one interval rather than two.
    const requiredIntervals = known || billLike ? 1 : 2;
    if (!window || gaps.length < requiredIntervals) continue;

    const last = cadenceCharges[cadenceCharges.length - 1];
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
    const priorAmounts = previousPriceRun(amounts);
    const priorTypical = priorAmounts.length ? median(priorAmounts) : last.amountFils;
    // What it costs NOW, not what it averaged over its life. A lifetime average
    // reports a price the user no longer pays: Google One went from AED 7.99
    // to AED 76.99 on a tier upgrade and the app kept showing 7, because the
    // outlier guard below treats a genuine new price the same as a misparse.
    //
    // The median of the last three charges tracks an upgrade immediately —
    // once two of the three are the new amount — while still absorbing a
    // single bad parse, which is all the outlier guard was ever needed for.
    const recent = amounts.slice(-3);
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
          : Math.round(avg / 12);

    const group: RecurringGroup =
      last.category === 'rent'
        ? 'housing'
        : last.category === 'utilities' || last.category === 'telecom'
          ? 'utility'
          : known || SUBSCRIPTION_CATEGORIES.has(last.category)
            ? 'subscription'
            : 'commitment';

    // Silence for ~2 cycles past the last charge means it was cancelled.
    const silentDays = daysBetween(last.date, toISODate(today));
    const status: Subscription['status'] =
      silentDays > (window.cadence === 'as-needed' ? 75 : window.typicalDays * 2.2 + 5)
        ? 'stopped'
        : 'active';

    subs.push({
      title,
      category: last.category,
      group,
      status,
      cadence: window.cadence,
      avgAmountFils: avg,
      lastAmountFils: last.amountFils,
      lastChargedISO: last.date,
      nextExpectedISO: nextRenewalISO(cadenceCharges, window),
      chargeCount: cadenceCharges.length,
      paymentHistory: registeredReceipt,
      priceIncreased:
        window.cadence !== 'as-needed' &&
        priorAmounts.length >= 2 &&
        last.amountFils > priorTypical * 1.1,
      priorTypicalFils: priorTypical,
      monthlyEquivalentFils,
    });
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

// 120 Hz leaves ~8.3 ms for the entire frame. Keep recurrence maintenance to
// roughly a quarter of that budget so rendering/input still have headroom on
// large ledgers while the cooperative worker is active.
const SUBSCRIPTION_DETECTION_SLICE_MS = 2;
const SUBSCRIPTION_DETECTION_YIELD_MS = 16;

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
  if (existing) return existing.promise.then((value) => cancelled() ? null : value);

  const worker = subscriptionDetectionWorker(
    transactions,
    notSubscriptions,
    today,
    liveAccounts,
    internalTransfers,
  );

  // One shared projection per immutable ledger snapshot. A tab losing focus no
  // longer aborts the underlying worker and makes the next visit start from row
  // zero; callers simply ignore the eventual value when their own view is gone.
  const promise = new Promise<Subscription[]>((resolve) => {
    const runSlice = () => {
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

  subscriptionDetectionInFlight.push({
    transactions,
    notSubscriptions,
    todayKey,
    liveAccounts,
    internalTransfers,
    promise,
  });
  return promise.then((value) => cancelled() ? null : value);
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
  return subs.filter((s) => s.status === 'stopped' && KNOWN_SUBSCRIPTION_MERCHANTS.test(s.title));
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
 * `cancelled` maps a lowercased merchant to the ISO date the user said so. A
 * charge dated AFTER that day is the bank saying it is still being paid, so
 * the subscription counts again rather than hiding money that is still going
 * out. A charge on the same day is the one the user just cancelled after.
 */
export function isCancelledByUser(
  sub: Pick<Subscription, 'title' | 'lastChargedISO'>,
  cancelled: Readonly<Record<string, string>> | undefined,
): boolean {
  if (!cancelled) return false;
  const key = sub.title.trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(cancelled, key)) return false;
  const on = cancelled[key];
  return typeof on === 'string' && sub.lastChargedISO <= on;
}

/** Subscriptions still in play: the user has not marked them cancelled. */
export function withoutCancelled<T extends Pick<Subscription, 'title' | 'lastChargedISO'>>(
  subs: T[],
  cancelled: Readonly<Record<string, string>> | undefined,
): T[] {
  if (!cancelled || Object.keys(cancelled).length === 0) return subs;
  return subs.filter((sub) => !isCancelledByUser(sub, cancelled));
}

/** The ones the user marked cancelled, for the reversible "Cancelled by you" list. */
export function cancelledByUser<T extends Pick<Subscription, 'title' | 'lastChargedISO'>>(
  subs: T[],
  cancelled: Readonly<Record<string, string>> | undefined,
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
  cancelled?: Readonly<Record<string, string>>,
): number {
  return subscriptionsMonthlyTotal(withoutCancelled(activeSubscriptions(trueSubscriptions(subs)), cancelled));
}
