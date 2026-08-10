import { STRUCTURAL_TITLES, type ParsedSms } from '@/lib/sms-parser';
import type { Transaction, TxHealUpdate } from '@/lib/types';

/**
 * What a rescan should change about a row it has already imported.
 *
 * A message is imported once — its fingerprint is remembered, so it can never
 * arrive again. When the parser learns to read that message better, this is
 * the only path back to the row it produced. Everything the parser gains
 * afterwards reaches existing data through here or not at all.
 *
 * Returns null when there is nothing to change.
 */
export function healPatch(
  prior: Transaction,
  p: Omit<ParsedSms, 'raw'> & {
    raw?: string;
    cardPaymentSide?: 'debit' | 'receipt';
  },
): TxHealUpdate | null {
  // Never re-heal a row the user corrected by hand — a rescan that undoes
  // their edit teaches them that correcting anything is pointless.
  if (prior.userEdited) return null;

  const patch: TxHealUpdate = { id: prior.id };
  const directionChanged = p.kind === 'transaction' && prior.type !== p.type;

  // Retitle rows whose old title was generic OR whose category never got past
  // "other" (that combination is where garbage titles live) — but never
  // replace a name with the generic fallback.
  if (
    p.merchant !== 'Card purchase' &&
    p.merchant !== prior.title &&
    (prior.title === 'Card purchase' || prior.category === 'other')
  ) {
    patch.title = p.merchant;
  }
  if (directionChanged) {
    patch.type = p.type;
    // Direction and category are one parser conclusion. Keeping an old
    // groceries category on a newly recognized refund (or Business on a
    // newly recognized purchase) makes the healed row internally impossible.
    patch.category = p.categoryGuess;
    if (p.merchant !== 'Card purchase' && p.merchant !== prior.title) {
      patch.title = p.merchant;
    }
    if (prior.isTransfer !== p.transferHint) patch.isTransfer = p.transferHint;
  }
  if (prior.category === 'other' && p.categoryGuess !== 'other' && !prior.isTransfer) {
    patch.category = p.categoryGuess;
  }
  // A category the parser is now DELIBERATE about, disagreeing with what is
  // stored. Healing only out of `other` was not enough: the expensive mistakes
  // are the confidently wrong ones. Grubtech sells a POS system to restaurants
  // and matched a food rule, so 55 charges of AED 1,295.63 sat in Dining —
  // AED 1,295 a month against a dining budget, and a software subscription the
  // Subscriptions tab could never show because `dining` is not a subscription
  // category. Correcting the rule reached none of them: those rows say
  // `dining`, not `other`, so nothing above touches them.
  //
  // Three guards make this safe to run over an entire ledger. `userEdited`
  // returned at the top, so a hand-corrected row is untouchable. `deliberate`
  // means a NAMED rule matched, never the fallback — a vocabulary tweak cannot
  // sweep rows it was not written for. And `other` is excluded as a
  // destination: transfers and card settlements are deliberately `other`, and
  // a row that already knows what it is must never be demoted to that.
  if (
    p.categoryDeliberate &&
    p.categoryGuess !== 'other' &&
    p.categoryGuess !== prior.category &&
    !prior.isTransfer &&
    !p.transferHint
  ) {
    patch.category = p.categoryGuess;
  }
  if (p.transferHint && !prior.isTransfer) patch.isTransfer = true;
  // Older parser versions marked every inbound remittance as a transfer and
  // therefore removed genuine external money from Income. Inbound account
  // transfers now stay countable unless ledger pairing finds the matching
  // outgoing leg; a reparse must clear the stale flag as well as fixing new
  // imports. Card payments remain transfers on their dedicated branch.
  if (
    prior.isTransfer &&
    p.kind === 'transaction' &&
    p.type === 'income' &&
    !p.transferHint
  ) {
    patch.isTransfer = false;
  }

  // A card payment whose wording the parser did not recognize was imported as
  // an EXPENSE carrying a transfer hint. Nothing downstream could use it:
  // `allocatePayments` credits income-side transfers only, so the statement
  // stayed open and the app went on calling a paid card overdue. Setting the
  // hint alone — which is all this did — never reached that.
  if (p.kind === 'cardPayment') {
    if (prior.type !== 'income') patch.type = 'income';
    if (!prior.isTransfer) patch.isTransfer = true;
    if (p.cardPaymentSide && prior.cardPaymentSide !== p.cardPaymentSide) {
      patch.cardPaymentSide = p.cardPaymentSide;
    }
  }

  // Keep the raw message on rows the parser still cannot read, so the accuracy
  // report has something to show. Only when it is still low-confidence AFTER
  // everything above, and only if it is not already stored.
  const titleAfter = patch.title ?? prior.title;
  const catAfter = patch.category ?? prior.category;
  const typeAfter = patch.type ?? prior.type;
  const transferAfter = patch.isTransfer ?? prior.isTransfer;
  const stillLow =
    typeAfter === 'expense' &&
    !p.transferHint &&
    !transferAfter &&
    (titleAfter === 'Card purchase' ||
      (catAfter === 'other' && !p.categoryDeliberate && !STRUCTURAL_TITLES.has(titleAfter)));
  if (stillLow) {
    if (!prior.raw && p.raw) patch.raw = p.raw.slice(0, 300);
  } else if (prior.raw && !p.categoryPinned) {
    // The row is readable now — a name, a category, or a direction correction
    // landed above. Drop the source text, or the accuracy report keeps offering
    // this format for the user to send in long after the parser learned it.
    //
    // NOT when the only thing making it readable is the user's own merchant
    // rule. `categoryDeliberate` is true for a pin exactly as it is for a
    // vocabulary rule, so `stillLow` reads a pinned row as understood and this
    // branch deleted its raw text — which is the ONLY path any later release
    // has back to an already-imported row, since heal can rewrite a row but
    // never delete one. It fired on every pinned row on the first launch after
    // c79a2d6 stopped `setMerchantOverride` stamping `userEdited` (which had
    // returned null at the top of this function and kept the raw by accident),
    // and it fired hardest where it hurt most: a pinned row is by definition
    // one the parser could not categorise, so it is one of the rows most
    // likely to be carrying raw in the first place. The parser has still not
    // learned this format — the user papered over it merchant by merchant —
    // so the accuracy report is right to go on offering it.
    patch.raw = null;
  }

  return Object.keys(patch).length > 1 ? patch : null;
}

/**
 * Apply a patch to the row it belongs to.
 *
 * Every caller of `healPatch` needs this, and for a while each one wrote its
 * own version. They drifted: the launch-time re-parse in the store set the
 * transfer flag on a card payment but never the direction, so a card the user
 * had paid stayed open — the exact bug `healPatch` was written to fix, still
 * live on the path that runs most often. One function so there is nothing left
 * to drift.
 *
 * `remove` is not handled here; a caller drops those rows before applying.
 */
export function applyHealPatch(tx: Transaction, patch: TxHealUpdate): Transaction {
  // Planning and applying are separated by inbox/relay I/O. A user can edit
  // the row in that gap, so the apply boundary must enforce the pin again
  // even when the patch was valid for the older snapshot.
  if (tx.userEdited) {
    // Exact retained-message identity is not a parser opinion and prevents a
    // later history import from pairing another event to this same live row.
    // Promote only those technical fields; every user-facing correction stays
    // pinned byte-for-byte.
    const nextViaPush = patch.viaPush === undefined ? tx.viaPush : patch.viaPush || undefined;
    if (
      (patch.ts === undefined || patch.ts === tx.ts) &&
      (patch.smsKey === undefined || patch.smsKey === tx.smsKey) &&
      nextViaPush === tx.viaPush
    ) {
      return tx;
    }
    const identified: Transaction = { ...tx };
    if (patch.ts !== undefined) identified.ts = patch.ts;
    if (patch.smsKey !== undefined) identified.smsKey = patch.smsKey;
    if (patch.viaPush !== undefined) identified.viaPush = nextViaPush;
    return identified;
  }
  const next: Transaction = { ...tx };
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.category !== undefined) next.category = patch.category;
  if (patch.type !== undefined) next.type = patch.type;
  if (patch.isTransfer !== undefined) next.isTransfer = patch.isTransfer;
  if (patch.accountId !== undefined) next.accountId = patch.accountId;
  if (patch.ts !== undefined) next.ts = patch.ts;
  if (patch.smsKey !== undefined) next.smsKey = patch.smsKey;
  if (patch.viaPush !== undefined) next.viaPush = patch.viaPush || undefined;
  if (patch.cardPaymentSide !== undefined) next.cardPaymentSide = patch.cardPaymentSide;
  if (patch.raw !== undefined) {
    if (patch.raw === null) delete next.raw;
    else next.raw = patch.raw;
  }
  return next;
}

/**
 * Apply a planned rescan batch to the ledger as it exists now. Planning may
 * have happened before a hand edit, so both destructive removals and ordinary
 * patches re-check the current row's user pin at this boundary.
 */
export function applyHealUpdates(
  transactions: Transaction[],
  updates: TxHealUpdate[],
): Transaction[] {
  if (updates.length === 0) return transactions;
  const patches = new Map(updates.map((update) => [update.id, update]));
  return transactions
    .filter((transaction) => transaction.userEdited || !patches.get(transaction.id)?.remove)
    .map((transaction) => {
      const patch = patches.get(transaction.id);
      return patch ? applyHealPatch(transaction, patch) : transaction;
    });
}
