import { PermissionsAndroid, Platform } from 'react-native';

import NotificationReader from '../../modules/notification-reader';
import SmsReader, { type RawSms } from '../../modules/sms-reader';
import { bankFromSender, cardAccountName, colorForHint } from '@/lib/cards';
import { toISODate } from '@/lib/format';
import { parseSms, STRUCTURAL_TITLES, type ParsedSms } from '@/lib/sms-parser';
import type { Account, AppState, CardDue, Transaction } from '@/lib/types';
import type { ImportBatchInput, TxHealUpdate } from '@/lib/store';

const PAGE_SIZE = 1000;
const MAX_PAGES = 40; // 40k messages is far beyond any real inbox

export function isSmsScanningAvailable(): boolean {
  return Platform.OS === 'android' && SmsReader != null;
}

export async function hasSmsPermission(): Promise<boolean> {
  if (!isSmsScanningAvailable()) return false;
  return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS);
}

export async function requestSmsPermission(): Promise<boolean> {
  if (!isSmsScanningAvailable()) return false;
  // READ_SMS covers the inbox history scan, RECEIVE_SMS the delivery
  // broadcast that catches an alert as it lands. They share a permission
  // group, so this is one prompt, but each has to be asked for by name or
  // the receiver silently never fires.
  const result = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.READ_SMS,
    PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
  ]);
  // The inbox scan is the feature; live capture is an enhancement on top, so
  // READ_SMS alone still counts as granted.
  return result[PermissionsAndroid.PERMISSIONS.READ_SMS] === PermissionsAndroid.RESULTS.GRANTED;
}

export type ScannedSms = ParsedSms & { smsTs?: number; sender?: string };

export interface ScanResult {
  parsed: ScannedSms[];
  /** Timestamp of the newest message seen, for incremental scans. */
  newestTs: number;
  scannedCount: number;
}

/**
 * Reads the inbox from `sinceMs` to now in pages (full history when sinceMs = 0)
 * and parses every message. onProgress fires per page for UI feedback.
 */
export async function scanInbox(
  sinceMs: number,
  overrides: Record<string, import('@/lib/types').CategoryId>,
  onProgress?: (scanned: number, found: number) => void,
): Promise<ScanResult> {
  if (!isSmsScanningAvailable() || !SmsReader) {
    return { parsed: [], newestTs: sinceMs, scannedCount: 0 };
  }

  const parsed: (ParsedSms & { smsTs: number; sender: string })[] = [];
  let newestTs = sinceMs;
  let untilMs = Date.now() + 60_000;
  let scannedCount = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const batch: RawSms[] = await SmsReader.getInboxSms(sinceMs, untilMs, PAGE_SIZE);
    if (batch.length === 0) break;
    scannedCount += batch.length;
    for (const sms of batch) {
      if (sms.date > newestTs) newestTs = sms.date;
      const p = parseSms(sms.body, overrides);
      if (!p) continue;
      parsed.push({ ...p, date: p.date ?? toISODate(new Date(sms.date)), smsTs: sms.date, sender: sms.address });
    }
    onProgress?.(scannedCount, parsed.length);
    untilMs = batch[batch.length - 1].date; // page ends exclusive, walk backwards
    if (batch.length < PAGE_SIZE) break;
  }

  // Alerts the delivery receiver caught as they arrived. Usually the inbox
  // query above already found them; this covers the case where a message
  // never reached the SMS provider, and is the hook a live alert hangs off.
  // Duplicates collapse on the date/amount/title fingerprint in the plan.
  if (SmsReader.getReceived) {
    try {
      for (const sms of await SmsReader.getReceived(sinceMs)) {
        scannedCount += 1;
        if (sms.date > newestTs) newestTs = sms.date;
        const p = parseSms(sms.body, overrides);
        if (!p) continue;
        parsed.push({
          ...p,
          date: p.date ?? toISODate(new Date(sms.date)),
          smsTs: sms.date,
          sender: sms.address,
        });
      }
      onProgress?.(scannedCount, parsed.length);
    } catch {
      // Capture buffer is best-effort; the inbox results stand on their own.
    }
  }

  // Bank-app push notifications captured by the notification listener (banks
  // are shifting from SMS to push). Same parser, same dedupe fingerprints.
  if (NotificationReader?.isEnabled?.()) {
    try {
      const captured = await NotificationReader.getCaptured(sinceMs);
      for (const n of captured) {
        scannedCount += 1;
        if (n.ts > newestTs) newestTs = n.ts;
        const p = parseSms(`${n.title} ${n.text}`.trim(), overrides);
        if (!p) continue;
        parsed.push({
          ...p,
          date: p.date ?? toISODate(new Date(n.ts)),
          smsTs: n.ts,
          // Package names usually contain the bank ("com.enbd...", "adcb...").
          sender: `${n.pkg} ${n.title}`,
        });
      }
      onProgress?.(scannedCount, parsed.length);
    } catch {
      // Listener data is best-effort; SMS results stand on their own.
    }
  }

  // Oldest-first so account auto-creation sees the earliest occurrence first.
  parsed.sort((a, b) => a.smsTs - b.smsTs);
  return { parsed, newestTs, scannedCount };
}

export interface ImportPlan {
  batch: ImportBatchInput;
  txCount: number;
  newAccountCount: number;
  dueCount: number;
  /** Already-imported rows the parser now reads better (renamed/recategorized). */
  healedCount: number;
  billDues: ParsedSms[];
}

function dedupeKey(date: string, amountFils: number, title: string): string {
  return `${date}|${amountFils}|${title.toLowerCase()}`;
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
  // A full-history scan surfaces statements from years back; only dues still
  // near their pay-by date are live obligations worth tracking.
  const staleDueCutoff = toISODate(new Date(today.getTime() - 45 * 86400000));
  const seen = new Set(
    state.transactions.map((t) => dedupeKey(t.date, t.amountFils, t.title)),
  );
  // Message fingerprints survive parser updates (titles/accounts may change,
  // the source SMS does not). This is the primary duplicate guard on rescans.
  const seenSms = new Set(state.transactions.map((t) => t.smsKey).filter(Boolean));
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
    // Never re-heal a row the user corrected by hand — a rescan that undoes
    // their edit teaches them that correcting anything is pointless.
    if (prior.userEdited) return;
    const patch: TxHealUpdate = { id: prior.id };
    // Retitle rows whose old title was generic OR whose category never got
    // past "other" (that combination is where garbage titles live) — but
    // never replace a name with the generic fallback.
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
    const titleAfter = patch.title ?? prior.title;
    const catAfter = patch.category ?? prior.category;
    const stillLow =
      p.type === 'expense' &&
      !p.transferHint &&
      !prior.isTransfer &&
      (titleAfter === 'Card purchase' || (catAfter === 'other' && !STRUCTURAL_TITLES.has(titleAfter)));
    // Relay rows have no raw text — the Worker drops it — so guard on it
    // rather than writing an empty string over a row that had none.
    if (stillLow && !prior.raw && p.raw) patch.raw = p.raw.slice(0, 300);
    if (Object.keys(patch).length > 1) updates.push(patch);
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
        minDueFils: p.minDueFils ?? Math.round(p.amountFils * 0.05),
        dueDate: p.date,
        paidFils: 0,
      });
      continue;
    }
    if (p.kind === 'cardPayment') {
      const accountId = resolveAccount(p);
      noteSnapshot(accountId, p);
      const key = dedupeKey(date, p.amountFils, p.merchant);
      const smsKey = smsKeyOf(p);
      if (seen.has(key) || (smsKey && seenSms.has(smsKey))) {
        // A row imported as a plain expense before this message was
        // recognized as a card payment becomes a transfer now.
        healFromReparse(smsKey, p);
        continue;
      }
      seen.add(key);
      if (smsKey) seenSms.add(smsKey);
      transactions.push({
        type: 'income', // money arriving INTO the card account
        amountFils: p.amountFils,
        category: 'other',
        accountId,
        title: p.merchant,
        date,
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
    const key = dedupeKey(date, p.amountFils, p.merchant);
    const smsKey = smsKeyOf(p);
    if (seen.has(key) || (smsKey && seenSms.has(smsKey))) {
      healFromReparse(smsKey, p);
      continue;
    }
    seen.add(key);
    if (smsKey) seenSms.add(smsKey);
    // Low-confidence rows keep their source text so the user can report
    // unrecognized bank formats from Settings → Improve accuracy.
    // Structurally-understood rows (ATM, VAT, transfers...) stay out.
    const lowConfidence =
      !p.transferHint &&
      p.type === 'expense' &&
      (p.merchant === 'Card purchase' ||
        (p.categoryGuess === 'other' && !STRUCTURAL_TITLES.has(p.merchant)));
    transactions.push({
      type: p.type,
      amountFils: p.amountFils,
      category: p.categoryGuess,
      accountId,
      title: p.merchant,
      date,
      source: 'sms',
      smsKey,
      isTransfer: p.transferHint || undefined,
      raw: lowConfidence ? p.raw.slice(0, 300) : undefined,
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
