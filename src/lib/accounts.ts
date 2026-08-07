import { bankBrandForName, bankIdentityForName, issuerIdentityForName } from '@/lib/markets';
import type { Account, AppState } from '@/lib/types';

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
export function mergeDuplicateAccounts(state: AppState): AppState {
  // This grouping is intentionally NOT display identity. It crosses card
  // types only so an empty debit fallback can be compared with the substantive
  // credit card it shadows. Known brands stay distinct: Liv and ENBD may share
  // an issuer, but they are separate products and only become link candidates.
  const groups = new Map<string, Account[]>();
  for (const a of state.accounts) {
    // Unknown bank is not a shared bank. Two unattributed rows with the same
    // four digits could belong to entirely different institutions.
    //
    // Bank accounts group too, keyed apart from cards. They were excluded
    // outright, so a duplicated "FAB Account •0004" survived every pass — and
    // netWorthFils sums each non-archived account's snapshot, so one duplicated
    // balance was counted twice in the headline figure on Wallet.
    if ((a.kind !== 'card' && a.kind !== 'bank') || !a.last4 || !a.bankName) continue;
    // Grouped by ISSUER, not brand. A Liv card and an Emirates NBD card with
    // the same last four digits are one piece of plastic described by two
    // sender IDs — one user's ENBD statement sat on one row while the payment
    // clearing it sat on the other, so the balance never settled. The brands
    // stay distinct everywhere the user reads them; this only decides sameness.
    const bankIdentity = issuerIdentityForName(a.bankName);
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
    const substantive = group.filter((a) => !isEmptyArtifact(a));

    // The ordinary case: one real row, the rest are empty artifacts.
    if (substantive.length === 1) {
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
