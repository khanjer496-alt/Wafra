import { cardAccountName, colorForHint, estimatedMinimumFils } from '@/lib/cards';
import { bankBrandForName, bankFromSender, bankIdentityForName } from '@/lib/markets';
import { duplicateGuard } from '@/lib/dedupe';
import { toISODate } from '@/lib/format';
import { healPatch } from '@/lib/heal';
import { STRUCTURAL_TITLES, type ParsedSms } from '@/lib/sms-parser';
import type { CaptureChannel } from '@/lib/dedupe';
import type { Account, AppState, CardDue, ImportBatchInput, Transaction, TxHealUpdate } from '@/lib/types';


/**
 * Turning scanned messages into an importable batch.
 *
 * Split out of auto-import.ts for one reason: that file imports react-native
 * and so cannot be transpiled by the test harness. This is the code that
 * decides whether a message the user already has counts as new — the code
 * whose failure mode is the ledger quietly gaining a second copy of a charge
 * — and it had no test at all. dedupe.ts was carved out for exactly this
 * reason and did not go far enough: the fingerprints were tested, the
 * decision that uses them was not.
 *
 * Nothing here touches a native module.
 */

export type ScannedSms = Omit<ParsedSms, 'raw'> & {
  /** Present only when parsing happened locally; relay rows discard the body. */
  raw?: string;
  smsTs?: number;
  sender?: string;
  channel?: CaptureChannel;
  /** Structured settlement side survives server raw-body discard on iOS. */
  cardPaymentSide?: 'debit' | 'receipt';
  /** Relay-only origin. It must never be inferred from the wake itself. */
  captureSource?: 'shortcut' | 'email' | 'pdf';
};

export interface ImportPlan {
  batch: ImportBatchInput;
  txCount: number;
  newAccountCount: number;
  dueCount: number;
  /** Already-imported rows the parser now reads better (renamed/recategorized). */
  healedCount: number;
  billDues: ScannedSms[];
}



/**
 * Nothing to import, and nothing learned.
 *
 * lastScanTs stays at 0 on purpose. Advancing the watermark here would mark
 * messages as read that were never actually compared against anything, and
 * a message is only ever offered once.
 */
function emptyPlan(): ImportPlan {
  return {
    batch: {
      transactions: [],
      newAccounts: [],
      newHints: {},
      newDues: [],
      snapshots: {},
      bankNames: {},
      cardTypes: {},
      lastScanTs: 0,
      updates: [],
    },
    txCount: 0,
    newAccountCount: 0,
    dueCount: 0,
    healedCount: 0,
    billDues: [],
  };
}

/**
 * Turns parsed messages into a single importable batch:
 * maps card hints to accounts (auto-creating unseen cards), skips duplicates,
 * converts card payments to transfers, and statements to card dues.
 */
export function buildImportPlan(
  parsed: ScannedSms[],
  state: AppState,
  newestTs: number,
  today: Date = new Date(),
): ImportPlan {
  // An unhydrated store is not an empty ledger, it is an unknown one — and
  // every duplicate check below is a lookup against `state.transactions`.
  //
  // A user pulled to refresh while AsyncStorage was still loading and the
  // screen was showing zeros. Nothing matched anything, so the whole inbox
  // imported as new; hydration then landed and restored the rows that were
  // already there, on top of the copies just made. Their entire history
  // doubled. The auto-import on Home waits for hydration; pull-to-refresh did
  // not, and neither did the manual importer, so the guard belongs here where
  // every caller has to pass through it.
  if (!state.hydrated) return emptyPlan();

  // A full-history scan surfaces statements from years back; only dues still
  // near their pay-by date are live obligations worth tracking.
  const staleDueCutoff = toISODate(new Date(today.getTime() - 45 * 86400000));
  // Three fingerprints, because the same transaction can reach us through
  // three capture channels. See dedupe.ts for why one is not enough.
  const guard = duplicateGuard(state.transactions);
  // Existing SMS rows by fingerprint, for rescan healing: a message that
  // dedupes but now parses BETTER upgrades its old row instead of being lost.
  const priorBySmsKey = new Map<string, Transaction>();
  const priorById = new Map<string, Transaction>();
  for (const t of state.transactions) {
    priorById.set(t.id, t);
    if (t.smsKey && t.source === 'sms') priorBySmsKey.set(t.smsKey, t);
  }
  const updates: TxHealUpdate[] = [];
  const healFromReparse = (
    smsKey: string | undefined,
    p: ScannedSms,
    resolvedAccountId?: string,
    cardPaymentSide?: 'debit' | 'receipt',
  ) => {
    const prior = smsKey ? priorBySmsKey.get(smsKey) : undefined;
    if (!prior || prior.userEdited) return;
    // Older rows predate structured settlement sides. Pass the side resolved
    // from either the parser field or the Android-only raw fallback so a
    // reparse can make persisted one-to-one settlement reconciliation work.
    const patch = healPatch(
      prior,
      cardPaymentSide ? { ...p, cardPaymentSide } : p,
    );
    const accountChanged =
      resolvedAccountId !== undefined && resolvedAccountId !== prior.accountId;
    if (patch || accountChanged) {
      updates.push({
        ...(patch ?? { id: prior.id }),
        ...(accountChanged ? { accountId: resolvedAccountId } : {}),
      });
    }
  };
  const smsKeyOf = (p: ScannedSms): string | undefined =>
    p.smsTs !== undefined ? `s${p.smsTs}-${p.amountFils}` : undefined;
  // Newest bank-quoted balance/limit per account — even from messages whose
  // transaction is already imported (rescans refresh the figures).
  const snapshots: ImportBatchInput['snapshots'] = {};
  const hints: Record<string, string> = { ...state.accountHints };
  const newAccounts: Omit<Account, 'id'>[] = [];
  const newHints: Record<string, string> = {};
  const transactions: Omit<Transaction, 'id'>[] = [];
  const newDues: Omit<CardDue, 'id'>[] = [];
  const billDues: ScannedSms[] = [];
  const fallbackAccountId = state.accounts[0]?.id ?? '';

  // Bank identity per account, learned from SMS sender IDs (existing accounts
  // that predate this get theirs backfilled).
  const bankNames: Record<string, string> = {};
  const cardTypes: NonNullable<ImportBatchInput['cardTypes']> = {};
  type ResolvedCardKind = 'credit' | 'debit' | 'account' | 'unknown';
  interface AccountResolution {
    accountId: string;
    /** False when multiple compatible accounts made attribution unsafe. */
    confident: boolean;
  }
  const hintKey = (bankName: string | undefined, last4: string, kind: string) =>
    `${bankName ?? '?'}|${kind}|${last4}`;
  const unassignedCardRef = (
    bankName: string | undefined,
    last4: string,
    kind: ResolvedCardKind,
  ): string =>
    `__unassigned-card__:${bankName ? bankIdentityForName(bankName) : 'unknown'}:${kind}:${last4}`;
  const accountAtRef = (
    ref: string,
  ): Pick<Account, 'kind' | 'cardType' | 'last4' | 'bankName' | 'name'> | undefined => {
    if (/^\d+$/.test(ref)) return newAccounts[Number(ref)];
    return state.accounts.find((a) => a.id === ref);
  };
  const effectiveCardType = (
    ref: string,
    account: Pick<Account, 'cardType'> | undefined = accountAtRef(ref),
  ): Account['cardType'] => cardTypes[ref] ?? account?.cardType;
  const matchesCard = (
    ref: string,
    account: Pick<Account, 'kind' | 'cardType' | 'last4' | 'bankName'> | undefined,
    last4: string,
    kind: ResolvedCardKind,
    bankName: string | undefined,
  ): boolean => {
    if (!account || account.last4 !== last4) return false;
    if (kind === 'account') {
      if (account.kind !== 'bank') return false;
    } else {
      if (account.kind !== 'card') return false;
      const effectiveType = effectiveCardType(ref, account);
      if (kind !== 'unknown' && effectiveType !== undefined && effectiveType !== kind) {
        return false;
      }
    }
    // A missing bank can be learned from this sender. A different known bank
    // cannot: last four digits are not globally unique.
    return (
      !bankName ||
      !account.bankName ||
      bankIdentityForName(account.bankName) === bankIdentityForName(bankName)
    );
  };
  const accountCandidates = () => [
    ...state.accounts.map((account) => ({ ref: account.id, account })),
    ...newAccounts.map((account, index) => ({ ref: String(index), account })),
  ];
  const isGeneratedUnknownHolding = (
    ref: string,
    account: Pick<Account, 'kind' | 'cardType' | 'last4' | 'bankName' | 'name'>,
    last4: string,
  ): boolean => {
    if (account.kind !== 'card' || effectiveCardType(ref, account) !== undefined) return false;
    const suffixes = [`Card •${last4}`, `بطاقة •${last4}`];
    const prefixes = account.bankName
      ? [account.bankName, bankBrandForName(account.bankName)?.name].filter(
          (name): name is string => Boolean(name),
        )
      : [];
    return [
      ...suffixes,
      ...prefixes.flatMap((prefix) => suffixes.map((suffix) => `${prefix} ${suffix}`)),
    ].includes(account.name.trim());
  };
  const resolveAccount = (
    p: ScannedSms,
    ambiguousFallbackAccountId?: string,
    refuseAmbiguous = false,
  ): AccountResolution => {
    if (!p.card) return { accountId: fallbackAccountId, confident: true };
    const { last4 } = p.card;
    // The parser owns card-kind evidence, including Arabic forms such as
    // Mada. Reinterpreting its structured result from English-only raw-text
    // heuristics silently downgraded explicit Arabic debit cards to unknown.
    const kind = p.card.kind as ResolvedCardKind;
    const bank = bankFromSender(p.sender);
    const scoped = hintKey(bank?.name, last4, kind);
    const noteType = (ref: string) => {
      if (kind === 'account' || kind === 'unknown') return;
      const known = effectiveCardType(ref);
      // A statement or payment's explicit credit evidence is stronger than a
      // purchase alert whose missing type made the parser fall back to debit.
      if (kind === 'credit' || known !== 'credit') cardTypes[ref] = kind;
      if (kind === 'credit' && snapshots[ref]?.kind === 'balance') {
        snapshots[ref] = { ...snapshots[ref], kind: 'limit' };
      }
    };
    const resolved = (ref: string, confident = true): AccountResolution => {
      if (confident) {
        hints[scoped] = ref;
        newHints[scoped] = ref;
      }
      // Bank identity is learned only from an unambiguous attribution. A
      // reused legacy holding is deliberately non-confident; stamping the SMS
      // sender onto it would make later resolver passes treat that guess as
      // established identity.
      if (bank && confident) bankNames[ref] ??= bank.name;
      noteType(ref);
      return { accountId: ref, confident };
    };
    const compatible = accountCandidates().filter(({ ref, account }) =>
      matchesCard(ref, account, last4, kind, bank?.name));
    // Explicit type evidence may safely choose the sole account already known
    // to have that type. Untyped candidates remain upgradeable only when no
    // typed account exists.
    const typedCompatible =
      kind === 'credit' || kind === 'debit'
        ? compatible.filter(({ ref, account }) => effectiveCardType(ref, account) === kind)
        : [];
    const eligible = typedCompatible.length > 0 ? typedCompatible : compatible;
    // A legacy last4-only hint cannot distinguish two real same-bank cards.
    // Every hint, including a scoped one, is accepted only when it names the
    // sole compatible account in current state plus this batch.
    const hintKeys = kind === 'unknown' ? [scoped] : [scoped, last4];
    for (const key of hintKeys) {
      const ref = hints[key];
      if (!ref || !matchesCard(ref, accountAtRef(ref), last4, kind, bank?.name)) continue;
      if (eligible.length === 1 && eligible[0].ref === ref) return resolved(ref);
    }
    const existing = eligible.length === 1 ? eligible[0] : undefined;
    if (existing) {
      hints[last4] = existing.ref;
      newHints[last4] = existing.ref;
      return resolved(existing.ref);
    }
    // A reparse of an existing row may learn the PAN while still finding two
    // real compatible cards. Preserve its current account rather than moving
    // it to an arbitrary hinted row or minting a third account solely for a
    // deduped message.
    if (eligible.length > 1 && ambiguousFallbackAccountId !== undefined) {
      return { accountId: ambiguousFallbackAccountId, confident: false };
    }
    if (kind === 'unknown' && eligible.length > 1) {
      const holdings = eligible.filter(({ ref, account }) =>
        isGeneratedUnknownHolding(ref, account, last4));
      if (holdings.length > 0) {
        // Old builds could already have produced several generic buckets.
        // Reuse one stable bucket so every later alert cannot mint another;
        // this is routing, not proof that the legacy rows are one real card.
        const holding = [...holdings].sort((a, b) => a.ref.localeCompare(b.ref))[0];
        return resolved(holding.ref, false);
      }
    }
    if (eligible.length > 1 && refuseAmbiguous) {
      return { accountId: '', confident: false };
    }
    // Explicit evidence still cannot identify one of two real cards that
    // share bank, type and suffix. Preserve a money event against a stable,
    // deliberately non-account ref instead of either guessing a real card or
    // dropping the event while the scan watermark advances. The ref includes
    // only parser-proven identity, is never added to Accounts, and deliberately
    // bypasses resolved() so no hint, bank-name, card-type, or snapshot
    // backfill can turn this staging bucket into an asserted attribution.
    // Statements opt into refuseAmbiguous above because an unattached due is
    // not a ledger event; transactions and card payments must be lossless.
    if (kind !== 'unknown' && eligible.length > 1) {
      return {
        accountId: unassignedCardRef(bank?.name, last4, kind),
        confident: false,
      };
    }
    // Auto-create; reference by index until the store assigns real ids.
    const idx = newAccounts.length;
    newAccounts.push({
      name: bank
        ? `${bank.name} ${cardAccountName(last4, kind)}`
        : cardAccountName(last4, kind),
      kind: kind === 'credit' || kind === 'debit' || kind === 'unknown' ? 'card' : 'bank',
      cardType: kind === 'credit' ? 'credit' : kind === 'debit' ? 'debit' : undefined,
      last4,
      bankName: bank?.name,
      openingFils: 0,
      color: bank?.color ?? colorForHint(last4),
    });
    const ref = String(idx);
    const confident = eligible.length === 0;
    if (confident) {
      hints[last4] = ref;
      newHints[last4] = ref;
    }
    return resolved(ref, confident);
  };

  const noteSnapshot = (accountRef: string, p: ScannedSms) => {
    if (p.snapshotFils === null || !p.snapshotKind || p.smsTs === undefined || !accountRef) return;
    const knownType = cardTypes[accountRef] ?? accountAtRef(accountRef)?.cardType;
    // When a credit-card purchase omitted the word "credit", the parser saw a
    // debit card and called "Avl Bal" a cash balance. Once account resolution
    // knows the instrument is credit, that figure is available headroom.
    const kind = knownType === 'credit' && p.snapshotKind === 'balance' ? 'limit' : p.snapshotKind;
    const cur = snapshots[accountRef];
    if (!cur || p.smsTs > cur.ts) {
      snapshots[accountRef] = { fils: p.snapshotFils, kind, ts: p.smsTs };
    }
  };

  const cardPaymentSideOf = (p: ScannedSms): 'debit' | 'receipt' | undefined => {
    if (p.cardPaymentSide) return p.cardPaymentSide;
    if (p.kind !== 'cardPayment' || !p.raw) return undefined;
    if (
      /payment\s+instructions?|(?:debited|deducted)\b[\s\S]*towards?\s+(?:the\s+)?(?:payment|settlement|repayment)/i.test(
        p.raw,
      )
    ) return 'debit';
    if (
      /(?:payment|amount)\b[\s\S]*(?:received|credited)|received\s+payment|has\s+been\s+paid|thank you for (?:your )?payment/i.test(
        p.raw,
      )
    ) return 'receipt';
    return undefined;
  };

  // Prefer the fuller SMS when a notification and SMS for one event are in
  // the same scan. Processing a slightly-earlier push first used to leave the
  // guard with no persisted id to supersede, so both rows were appended.
  const ordered = [
    ...parsed.filter((p) => p.channel !== 'push'),
    ...parsed.filter((p) => p.channel === 'push'),
  ];

  for (const p of ordered) {
    const date = p.date ?? toISODate(new Date());
    if (p.kind === 'billDue') {
      if (p.merchant !== 'Bill payment') billDues.push(p);
      continue;
    }
    if (p.kind === 'cardStatement') {
      // A due reminder previously mis-imported as a fake expense gets
      // dropped now that the parser recognizes what it is.
      const staleKey = smsKeyOf(p);
      const misread = staleKey ? priorBySmsKey.get(staleKey) : undefined;
      if (misread && !misread.isTransfer && !misread.userEdited) {
        updates.push({ id: misread.id, remove: true });
      }
      if (!p.date) continue;
      if (p.date < staleDueCutoff) continue;
      const statementBank = bankFromSender(p.sender);
      const bankOnlyCandidates = !p.card && statementBank
        ? accountCandidates().filter(
            ({ ref, account }) =>
              account.kind === 'card' &&
              effectiveCardType(ref, account) === 'credit' &&
              account.bankName !== undefined &&
              bankIdentityForName(account.bankName) ===
                bankIdentityForName(statementBank.name),
          )
        : [];
      // A statement without a PAN is useful only when its authenticated sender
      // identifies exactly one credit card. Otherwise keep it staged rather
      // than inventing a card or turning the quoted due into a transaction.
      if (!p.card && bankOnlyCandidates.length !== 1) continue;
      const bankOnlyAccountId = bankOnlyCandidates[0]?.ref;
      const matchingDues = state.cardDues.filter(
        (due) =>
          due.dueDate === p.date &&
          due.totalDueFils === p.amountFils &&
          (p.card
            ? matchesCard(
                due.accountId,
                accountAtRef(due.accountId),
                p.card.last4,
                p.card.kind as ResolvedCardKind,
                statementBank?.name,
              )
            : due.accountId === bankOnlyAccountId),
      );
      const dueAccounts = [...new Set(matchingDues.map((due) => due.accountId))];
      // Two matching obligations are already ambiguous; another reminder is
      // not evidence for choosing one or inventing a third card.
      if (dueAccounts.length > 1) continue;
      const accountId = p.card
        ? resolveAccount(p, dueAccounts[0], true).accountId
        : bankOnlyAccountId ?? '';
      if (!accountId) continue;
      noteSnapshot(accountId, p);
      const existingDue = matchingDues.find((due) => due.accountId === accountId);
      const improvesMinimum =
        existingDue !== undefined &&
        p.minDueFils !== null &&
        (existingDue.minDueEstimated === true || existingDue.minDueFils !== p.minDueFils);
      // A parser-version rescan of an identical obligation is idempotent. A
      // newly authoritative minimum is the one reason to re-offer it to the
      // reducer's monotonic due merge.
      if (existingDue && !improvesMinimum) continue;
      // The parser reaches this branch only with statement structure and
      // forces card.kind=credit. That is authoritative evidence which upgrades
      // a debit fallback; rejecting it is what stranded real statements.
      newDues.push({
        accountId,
        totalDueFils: p.amountFils,
        // 5% is a common UAE card minimum, but it is not this card's minimum
        // unless the bank said so. Kept as a placeholder for the progress
        // bar's sake, flagged so nothing quotes it back as a figure.
        minDueFils: p.minDueFils ?? estimatedMinimumFils(p.amountFils),
        minDueEstimated: p.minDueFils === null ? true : undefined,
        dueDate: p.date,
        paidFils: 0,
      });
      continue;
    }
    if (p.kind === 'cardPayment') {
      const smsKey = smsKeyOf(p);
      const prior = smsKey ? priorBySmsKey.get(smsKey) : undefined;
      const resolution = resolveAccount(p, prior?.accountId);
      const { accountId } = resolution;
      if (!accountId) continue;
      if (resolution.confident) noteSnapshot(accountId, p);
      const cardPaymentSide = cardPaymentSideOf(p);
      // A card payment lands as income into the card account.
      const candidate = {
        date, amountFils: p.amountFils, title: p.merchant,
        type: 'income' as const, smsKey, ts: p.smsTs, channel: p.channel,
        accountId, eventKind: 'cardPayment' as const, cardPaymentSide,
      };
      if (guard.has(candidate)) {
        // A row imported as a plain expense before this message was
        // recognized as a card payment becomes a transfer now.
        healFromReparse(
          smsKey,
          p,
          resolution.confident ? accountId : undefined,
          cardPaymentSide,
        );
        continue;
      }
      guard.add(candidate);
      transactions.push({
        type: 'income', // money arriving INTO the card account
        amountFils: p.amountFils,
        category: 'other',
        accountId,
        title: p.merchant,
        date,
        ts: p.smsTs,
        source: 'sms',
        smsKey,
        cardPaymentSide,
        isTransfer: true,
      });
      continue;
    }
    // Plain transaction. transferHint = the bank-side leg of a card payment /
    // own-account transfer: keep it for balances, exclude it from spending.
    const smsKey = smsKeyOf(p);
    const prior = smsKey ? priorBySmsKey.get(smsKey) : undefined;
    const captureCandidate = {
      date, amountFils: p.amountFils, title: p.merchant,
      type: p.type, smsKey, ts: p.smsTs, channel: p.channel,
      eventKind: 'transaction' as const,
    };
    const protectedSupersededId = guard.supersedes(captureCandidate);
    if (protectedSupersededId && priorById.get(protectedSupersededId)?.userEdited) {
      // The fuller SMS still proves the notification was a duplicate, but it
      // must not overwrite the user's corrected title/category/account.
      guard.add(captureCandidate);
      continue;
    }
    const resolution = resolveAccount(p, prior?.accountId);
    const { accountId } = resolution;
    if (!accountId) continue;
    if (resolution.confident) noteSnapshot(accountId, p);
    const candidate = { ...captureCandidate, accountId };
    if (guard.has(candidate)) {
      healFromReparse(smsKey, p, resolution.confident ? accountId : undefined);
      continue;
    }
    // The same charge already in the ledger from a bank-app notification.
    // The SMS is the better read, so it rewrites that row rather than
    // becoming a second one.
    const supersededId = guard.supersedes(candidate);
    if (supersededId) {
      if (!priorById.get(supersededId)?.userEdited) {
        updates.push({
          id: supersededId,
          title: p.merchant,
          category: p.categoryGuess,
          type: p.type,
          accountId,
          ts: p.smsTs,
          smsKey,
          viaPush: false,
        });
      }
      guard.add(candidate);
      continue;
    }
    guard.add(candidate);
    // Low-confidence rows keep their source text so the user can report
    // unrecognized bank formats from Settings → Improve accuracy.
    // Structurally-understood rows (ATM, VAT, transfers...) stay out.
    // `categoryDeliberate` is the difference between "other" as an answer and
    // "other" as a shrug. Brokerages and crypto on-ramps are mapped to other on
    // purpose; without this the report asked the user to send in formats the
    // parser reads perfectly, which is most of what a 177-entry export was.
    const lowConfidence =
      !p.transferHint &&
      p.type === 'expense' &&
      (p.merchant === 'Card purchase' ||
        (p.categoryGuess === 'other' &&
          !p.categoryDeliberate &&
          !STRUCTURAL_TITLES.has(p.merchant)));
    transactions.push({
      type: p.type,
      amountFils: p.amountFils,
      originalAmountMinor: p.originalAmountMinor,
      originalCurrency: p.originalCurrency,
      fxRate: p.fxRate,
      fxSource: p.fxSource,
      category: p.categoryGuess,
      accountId,
      title: p.merchant,
      date,
      ts: p.smsTs,
      source: 'sms',
      smsKey,
      viaPush: p.channel === 'push' || undefined,
      isTransfer: p.transferHint || undefined,
      // Relay/email/PDF ingestion deliberately discards the source body
      // before this device sees the structured row. Keep a diagnostic excerpt
      // only on Android's local parser path, where one actually exists.
      raw: lowConfidence ? p.raw?.slice(0, 300) : undefined,
    });
  }

  // A balance may have been noted while the card kind was still unknown and
  // authoritative credit evidence may have arrived later in the same batch.
  for (const [ref, type] of Object.entries(cardTypes)) {
    if (type === 'credit' && snapshots[ref]?.kind === 'balance') {
      snapshots[ref] = { ...snapshots[ref], kind: 'limit' };
    }
  }

  return {
    batch: { transactions, newAccounts, newHints, newDues, snapshots, bankNames, cardTypes, lastScanTs: newestTs, updates },
    txCount: transactions.length,
    newAccountCount: newAccounts.length,
    dueCount: newDues.length,
    healedCount: updates.length,
    billDues,
  };
}
