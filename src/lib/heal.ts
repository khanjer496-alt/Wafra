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
export function healPatch(prior: Transaction, p: ParsedSms): TxHealUpdate | null {
  // Never re-heal a row the user corrected by hand — a rescan that undoes
  // their edit teaches them that correcting anything is pointless.
  if (prior.userEdited) return null;

  const patch: TxHealUpdate = { id: prior.id };

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
  if (prior.category === 'other' && p.categoryGuess !== 'other' && !prior.isTransfer) {
    patch.category = p.categoryGuess;
  }
  if (p.transferHint && !prior.isTransfer) patch.isTransfer = true;

  // A card payment whose wording the parser did not recognize was imported as
  // an EXPENSE carrying a transfer hint. Nothing downstream could use it:
  // `allocatePayments` credits income-side transfers only, so the statement
  // stayed open and the app went on calling a paid card overdue. Setting the
  // hint alone — which is all this did — never reached that.
  if (p.kind === 'cardPayment') {
    if (prior.type !== 'income') patch.type = 'income';
    if (!prior.isTransfer) patch.isTransfer = true;
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
      (catAfter === 'other' && !STRUCTURAL_TITLES.has(titleAfter)));
  if (stillLow) {
    if (!prior.raw) patch.raw = p.raw.slice(0, 300);
  } else if (prior.raw) {
    // The row is readable now — a name, a category, or a direction correction
    // landed above. Drop the source text, or the accuracy report keeps offering
    // this format for the user to send in long after the parser learned it.
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
  const next: Transaction = { ...tx };
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.category !== undefined) next.category = patch.category;
  if (patch.type !== undefined) next.type = patch.type;
  if (patch.isTransfer !== undefined) next.isTransfer = patch.isTransfer;
  if (patch.raw !== undefined) {
    if (patch.raw === null) delete next.raw;
    else next.raw = patch.raw;
  }
  return next;
}
