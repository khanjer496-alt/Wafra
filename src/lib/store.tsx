import AsyncStorage from '@react-native-async-storage/async-storage';
import { I18nManager, Platform } from 'react-native';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';

import { mergeDuplicateAccounts } from '@/lib/accounts';
import { setMonthStartDay as applyMonthStartDay, toISODate } from '@/lib/format';
import { setThemePreference as applyThemePreference } from '@/lib/theme-preference';
import { detectLanguage, setLanguage } from '@/lib/i18n';
import { detectMarketId, setActiveMarket } from '@/lib/markets';
import { generateSeedTransactions, SEED_ACCOUNTS, SEED_BUDGETS } from '@/lib/seed';
import { guessCategory, normalizeServiceName, parseSms, STRUCTURAL_TITLES } from '@/lib/sms-parser';
import type {
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
      lastScanTs: number;
      updates: TxHealUpdate[];
    }
  | { type: 'undoBatch'; ids: string[] }
  | { type: 'upsertBudget'; budget: Budget }
  | { type: 'deleteBudget'; category: Budget['category'] }
  | { type: 'addAccount'; account: Account }
  | { type: 'editAccount'; id: string; patch: Partial<Omit<Account, 'id'>> }
  | { type: 'deleteAccount'; id: string }
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
  | { type: 'setMonthStartDay'; day: number }
  | { type: 'setThemePreference'; preference: string }
  | { type: 'setPro'; pro: boolean }
  | { type: 'setMarket'; id: string }
  | { type: 'setUiLanguage'; language: string }
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
      return mergeDuplicateAccounts(next);
    }
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
        state.transactions.map((t) =>
          // userEdited pins the row: nothing re-parsed may overwrite it later.
          t.id === action.id ? { ...t, ...action.patch, userEdited: true } : t,
        ),
      );
      return { ...state, transactions };
    }
    case 'deleteTransaction':
      return { ...state, transactions: state.transactions.filter((t) => t.id !== action.id) };
    case 'importBatch': {
      const dues = [...state.cardDues];
      for (const due of action.newDues) {
        const i = dues.findIndex((d) => d.accountId === due.accountId && !d.settledAt);
        if (i >= 0) dues[i] = { ...due, id: dues[i].id };
        else dues.push(due);
      }
      const accounts = [...state.accounts, ...action.newAccounts].map((a) => {
        const snap = action.snapshots[a.id];
        const bank = !a.bankName ? action.bankNames[a.id] : undefined;
        let next = a;
        if (snap && snap.ts > (a.snapshotTs ?? 0)) {
          next = { ...next, snapshotFils: snap.fils, snapshotKind: snap.kind, snapshotTs: snap.ts };
        }
        if (bank) next = { ...next, bankName: bank };
        return next;
      });
      // Heal existing rows the parser now reads better.
      const patches = new Map(action.updates.map((u) => [u.id, u]));
      const existing =
        patches.size > 0
          ? state.transactions
              .filter((t) => !patches.get(t.id)?.remove)
              .map((t) => {
                const u = patches.get(t.id);
                if (!u) return t;
                return {
                  ...t,
                  ...(u.title !== undefined ? { title: u.title } : null),
                  ...(u.category !== undefined ? { category: u.category } : null),
                  ...(u.type !== undefined ? { type: u.type } : null),
                  ...(u.isTransfer !== undefined ? { isTransfer: u.isTransfer } : null),
                  ...(u.raw !== undefined ? { raw: u.raw } : null),
                };
              })
          : state.transactions;
      return {
        ...state,
        transactions: sortTxs([...action.transactions, ...existing]),
        accounts,
        accountHints: { ...state.accountHints, ...action.newHints },
        cardDues: dues,
        lastScanTs: Math.max(state.lastScanTs, action.lastScanTs),
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
      const i = state.cardDues.findIndex(
        (d) => d.accountId === action.due.accountId && !d.settledAt,
      );
      const cardDues = [...state.cardDues];
      if (i >= 0) cardDues[i] = { ...action.due, id: cardDues[i].id };
      else cardDues.push(action.due);
      return { ...state, cardDues };
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
            // Bulk recategorisation is a user decision too, so these rows are
            // pinned against re-parsing exactly like a single edit.
            t.title.trim().toLowerCase() === key
              ? { ...t, category: action.category, userEdited: true }
              : t,
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

export interface ImportBatchInput {
  transactions: Omit<Transaction, 'id'>[];
  newAccounts: Omit<Account, 'id'>[];
  /** last4 → index into newAccounts OR existing accountId. */
  newHints: Record<string, string>;
  newDues: Omit<CardDue, 'id'>[];
  /** accountRef → newest bank-quoted balance/limit figure from the scan. */
  snapshots: Record<string, { fils: number; kind: 'balance' | 'limit' | 'outstanding'; ts: number }>;
  /** accountRef → bank name learned from the SMS sender (backfill only). */
  bankNames: Record<string, string>;
  lastScanTs: number;
  updates?: TxHealUpdate[];
}

interface StoreValue {
  state: AppState;
  addTransaction: (t: Omit<Transaction, 'id'>) => void;
  editTransaction: (id: string, patch: Partial<Omit<Transaction, 'id'>>) => void;
  deleteTransaction: (id: string) => void;
  /** Bulk import; returns the created transaction ids for undo. */
  importBatch: (input: ImportBatchInput) => string[];
  undoBatch: (ids: string[]) => void;
  upsertBudget: (b: Budget) => void;
  deleteBudget: (category: Budget['category']) => void;
  addAccount: (a: Omit<Account, 'id'>) => void;
  editAccount: (id: string, patch: Partial<Omit<Account, 'id'>>) => void;
  deleteAccount: (id: string) => void;
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
  setAppLock: (enabled: boolean) => void;
  setMonthStartDay: (day: number) => void;
  setThemePreference: (preference: string) => void;
  setPro: (pro: boolean) => void;
  setMarket: (id: string) => void;
  setUiLanguage: (language: string) => void;
  setOnboarded: () => void;
  exportBackup: () => string;
  restoreBackup: (json: string) => boolean;
  loadDemoData: () => void;
  clearAll: () => void;
}

const StoreContext = createContext<StoreValue | null>(null);

const SEED_BILLS: Bill[] = [
  { id: 'bill-dewa', title: 'DEWA Bill', category: 'utilities', amountFils: 45_000, dueDay: 25, paidMonths: [] },
  { id: 'bill-etisalat', title: 'Etisalat Postpaid', category: 'telecom', amountFils: 19_900, dueDay: 5, paidMonths: [] },
  { id: 'bill-du', title: 'du Home Internet', category: 'telecom', amountFils: 38_900, dueDay: 10, paidMonths: [] },
];

function demoState(): Partial<Omit<AppState, 'hydrated'>> {
  return {
    accounts: SEED_ACCOUNTS,
    transactions: generateSeedTransactions(new Date()),
    budgets: SEED_BUDGETS,
    bills: SEED_BILLS,
    goals: [{ id: 'goal-demo', title: 'Emergency fund', emoji: 'target', targetFils: 2_000_000, savedFils: 650_000 }],
    onboarded: true,
    userName: 'there',
  };
}

/**
 * Transactions are stored in chunks: Android's AsyncStorage keeps each key in
 * a single SQLite row capped at ~2MB, and a full SMS history in one blob blew
 * past it — the save "worked" but every read failed, so the app opened as if
 * brand new. Meta (small) lives at STORAGE_KEY; rows live at :tx:N keys.
 */
const TX_CHUNK_SIZE = 400;
const txChunkKey = (i: number) => `${STORAGE_KEY}:tx:${i}`;

type PersistedMeta = Partial<Omit<AppState, 'hydrated'>> & { txChunks?: number };

async function loadPersisted(): Promise<Partial<Omit<AppState, 'hydrated'>> | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as PersistedMeta;
  if (!Array.isArray(parsed.transactions)) {
    const count = Number(parsed.txChunks) || 0;
    const txs: Transaction[] = [];
    if (count > 0) {
      const pairs = await AsyncStorage.multiGet(
        Array.from({ length: count }, (_, i) => txChunkKey(i)),
      );
      for (const [, v] of pairs) {
        if (v) txs.push(...(JSON.parse(v) as Transaction[]));
      }
    }
    parsed.transactions = txs;
  }
  delete parsed.txChunks;
  return parsed;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, EMPTY_STATE);
  const prevChunkCount = useRef(0);
  /** Last successfully written body per chunk, so unchanged ones are skipped. */
  const prevChunks = useRef<string[]>([]);
  /** Identity of the last transactions array serialised, and its chunks. */
  const prevTransactions = useRef<Transaction[] | null>(null);
  const pendingChunks = useRef<[string, string][]>([]);

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await loadPersisted();
        if (cancelled) return;
        if (loaded) {
          const parsed = loaded;
          prevChunkCount.current = Math.ceil((parsed.transactions?.length ?? 0) / TX_CHUNK_SIZE);
          // Pre-onboarding builds stored data without the flag; count them as onboarded.
          if (parsed.onboarded === undefined) parsed.onboarded = true;
          // Repair rows imported before the masked-PAN parser fix: titles like
          // "4782********4833 Has Bee..." are card settlements, not spending.
          if (parsed.transactions) {
            parsed.transactions = parsed.transactions
              .map((t) =>
                t.source === 'sms' && /^\d{4,6}[Xx*•]{2,}\d{4}/.test(t.title)
                  ? { ...t, title: 'Card payment', isTransfer: true, category: 'other' as const }
                  : t,
              )
              // Amounts above AED 1M in a single SMS are misread balances/refs.
              .filter((t) => t.source !== 'sms' || t.amountFils <= 100_000_000)
              // Income mis-filed into spending categories (a Talabat payout is
              // revenue, not dining): re-file as business/salary.
              .map((t) =>
                t.source === 'sms' &&
                t.type === 'income' &&
                !['salary', 'business', 'other'].includes(t.category)
                  ? { ...t, category: 'business' as const }
                  : t,
              )
              // Unify service descriptors so ChatGPT/Claude/Real-Debrid etc.
              // read clearly and group as one subscription.
              .map((t) => {
                if (t.source !== 'sms') return t;
                const canonical = normalizeServiceName(t.title);
                return canonical && canonical !== t.title ? { ...t, title: canonical } : t;
              });
            // Collapse exact SMS duplicates left by rescans across parser
            // versions (same day/amount/type/title). Keep the newest import —
            // it carries the best parsing and the right card account.
            const importTs = (id: string) => Number(id.split('-')[1]) || 0;
            const best = new Map<string, (typeof parsed.transactions)[number]>();
            for (const t of parsed.transactions) {
              if (t.source !== 'sms') continue;
              const k = `${t.date}|${t.amountFils}|${t.type}|${t.title.trim().toLowerCase()}`;
              const cur = best.get(k);
              if (!cur || importTs(t.id) > importTs(cur.id)) best.set(k, t);
            }
            parsed.transactions = parsed.transactions.filter((t) => {
              if (t.source !== 'sms') return true;
              const k = `${t.date}|${t.amountFils}|${t.type}|${t.title.trim().toLowerCase()}`;
              return best.get(k)?.id === t.id;
            });
            // Re-file rows stuck in Other: each parser release widens the
            // merchant vocabulary, so imported-as-Other rows get another
            // chance without needing a rescan. User overrides still win.
            parsed.transactions = parsed.transactions.map((t) => {
              if (t.source !== 'sms' || t.isTransfer || t.category !== 'other' || t.type !== 'expense') {
                return t;
              }
              const guessed = guessCategory(t.title, t.type, parsed.merchantOverrides, t.title);
              return guessed !== 'other' ? { ...t, category: guessed } : t;
            });
            // Rows that kept their raw SMS re-parse under the CURRENT grammar
            // on every launch: junk that no longer parses (promos, BNPL
            // previews, reminders) disappears, misread rows get their real
            // title/category/transfer flag, and rows the grammar now fully
            // understands drop their raw. No rescan needed.
            if (parsed.marketId) setActiveMarket(parsed.marketId);
            parsed.transactions = parsed.transactions.flatMap((t) => {
              if (!t.raw || t.source !== 'sms') return [t];
              // A hand-corrected row is the user's answer, not the parser's.
              if (t.userEdited) return [t];
              const p = parseSms(t.raw, parsed.merchantOverrides);
              if (!p) return []; // no longer a transaction at all
              if (p.kind === 'billDue' || p.kind === 'cardStatement') return []; // was a reminder
              const next = { ...t };
              if (
                p.merchant !== 'Card purchase' &&
                p.merchant !== t.title &&
                (t.title === 'Card purchase' || t.category === 'other')
              ) {
                next.title = p.merchant;
              }
              if (t.category === 'other' && p.categoryGuess !== 'other' && !t.isTransfer) {
                next.category = p.categoryGuess;
              }
              if ((p.transferHint || p.kind === 'cardPayment') && !t.isTransfer) {
                next.isTransfer = true;
              }
              const stillLow =
                !next.isTransfer &&
                next.type === 'expense' &&
                (next.title === 'Card purchase' ||
                  (next.category === 'other' && !STRUCTURAL_TITLES.has(next.title)));
              if (!stillLow) delete next.raw;
              return [next];
            });
          }
          // Drop stale unsettled card dues, and dues attached to anything that
          // is not a credit card (statement dues only exist for credit cards).
          if (parsed.cardDues) {
            const cutoff = toISODate(new Date(Date.now() - 60 * 86400000));
            const creditIds = new Set(
              (parsed.accounts ?? []).filter((a) => a.cardType === 'credit').map((a) => a.id),
            );
            parsed.cardDues = parsed.cardDues.filter(
              (d) => (d.settledAt || d.dueDate >= cutoff) && creditIds.has(d.accountId),
            );
          }
          dispatch({ type: 'hydrate', state: parsed });
        } else {
          dispatch({ type: 'hydrate', state: { onboarded: false } });
        }
      } catch {
        if (!cancelled) dispatch({ type: 'hydrate', state: { onboarded: false } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!state.hydrated) return;
    const { hydrated: _hydrated, transactions, ...meta } = state;

    // Re-serialise the ledger only when the ledger moved.
    //
    // Every state change lands here — flipping a setting, editing a budget,
    // dismissing a toast — and each one rebuilt the chunk array, which means
    // JSON.stringify over every transaction the user has. Comparing the
    // strings afterwards saved the WRITE but not the stringify, which is the
    // part that runs on the JS thread and is felt. The array identity answers
    // the question directly: the reducer only ever hands back a new one when
    // the transactions actually changed.
    const ledgerMoved = prevTransactions.current !== transactions;
    if (ledgerMoved) {
      const next: [string, string][] = [];
      for (let i = 0; i * TX_CHUNK_SIZE < transactions.length; i++) {
        next.push([
          txChunkKey(i),
          JSON.stringify(transactions.slice(i * TX_CHUNK_SIZE, (i + 1) * TX_CHUNK_SIZE)),
        ]);
      }
      pendingChunks.current = next;
      prevTransactions.current = transactions;
    }
    const chunks = pendingChunks.current;
    // Of those, only the chunks whose contents differ are written.
    const changed = chunks.filter(([, body], i) => prevChunks.current[i] !== body);

    (async () => {
      try {
        await AsyncStorage.multiSet([
          [STORAGE_KEY, JSON.stringify({ ...meta, txChunks: chunks.length })],
          ...changed,
        ]);
        if (prevChunkCount.current > chunks.length) {
          await AsyncStorage.multiRemove(
            Array.from({ length: prevChunkCount.current - chunks.length }, (_, i) =>
              txChunkKey(chunks.length + i),
            ),
          );
        }
        prevChunkCount.current = chunks.length;
        prevChunks.current = chunks.map(([, body]) => body);
      } catch {
        // Persistence is best-effort; the in-memory state stays authoritative.
        // The cache is cleared so the next save rewrites every chunk rather
        // than assuming a failed write landed.
        prevChunks.current = [];
      }
    })();
  }, [state]);

  const addTransaction = useCallback((t: Omit<Transaction, 'id'>) => {
    dispatch({ type: 'addTransaction', transaction: { ...t, id: makeId('tx') } });
  }, []);

  const editTransaction = useCallback((id: string, patch: Partial<Omit<Transaction, 'id'>>) => {
    dispatch({ type: 'editTransaction', id, patch });
  }, []);

  const deleteTransaction = useCallback((id: string) => {
    dispatch({ type: 'deleteTransaction', id });
  }, []);

  const importBatch = useCallback((input: ImportBatchInput) => {
    const newAccounts: Account[] = input.newAccounts.map((a) => ({ ...a, id: makeId('acc') }));
    // Hints pointing at a numeric index refer to a just-created account.
    const newHints: Record<string, string> = {};
    for (const [last4, ref] of Object.entries(input.newHints)) {
      const idx = Number(ref);
      newHints[last4] = Number.isInteger(idx) && idx >= 0 && idx < newAccounts.length && String(idx) === ref
        ? newAccounts[idx].id
        : ref;
    }
    const transactions: Transaction[] = input.transactions.map((t) => ({
      ...t,
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
    dispatch({
      type: 'importBatch',
      transactions,
      newAccounts,
      newHints,
      newDues,
      snapshots,
      bankNames,
      lastScanTs: input.lastScanTs,
      updates: input.updates ?? [],
    });
    return transactions.map((t) => t.id);
  }, []);

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

  const setAppLock = useCallback((enabled: boolean) => {
    dispatch({ type: 'setAppLock', enabled });
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
    try {
      const parsed = JSON.parse(json);
      if (parsed?.app !== 'wafra' || !parsed?.data || !Array.isArray(parsed.data.transactions)) {
        return false;
      }
      dispatch({ type: 'restore', state: parsed.data });
      return true;
    } catch {
      return false;
    }
  }, []);

  const loadDemoData = useCallback(() => {
    dispatch({ type: 'loadDemo', state: demoState() });
  }, []);

  const clearAll = useCallback(() => {
    dispatch({ type: 'clearAll' });
  }, []);

  const value = useMemo(
    () => ({
      state,
      addTransaction,
      editTransaction,
      deleteTransaction,
      importBatch,
      undoBatch,
      upsertBudget,
      deleteBudget,
      addAccount,
      editAccount,
      deleteAccount,
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
      setAppLock,
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
      addTransaction,
      editTransaction,
      deleteTransaction,
      importBatch,
      undoBatch,
      upsertBudget,
      deleteBudget,
      addAccount,
      editAccount,
      deleteAccount,
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
      setAppLock,
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
  // worth, and a transfer between your own accounts moves nothing.
  const live = new Set(state.accounts.filter((a) => !a.archived).map((a) => a.id));
  let total = state.accounts.reduce((sum, a) => (a.archived ? sum : sum + a.openingFils), 0);
  for (const t of state.transactions) {
    if (t.isTransfer || !live.has(t.accountId)) continue;
    if (t.date > dateISO) continue;
    total += t.type === 'income' ? t.amountFils : -t.amountFils;
  }
  return total;
}
