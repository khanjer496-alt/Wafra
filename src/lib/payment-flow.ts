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
 * How far apart a biller's own receipt and the bank's alert for the same
 * payment may be. The card alert and the e& receipt normally land within a
 * minute, but the owner's corpus has an e& receipt two days after the card
 * debit it confirms (the compound-bill fixture), and a PDF/CSV statement row
 * carries only a posting DATE that can trail the payment by a weekend. Three
 * days is the window the bundle rule already uses for the same biller; the
 * one-candidate-on-each-side rule, not the window, is what refuses a guess.
 */
const BILLER_RECEIPT_WINDOW_MS = COMPOUND_BILL_WINDOW_MS;
const BILLER_RECEIPT_WINDOW_DAYS = 3;
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

/**
 * A statement row's clock is synthetic (midday of the posting date), so a
 * pair involving one is compared by calendar day. Two live alerts compare by
 * their own clocks.
 */
const withinReceiptWindow = (receipt: Transaction, bank: Transaction): boolean => {
  const a = eventTime(receipt);
  const b = eventTime(bank);
  if (a !== null && b !== null && !isStatementRow(receipt) && !isStatementRow(bank)) {
    return Math.abs(a - b) <= BILLER_RECEIPT_WINDOW_MS;
  }
  const da = dayNumber(receipt.date);
  const db = dayNumber(bank.date);
  return da !== null && db !== null && Math.abs(da - db) <= BILLER_RECEIPT_WINDOW_DAYS;
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

/** Two stated bill accounts that differ are two bills, whatever the amount. */
const conflictingBillIdentity = (a: Transaction, b: Transaction): boolean => {
  if (!a.billIdentity || !b.billIdentity) return false;
  const ta = billTail(a.billIdentity);
  const tb = billTail(b.billIdentity);
  return ta !== null && tb !== null ? ta !== tb : a.billIdentity.toLowerCase() !== b.billIdentity.toLowerCase();
};

/** Anything a person decided about the row. Such a row is never removed here. */
const pinned = (row: Transaction): boolean =>
  row.userEdited === true || row.titleEdited === true || row.transferDecision !== undefined ||
  row.billPayment !== undefined || (row.splits?.length ?? 0) > 0;

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

/** A receipt titled only by an account fragment names no biller to compare. */
const UNNAMED_RECEIPT_RE = /^payment\s+to\b/i;

/**
 * Pair a biller's own receipt with the bank's alert for the SAME payment.
 *
 * e& confirms a bill payment itself ("Your payment ... Amount Paid: AED
 * 450.45 / Payment Channel: Etisalat Mobile App"), and the card that paid it
 * alerts too ("ADCB Credit Card XXX2518 has been used for AED 450.45 at MB
 * BILL DR:ETISALAT TELEP"). Both are expenses, so Spent counted the bill
 * twice. The receipt usually names no paying card and lands on the
 * unassigned account; the bank row has the real card. Keep the bank row,
 * carry the receipt's bill identity onto it (so an account-exact bill still
 * settles, and two e& lines are not confused), and drop the receipt.
 *
 * Deliberately narrow:
 *   - exactly the same amount and original currency;
 *   - the bank row's payee resolves to the receipt's biller (providerKey
 *     equality, or the receipt's biller as a whole word of the bank
 *     descriptor: "mb bill dr etisalat telep dubai" names "etisalat");
 *   - within BILLER_RECEIPT_WINDOW of each other, in either order;
 *   - exactly ONE candidate on each side. A second receipt or a second bank
 *     row — including a user-edited one, which is never itself removed — makes
 *     the evidence ambiguous and nothing is paired;
 *   - never against income, a transfer, a card settlement, a funding leg, a
 *     receipt already explained by a funding alert, or a bundle parent;
 *   - neither row edited by the user. Pinned rows still count as competitors.
 *
 * The rule is stateless like the two above: it is re-derived over the whole
 * ledger on every reconciliation, so a re-imported receipt is folded again.
 */
/**
 * The biller's OWN receipt ("your payment of AED X for account N has been
 * received"), recognised by what it is rather than where it landed. Its bill
 * identity is the biller's account number (`account:NNNN`). A bank's bill-pay
 * instruction is receipt-side too, but it carries a `consumer:` number and a
 * nickname the user chose, and it is the bank's record of money leaving one of
 * the user's accounts, so it is never folded. Where it may sit is checked per
 * pair (receiptPlacedFor): the older parser read "account number ····2543" as
 * the user's account, and e& may print the paying card's number.
 */
const isBillerOwnReceipt = (row: Transaction): boolean =>
  /^account:[A-Z0-9]{4}$/i.test(row.billIdentity ?? '');

/**
 * Where the receipt sits must not contradict the bank row: unassigned, an
 * account made from the biller's own number, or the very account the bank row
 * is on (e& printing the paying card's number puts both on that card).
 */
const receiptPlacedFor = (receipt: Transaction, bank: Transaction): boolean => {
  if (receipt.accountId === UNASSIGNED_TRANSACTION_ACCOUNT_ID || receipt.accountId === bank.accountId) return true;
  const tail = receipt.billIdentity?.match(/^account:([A-Z0-9]{4})$/i)?.[1];
  return receipt.captureInstrument?.kind === 'account' && receipt.captureInstrument.last4 === tail;
};

const pairBillerReceipts = (
  transactions: Transaction[],
  removed: Set<string>,
  fundedReceipts: Set<string>,
  bundleParents: Set<string>,
  providerKeyOf: (title: string) => string,
): Map<string, Transaction> => {
  const merged = new Map<string, Transaction>();
  const receiptsByAmount = new Map<number, Transaction[]>();
  for (const row of transactions) {
    if (!isBillerOwnReceipt(row)) continue;
    if (row.source !== 'sms' || row.type !== 'expense' || row.paymentFlowSide !== 'receipt' ||
      row.isTransfer === true || row.cardPaymentSide !== undefined || !(row.amountFils > 0) ||
      removed.has(row.id) || fundedReceipts.has(row.id) || UNNAMED_RECEIPT_RE.test(row.title.trim())) continue;
    if (providerKeyOf(row.title).length < 2) continue;
    const group = receiptsByAmount.get(row.amountFils);
    if (group) group.push(row);
    else receiptsByAmount.set(row.amountFils, [row]);
  }
  if (receiptsByAmount.size === 0) return merged;

  const banksOfReceipt = new Map<Transaction, Transaction[]>();
  const receiptsOfBank = new Map<Transaction, Transaction[]>();
  for (const bank of transactions) {
    const group = receiptsByAmount.get(bank.amountFils);
    if (!group) continue;
    // The kept row is the bank's: it must carry the card or account that paid.
    // A biller's settlement message with no instrument is never the keeper.
    if (bank.accountId === UNASSIGNED_TRANSACTION_ACCOUNT_ID || bank.accountId === UNASSIGNED_INCOME_ACCOUNT_ID) continue;
    if (bank.source !== 'sms' || bank.type !== 'expense' || bank.paymentFlowSide !== undefined ||
      bank.isTransfer === true || bank.cardPaymentSide !== undefined || bank.transferMatch !== undefined ||
      removed.has(bank.id) || bundleParents.has(bank.id)) continue;
    const bankKey = bankBillerKey(providerKeyOf(bank.title));
    for (const receipt of group) {
      const receiptKey = providerKeyOf(receipt.title);
      const sameBiller = bankKey === ` ${receiptKey} ` ||
        (receiptKey.length >= 4 && bankKey.includes(` ${receiptKey} `));
      if (!sameBiller || !receiptPlacedFor(receipt, bank) || !sameMoney(receipt, bank) || conflictingBillIdentity(receipt, bank) ||
        !withinReceiptWindow(receipt, bank)) continue;
      const banks = banksOfReceipt.get(receipt);
      if (banks) banks.push(bank);
      else banksOfReceipt.set(receipt, [bank]);
      const receipts = receiptsOfBank.get(bank);
      if (receipts) receipts.push(receipt);
      else receiptsOfBank.set(bank, [receipt]);
    }
  }

  for (const [receipt, banks] of banksOfReceipt) {
    if (banks.length !== 1) continue;
    const bank = banks[0];
    if (receiptsOfBank.get(bank)?.length !== 1) continue;
    if (pinned(receipt) || pinned(bank)) continue;
    removed.add(receipt.id);
    const carryIdentity = bank.billIdentity === undefined && receipt.billIdentity !== undefined;
    const carryNote = bank.note === undefined && receipt.note !== undefined;
    if (carryIdentity || carryNote) {
      merged.set(bank.id, {
        ...bank,
        ...(carryIdentity ? { billIdentity: receipt.billIdentity } : {}),
        ...(carryNote ? { note: receipt.note } : {}),
      });
    }
  }
  return merged;
};
