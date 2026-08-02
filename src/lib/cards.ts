import { reliableBalanceFils } from '@/lib/balances';
import { toISODate } from '@/lib/format';
import { tf } from '@/lib/i18n';
import type { Account, AppState, CardDue, Transaction } from '@/lib/types';

export type DueStatus = 'overdue' | 'urgent' | 'upcoming' | 'settled';

export interface DueWithStatus {
  due: CardDue;
  status: DueStatus;
  /** Days until dueDate; negative when overdue. */
  daysLeft: number;
  /** What is still owed on this statement after payments. */
  remainingFils: number;
  /** True while payments are below a minimum the bank actually stated. */
  belowMinimum: boolean;
  /** False when the bank never stated a minimum, so `due.minDueFils` is a
   *  fallback estimate rather than a figure. Never present it as one. */
  minimumKnown: boolean;
  /** Long overdue and kept only because no later statement replaced it. */
  stale: boolean;
}

/**
 * How a card is identified, since two account rows can describe one physical
 * card — a hand-added card the SMS scan had already discovered, or state
 * written by an older version.
 *
 * Not the digits alone: a person can hold a FAB and an Emirates NBD card whose
 * last four happen to match, and collapsing those would hide a real statement.
 * But not `bank|last4|type` literally either, which is what this was: one row
 * carries the bank learned from the sender ID and its twin, added by hand,
 * carries none, so `FAB|5793|credit` and `|5793|credit` read as two cards and
 * the statement was listed — and counted — twice.
 *
 * An unknown bank is not a different bank. Rows with no bank name join the one
 * named bank holding those digits; only when TWO banks both have a card ending
 * in those digits is an unnamed row genuinely unattributable, and then it
 * stands alone rather than guessing. Accounts with no digits at all cannot be
 * compared this way and fall back to their own id.
 */
/**
 * The minimum a UAE bank asks for when the statement did not say.
 *
 * A guess, and the app must never present it as the bank's figure — which is
 * what `minDueEstimated` and `minimumKnown` are for. It lives here rather
 * than at the import site because two places that must agree about what an
 * "estimated minimum" IS is exactly the arrangement that goes wrong quietly:
 * change one and the estimate stops matching the thing that decides whether
 * to trust it.
 */
export const ESTIMATED_MINIMUM_RATE = 0.05;

export function estimatedMinimumFils(totalFils: number): number {
  return Math.round(totalFils * ESTIMATED_MINIMUM_RATE);
}

export function cardIdentity(accounts: Account[]): (accountId: string) => string {
  /** last4|type → the distinct bank names seen on those rows. */
  const banks = new Map<string, Set<string>>();
  for (const a of accounts) {
    if (!a.last4) continue;
    const group = `${a.last4}|${a.cardType ?? a.kind}`;
    const seen = banks.get(group) ?? new Set<string>();
    if (a.bankName) seen.add(a.bankName);
    banks.set(group, seen);
  }
  const keys = new Map<string, string>();
  for (const a of accounts) {
    if (!a.last4) {
      keys.set(a.id, `id:${a.id}`);
      continue;
    }
    const group = `${a.last4}|${a.cardType ?? a.kind}`;
    const named = banks.get(group) ?? new Set<string>();
    if (a.bankName) keys.set(a.id, `${a.bankName}|${group}`);
    else if (named.size === 1) keys.set(a.id, `${[...named][0]}|${group}`);
    else if (named.size === 0) keys.set(a.id, `|${group}`);
    else keys.set(a.id, `id:${a.id}`);
  }
  return (accountId: string) => keys.get(accountId) ?? `id:${accountId}`;
}

/**
 * Merge statement rows at the ingestion boundary.
 *
 * A parser-version rescan can see the same reminder again, and several UAE
 * banks send both an issue alert and a due-date reminder. Those are one
 * statement only when the physical card and due date both agree. Distinct due
 * dates remain history; distinct banks that share last-four digits remain
 * distinct cards. Payment evidence is monotonic and is never reset by a
 * reminder whose imported `paidFils` starts at zero.
 */
export function mergeImportedCardDues(
  existing: CardDue[],
  incoming: CardDue[],
  accounts: Account[],
): CardDue[] {
  const keyOf = cardIdentity(accounts);
  const merged: CardDue[] = [];

  for (const due of [...existing, ...incoming]) {
    const key = `${keyOf(due.accountId)}|${due.dueDate}`;
    const at = merged.findIndex((row) => `${keyOf(row.accountId)}|${row.dueDate}` === key);
    if (at < 0) {
      merged.push(due);
      continue;
    }

    const prior = merged[at];
    const priorKnown = !prior.minDueEstimated;
    const nextKnown = !due.minDueEstimated;
    const minimum =
      priorKnown && !nextKnown
        ? prior.minDueFils
        : !priorKnown && nextKnown
          ? due.minDueFils
          : Math.max(prior.minDueFils, due.minDueFils);
    const settledAt = [prior.settledAt, due.settledAt]
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1);

    merged[at] = {
      ...prior,
      totalDueFils: Math.max(prior.totalDueFils, due.totalDueFils),
      minDueFils: minimum,
      minDueEstimated: priorKnown || nextKnown ? undefined : true,
      paidFils: Math.max(prior.paidFils, due.paidFils),
      settledAt,
    };
  }

  return merged;
}

/**
 * Every account row that describes the same physical card as `accountId`.
 *
 * Allocation used to run per account row while the display deduped per card,
 * and the two disagreeing is how a paid card kept reading as owed: the payment
 * SMS landed on one row, the statement sat on its twin, and neither could see
 * the other. The dedupe then kept whichever copy still owed the most — which
 * is always the one the payment never reached.
 */
function cardAccountIds(state: AppState, accountId: string): Set<string> {
  const keyOf = cardIdentity(state.accounts);
  const key = keyOf(accountId);
  const ids = new Set<string>([accountId]);
  for (const a of state.accounts) if (keyOf(a.id) === key) ids.add(a.id);
  return ids;
}

/**
 * Money arriving on a card, whichever direction it was stored in.
 *
 * The income-side transfer is the shape the importer produces today. The
 * expense side is the shape it produced for years: a card payment whose
 * wording the parser did not recognize was imported as an EXPENSE carrying a
 * transfer hint, and `allocatePayments` credited income-side rows only, so
 * those statements could never settle.
 *
 * Those rows cannot heal themselves. `raw` is kept only for rows that look
 * low-confidence, and a transfer hint disqualifies a row from that — so the
 * launch-time re-parse, which reads `raw`, never sees them. They are reachable
 * only by a full inbox re-read, which needs both the message still in the
 * inbox and a PARSER_VERSION bump.
 *
 * Reading them here costs nothing, because on a CREDIT CARD a transfer can
 * only be a payment toward the card: purchases are plain expenses and the
 * bank-side leg of the payment is filed against the bank account, not this
 * one. (A cash transfer out of a card would be misread as a payment. No
 * message in the corpus takes that shape, and one that did would have to have
 * been read as a transfer to get here.)
 */
/**
 * The single eligibility rule for "is this transaction a payment toward this
 * card" — shared by every caller that allocates, totals, or lists payments.
 * `cardStatementView` used to run its own, narrower copy for the payments it
 * *displayed* while `duePaidFils` allocated through this one, so a statement
 * could be marked paid by a compat-branch row that never appeared in the
 * "Payments Made" list and never counted toward `paidTotalFils` — outstanding
 * said settled while the total shown next to it said otherwise.
 */
function isCardPayment(t: Transaction, ids: Set<string>, creditIds: Set<string>): boolean {
  return (
    t.isTransfer === true &&
    ids.has(t.accountId) &&
    (t.type === 'income' ||
      // Older builds stored card payments in the wrong direction. Keep
      // that compatibility path, but only for a row whose title says it
      // is a card settlement. Treating every transfer OUT of a credit card
      // as a payment can falsely settle the bill after a cash transfer.
      (creditIds.has(t.accountId) &&
        /(?:card.*(?:payment|settlement)|(?:payment|settlement).*card)/i.test(t.title)))
  );
}

function cardPaymentsOf(state: AppState, ids: Set<string>): Transaction[] {
  const creditIds = new Set(
    state.accounts.filter((a) => a.cardType === 'credit' && ids.has(a.id)).map((a) => a.id),
  );
  return state.transactions
    .filter((t) => isCardPayment(t, ids, creditIds))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** A card's statements: one per due date, however many rows describe each. */
interface Statement {
  dueDate: string;
  /** The largest figure any copy of this statement quotes. */
  totalFils: number;
  /** Allocated so far — seeded with manual "Mark paid" amounts. */
  paidFils: number;
  /** Date part of settledAt, when the user marked this statement paid. */
  settledOn: string | null;
  dueIds: string[];
}

/**
 * Payments spread across a card's statements, each payment counted once.
 *
 * A due's matching window (~40 days before to 20 after) is wider than the
 * monthly statement cycle, so consecutive statements overlap. Crediting every
 * payment inside the window to each due independently meant one payment could
 * settle two statements at once — the second month's balance silently
 * vanished from the app while it was still owed.
 *
 * Payments are walked oldest-first and poured into the oldest statement they
 * could belong to, so an overpayment still spills onto the next one.
 *
 * Three things the plain window got wrong, all of which read to the user as
 * "I paid this and it still says I owe it":
 *
 *  - The same statement stored twice is two rows with one due date. Pouring
 *    into them in turn split the payment across the copies, and the display
 *    keeps whichever copy owes more — so a fully paid statement showed its
 *    full balance. Copies are one statement here, and share one allocation.
 *
 *  - A statement stops taking payments once the next one has been issued
 *    (~25 days before ITS due date, the same approximation used throughout).
 *    Without that the June statement was still eligible three weeks into July
 *    and swallowed the payment made for the July bill, leaving July unpaid —
 *    and June's balance is inside July's total anyway.
 *
 *  - "Mark paid" on a statement already a month late records the transfer
 *    dated today, which fell outside that statement's window and landed on the
 *    NEXT one instead: one tap settled a statement nobody had paid. A
 *    statement the user marked paid accepts payments up to the day they
 *    marked it.
 */
function allocatePayments(
  state: AppState,
  accountId: string,
  /** Included even when absent from state — callers may hold a due directly. */
  target?: CardDue,
): Map<string, number> {
  const ids = cardAccountIds(state, accountId);
  const known = state.cardDues.filter((d) => ids.has(d.accountId));
  const dues = target && !known.some((d) => d.id === target.id) ? [...known, target] : known;

  const byDate = new Map<string, Statement>();
  for (const d of dues) {
    const s = byDate.get(d.dueDate);
    const settledOn = d.settledAt ? d.settledAt.slice(0, 10) : null;
    if (!s) {
      byDate.set(d.dueDate, {
        dueDate: d.dueDate,
        totalFils: d.totalDueFils,
        paidFils: d.paidFils,
        settledOn,
        dueIds: [d.id],
      });
      continue;
    }
    s.totalFils = Math.max(s.totalFils, d.totalDueFils);
    // Manual "Mark paid" happened once, to the statement, not to each copy.
    s.paidFils = Math.max(s.paidFils, d.paidFils);
    if (settledOn && (!s.settledOn || settledOn > s.settledOn)) s.settledOn = settledOn;
    s.dueIds.push(d.id);
  }
  const statements = [...byDate.values()].sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  for (const payment of cardPaymentsOf(state, ids)) {
    let left = payment.amountFils;
    for (let i = 0; i < statements.length && left > 0; i++) {
      const s = statements[i];
      const outstanding = s.totalFils - s.paidFils;
      if (outstanding <= 0) continue;
      if (payment.date < shiftISO(s.dueDate, -40)) continue;
      let until = shiftISO(s.dueDate, 20);
      const next = statements[i + 1]?.dueDate;
      if (next) {
        const replaced = shiftISO(next, -25);
        if (replaced < until) until = replaced;
      }
      if (s.settledOn && s.settledOn > until) until = s.settledOn;
      if (payment.date > until) continue;
      const take = Math.min(outstanding, left);
      s.paidFils += take;
      left -= take;
    }
  }

  const allocated = new Map<string, number>();
  for (const s of statements) for (const id of s.dueIds) allocated.set(id, s.paidFils);
  return allocated;
}

/**
 * What has been paid toward a due: explicit paidFils (manual "Mark paid")
 * plus its share of the payments made to that CARD — every account row that
 * describes it, not just the row this statement happens to be filed under.
 */
export function duePaidFils(state: AppState, due: CardDue): number {
  return allocatePayments(state, due.accountId, due).get(due.id) ?? due.paidFils;
}

function shiftISO(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function dueWithStatus(
  state: AppState,
  due: CardDue,
  today: Date,
  /** Set by openDues, which knows how long this has been the current one. */
  stale = false,
): DueWithStatus {
  const todayISO = toISODate(today);
  const paid = duePaidFils(state, due);
  const remainingFils = Math.max(0, due.totalDueFils - paid);
  const msPerDay = 86400000;
  const daysLeft = Math.round(
    (new Date(`${due.dueDate}T12:00:00`).getTime() - new Date(`${todayISO}T12:00:00`).getTime()) /
      msPerDay,
  );

  let status: DueStatus;
  if (due.settledAt || remainingFils === 0) status = 'settled';
  else if (daysLeft < 0) status = 'overdue';
  else if (daysLeft <= 3) status = 'urgent';
  else status = 'upcoming';

  // A minimum the bank never stated is an estimate, and "you are under your
  // minimum due" is a claim about the bank's terms. Making that claim from a
  // percentage the app invented tells the user they are about to incur a late
  // fee on a figure no bank ever quoted, so an estimate never triggers it.
  const minimumKnown = !due.minDueEstimated;

  return {
    due,
    status,
    daysLeft,
    remainingFils,
    belowMinimum: minimumKnown && paid < due.minDueFils && status !== 'settled',
    minimumKnown,
    stale: stale && status !== 'settled',
  };
}

/** How long an unpaid due stays actionable before it needs a reason to stay. */
const STALE_OVERDUE_DAYS = 30;

/**
 * Open dues (not settled, on credit cards), most urgent first.
 *
 * A month-old unpaid statement used to be dropped outright, on the theory that
 * the bank had since issued a new one that replaced it. That theory is only
 * true when a newer statement actually exists — and when it did not, the app
 * quietly stopped showing a debt the user still owed, with no trace anywhere
 * that it had decided to stop mentioning it.
 *
 * So the supersession is now checked rather than assumed: an old statement
 * goes only when a later one on the same card has taken over. Otherwise it
 * survives, flagged `stale`, and the caller can present it as old news instead
 * of the app pretending it never happened. Cards that have gone silent
 * altogether are handled by `isInactiveAccount`, not by hiding their debts.
 *
 * The other half of that rule is that supersession is not about age. A card
 * carries one obligation — the newest statement, whose total already contains
 * whatever went unpaid before it. Two open statements on one card was the app
 * charging the user twice for the same money.
 */
export function openDues(state: AppState, today: Date): DueWithStatus[] {
  const creditIds = new Set(
    state.accounts.filter((a) => a.cardType === 'credit' && !a.archived).map((a) => a.id),
  );
  const keyOf = cardIdentity(state.accounts);

  // Latest statement date per card, to tell "replaced" from "still owed".
  const newestByCard = new Map<string, string>();
  for (const d of state.cardDues) {
    const k = keyOf(d.accountId);
    const seen = newestByCard.get(k);
    if (!seen || d.dueDate > seen) newestByCard.set(k, d.dueDate);
  }

  const open = state.cardDues
    .filter((d) => creditIds.has(d.accountId))
    // One card owes one statement. A credit card rolls its unpaid balance into
    // the next statement, so a superseded statement is not a second debt — its
    // total is already inside the newer one, and listing both said the user
    // owed the same money twice. This used to hold only for statements more
    // than 30 days overdue, which let every card with two open rows (two
    // account rows for one card, or a reminder filed under a second due date)
    // count itself twice on Home.
    //
    // The newer statement supersedes whether or not it is settled: what
    // settles it is a payment covering a total that included the older one.
    .filter((d) => (newestByCard.get(keyOf(d.accountId)) ?? d.dueDate) <= d.dueDate)
    .map((d) => {
      const daysLeft = Math.round(
        (new Date(`${d.dueDate}T12:00:00`).getTime() -
          new Date(`${toISODate(today)}T12:00:00`).getTime()) /
          86400000,
      );
      // Nothing replaced it and it is long overdue: kept, but said to be old
      // news rather than passed off as this month's bill.
      return dueWithStatus(state, d, today, daysLeft < -STALE_OVERDUE_DAYS);
    })
    .filter((d) => d.status !== 'settled')
    .sort((a, b) => a.daysLeft - b.daysLeft);

  // One statement, one row. A card has a single statement per due date, so two
  // records that agree on the account and the date are the same statement
  // stored twice — a reminder SMS read as a fresh statement, or state written
  // before importBatch collapsed dues per account. Home was listing the same
  // Emirates NBD statement twice and counting it twice in the total.
  //
  // The larger balance wins: a due and its reminder can disagree, and the one
  // still owing more is the one quoting the fuller total. Payments no longer
  // decide this — copies of one statement share one allocation now, so the two
  // rows only differ in what the bank said they were for.
  //
  // Keyed on the CARD, not the account row. Two account records can describe
  // one physical card — a hand-added card that the SMS scan had already
  // discovered, or state written by an older version — and keying on the
  // account id let both through: Home listed "FAB Credit Card •5793 · 15 Jun ·
  // 8,144" twice, one above the other, and counted it twice in the total.
  const byStatement = new Map<string, DueWithStatus>();
  for (const d of open) {
    const key = `${keyOf(d.due.accountId)}|${d.due.dueDate}`;
    const seen = byStatement.get(key);
    if (!seen || d.remainingFils > seen.remainingFils) byStatement.set(key, d);
  }
  return [...byStatement.values()].sort((a, b) => a.daysLeft - b.daysLeft);
}

/**
 * Everything the card detail sheet shows about one physical card.
 *
 * This lived in the component, which is why it could disagree with the rest of
 * the app without any test noticing: nothing in the harness can load a .tsx.
 * The rules it has to keep are the same ones `openDues` and `allocatePayments`
 * keep, and each of the three was got wrong in the component at least once:
 *
 *  - Scope is the CARD, not the account row. Two rows can describe one card,
 *    and a sheet that took its headline from the card and its list from the
 *    row said "AED 8,144 still owed · 1 open statement" directly above "No
 *    statement yet".
 *  - A payment is credited through `duePaidFils`, which allocates across every
 *    row on the card. A `paidFils` read raw, or a lookup whose key set was
 *    built from a narrower list, shows a settled statement at 0% paid with its
 *    full balance still owed.
 *  - A card carries ONE obligation — the newest statement, whose total already
 *    contains whatever went unpaid before it. Summing the unpaid history
 *    charged the user twice for the same money.
 *
 * Unlike `openDues` this does NOT drop archived accounts. Hiding a card is a
 * statement about the list it appears in, not about the debt; the sheet is
 * reached by opening that very card, and answering 0 there is how a balance
 * disappears with nothing anywhere saying it was dropped.
 */
export interface CardStatementView {
  /** Every statement on this physical card, newest due date first. */
  statements: CardDue[];
  /** Payments onto the card, newest first. */
  payments: Transaction[];
  paidTotalFils: number;
  /** Due id → what has been paid toward it. Covers every row in `statements`. */
  paidByDueId: Map<string, number>;
  /** The single statement the card currently owes, or empty when settled. */
  open: CardDue[];
  outstandingFils: number;
  billedFils: number;
}

export function cardStatementView(state: AppState, accountId: string): CardStatementView {
  const keyOf = cardIdentity(state.accounts);
  const cardKey = keyOf(accountId);

  const statements = state.cardDues
    .filter((d) => keyOf(d.accountId) === cardKey)
    .slice()
    .sort((a, b) => b.dueDate.localeCompare(a.dueDate));

  // Same eligibility rule `duePaidFils`/`allocatePayments` use to decide what
  // has settled a statement, via the shared `cardPaymentsOf`/`isCardPayment`.
  // A second, narrower copy here is how a statement could read "settled" while
  // the payment that settled it was invisible in this very list.
  const ids = cardAccountIds(state, accountId);
  const payments = cardPaymentsOf(state, ids).sort((a, b) => b.date.localeCompare(a.date));

  const paidByDueId = new Map(statements.map((d) => [d.id, duePaidFils(state, d)] as const));

  const newestDueDate = statements[0]?.dueDate;
  const open = statements
    .filter(
      (d) =>
        d.dueDate === newestDueDate && !d.settledAt && (paidByDueId.get(d.id) ?? 0) < d.totalDueFils,
    )
    // Two records agreeing on the card and the date are one statement stored
    // twice; the copy still owing more is the one quoting the fuller total.
    .sort(
      (a, b) =>
        b.totalDueFils -
        (paidByDueId.get(b.id) ?? 0) -
        (a.totalDueFils - (paidByDueId.get(a.id) ?? 0)),
    )
    .slice(0, 1);

  return {
    statements,
    payments,
    paidTotalFils: payments.reduce((s, t) => s + t.amountFils, 0),
    paidByDueId,
    open,
    outstandingFils: open.reduce(
      (s, d) => s + Math.max(0, d.totalDueFils - (paidByDueId.get(d.id) ?? 0)),
      0,
    ),
    billedFils: open.reduce((s, d) => s + d.totalDueFils, 0),
  };
}

/**
 * ISO date of the last known activity on an account: newest transaction or
 * the bank's latest snapshot SMS, whichever is later. Null = no history.
 */
export function accountLastActivityISO(state: AppState, accountId: string): string | null {
  let latest: string | null = null;
  for (const t of state.transactions) {
    if (t.accountId !== accountId) continue;
    if (!latest || t.date > latest) latest = t.date;
  }
  const acc = state.accounts.find((a) => a.id === accountId);
  if (acc?.snapshotTs) {
    const snapISO = toISODate(new Date(acc.snapshotTs));
    if (!latest || snapISO > latest) latest = snapISO;
  }
  return latest;
}

/** No charge and no bank SMS for this long = the card is expired or unused. */
export const DORMANT_AFTER_DAYS = 90;

/**
 * Hidden from the main lists: manually hidden, or silent for months. A
 * full-history scan resurrects every card the user ever owned; the dead ones
 * identify themselves by never texting again. Accounts with no history at all
 * (freshly added by hand) are left alone.
 */
export function isInactiveAccount(state: AppState, account: Account, today: Date): boolean {
  if (account.archived) return true;
  const last = accountLastActivityISO(state, account.id);
  if (!last) return false;
  const silentDays = Math.round(
    (new Date(`${toISODate(today)}T12:00:00`).getTime() - new Date(`${last}T12:00:00`).getTime()) /
      86400000,
  );
  return silentDays > DORMANT_AFTER_DAYS;
}

/** Display name for an auto-created card account. */
export function cardAccountName(last4: string, kind: 'credit' | 'debit' | 'account'): string {
  if (kind === 'credit') return tf('creditCardWithDigits', { last4 });
  if (kind === 'debit') return tf('debitCardWithDigits', { last4 });
  return tf('accountWithDigits', { last4 });
}

const HINT_COLORS = ['#60A5FA', '#F472B6', '#A78BFA', '#FB923C', '#22D3EE', '#4ADE80'];

export function colorForHint(last4: string): string {
  const n = Number(last4) || 0;
  return HINT_COLORS[n % HINT_COLORS.length];
}

/** Bank identity from an SMS sender ID, per the active market pack. */
export { bankFromSender } from '@/lib/markets';

/**
 * A card that was reissued, and the card it is probably a reissue OF.
 *
 * When a UAE bank renews a credit card the account survives and the last four
 * digits change. The app has no notion of that, so the two halves of one card
 * sit as two rows and never meet: the OLD number holds every purchase and
 * payment ever made, and the NEW number holds the statement — because the
 * card is new, so nothing has been spent on it yet.
 *
 * That split is why a statement stays open forever. The due is on a row no
 * payment will ever land on, and the payments are on a row with no due.
 *
 * The signal is simpler than any date arithmetic: a credit-card row that has
 * a STATEMENT but NO TRANSACTIONS AT ALL. Nobody receives a bill for a card
 * they have never spent on. The exception is a card genuinely just opened,
 * which looks identical — which is exactly why this SUGGESTS and never acts.
 * Merging two real cards corrupts the ledger in a way the user cannot see.
 */
export interface ReissueSuggestion {
  /** The row holding the statement and nothing else. */
  newAccountId: string;
  /** The row holding the history, best candidate first. */
  candidateIds: string[];
}

export function reissueSuggestions(state: AppState, today: Date): ReissueSuggestion[] {
  const txCount = new Map<string, number>();
  for (const t of state.transactions) {
    txCount.set(t.accountId, (txCount.get(t.accountId) ?? 0) + 1);
  }
  const hasOpenDue = new Set(openDues(state, today).map((d) => d.due.accountId));

  const out: ReissueSuggestion[] = [];
  for (const a of state.accounts) {
    if (a.cardType !== 'credit' || a.archived) continue;
    // Already answered — the user linked it, or said these are different.
    if (a.renewedFrom) continue;
    if (!hasOpenDue.has(a.id) || (txCount.get(a.id) ?? 0) > 0) continue;

    const candidates = state.accounts
      .filter(
        (b) =>
          b.id !== a.id &&
          b.cardType === 'credit' &&
          !b.archived &&
          // Same bank, or an unknown bank on one side — a hand-added row has
          // no bank name because only the SMS sender teaches the app one.
          (!a.bankName || !b.bankName || a.bankName === b.bankName) &&
          (txCount.get(b.id) ?? 0) > 0,
      )
      // Most recently used first: a card renewed last month is a likelier
      // predecessor than one silent since 2023.
      .sort((x, y) => (accountLastActivityISO(state, y.id) ?? '').localeCompare(accountLastActivityISO(state, x.id) ?? ''))
      .map((b) => b.id);

    if (candidates.length > 0) out.push({ newAccountId: a.id, candidateIds: candidates });
  }
  return out;
}

/**
 * The one figure a card row should lead with.
 *
 * Wallet showed a different quantity depending on what happened to be known:
 * a bank-quoted balance where there was one, this month's spending where
 * there was not — in the same column, at the same weight, distinguished only
 * by a caption underneath. One row read "21,933 per bank SMS" and the row
 * above it "466 spent this month", and nothing about the layout said those
 * were different kinds of number.
 *
 * A credit card leads with what is OWED, because that is what a person opens
 * a wallet to check and the only figure they can act on. In order of
 * authority: the statement still to be paid, then the bank's own outstanding
 * quote. A debit card leads with its balance. Spending belongs on the second
 * line, where it reads as context rather than as money you have.
 */
export type CardFigureKind = 'owed' | 'balance' | 'unknown';

export interface CardFigure {
  kind: CardFigureKind;
  /** Null when nothing authoritative is known — never a guess. */
  fils: number | null;
}

export function cardFigure(state: AppState, account: Account, today: Date): CardFigure {
  if (account.cardType === 'credit') {
    // An open statement is the most useful answer: it is what the bank will
    // take, on a date, and the app knows how much of it is already paid.
    const due = openDues(state, today).find((d) => d.due.accountId === account.id);
    if (due) return { kind: 'owed', fils: due.remainingFils };
    // Failing that, a figure the bank itself quoted as outstanding.
    if (account.snapshotKind === 'outstanding' && account.snapshotFils !== undefined) {
      return { kind: 'owed', fils: Math.abs(account.snapshotFils) };
    }
    // A credit card with nothing owed owes nothing. That is a real answer.
    return { kind: 'owed', fils: 0 };
  }
  const balance = reliableBalanceFils(state, account);
  return balance !== null ? { kind: 'balance', fils: balance } : { kind: 'unknown', fils: null };
}

/**
 * Cards grouped under the bank that issued them, banks ordered by how much is
 * on them.
 *
 * Eleven rows of which six said "FAB Credit Card" was the whole readability
 * problem: nothing told the user whether that was six cards or one card the
 * app had failed to recognise. Under a FAB heading, six FAB cards are
 * obviously six FAB cards — and if that is wrong, it is obviously wrong.
 */
export interface BankGroup {
  bank: string;
  accounts: Account[];
}

export function groupCardsByBank(accounts: Account[]): BankGroup[] {
  const groups = new Map<string, Account[]>();
  for (const a of accounts) {
    // Cards the app has never seen a sender for gather under one heading
    // rather than each inventing a bank of its own.
    const bank = a.bankName?.trim() || 'Other cards';
    groups.set(bank, [...(groups.get(bank) ?? []), a]);
  }
  return [...groups.entries()]
    .map(([bank, list]) => ({ bank, accounts: list }))
    .sort((a, b) => b.accounts.length - a.accounts.length || a.bank.localeCompare(b.bank));
}
