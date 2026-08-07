import { AppState as RNAppState, I18nManager, Platform } from 'react-native';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  markCardsDistinct,
  mergeDuplicateAccounts,
  mergeRenewedCard,
  repairCardPaymentAccounts,
} from '@/lib/accounts';
import { setMonthStartDay as applyMonthStartDay } from '@/lib/format';
import { setThemePreference as applyThemePreference } from '@/lib/theme-preference';
import { detectLanguage, setLanguage } from '@/lib/i18n';
import { detectMarketId, setActiveMarket } from '@/lib/markets';
import {
  generateSeedAccounts,
  generateSeedCardDues,
  generateSeedTransactions,
  SEED_ACCOUNTS,
  SEED_BILLS,
  SEED_BUDGETS,
} from '@/lib/seed';
import { applyHealPatch, healPatch } from '@/lib/heal';
import { guessCategory, normalizeServiceName, parseSms, PARSER_VERSION } from '@/lib/sms-parser';
import { internalTransferIds } from '@/lib/ledger';
import { mergeImportedCardDues } from '@/lib/cards';
import { reconcileCaptureDuplicates } from '@/lib/dedupe';
import { migrateLegacyState, stateStorage } from '@/lib/state-storage';
import { recordStorageFailure, type StorageFailure } from '@/lib/storage-diagnostics';
import { overrideAppliesTo } from '@/lib/uncategorised';
import type { FxUpdate } from '@/lib/fx';

import type {
  ImportBatchInput,
  Account,
  AppState,
  Bill,
  Budget,
  CardDue,
  CategoryId,
  Goal,
  Transaction,
  TxHealUpdate,
} from '@/lib/types';

export type { ImportBatchInput } from '@/lib/types';

const STORAGE_KEY = 'wafra/state/v1';

const EMPTY_STATE: AppState = {
  hydrated: false,
  accounts: [],
  transactions: [],
  budgets: [],
  bills: [],
  cardDues: [],
  goals: [],
  merchantOverrides: {},
  accountHints: {},
  notSubscriptions: [],
  lastScanTs: 0,
  onboarded: false,
  userName: 'there',
  appLock: false,
  monthStartDay: 1,
  themePreference: 'system',
  pro: false,
  privateMode: false,
  dailySummary: false,
  trialStartTs: 0,
  marketId: '',
  language: '',
};

let idCounter = 0;
function makeId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now()}-${idCounter}-${Math.floor(Math.random() * 1e6)}`;
}

function sortTxs(transactions: Transaction[]): Transaction[] {
  return [...transactions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/**
 * Automatic repairs may discard a poorer duplicate, but they must never
 * rewrite or discard the row the user chose to correct. Restore those rows
 * from the exact objects that entered the migration, including optional
 * fields that a duplicate merge could otherwise add or remove.
 */
export function preserveUserEditedTransactions(
  original: Transaction[],
  migrated: Transaction[],
): Transaction[] {
  const pinned = new Map(original.filter((t) => t.userEdited).map((t) => [t.id, t]));
  if (pinned.size === 0) return migrated;

  const restoredIds = new Set<string>();
  const restored = migrated.map((t) => {
    const exact = pinned.get(t.id);
    if (!exact) return t;
    restoredIds.add(t.id);
    return exact;
  });
  for (const [id, exact] of pinned) {
    if (!restoredIds.has(id)) restored.push(exact);
  }
  return restored;
}

/** Conservative persisted-capture cleanup shared by every hydration path. */
export function finalizeHydrationTransactions(
  transactions: Transaction[],
  authoritativeOriginal: Transaction[] = transactions,
): Transaction[] {
  return sortTxs(
    preserveUserEditedTransactions(
      authoritativeOriginal,
      reconcileCaptureDuplicates(transactions),
    ),
  );
}

/** Payer evidence shared with the parser's anonymous-income policy. */
const PERSISTED_INCOME_ORIGINATOR_RE =
  /b\/o\b|\b(?:l\.?l\.?c|ltd\b|limited\b|fze|fzco|dmcc|plc\b|inc\b)/i;

/**
 * Upgrade persisted data whose meaning became clearer in newer parsers.
 *
 * Every transaction transform explicitly treats `userEdited` as immutable.
 * The final hydration reducer protects it again around account repair and
 * conservative capture reconciliation, so this contract does not depend on
 * every future migration author remembering every downstream transform.
 */
export function migratePersistedState(
  parsed: Partial<Omit<AppState, 'hydrated'>>,
): Partial<Omit<AppState, 'hydrated'>> {
  // A merchant rule is keyed on the TITLE, and the parser renames titles.
  //
  // `normalizeServiceName` is how one shop stops arriving under six spellings,
  // and every release adds to it — a2838e4 alone added Shein, Dr. Vranjes,
  // Foot Locker and M.H. Alshaya, which is to say it changed the title the
  // parser produces for messages ALREADY on users' phones. The retitle below
  // then rewrites those rows, and the rule the user set under the old spelling
  // is left keyed on a string nothing carries any more. Three things break at
  // once, and none of them is visible:
  //
  //  - the pin stops reaching the row, so heal — which now runs on pinned rows
  //    at all, since `setMerchantOverride` rightly no longer stamps
  //    `userEdited` — finds the parser's answer disagreeing with the stored
  //    one and overwrites the user's category with it;
  //  - `parserCoverage` keys `decided` on `merchantOverrides[title]`, so the
  //    row moves out of "the user answered this" and into "the parser got it
  //    right" — the user's own answer credited to us, which is precisely the
  //    laundering c79a2d6 was written to remove;
  //  - and every FUTURE message from that shop misses the rule, so the
  //    screen's promise ("future imports from {merchant} will use this
  //    category") quietly stops being true.
  //
  // The fix is to move the rule with the merchant rather than to defend the
  // row: a pin on "www.shein.com" IS a pin on Shein, because the same
  // canonicalisation that renamed the row maps the key onto the same name.
  // Keyed on the merchant, the rule reaches the retitled rows, the new rows,
  // and the coverage figure, all three, without a per-row marker that only
  // rows already in the ledger could ever carry.
  //
  // ADDITIVE AND IDEMPOTENT. The old key is kept — a rescan of an old message
  // can still produce the old title, and `isCandidate` reads the map to decide
  // it has already asked about that merchant — and an existing answer under
  // the canonical key is never overwritten, so a user who has pinned "Shein"
  // directly keeps the answer they gave last. Runs before the transaction
  // transforms below because the retitle, the re-file and the reparse all read
  // this map.
  //
  // AND IT MOVES ONLY ON EVIDENCE. `SERVICE_NAMES` matches on substrings, by
  // design — that is how one shop stops arriving under six spellings — so
  // "Shein Wholesale" canonicalises to Shein and "Anthropic Consulting" to
  // Claude. Run over a TITLE that is exactly what happens today, one row at a
  // time, and the row is what the user is looking at. Run over a RULE it would
  // be silently deciding the category of every future row from a merchant the
  // user never named: a hand-typed "Claudes Diner" pinned to Dining would
  // quietly file their Claude subscription as Dining forever. Hand-typed
  // titles are the gap, because `editTransaction` marks that row `userEdited`
  // and the retitle map skips it, so the parser's canonicalisation never ran
  // on the string this key came from.
  //
  // So the rule only moves where the LEDGER shows the parser producing that
  // merchant: some parser-owned row is titled with the old key (it is about to
  // be renamed below) or already carries the canonical name (it was renamed by
  // an earlier launch, which is the state a damaged ledger is in). Both are the
  // cases this exists for; a key with neither is a name only the user has ever
  // written, and nothing licenses moving it.
  if (parsed.merchantOverrides) {
    const parserTitles = new Set(
      (parsed.transactions ?? [])
        .filter((t) => t.source === 'sms' && !t.userEdited)
        .map((t) => t.title.trim().toLowerCase()),
    );
    const rekeyed = { ...parsed.merchantOverrides };
    for (const [key, category] of Object.entries(parsed.merchantOverrides)) {
      const canonical = normalizeServiceName(key);
      if (!canonical) continue;
      const canonicalKey = canonical.trim().toLowerCase();
      if (canonicalKey === key || rekeyed[canonicalKey] !== undefined) continue;
      if (!parserTitles.has(key) && !parserTitles.has(canonicalKey)) continue;
      rekeyed[canonicalKey] = category;
    }
    parsed.merchantOverrides = rekeyed;
  }

  if (parsed.transactions) {
    parsed.transactions = parsed.transactions
      .map((t) =>
        t.userEdited
          ? t
          : t.source === 'sms' && /^\d{4,6}[Xx*•]{2,}\d{4}/.test(t.title)
            ? { ...t, title: 'Card payment', isTransfer: true, category: 'other' as const }
            : t,
      )
      // Income mis-filed into spending categories (a Talabat payout is
      // revenue, not dining): re-file as business/salary.
      .map((t) =>
        t.userEdited
          ? t
          : t.source === 'sms' &&
              t.type === 'income' &&
              !['salary', 'business', 'other'].includes(t.category)
            ? { ...t, category: 'business' as const }
            : t,
      )
      // Unify service descriptors so ChatGPT/Claude/Real-Debrid etc. read
      // clearly and group as one subscription.
      .map((t) => {
        if (t.userEdited || t.source !== 'sms') return t;
        const canonical = normalizeServiceName(t.title);
        return canonical && canonical !== t.title ? { ...t, title: canonical } : t;
      })
      // Parser versions before T215 filed anonymous incoming money as
      // Business (or even retained a spending category). Structural titles
      // mean no payer was identified. Refile only those exact SMS rows, while
      // retaining salary/Other and raw messages carrying explicit originator
      // or company evidence.
      .map((t) => {
        if (
          t.userEdited ||
          t.source !== 'sms' ||
          t.type !== 'income' ||
          (t.title !== 'Incoming transfer' && t.title !== 'Inward remittance') ||
          t.category === 'salary' ||
          t.category === 'other' ||
          (t.raw !== undefined && PERSISTED_INCOME_ORIGINATOR_RE.test(t.raw))
        ) {
          return t;
        }
        return { ...t, category: 'other' as const };
      })
      // Older imports marked every inward remittance as a transfer. An
      // unpaired arrival is real income; only ledger pairing can prove it
      // moved between the user's own accounts. Raw-bearing rows can reparse,
      // so migrate only the exact stranded legacy shape.
      .map((t) => {
        if (
          t.userEdited ||
          t.source !== 'sms' ||
          t.raw !== undefined ||
          t.type !== 'income' ||
          t.title !== 'Inward remittance' ||
          t.isTransfer !== true
        ) {
          return t;
        }
        const { isTransfer: _stale, ...income } = t;
        return income;
      });

    // Re-file rows stuck in Other: each parser release widens the merchant
    // vocabulary, so imported-as-Other rows get another chance without
    // needing a rescan. User overrides still win.
    parsed.transactions = parsed.transactions.map((t) => {
      if (
        t.userEdited ||
        t.source !== 'sms' ||
        t.isTransfer ||
        t.category !== 'other' ||
        t.type !== 'expense'
      ) {
        return t;
      }
      const guessed = guessCategory(t.title, t.type, parsed.merchantOverrides, t.title);
      return guessed !== 'other' ? { ...t, category: guessed } : t;
    });

    // Rows that kept their raw SMS re-parse under the CURRENT grammar on
    // every launch. A hand-corrected row is the user's answer, not the
    // parser's, so it remains the exact object supplied to this migration.
    if (parsed.marketId) setActiveMarket(parsed.marketId);
    parsed.transactions = parsed.transactions.flatMap((t) => {
      if (t.userEdited || !t.raw || t.source !== 'sms') return [t];
      const p = parseSms(t.raw, parsed.merchantOverrides);
      // Parser regressions and formats this release does not understand are
      // not evidence that a persisted transaction never happened. Preserve
      // the old row and its raw text for a future rescan instead of deleting
      // the only local record.
      if (!p) return [t];
      if (p.kind === 'billDue' || p.kind === 'cardStatement') {
        // This migration can heal transactions but cannot materialize the
        // CardDue/Bill that now represents this message. Keep the legacy row
        // until a rescan can atomically create that obligation; deleting it
        // here loses the only record when lastScanTs prevents re-offering it.
        return [t];
      }
      const patch = healPatch(t, p);
      return [patch ? applyHealPatch(t, patch) : t];
    });
  }

  if (parsed.cardDues?.length && parsed.accounts?.length) {
    // A CardDue can only describe a credit-card statement. Older parsers
    // sometimes left the referenced account untyped or labelled debit; the
    // due is stronger evidence than that fallback. Preserve every statement
    // (including long-overdue, unreplaced ones) and repair the account rather
    // than deleting the only record of money still owed.
    const dueAccountIds = new Set(parsed.cardDues.map((due) => due.accountId));
    parsed.accounts = parsed.accounts.map((account) => {
      if (!dueAccountIds.has(account.id)) return account;
      if (
        account.kind === 'card' &&
        account.cardType === 'credit' &&
        account.snapshotKind !== 'balance'
      ) {
        return account;
      }
      return {
        ...account,
        kind: 'card' as const,
        cardType: 'credit' as const,
        // Legacy credit-card "balance" alerts represented available
        // headroom. Once the card type is authoritative, so is this meaning.
        ...(account.snapshotKind === 'balance' ? { snapshotKind: 'limit' as const } : {}),
      };
    });
  }

  return parsed;
}

/** Validate and migrate an imported backup before it reaches the reducer. */
export function parseBackupForRestore(
  json: string,
): Partial<Omit<AppState, 'hydrated'>> | null {
  try {
    const parsed = JSON.parse(json) as { app?: unknown; data?: unknown };
    if (
      parsed.app !== 'wafra' ||
      typeof parsed.data !== 'object' ||
      parsed.data === null ||
      !('transactions' in parsed.data) ||
      !Array.isArray(parsed.data.transactions)
    ) {
      return null;
    }
    return migratePersistedState(parsed.data as Partial<Omit<AppState, 'hydrated'>>);
  } catch {
    return null;
  }
}

type Action =
  | { type: 'hydrate'; state: Partial<Omit<AppState, 'hydrated'>> }
  | { type: 'addTransaction'; transaction: Transaction }
  | { type: 'editTransaction'; id: string; patch: Partial<Omit<Transaction, 'id'>> }
  | { type: 'deleteTransaction'; id: string }
  | {
      type: 'importBatch';
      transactions: Transaction[];
      newAccounts: Account[];
      newHints: Record<string, string>;
      newDues: CardDue[];
      snapshots: Record<string, { fils: number; kind: 'balance' | 'limit' | 'outstanding'; ts: number }>;
      bankNames: Record<string, string>;
      cardTypes: Record<string, 'credit' | 'debit'>;
      lastScanTs: number;
      updates: TxHealUpdate[];
    }
  | { type: 'undoBatch'; ids: string[] }
  | { type: 'upsertBudget'; budget: Budget }
  | { type: 'deleteBudget'; category: Budget['category'] }
  | { type: 'addAccount'; account: Account }
  | { type: 'editAccount'; id: string; patch: Partial<Omit<Account, 'id'>> }
  | { type: 'deleteAccount'; id: string }
  | { type: 'mergeRenewedCard'; oldId: string; newId: string }
  | { type: 'markCardsDistinct'; id: string }
  | { type: 'addBill'; bill: Bill }
  | { type: 'deleteBill'; id: string }
  | { type: 'markBillPaid'; id: string; month: string; transaction: Transaction }
  | { type: 'upsertCardDue'; due: CardDue }
  | { type: 'payCardDue'; id: string; amountFils: number; transaction: Transaction | null; settledAt: string | null }
  | { type: 'setMerchantOverride'; merchant: string; category: CategoryId; applyToExisting: boolean }
  | { type: 'setNotSubscription'; merchant: string; dismissed: boolean }
  | { type: 'reassignAccountHint'; last4: string; accountId: string }
  | { type: 'addGoal'; goal: Goal }
  | { type: 'editGoal'; id: string; patch: Partial<Omit<Goal, 'id'>> }
  | { type: 'deleteGoal'; id: string }
  | { type: 'setAppLock'; enabled: boolean }
  | { type: 'setPrivateMode'; enabled: boolean }
  | { type: 'setDailySummary'; enabled: boolean }
  | { type: 'applyFxUpdates'; updates: FxUpdate[] }
  | { type: 'setMonthStartDay'; day: number }
  | { type: 'setThemePreference'; preference: string }
  | { type: 'setPro'; pro: boolean }
  | { type: 'setMarket'; id: string }
  | { type: 'setUiLanguage'; language: string }
  | { type: 'markParserVersion' }
  | { type: 'setOnboarded' }
  | { type: 'restore'; state: Partial<Omit<AppState, 'hydrated'>> }
  | { type: 'loadDemo'; state: Partial<Omit<AppState, 'hydrated'>> }
  | { type: 'clearAll' };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'hydrate':
    case 'loadDemo':
    case 'restore': {
      // Merge over defaults so states saved by older app versions stay valid.
      const next = { ...EMPTY_STATE, ...action.state, hydrated: true };
      // Month grouping is computed all over the app; sync the global before
      // anything renders against the hydrated state.
      applyMonthStartDay(next.monthStartDay || 1);
      applyThemePreference(next.themePreference);
      // The free Pro trial clock starts the first time the app ever opens.
      if (!next.trialStartTs) next.trialStartTs = Date.now();
      // Localize automatically: country pack from the device locale, once.
      if (!next.marketId) next.marketId = detectMarketId();
      setActiveMarket(next.marketId);
      if (!next.language) next.language = detectLanguage();
      setLanguage(next.language === 'ar' ? 'ar' : 'en');
      // Older states can carry two rows for one card. Collapse on the way in,
      // once, rather than teaching every screen to tolerate it.
      const accountsMerged = mergeDuplicateAccounts(next);
      const paymentsRepaired = repairCardPaymentAccounts(accountsMerged);
      return {
        ...paymentsRepaired,
        transactions: finalizeHydrationTransactions(paymentsRepaired.transactions, next.transactions),
        cardDues: mergeImportedCardDues([], paymentsRepaired.cardDues, paymentsRepaired.accounts),
      };
    }
    case 'markParserVersion':
      // A full re-read that changed nothing still proves the stored rows were
      // read with this parser. Without recording it, the app would re-read the
      // entire inbox on every single launch.
      return state.parserVersion === PARSER_VERSION
        ? state
        : { ...state, parserVersion: PARSER_VERSION };
    case 'setPro':
      return { ...state, pro: action.pro };
    case 'setMarket':
      setActiveMarket(action.id);
      return { ...state, marketId: action.id };
    case 'setUiLanguage':
      setLanguage(action.language === 'ar' ? 'ar' : 'en');
      return { ...state, language: action.language };
    case 'setThemePreference': {
      // Applied here as well as on hydrate, so the palette turns over on the
      // same tick the setting is written rather than on the next launch.
      applyThemePreference(action.preference);
      return { ...state, themePreference: action.preference };
    }
    case 'setMonthStartDay': {
      const day = Math.min(28, Math.max(1, Math.round(action.day) || 1));
      if (day === state.monthStartDay) return state;
      applyMonthStartDay(day);
      // A new array identity for the transactions, deliberately.
      //
      // This setting reshapes every month boundary in the app, but it lives in
      // a module-global that `monthKey` reads at call time — nothing about
      // `state.transactions` changes when it moves. Every figure memoised on
      // `[state.transactions, period]` therefore kept its old value: Home's
      // hero still showed the calendar month's saving while Leaving soon,
      // memoised on `[state]`, had already switched to the salary month. Two
      // panels of one screen, two definitions of "this month", until a
      // transaction was added or the app restarted.
      //
      // Copying the array is what tells those memos the world moved. It is
      // O(n) once, on a setting the user changes approximately never.
      return { ...state, monthStartDay: day, transactions: [...state.transactions] };
    }
    case 'addTransaction':
      return { ...state, transactions: sortTxs([action.transaction, ...state.transactions]) };
    case 'editTransaction': {
      const transactions = sortTxs(
        state.transactions.map((t) => {
          if (t.id !== action.id) return t;
          // `titleEdited` is the narrow half of `userEdited`: the user
          // replaced the parser's SHOP NAME, as opposed to correcting an
          // amount, a date or an account. Parser-coverage measurement needs
          // that distinction — a hand-typed name must never be scored as a
          // parser naming success, and a row whose date was fixed must not be
          // dropped from the measurement for it. So it is set only when the
          // patch carries a title that actually differs from the one on the
          // row, and once set it survives every later edit.
          const renamed = action.patch.title !== undefined && action.patch.title !== t.title;
          // userEdited pins the row: nothing re-parsed may overwrite it later.
          return renamed || t.titleEdited
            ? { ...t, ...action.patch, userEdited: true, titleEdited: true }
            : { ...t, ...action.patch, userEdited: true };
        }),
      );
      return { ...state, transactions };
    }
    case 'deleteTransaction':
      return { ...state, transactions: state.transactions.filter((t) => t.id !== action.id) };
    case 'importBatch': {
      const accounts = [...state.accounts, ...action.newAccounts].map((a) => {
        const snap = action.snapshots[a.id];
        const bank = !a.bankName ? action.bankNames[a.id] : undefined;
        const learnedType = action.cardTypes[a.id];
        let next = a;
        if (snap && snap.ts > (a.snapshotTs ?? 0)) {
          next = { ...next, snapshotFils: snap.fils, snapshotKind: snap.kind, snapshotTs: snap.ts };
        }
        if (bank) next = { ...next, bankName: bank };
        if (
          learnedType &&
          (learnedType === 'credit' || next.cardType === undefined) &&
          next.cardType !== learnedType
        ) {
          next = { ...next, kind: 'card', cardType: learnedType };
        }
        // A balance-shaped snapshot captured before the parser learned this
        // is a credit card is available headroom, not cash in an account.
        // Normalize persisted snapshots too, including batches where no newer
        // snapshot arrived alongside the authoritative card type.
        if (learnedType === 'credit' && next.snapshotKind === 'balance') {
          next = { ...next, snapshotKind: 'limit' };
        }
        return next;
      });
      const dues = mergeImportedCardDues(state.cardDues, action.newDues, accounts);
      // Heal existing rows the parser now reads better.
      const patches = new Map(action.updates.map((u) => [u.id, u]));
      const existing =
        patches.size > 0
          ? state.transactions
              .filter((t) => !patches.get(t.id)?.remove)
              .map((t) => {
                const u = patches.get(t.id);
                return u ? applyHealPatch(t, u) : t;
              })
          : state.transactions;
      const merged = repairCardPaymentAccounts(mergeDuplicateAccounts({
        ...state,
        transactions: [...action.transactions, ...existing],
        accounts,
        accountHints: { ...state.accountHints, ...action.newHints },
        cardDues: dues,
        lastScanTs: Math.max(state.lastScanTs, action.lastScanTs),
        parserVersion: PARSER_VERSION,
      }));
      return {
        ...merged,
        transactions: sortTxs(reconcileCaptureDuplicates(merged.transactions)),
      };
    }
    case 'undoBatch': {
      const ids = new Set(action.ids);
      return { ...state, transactions: state.transactions.filter((t) => !ids.has(t.id)) };
    }
    case 'upsertBudget': {
      const others = state.budgets.filter((b) => b.category !== action.budget.category);
      return { ...state, budgets: [...others, action.budget] };
    }
    case 'deleteBudget':
      return { ...state, budgets: state.budgets.filter((b) => b.category !== action.category) };
    case 'addAccount':
      return { ...state, accounts: [...state.accounts, action.account] };
    case 'editAccount':
      return {
        ...state,
        accounts: state.accounts.map((a) => (a.id === action.id ? { ...a, ...action.patch } : a)),
      };
    case 'mergeRenewedCard':
      // The bank reissued the card; the user confirmed the two rows are one.
      return mergeRenewedCard(state, action.oldId, action.newId);
    case 'markCardsDistinct':
      return markCardsDistinct(state, action.id);
    case 'deleteAccount':
      return {
        ...state,
        accounts: state.accounts.filter((a) => a.id !== action.id),
        transactions: state.transactions.filter((t) => t.accountId !== action.id),
        cardDues: state.cardDues.filter((d) => d.accountId !== action.id),
        accountHints: Object.fromEntries(
          Object.entries(state.accountHints).filter(([, v]) => v !== action.id),
        ),
      };
    case 'addBill':
      return { ...state, bills: [...state.bills, action.bill] };
    case 'deleteBill':
      return { ...state, bills: state.bills.filter((b) => b.id !== action.id) };
    case 'markBillPaid': {
      const bills = state.bills.map((b) =>
        b.id === action.id && !b.paidMonths.includes(action.month)
          ? { ...b, paidMonths: [...b.paidMonths, action.month] }
          : b,
      );
      return { ...state, bills, transactions: sortTxs([action.transaction, ...state.transactions]) };
    }
    case 'upsertCardDue': {
      return {
        ...state,
        cardDues: mergeImportedCardDues(state.cardDues, [action.due], state.accounts),
      };
    }
    case 'payCardDue': {
      const cardDues = state.cardDues.map((d) =>
        d.id === action.id
          ? {
              ...d,
              // "Mark paid" records a transfer AND used to add the same amount
              // here, so the payment counted twice. Since the settled statement
              // could only absorb it once, the surplus spilled onto the next
              // statement and marked it paid without a real payment. The
              // recorded transfer is the single source of truth; paidFils only
              // moves when no transaction backs the payment.
              paidFils: action.transaction ? d.paidFils : d.paidFils + action.amountFils,
              settledAt: action.settledAt ?? d.settledAt,
            }
          : d,
      );
      const transactions = action.transaction
        ? sortTxs([action.transaction, ...state.transactions])
        : state.transactions;
      return { ...state, cardDues, transactions };
    }
    case 'setMerchantOverride': {
      const key = action.merchant.trim().toLowerCase();
      const merchantOverrides = { ...state.merchantOverrides, [key]: action.category };
      const transactions = action.applyToExisting
        ? state.transactions.map((t) =>
            // `overrideAppliesTo` is the ONE definition of this rule's blast
            // radius. The screen that offers the tap prints a count computed
            // from the same predicate, so the number the user reads and the
            // rows this line rewrites cannot drift apart. A bare key match
            // here — which is what this was — reverted hand-filed rows and
            // stamped expense categories onto income refunds, neither of
            // which was in the count printed on the button.
            //
            // `userEdited` is NOT set. It is immutable by the contract stated
            // on migratePersistedState, and a merchant rule is a default
            // rather than a per-row answer, so it must not masquerade as one:
            // pinning here would launder hundreds of rows the user never
            // opened into "hand-corrected" and hide them from every
            // measurement that counts on the distinction. Nothing is lost by
            // not pinning — the rule itself lives in `merchantOverrides`,
            // which both `guessCategory` and `parseSms` take as an input, so
            // a re-parse re-derives this category instead of undoing it.
            overrideAppliesTo(t, key) ? { ...t, category: action.category } : t,
          )
        : state.transactions;
      return { ...state, merchantOverrides, transactions };
    }
    case 'setNotSubscription': {
      const key = action.merchant.trim().toLowerCase();
      const rest = state.notSubscriptions.filter((m) => m !== key);
      return { ...state, notSubscriptions: action.dismissed ? [...rest, key] : rest };
    }
    case 'reassignAccountHint':
      return {
        ...state,
        accountHints: { ...state.accountHints, [action.last4]: action.accountId },
      };
    case 'addGoal':
      return { ...state, goals: [...state.goals, action.goal] };
    case 'editGoal':
      return {
        ...state,
        goals: state.goals.map((g) => (g.id === action.id ? { ...g, ...action.patch } : g)),
      };
    case 'deleteGoal':
      return { ...state, goals: state.goals.filter((g) => g.id !== action.id) };
    case 'setAppLock':
      return { ...state, appLock: action.enabled };
    case 'setDailySummary':
      return { ...state, dailySummary: action.enabled };
    case 'setPrivateMode':
      return {
        ...state,
        privateMode: action.enabled,
        // The change is immediate and retroactive: no low-confidence message
        // body survives after the switch says local-only.
        transactions: action.enabled
          ? state.transactions.map(({ raw: _discard, ...tx }) => tx)
          : state.transactions,
      };
    case 'applyFxUpdates': {
      const updates = new Map(action.updates.map((update) => [update.id, update]));
      if (updates.size === 0) return state;
      let changed = false;
      const transactions = state.transactions.map((tx) => {
        const update = updates.get(tx.id);
        // A bank-quoted AED equivalent is final. A late response from a
        // reference request must never replace it.
        if (!update || tx.fxSource !== 'fallback') return tx;
        changed = true;
        return { ...tx, ...update };
      });
      return changed ? { ...state, transactions } : state;
    }
    case 'setOnboarded':
      return { ...state, onboarded: true };
    case 'clearAll':
      return {
        ...EMPTY_STATE,
        hydrated: true,
        onboarded: true,
        accounts: [SEED_ACCOUNTS[2]],
      };
    default:
      return state;
  }
}

/**
 * Rescan healing: a message that deduped against an existing SMS row but now
 * parses BETTER (named merchant, real category, transfer flag) upgrades that
 * row in place instead of requiring an erase + reimport.
 */
export type { TxHealUpdate } from '@/lib/types';


interface StoreValue {
  state: AppState;
  /**
   * Non-null when persistence has failed in this process.
   *
   * Deliberately NOT part of `AppState`: `persist` writes everything in
   * AppState except `hydrated`, so a storage-failure flag living there would
   * be serialised into the very record whose write just failed.
   *
   * When this is set because HYDRATION failed, the state above was not read
   * from disk and saving is latched off — so `state.onboarded === false` here
   * means "we could not read your ledger", not "you are a new user". A screen
   * that shows onboarding needs to check this before it offers a fresh start.
   */
  storageFailure: StorageFailure | null;
  /**
   * True when HYDRATION failed and writes are latched off.
   *
   * Narrower than `storageFailure`, which is also set by a failed save. This
   * is the one that means "what is on screen is not the user's data", and it
   * is what the recovery screen keys on: while it is true, no surface may
   * offer onboarding, a fresh start or sample data, because the first save
   * afterwards would write that over a ledger that is still on the device.
   */
  hydrationFailed: boolean;
  /** A retry is in flight. The recovery screen stays up either way. */
  retryingHydration: boolean;
  /**
   * Read the ledger again. Resolves to whether the read SUCCEEDED — returned
   * rather than left to `hydrationFailed`, because a caller awaiting this has
   * a stale closure over that flag and would have to guess from whether it is
   * still mounted.
   */
  retryHydration: () => Promise<boolean>;
  addTransaction: (t: Omit<Transaction, 'id'>) => void;
  editTransaction: (id: string, patch: Partial<Omit<Transaction, 'id'>>) => void;
  deleteTransaction: (id: string) => void;
  /**
   * Bulk import. `durable` resolves only after SQLCipher has committed the
   * rows; relay callers must await it before acknowledging the server queue.
   */
  importBatch: (input: ImportBatchInput) => ImportReceipt;
  /**
   * Flush the current authoritative snapshot to SQLCipher. Relay callers use
   * this before acknowledging a row that deduped against in-memory state.
   */
  ensureDurable: () => Promise<void>;
  undoBatch: (ids: string[]) => void;
  upsertBudget: (b: Budget) => void;
  deleteBudget: (category: Budget['category']) => void;
  addAccount: (a: Omit<Account, 'id'>) => void;
  editAccount: (id: string, patch: Partial<Omit<Account, 'id'>>) => void;
  deleteAccount: (id: string) => void;
  /** Fold a reissued card's predecessor into it (user-confirmed). */
  mergeRenewedCard: (oldId: string, newId: string) => void;
  /** Remember that a suggested reissue link was declined. */
  markCardsDistinct: (id: string) => void;
  addBill: (b: Omit<Bill, 'id' | 'paidMonths'>) => void;
  deleteBill: (id: string) => void;
  markBillPaid: (id: string, month: string, transaction: Omit<Transaction, 'id'>) => void;
  upsertCardDue: (due: Omit<CardDue, 'id'>) => void;
  payCardDue: (id: string, amountFils: number, transaction: Omit<Transaction, 'id'> | null, settled: boolean) => void;
  setMerchantOverride: (merchant: string, category: CategoryId, applyToExisting: boolean) => void;
  setNotSubscription: (merchant: string, dismissed: boolean) => void;
  reassignAccountHint: (last4: string, accountId: string) => void;
  addGoal: (g: Omit<Goal, 'id'>) => void;
  editGoal: (id: string, patch: Partial<Omit<Goal, 'id'>>) => void;
  deleteGoal: (id: string) => void;
  markParserVersion: () => void;
  setAppLock: (enabled: boolean) => void;
  setPrivateMode: (enabled: boolean) => Promise<void>;
  setDailySummary: (enabled: boolean) => void;
  applyFxUpdates: (updates: FxUpdate[]) => void;
  setMonthStartDay: (day: number) => void;
  setThemePreference: (preference: string) => void;
  setPro: (pro: boolean) => void;
  setMarket: (id: string) => void;
  setUiLanguage: (language: string) => void;
  setOnboarded: () => void;
  exportBackup: () => string;
  restoreBackup: (json: string) => boolean;
  loadDemoData: () => void;
  /** Cryptographically erase the SQLCipher file/key, then create a blank store. */
  clearAll: () => Promise<void>;
}

const StoreContext = createContext<StoreValue | null>(null);

export interface ImportReceipt {
  ids: string[];
  durable: Promise<void>;
}

/**
 * The demo ledger.
 *
 * Everything here is DERIVED from one generated transaction list, in seed.ts,
 * rather than written down beside it. The hardcoded version of this function
 * carried a single AED 1,209 card due against a demo card that had actually
 * charged AED 18,060 and never repaid a fils of it — a figure with no relation
 * to the rows on the very next screen. SEED_BILLS moved to seed.ts for the same
 * reason: the bills' due days have to sit two days after the matching debits in
 * the seed's RECURRING table or the demo opens on an overdue row, and that is a
 * fact about the seed, not about the store.
 */
function demoState(): Partial<Omit<AppState, 'hydrated'>> {
  const now = new Date();
  const transactions = generateSeedTransactions(now);
  return {
    // Balances quoted against this ledger, not fixed constants — see
    // generateSeedAccounts.
    accounts: generateSeedAccounts(now, transactions),
    transactions,
    budgets: SEED_BUDGETS,
    bills: SEED_BILLS,
    // Derived from the same statement windows the seed's card payments were
    // written against, so the open due matches what the card actually spent.
    cardDues: generateSeedCardDues(now, transactions),
    // Six months of the demo's own outgoings, roughly 40% of the way there —
    // an AED 20,000 target next to a AED 93,000 bank balance read as a goal
    // already met and left on the screen by mistake.
    goals: [{ id: 'goal-demo', title: 'Emergency fund', emoji: 'target', targetFils: 6_000_000, savedFils: 2_400_000 }],
    onboarded: true,
    userName: 'there',
  };
}

/**
 * Transactions are stored in chunks. Older Android builds used AsyncStorage,
 * where a single row could exceed the cursor limit; current native builds use
 * the same chunk contract inside SQLCipher so migration is exact and writes
 * stay bounded. Meta (small) lives at STORAGE_KEY; rows live at :tx:N keys.
 */
const TX_CHUNK_SIZE = 400;
/** Collapses a burst of dispatches — import, rename, undo — into one write. */
const SAVE_DEBOUNCE_MS = 700;
const txChunkKey = (i: number) => `${STORAGE_KEY}:tx:${i}`;

type PersistedMeta = Partial<Omit<AppState, 'hydrated'>> & { txChunks?: number };

interface LoadedState {
  state: Partial<Omit<AppState, 'hydrated'>>;
  /** The chunk bodies exactly as they were on disk, to seed the write cache. */
  chunkBodies: string[];
}

async function loadPersisted(): Promise<LoadedState | null> {
  let raw = await stateStorage.getItem(STORAGE_KEY);
  if (!raw && (await migrateLegacyState(STORAGE_KEY))) {
    raw = await stateStorage.getItem(STORAGE_KEY);
  }
  if (!raw) return null;
  const parsed = JSON.parse(raw) as PersistedMeta;
  const chunkBodies: string[] = [];
  /** Any gap makes the index-aligned body cache unusable — see below. */
  let corrupt = false;
  if (!Array.isArray(parsed.transactions)) {
    const count = Number(parsed.txChunks) || 0;
    const txs: Transaction[] = [];
    if (count > 0) {
      const pairs = await stateStorage.multiGet(
        Array.from({ length: count }, (_, i) => txChunkKey(i)),
      );
      for (const [, v] of pairs) {
        if (!v) {
          corrupt = true;
          continue;
        }
        // Each chunk stands on its own. One throw here used to abort the
        // whole load, and the caller turns a failed load into a blank
        // onboarded=false state — so a single corrupt chunk presented as
        // "your data is gone", accounts, settings and all, while the other
        // chunks sat intact in storage. Losing 400 rows is bad; losing the
        // app is worse, and it is the same one-line failure either way.
        try {
          const rows = JSON.parse(v) as Transaction[];
          if (Array.isArray(rows)) {
            txs.push(...rows);
            // Seeds the save-time diff, so the first write after launch does
            // not rewrite every chunk it just read.
            chunkBodies.push(v);
          } else {
            corrupt = true;
          }
        } catch {
          // Skip it. The next save rewrites every chunk from memory — and the
          // body cache is dropped rather than left with a hole in it, because
          // it is diffed BY INDEX. Keeping the surviving bodies would shift
          // every chunk after the corrupt one against its stored twin and
          // suppress writes that were genuinely needed.
          corrupt = true;
        }
      }
    }
    parsed.transactions = txs;
  }
  delete parsed.txChunks;
  return { state: parsed, chunkBodies: corrupt ? [] : chunkBodies };
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState(EMPTY_STATE);
  /**
   * React may batch renders, but capture can deliver two relay batches in the
   * same turn. This ref is the ordered source of truth for every dispatch, so
   * the second batch always reduces over the first even before React renders.
   */
  const authoritativeState = useRef(EMPTY_STATE);
  const dispatch = useCallback((action: Action): AppState => {
    const next = reducer(authoritativeState.current, action);
    authoritativeState.current = next;
    setState(next);
    return next;
  }, []);
  const prevChunkCount = useRef(0);
  /** Last successfully written body per chunk, so unchanged ones are skipped. */
  const prevChunks = useRef<string[]>([]);
  /**
   * The transactions array as of the last save. Reducers return a NEW array
   * only when they actually touch transactions, so an identity check here is
   * exact — and it is what lets a settings toggle skip re-serialising the
   * whole ledger.
   */
  const prevTransactions = useRef<Transaction[] | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Serialises saves — see the comment where it is used. */
  const writeQueue = useRef<Promise<void>>(Promise.resolve());
  /**
   * Latched when hydration failed. While it is set, `persist` refuses to write
   * anything: the in-memory state was not read from disk, so saving it would
   * overwrite a ledger we could not load. See the hydration catch above.
   */
  const storageBlocked = useRef(false);
  const [storageFailure, setStorageFailure] = useState<StorageFailure | null>(null);
  /**
   * The renderable half of `storageBlocked`.
   *
   * The ref is what `persist` reads, because that guard has to be exact on the
   * same tick it is set; a ref does not re-render, and the recovery screen has
   * to appear. They are set together and only together.
   *
   * This is deliberately narrower than `storageFailure`, which is also set when
   * a SAVE fails. A failed save happens mid-session over data that was read
   * correctly, and taking the whole app away from someone at that point would
   * be worse than the failure — only an unreadable ledger justifies the
   * takeover, because only then is what is on screen not the user's data.
   */
  const [hydrationFailed, setHydrationFailed] = useState(false);
  const [retryingHydration, setRetryingHydration] = useState(false);
  const retryInFlight = useRef(false);
  /**
   * Supersedes an in-flight hydration. A retry started while the previous read
   * is still running, or an unmount, must not let the older attempt dispatch.
   */
  const hydrationRun = useRef(0);

  // Keep the native RTL flag in sync with the chosen language (takes effect
  // on the next app start — a React Native constraint).
  useEffect(() => {
    if (!state.hydrated || Platform.OS === 'web') return;
    const wantRTL = state.language === 'ar';
    if (I18nManager.isRTL !== wantRTL) {
      I18nManager.allowRTL(wantRTL);
      I18nManager.forceRTL(wantRTL);
    }
  }, [state.hydrated, state.language]);

  /**
   * Read the ledger and present it — on launch, and again on every retry.
   *
   * This used to be an anonymous IIFE inside the mount effect, which meant the
   * only way to try a second time was to relaunch the app. A read can fail for
   * reasons that go away on their own — the device was still locked, the file
   * was momentarily unavailable — and "force-stop and reopen" is not a
   * recovery instruction to give someone whose ledger is on the line.
   *
   * The contract for the recovery screen is at the bottom: the latch and the
   * failure record are cleared ONLY after a read that actually succeeded, and
   * a read that legitimately finds nothing counts as a success. Everything
   * else leaves both exactly as it found them, so a retry cannot flicker
   * onboarding into view on its way to failing again.
   */
  const hydrate = useCallback(async (): Promise<boolean> => {
    const run = ++hydrationRun.current;
    try {
      const loaded = await loadPersisted();
      if (hydrationRun.current !== run) return false;
      let next: Partial<Omit<AppState, 'hydrated'>> = { onboarded: false };
      if (loaded) {
        const parsed = loaded.state;
        prevChunkCount.current = Math.ceil((parsed.transactions?.length ?? 0) / TX_CHUNK_SIZE);
        // Seed the write cache with what is already on disk. Without this the
        // first save after every launch believes no chunk has ever been
        // written and rewrites the entire history — about a megabyte on a
        // heavy ledger, for no change at all.
        prevChunks.current = loaded.chunkBodies;
        prevTransactions.current = parsed.transactions ?? [];
        // Pre-onboarding builds stored data without the flag; count them as onboarded.
        if (parsed.onboarded === undefined) parsed.onboarded = true;
        next = migratePersistedState(parsed);
      }
      // The read SUCCEEDED. This is the only place writes are reopened, and
      // `loaded === null` — a database that is genuinely empty — reaches it
      // exactly like a database full of rows, because "there is nothing here"
      // is a real answer and only a THROW means we failed to get one.
      storageBlocked.current = false;
      setHydrationFailed(false);
      setStorageFailure(null);
      dispatch({ type: 'hydrate', state: next });
      return true;
    } catch (error) {
      if (hydrationRun.current !== run) return false;
      /**
       * A storage failure is NOT a first run, and this is the line that used
       * to say it was.
       *
       * `loadPersisted` returns null when there is genuinely nothing stored
       * and throws when the database could not be read. Both landed here and
       * both produced `onboarded: false` — so a phone whose ledger was
       * unreadable was shown onboarding, and then the first debounced save
       * 700ms later wrote a fresh empty state over the data we had just
       * failed to read. A transient read error became permanent data loss.
       *
       * So writes are latched off. The state we are about to present is not
       * derived from what is on disk, and it must never be allowed to replace
       * it. `hydrationFailed` puts the recovery screen over the top of it, so
       * the empty state dispatched here is never offered as onboarding.
       */
      storageBlocked.current = true;
      setHydrationFailed(true);
      setStorageFailure(recordStorageFailure('read', error));
      dispatch({ type: 'hydrate', state: { onboarded: false } });
      return false;
    }
  }, [dispatch]);

  useEffect(() => {
    void hydrate();
    // Bumping the run counter supersedes the in-flight read rather than
    // cancelling it: the same mechanism a retry uses.
    return () => {
      hydrationRun.current += 1;
    };
  }, [hydrate]);

  /**
   * Try the read again, without relaunching.
   *
   * Nothing is cleared on the way in. Writes stay latched and the recovery
   * screen stays up for the whole attempt, so a retry that fails again changes
   * nothing the user can see except the spinner, and a retry that succeeds
   * moves straight from the recovery screen to the real ledger.
   */
  const retryHydration = useCallback(async (): Promise<boolean> => {
    if (retryInFlight.current) return false;
    retryInFlight.current = true;
    setRetryingHydration(true);
    try {
      return await hydrate();
    } finally {
      retryInFlight.current = false;
      setRetryingHydration(false);
    }
  }, [hydrate]);

  /**
   * Persist. Three guards, because this runs on EVERY dispatch.
   *
   * The first is that transactions are only re-serialised when the array
   * identity changed. Chunk diffing already avoided rewriting unchanged
   * chunks, but the JSON.stringify that produced the bodies to compare ran
   * first — so flipping App Lock, editing a budget or dismissing a toast still
   * built roughly a megabyte of string on the JS thread at 5,000 rows, and
   * then threw it away. Those mutations now write the small meta key alone.
   *
   * The second is a debounce. An import batch, a rename and an undo arrive as
   * separate dispatches within a few hundred milliseconds, and each used to be
   * its own full write. They now collapse into one, flushed on the way to the
   * background so nothing is lost when the app is swiped away.
   *
   * The third is the write queue below. Debouncing makes overlapping saves
   * rarer but does not remove them — the background flush fires while a
   * debounced write may still be in flight — and two overlapping saves is a
   * data-loss bug, not a performance one.
   */
  const persist = useCallback((snapshot: AppState): Promise<boolean> => {
    // Fail closed. Hydration could not read the ledger, so nothing derived
    // from this session is allowed to replace it on disk.
    if (storageBlocked.current) return Promise.resolve(false);

    const { hydrated: _hydrated, transactions, ...meta } = snapshot;
    const txChanged = prevTransactions.current !== transactions;

    let chunks: [string, string][] | null = null;
    if (txChanged) {
      chunks = [];
      for (let i = 0; i * TX_CHUNK_SIZE < transactions.length; i++) {
        chunks.push([
          txChunkKey(i),
          JSON.stringify(transactions.slice(i * TX_CHUNK_SIZE, (i + 1) * TX_CHUNK_SIZE)),
        ]);
      }
    }
    const chunkCount = chunks ? chunks.length : prevChunkCount.current;

    // Saves run ONE AT A TIME, chained onto whatever is still in flight.
    //
    // Two state changes in quick succession — an import followed by the
    // parser-version stamp, say — used to start two overlapping writes. Each
    // writes the meta record, and meta carries txChunks, the number of chunk
    // keys the loader will ask for. If the smaller save's meta landed last,
    // the count said 3 while 4 chunks existed on disk, and the loader read
    // three of them: 400 transactions gone, silently, with the data still
    // sitting in storage. The bookkeeping refs below have the same problem —
    // they are read and written across an await.
    //
    // Chaining makes the last save's meta the one that survives, which is the
    // only correct answer, and lets the diff be computed against a cache that
    // is actually current.
    const operation = writeQueue.current.then(async () => {
      try {
        // Computed in here, not outside: out here `prevChunks` may still be
        // the value from before the write that is currently in flight.
        const changed = chunks
          ? chunks.filter(([, body], i) => prevChunks.current[i] !== body)
          : [];
        await stateStorage.multiSet([
          [STORAGE_KEY, JSON.stringify({ ...meta, txChunks: chunkCount })],
          ...changed,
        ]);
        if (chunks && prevChunkCount.current > chunks.length) {
          await stateStorage.multiRemove(
            Array.from({ length: prevChunkCount.current - chunks.length }, (_, i) =>
              txChunkKey(chunks!.length + i),
            ),
          );
        }
        if (chunks) {
          prevChunkCount.current = chunks.length;
          prevChunks.current = chunks.map(([, body]) => body);
        }
        prevTransactions.current = transactions;
        return true;
      } catch (error) {
        // Persistence is best-effort; the in-memory state stays authoritative.
        // The caches are cleared so the next save rewrites every chunk rather
        // than assuming a failed write landed.
        //
        // "Best-effort" used to mean the error vanished here, which is how a
        // write path that failed on EVERY save on Android went unnoticed
        // through two signed releases. It is recorded now, and the reason is
        // readable both in logcat and from the device.
        prevChunks.current = [];
        prevTransactions.current = null;
        setStorageFailure(recordStorageFailure('write', error));
        return false;
      }
    });
    // Keep the shared queue non-rejecting so one failed device write cannot
    // prevent every later save from running. Callers that require durability
    // inspect `operation` separately.
    writeQueue.current = operation.then(() => undefined);
    return operation;
  }, []);

  useEffect(() => {
    if (!state.hydrated) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      persist(authoritativeState.current);
    }, SAVE_DEBOUNCE_MS);
  }, [state, persist]);

  // A debounce that loses the last write when the app is swiped away is a data
  // loss bug, so leaving the foreground flushes immediately.
  useEffect(() => {
    const sub = RNAppState.addEventListener('change', (next) => {
      if (next !== 'background' && next !== 'inactive') return;
      if (!saveTimer.current) return;
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      persist(authoritativeState.current);
    });
    return () => {
      sub.remove();
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        persist(authoritativeState.current);
      }
    };
  }, [persist]);

  const addTransaction = useCallback((t: Omit<Transaction, 'id'>) => {
    dispatch({ type: 'addTransaction', transaction: { ...t, id: makeId('tx') } });
  }, []);

  const editTransaction = useCallback((id: string, patch: Partial<Omit<Transaction, 'id'>>) => {
    dispatch({ type: 'editTransaction', id, patch });
  }, []);

  const deleteTransaction = useCallback((id: string) => {
    dispatch({ type: 'deleteTransaction', id });
  }, []);

  const importBatch = useCallback((input: ImportBatchInput): ImportReceipt => {
    const newAccounts: Account[] = input.newAccounts.map((a) => ({ ...a, id: makeId('acc') }));
    // Hints pointing at a numeric index refer to a just-created account.
    const newHints: Record<string, string> = {};
    for (const [last4, ref] of Object.entries(input.newHints)) {
      const idx = Number(ref);
      newHints[last4] = Number.isInteger(idx) && idx >= 0 && idx < newAccounts.length && String(idx) === ref
        ? newAccounts[idx].id
        : ref;
    }
    const base = authoritativeState.current;
    const transactions: Transaction[] = input.transactions.map((t) => ({
      ...t,
      // Private Mode keeps the structured row and drops source text at the
      // ingestion boundary, before it can reach React state or persistence.
      raw: base.privateMode ? undefined : t.raw,
      // Resolve index-refs in accountId the same way.
      accountId:
        /^\d+$/.test(t.accountId) && Number(t.accountId) < newAccounts.length
          ? newAccounts[Number(t.accountId)].id
          : t.accountId,
      id: makeId('tx'),
    }));
    const newDues: CardDue[] = input.newDues.map((d) => ({
      ...d,
      accountId:
        /^\d+$/.test(d.accountId) && Number(d.accountId) < newAccounts.length
          ? newAccounts[Number(d.accountId)].id
          : d.accountId,
      id: makeId('due'),
    }));
    const snapshots: ImportBatchInput['snapshots'] = {};
    for (const [ref, snap] of Object.entries(input.snapshots ?? {})) {
      const id =
        /^\d+$/.test(ref) && Number(ref) < newAccounts.length ? newAccounts[Number(ref)].id : ref;
      snapshots[id] = snap;
    }
    const bankNames: Record<string, string> = {};
    for (const [ref, bank] of Object.entries(input.bankNames ?? {})) {
      const id =
        /^\d+$/.test(ref) && Number(ref) < newAccounts.length ? newAccounts[Number(ref)].id : ref;
      bankNames[id] = bank;
    }
    const cardTypes: NonNullable<ImportBatchInput['cardTypes']> = {};
    for (const [ref, cardType] of Object.entries(input.cardTypes ?? {})) {
      const id =
        /^\d+$/.test(ref) && Number(ref) < newAccounts.length ? newAccounts[Number(ref)].id : ref;
      cardTypes[id] = cardType;
    }
    const action: Action = {
      type: 'importBatch',
      transactions,
      newAccounts,
      newHints,
      newDues,
      snapshots,
      bankNames,
      cardTypes,
      lastScanTs: input.lastScanTs,
      updates: (input.updates ?? []).map((update) => ({
        ...update,
        accountId:
          update.accountId && /^\d+$/.test(update.accountId) && Number(update.accountId) < newAccounts.length
            ? newAccounts[Number(update.accountId)].id
            : update.accountId,
      })),
    };
    // React dispatch is intentionally not treated as persistence. Compute the
    // exact next snapshot from the same action and enqueue its encrypted write
    // now, bypassing the ordinary 700 ms UI debounce.
    // A timer armed by an earlier UI action must not enqueue its older
    // snapshot behind this durability write. All future timers read the
    // authoritative ref, and this one is cancelled before the import lands.
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const next = dispatch(action);
    const durable = persist(next).then((written) => {
      if (!written) throw new Error('Encrypted ledger write failed');
    });
    return { ids: transactions.map((t) => t.id), durable };
  }, [dispatch, persist]);

  const ensureDurable = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const written = await persist(authoritativeState.current);
    if (!written) throw new Error('Encrypted ledger write failed');
  }, [persist]);

  const undoBatch = useCallback((ids: string[]) => {
    dispatch({ type: 'undoBatch', ids });
  }, []);

  const upsertBudget = useCallback((budget: Budget) => {
    dispatch({ type: 'upsertBudget', budget });
  }, []);

  const deleteBudget = useCallback((category: Budget['category']) => {
    dispatch({ type: 'deleteBudget', category });
  }, []);

  const addAccount = useCallback((a: Omit<Account, 'id'>) => {
    dispatch({ type: 'addAccount', account: { ...a, id: makeId('acc') } });
  }, []);

  const editAccount = useCallback((id: string, patch: Partial<Omit<Account, 'id'>>) => {
    dispatch({ type: 'editAccount', id, patch });
  }, []);

  const deleteAccount = useCallback((id: string) => {
    dispatch({ type: 'deleteAccount', id });
  }, []);

  const mergeRenewedCardAction = useCallback((oldId: string, newId: string) => {
    dispatch({ type: 'mergeRenewedCard', oldId, newId });
  }, []);

  const markCardsDistinctAction = useCallback((id: string) => {
    dispatch({ type: 'markCardsDistinct', id });
  }, []);

  const addBill = useCallback((b: Omit<Bill, 'id' | 'paidMonths'>) => {
    dispatch({ type: 'addBill', bill: { ...b, id: makeId('bill'), paidMonths: [] } });
  }, []);

  const deleteBill = useCallback((id: string) => {
    dispatch({ type: 'deleteBill', id });
  }, []);

  const markBillPaid = useCallback(
    (id: string, month: string, transaction: Omit<Transaction, 'id'>) => {
      dispatch({ type: 'markBillPaid', id, month, transaction: { ...transaction, id: makeId('tx') } });
    },
    [],
  );

  const upsertCardDue = useCallback((due: Omit<CardDue, 'id'>) => {
    dispatch({ type: 'upsertCardDue', due: { ...due, id: makeId('due') } });
  }, []);

  const payCardDue = useCallback(
    (id: string, amountFils: number, transaction: Omit<Transaction, 'id'> | null, settled: boolean) => {
      dispatch({
        type: 'payCardDue',
        id,
        amountFils,
        transaction: transaction ? { ...transaction, id: makeId('tx') } : null,
        settledAt: settled ? new Date().toISOString() : null,
      });
    },
    [],
  );

  const setMerchantOverride = useCallback(
    (merchant: string, category: CategoryId, applyToExisting: boolean) => {
      dispatch({ type: 'setMerchantOverride', merchant, category, applyToExisting });
    },
    [],
  );

  const setNotSubscription = useCallback((merchant: string, dismissed: boolean) => {
    dispatch({ type: 'setNotSubscription', merchant, dismissed });
  }, []);

  const reassignAccountHint = useCallback((last4: string, accountId: string) => {
    dispatch({ type: 'reassignAccountHint', last4, accountId });
  }, []);

  const addGoal = useCallback((g: Omit<Goal, 'id'>) => {
    dispatch({ type: 'addGoal', goal: { ...g, id: makeId('goal') } });
  }, []);

  const editGoal = useCallback((id: string, patch: Partial<Omit<Goal, 'id'>>) => {
    dispatch({ type: 'editGoal', id, patch });
  }, []);

  const deleteGoal = useCallback((id: string) => {
    dispatch({ type: 'deleteGoal', id });
  }, []);

  const markParserVersion = useCallback(() => {
    dispatch({ type: 'markParserVersion' });
  }, []);

  const setAppLock = useCallback((enabled: boolean) => {
    dispatch({ type: 'setAppLock', enabled });
  }, []);

  const setDailySummary = useCallback((enabled: boolean) => {
    dispatch({ type: 'setDailySummary', enabled });
  }, []);

  const setPrivateMode = useCallback(async (enabled: boolean) => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const next = dispatch({ type: 'setPrivateMode', enabled });
    const written = await persist(next);
    if (!written) throw new Error('Private Mode could not be saved');
  }, [dispatch, persist]);

  const applyFxUpdates = useCallback((updates: FxUpdate[]) => {
    dispatch({ type: 'applyFxUpdates', updates });
  }, []);

  const setOnboarded = useCallback(() => {
    dispatch({ type: 'setOnboarded' });
  }, []);

  const setThemePreference = useCallback((preference: string) => {
    dispatch({ type: 'setThemePreference', preference });
  }, []);

  const setMonthStartDay = useCallback((day: number) => {
    dispatch({ type: 'setMonthStartDay', day });
  }, []);

  const setPro = useCallback((pro: boolean) => {
    dispatch({ type: 'setPro', pro });
  }, []);

  const setMarket = useCallback((id: string) => {
    dispatch({ type: 'setMarket', id });
  }, []);

  const setUiLanguage = useCallback((language: string) => {
    dispatch({ type: 'setUiLanguage', language });
  }, []);

  const exportBackup = useCallback(() => {
    const { hydrated: _h, ...data } = state;
    return JSON.stringify({ app: 'wafra', version: 1, exportedAt: new Date().toISOString(), data });
  }, [state]);

  const restoreBackup = useCallback((json: string): boolean => {
    const restored = parseBackupForRestore(json);
    if (!restored) return false;
    dispatch({ type: 'restore', state: restored });
    return true;
  }, [dispatch]);

  const loadDemoData = useCallback(() => {
    dispatch({ type: 'loadDemo', state: demoState() });
  }, []);

  const clearAll = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }

    /**
     * Latch writes off BEFORE the blank state exists anywhere.
     *
     * Cancelling the debounce above is not enough, and neither is the write
     * queue. The dispatch below moves `authoritativeState` to blank and
     * re-renders, which schedules a FRESH 700 ms save of that blank state —
     * and every save reads the ref at fire time, so it is the blank state it
     * will write. That is intended when the erase succeeds. It is data loss
     * when the erase fails:
     *
     *   dispatch(clearAll)          → authoritative ref is blank, timer armed
     *   destroy() rejects           → the ledger is STILL ON DISK, readable
     *   writeQueue recovery resolves → the queue is deliberately non-rejecting
     *   timer fires at t+700ms      → persist(blank) chains onto that queue
     *   multiSet(blank)             → the retained ledger is overwritten
     *
     * The queue orders those writes correctly; correct ordering is exactly
     * what lands the blank write on the surviving database. `destroy` can
     * fail with the file and the key both intact — `state-storage.native.ts`
     * records a key error and a database error and still throws — and those
     * two failures are coupled in practice: expo-sqlite refuses to delete an
     * open database when `closeAsync` failed, and SecureStore cannot delete a
     * key while the Keystore is unavailable. The old database then reopens
     * with its retained key and the blank write commits, while Settings is
     * telling the user the erase failed.
     *
     * So the latch closes here, before the dispatch, and stays closed for the
     * whole operation. It is reopened below only on the success path.
     */
    storageBlocked.current = true;

    // What the ledger actually held before this call touched anything. The
    // dispatch below overwrites `authoritativeState.current` with blank, so
    // this has to be taken first — it is what gets put back on screen if the
    // erase fails.
    const previousState = authoritativeState.current;

    // Move the UI and authoritative ref to the blank state first. Any timer
    // or mutation that arrives while the erase is in flight can therefore
    // only write the blank/new state, never resurrect the old ledger.
    dispatch({ type: 'clearAll' });

    // All older encrypted writes finish before the cryptographic erase. The
    // queue remains non-rejecting for future writes, while this caller keeps
    // the real result so Settings cannot report success on failure.
    const destroyOperation = writeQueue.current.then(() => stateStorage.destroy(STORAGE_KEY));
    writeQueue.current = destroyOperation.then(
      () => undefined,
      () => undefined,
    );
    try {
      // Throws if the erase failed. A ledger we failed to erase is still on
      // disk and still readable, and until the catch below runs, the screen
      // is showing blank — a lie about what is actually retained.
      await destroyOperation;
    } catch (error) {
      // Put back what was on screen before this call, so a failed erase
      // looks like a failed erase, not a successful one that also lost the
      // ledger from view.
      //
      // The latch stays CLOSED here, not restored to whatever it was on
      // entry: `destroy` can fail with the key or the database file only
      // partially removed, and there is no way from here to tell which.
      // Reopening writes onto a store in that state is the exact bug this
      // latch exists to prevent. `hydrationFailed` goes up too, so the
      // recovery screen blocks further unsaved edits until the app restarts
      // or a backup is restored — the alternative is a user typing new
      // transactions into a session that can never save them.
      dispatch({ type: 'restore', state: previousState });
      setStorageFailure(recordStorageFailure('destroy', error));
      setHydrationFailed(true);
      throw error;
    }

    prevChunkCount.current = 0;
    prevChunks.current = [];
    prevTransactions.current = null;

    /**
     * The erase SUCCEEDED, so the latch has nothing left to protect. This is
     * the ONLY path that reopens writes during an erase — reached after the
     * await, so a rejection can never arrive here.
     *
     * `storageBlocked` exists to stop this session's empty state from
     * overwriting a ledger we failed to read. That ledger no longer exists:
     * its file is deleted and its key is gone from the Keychain. Leaving the
     * latch closed here was the bug — `destroy` really did erase everything,
     * then `persist` returned false because the latch was still set, and
     * `clearAll` threw "Blank encrypted store could not be created". Settings
     * reported a failure for an erase that had completely succeeded, and the
     * user was left with no ledger and a screen saying so.
     *
     * Cleared BEFORE the write, not after, because it is the write that the
     * latch would otherwise refuse.
     */
    storageBlocked.current = false;
    setHydrationFailed(false);
    setStorageFailure(null);

    // Recreate only the minimal blank state under a fresh random key. Waiting
    // here makes "Erase" a completed operation, not a 700 ms intention. A
    // failure here is a real one and is reported as such: `persist` records it
    // and puts it back on `storageFailure`, so the screen shows what happened
    // rather than a success it cannot back up.
    const written = await persist(authoritativeState.current);
    if (!written) throw new Error('Blank encrypted store could not be created');
  }, [dispatch, persist]);

  const value = useMemo(
    () => ({
      state,
      storageFailure,
      hydrationFailed,
      retryingHydration,
      retryHydration,
      addTransaction,
      editTransaction,
      deleteTransaction,
      importBatch,
      ensureDurable,
      undoBatch,
      upsertBudget,
      deleteBudget,
      addAccount,
      editAccount,
      deleteAccount,
      mergeRenewedCard: mergeRenewedCardAction,
      markCardsDistinct: markCardsDistinctAction,
      addBill,
      deleteBill,
      markBillPaid,
      upsertCardDue,
      payCardDue,
      setMerchantOverride,
      setNotSubscription,
      reassignAccountHint,
      addGoal,
      editGoal,
      deleteGoal,
      markParserVersion,
      setAppLock,
      setDailySummary,
      setPrivateMode,
      applyFxUpdates,
      setMonthStartDay,
      setThemePreference,
      setPro,
      setMarket,
      setUiLanguage,
      setOnboarded,
      exportBackup,
      restoreBackup,
      loadDemoData,
      clearAll,
    }),
    [
      state,
      storageFailure,
      hydrationFailed,
      retryingHydration,
      retryHydration,
      addTransaction,
      editTransaction,
      deleteTransaction,
      importBatch,
      ensureDurable,
      undoBatch,
      upsertBudget,
      deleteBudget,
      addAccount,
      editAccount,
      deleteAccount,
      mergeRenewedCardAction,
      markCardsDistinctAction,
      addBill,
      deleteBill,
      markBillPaid,
      upsertCardDue,
      payCardDue,
      setMerchantOverride,
      setNotSubscription,
      reassignAccountHint,
      addGoal,
      editGoal,
      deleteGoal,
      markParserVersion,
      setAppLock,
      setDailySummary,
      setPrivateMode,
      applyFxUpdates,
      setMonthStartDay,
      setThemePreference,
      setPro,
      setMarket,
      setUiLanguage,
      setOnboarded,
      exportBackup,
      restoreBackup,
      loadDemoData,
      clearAll,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}

// Pure balance math lives in balances.ts so the unit-test harness can load
// it without React; re-exported here so screens keep one import path.
export { accountBalanceFils, netWorthFils, reliableBalanceFils } from './balances';

/** Net worth as of end-of-day on the given ISO date. */
export function netWorthAtDate(state: AppState, dateISO: string): number {
  // Same two rules as netWorthSeries: hidden accounts are not part of net
  // worth, and a transfer between your own accounts moves nothing — including
  // the arriving side, which the bank words like ordinary income and which
  // therefore carries no transfer flag of its own.
  const live = new Set(state.accounts.filter((a) => !a.archived).map((a) => a.id));
  const internal = internalTransferIds(state.transactions, live);
  let total = state.accounts.reduce((sum, a) => (a.archived ? sum : sum + a.openingFils), 0);
  for (const t of state.transactions) {
    if (t.isTransfer || internal.has(t.id) || !live.has(t.accountId)) continue;
    if (t.date > dateISO) continue;
    total += t.type === 'income' ? t.amountFils : -t.amountFils;
  }
  return total;
}
