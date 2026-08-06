/**
 * The per-charge banner for iOS, with no notification API in sight.
 *
 * Android has had one of these since the beginning: InstantAlert.kt posts a
 * banner the second a bank SMS lands. iOS had nothing. The only push it gets
 * is a silent content-available wake, which writes rows to the encrypted inbox
 * and says nothing at all — so the same user, on the more expensive phone, was
 * told about a charge only when they next opened the app.
 *
 * Same split as reminders.ts and daily-summary.ts, for the same reason: the
 * part that can be WRONG — whether a row is really a charge, what the sentence
 * says — is the part that has to be testable, and background-relay.ts imports
 * expo-notifications. This module imports no native anything.
 *
 * WHAT THIS INHERITS FROM THE KOTLIN. Its governing rule is that a banner must
 * never announce something that did not happen: a promo, an OTP, a declined
 * card and a statement reminder each name an amount and none of them is a
 * charge, so unless the message plainly states money MOVED it posts nothing.
 * The failure is deliberately one-sided — a skipped banner costs the user
 * nothing, because the row is in the ledger either way, while one banner
 * saying they just spent AED 20,918 when they did not costs their trust in
 * every banner after it.
 *
 * WHERE THIS IS BETTER THAN THE KOTLIN, AND WHY. InstantAlert runs inside a
 * broadcast receiver with no JavaScript engine, so it re-reads the message
 * with a handful of blunt regexes and is approximate on purpose. These rows
 * are not messages. The Worker already ran the real parser on them, so the
 * question "is this a completed transaction?" is answered by a STRUCTURED
 * field rather than a verb list, and merchant, amount, card and category
 * arrive as data rather than as a guess. Every refusal below is therefore a
 * property of the parsed row, not a pattern over prose.
 *
 * NOTHING LEAVES THE DEVICE. A local notification is composed here and handed
 * to the OS on this phone. No text derived from a bank message is sent
 * anywhere, and the wake that triggered all this carried no amount, merchant
 * or account to begin with.
 */
import { cardAccountName } from '@/lib/cards';
import { categoryLabel } from '@/lib/categories';
import { formatAED } from '@/lib/format';
import { tf, type Lang } from '@/lib/i18n';
import type { ScannedSms } from '@/lib/import-plan';

/**
 * How stale a row may be and still be announced as news.
 *
 * Android cannot need this: its banner fires from the delivery broadcast, so
 * "a charge happened" and "a banner is due" are the same instant. A relay wake
 * is not that. A phone that was off, out of signal, or had background refresh
 * withheld by iOS collects a backlog, and the wake that finally arrives
 * carries charges from hours ago. "AED 240 · CARREFOUR" as a fresh banner for
 * a purchase made yesterday afternoon is a different claim from the true one,
 * and it is exactly the class of claim this file exists to refuse.
 */
export const ALERT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/**
 * Tolerance for a timestamp in the future.
 *
 * The row's `smsTs` comes from the Shortcut on the user's own phone, so a
 * clock a few minutes ahead is ordinary. An hour ahead is not, and a row
 * stamped next week would otherwise stay announceable forever.
 */
export const ALERT_MAX_SKEW_MS = 60 * 60 * 1000;

/** Charges named individually in a grouped banner before "+N more". */
export const ALERT_ROWS = 5;

export interface ChargeAlert {
  title: string;
  /** May be empty — a title alone is a valid notification. */
  body: string;
  /** How many charges this one banner speaks for. */
  count: number;
}

/**
 * Is this parsed row a completed transaction the user should be told about?
 *
 * `nowMs` is passed in rather than read from the clock so a test can ask about
 * any moment without moving it.
 */
export function isAnnounceable(row: ScannedSms, nowMs: number): boolean {
  // Only money that MOVED. `billDue` and `cardStatement` are obligations that
  // charged nothing — they are the statement reminder the Kotlin spends thirty
  // lines of regex refusing, and here they are simply a different `kind`.
  // `cardPayment` is a settlement between the user's own accounts, so it is
  // not spending either; the daily summary excludes the same rows through
  // `isSpending`, and a banner that disagreed with the summary of the same day
  // would be worse than no banner.
  if (row.kind !== 'transaction') return false;

  // The bank-side leg of an own-account transfer. Money left an account and
  // arrived in another one of the user's, so nothing was spent.
  if (row.transferHint) return false;

  // A figure that is not a figure. The Kotlin refuses a masked balance
  // ("AED ····1985.47") because announcing it quotes a number that does not
  // exist; the structured equivalent is a non-positive or non-integral amount.
  if (!Number.isSafeInteger(row.amountFils) || row.amountFils <= 0) return false;

  // Only the live bank-alert path.
  //
  // Three things ride this same wake channel. `shortcut` is an alert that just
  // arrived on this phone, which is the only one that happened NOW. `email`
  // and `pdf` are statement imports: dozens of rows at once, most of them
  // weeks old, and announcing them would tell the user they had just spent
  // their way through a quarter. A setup probe never carries a capture source
  // at all, so this also guarantees the capture test cannot post a banner for
  // a transaction that was never real.
  if (row.captureSource !== 'shortcut') return false;

  const ts = row.smsTs;
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return false;
  if (ts - nowMs > ALERT_MAX_SKEW_MS) return false;
  if (nowMs - ts > ALERT_MAX_AGE_MS) return false;

  return true;
}

/** Every row from this sync worth a banner, largest first. */
export function announceableCharges(rows: readonly ScannedSms[], nowMs: number): ScannedSms[] {
  // Largest first, for the reason the daily summary sorts the same way: a
  // banner read on a lock screen gets four seconds, and the AED 2,400 row is
  // the one worth those seconds.
  return rows.filter((row) => isAnnounceable(row, nowMs)).sort((a, b) => b.amountFils - a.amountFils);
}

/**
 * ONE notification for everything this sync collected, or null when it
 * collected nothing worth announcing.
 *
 * One banner per sync, not one per charge, and the difference from Android is
 * not an oversight. InstantAlert posts one banner per message because its
 * trigger IS one message: the broadcast fires as the SMS lands, so "one per
 * charge" and "one per event" are the same thing there. A relay wake is one
 * event carrying however many charges accumulated while the app was asleep,
 * so one-per-charge would post four notifications with the same timestamp in
 * the same second — a burst Android never produces. The Kotlin is explicit
 * about what that costs: a heads-up for every coffee is how an app gets muted
 * wholesale, and a user who mutes Wafra loses the payment reminders with it.
 *
 * So a single charge gets the full per-charge banner, identical in substance
 * to Android's, and several get one grouped banner that still NAMES each of
 * them in the body. Nothing is announced twice and nothing goes unmentioned.
 *
 * `lang` is explicit because this runs in a headless background task that may
 * execute before hydrate has told i18n which language the user reads.
 */
export function buildChargeAlert(
  rows: readonly ScannedSms[],
  nowMs: number,
  lang: Lang,
): ChargeAlert | null {
  const charges = announceableCharges(rows, nowMs);
  if (charges.length === 0) return null;
  if (charges.length === 1) return single(charges[0], lang);

  const out = charges.filter((row) => row.type === 'expense');
  const received = charges.filter((row) => row.type !== 'expense');
  const sum = (list: ScannedSms[]) => list.reduce((total, row) => total + row.amountFils, 0);

  // The headline counts and totals ONE direction. A total that netted a refund
  // against two purchases would be a number that matches nothing the user can
  // check — not the day's spend, not any single charge. Spending leads when
  // there is any; money arriving still gets its own line below.
  const lead = out.length > 0 ? out : received;
  const title = tf(
    out.length > 0 ? 'chargeAlertGroupTitle' : 'chargeAlertGroupCreditTitle',
    {
      amount: formatAED(sum(lead), { decimals: false }),
      count: lead.length,
      s: lead.length === 1 ? '' : 's',
    },
    lang,
  );

  const named = charges.slice(0, ALERT_ROWS);
  const lines = named.map((row) =>
    tf(row.type === 'expense' ? 'dailySummaryLine' : 'chargeAlertLineCredit', {
      amount: formatAED(row.amountFils),
      merchant: merchantOf(row, lang),
    }, lang),
  );
  const rest = charges.length - named.length;
  if (rest > 0) {
    lines.push(tf('dailySummaryMore', { count: rest, s: rest === 1 ? '' : 's' }, lang));
  }

  return { title, body: lines.join('\n'), count: charges.length };
}

/** The one-charge banner: what Android posts, with the parser's certainty. */
function single(row: ScannedSms, lang: Lang): ChargeAlert {
  const amount = formatAED(row.amountFils);
  const credit = row.type !== 'expense';
  const merchant = namedMerchant(row);
  const key = merchant
    ? credit
      ? 'chargeAlertTitleCredit'
      : 'chargeAlertTitle'
    : credit
      ? 'chargeAlertTitleCreditPlain'
      : 'chargeAlertTitlePlain';
  const title = tf(key, { amount, merchant: merchant ?? '' }, lang);

  // The second line is WHICH card, then what it was for. The card is the fact
  // that makes a banner worth looking at, which is why the Kotlin puts it
  // there too; the category is the part Android cannot have, because deciding
  // it needs the real parser and the receiver has no engine to run one.
  //
  // The category appears only when the parser DECIDED it. `other` means two
  // opposite things — a deliberate "money moved but was not spent" and an
  // untouched fall-through — and printing the fall-through as "Other" would
  // dress a shrug up as a finding.
  const parts: string[] = [];
  if (row.card) parts.push(cardAccountName(row.card.last4, row.card.kind, lang));
  if (row.categoryDeliberate) parts.push(categoryLabel(row.categoryGuess, lang));

  return { title, body: parts.join(' · '), count: 1 };
}

/** The merchant, or null when the row does not actually name one. */
function namedMerchant(row: ScannedSms): string | null {
  const name = typeof row.merchant === 'string' ? row.merchant.trim() : '';
  return name.length > 0 ? name : null;
}

/** Same, but for a body line, where there is always a column to fill. */
function merchantOf(row: ScannedSms, lang: Lang): string {
  return namedMerchant(row) ?? categoryLabel(row.categoryGuess, lang);
}
