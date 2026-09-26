/* ───────────────────── Buy-now-pay-later provider sources ─────────────────────
 *
 * A Tabby/Tamara instalment is ONE outflow with TWO messages: the bank's card
 * alert ("Purchase of AED 49.75 to TABBY with Credit Card ending 1234") and the
 * provider's own SMS or app notification restating it under the SHOP's name
 * ("... for your Noon order"). The bank alert is the real ledger event — it
 * names the card that paid and carries the bank's balance/limit. The
 * restatement can never be paired with it (dedupe compares merchants, and Noon
 * is not Tabby), so importing it counted every instalment twice, and an
 * "order split into 4 payments" notice booked the whole order on top of the
 * four card charges.
 *
 * So a message whose SOURCE is a BNPL provider is not a ledger event at all,
 * whatever it says. The gate is the provider's IDENTITY, never its wording —
 * provider copy changes and is not in the corpus; the sender is what says who
 * is talking. A bank alert that merely NAMES Tabby (the charge above, an EPP
 * offer, a refund) is untouched, as is any shop called "Tabby Tailoring".
 *
 * Android packages are exact ids verified on Google Play (developer "Tabby",
 * developer "TAMARA FZE"). The providers' merchant apps (app.tabby.cashier,
 * co.tamara.merchant) are deliberately absent. Postpay and Cashew publish no
 * consumer Android app under their own name that could be verified, so they
 * are gated by SMS sender only. SMS sender spellings are the brand itself with
 * the operator's promotional "AD" marker in either position; these have NOT
 * been checked against a real handset.
 *
 * A pure module with no imports on purpose: the parser, the launch session and
 * the Android capture scanner all consult it, and test harnesses that stub the
 * parser must still reach the real registry.
 */
const BNPL_PROVIDER_PACKAGES: ReadonlySet<string> = new Set(['app.tabby.client', 'co.tamara.user']);
const BNPL_PROVIDER_SENDER_RE = /^(?:ad)?(?:tabby(?:ai)?|tamara(?:co)?|postpay|cashew)(?:ad)?$/;

/**
 * Is this SMS sender ID / notification package a BNPL provider rather than a
 * bank? Accepts the `${package} ${title}` form a learned notification package
 * is parsed under. Exact identity only: a sender that merely CONTAINS a
 * provider name is not the provider.
 */
export function isBnplProviderSource(sender?: string | null): boolean {
  if (typeof sender !== 'string') return false;
  const value = sender.normalize('NFKC').trim().toLowerCase();
  if (!value || value.length > 200) return false;
  if (BNPL_PROVIDER_PACKAGES.has(value.split(/\s+/)[0])) return true;
  return BNPL_PROVIDER_SENDER_RE.test(value.replace(/[\s._-]/g, ''));
}
