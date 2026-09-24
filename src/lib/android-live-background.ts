/**
 * Android live capture while the UI is backgrounded or its process was killed.
 *
 * This is deliberately event-driven. Native SMS_RECEIVED and the bank-app
 * NotificationListener start one short Headless JS task; there is no timer,
 * periodic scheduler, notification-shade sweep or whole-inbox reread here.
 *
 * When the normal StoreProvider still exists in memory, the task borrows that
 * exact ledger adapter so React state and SQLCipher stay one snapshot. After a
 * process death there is no adapter to borrow, so a tiny disk adapter loads the
 * encrypted ledger, applies the SAME import planner/materializer, commits it,
 * and exits. Foreground hydration waits for this module's short tail, closing
 * the only race where an Activity could open while a killed-process capture is
 * still finishing its encrypted write.
 */
import { AppRegistry, AppState as RNAppState, Platform } from 'react-native';

import NotificationReader from '../../modules/notification-reader';
import SmsReader from '../../modules/sms-reader';
import {
  androidNotificationCaptureEnabled,
  androidSmsCaptureEnabled,
} from '@/lib/android-capture-sources';
import { scanInbox } from '@/lib/auto-import';
import { createCaptureExecutor, type CaptureLedgerAdapter } from '@/lib/capture-executor';
import type { CaptureResult } from '@/lib/capture';
import { setLanguage, t, tf } from '@/lib/i18n';
import {
  applyMaterializedImportBatch,
  materializeImportBatch,
} from '@/lib/ledger-import';
import { createLedgerPersistence } from '@/lib/ledger-persistence';
import { isLedgerMoneySpec } from '@/lib/ledger-money';
import {
  setActiveMarket,
  setLedgerCurrency as setGlobalLedgerCurrency,
} from '@/lib/markets';
import { setActiveCountry } from '@/lib/country';
import { isProActive } from '@/lib/purchases';
import { migrateLegacyState, stateStorage } from '@/lib/state-storage';
import type { AppState, ImportBatchInput, Transaction } from '@/lib/types';

export const ANDROID_LIVE_CAPTURE_TASK = 'WafraLiveCapture';
const STORAGE_KEY = 'wafra/state/v1';
const TX_CHUNK_SIZE = 400;
const TX_CHUNK_ORDER = 'oldest-first' as const;
const SMS_EVENT_LOOKBACK_MS = 2 * 60 * 1000;
const SMS_EVENT_PAGE_SIZE = 16;
const PUSH_ROWS_PER_WAKE = 12;
const SMS_PROVIDER_SETTLE_MS = 220;

type BackgroundSource = 'sms' | 'push';

interface HeadlessInput {
  source?: unknown;
  observedAt?: unknown;
}

interface MutableLedger {
  current: AppState;
}

let liveLedgerAdapter: CaptureLedgerAdapter | null = null;
let backgroundTail: Promise<void> = Promise.resolve();
let idCounter = 0;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const createId = (prefix: 'acc' | 'tx' | 'due' | 'bill'): string => {
  idCounter += 1;
  return `${prefix}-bg-${Date.now()}-${idCounter}-${Math.floor(Math.random() * 1e6)}`;
};

const chunkTransactions = (transactions: Transaction[]): string[] => {
  const bodies: string[] = [];
  for (let end = transactions.length; end > 0; end -= TX_CHUNK_SIZE) {
    bodies.push(JSON.stringify(transactions.slice(Math.max(0, end - TX_CHUNK_SIZE), end)));
  }
  return bodies;
};

const diskPersistence = createLedgerPersistence({
  prefix: STORAGE_KEY,
  chunkSize: TX_CHUNK_SIZE,
  currentChunkOrder: TX_CHUNK_ORDER,
  chunkTransactions,
  storage: stateStorage,
  migrateLegacyState,
});

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Headless capture never performs a semantic ledger migration. That work can
 * walk thousands of historical rows and belongs to normal foreground hydrate.
 * A current persisted ledger has these fields; an older/incomplete snapshot is
 * simply left untouched for the next foreground open, with its source still
 * recoverable in the SMS inbox/native notification queue.
 */
function usablePersistedState(
  value: Partial<Omit<AppState, 'hydrated'>> | null,
): AppState | null {
  if (!value || value.onboarded !== true || value.captureOptOut === true ||
      !Array.isArray(value.accounts) || !Array.isArray(value.transactions) ||
      !Array.isArray(value.cardDues) || !Array.isArray(value.bills) ||
      !Array.isArray(value.budgets) || !Array.isArray(value.goals) ||
      !Array.isArray(value.statementCoverage) ||
      !Array.isArray(value.trustedNotificationPackages) ||
      !Array.isArray(value.localCaptureQualifications) ||
      !record(value.reviewTray) || !record(value.merchantOverrides) ||
      !record(value.accountHints) || !record(value.billAliases) ||
      typeof value.lastScanTs !== 'number' || !Number.isFinite(value.lastScanTs) ||
      typeof value.privateMode !== 'boolean' || typeof value.captureOptOut !== 'boolean' ||
      typeof value.marketId !== 'string' || value.marketId.length === 0 ||
      !isLedgerMoneySpec(value.ledgerMoney)) {
    return null;
  }
  return { ...value, hydrated: true } as AppState;
}

function applyLedgerContext(state: AppState): boolean {
  try {
    // A previous foreground process may have left module-global parser context.
    // Rebuild it from the encrypted ledger rather than trusting process history.
    setGlobalLedgerCurrency(null);
    setActiveMarket(state.marketId);
    // Country conventions (numeric date order) for the universal parser.
    setActiveCountry(state.country ?? null);
    setGlobalLedgerCurrency(state.ledgerMoney!.currency, state.ledgerMoney!.exponent);
    setLanguage(state.language === 'ar' ? 'ar' : 'en');
    return true;
  } catch {
    return false;
  }
}

function diskLedgerAdapter(holder: MutableLedger): CaptureLedgerAdapter {
  return {
    getState: () => holder.current,
    getStateGeneration: () => 0,
    importBatch: (input: ImportBatchInput) => {
      const base = holder.current;
      const materialized = materializeImportBatch(input, base, createId);
      const next = applyMaterializedImportBatch(base, materialized);
      holder.current = next;
      return {
        ids: materialized.transactions.map((transaction) => transaction.id),
        durable: diskPersistence.save(next).then((written) => {
          if (!written) throw new Error('Encrypted background ledger write was blocked');
        }),
      };
    },
    ensureDurable: async () => {
      if (!await diskPersistence.save(holder.current)) {
        throw new Error('Encrypted background ledger write was blocked');
      }
    },
    setMarket: (id) => {
      // Never relabel an existing ledger. The normal import planner already
      // rejects a currency mismatch; this only lets a same-ledger market hint
      // become explicit before the durable import snapshot is written.
      if (holder.current.marketId === id) return true;
      return false;
    },
  };
}

async function boundedCollector(
  state: AppState,
  source: BackgroundSource,
  observedAt: number,
): Promise<CaptureResult> {
  // SMS_RECEIVED can beat the provider insert by a fraction of a second on OEM
  // builds. One short delay is cheaper than a retry loop and the inbox remains
  // the fallback if the row still is not visible.
  if (source === 'sms') await sleep(SMS_PROVIDER_SETTLE_MS);

  const sinceMs = source === 'push'
    ? 0
    : Math.max(
        state.lastScanTs > 0 ? state.lastScanTs + 1 : 0,
        Math.max(0, observedAt - SMS_EVENT_LOOKBACK_MS),
      );
  const result = await scanInbox(
    sinceMs,
    state.merchantOverrides,
    undefined,
    undefined,
    {
      notificationOnly: source === 'push',
      learnedNotificationPackages: state.trustedNotificationPackages,
      ...(source === 'sms' ? {
        maxInboxPages: 1,
        pageSize: SMS_EVENT_PAGE_SIZE,
        includeNotificationQueue: false,
      } : {
        maxNotificationRows: PUSH_ROWS_PER_WAKE,
      }),
    },
  );

  const noObservedSms = source === 'sms' && result.inboxScannedCount === 0 &&
    result.parsed.length === 0 && result.declined.length === 0 &&
    result.reviewCandidates.length === 0;
  const holdPushAcknowledgement = result.reviewCandidates.length > 0;

  return {
    parsed: result.parsed,
    // Review is intentionally foreground-owned. It can require a user-confirmed
    // package/account/category choice, so a killed-process task never invents
    // one. If a push page contains a review row, keep that native page
    // unacknowledged; any auto-parsed siblings dedupe safely on foreground retry.
    reviewCandidates: [],
    declined: result.declined,
    // A killed-process task does not persist Review rows. Keep the SMS cursor
    // where it was so the next normal foreground scan can still stage any
    // ambiguous alert from this tiny window. Already-imported rows dedupe.
    newestTs: source === 'sms' ? state.lastScanTs :
      (noObservedSms ? state.lastScanTs : result.newestTs),
    scannedCount: result.scannedCount,
    inboxScannedCount: result.inboxScannedCount,
    historicalReread: false,
    detectedLaunchMarket: result.detectedLaunchMarket,
    source: source === 'push' ? 'push' : 'sms',
    commit: holdPushAcknowledgement ? async () => {} : result.commit,
    requiresDurableCommit: !holdPushAcknowledgement && result.requiresDurableCommit,
    needsSetup: false,
  };
}

function postImportedPushNotice(
  adapter: CaptureLedgerAdapter,
  transactionIds: readonly string[],
): void {
  if (transactionIds.length === 0 || !NotificationReader?.postImportNotice) return;
  try {
    if (SmsReader?.getInstantAlerts?.() === false) return;
  } catch {
    // New installs default the alert preference on; older native builds may not
    // expose it, and the system notification permission still controls delivery.
  }
  const ids = new Set(transactionIds);
  const rows = adapter.getState().transactions.filter(
    (transaction) => ids.has(transaction.id) && transaction.viaPush === true,
  );
  if (rows.length === 0) return;
  const title = rows.length === 1
    ? t('bankPushNoticeTitle')
    : tf('bankPushNoticeGroupTitle', { count: rows.length });
  const body = rows.length === 1
    ? tf('bankPushNoticeBody', { merchant: rows[0].title })
    : tf('bankPushNoticeGroupBody', { count: rows.length });
  try {
    NotificationReader.postImportNotice(title, body);
  } catch {
    // The durable ledger write is authoritative; presentation can fail alone.
  }
}

async function processBackgroundCapture(source: BackgroundSource, observedAt: number): Promise<void> {
  // SMS_RECEIVED is independent of Notification access, but background
  // automatic capture is the same Pro feature. Reuse the native bounded lease
  // so a stale persisted `pro=true` cannot authorize killed-process imports
  // forever after a storefront entitlement later expires.
  if (source === 'sms') {
    try {
      if (NotificationReader?.isAdmissionActive?.() !== true) return;
    } catch {
      return;
    }
  }
  let adapter = liveLedgerAdapter;
  if (!adapter) {
    const loaded = usablePersistedState(await diskPersistence.load());
    if (!loaded || !applyLedgerContext(loaded) || !isProActive(loaded)) return;
    if (source === 'sms' ? !androidSmsCaptureEnabled(loaded) : !androidNotificationCaptureEnabled(loaded)) return;
    const holder: MutableLedger = { current: loaded };
    adapter = diskLedgerAdapter(holder);
  } else {
    const state = adapter.getState();
    if (!state.hydrated || !state.onboarded || state.captureOptOut || !isProActive(state) ||
        !applyLedgerContext(state)) return;
    if (source === 'sms' ? !androidSmsCaptureEnabled(state) : !androidNotificationCaptureEnabled(state)) return;
  }

  const executor = createCaptureExecutor({
    ledger: adapter,
    dependencies: {
      collectRoutine: (state) => boundedCollector(state, source, observedAt),
    },
  });
  const outcome = await executor.execute(source === 'push' ? 'notification-only' : 'routine');
  if (source === 'push' && outcome.kind === 'imported') {
    postImportedPushNotice(adapter, outcome.transactionIds);
  }
}

function enqueueBackgroundCapture(source: BackgroundSource, observedAt: number): Promise<void> {
  const operation = backgroundTail.then(
    () => processBackgroundCapture(source, observedAt),
    () => processBackgroundCapture(source, observedAt),
  );
  backgroundTail = operation.then(() => undefined, () => undefined);
  return operation;
}

/** Borrow the mounted StoreProvider instead of creating a competing disk owner. */
export function installAndroidLiveCaptureLedger(adapter: CaptureLedgerAdapter): () => void {
  if (Platform.OS !== 'android') return () => {};
  liveLedgerAdapter = adapter;
  return () => {
    if (liveLedgerAdapter === adapter) liveLedgerAdapter = null;
  };
}

/** Foreground hydration waits only for an already-running event-driven task. */
export async function waitForAndroidBackgroundCaptureIdle(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await backgroundTail.catch(() => {});
}

if (Platform.OS === 'android') {
  AppRegistry.registerHeadlessTask(ANDROID_LIVE_CAPTURE_TASK, () => async (input: HeadlessInput) => {
    const source = input?.source === 'sms' || input?.source === 'push' ? input.source : null;
    if (!source) return;
    // Native always emits the event wake because BroadcastReceiver/listener
    // process priority cannot reliably tell whether an Activity is visible.
    // When Wafra is actually open, its mounted source-free event subscriber
    // already owns the drain, so avoid a second parser/persistence owner here.
    if (RNAppState.currentState === 'active') return;
    const observedAt = typeof input.observedAt === 'number' && Number.isFinite(input.observedAt)
      ? Math.max(0, input.observedAt)
      : Date.now();
    await enqueueBackgroundCapture(source, observedAt);
  });
}
