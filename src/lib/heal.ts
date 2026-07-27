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
  if (p.kind === 'cardPayment' && prior.type !== 'income') {
    patch.type = 'income';
    patch.isTransfer = true;
  }

  // Keep the raw message on rows the parser still cannot read, so the accuracy
  // report has something to show. Only when it is still low-confidence AFTER
  // everything above, and only if it is not already stored.
  const titleAfter = patch.title ?? prior.title;
  const catAfter = patch.category ?? prior.category;
  const stillLow =
    p.type === 'expense' &&
    !p.transferHint &&
    !prior.isTransfer &&
    (titleAfter === 'Card purchase' ||
      (catAfter === 'other' && !STRUCTURAL_TITLES.has(titleAfter)));
  if (stillLow && !prior.raw) patch.raw = p.raw.slice(0, 300);

  return Object.keys(patch).length > 1 ? patch : null;
}
