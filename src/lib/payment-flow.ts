import type { Transaction } from '@/lib/types';
import { UNASSIGNED_INCOME_ACCOUNT_ID, UNASSIGNED_TRANSACTION_ACCOUNT_ID } from '@/lib/ledger';

/**
 * Maximum delay between an internal funding alert and the named bill-pay
 * confirmation it enabled. The owner's retained UAE corpus has three proven
 * pairs at 66–115 seconds; five minutes covers delivery skew without turning
 * ordinary same-amount transfers later in the day into one event.
 */
const PAYMENT_FLOW_WINDOW_MS = 5 * 60_000;
const COMPOUND_BILL_WINDOW_MS = 3 * 24 * 60 * 60_000;
/**
 * How far apart a biller's own receipt and the bank's LIVE alert for the same
 * payment may be, by their clocks. The card alert and the e& receipt normally
 * land within a minute; a day covers a delayed delivery without reaching the
 * neighbouring month's equal bill.
 */
const LIVE_RECEIPT_WINDOW_MS = 24 * 60 * 60_000;
/**
 * How many days after the receipt's own day a PDF/CSV statement row may be
 * posted. A statement states only a posting date, which trails the payment by
 * up to a weekend and never precedes it.
 */
const STATEMENT_POSTING_LAG_DAYS = 3;
const DAY_MS = 24 * 60 * 60_000;

interface MatchScore {
  count: number;
  distance: number;
  pairs: [number, number][];
}

const eventTime = (row: Transaction): number | null => {
  if (Number.isFinite(row.ts)) return row.ts!;
  const match = row.smsKey?.match(/^s(\d+)-/);
  return match ? Number(match[1]) : null;
};

const providerKey = (title: string): string => {
  const key = title.normalize('NFKC').toLowerCase().replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (/^(?:e and(?: uae)?|etisalat|e digital app)$/.test(key)) return 'etisalat';
  return key;
};

/**
 * Preserve the greatest number of chronological pairs, then choose the
 * smallest total delivery skew. A nearest-row greedy choice can strand a
 * later valid pair when two equal utility payments are made close together.
 */
const preferredPairs = (
  funding: Transaction[],
  receipts: Transaction[],
): [number, number][] => {
  const memo = new Map<string, MatchScore>();
  const solve = (fundingIndex: number, receiptIndex: number): MatchScore => {
    if (fundingIndex >= funding.length || receiptIndex >= receipts.length) {
      return { count: 0, distance: 0, pairs: [] };
    }
    const key = `${fundingIndex}:${receiptIndex}`;
    const cached = memo.get(key);
    if (cached) return cached;

    const fundingTime = eventTime(funding[fundingIndex]);
    const receiptTime = eventTime(receipts[receiptIndex]);
    const distance = fundingTime === null || receiptTime === null || fundingTime > receiptTime
      ? Number.POSITIVE_INFINITY
      : receiptTime - fundingTime;
    let best: MatchScore | null = null;
    if (distance <= PAYMENT_FLOW_WINDOW_MS) {
      const tail = solve(fundingIndex + 1, receiptIndex + 1);
      best = {
        count: tail.count + 1,
        distance: tail.distance + distance,
        pairs: [[fundingIndex, receiptIndex], ...tail.pairs],
      };
    }
    const consider = (candidate: MatchScore) => {
      if (
        best === null ||
        candidate.count > best.count ||
        (candidate.count === best.count && candidate.distance < best.distance)
      ) best = candidate;
    };
    consider(solve(fundingIndex + 1, receiptIndex));
    consider(solve(fundingIndex, receiptIndex + 1));
    const resolved = best ?? { count: 0, distance: 0, pairs: [] };
    memo.set(key, resolved);
    return resolved;
  };
  return solve(0, 0).pairs;
};

/**
 * Collapse one economic bill payment that generated two bank alerts.
 *
 * The generic funding row is an internal account movement. The named receipt
 * is the useful ledger event: it carries the biller, category rule and the
 * account the user can correct once. Removing only the unedited funding row
 * prevents both Spent and Cash out from counting the same payment twice while
 * retaining a user correction verbatim.
 */
export const reconcilePaymentFlows = (transactions: Transaction[]): Transaction[] => {
  const buckets = new Map<number, { funding: Transaction[]; receipts: Transaction[] }>();
  for (const row of transactions) {
    if (row.source !== 'sms' || row.type !== 'expense') continue;
    const bucket = buckets.get(row.amountFils) ?? { funding: [], receipts: [] };
    const inferredFunding =
      row.paymentFlowSide === undefined &&
      row.isTransfer === true &&
      /^(?:Outgoing|Bank) transfer$/i.test(row.title);
    if (row.paymentFlowSide === 'funding' || inferredFunding) {
      if (!row.userEdited && !row.transferDecision && row.isTransfer === true) bucket.funding.push(row);
    } else if (row.paymentFlowSide === 'receipt') {
      if (row.isTransfer !== true) bucket.receipts.push(row);
    } else {
      continue;
    }
    buckets.set(row.amountFils, bucket);
  }

  const removed = new Set<string>();
  /** Receipts whose funding leg was just folded: already one economic event. */
  const fundedReceipts = new Set<string>();
  const bundleParents = new Set<string>();
  for (const bucket of buckets.values()) {
    const funding = bucket.funding.sort((a, b) => (eventTime(a) ?? 0) - (eventTime(b) ?? 0));
    const receipts = bucket.receipts.sort((a, b) => (eventTime(a) ?? 0) - (eventTime(b) ?? 0));
    for (const [fundingIndex, receiptIndex] of preferredPairs(funding, receipts)) {
      removed.add(funding[fundingIndex].id);
      fundedReceipts.add(receipts[receiptIndex].id);
    }
  }

  // A biller can confirm each service separately after one combined checkout.
  // e& is a concrete example: two line receipts (e.g. mobile + home internet)
  // can add exactly to one card debit. Those are allocations of one economic
  // event, not three expenses. Only fold when we have 2+ explicit biller
  // receipts, their exact integer-fils sum equals an independently captured
  // ordinary expense, all rows share the same category, and every event is
  // close in time. This deliberately refuses amount-only guessing.
  const ordinary = transactions.filter(row =>
    row.source === 'sms' && row.type === 'expense' &&
    row.paymentFlowSide === undefined && row.isTransfer !== true &&
    !row.userEdited && !row.transferDecision && eventTime(row) !== null);
  const receiptRows = transactions.filter(row =>
    row.source === 'sms' && row.type === 'expense' &&
    row.paymentFlowSide === 'receipt' && row.isTransfer !== true &&
    !row.userEdited && !row.transferDecision && eventTime(row) !== null);

  // Index the receipts by (category, provider) once. Filtering every receipt
  // for every ordinary purchase normalised the same few hundred titles
  // millions of times — about a third of a live capture's JS time on a 15k-row
  // ledger. The groups keep receiptRows order, so each parent sees exactly the
  // candidates, in exactly the order, the full filter produced.
  const providerKeys = new Map<string, string>();
  const providerKeyOf = (title: string): string => {
    let key = providerKeys.get(title);
    if (key === undefined) {
      key = providerKey(title);
      providerKeys.set(title, key);
    }
    return key;
  };
  const receiptsByCategory = new Map<Transaction['category'], Map<string, Transaction[]>>();
  for (const row of receiptRows) {
    let byProvider = receiptsByCategory.get(row.category);
    if (!byProvider) {
      byProvider = new Map();
      receiptsByCategory.set(row.category, byProvider);
    }
    const key = providerKeyOf(row.title);
    const group = byProvider.get(key);
    if (group) group.push(row);
    else byProvider.set(key, [row]);
  }

  for (const parent of ordinary) {
    const byProvider = receiptsByCategory.get(parent.category);
    const sameProvider = byProvider?.get(providerKeyOf(parent.title));
    if (!sameProvider) continue;
    const parentTime = eventTime(parent)!;
    const candidates = sameProvider.filter(row =>
      !removed.has(row.id) &&
      Math.abs(eventTime(row)! - parentTime) <= COMPOUND_BILL_WINDOW_MS &&
      row.amountFils > 0 && row.amountFils < parent.amountFils);
    // Bill bundles are intentionally bounded. Exhaustive subset search over a
    // large history would be both slow and dangerously eager.
    if (candidates.length < 2 || candidates.length > 8) continue;
    let match: Transaction[] | null = null;
    const limit = 1 << candidates.length;
    for (let mask = 1; mask < limit && !match; mask++) {
      if ((mask & (mask - 1)) === 0) continue; // require at least two receipts
      let sum = 0;
      const rows: Transaction[] = [];
      for (let i = 0; i < candidates.length; i++) {
        if ((mask & (1 << i)) === 0) continue;
        sum += candidates[i].amountFils;
        if (sum > parent.amountFils) break;
        rows.push(candidates[i]);
      }
      if (rows.length >= 2 && sum === parent.amountFils) match = rows;
    }
    if (match) {
      for (const child of match) removed.add(child.id);
      bundleParents.add(parent.id);
    }
  }

  const merged = pairBillerReceipts(transactions, removed, fundedReceipts, bundleParents, providerKeyOf);
  if (removed.size === 0 && merged.size === 0) return transactions;
  const out: Transaction[] = [];
  for (const row of transactions) {
    if (removed.has(row.id)) continue;
    out.push(merged.get(row.id) ?? row);
  }
  return out;
};

const isStatementRow = (row: Transaction): boolean =>
  row.captureSource === 'pdf' || row.captureSource === 'csv';

const dayNumber = (iso: string): number | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS : null;
};

/** Same ledger amount AND the same stated original money, to the minor unit. */
const sameMoney = (a: Transaction, b: Transaction): boolean => {
  if (a.amountFils !== b.amountFils) return false;
  if ((a.originalCurrency ?? '') !== (b.originalCurrency ?? '')) return false;
  if (a.originalCurrency === undefined) return true;
  return a.originalMinorUnits !== undefined && b.originalMinorUnits !== undefined
    ? a.originalMinorUnits === b.originalMinorUnits && a.originalExponent === b.originalExponent
    : a.originalAmountMinor === b.originalAmountMinor;
};

const billTail = (identity: string): string | null =>
  identity.match(/^(?:account|consumer|party|customer|contract|service):([A-Z0-9]{4})$/i)?.[1].toUpperCase() ?? null;

/**
 * Every bill-account tail a row states: its bill identity's, and a
 * settlement's biller-account tail (Transaction.billerAccountTail). The
 * latter is read HERE ONLY — it is a fold guard, never a bill identity, so
 * bills.ts can keep matching that settlement to a reminder keyed on another
 * number (e&'s Party-ID).
 */
const statedBillTails = (row: Transaction): string[] => {
  const tails: string[] = [];
  const identityTail = row.billIdentity ? billTail(row.billIdentity) : null;
  if (identityTail !== null) tails.push(identityTail);
  if (typeof row.billerAccountTail === 'string' && /^\d{4}$/.test(row.billerAccountTail)) {
    tails.push(row.billerAccountTail);
  }
  return tails;
};

/**
 * Two stated bill accounts that differ are two bills, whatever the amount.
 *
 * "Your payment of AED 350.00 from your Credit Card ending 2518 has been
 * received towards your Etisalat account 9876" carries no bill identity (see
 * the parser's settlement site), only billerAccountTail 9876. Without reading
 * it here, e&'s AED 350.00 receipt for account 2543 the same day folded into
 * that settlement and was deleted: a second e& line's payment gone.
 */
const conflictingBillIdentity = (a: Transaction, b: Transaction): boolean => {
  const ta = statedBillTails(a);
  const tb = statedBillTails(b);
  if (ta.length > 0 && tb.length > 0 && ta.some(x => tb.some(y => x !== y))) return true;
  // Identities with no recognisable tail compare whole, as they always did.
  if (!a.billIdentity || !b.billIdentity) return false;
  if (billTail(a.billIdentity) !== null && billTail(b.billIdentity) !== null) return false;
  return a.billIdentity.toLowerCase() !== b.billIdentity.toLowerCase();
};

/**
 * Anything a person decided about the row. A pinned RECEIPT is never removed
 * here; a pinned BANK row may be the kept side, but nothing is merged into it.
 * `paymentInstrumentSource: 'user'` is the person choosing the receipt's
 * account, which is a decision about that row like any other edit.
 */
const pinned = (row: Transaction): boolean =>
  row.userEdited === true || row.titleEdited === true || row.transferDecision !== undefined ||
  row.billPayment !== undefined || (row.splits?.length ?? 0) > 0 || row.paymentInstrumentSource === 'user';

/**
 * The instrument the import stored is the BILLER's own account number.
 *
 * e&'s portal receipt ("Your payment to the account number ····2543 has been
 * processed … Payment Channel: Etisalat Mobile App") names no paying card;
 * its only number is the e& account. The importer can still record that
 * number as an `account`-kind instrument with no issuer, and route the row to
 * an account resolved from it. That instrument says nothing about who paid,
 * so it is recognised here for exactly that shape: kind `account`, no bank,
 * and the same four digits as the receipt's own bill identity.
 */
const instrumentIsBillerAccount = (row: Transaction): boolean => {
  const instrument = row.captureInstrument;
  if (!instrument || instrument.kind !== 'account' || instrument.bankIdentity != null) return false;
  const tail = row.billIdentity ? billTail(row.billIdentity) : null;
  return tail !== null && tail === instrument.last4.toUpperCase();
};

/**
 * Whether a receipt row is the BILLER's own confirmation, not a bank's.
 *
 * A bank confirms its own bill-pay ("Your payment instructions of AED 313.95
 * to Etisalat for consumer number 4026 has been processed"). That message IS
 * the bank's record of a debit from the user's account; folding it into a
 * same-amount card row of another bank deletes a genuine payment. The row
 * carries no sender, so the evidence used is what the bank grammar leaves:
 *   - a `consumer:` identity: the bank bill-pay grammar's label ("consumer
 *     number"); a biller's own receipt calls it the account;
 *   - a stated paying instrument (`captureInstrument`, `paymentInstrumentSource
 *     'alert'`) other than the biller's own account number above.
 */
const billerSentReceipt = (row: Transaction): boolean => {
  if (row.billIdentity !== undefined && /^consumer:/i.test(row.billIdentity)) return false;
  const billerInstrument = instrumentIsBillerAccount(row);
  if (row.captureInstrument !== undefined && !billerInstrument) return false;
  if (row.paymentInstrumentSource === 'alert' && !billerInstrument) return false;
  return true;
};

/**
 * A bank descriptor that still reads as raw text, padded for whole-word tests.
 *
 * The parser and the statement importer (classifyMerchantDescription) both
 * title "E& DIGITAL APP ABU DHABI ARE" — ADCB's statement descriptor for an
 * e& app payment — as "Etisalat", so this only matters for a row that kept
 * the raw descriptor. "e and digital app" is e&'s own app name, never a word
 * sequence another payee uses.
 */
const bankBillerKey = (key: string): string =>
  ` ${key} `.replace(/ e and digital app /g, ' etisalat ');

/**
 * Receipt biller keys allowed to match as a whole word INSIDE a longer bank
 * descriptor ("mb bill dr etisalat telep dubai"). Any other receipt must equal
 * the bank row's payee exactly. A receipt's title can be a person's bill alias
 * — free text such as "Home" — and whole-word containment on free text would
 * pair it with "HOME CENTRE"; only a canonical biller name providerKey itself
 * produces is safe to search for. Add a biller here only with a real sample of
 * its receipt and of the bank descriptor it must match.
 */
const CONTAINMENT_BILLER_KEYS: ReadonlySet<string> = new Set(['etisalat']);

/**
 * A receipt titled only by an account fragment names no biller to compare, so
 * it is never folded; it still competes (see CompetitorEntry).
 */
const UNNAMED_RECEIPT_RE = /^payment\s+to\b/i;

interface ReceiptEntry {
  row: Transaction;
  day: number;
  key: string;
  paddedKey: string;
  /** A biller-sent (and biller-own), unpinned, live receipt: the only kind ever removed. */
  removable: boolean;
}

/**
 * A receipt-side row the fold cannot place: titled only by an account
 * fragment ("Payment to •2543", UNNAMED_RECEIPT_RE), titled with no usable
 * biller key, or dated with something dayNumber cannot read. It is never
 * removed and never the kept side, but it may still be another message for
 * the very payment a bank row records, so it CLAIMS every same-money bank row
 * it could be (any biller, its window, or every day when it has none). That
 * keeps an ambiguous situation ambiguous instead of folding through it.
 */
interface CompetitorEntry {
  row: Transaction;
  day: number | null;
}

interface BankEntry {
  row: Transaction;
  day: number;
  /**
   * A bank-sent receipt, or a row on a holding account: competes for a biller
   * receipt, is never the kept side.
   */
  blockOnly: boolean;
}

/**
 * The window is asymmetric because the two clocks are different things.
 *
 * Two live alerts compare by their own clocks: the card alert and the e&
 * receipt for one payment land within a minute, so ±1 day (and at most one
 * calendar day apart) leaves room for delivery delay without reaching the
 * previous or next month's equal bill.
 *
 * A PDF/CSV statement row carries only a posting DATE, which can trail the
 * payment by a weekend but never precede it. So it PAIRS from the receipt's
 * own day to STATEMENT_POSTING_LAG_DAYS after, never earlier: a charge posted
 * before the receipt was sent cannot be the payment the receipt confirms, and
 * pairing with it would move the bill into an earlier day (or month).
 *
 * A same-amount, same-biller statement row up to STATEMENT_POSTING_LAG_DAYS
 * BEFORE the receipt still COMPETES: it is never kept in the receipt's place,
 * but it says this biller is being paid that amount repeatedly (e&'s AED 30
 * add-ons on 27/07, 29/07 and 02/08), and with several lookalikes about the
 * one-candidate rule refuses to guess rather than pairing with whichever
 * happens to sit on the right side of the receipt.
 */
type WindowFit = 'pair' | 'compete' | null;
const receiptWindowFit = (receipt: { row: Transaction; day: number }, bank: BankEntry): WindowFit => {
  const delta = bank.day - receipt.day;
  if (isStatementRow(bank.row) || isStatementRow(receipt.row)) {
    if (delta >= 0 && delta <= STATEMENT_POSTING_LAG_DAYS) return 'pair';
    return delta < 0 && delta >= -STATEMENT_POSTING_LAG_DAYS ? 'compete' : null;
  }
  if (delta < -1 || delta > 1) return null;
  const a = eventTime(receipt.row);
  const b = eventTime(bank.row);
  return a === null || b === null || Math.abs(a - b) <= LIVE_RECEIPT_WINDOW_MS ? 'pair' : null;
};

/** `paddedReceiptKey` is ` ${key} `; `bankKey` comes from bankBillerKey. */
const sameBiller = (receiptKey: string, paddedReceiptKey: string, bankKey: string): boolean =>
  bankKey === paddedReceiptKey ||
  (CONTAINMENT_BILLER_KEYS.has(receiptKey) && bankKey.includes(paddedReceiptKey));

interface CandidateLink {
  bank: BankEntry;
  /** False for a competitor-only fit (see receiptWindowFit). */
  pairs: boolean;
}

/** First index in a day-sorted bucket whose day is >= `day`. */
const lowerBound = (bucket: BankEntry[], day: number): number => {
  let lo = 0;
  let hi = bucket.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (bucket[mid].day < day) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

/**
 * The biller's OWN receipt ("your payment of AED X for account N has been
 * received"), recognised by what it is rather than where it landed. Its bill
 * identity is the biller's account number (`account:NNNN`). A bank's bill-pay
 * instruction is receipt-side too, but it carries a `consumer:` number and a
 * nickname the user chose, and it is the bank's record of money leaving one of
 * the user's accounts, so it is never folded. Only a row that passes BOTH this
 * and billerSentReceipt is ever removed; any other receipt-side row competes
 * (see BankEntry.blockOnly) and so can only stop a fold, never cause one.
 */
const isBillerOwnReceipt = (row: Transaction): boolean =>
  /^account:[A-Z0-9]{4}$/i.test(row.billIdentity ?? '');

/**
 * Where the receipt sits must not contradict the bank row: the unassigned
 * holding, an account the import made from the biller's own number (the older
 * parser read "account number ····2543" as the user's account), or the very
 * account the bank row is on. Anywhere else says another account paid.
 */
const receiptPlacedFor = (receipt: Transaction, bank: Transaction): boolean =>
  receipt.accountId === UNASSIGNED_TRANSACTION_ACCOUNT_ID || receipt.accountId === bank.accountId ||
  instrumentIsBillerAccount(receipt);

/**
 * A holding account is no evidence of who paid. A row there may still compete
 * for a receipt, but it is never the kept side: the kept row must carry the
 * card or account that paid (a biller's settlement message names none).
 */
const isHoldingAccount = (accountId: string): boolean =>
  accountId === UNASSIGNED_TRANSACTION_ACCOUNT_ID || accountId === UNASSIGNED_INCOME_ACCOUNT_ID;

/**
 * Pair a biller's own receipt with the bank's alert for the SAME payment.
 *
 * e& confirms a bill payment itself ("Your payment ... Amount Paid: AED
 * 450.45 / Payment Channel: Etisalat Mobile App"), and the card that paid it
 * alerts too ("ADCB Credit Card XXX2518 has been used for AED 450.45 at MB
 * BILL DR:ETISALAT TELEP"). Both are expenses, so Spent counted the bill
 * twice. The receipt names no paying card; the bank row has the real card.
 * Keep the bank row, carry the receipt's bill identity onto it (so an
 * account-exact bill still settles, and two e& lines are not confused), and
 * drop the receipt.
 *
 * Deliberately narrow:
 *   - only a receipt the BILLER sent (billerSentReceipt) that carries the
 *     biller's own account number (isBillerOwnReceipt) is ever removed; a
 *     bank's own bill-pay confirmation is its record of a real debit;
 *   - the receipt sits where it cannot contradict the bank row
 *     (receiptPlacedFor);
 *   - the kept row is never on a holding account (isHoldingAccount);
 *   - exactly the same amount and original currency;
 *   - the bank row's payee resolves to the receipt's biller (sameBiller);
 *   - inside the asymmetric window (receiptWindowFit);
 *   - exactly ONE candidate on each side. A second receipt (edited or not), a
 *     second bank row, or a bank's own confirmation of a same-amount payment
 *     to the same biller makes the evidence ambiguous and nothing is paired.
 *     So does a same-money receipt the rule cannot place (no biller name, or
 *     no readable date; CompetitorEntry): it is never removed or kept, but
 *     it may be the bank row's own receipt;
 *   - never against income, a transfer, a card settlement, a funding leg, a
 *     receipt already explained by a funding alert, or a bundle parent;
 *   - a pinned receipt is never removed. A pinned bank row may be the kept
 *     side, unchanged: dropping an unpinned copy of its payment changes
 *     nothing the person decided, and refusing would let every re-read of the
 *     receipt SMS recreate the duplicate for good.
 *
 * The rule is stateless like the two above: it is re-derived over the whole
 * ledger on every reconciliation, so a re-imported receipt is folded again.
 *
 * Cost: one pass to find receipts (and nothing more when none can be
 * removed), one pass to bucket same-amount bank rows by day, then a binary
 * search per receipt over its few days of window — never receipts × every
 * same-amount row.
 */
const pairBillerReceipts = (
  transactions: Transaction[],
  removed: Set<string>,
  fundedReceipts: Set<string>,
  bundleParents: Set<string>,
  providerKeyOf: (title: string) => string,
): Map<string, Transaction> => {
  const merged = new Map<string, Transaction>();
  // Dates repeat across thousands of rows; parse each calendar day once.
  const days = new Map<string, number | null>();
  const dayOf = (iso: string): number | null => {
    let day = days.get(iso);
    if (day === undefined) {
      day = dayNumber(iso);
      days.set(iso, day);
    }
    return day;
  };
  const receipts: ReceiptEntry[] = [];
  const blockers: Transaction[] = [];
  const competitors: CompetitorEntry[] = [];
  let anyRemovable = false;
  for (const row of transactions) {
    if (row.paymentFlowSide !== 'receipt' || row.source !== 'sms' || row.type !== 'expense' ||
      row.isTransfer === true || row.cardPaymentSide !== undefined || !(row.amountFils > 0) ||
      removed.has(row.id) || fundedReceipts.has(row.id)) continue;
    const day = dayOf(row.date);
    if (UNNAMED_RECEIPT_RE.test(row.title.trim()) || day === null) {
      competitors.push({ row, day });
      continue;
    }
    if (!billerSentReceipt(row)) {
      blockers.push(row);
      continue;
    }
    const key = providerKeyOf(row.title);
    if (key.length < 2) {
      competitors.push({ row, day });
      continue;
    }
    // A receipt without the biller's account number (isBillerOwnReceipt) is
    // kept like a pinned one: it still claims the bank rows it matches, so it
    // can make a fold ambiguous, but it is never removed itself.
    const removable = isBillerOwnReceipt(row) && !pinned(row) && !isStatementRow(row);
    if (removable) anyRemovable = true;
    receipts.push({ row, day, key, paddedKey: ` ${key} `, removable });
  }
  if (!anyRemovable) return merged;

  const amounts = new Set<number>();
  for (const entry of receipts) amounts.add(entry.row.amountFils);
  const bankKeys = new Map<string, string>();
  const bankKeyOf = (title: string): string => {
    let key = bankKeys.get(title);
    if (key === undefined) {
      key = bankBillerKey(providerKeyOf(title));
      bankKeys.set(title, key);
    }
    return key;
  };
  const banksByAmount = new Map<number, BankEntry[]>();
  const addBank = (row: Transaction, blockOnly: boolean) => {
    const day = dayOf(row.date);
    if (day === null) return;
    const entry: BankEntry = { row, day, blockOnly };
    const bucket = banksByAmount.get(row.amountFils);
    if (bucket) bucket.push(entry);
    else banksByAmount.set(row.amountFils, [entry]);
  };
  for (const row of transactions) {
    if (!amounts.has(row.amountFils)) continue;
    if (row.source !== 'sms' || row.type !== 'expense' || row.paymentFlowSide !== undefined ||
      row.isTransfer === true || row.cardPaymentSide !== undefined || row.transferMatch !== undefined ||
      removed.has(row.id) || bundleParents.has(row.id)) continue;
    addBank(row, isHoldingAccount(row.accountId));
  }
  for (const row of blockers) if (amounts.has(row.amountFils)) addBank(row, true);
  if (banksByAmount.size === 0) return merged;
  for (const bucket of banksByAmount.values()) if (bucket.length > 1) bucket.sort((a, b) => a.day - b.day);
  const competitorsByAmount = new Map<number, CompetitorEntry[]>();
  for (const entry of competitors) {
    if (!banksByAmount.has(entry.row.amountFils)) continue;
    const list = competitorsByAmount.get(entry.row.amountFils);
    if (list) list.push(entry);
    else competitorsByAmount.set(entry.row.amountFils, [entry]);
  }
  /** Whether an unplaceable receipt could be another message for this bank row's payment. */
  const competitorClaims = (competitor: CompetitorEntry, bank: BankEntry): boolean =>
    competitor.row !== bank.row && sameMoney(competitor.row, bank.row) &&
    !conflictingBillIdentity(competitor.row, bank.row) &&
    (competitor.day === null || receiptWindowFit({ row: competitor.row, day: competitor.day }, bank) !== null);

  const banksOfReceipt = new Map<ReceiptEntry, CandidateLink[]>();
  const receiptCount = new Map<BankEntry, number>();
  for (const receipt of receipts) {
    const bucket = banksByAmount.get(receipt.row.amountFils);
    if (!bucket) continue;
    const last = receipt.day + STATEMENT_POSTING_LAG_DAYS;
    const first = receipt.day - STATEMENT_POSTING_LAG_DAYS;
    for (let i = lowerBound(bucket, first); i < bucket.length && bucket[i].day <= last; i++) {
      const bank = bucket[i];
      if (bank.row === receipt.row) continue;
      if (!receiptPlacedFor(receipt.row, bank.row)) continue;
      if (!sameBiller(receipt.key, receipt.paddedKey, bankKeyOf(bank.row.title)) || !sameMoney(receipt.row, bank.row) ||
        conflictingBillIdentity(receipt.row, bank.row)) continue;
      const fit = receiptWindowFit(receipt, bank);
      if (fit === null) continue;
      // A competitor is recorded with the same weight as a candidate: either
      // makes the count two. Only a 'pair' fit can ever be the kept side.
      const link: CandidateLink = { bank, pairs: fit === 'pair' };
      const banks = banksOfReceipt.get(receipt);
      if (banks) banks.push(link);
      else banksOfReceipt.set(receipt, [link]);
      receiptCount.set(bank, (receiptCount.get(bank) ?? 0) + 1);
    }
  }

  for (const [receipt, banks] of banksOfReceipt) {
    if (!receipt.removable || banks.length !== 1 || !banks[0].pairs) continue;
    const bank = banks[0].bank;
    if (bank.blockOnly || receiptCount.get(bank) !== 1) continue;
    // A second, unplaceable receipt for this bank row makes the count two.
    if (competitorsByAmount.get(bank.row.amountFils)?.some(c => competitorClaims(c, bank))) continue;
    removed.add(receipt.row.id);
    if (pinned(bank.row)) continue;
    const carryIdentity = bank.row.billIdentity === undefined && receipt.row.billIdentity !== undefined;
    const carryNote = bank.row.note === undefined && receipt.row.note !== undefined;
    if (carryIdentity || carryNote) {
      merged.set(bank.row.id, {
        ...bank.row,
        ...(carryIdentity ? { billIdentity: receipt.row.billIdentity } : {}),
        ...(carryNote ? { note: receipt.row.note } : {}),
      });
    }
  }
  return merged;
};
