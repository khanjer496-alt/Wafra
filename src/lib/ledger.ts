import type { Account, Transaction } from '@/lib/types';

/**
 * What counts as money moving, asked once.
 *
 * This existed in at least four different spellings across analytics.ts,
 * insights.ts, bills.ts, subscriptions.ts, wallet.tsx and three sheets:
 *
 *   t.type !== 'expense' || t.isTransfer
 *   t.isTransfer                              (no type check at all)
 *   !t.isTransfer && inPeriod(...)
 *   t.isTransfer && t.type === 'income'
 *
 * They agreed by luck, not by construction, and one of them silently didn't:
 * archiving an account removed its balance from Wallet and its history from
 * net worth, but its spending went on counting in Home's Out, in Flow's
 * categories and against budgets. Hiding a card half-hid it.
 *
 * Every screen that adds money up now asks these functions instead.
 */

/** Accounts whose rows still count. Pass this to the predicates below. */
export function liveAccountIds(accounts: Account[]): Set<string> {
  return new Set(accounts.filter((a) => !a.archived).map((a) => a.id));
}

/**
 * A transfer is the app moving money between the user's own pockets — a card
 * payment, a savings sweep. Real, and already counted once as the purchase it
 * settles, so counting it again would double the month.
 */
export function isTransfer(t: Transaction): boolean {
  return t.isTransfer === true;
}

/**
 * Does this row belong in a spending or income total?
 *
 * `live` is optional so callers working from a bare transaction list (tests,
 * the importer) still get the transfer rule. Every screen with the accounts
 * to hand should pass it, or a hidden account keeps spending your money.
 */
export function countsInTotals(
  t: Transaction,
  live?: Set<string>,
  internal?: Set<string>,
): boolean {
  if (isTransfer(t)) return false;
  if (live && !live.has(t.accountId)) return false;
  // Both halves of a move between your own accounts. See internalTransferIds.
  if (internal?.has(t.id)) return false;
  return true;
}

/** Spending: an expense that is not a transfer, on an account still in play. */
export function isSpending(t: Transaction, live?: Set<string>, internal?: Set<string>): boolean {
  return t.type === 'expense' && countsInTotals(t, live, internal);
}

/** Income: money arriving from outside, not shuffled between own accounts. */
export function isIncome(t: Transaction, live?: Set<string>, internal?: Set<string>): boolean {
  return t.type === 'income' && countsInTotals(t, live, internal);
}

/**
 * The money-in leg of a transfer — a payment landing ON a card.
 *
 * The mirror image of the rule above, and the one thing that must NOT be
 * filtered out as "just a transfer": card settlement depends on finding it.
 */
export function isInboundTransfer(t: Transaction): boolean {
  return isTransfer(t) && t.type === 'income';
}

/**
 * Money you moved between your own accounts, matched by its two halves.
 *
 * A bank sends one message for each side of an internal transfer: AED 19,000
 * leaves •0002 and AED 19,000 arrives in •0004. Neither message says the
 * other exists, and the arriving one reads exactly like being paid — so it
 * was counted as income, and the same 19,000 the user already had appeared as
 * money earned. Their June "In" carried 24,000 of their own savings.
 *
 * The wording cannot settle this; only the pairing can. An amount that leaves
 * one of your accounts and arrives in another within a few days is one
 * movement told twice.
 *
 * Deliberately strict, because a wrong pair hides real income:
 *  - the exact same amount to the fils
 *  - two DIFFERENT accounts, both the user's own
 *  - within three days, for a transfer that clears overnight
 *  - each row pairs once, so three 500s do not all cancel one
 */
export function internalTransferIds(
  transactions: Transaction[],
  accountIds: Set<string>,
): Set<string> {
  const paired = new Set<string>();
  const outgoing = new Map<number, Transaction[]>();
  for (const t of transactions) {
    if (
      t.type !== 'expense' ||
      !accountIds.has(t.accountId) ||
      // Amount + date is correlation, not proof. The old matcher admitted
      // every purchase here, so an AED 500 grocery run could cancel an AED
      // 500 client payment on another account. Require the parser's transfer
      // flag, or one of the narrow structural titles stored by older builds.
      !(
        t.isTransfer === true ||
        /^(?:outgoing|bank|own account|self|savings) transfer$/i.test(t.title.trim())
      )
    ) continue;
    const list = outgoing.get(t.amountFils);
    if (list) list.push(t);
    else outgoing.set(t.amountFils, [t]);
  }

  const DAY = 86400000;
  for (const t of transactions) {
    if (
      t.type !== 'income' ||
      t.isTransfer ||
      !accountIds.has(t.accountId) ||
      t.category === 'salary' ||
      // A salary, refund or client invoice can coincidentally equal a sweep.
      // Only an arrival the bank itself described as a transfer is eligible.
      !/^(?:(?:incoming|bank|own account|self) transfer|inward remittance)$/i.test(
        t.title.trim(),
      )
    ) continue;
    const candidates = outgoing.get(t.amountFils);
    if (!candidates) continue;
    const arrived = t.ts ?? Date.parse(`${t.date}T12:00:00Z`);
    const match = candidates
      .filter(
        (o) =>
          !paired.has(o.id) &&
          o.accountId !== t.accountId &&
          Math.abs((o.ts ?? Date.parse(`${o.date}T12:00:00Z`)) - arrived) <= 3 * DAY,
      )
      // Repeated equal transfers are common. Pair the nearest alert, not the
      // first row in whatever display sort happened to reach this function.
      .sort(
        (a, b) =>
          Math.abs((a.ts ?? Date.parse(`${a.date}T12:00:00Z`)) - arrived) -
          Math.abs((b.ts ?? Date.parse(`${b.date}T12:00:00Z`)) - arrived),
      )[0];
    if (!match) continue;
    paired.add(match.id);
    paired.add(t.id);
  }
  return paired;
}
