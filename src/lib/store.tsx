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

import { markCardsDistinct, mergeDuplicateAccounts, mergeRenewedCard } from '@/lib/accounts';
import { setMonthStartDay as applyMonthStartDay, toISODate } from '@/lib/format';
import { setThemePreference as applyThemePreference } from '@/lib/theme-preference';
import { detectLanguage, setLanguage } from '@/lib/i18n';
import { detectMarketId, setActiveMarket } from '@/lib/markets';
import { generateSeedTransactions, SEED_ACCOUNTS, SEED_BUDGETS } from '@/lib/seed';
import { applyHealPatch, healPatch } from '@/lib/heal';
import { guessCategory, normalizeServiceName, parseSms, PARSER_VERSION } from '@/lib/sms-parser';
import { internalTransferIds } from '@/lib/ledger';
import { migrateLegacyState, stateStorage } from '@/lib/state-storage';
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
      return mergeDuplicateAccounts(next);
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
                return u ? applyHealPatch(t, u) : t;
              })
          : state.transactions;
      return {
        ...state,
        transactions: sortTxs([...action.transactions, ...existing]),
        accounts,
        accountHints: { ...state.accountHints, ...action.newHints },
        cardDues: dues,
        lastScanTs: Math.max(state.lastScanTs, action.lastScanTs),
        parserVersion: PARSER_VERSION,
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

const SEED_BILLS: Bill[] = [
  { id: 'bill-dewa', title: 'DEWA Bill', category: 'utilities', amountFils: 45_000, dueDay: 25, paidMonths: [] },
  { id: 'bill-etisalat', title: 'Etisalat Postpaid', category: 'telecom', amountFils: 19_900, dueDay: 5, paidMonths: [] },
  { id: 'bill-du', title: 'du Home Internet', category: 'telecom', amountFils: 38_900, dueDay: 10, paidMonths: [] },
];

function demoState(): Partial<Omit<AppState, 'hydrated'>> {
  const due = new Date();
  due.setHours(12, 0, 0, 0);
  due.setDate(due.getDate() + 12);
  return {
    accounts: SEED_ACCOUNTS,
    transactions: generateSeedTransactions(new Date()),
    budgets: SEED_BUDGETS,
    bills: SEED_BILLS,
    cardDues: [
      {
        id: 'due-fab-demo',
        accountId: 'acc-card',
        totalDueFils: 120_900,
        minDueFils: 6_050,
        dueDate: toISODate(due),
        paidFils: 0,
      },
    ],
    goals: [{ id: 'goal-demo', title: 'Emergency fund', emoji: 'target', targetFils: 2_000_000, savedFils: 650_000 }],
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
              // Same rules as a rescan — deliberately the same function. This
              // used to be a second copy that had drifted: it flagged a card
              // payment as a transfer but left it an expense, which is exactly
              // the shape `allocatePayments` refuses, so a paid card kept
              // showing as owed on the path that runs on every launch.
              const patch = healPatch(t, p);
              return [patch ? applyHealPatch(t, patch) : t];
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
      } catch {
        // Persistence is best-effort; the in-memory state stays authoritative.
        // The caches are cleared so the next save rewrites every chunk rather
        // than assuming a failed write landed.
        prevChunks.current = [];
        prevTransactions.current = null;
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
    const action: Action = {
      type: 'importBatch',
      transactions,
      newAccounts,
      newHints,
      newDues,
      snapshots,
      bankNames,
      lastScanTs: input.lastScanTs,
      updates: input.updates ?? [],
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

  const clearAll = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }

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
    await destroyOperation;

    prevChunkCount.current = 0;
    prevChunks.current = [];
    prevTransactions.current = null;

    // Recreate only the minimal blank state under a fresh random key. Waiting
    // here makes "Erase" a completed operation, not a 700 ms intention.
    const written = await persist(authoritativeState.current);
    if (!written) throw new Error('Blank encrypted store could not be created');
  }, [dispatch, persist]);

  const value = useMemo(
    () => ({
      state,
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
