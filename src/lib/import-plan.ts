import { cardAccountName, colorForHint, estimatedMinimumFils } from '@/lib/cards';
import {
  bankBrandForName,
  bankFromSender,
  bankIdentityForName,
  bankFromName,
} from '@/lib/markets';
import { duplicateGuard } from '@/lib/dedupe';
import { toISODate } from '@/lib/format';
import { healPatch } from '@/lib/heal';
import {
  isNonPostingMessage,
  overrideFitsDirection,
  STRUCTURAL_TITLES,
  type NonPostingReason,
  type ParsedSms,
} from '@/lib/sms-parser';
import type { CaptureChannel } from '@/lib/dedupe';
import type { Account, AppState, Bill, CardDue, ImportBatchInput, Transaction, TxHealUpdate } from '@/lib/types';


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
  captureSource?: 'shortcut' | 'email' | 'pdf' | 'csv';
  /** Launch pack that produced this body-free relay row. */
  market?: 'AE' | 'SA';
  /**
   * Opaque, locally generated identity for one provider-backed message.
   *
   * The iOS Shortcut hashes the Message GUID before Wafra sees it; Android
   * prefixes the stable inbox row id. Keeping either value in smsKey makes a
   * repeated history import exactly idempotent without persisting the body.
   */
  sourceEventId?: string;
};

/**
 * A message the scan affirmatively identified as non-posted.
 *
 * Only identity metadata travels. The body is tested against the parser's own
 * `nonPostingReason` at the point it is read (auto-import.ts) and then dropped,
 * so nothing that is not already a fingerprint leaves the scanner.
 *
 * This exists because the evidence for deleting a declined row is at SCAN
 * time and used to be thrown away. `parseSms` returns null for a decline, so
 * the message vanished from `parsed` and the planner never learned that the
 * inbox still holds, at that exact millisecond, an alert saying the money
 * never moved. The ledger migration in accounts.ts can only use a row's
 * STORED `raw`, and raw retention is recent: one real user has 59 decline
 * rows worth AED 89,897 and not one of them carries a body. The inbox does.
 */
export interface DeclinedSms {
  /** The SMS/notification timestamp, the same one `smsKey` is built from. */
  smsTs: number;
  sender?: string;
  channel?: CaptureChannel;
  /** Closed evidence class; optional for older relay/history callers. */
  reason?: NonPostingReason;
  /** Opaque GUID-derived identity when the decline came from iOS history. */
  sourceEventId?: string;
}

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
      newBills: [],
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
 * Currency proof for deferred onboarding plans must come from the alert, not
 * the device locale or active parser fallback. A local-currency amount has no
 * `originalCurrency`; a foreign-only charge does, so it cannot silently pin
 * AED/SAR from the current pack.
 */
function confirmedLedgerCurrency(rows: readonly ScannedSms[]): 'AED' | 'SAR' | undefined {
  const observed = new Set<'AED' | 'SAR'>();
  for (const row of rows) {
    if (row.currency !== 'AED' && row.currency !== 'SAR') continue;
    if (row.originalCurrency && row.originalCurrency !== row.currency) continue;
    observed.add(row.currency);
  }
  return observed.size === 1 ? [...observed][0] : undefined;
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
  /**
   * Messages this same scan read and the parser refused as declines. Optional
   * and last on purpose: `today` predates it and several callers pass it
   * positionally, and the two capture pipes that cannot supply declines (the
   * relay, which never sees a body, and the onboarding scan, which runs
   * against an empty ledger) are correct with the default.
   */
  declined: DeclinedSms[] = [],
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
  /**
   * Stable identity for a local SMS across parser money corrections.
   *
   * The legacy key is `s{provider timestamp}-{parsed amount}`. That made a
   * parser-version reread unsafe: correcting an amount (or updating an
   * offline FX fallback) changed the key, so the same retained Message was
   * appended beside its old row. The provider timestamp is the only stable
   * identity older Android rows retained. Use it only when it is unique on
   * both sides, belongs to a local SMS capture, is date-plausible, and any
   * retained source text agrees byte-for-byte. Historical Shortcut timestamps
   * are rounded and therefore stay on their GUID-derived `h...` identity.
   */
  const rowTimestamp = (t: Transaction): number | undefined => {
    if (Number.isFinite(t.ts)) return t.ts;
    const match = t.smsKey?.match(/^s(\d+)-/);
    return match ? Number(match[1]) : undefined;
  };
  const rowsByTimestamp = new Map<number, Transaction[]>();
  for (const t of state.transactions) {
    if (t.source !== 'sms') continue;
    const ts = rowTimestamp(t);
    if (ts === undefined) continue;
    const bucket = rowsByTimestamp.get(ts);
    if (bucket) bucket.push(t);
    else rowsByTimestamp.set(ts, [t]);
  }
  const parsedTimestampCounts = new Map<number, number>();
  for (const p of parsed) {
    if (p.sourceEventId || p.channel === 'push' || !Number.isFinite(p.smsTs)) continue;
    parsedTimestampCounts.set(p.smsTs!, (parsedTimestampCounts.get(p.smsTs!) ?? 0) + 1);
  }
  const stableLocalPrior = (p: ScannedSms): Transaction | undefined => {
    if (p.sourceEventId || p.channel === 'push' || !Number.isFinite(p.smsTs)) return undefined;
    if (parsedTimestampCounts.get(p.smsTs!) !== 1) return undefined;
    const rows = rowsByTimestamp.get(p.smsTs!);
    if (!rows || rows.length !== 1) return undefined;
    const prior = rows[0];
    if (p.raw !== undefined && prior.raw !== undefined && p.raw !== prior.raw) return undefined;
    const messageDate = Date.parse(`${p.date ?? toISODate(new Date(p.smsTs!))}T12:00:00Z`);
    if (!Number.isFinite(messageDate) || Math.abs(messageDate - p.smsTs!) > 7 * 86400000) {
      return undefined;
    }
    return prior;
  };
  const updates: TxHealUpdate[] = [];
  const healFromReparse = (
    smsKey: string | undefined,
    p: ScannedSms,
    resolvedAccountId?: string,
    cardPaymentSide?: 'debit' | 'receipt',
    stablePrior?: Transaction,
  ) => {
    const prior = (smsKey ? priorBySmsKey.get(smsKey) : undefined) ?? stablePrior;
    // A hand-entered row may explain one bank alert for duplicate prevention,
    // but it is never parser-owned. Do not attach parser roles or move it to a
    // guessed account during a later inbox re-read.
    if (!prior || prior.source !== 'sms' || prior.userEdited) return;
    // Older rows predate structured settlement sides. Pass the side resolved
    // from either the parser field or the Android-only raw fallback so a
    // reparse can make persisted one-to-one settlement reconciliation work.
    const patch = healPatch(
      prior,
      cardPaymentSide ? { ...p, cardPaymentSide } : p,
    );
    const accountChanged =
      resolvedAccountId !== undefined && resolvedAccountId !== prior.accountId;
    const instrumentProven =
      resolvedAccountId !== undefined &&
      p.paymentFlowSide === 'receipt' &&
      p.card != null &&
      prior.paymentInstrumentSource !== 'alert';
    if (patch || accountChanged || instrumentProven) {
      updates.push({
        ...(patch ?? { id: prior.id }),
        ...(accountChanged ? { accountId: resolvedAccountId } : {}),
        ...(instrumentProven ? { paymentInstrumentSource: 'alert' as const } : {}),
      });
    }
  };
  const promoteMatchedHistory = (
    matchedId: string,
    smsKey: string,
    p: ScannedSms,
    resolvedAccountId?: string,
    cardPaymentSide?: 'debit' | 'receipt',
  ) => {
    const prior = priorById.get(matchedId);
    if (!prior) return;
    // A hand-entered row may explain one bank alert, but the history importer
    // must not rewrite the user's category/direction or attach an SMS identity
    // to a row whose source remains manual.
    if (prior.source !== 'sms') return;
    // The existing row is still indexed by its legacy s-key, so looking it up
    // through the incoming h-key cannot heal it. Build one combined update;
    // the reducer intentionally keeps only the last patch for a row id.
    const patch = prior.userEdited
      ? null
      : healPatch(prior, cardPaymentSide ? { ...p, cardPaymentSide } : p);
    const accountChanged =
      !prior.userEdited &&
      resolvedAccountId !== undefined &&
      resolvedAccountId !== prior.accountId;
    const identityChanged =
      prior.smsKey !== smsKey || prior.ts !== p.smsTs || prior.viaPush === true;
    const instrumentProven =
      !prior.userEdited &&
      resolvedAccountId !== undefined &&
      p.paymentFlowSide === 'receipt' &&
      p.card != null &&
      prior.paymentInstrumentSource !== 'alert';
    if (!patch && !accountChanged && !identityChanged && !instrumentProven) return;
    updates.push({
      ...(patch ?? { id: matchedId }),
      ...(accountChanged ? { accountId: resolvedAccountId } : {}),
      ...(instrumentProven ? { paymentInstrumentSource: 'alert' as const } : {}),
      smsKey,
      ts: p.smsTs,
      viaPush: false,
    });
  };
  const smsKeyOf = (p: ScannedSms): string | undefined =>
    p.sourceEventId
      ? `h${p.sourceEventId}`
      : p.smsTs !== undefined
        ? `s${p.smsTs}-${p.amountFils}`
        : undefined;
  // Newest bank-quoted balance/limit per account — even from messages whose
  // transaction is already imported (rescans refresh the figures).
  const snapshots: ImportBatchInput['snapshots'] = {};
  const hints: Record<string, string> = { ...state.accountHints };
  const newAccounts: Omit<Account, 'id'>[] = [];
  const newHints: Record<string, string> = {};
  const transactions: Omit<Transaction, 'id'>[] = [];
  const newDues: Omit<CardDue, 'id'>[] = [];
  const newBills: Omit<Bill, 'id' | 'paidMonths'>[] = [];
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
    // A message that spells out its issuer ("Emirates NBD Credit Card Mini
    // Stmt for Card ending 8575") is STATING the bank; a sender ID only
    // suggests one. That distinction is the only thing that can separate two
    // real cards sharing their last four digits at different banks — one user
    // holds a Liv card and an ENBD card both ending 8575, and payments were
    // settling against the wrong one.
    const bank = (p.bankHint ? bankFromName(p.bankHint) : null) ?? bankFromSender(p.sender);
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

  // The user's own category rules, re-applied to rows this device did not
  // parse.
  //
  // On Android the rule is honoured inside the parser: scanInbox passes
  // `state.merchantOverrides` to parseSms, and guessCategory returns the
  // user's answer with `deliberate: true`. On iOS the parse happens in the
  // Cloudflare Worker, which calls parseSms with no overrides at all — and it
  // must stay that way. Shipping the user's category vocabulary to the relay
  // would put "talabat → groceries" on a server whose entire design is that it
  // holds nothing about the user and keeps nothing after acknowledgement.
  //
  // So the rule is applied here instead, on arrival. Without it, the entry
  // sheet's "just future" was a permanent no-op on iOS: recategorise Talabat
  // to Groceries and every later Talabat charge still landed in Dining, with
  // the user redoing the same correction forever.
  //
  // The discriminator is `raw`. A locally-parsed row always carries the source
  // text (`ParsedSms.raw` is required, and parseSms always fills it); a relay
  // row cannot, because the Worker discards Message Content before sealing —
  // `ParsedRelayRow` is typed `raw?: never` for exactly that reason. Skipping
  // rows that have it is what keeps Android from being run through a second,
  // redundant lookup on a merchant name the parser has already resolved.
  //
  // Rows already in the ledger are not this function's business: an override
  // reaches an existing row only through the two paths below that both refuse
  // to touch `userEdited`, which is what the sheet's "just future" means.
  const overrides = state.merchantOverrides ?? {};
  const applyMerchantOverride = (p: ScannedSms): ScannedSms => {
    if (p.raw !== undefined) return p;
    const hit = overrides[p.merchant.trim().toLowerCase()];
    if (!hit || hit === p.categoryGuess) return p;
    // The SAME direction check `categoryOf` makes, because this is the same
    // decision taken on the other platform. Without it a Talabat refund
    // arriving over the relay was filed `dining` — a category the entry sheet
    // will not draw for a credit, so the row's real category is invisible to
    // the person who opens it. `overrideFitsDirection` states why.
    if (!overrideFitsDirection(hit, p.type)) return p;
    // `categoryDeliberate` is what the parser sets on an override hit, and it
    // is load-bearing in both directions: it keeps the row out of the
    // low-confidence accuracy report, and it is the flag heal.ts requires
    // before a rescan may correct a stored category that is not `other`.
    //
    // `categoryPinned` is the narrower fact — this category is the USER's, not
    // ours — and heal.ts needs it to know not to treat the row as one the
    // parser learned to read. Set here for the same reason `categoryOf` sets
    // it on the Android path: it is the same pin, applied a step later.
    return { ...p, categoryGuess: hit, categoryDeliberate: true, categoryPinned: true };
  };

  // Prefer the fuller SMS when a notification and SMS for one event are in
  // the same scan. Processing a slightly-earlier push first used to leave the
  // guard with no persisted id to supersede, so both rows were appended.
  const ordered = [
    ...parsed.filter((p) => p.channel !== 'push'),
    ...parsed.filter((p) => p.channel === 'push'),
  ].map(applyMerchantOverride);

  for (const p of ordered) {
    const date = p.date ?? toISODate(new Date());
    if (p.kind === 'billDue') {
      // Same stale-misread sweep the cardStatement branch does below, and it
      // was missing here — so a reminder the old parser had booked as a real
      // expense stayed in the ledger forever after the parser learned to read
      // it. healPatch cannot help: it rewrites a row, it cannot delete one,
      // and there is no patch that turns an expense into "this never
      // happened". The user who reported it carried twelve AED 775.81 e&
      // charges for bills that were only ever due.
      const staleKey = smsKeyOf(p);
      const misread = (staleKey ? priorBySmsKey.get(staleKey) : undefined) ?? stableLocalPrior(p);
      if (misread && !misread.isTransfer && !misread.userEdited) {
        updates.push({ id: misread.id, remove: true });
      }
      // A full Android reread and a multi-year iOS history search must not
      // silently resurrect a utility account the user left years ago as a new
      // recurring bill. Only a current reminder becomes a live obligation.
      const historicalBillDate = p.date ?? (
        Number.isFinite(p.smsTs) ? toISODate(new Date(p.smsTs!)) : null
      );
      const staleOrUndatedBill = !historicalBillDate || historicalBillDate < staleDueCutoff;
      if (
        p.merchant !== 'Bill payment' &&
        !staleOrUndatedBill
      ) billDues.push(p);
      continue;
    }
    if (p.kind === 'cardStatement') {
      // A due reminder previously mis-imported as a fake expense gets
      // dropped now that the parser recognizes what it is.
      const staleKey = smsKeyOf(p);
      const misread = (staleKey ? priorBySmsKey.get(staleKey) : undefined) ?? stableLocalPrior(p);
      if (misread && !misread.isTransfer && !misread.userEdited) {
        updates.push({ id: misread.id, remove: true });
      }
      if (!p.date) continue;
      if (p.date < staleDueCutoff) continue;
      const statementBank = (p.bankHint ? bankFromName(p.bankHint) : null) ?? bankFromSender(p.sender);
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
      const removesWrongMarketEstimate =
        existingDue !== undefined &&
        p.currency === 'SAR' &&
        p.minDueFils === null &&
        existingDue.minDueEstimated === true &&
        existingDue.minDueFils !== 0;
      // A parser-version rescan of an identical obligation is idempotent. A
      // newly authoritative minimum, or removing the old UAE-only 5% fallback
      // from a Saudi due, is the reason to re-offer it to the reducer's
      // monotonic due merge.
      if (existingDue && !improvesMinimum && !removesWrongMarketEstimate) continue;
      // The parser reaches this branch only with statement structure and
      // forces card.kind=credit. That is authoritative evidence which upgrades
      // a debit fallback; rejecting it is what stranded real statements.
      newDues.push({
        accountId,
        totalDueFils: p.amountFils,
        // 5% is a common UAE card minimum, but it is not this card's minimum
        // unless the bank said so. A Saudi statement gets no UAE-derived
        // placeholder at all. Both remain flagged so nothing quotes an
        // unstated value back as the bank's figure.
        minDueFils:
          p.minDueFils ?? (p.currency === 'AED' ? estimatedMinimumFils(p.amountFils) : 0),
        minDueEstimated: p.minDueFils === null ? true : undefined,
        dueDate: p.date,
        paidFils: 0,
      });
      continue;
    }
    if (p.kind === 'cardPayment') {
      const smsKey = smsKeyOf(p);
      const exactPrior = smsKey ? priorBySmsKey.get(smsKey) : undefined;
      const stablePrior = exactPrior ?? stableLocalPrior(p);
      const prior = stablePrior;
      const resolution = resolveAccount(p, prior?.accountId);
      const { accountId } = resolution;
      if (!accountId) continue;
      if (resolution.confident) noteSnapshot(accountId, p);
      const cardPaymentSide = cardPaymentSideOf(p);
      if (!exactPrior && stablePrior) {
        healFromReparse(
          undefined,
          p,
          resolution.confident ? accountId : undefined,
          cardPaymentSide,
          stablePrior,
        );
        continue;
      }
      // A card payment lands as income into the card account.
      const candidate = {
        date, amountFils: p.amountFils, title: p.merchant,
        type: 'income' as const, smsKey, ts: p.smsTs, channel: p.channel,
        accountId, eventKind: 'cardPayment' as const, cardPaymentSide,
      };
      if (guard.has(candidate)) {
        const matchedId = guard.takeMatchedId();
        const matchedPrior = matchedId ? priorById.get(matchedId) : undefined;
        const matchedOppositeSettlementSide =
          matchedPrior?.cardPaymentSide !== undefined &&
          cardPaymentSide !== undefined &&
          matchedPrior.cardPaymentSide !== cardPaymentSide;
        if (p.sourceEventId && matchedId && !matchedOppositeSettlementSide) {
          // Preserve the one-to-one live/history pairing in the actual batch.
          // Otherwise h1 is discarded here, h2 reaches the reducer alone and
          // fuzzy reconciliation folds h2 into the still-live row as well.
          promoteMatchedHistory(
            matchedId,
            smsKey!,
            p,
            resolution.confident ? accountId : undefined,
            cardPaymentSide,
          );
          guard.consumeCapture(matchedId);
        }
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
    const exactPrior = smsKey ? priorBySmsKey.get(smsKey) : undefined;
    const stablePrior = exactPrior ?? stableLocalPrior(p);
    const prior = stablePrior;
    const captureCandidate = {
      date, amountFils: p.amountFils, title: p.merchant,
      type: p.type, smsKey, ts: p.smsTs, channel: p.channel,
      eventKind: 'transaction' as const,
    };
    const protectedSupersededId = guard.supersedes(captureCandidate);
    if (protectedSupersededId && priorById.get(protectedSupersededId)?.userEdited) {
      // The fuller SMS still proves the notification was a duplicate, but it
      // must not overwrite the user's corrected title/category/account.
      // That push row has now been accounted for, though: without saying so,
      // the NEXT same-value message in the window was dropped against it too,
      // and that one was a real charge nobody ever saw.
      guard.consume(protectedSupersededId);
      if (p.sourceEventId && smsKey) {
        // Technical source identity is safe to promote even when every
        // user-facing field is protected. It also prevents the next distinct
        // history Message from consuming this same push row through the title
        // index after the cross-channel index was consumed.
        promoteMatchedHistory(protectedSupersededId, smsKey, p);
      }
      guard.add(captureCandidate);
      continue;
    }
    const resolution = resolveAccount(p, prior?.accountId);
    const { accountId } = resolution;
    if (!accountId) continue;
    if (resolution.confident) noteSnapshot(accountId, p);
    if (!exactPrior && stablePrior) {
      healFromReparse(
        undefined,
        p,
        resolution.confident ? accountId : undefined,
        undefined,
        stablePrior,
      );
      continue;
    }
    const candidate = { ...captureCandidate, accountId };
    if (guard.has(candidate)) {
      const matchedId = guard.takeMatchedId();
      const matchedPrior = matchedId ? priorById.get(matchedId) : undefined;
      if (p.sourceEventId && matchedId) {
        // Promote the matched live capture to the exact retained-Message key.
        // The next distinct history GUID can then survive reducer hydration.
        promoteMatchedHistory(
          matchedId,
          smsKey!,
          p,
          resolution.confident ? accountId : undefined,
        );
        // One stored row is indexed by both title and capture channel. A
        // history match consumes it in both places or h2 can reuse the push
        // index after h1 consumed the title index.
        guard.consume(matchedId);
      } else {
        // An older notification row can match this authoritative SMS through
        // the duplicate index while having a different timestamp/s-key. Heal
        // the row we actually matched so newly learned accounting roles reach
        // existing ledgers instead of only clean imports.
        healFromReparse(
          smsKey,
          p,
          resolution.confident ? accountId : undefined,
          undefined,
          matchedPrior,
        );
      }
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
          isTransfer: p.transferHint,
          paymentFlowSide: p.paymentFlowSide,
          paymentInstrumentSource:
            resolution.confident && p.paymentFlowSide === 'receipt' && p.card
              ? 'alert'
              : undefined,
        });
      }
      // One notification is one charge. Two AED 25 SMS a minute apart used to
      // supersede the SAME push row twice; the store keys patches by id and
      // keeps the last, so the first message's charge was never written at
      // all — AED 25 of spending gone, with no duplicate to hint at it.
      guard.consume(supersededId);
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
      paymentFlowSide: p.paymentFlowSide,
      paymentInstrumentSource:
        resolution.confident && p.paymentFlowSide === 'receipt' && p.card
          ? 'alert'
          : undefined,
      // Relay/email/PDF ingestion deliberately discards the source body
      // before this device sees the structured row. Keep a diagnostic excerpt
      // only on Android's local parser path, where one actually exists.
      raw: lowConfidence ? p.raw?.slice(0, 300) : undefined,
    });
  }

  // ── Rows an older parser imported from a DECLINE ────────────────────────
  //
  // A declined transaction moved no money, so the row is not a mislabelled
  // expense — it is an event that never happened, and healing (which only ever
  // adds information to a row) has no way to take it back. The two branches
  // above already do exactly this for a bill reminder that was booked as a
  // real expense; a decline is the same shape of mistake with no `p` to hang
  // it off, because a suppressed message parses to null.
  //
  // The join is the SMS timestamp alone — a decline has no parsed amount, so
  // the `s{ts}-{amount}` smsKey cannot be reconstructed from it. Five things
  // stand between that and deleting a row some OTHER message produced:
  //
  //  1. The timestamp is exact, to the millisecond, and it is the phone's own
  //     record of when the message arrived. Two different messages landing on
  //     the same millisecond is the only way a wrong row can be reached at all.
  //  2. A timestamp this scan re-read into something the parser still
  //     understands is off limits. On the full re-read a version bump forces,
  //     `parsed` is the whole inbox, so any live transaction sitting on that
  //     millisecond takes its own timestamp out of play.
  //  3. Exactly one stored row may sit on the timestamp. Two rows cannot both
  //     have come from one decline and nothing here can say which did.
  //  4. The row's own date must be near the message. A stale or reused
  //     timestamp from another era is the only realistic collision, and this
  //     rejects it outright; a week is far wider than the drift between an
  //     alert's stated date and when the bank sent it.
  //  5. If the row kept its source text, that text must itself read as a
  //     decline. This is the guard that protects the class of row the ledger
  //     migration was built around: two genuine purchases whose stored body
  //     carries a masked figure (`THB ····9260.00`) the parser refuses on
  //     purpose. They no longer parse, but they do not read as refusals, and
  //     nothing may delete them.
  //
  // Plus the guards the sweep above uses: never a transfer, never a row the
  // user has edited, never a split (its parts are their own rows), and never a
  // row this device did not import from a message.
  if (declined.length > 0) {
    // Same derivation dedupe.ts uses: prefer the stored timestamp, fall back to
    // the one inside `s{ts}-{amount}` for rows that predate the `ts` column.
    const rowTs = (t: Transaction): number | undefined => {
      if (Number.isFinite(t.ts)) return t.ts;
      const m = t.smsKey?.match(/^s(\d+)-/);
      return m ? Number(m[1]) : undefined;
    };
    const parsedTs = new Set<number>();
    for (const p of parsed) if (p.smsTs !== undefined) parsedTs.add(p.smsTs);
    const rowsByTs = new Map<number, Transaction[]>();
    for (const t of state.transactions) {
      const ts = rowTs(t);
      if (ts === undefined) continue;
      const bucket = rowsByTs.get(ts);
      if (bucket) bucket.push(t);
      else rowsByTs.set(ts, [t]);
    }
    const NEAR_MS = 7 * 86400000;
    const swept = new Set<string>();
    for (const d of declined) {
      if (d.sourceEventId) {
        // Historical Shortcut timestamps are commonly rounded to a second,
        // so timestamp equality is not identity. Only a row imported from the
        // exact same GUID-derived Message may be swept as a prior misparse.
        const row = priorBySmsKey.get(`h${d.sourceEventId}`);
        if (!row || swept.has(row.id)) continue;
        if (row.source !== 'sms') continue;
        if (row.userEdited || row.isTransfer || row.splits) continue;
        if (row.raw !== undefined && !isNonPostingMessage(row.raw)) continue;
        swept.add(row.id);
        updates.push({ id: row.id, remove: true });
        continue;
      }
      if (!Number.isFinite(d.smsTs) || parsedTs.has(d.smsTs)) continue;
      const rows = rowsByTs.get(d.smsTs);
      if (!rows || rows.length !== 1) continue;
      const row = rows[0];
      if (swept.has(row.id)) continue;
      if (row.source !== 'sms') continue;
      if (row.userEdited || row.isTransfer || row.splits) continue;
      if (Math.abs(Date.parse(`${row.date}T12:00:00Z`) - d.smsTs) > NEAR_MS) continue;
      if (row.raw !== undefined && !isNonPostingMessage(row.raw)) continue;
      swept.add(row.id);
      updates.push({ id: row.id, remove: true });
    }
  }

  // A balance may have been noted while the card kind was still unknown and
  // authoritative credit evidence may have arrived later in the same batch.
  for (const [ref, type] of Object.entries(cardTypes)) {
    if (type === 'credit' && snapshots[ref]?.kind === 'balance') {
      snapshots[ref] = { ...snapshots[ref], kind: 'limit' };
    }
  }

  // A long history can contain many reminders from the same merchant. The
  // most recent one is the current amount/due day; filing the first
  // (chronologically oldest) reminder quietly created stale recurring bills.
  const billImportIdentity = (due: ScannedSms): string | null => {
    // A generic transaction/invoice reference changes each billing cycle. It
    // is dedupe evidence for one alert, never the identity of the obligation;
    // treating it as such creates a second monthly reminder every month.
    return due.billIdentity ?? null;
  };
  const latestUnidentifiedCycle = billDues.reduce((latest, due) => {
    if (billImportIdentity(due)) return latest;
    const merchant = due.merchant.trim().toLowerCase();
    const cycle = due.date?.slice(0, 7) ?? '';
    if (cycle > (latest.get(merchant) ?? '')) latest.set(merchant, cycle);
    return latest;
  }, new Map<string, string>());
  const latestBillDues = [...billDues.reduce((latest, due) => {
    // Keep separately referenced accounts distinct when the bank supplies an
    // account/reference identity, while still collapsing monthly repeats.
    const merchant = due.merchant.trim().toLowerCase();
    const identity = billImportIdentity(due);
    const cycle = due.date?.slice(0, 7) ?? '';
    // With no account identity, retain distinct obligations from the newest
    // provider cycle (amount/day are the only structured facts available),
    // but never resurrect the same provider's previous month beside it.
    if (!identity && cycle !== latestUnidentifiedCycle.get(merchant)) return latest;
    const key = identity
      ? `${merchant}|${identity}`
      : `${merchant}|unidentified|${due.amountFils}|${due.dueDay ?? due.date?.slice(8) ?? ''}`;
    const prior = latest.get(key);
    const dueTime = due.smsTs ?? Date.parse(`${due.date ?? '1970-01-01'}T00:00:00Z`);
    const priorTime = prior?.smsTs ?? Date.parse(`${prior?.date ?? '1970-01-01'}T00:00:00Z`);
    if (!prior || dueTime >= priorTime) latest.set(key, due);
    return latest;
  }, new Map<string, ScannedSms>()).values()];

  for (const due of latestBillDues) {
    const dueDay = due.dueDay ?? (due.date ? Number(due.date.slice(8)) : 0);
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) continue;
    const importIdentity = billImportIdentity(due);
    newBills.push({
      title: due.merchant,
      category: due.categoryGuess,
      amountFils: due.amountFils,
      dueDay,
      autoDetected: true,
      ...(importIdentity ? { importIdentity } : {}),
    });
  }

  return {
    batch: {
      transactions,
      newAccounts,
      newHints,
      newDues,
      newBills,
      snapshots,
      bankNames,
      cardTypes,
      confirmedLedgerCurrency: confirmedLedgerCurrency(parsed),
      lastScanTs: newestTs,
      updates,
    },
    txCount: transactions.length,
    newAccountCount: newAccounts.length,
    dueCount: newDues.length,
    healedCount: updates.length,
    billDues: latestBillDues,
  };
}
