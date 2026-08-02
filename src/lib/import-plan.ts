import { cardAccountName, colorForHint, estimatedMinimumFils } from '@/lib/cards';
import { bankFromSender } from '@/lib/markets';
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

export type ScannedSms = ParsedSms & {
  smsTs?: number;
  sender?: string;
  channel?: CaptureChannel;
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
  billDues: ParsedSms[];
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
  for (const t of state.transactions) {
    if (t.smsKey && t.source === 'sms') priorBySmsKey.set(t.smsKey, t);
  }
  const updates: TxHealUpdate[] = [];
  const healFromReparse = (smsKey: string | undefined, p: ScannedSms) => {
    const prior = smsKey ? priorBySmsKey.get(smsKey) : undefined;
    if (!prior) return;
    const patch = healPatch(prior, p);
    if (patch) updates.push(patch);
  };
  const smsKeyOf = (p: ScannedSms): string | undefined =>
    p.smsTs !== undefined ? `s${p.smsTs}-${p.amountFils}` : undefined;
  // Newest bank-quoted balance/limit per account — even from messages whose
  // transaction is already imported (rescans refresh the figures).
  const snapshots: ImportBatchInput['snapshots'] = {};
  const noteSnapshot = (accountRef: string, p: ScannedSms) => {
    if (p.snapshotFils === null || !p.snapshotKind || p.smsTs === undefined || !accountRef) return;
    const cur = snapshots[accountRef];
    if (!cur || p.smsTs > cur.ts) {
      snapshots[accountRef] = { fils: p.snapshotFils, kind: p.snapshotKind, ts: p.smsTs };
    }
  };
  const hints: Record<string, string> = { ...state.accountHints };
  const newAccounts: Omit<Account, 'id'>[] = [];
  const newHints: Record<string, string> = {};
  const transactions: Omit<Transaction, 'id'>[] = [];
  const newDues: Omit<CardDue, 'id'>[] = [];
  const billDues: ParsedSms[] = [];
  const fallbackAccountId = state.accounts[0]?.id ?? '';

  // Bank identity per account, learned from SMS sender IDs (existing accounts
  // that predate this get theirs backfilled).
  const bankNames: Record<string, string> = {};
  const resolveAccount = (p: ScannedSms): string => {
    if (!p.card) return fallbackAccountId;
    const { last4, kind } = p.card;
    const bank = bankFromSender(p.sender);
    if (hints[last4]) {
      if (bank) bankNames[hints[last4]] ??= bank.name;
      return hints[last4];
    }
    // An account the user created earlier with a matching last4 wins.
    const existing = state.accounts.find((a) => a.last4 === last4);
    if (existing) {
      hints[last4] = existing.id;
      newHints[last4] = existing.id;
      if (bank && !existing.bankName) bankNames[existing.id] ??= bank.name;
      return existing.id;
    }
    // Auto-create; reference by index until the store assigns real ids.
    const idx = newAccounts.length;
    newAccounts.push({
      name: bank ? `${bank.name} ${cardAccountName(last4, kind)}` : cardAccountName(last4, kind),
      kind: kind === 'credit' || kind === 'debit' ? 'card' : 'bank',
      cardType: kind === 'credit' ? 'credit' : kind === 'debit' ? 'debit' : undefined,
      last4,
      bankName: bank?.name,
      openingFils: 0,
      color: bank?.color ?? colorForHint(last4),
    });
    const ref = String(idx);
    hints[last4] = ref;
    newHints[last4] = ref;
    return ref;
  };

  for (const p of parsed) {
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
      if (misread && !misread.isTransfer) updates.push({ id: misread.id, remove: true });
      if (!p.card || !p.date) continue;
      if (p.date < staleDueCutoff) continue;
      const accountId = resolveAccount(p);
      noteSnapshot(accountId, p);
      // Statement dues only exist for credit cards. If this last4 already
      // resolved to a debit card or bank account, the "statement" is a
      // misread — never attach a due to it.
      const existing = state.accounts.find((a) => a.id === accountId);
      if (existing && existing.cardType !== 'credit') continue;
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
      const accountId = resolveAccount(p);
      noteSnapshot(accountId, p);
      const smsKey = smsKeyOf(p);
      // A card payment lands as income into the card account.
      const candidate = {
        date, amountFils: p.amountFils, title: p.merchant,
        type: 'income' as const, smsKey, channel: p.channel,
      };
      if (guard.has(candidate)) {
        // A row imported as a plain expense before this message was
        // recognized as a card payment becomes a transfer now.
        healFromReparse(smsKey, p);
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
        isTransfer: true,
      });
      continue;
    }
    // Plain transaction. transferHint = the bank-side leg of a card payment /
    // own-account transfer: keep it for balances, exclude it from spending.
    const accountId = resolveAccount(p);
    noteSnapshot(accountId, p);
    const smsKey = smsKeyOf(p);
    const candidate = {
      date, amountFils: p.amountFils, title: p.merchant,
      type: p.type, smsKey, channel: p.channel,
    };
    if (guard.has(candidate)) {
      healFromReparse(smsKey, p);
      continue;
    }
    // The same charge already in the ledger from a bank-app notification.
    // The SMS is the better read, so it rewrites that row rather than
    // becoming a second one.
    const supersededId = guard.supersedes(candidate);
    if (supersededId) {
      updates.push({
        id: supersededId,
        title: p.merchant,
        category: p.categoryGuess,
        type: p.type,
      });
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

  return {
    batch: { transactions, newAccounts, newHints, newDues, snapshots, bankNames, lastScanTs: newestTs, updates },
    txCount: transactions.length,
    newAccountCount: newAccounts.length,
    dueCount: newDues.length,
    healedCount: updates.length,
    billDues,
  };
}
