import { daysBetweenISO, shiftISO, toISODate } from '@/lib/format';
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

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Categories where a recurring charge can plausibly BE a subscription service.
 * A recurring supplier invoice or school fee is a commitment, not a Netflix.
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
  'entertainment',
  'software',
  'shopping',
  'health',
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

export function detectSubscriptions(
  transactions: Transaction[],
  notSubscriptions: string[] = [],
  today: Date = new Date(),
  liveAccounts?: Set<string>,
  internalTransfers?: Set<string>,
): Subscription[] {
  const dismissed = new Set(notSubscriptions.map((s) => s.trim().toLowerCase()));
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
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
    txs.sort((a, b) => (a.date < b.date ? -1 : 1));
    const title = txs[txs.length - 1].title;
    const known = KNOWN_SUBSCRIPTION_MERCHANTS.test(title);
    // This evidence belongs to every source observation, not to the collapsed
    // row below. A receipt and an ordinary purchase on the same day are mixed
    // evidence; whichever happens to sort first must not decide for both.
    const registeredReceipt =
      txs.length > 0 && txs.every((transaction) => transaction.paymentFlowSide === 'receipt');

    // Collapse same-day duplicates (split payments) into one charge.
    const charges: Transaction[] = [];
    for (const t of txs) {
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
      nextExpectedISO: addDays(last.date, window.typicalDays),
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
