import { bankBrandForName, bankIdentityForName, issuerIdentityForName } from '@/lib/markets';
import { isDeclinedMessage, parseSms } from '@/lib/sms-parser';
import type { Account, AppState, CardDue } from '@/lib/types';

/**
 * Remove structurally empty parser artifacts beside one proven account.
 *
 * One card, two records: Home listed "FAB Credit Card •5793 · 15 Jun · 8,144"
 * twice, one directly above the other, and counted it twice in the total.
 * Reading past it, Wallet counts its balance twice too.
 *
 * Last four digits are not unique, even within one bank, so active siblings
 * are never merged unattended. A row is removable only when its generated
 * name and every financial/reference field prove it is empty, and there is
 * exactly one non-empty target. Ambiguous active siblings stay visible for an
 * explicit user decision.
 */
/**
 * Group token for a row whose bank was never learned.
 *
 * NOT a bank identity, and deliberately unspellable as one: an unattributed
 * row may only ever be compared with another unattributed row. "Unknown bank
 * is not a shared bank" holds in the direction that matters — a row with no
 * sender behind it never folds into a row that names one.
 */
const UNATTRIBUTED = '\u0000no-bank';

export function mergeDuplicateAccounts(state: AppState): AppState {
  // This grouping is intentionally NOT display identity. It crosses card
  // types only so an empty debit fallback can be compared with the substantive
  // credit card it shadows. Known brands stay distinct: Liv and ENBD may share
  // an issuer, but they are separate products and only become link candidates.
  const groups = new Map<string, Account[]>();
  for (const a of state.accounts) {
    // Bank accounts group too, keyed apart from cards. They were excluded
    // outright, so a duplicated "FAB Account •0004" survived every pass — and
    // netWorthFils sums each non-archived account's snapshot, so one duplicated
    // balance was counted twice in the headline figure on Wallet.
    if ((a.kind !== 'card' && a.kind !== 'bank') || !a.last4) continue;
    // Grouped by ISSUER, not brand. A Liv card and an Emirates NBD card with
    // the same last four digits are one piece of plastic described by two
    // sender IDs — one user's ENBD statement sat on one row while the payment
    // clearing it sat on the other, so the balance never settled. The brands
    // stay distinct everywhere the user reads them; this only decides sameness.
    //
    // Rows with no bank at all used to be dropped here. That left a whole
    // duplicated import block — "Credit Card •9417", "Debit Card •6498",
    // "Card •3397", "Account •1712", each present twice with no sender behind
    // either copy — outside every pass, and one of those pairs was a bank
    // account whose AED 0.55 was counted twice in net worth. They now group,
    // under a token that only ever matches another unattributed row, and are
    // folded only on the extra evidence `sameQuotedFigure` demands below.
    const bankIdentity = a.bankName ? issuerIdentityForName(a.bankName) : UNATTRIBUTED;
    if (!bankIdentity) continue;
    const key = `${a.kind}|${bankIdentity}|${a.last4}`;
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  const dupes = [...groups.values()].filter((g) => g.length > 1);
  if (dupes.length === 0) return state;

  const txIds = new Set(state.transactions.map((t) => t.accountId));
  const dueIds = new Set(state.cardDues.map((d) => d.accountId));
  const billIds = new Set(
    (state.bills ?? [])
      .map((b) => b.accountId)
      .filter((id): id is string => Boolean(id)),
  );
  const generatedName = (account: Account): boolean => {
    if (!account.last4) return false;
    const suffixes = [
      `Credit Card •${account.last4}`,
      `Debit Card •${account.last4}`,
      `Card •${account.last4}`,
      `بطاقة ائتمانية •${account.last4}`,
      `بطاقة خصم •${account.last4}`,
      `بطاقة •${account.last4}`,
    ];
    const bankPrefixes = account.bankName
      ? [account.bankName, bankBrandForName(account.bankName)?.name].filter(
          (name): name is string => Boolean(name),
        )
      : [];
    const allowed = [
      ...suffixes,
      ...bankPrefixes.flatMap((bank) => suffixes.map((suffix) => `${bank} ${suffix}`)),
    ];
    return allowed.includes(account.name.trim());
  };
  const isEmptyArtifact = (account: Account): boolean =>
    account.kind === 'card' &&
    generatedName(account) &&
    account.openingFils === 0 &&
    account.snapshotFils === undefined &&
    account.snapshotKind === undefined &&
    account.snapshotTs === undefined &&
    account.creditLimitFils === undefined &&
    account.renewedFrom === undefined &&
    !account.archived &&
    !txIds.has(account.id) &&
    !dueIds.has(account.id) &&
    !billIds.has(account.id);

  /** old account id → surviving account id */
  const remap = new Map<string, string>();
  const dropped = new Set<string>();
  /**
   * Identity a real card or account cannot share with a different one: same
   * kind, same card type, same last four, same issuer — AND the same displayed
   * name.
   *
   * The name is load-bearing and was briefly dropped from this key so that a
   * sub-brand row ("Liv Credit Card •8575") could fold into its issuer's
   * ("Emirates NBD Credit Card •8575"), which differ by construction. Dropping
   * it folded far more than intended: two genuinely different FAB cards ending
   * 3749 became one and an entire AED 500 statement was discarded rather than
   * merged, because computeOpenDues keeps one row per (account, dueDate).
   *
   * So the name stays, and the sub-brand case is handled by
   * `sameCardAcrossBrands` below, which is allowed to ignore the name only
   * when the two rows differ in BRAND while sharing an issuer — and only when
   * both names are the generated "<Bank> <Card noun> •<last4>" shape, never a
   * name a human chose.
   */
  const identityOf = (a: Account): string =>
    [
      a.kind,
      a.cardType ?? '-',
      a.last4 ?? '-',
      issuerIdentityForName(a.bankName) ?? '-',
      a.name.trim().toLowerCase(),
    ].join('|');

  /**
   * One card described by two brands of the same issuer — Liv and Emirates
   * NBD. Both names must be generated, because a name the user or the bank
   * chose ("FAB Cashback Card") is a statement that these are different
   * products.
   */
  const sameCardAcrossBrands = (a: Account, b: Account): boolean =>
    a.kind === 'card' &&
    b.kind === 'card' &&
    a.cardType === b.cardType &&
    a.last4 === b.last4 &&
    bankIdentityForName(a.bankName) !== bankIdentityForName(b.bankName) &&
    issuerIdentityForName(a.bankName) === issuerIdentityForName(b.bankName) &&
    generatedName(a) &&
    generatedName(b);

  /**
   * Positive evidence that two rows are two INSTRUMENTS, not one recorded
   * twice: statements falling due on the same day for different totals. One
   * card cannot owe two different amounts on one date.
   */
  /**
   * The extra evidence an UNATTRIBUTED pair has to produce before it folds.
   *
   * With no bank and a generated name, "same kind, same type, same last four"
   * is merging on the last four digits alone — which is exactly what the Wio
   * •8026 / FAB •8026 pair proves is not enough. What separates one import
   * block read twice from two real cards is that both copies were built from
   * the SAME messages, so the bank's quoted figure on them is identical: same
   * kind of figure, same fils, or none on either.
   *
   * That also makes the fold lossless for the case that went wrong before. A
   * survivor keeps one snapshot; when the two agreed, nothing a bank ever said
   * is dropped, and net worth loses exactly the duplicate it was double
   * counting. Two rows quoting DIFFERENT figures are two instruments — or at
   * minimum, evidence this app cannot throw away — and stay split.
   */
  const sameQuotedFigure = (rows: Account[]): boolean =>
    rows.every(
      (r) => r.snapshotKind === rows[0].snapshotKind && r.snapshotFils === rows[0].snapshotFils,
    );

  const contradict = (rows: Account[]): boolean => {
    const byDate = new Map<string, number>();
    for (const r of rows) {
      for (const d of state.cardDues) {
        if (d.accountId !== r.id) continue;
        const seen = byDate.get(d.dueDate);
        if (seen !== undefined && seen !== d.totalDueFils) return true;
        byDate.set(d.dueDate, d.totalDueFils);
      }
    }
    return false;
  };

  for (const group of dupes) {
    // Every row in a group is attributed or none is — the key holds the
    // issuer. Unattributed rows are admitted for ONE purpose: folding two
    // copies of the same import block. They never take part in artifact
    // deletion, because "empty" plus "same last four" plus no bank on either
    // side is not enough to say a row shadows the one beside it — an empty
    // "Debit Card •5793" may be a different institution's card entirely.
    const attributed = Boolean(group[0].bankName);
    const substantive = group.filter((a) => !isEmptyArtifact(a));

    // The ordinary case: one real row, the rest are empty artifacts.
    if (attributed && substantive.length === 1) {
      const keep = substantive[0];
      for (const artifact of group) {
        if (artifact.id === keep.id || !isEmptyArtifact(artifact)) continue;
        remap.set(artifact.id, keep.id);
        dropped.add(artifact.id);
      }
      continue;
    }

    // Several rows look real. That is normally ambiguous and left alone — but
    // an account list can be duplicated wholesale, and then BOTH copies carry
    // a balance snapshot, so neither is an empty artifact and the group was
    // skipped forever. One user's Wallet showed "FAB Account •0004  AED
    // 423,545" twice and a net worth inflated by the second copy.
    //
    // Rows identical on every identifying field are folded together. The
    // survivor is the one the bank spoke to most recently, so the newest
    // quoted balance is the one that stands.
    const byIdentity = new Map<string, Account[]>();
    for (const a of substantive) {
      // A sub-brand row joins its issuer's bucket despite the differing name.
      const twin = [...byIdentity.values()]
        .flat()
        .find((b) => sameCardAcrossBrands(a, b));
      const key = twin ? identityOf(twin) : identityOf(a);
      byIdentity.set(key, [...(byIdentity.get(key) ?? []), a]);
    }
    for (const clones of byIdentity.values()) {
      if (clones.length < 2) continue;
      // Two statements owed on one date for different totals is two cards.
      if (contradict(clones)) continue;
      // An unattributed pair needs more than matching digits, and may never
      // put two statement-carrying rows at risk of collapsing to one: the last
      // time a merge went one step too far it discarded an AED 500 statement,
      // because computeOpenDues keeps one row per (account, dueDate).
      if (!clones[0].bankName) {
        if (!sameQuotedFigure(clones)) continue;
        if (clones.filter((c) => dueIds.has(c.id)).length > 1) continue;
      }
      // Prefer the row filed under the ISSUER itself over a sub-brand: the
      // card is an Emirates NBD card that Liv also talks about, and its
      // statements name Emirates NBD. Then the most recently quoted balance.
      const isIssuerBrand = (a: Account) =>
        bankIdentityForName(a.bankName) === issuerIdentityForName(a.bankName);
      const keep = [...clones].sort(
        (a, b) =>
          Number(isIssuerBrand(b)) - Number(isIssuerBrand(a)) ||
          (b.snapshotTs ?? 0) - (a.snapshotTs ?? 0) ||
          a.id.localeCompare(b.id),
      )[0];
      for (const clone of clones) {
        if (clone.id === keep.id) continue;
        remap.set(clone.id, keep.id);
        dropped.add(clone.id);
      }
    }
    // Empty artifacts alongside an unambiguous survivor still fold in.
    if (!attributed) continue;
    const survivors = substantive.filter((a) => !dropped.has(a.id));
    if (survivors.length !== 1) continue;
    for (const artifact of group) {
      if (artifact.id === survivors[0].id || dropped.has(artifact.id)) continue;
      if (!isEmptyArtifact(artifact)) continue;
      remap.set(artifact.id, survivors[0].id);
      dropped.add(artifact.id);
    }
  }
  if (dropped.size === 0) return state;
  const to = (id: string) => remap.get(id) ?? id;

  return {
    ...state,
    accounts: state.accounts.filter((a) => !dropped.has(a.id)),
    transactions: state.transactions.map((t) =>
      remap.has(t.accountId) ? { ...t, accountId: to(t.accountId) } : t,
    ),
    cardDues: state.cardDues.map((d) =>
      remap.has(d.accountId) ? { ...d, accountId: to(d.accountId) } : d,
    ),
    bills: (state.bills ?? []).map((b) =>
      b.accountId && remap.has(b.accountId) ? { ...b, accountId: to(b.accountId) } : b,
    ),
    accountHints: Object.fromEntries(
      Object.entries(state.accountHints ?? {}).map(([last4, id]) => [last4, to(id)]),
    ),
  };
}

/**
 * One statement, filed against two different cards of the same issuer.
 *
 * A real ledger held these, to the fils, from FAB:
 *
 *   •5793  total 7,880.11  min 394.01  due 2026-06-26
 *   •3749  total 7,880.11  min 394.01  due 2026-06-26
 *   •5793  total 8,144.40  min 407.22  due 2026-07-06
 *   •4499  total 8,144.40  min 407.22  due 2026-07-06
 *   •5793  total 8,908.80  min 445.44  due 2026-08-05
 *   •3324  total 8,908.80  min 445.44  due 2026-08-05
 *
 * •5793 is not a card. It has no purchase, no payment and no ledger row of any
 * kind, and it carries statements from two DIFFERENT billing cycles — the 6th
 * and the 27th of the month — which one piece of plastic cannot do. •3749,
 * •4499 and •3324 each hold the payment that clears their copy. So one FAB
 * message quotes a number that is not the card's last four, and every
 * statement it names is booked a second time against a card that does not
 * exist. The payment settles the real copy and the phantom copy stays open
 * forever: the user was told they still owed AED 5,645.07 they had already
 * paid, on a card with no history at all.
 *
 * `mergeDuplicateAccounts` cannot see this — the two rows differ in last four,
 * which is the one field it will never merge across. So the STATEMENT moves
 * rather than the account: nothing is deleted, both card rows survive for the
 * user to reconcile, and the obligation ends up on the card whose payments can
 * settle it. `mergeImportedCardDues` and `computeOpenDues` then collapse the
 * two copies the way they already collapse one statement stored twice.
 *
 * The bar for calling two dues one statement is deliberately at the ceiling:
 * same issuer, same due date, the same total AND the same minimum to the fils,
 * both minimums STATED by the bank (a 5% estimate is this app's guess and
 * would make any two same-total statements look identical), and exactly one of
 * the two cards has a ledger row of any kind. Anything less and both stay.
 */
export function repairDuplicateStatements(state: AppState): AppState {
  const byAccount = new Map<string, Account>(state.accounts.map((a) => [a.id, a]));
  const hasHistory = new Set(state.transactions.map((t) => t.accountId));

  const groups = new Map<string, CardDue[]>();
  for (const due of state.cardDues) {
    if (due.minDueEstimated) continue;
    const account = byAccount.get(due.accountId);
    if (account?.kind !== 'card' || account.cardType !== 'credit') continue;
    const issuer = issuerIdentityForName(account.bankName);
    if (!issuer) continue;
    const key = `${issuer}|${due.dueDate}|${due.totalDueFils}|${due.minDueFils}`;
    groups.set(key, [...(groups.get(key) ?? []), due]);
  }

  /** due id → the card it really belongs to */
  const move = new Map<string, string>();
  for (const dues of groups.values()) {
    const accountIds = [...new Set(dues.map((d) => d.accountId))];
    if (accountIds.length < 2) continue;
    const evidenced = accountIds.filter((id) => hasHistory.has(id));
    // No card here has any history, or more than one does. Either way this is
    // not one statement and a phantom; it is two obligations the app cannot
    // tell apart, and hiding one of them is the expensive mistake.
    if (evidenced.length !== 1) continue;
    for (const due of dues) {
      if (due.accountId !== evidenced[0]) move.set(due.id, evidenced[0]);
    }
  }
  if (move.size === 0) return state;

  return {
    ...state,
    cardDues: state.cardDues.map((d) =>
      move.has(d.id) ? { ...d, accountId: move.get(d.id) as string } : d,
    ),
  };
}

/**
 * Repair card-payment rows whose own title and attached account disagree.
 *
 * Older parser versions could understand "Card •3749 payment" only after the
 * row had already been stored against FAB •3324. Healing fixed its direction
 * but left accountId untouched, so the right card never settled. The title's
 * digits come from the masked PAN in the bank message; reassignment is safe
 * only when exactly one credit card at the same bank carries those digits.
 */
export function repairCardPaymentAccounts(state: AppState): AppState {
  let changed = false;
  const transactions = state.transactions.map((tx) => {
    if (tx.source !== 'sms' || tx.userEdited || !tx.isTransfer) return tx;
    const named = tx.title.match(/\bcard\s*•?(\d{4})\s*(?:payment|settlement)\b/i);
    if (!named) return tx;
    const current = state.accounts.find((a) => a.id === tx.accountId);
    if (
      current?.kind === 'card' &&
      current.cardType === 'credit' &&
      current.last4 === named[1]
    ) return tx;
    if (!current?.bankName) return tx;
    const currentBank = bankIdentityForName(current.bankName);
    if (!currentBank) return tx;
    const candidates = state.accounts.filter(
      (a) =>
        a.kind === 'card' &&
        a.cardType === 'credit' &&
        a.last4 === named[1] &&
        a.bankName !== undefined &&
        bankIdentityForName(a.bankName) === currentBank,
    );
    if (candidates.length !== 1) return tx;
    changed = true;
    return { ...tx, accountId: candidates[0].id };
  });
  return changed ? { ...state, transactions } : state;
}

/**
 * Fold a reissued card's predecessor into it, on the user's say-so.
 *
 * The survivor is the NEW number, because that is the card in their wallet
 * and the one the next statement will name. The old row's history moves
 * across, so the payments made under the old digits and the statement issued
 * under the new ones finally sit on the same card — which is the whole point:
 * until they do, the due can never be settled by any payment.
 *
 * Deliberately separate from `mergeDuplicateAccounts`. That one removes only
 * structurally empty generated artifacts beside one substantive target. This
 * one acts on a guess the user confirmed, and must never run by itself.
 */
/**
 * Delete ledger rows imported from a DECLINED transaction alert.
 *
 * A refused transaction moved no money. One user's ledger carries 59 rows
 * titled "Insufficient Funds" totalling AED 89,897 — every one of them a
 * direct-debit refusal an older parser read as a purchase, and every one of
 * them counted against their spending.
 *
 * Nothing else can reach them. A rescan HEALS rows it re-reads, but healPatch
 * only ever ADDS information — there is no patch that means "this never
 * happened" — and a message the parser now suppresses is dropped in
 * auto-import.ts before the import planner sees it, so the stale-misread sweep
 * that already exists for bill reminders and card statements never gets its
 * fingerprint. Without a migration these rows survive every future scan
 * forever.
 *
 * Deleting user data needs evidence, so a row goes only when ALL of these hold:
 *
 *  - it came from SMS and still carries its `raw` body. No text, no evidence:
 *    a manual entry, an iOS relay row (which discards the body by design) and
 *    a private-mode ledger keep every row they have.
 *  - `userEdited` is false. A row the user corrected is theirs.
 *  - the parser's own refusal test fires on that raw text — `isDeclinedMessage`
 *    reads the SMS, never the title. "Insufficient Funds" is a legal trade
 *    name, and deleting on the title would take a real shop's charge with it.
 *  - `parseSms` now returns nothing for it, so a CURRENT parser demonstrably
 *    would not have created this row. Required IN ADDITION to the refusal test,
 *    because a decline word can sit in a message that really did move money:
 *    an insufficient-balance FEE is money that left the account.
 *    And required only in addition, never alone — `raw` is stored as a
 *    300-character EXCERPT, and a body truncated before its amount parses to
 *    null for reasons that have nothing to do with the transaction being real.
 *    Truncation can hide a refusal; it cannot invent one.
 *  - it is not a transfer. Card settlements are what `allocatePayments` and
 *    `internalTransferIds` reconcile against, and this is the same guard the
 *    existing stale-misread sweep uses. A decline alert should never produce
 *    one; if one exists, leaving it costs nothing, since transfers are already
 *    outside the spending totals.
 *  - it carries no `splits`. A split is hand-built allocation.
 *
 * Nothing persisted holds a transaction id — bills key on account, card dues
 * derive what has been paid from the ledger at read time, and
 * `internalTransferIds` recomputes per render — so removal leaves nothing
 * pointing at a row that no longer exists. Auto-detected BILLS are left alone
 * deliberately: one exists only because the user tapped to create it, which
 * makes it a user decision rather than parser output.
 *
 * Cheap enough for every hydrate: `raw` survives only on rows the parser was
 * unsure about (145 of 14,314 in the reference ledger), so the parse runs on a
 * fraction of a percent of the rows and every other row costs four field
 * reads. Idempotent, and returns the SAME state object when it removes nothing.
 */
export function removeDeclinedTransactions(state: AppState): AppState {
  const doomed = new Set<string>();
  for (const tx of state.transactions) {
    if (tx.source !== 'sms' || tx.userEdited || tx.isTransfer || tx.splits) continue;
    const raw = tx.raw;
    if (!raw) continue;
    // The parser's own refusal test, on the SMS text — never on the title.
    if (!isDeclinedMessage(raw)) continue;
    // ...and a current parser would not create this row from that text.
    if (parseSms(raw)) continue;
    doomed.add(tx.id);
  }
  if (doomed.size === 0) return state;
  return { ...state, transactions: state.transactions.filter((t) => !doomed.has(t.id)) };
}

export function mergeRenewedCard(state: AppState, oldId: string, newId: string): AppState {
  const older = state.accounts.find((a) => a.id === oldId);
  const newer = state.accounts.find((a) => a.id === newId);
  if (!older || !newer || oldId === newId) return state;

  const to = (id: string) => (id === oldId ? newId : id);
  const snapshotSource =
    (older.snapshotTs ?? 0) > (newer.snapshotTs ?? 0) ? older : newer;
  const snapshotKind =
    newer.cardType === 'credit' && snapshotSource.snapshotKind === 'balance'
      ? 'limit'
      : snapshotSource.snapshotKind;
  return {
    ...state,
    accounts: state.accounts
      .filter((a) => a.id !== oldId)
      .map((a) =>
        a.id === newId
          ? {
              ...a,
              renewedFrom: oldId,
              // Keep whatever the older row knew that the new one does not:
              // the bank name comes from an SMS sender, and a brand-new card
              // may not have had one yet.
              bankName: a.bankName ?? older.bankName,
              openingFils: a.openingFils + older.openingFils,
              creditLimitFils: a.creditLimitFils ?? older.creditLimitFils,
              ...(snapshotSource.snapshotFils !== undefined
                ? {
                    snapshotFils: snapshotSource.snapshotFils,
                    snapshotKind,
                    snapshotTs: snapshotSource.snapshotTs,
                  }
                : {}),
            }
          : a,
      ),
    transactions: state.transactions.map((t) =>
      t.accountId === oldId ? { ...t, accountId: newId } : t,
    ),
    cardDues: state.cardDues.map((d) => (d.accountId === oldId ? { ...d, accountId: newId } : d)),
    bills: (state.bills ?? []).map((b) =>
      b.accountId === oldId ? { ...b, accountId: newId } : b,
    ),
    accountHints: Object.fromEntries(
      Object.entries(state.accountHints).map(([last4, id]) => [last4, to(id)]),
    ),
  };
}

/** Record that these two are NOT the same card, so the app stops asking. */
export function markCardsDistinct(state: AppState, accountId: string): AppState {
  return {
    ...state,
    accounts: state.accounts.map((a) =>
      a.id === accountId ? { ...a, renewedFrom: a.id } : a,
    ),
  };
}
