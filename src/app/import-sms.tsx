/**
 * Reading bank messages by hand.
 *
 * Runs the SAME pipeline as the automatic import on Home — scanInbox →
 * buildImportPlan → importBatch — and just makes the plan visible before it is
 * applied. Cards are attributed by their last four digits, duplicates are
 * skipped on the message fingerprint, and statements become card dues.
 *
 * TWO THINGS ON THIS SCREEN ARE PLATFORM-DEPENDENT, AND BOTH USED TO BE WRONG.
 *
 * It was called "Read my inbox" everywhere. iOS gives no app access to
 * Messages, so on iPhone that title described something the screen could not
 * do; what it actually offers there is a paste box.
 *
 * And pasting was behind the paywall. On Android that was survivable — the
 * inbox scan is right there — but on iPhone, where pasting is the ONLY
 * ingestion path that works without a Shortcut, it made the free tier of the
 * iPhone app strictly worse than the Android one at the same price. Pasting is
 * the user doing the work; Wafra charges for doing the work itself. See
 * `requiresPro` in lib/purchases.ts. The full inbox scan is still Pro, on the
 * platform that has one.
 */
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState as RNAppState,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { SupplementImports } from '@/components/supplement-imports';
import { HistoryDetailsSheet } from '@/components/ios-message-setup/history-details-sheet';
import { Button } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { Block, Row, ScreenHeader, Section, SectionHeader } from '@/components/ui/layout';
import { Money } from '@/components/ui/money';
import { PulseDot } from '@/components/ui/states';
import { CategoryTile } from '@/components/ui/tile';
import { EASE, MaxContentWidth, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/hooks/use-theme';
import {
  buildImportPlan,
  isSmsScanningAvailable,
  requestSmsPermission,
  scanInbox,
  type DeclinedSms,
  type ImportPlan,
  type ScannedSms,
} from '@/lib/auto-import';
import { categoryLabel } from '@/lib/categories';
import { shortDate } from '@/lib/format';
import {
  discardIosHistorySession,
  loadIosHistorySession,
  persistIosHistoryReviewCandidates,
  type LoadedIosHistorySession,
} from '@/lib/ios-history-import';
import {
  beginIosHistoryHandoffForOrigin,
  cancelIosHistoryHandoff,
  clearIosHistoryHandoff,
  clearIosHistoryReturnOrigin,
  confirmIosHistoryShortcutInstalled,
  createIosHistoryActionGuard,
  createIosHistoryOperationController,
  createIosHistorySnapshotGate,
  historyShortcutInstallUrl,
  historyShortcutRunUrl,
  IOS_HISTORY_HANDOFF_TTL_MS,
  consumeIosHistoryReturnOrigin,
  iosHistoryCleanupStateAfterFailure,
  iosHistoryLoadFailureDisposition,
  iosHistorySetupStorageCoordinator,
  iosHistorySuccessRoute,
  iosHistorySourceCounts,
  loadIosHistorySetup,
  performIosHistoryAction,
  recoverIosHistoryHandoff,
  reconcileIosHistorySetup,
  resetIosHistorySetup,
  resolveIosHistoryCardState,
  validIosHistorySessionId,
  type IosHistoryCardState,
} from '@/lib/ios-history-setup';
import {
  dispatchIosMessageSetup,
  loadIosMessageSetupProgress,
  type IosMessageSetupStatus,
} from '@/lib/ios-message-onboarding';
import { isProActive, requiresPro } from '@/lib/purchases';
import { parsePastedBankAlerts } from '@/lib/launch-alert-parser';
import { inspectUniversalBankEvent } from '@/lib/universal-parser';
import { prepareUniversalReviewAlert, type ReviewEntry } from '@/lib/alert-review-tray';
import { PARSER_VERSION } from '@/lib/sms-parser';
import { collectLegacyReviewSourceKeys } from '@/lib/review-source-bindings';
import { buildTrackedBillBatch, ImportMoneyError } from '@/lib/import-plan';
import { useStore } from '@/lib/store';
import { t, tf } from '@/lib/i18n';

interface PendingInboxResult {
  parsed: ScannedSms[];
  declined: DeclinedSms[];
  newestTs: number;
  parserRereadComplete: true;
}

const EASING = Easing.bezier(EASE[0], EASE[1], EASE[2], EASE[3]);

const SAMPLE = `Purchase of AED 187.50 with Debit Card ending 1234 at CARREFOUR MALL OF EMIRATES, DUBAI on 17/07/2026. Avl balance AED 12,345.67

AED 55.00 was debited from your account for payment to SALIK RECHARGE on 16/07/2026

Salary of AED 18,500.00 has been credited to your account ending 5678`;

const PREVIEW_LIMIT = 60;
const PANEL_HEIGHT = 186;
const HISTORY_SHORTCUT_INSTALL_URL = historyShortcutInstallUrl();

function withoutExistingBillReminders(plan: ImportPlan, existingTitles: string[]): ImportPlan {
  const existing = new Set(existingTitles.map((title) => title.trim().toLowerCase()));
  const billDues = plan.billDues.filter((due) => {
    const key = due.merchant.trim().toLowerCase();
    if (existing.has(key)) return false;
    // The Bill model currently has one row per merchant title. Keep the
    // review count identical to what confirmation can actually file.
    existing.add(key);
    return true;
  });
  if (billDues.length === plan.billDues.length) return plan;
  const allowed = new Set(billDues.map((due) => due.merchant.trim().toLowerCase()));
  return {
    ...plan,
    billDues,
    batch: {
      ...plan.batch,
      newBills: (plan.batch.newBills ?? []).filter((bill) =>
        allowed.has(bill.title.trim().toLowerCase())),
    },
  };
}

function plannedHistoryRows(plan: ImportPlan): number {
  return plan.txCount + plan.dueCount + plan.healedCount + plan.billDues.length;
}

async function historyNativeModule() {
  // Kept out of the module graph on Android at runtime: this Expo module has
  // an Apple implementation only, exactly like Find Message itself.
  return (await import('../../modules/wafra-message-history')).default;
}

/**
 * How many messages the user actually pasted, counted the way `pasteHint`
 * asks them to paste: one per blank-line-separated block. Used only to say
 * how many of them came back unreadable.
 */
function messageBlocks(input: string): number {
  const blocks = input
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean).length;
  // Something was pasted — the parse button is disabled otherwise — so the
  // floor is one. "0 messages in a format we do not know" is not an answer.
  return Math.max(1, blocks);
}

/**
 * What a paste that produced no plan actually was. `filed` means the parser
 * read it and the ledger already had every row; `unreadable` means the parser
 * could make nothing of it at all. Two different answers, and the screen used
 * to give neither.
 */
type PasteVerdict = { kind: 'filed' | 'unreadable'; count: number };

/**
 * Something this screen has to SAY, drawn rather than announced.
 *
 * All four of these were `Alert.alert(title, body)`. On react-native-web that
 * method is `static alert() {}` — no dialog, no console warning, no throw — so
 * a scan refused because the ledger had not hydrated, a denied SMS permission,
 * and an inbox with nothing new all reported themselves into a dialog that is
 * never drawn. The button consumed the tap and said nothing, and the only
 * available reading of that is that it is broken.
 *
 * None of them is a question: there is no second button and nothing to
 * confirm, so none of them wants a ConfirmSheet. They want to be visible,
 * which is what the paste verdict below already does with the same two lines.
 */
type Notice = { title: string; body: string };

/**
 * The loading state: skeleton lines under a scan line sweeping down them.
 * No spinner — a spinner says "wait", this says what is being read.
 */
function ScanPanel({ reducedMotion }: { reducedMotion: boolean }) {
  const theme = useTheme();
  const y = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) {
      y.value = 0.5;
      return;
    }
    y.value = withRepeat(withTiming(1, { duration: 2400, easing: EASING }), -1, false);
  }, [reducedMotion, y]);

  const line = useAnimatedStyle(() => ({ transform: [{ translateY: y.value * PANEL_HEIGHT }] }));

  return (
    <View style={[styles.panel, { borderColor: theme.cardBorder, backgroundColor: theme.backgroundElement }]}>
      {[0.82, 0.55, 0.7, 0.4, 0.88, 0.6, 0.35].map((w, i) => (
        <View
          key={i}
          style={[styles.panelLine, { width: `${w * 100}%`, backgroundColor: theme.backgroundSelected }]}
        />
      ))}
      <Animated.View style={[styles.scanLine, { backgroundColor: theme.primary }, line]} />
    </View>
  );
}

export default function ImportSmsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const keyboardHeight = useKeyboardHeight();
  const reducedMotion = useReducedMotion();
  const { auto, manual, history: historyParam } = useLocalSearchParams<{
    auto?: string;
    manual?: string;
    history?: string;
  }>();
  // A forged Android deep link must remain the ordinary inbox/paste screen.
  // The native history session exists only in the Apple module graph.
  const history = Platform.OS === 'ios' ? historyParam : undefined;
  const { state, getStateSnapshot, importBatch, ensureDurable, stageReviewAlerts } = useStore();

  const [text, setText] = useState('');
  const pasteRunning = useRef(false);
  // Kept only with the user's open paste form, never in ledger storage.
  const pasteIdentities = useRef({ input: '', ids: new Map<string, { nonce: string; observedAt: number }>() });
  const [pasteReviewIds, setPasteReviewIds] = useState<string[]>([]);
  const pasteReviewCount = state.reviewTray.pending.filter((entry) => pasteReviewIds.includes(entry.id) && entry.expiresAt > Date.now()).length;
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [showManual, setShowManual] = useState(
    () => (manual === '1' && !history) || (!isSmsScanningAvailable() && Platform.OS !== 'ios'),
  );
  useEffect(() => {
    // The same route can be reused while mounted. An explicit quick-paste
    // request reveals the form without starting or altering a history import.
    if (manual === '1' && !history) setShowManual(true);
  }, [manual, history]);
  const [progress, setProgress] = useState<{ scanned: number; found: number } | null>(null);
  const [trackedBills, setTrackedBills] = useState<Set<number>>(new Set());
  const [skippedCount, setSkippedCount] = useState(0);
  const [pasteVerdict, setPasteVerdict] = useState<PasteVerdict | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [applying, setApplying] = useState(false);
  const [historyResult, setHistoryResult] = useState<LoadedIosHistorySession | null>(null);
  const [historySourceSummary, setHistorySourceSummary] = useState<{
    understood: number;
    unread: number;
    alreadyFiled: number;
    notAlreadyFiled: number;
  } | null>(null);
  const [pendingInboxResult, setPendingInboxResult] = useState<PendingInboxResult | null>(null);
  const [pendingScanCommit, setPendingScanCommit] = useState<(() => Promise<void>) | null>(null);
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const [historyCommitState, setHistoryCommitState] = useState<
    | 'idle'
    | 'writing'
    | 'storage-failed'
    | 'cleanup-failed'
    | 'source-retained'
    | 'source-discarded'
    | 'source-cleanup-failed'
    | 'cancel-cleanup-failed'
  >('idle');
  const [historySetup, setHistorySetup] = useState({
    installed: false,
    handoffStartedAt: null as number | null,
  });
  const [historyHandoffExpired, setHistoryHandoffExpired] = useState(false);
  const [historyInstallOpened, setHistoryInstallOpened] = useState(false);
  const [historyActionBusy, setHistoryActionBusy] = useState(false);
  const [historyDetailsVisible, setHistoryDetailsVisible] = useState(false);
  const started = useRef(false);
  const processedHistory = useRef<string | null>(null);
  // State updates are not synchronous enough to protect a write/cleanup
  // critical section from a second tap. This latch is.
  const historyOperationLocked = useRef(false);
  const historyOperationController = useRef(createIosHistoryOperationController()).current;
  const historyActionGuard = useRef(createIosHistoryActionGuard()).current;
  const historySnapshotGate = useRef(createIosHistorySnapshotGate());

  const historyCardState: IosHistoryCardState = resolveIosHistoryCardState({
    platform: Platform.OS,
    version: Platform.Version,
    installUrl: HISTORY_SHORTCUT_INSTALL_URL,
    installed: historySetup.installed,
    handoffStartedAt: historySetup.handoffStartedAt,
    historySessionId: history,
  });

  useEffect(() => {
    const gate = createIosHistorySnapshotGate();
    historySnapshotGate.current = gate;
    return () => gate.close();
  }, []);

  const refreshHistorySetup = useCallback(async () => {
    if (Platform.OS !== 'ios') return;
    const applySnapshot = (snapshot: Awaited<ReturnType<typeof loadIosHistorySetup>>) => {
      setHistorySetup({
        installed: snapshot.installed,
        handoffStartedAt: snapshot.handoffStartedAt,
      });
      if (snapshot.expired) setHistoryHandoffExpired(true);
    };
    try {
      await iosHistorySetupStorageCoordinator.runLatest(
        historySnapshotGate.current,
        async () => {
          const native = await historyNativeModule();
          return reconcileIosHistorySetup({
            historySessionId: history,
            native,
          });
        },
        ({ snapshot, recoveredSessionId }) => {
          applySnapshot(snapshot);
          if (recoveredSessionId) {
            router.replace({
              pathname: '/import-sms',
              params: { history: recoveredSessionId },
            });
          }
        },
      );
    } catch {
      setNotice({ title: t('historyImportFailed'), body: t('historySetupStateFailed') });
    }
  }, [history, router]);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    void refreshHistorySetup();
    const subscription = RNAppState.addEventListener('change', (next) => {
      if (next === 'active') void refreshHistorySetup();
    });
    return () => {
      historySnapshotGate.current.invalidate();
      subscription.remove();
    };
  }, [refreshHistorySetup]);

  useEffect(() => {
    const startedAt = historySetup.handoffStartedAt;
    if (startedAt === null) return;
    const remaining = Math.max(0, startedAt + IOS_HISTORY_HANDOFF_TTL_MS - Date.now());
    const timeout = setTimeout(() => {
      void refreshHistorySetup();
    }, remaining);
    return () => {
      clearTimeout(timeout);
      historySnapshotGate.current.invalidate();
    };
  }, [historySetup.handoffStartedAt, refreshHistorySetup]);

  const performSetupAction = async (action: () => Promise<void>) => {
    const outcome = await performIosHistoryAction(historyActionGuard, async () => {
      setHistoryActionBusy(true);
      setNotice(null);
      try {
        await action();
      } finally {
        setHistoryActionBusy(false);
      }
    }, () => historySnapshotGate.current.invalidate());
    if (outcome === 'failed') {
      setNotice({ title: t('historyImportFailed'), body: t('historySetupStateFailed') });
    }
    return outcome;
  };

  const openHistoryInstall = async (reinstall = false) => {
    if (!HISTORY_SHORTCUT_INSTALL_URL) return;
    await performSetupAction(async () => {
      if (reinstall) {
        await iosHistorySetupStorageCoordinator.run(() => resetIosHistorySetup());
        setHistorySetup({ installed: false, handoffStartedAt: null });
        setHistoryHandoffExpired(false);
      }
      setHistoryInstallOpened(true);
      await Linking.openURL(HISTORY_SHORTCUT_INSTALL_URL);
    });
  };

  const confirmHistoryInstall = async () => {
    await performSetupAction(async () => {
      await iosHistorySetupStorageCoordinator.run(
        () => confirmIosHistoryShortcutInstalled(),
      );
      setHistorySetup((current) => ({ ...current, installed: true }));
      setHistoryInstallOpened(false);
      setHistoryHandoffExpired(false);
    });
  };

  const openHistoryRun = async (newHandoff: boolean) => {
    await performSetupAction(async () => {
      if (newHandoff) {
        const startedAt = Date.now();
        await iosHistorySetupStorageCoordinator.run(
          () => beginIosHistoryHandoffForOrigin('import', startedAt),
        );
        setHistorySetup((current) => ({ ...current, handoffStartedAt: startedAt }));
        setHistoryHandoffExpired(false);
      }
      try {
        // Continue returns to the pending Shortcuts run; invoking run-shortcut
        // again would start a second retained-message import.
        await Linking.openURL(newHandoff ? historyShortcutRunUrl() : 'shortcuts://');
      } catch (error) {
        if (newHandoff) {
          await iosHistorySetupStorageCoordinator.run(
            () => Promise.all([
              clearIosHistoryHandoff(),
              clearIosHistoryReturnOrigin(),
            ]).then(() => undefined),
          );
          setHistorySetup((current) => ({ ...current, handoffStartedAt: null }));
        }
        throw error;
      }
    });
  };

  const cancelHistoryHandoff = async () => {
    await performSetupAction(async () => {
      const native = await historyNativeModule();
      await cancelIosHistoryHandoff({
        recover: () => recoverIosHistoryHandoff(
          historySetup.handoffStartedAt,
          native,
        ),
        discard: (sessionId) => discardIosHistorySession(native, sessionId),
        clearHandoff: () => iosHistorySetupStorageCoordinator.run(
          () => clearIosHistoryHandoff(),
        ),
      });
      setHistorySetup((current) => ({ ...current, handoffStartedAt: null }));
      setHistoryHandoffExpired(false);
      await finishHistoryReview('skipped');
    });
  };

  const historyCardPrimaryAction = () => {
    if (historyCardState === 'unsupported') {
      setShowManual(true);
      return;
    }
    if (historyCardState === 'needs-install') {
      void (historyInstallOpened ? confirmHistoryInstall() : openHistoryInstall());
      return;
    }
    if (historyCardState === 'ready') {
      void openHistoryRun(true);
      return;
    }
    if (historyCardState === 'running') void openHistoryRun(false);
  };

  const runScan = async () => {
    // The plan's duplicate checks read state.transactions, so scanning before
    // the ledger has loaded imports the whole inbox a second time.
    if (!state.hydrated) {
      setNotice({ title: t('importOneMoment'), body: t('dataStillLoading') });
      return;
    }
    // The scan is Wafra reading a whole inbox on its own — the paid half.
    // Asked through requiresPro() rather than inline so the free/paid line
    // lives in one place and stays the same on both platforms.
    if (requiresPro('inboxScan') && !isProActive(state)) {
      router.push('/pro');
      return;
    }
    setScanning(true);
    setProgress(null);
    setPasteVerdict(null);
    setNotice(null);
    setPendingInboxResult(null);
    setPendingScanCommit(null);
    try {
      const granted = await requestSmsPermission();
      if (!granted) {
        setNotice({
          title: t('smsPermissionNeeded'),
          body: t('smsPermissionNeededBody'),
        });
        return;
      }
      // Full history: fingerprints make rescans safe (no duplicates).
      const {
        parsed,
        reviewCandidates,
        reviewSourceBindings,
        newestTs,
        declined,
        inboxHistoryComplete,
        commit,
      } = await scanInbox(0, state.merchantOverrides, (scanned, found) =>
        setProgress({ scanned, found }), undefined, { legacyReviewSourceKeys: collectLegacyReviewSourceKeys(getStateSnapshot()) });
      const reviewReceipt = stageReviewAlerts(reviewCandidates, undefined, reviewSourceBindings);
      await reviewReceipt.durable;
      // `declined` carried through, exactly as the automatic path does. Without
      // it this screen — the one a user reaches BECAUSE something looks wrong —
      // is the one path that cannot clear a refused transaction the ledger
      // recorded as spending.
      const p = buildImportPlan(parsed, getStateSnapshot(), newestTs, new Date(), declined);
      if (!inboxHistoryComplete) throw new Error('sms_history_incomplete');
      p.batch.parserRereadComplete = true;
      const completedInbox: PendingInboxResult = {
        parsed,
        declined,
        newestTs,
        parserRereadComplete: true,
      };
      const txLike = parsed.filter((x) => x.kind === 'transaction' || x.kind === 'cardPayment');
      setSkippedCount(Math.max(0, txLike.length - p.txCount));
      setPlan(p);
      setTrackedBills(new Set());
      if (p.txCount === 0 && p.dueCount === 0 && p.billDues.length === 0 && p.healedCount === 0) {
        await importBatch(p.batch).durable;
        await commit();
        setNotice({ title: t('upToDate'), body: t('inboxAlreadyFiled') });
        setPendingScanCommit(null);
      } else {
        setPendingInboxResult(completedInbox);
        setPendingScanCommit(() => commit);
      }
    } catch (error) {
      if (!(error instanceof ImportMoneyError)) throw error;
      setPlan(null);
      setNotice({ title: t('importMoneyMismatchTitle'), body: t('importMoneyMismatchBody') });
    } finally {
      setScanning(false);
    }
  };

  /**
   * Free, on every platform. The user is holding the message; all Wafra does
   * is read it better than they would type it.
   */
  const runParse = async (input: string) => {
    if (pasteRunning.current) return;
    if (!state.hydrated) {
      setNotice({ title: t('importOneMoment'), body: t('dataStillLoading') });
      return;
    }
    pasteRunning.current = true;
    if (pasteIdentities.current.input !== input) pasteIdentities.current = { input, ids: new Map() };
    setScanning(true);
    setPlan(null);
    setPasteVerdict(null);
    setPasteReviewIds([]);
    try {
      setNotice(null);
      setPendingInboxResult(null);
      // Pasting starts a separate preview; its later save cannot acknowledge a
      // previously abandoned inbox scan whose rows were never committed.
      setPendingScanCommit(null);
      // Deliberately NO isProActive gate here. Pasting is the only ingestion
      // path an iPhone has without a Shortcut, so paywalling it charged an
      // iPhone user for the privilege of doing the work by hand that an Android
      // user gets automatically. Pasting is `manual` capture, and
      // requiresPro('manual') is false on every platform by design.
      const refusedBlocks: string[] = [];
      const parsed: ScannedSms[] = parsePastedBankAlerts(input, state.merchantOverrides, (source) => refusedBlocks.push(source));
      let p: ImportPlan;
      try {
        p = buildImportPlan(parsed, state, state.lastScanTs);
      } catch (error) {
        if (!(error instanceof ImportMoneyError)) throw error;
        setPlan(null);
        setPasteVerdict(null);
        setSkippedCount(0);
        setNotice({ title: t('importMoneyMismatchTitle'), body: t('importMoneyMismatchBody') });
        return;
      }
      const reviews: ReviewEntry[] = [];
      const observedAt = Date.now();
      for (const source of refusedBlocks) {
        const event = inspectUniversalBankEvent(source);
        if (event.decision !== 'review') continue;
        // Pasted text has no provider GUID. This opaque proposal identity is
        // deliberately not presented as a native Message identity.
        const identity = pasteIdentities.current.ids.get(source) ?? { nonce: Crypto.randomUUID().replace(/-/g, ''), observedAt };
        pasteIdentities.current.ids.set(source, identity);
        const nonce = identity.nonce;
        const item = prepareUniversalReviewAlert({
          id: 'paste_review_id_' + nonce, sourceKey: 'paste_review_source_' + nonce,
          observedAt: identity.observedAt, channel: 'paste', parserVersion: PARSER_VERSION, event,
        });
        if (item) reviews.push(item);
      }
      if (reviews.length > 0) {
        const receipt = stageReviewAlerts(reviews);
        await receipt.durable;
        setPasteReviewIds(reviews.map((entry) => entry.id));
      }
      const txLike = parsed.filter((x) => x.kind === 'transaction' || x.kind === 'cardPayment');
      const skipped = Math.max(0, txLike.length - p.txCount);
      setSkippedCount(skipped);
      setTrackedBills(new Set());
      // A plan with nothing in it is not a plan, and rendering one as if it were
      // is how an unreadable paste dead-ended: a strip reading "0 matched ·
      // 0 cards · 0 unread", no preview, no footer button, no explanation — and
      // <SupplementImports /> gone, because that block is gated on `plan ===
      // null`. The relay, forwarded-email and PDF routes disappeared at the
      // exact moment they were the only thing left to offer. The scan path has
      // said "up to date" on an empty result for a long time; the paste path
      // needs the same courtesy, and one more verdict than the scan has: a
      // message the parser could make nothing of is not a message already filed.
      if (p.txCount === 0 && p.dueCount === 0 && p.billDues.length === 0 && p.healedCount === 0) {
        setPlan(null);
        setPasteVerdict(reviews.length > 0 ? null :
          skipped > 0
            ? { kind: 'filed', count: skipped }
            : { kind: 'unreadable', count: messageBlocks(input) },
        );
        return;
      }
      setPasteVerdict(null);
      setPlan(p);
    } catch {
      setPlan(null);
      setNotice({ title: t('genericReviewTitle'), body: t('genericReviewSaveFailed') });
    } finally {
      pasteRunning.current = false;
      setScanning(false);
    }
  };

  const discardHistorySession = async () => {
    if (!validIosHistorySessionId(history) || Platform.OS !== 'ios') return;
    const native = await historyNativeModule();
    await discardIosHistorySession(native, history);
  };

  const returnToHistoryOrigin = useCallback(async () => {
    try {
      const setupProgress = await loadIosMessageSetupProgress();
      const returnOrigin = await iosHistorySetupStorageCoordinator.run(
        () => consumeIosHistoryReturnOrigin(),
      );
      router.replace(iosHistorySuccessRoute(setupProgress, returnOrigin));
    } catch {
      router.replace('/');
    }
  }, [router]);

  const finishHistoryReview = useCallback(async (
    status: Extract<IosMessageSetupStatus, 'complete' | 'skipped'>,
  ) => {
    try {
      await iosHistorySetupStorageCoordinator.run(
        () => clearIosHistoryHandoff(),
      );
      const setupProgress = await dispatchIosMessageSetup({
        type: 'history-status-changed',
        status,
      });
      const returnOrigin = await iosHistorySetupStorageCoordinator.run(
        () => consumeIosHistoryReturnOrigin(),
      );
      router.replace(iosHistorySuccessRoute(setupProgress, returnOrigin));
    } catch {
      setNotice({ title: t('historyImportFailed'), body: t('historySetupStateFailed') });
    }
  }, [router]);

  const leaveScreen = async () => {
    if (!history || !validIosHistorySessionId(history)) {
      if (historyOperationLocked.current) return;
      router.back();
      return;
    }
    // A failed SQLCipher write has already updated in-memory state. Keep the
    // protected source session so recovery after restart remains possible.
    if (historyCommitState === 'storage-failed') {
      setNotice({ title: t('historyStorageFailed'), body: t('historyStorageFailedBody') });
      return;
    }
    const result = await historyOperationController.discard(discardHistorySession);
    if (result === 'busy') return;
    if (result === 'complete') {
      await finishHistoryReview('skipped');
      return;
    }
    const nextState = iosHistoryCleanupStateAfterFailure(historyCommitState);
    setHistoryCommitState(nextState);
    setNotice({
      title: nextState === 'cleanup-failed' ? t('historyCleanupFailed') : t('historyImportFailed'),
      body: nextState === 'cleanup-failed'
        ? t('historyCleanupFailedBody')
        : nextState === 'source-cleanup-failed'
          ? t('historySourceCleanupFailed')
          : t('historyCancelCleanupFailed'),
    });
  };

  const leaveProtectedSessionForExpiry = () => {
    // A native deletion or encrypted-write failure must not trap the user on
    // an uncloseable route. The source remains under complete file protection
    // and the native store will purge it after the documented TTL.
    void returnToHistoryOrigin();
  };

  const trackReminder = async (reminder: ScannedSms, index: number) => {
    if (applying || historyOperationLocked.current) return;
    historyOperationLocked.current = true;
    setApplying(true);
    setNotice(null);
    try {
      const batch = buildTrackedBillBatch(reminder, state);
      if (!batch) return;
      await importBatch(batch).durable;
      setTrackedBills((current) => new Set(current).add(index));
    } catch (error) {
      const mismatch = error instanceof ImportMoneyError;
      setNotice({
        title: t(mismatch ? 'importMoneyMismatchTitle' : 'historyStorageFailed'),
        body: t(mismatch ? 'importMoneyMismatchBody' : 'importStorageFailedBody'),
      });
    } finally {
      historyOperationLocked.current = false;
      setApplying(false);
    }
  };

  const applyPlan = async () => {
    if (!plan || applying || (!history && historyOperationLocked.current)) return;
    if (!history) historyOperationLocked.current = true;
    setApplying(true);
    setNotice(null);
    setHistoryCommitState('writing');
    // A live alert may land while this review is open. Rebuild against the
    // latest state at the moment of confirmation so history/live overlap does
    // not become two entries merely because the preview was old.
    let currentPlan: ImportPlan;
    try {
      currentPlan = historyResult
      ? withoutExistingBillReminders(
          buildImportPlan(historyResult.parsed, state, 0, new Date(), historyResult.declined),
          state.bills.map((bill) => bill.title),
        )
      : pendingInboxResult
        ? buildImportPlan(
            pendingInboxResult.parsed,
            state,
            pendingInboxResult.newestTs,
            new Date(),
            pendingInboxResult.declined,
          )
        : plan;
    } catch (error) {
      setApplying(false);
      historyOperationLocked.current = false;
      if (!(error instanceof ImportMoneyError)) throw error;
      setHistoryCommitState(history ? 'source-retained' : 'idle');
      setNotice({ title: t('importMoneyMismatchTitle'), body: t('importMoneyMismatchBody') });
      return;
    }
    if (pendingInboxResult?.parserRereadComplete) {
      currentPlan.batch.parserRereadComplete = true;
    }
    if (history) {
      const emptyPlan = plannedHistoryRows(currentPlan) === 0;
      const result = await historyOperationController.finalize({
        save: async () => {
          setPlan(null);
          if (emptyPlan) {
            await ensureDurable();
            return;
          }
          const receipt = importBatch(currentPlan.batch);
          await receipt.durable;
        },
        discard: discardHistorySession,
      });
      if (result === 'busy') {
        setApplying(false);
        return;
      }
      if (result === 'complete') {
        // A Shortcut deep link can cold-open this route without a previous
        // Wafra screen in the stack. `back()` then has nowhere to go and
        // leaves the completed review visible. Replace explicitly so a
        // durable save always lands on Home.
        await finishHistoryReview('complete');
      } else {
        if (result === 'save-failed') {
          setHistoryCommitState('storage-failed');
          setNotice({ title: t('historyStorageFailed'), body: t('historyStorageFailedBody') });
        } else {
          setHistoryCommitState('cleanup-failed');
          setNotice({ title: t('historyCleanupFailed'), body: t('historyCleanupFailedBody') });
        }
      }
      setApplying(false);
      return;
    }
    if (
      currentPlan.txCount === 0 &&
      currentPlan.dueCount === 0 &&
      currentPlan.healedCount === 0 &&
      currentPlan.billDues.length === 0
    ) {
      setPlan(null);
      setHistoryCommitState('idle');
      if (pendingScanCommit) {
        try {
          if (pendingInboxResult?.parserRereadComplete) {
            await importBatch(currentPlan.batch).durable;
          }
          // The preview became a no-op because a concurrent live capture
          // durably filed the same rows. They are now safe to retire from the
          // native encrypted queue even though this confirmation has no new
          // ledger batch of its own.
          await pendingScanCommit();
          setPendingScanCommit(null);
        } catch {
          historyOperationLocked.current = false;
          setNotice({
            title: t('notificationCleanupFailedTitle'),
            body: t('notificationCleanupFailedBody'),
          });
          setApplying(false);
          return;
        }
      }
      try {
        await discardHistorySession();
        router.back();
      } catch {
        historyOperationLocked.current = false;
        setHistoryCommitState('cleanup-failed');
        setNotice({ title: t('historyCleanupFailed'), body: t('historyCleanupFailedBody') });
      } finally {
        setApplying(false);
      }
      return;
    }
    try {
      const receipt = importBatch(currentPlan.batch);
      // Dispatch happened synchronously. Remove the button now: retrying this
      // same plan would mint new transaction IDs even if the durable write or
      // the later source cleanup fails.
      setPlan(null);
      await receipt.durable;
    } catch (error) {
      historyOperationLocked.current = false;
      setHistoryCommitState(error instanceof ImportMoneyError ? (history ? 'source-retained' : 'idle') : 'storage-failed');
      setNotice({
        title: t(error instanceof ImportMoneyError ? 'importMoneyMismatchTitle' : 'historyStorageFailed'),
        body: error instanceof ImportMoneyError ? t('importMoneyMismatchBody')
          : history ? t('historyStorageFailedBody') : t('importStorageFailedBody'),
      });
      setApplying(false);
      return;
    }
    if (pendingScanCommit) {
      try {
        await pendingScanCommit();
        setPendingScanCommit(null);
      } catch {
        historyOperationLocked.current = false;
        setNotice({
          title: t('notificationCleanupFailedTitle'),
          body: t('notificationCleanupFailedBody'),
        });
        setApplying(false);
        return;
      }
    }
    try {
      await discardHistorySession();
      router.back();
    } catch {
      historyOperationLocked.current = false;
      setHistoryCommitState('cleanup-failed');
      setNotice({ title: t('historyCleanupFailed'), body: t('historyCleanupFailedBody') });
    }
    setApplying(false);
  };

  const retrySecureSave = async () => {
    if (applying || (!history && historyOperationLocked.current)) return;
    if (!history) historyOperationLocked.current = true;
    setApplying(true);
    if (history) {
      const result = await historyOperationController.finalize({
        save: ensureDurable,
        discard: discardHistorySession,
      });
      if (result === 'busy') {
        setApplying(false);
        return;
      }
      if (result === 'complete') {
        await finishHistoryReview('complete');
      } else {
        if (result === 'save-failed') {
          setHistoryCommitState('storage-failed');
          setNotice({ title: t('historyStorageFailed'), body: t('historyStorageFailedBody') });
        } else {
          setHistoryCommitState('cleanup-failed');
          setNotice({ title: t('historyCleanupFailed'), body: t('historyCleanupFailedBody') });
        }
      }
      setApplying(false);
      return;
    }
    try {
      await ensureDurable();
    } catch {
      historyOperationLocked.current = false;
      setNotice({
        title: t('historyStorageFailed'),
        body: history ? t('historyStorageFailedBody') : t('importStorageFailedBody'),
      });
      setApplying(false);
      return;
    }
    if (!history && pendingScanCommit) {
      try {
        await pendingScanCommit();
        setPendingScanCommit(null);
      } catch {
        historyOperationLocked.current = false;
        setNotice({
          title: t('notificationCleanupFailedTitle'),
          body: t('notificationCleanupFailedBody'),
        });
        setApplying(false);
        return;
      }
    }
    try {
      await discardHistorySession();
      router.back();
    } catch {
      historyOperationLocked.current = false;
      setHistoryCommitState('cleanup-failed');
      setNotice({ title: t('historyCleanupFailed'), body: t('historyCleanupFailedBody') });
    }
    setApplying(false);
  };

  useEffect(() => {
    if (auto === '1' && manual !== '1' && isSmsScanningAvailable() && !started.current) {
      started.current = true;
      runScan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (
      !history ||
      Platform.OS !== 'ios' ||
      !state.hydrated ||
      processedHistory.current === `${history}:${historyAttempt}`
    ) return;
    processedHistory.current = `${history}:${historyAttempt}`;
    let active = true;
    const load = async () => {
      let coordinatorLoaded = false;
      setScanning(true);
      setProgress(null);
      setNotice(null);
      setPasteVerdict(null);
      setPlan(null);
      setHistoryResult(null);
      setHistorySourceSummary(null);
      setShowManual(false);
      setHistoryCommitState('idle');
      try {
        if (!validIosHistorySessionId(history)) {
          setNotice({
            title: t('historyImportInvalid'),
            body: t('historyImportInvalidBody'),
          });
          return;
        }
        const native = await historyNativeModule();
        const result = await loadIosHistorySession({
          sessionId: history,
          native,
          overrides: state.merchantOverrides,
          onProgress: ({ scanned, matched }) => {
            if (active) setProgress({ scanned, found: matched });
          },
        });
        if (!active) return;
        coordinatorLoaded = true;
        await persistIosHistoryReviewCandidates(result.reviewCandidates, stageReviewAlerts);
        if (!active) return;
        setHistoryResult(result);
        const nextPlan = withoutExistingBillReminders(
          buildImportPlan(result.parsed, state, 0, new Date(), result.declined),
          state.bills.map((bill) => bill.title),
        );
        const counts = iosHistorySourceCounts(
          {
            ...result.summary,
            parsed: result.summary.parsed + result.summary.reviewed,
          },
          [...result.parsed, ...result.declined]
            .map((row) => row.sourceEventId)
            .filter((value): value is string => typeof value === 'string'),
          state.transactions
            .map((transaction) => transaction.smsKey)
            .filter((value): value is string => typeof value === 'string'),
        );
        setHistorySourceSummary(counts);
        setSkippedCount(counts.alreadyFiled);
        setTrackedBills(new Set());
        if (
          nextPlan.txCount === 0 &&
          nextPlan.dueCount === 0 &&
          nextPlan.billDues.length === 0 &&
          nextPlan.healedCount === 0
        ) {
          setPlan(null);
          setNotice({
            title:
              result.summary.found === 0
                ? t('historyImportMissing')
                : result.summary.parsed + result.summary.reviewed + result.summary.declined === 0
                  ? t('historyImportNoneFound')
                  : result.summary.reviewed > 0
                    ? t('historyImportReviewReady')
                  : t('upToDate'),
            body:
              result.summary.found === 0
                ? t('historyImportMissingBody')
                : result.summary.parsed + result.summary.reviewed + result.summary.declined === 0
                  ? t('historyNoSupportedCompact')
                  : result.summary.reviewed > 0
                    ? t('historyReviewCompact')
                    : t('historyNoNewCompact'),
          });
          const finalizeResult = await historyOperationController.finalize({
            save: ensureDurable,
            discard: () => discardIosHistorySession(native, history),
          });
          if (!active) return;
          if (finalizeResult === 'busy') return;
          if (finalizeResult === 'save-failed') {
            setHistoryCommitState('storage-failed');
            setNotice({ title: t('historyStorageFailed'), body: t('historyStorageFailedBody') });
          } else if (finalizeResult === 'cleanup-failed') {
            setHistoryCommitState('cleanup-failed');
            setNotice({ title: t('historyCleanupFailed'), body: t('historyCleanupFailedBody') });
          } else if (finalizeResult === 'complete') {
            await finishHistoryReview('complete');
          }
          return;
        }
        setPlan(nextPlan);
        if (counts.unread > 0 || counts.alreadyFiled > 0) {
          setNotice({
            title: t('historyImportReviewReady'),
            body: t('historyReviewCompact'),
          });
        }
      } catch (error) {
        if (active) {
          if (error instanceof ImportMoneyError) {
            setHistoryCommitState('source-retained');
            setNotice({ title: t('importMoneyMismatchTitle'), body: t('importMoneyMismatchBody') });
          } else if (coordinatorLoaded) {
            setHistoryCommitState('source-retained');
            setNotice({ title: t('historyImportFailed'), body: t('historyImportFailedBody') });
          } else if (iosHistoryLoadFailureDisposition(error) === 'cleanup-failed') {
            setHistoryCommitState('source-cleanup-failed');
            setNotice({ title: t('historyImportFailed'), body: t('historySourceCleanupFailed') });
          } else if (iosHistoryLoadFailureDisposition(error) === 'source-discarded') {
            setHistoryCommitState('source-discarded');
            setNotice({ title: t('historyImportFailed'), body: t('historySourceDiscarded') });
          } else {
            setHistoryCommitState('source-retained');
            setNotice({ title: t('historyImportFailed'), body: t('historyImportFailedBody') });
          }
        }
      } finally {
        if (active) setScanning(false);
      }
    };
    load();
    return () => { active = false; };
    // The import intentionally uses one hydrated ledger snapshot. Depending on
    // the whole state object would cancel a multi-chunk read after any store
    // update, while processedHistory prevents the replacement effect from
    // restarting it. A retry is exposed only for a failure before the
    // coordinator could prove the source was tombstoned.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, historyAttempt, state.hydrated, state.merchantOverrides]);

  const previewRows = useMemo(
    () => (plan?.batch.transactions ?? []).slice(0, PREVIEW_LIMIT),
    [plan],
  );

  /** Rows the parser had to guess at — the ones worth reporting. */
  const unreadCount = useMemo(
    () => historyResult
      ? historySourceSummary?.unread ?? 0
      : (plan?.batch.transactions ?? []).filter((tx) => tx.raw).length,
    [historyResult, historySourceSummary, plan],
  );

  const newBills = useMemo(() => {
    const existing = new Set(state.bills.map((b) => b.title.toLowerCase()));
    return (plan?.billDues ?? []).filter((p) => !existing.has(p.merchant.toLowerCase()));
  }, [plan, state.bills]);

  // Preview account name: index refs point into the plan's new accounts.
  const accountName = (ref: string): string => {
    if (/^\d+$/.test(ref)) return plan?.batch.newAccounts[Number(ref)]?.name ?? t('newCard');
    return state.accounts.find((a) => a.id === ref)?.name ?? '';
  };

  return (
    <ThemedView style={styles.root}>
      <Stack.Screen options={{ gestureEnabled: !validIosHistorySessionId(history) }} />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.headerWrap}>
          {/* The title has to describe what this screen can actually do on the
              phone it is running on: iOS gives no app access to Messages, so
              "Read my inbox" named something the screen cannot do there. This
              key is deliberately platform-neutral rather than branched on
              Platform.OS — it is true on both, and it has an Arabic value. */}
          <ScreenHeader title={t('importBankActivity')} onBack={leaveScreen} />
        </View>

        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: keyboardHeight + Spacing.six }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {Platform.OS === 'ios' && (
            <Section index={0}>
              <View
                testID="ios-history-card"
                style={[
                  styles.historyCard,
                  { backgroundColor: theme.backgroundElement, borderColor: theme.cardBorder },
                ]}>
                <View
                  accessible
                  accessibilityRole="header"
                  accessibilityLabel={t('historyCardTitle')}
                  style={styles.historyCardHeading}>
                  <Icon name="calendar" size={19} color={theme.primary} />
                  <View style={styles.rowText}>
                    <ThemedText type="small">{t('historyCardTitle')}</ThemedText>
                    <ThemedText type="meta" themeColor="textTertiary">
                      {historyCardState === 'unsupported'
                        ? t('historyRequiresIos26')
                        : historyCardState === 'install-unavailable'
                          ? t('historyInstallUnavailable')
                          : historyCardState === 'running'
                            ? t('historyRunningCompact')
                            : historyCardState === 'review'
                              ? t('historyReviewCompact')
                              : t('historyReadyCompact')}
                    </ThemedText>
                  </View>
                </View>
                {historySourceSummary && (
                  <View
                    accessibilityLiveRegion="polite"
                    style={styles.historySourceCounts}>
                    <ThemedText
                      testID="ios-history-source-count-row"
                      type="meta"
                      tabular
                      themeColor="textSecondary">
                      {tf('historySourceCountsRead', {
                        understood: historySourceSummary.understood,
                        unread: historySourceSummary.unread,
                      })}
                    </ThemedText>
                    <ThemedText
                      testID="ios-history-source-count-row"
                      type="meta"
                      tabular
                      themeColor="textSecondary">
                      {tf('historySourceCountsFiled', {
                        alreadyFiled: historySourceSummary.alreadyFiled,
                        notAlreadyFiled: historySourceSummary.notAlreadyFiled,
                      })}
                    </ThemedText>
                  </View>
                )}
                <Button
                  label={
                    historyCardState === 'unsupported'
                      ? t('historyPasteManually')
                      : historyCardState === 'install-unavailable'
                        ? t('historyInstallUnavailableAction')
                        : historyCardState === 'needs-install'
                          ? t(historyInstallOpened ? 'historyAddedAction' : 'historyAddAction')
                          : historyCardState === 'ready'
                            ? t(historyHandoffExpired ? 'historyTryAgain' : 'historyStartAction')
                            : historyCardState === 'running'
                              ? t('historyContinueAction')
                              : t('historyReviewAction')
                  }
                  icon={historyCardState === 'needs-install' ? 'download' : 'calendar'}
                  disabled={
                    historyActionBusy ||
                    historyCardState === 'install-unavailable' ||
                    historyCardState === 'review'
                  }
                  onPress={historyCardPrimaryAction}
                  wrapLabel
                />
                {historyCardState === 'running' && (
                  <Button
                    label={t('cancel')}
                    variant="ghost"
                    disabled={historyActionBusy}
                    onPress={() => void cancelHistoryHandoff()}
                  />
                )}
                {historyCardState === 'ready' && historyHandoffExpired && (
                  <Button
                    label={t('historyReinstallAction')}
                    variant="outline"
                    disabled={historyActionBusy}
                    onPress={() => void openHistoryInstall(true)}
                    wrapLabel
                  />
                )}
                {!history && historyCardState !== 'unsupported' && (
                  <Button
                    label={showManual ? t('hideManualPaste') : t('historyPasteManually')}
                    variant="ghost"
                    disabled={historyActionBusy}
                    onPress={() => setShowManual((value) => !value)}
                    wrapLabel
                  />
                )}
                <Button
                  label={t('historyLearnMore')}
                  variant="ghost"
                  onPress={() => setHistoryDetailsVisible(true)}
                />
              </View>
            </Section>
          )}
          {scanning ? (
            <Section
              index={0}
              style={styles.scanning}
              accessibilityRole="progressbar"
              accessibilityState={{ busy: true }}
              accessibilityLabel={tf('importProgressCounts', {
                read: progress?.scanned ?? 0,
                matched: progress?.found ?? 0,
              })}>
              <ScanPanel reducedMotion={reducedMotion} />
              <View style={styles.progressHead}>
                <View style={styles.progressLabel}>
                  <PulseDot color={theme.primary} />
                  <ThemedText type="micro" themeColor="textTertiary">
                    {t('importProgress')}
                  </ThemedText>
                </View>
                <ThemedText type="small" tabular>
                  {history && progress === null
                    ? t('historyPreparingReview')
                    : tf('importProgressCounts', {
                        read: progress?.scanned ?? 0,
                        matched: progress?.found ?? 0,
                      })}
                </ThemedText>
              </View>
              <ThemedText type="meta" themeColor="textTertiary">
                {history ? t('historyRunningCompact') : t('importProgressPrivacy')}
              </ThemedText>
            </Section>
          ) : (
            <Section index={0} style={styles.intro}>
              <ThemedText type="default" themeColor="textSecondary">
                {history
                  ? t('historyReviewCompact')
                  : isSmsScanningAvailable()
                  ? t('scanBankAlertsPrivacy')
                  : t('pasteHint')}
              </ThemedText>
              {/* THE PLATFORM-FAIR LINE. Pasting used to sit behind the
                  paywall, which on a phone with no inbox scan meant an iPhone
                  user paid to do by hand exactly what an Android user got for
                  free and automatically. runParse() no longer gates, and the
                  screen has to SAY so on the platform where pasting is the
                  only path — otherwise the wall is gone and nobody knows.
                  Same key as the paywall's own row, so the two can never
                  disagree about what is free. */}
              {!history && !isSmsScanningAvailable() && (
                <ThemedText type="meta" themeColor="textTertiary">
                  {t('featPasteFreeText')}
                </ThemedText>
              )}
              {!history && isSmsScanningAvailable() && (
                <>
                  <Button label={t('findBankAlerts')} icon="search" onPress={runScan} />
                  <Button
                    label={showManual ? t('hideManualPaste') : t('pasteInstead')}
                    variant="ghost"
                    onPress={() => setShowManual((value) => !value)}
                  />
                </>
              )}
              {!history && showManual && (
                <>
                  <TextInput
                    accessibilityLabel={t('pasteBankMessagesA11y')}
                    value={text}
                    // A verdict is about the text that produced it. Editing
                    // the box makes it stale, so it goes when the text does.
                    onChangeText={(value) => {
                      setText(value);
                      setPasteVerdict(null);
                      setNotice(null);
                    }}
                    multiline
                    placeholder={t('bankMessageExample')}
                    placeholderTextColor={theme.textTertiary}
                    style={[
                      styles.textarea,
                      {
                        backgroundColor: theme.backgroundElement,
                        borderColor: theme.controlBorder,
                        color: theme.text,
                        textAlign: state.language === 'ar' ? 'right' : 'left',
                      },
                    ]}
                  />
                  <View style={styles.parseRow}>
                    <Button
                      inline
                      variant="outline"
                      label={t('parsePastedText')}
                      onPress={() => runParse(text)}
                      disabled={!text.trim()}
                    />
                    <Button
                      inline
                      variant="ghost"
                      label={t('trySample')}
                      onPress={() => {
                        setText(SAMPLE);
                        runParse(SAMPLE);
                      }}
                    />
                  </View>
                </>
              )}
              {/* B's screen ended with a "Stop pasting" card linking to the
                  iPhone setup wizard. Deliberately not carried across: the
                  same job is done below by <SupplementImports />, which offers
                  the relay, forwarded email and PDF paths through a translated
                  copy layer, and the card's two sentences exist in no i18n key
                  (contracts.test.js bans an English literal here). If it comes
                  back it needs t() keys with ar: values, and its href is
                  /ios-setup — iphone-setup.tsx was the losing filename and is
                  gone. */}
            </Section>
          )}

          {/* The answer to a tap that could not do what it offered. It sits
              above the plan because it is the reason the plan is empty, or the
              reason there is no plan at all. */}
          {pasteReviewCount > 0 && !scanning ? (
            <Section index={1}>
              <Button label={tf('genericReviewCount', { count: pasteReviewCount, s: pasteReviewCount === 1 ? '' : 's' })}
                onPress={() => router.push('/review-alerts')} />
            </Section>
          ) : null}
          {notice !== null && !scanning && (
            <Section index={1}>
              <View accessibilityLiveRegion="polite">
                <Block>
                  <View style={styles.unreadRow}>
                    <Icon name="alert" size={17} color={theme.warning} />
                    <View style={styles.rowText}>
                      <ThemedText type="small">{notice.title}</ThemedText>
                      <ThemedText type="meta" themeColor="textTertiary">
                        {notice.body}
                      </ThemedText>
                    </View>
                  </View>
                </Block>
              </View>
              {validIosHistorySessionId(history) &&
                historyCommitState === 'source-retained' && (
                  <Button
                    label={t('retryHistoryRead')}
                    variant="outline"
                    onPress={() => setHistoryAttempt((attempt) => attempt + 1)}
                  />
                )}
              {history && (
                historyCommitState === 'cleanup-failed' ||
                historyCommitState === 'source-cleanup-failed' ||
                historyCommitState === 'cancel-cleanup-failed'
              ) && (
                <Button
                  label={t('deleteStagedMessages')}
                  variant="outline"
                  onPress={leaveScreen}
                />
              )}
              {historyCommitState === 'storage-failed' && (
                <Button
                  label={t('retrySecureSave')}
                  variant="outline"
                  disabled={applying}
                  onPress={retrySecureSave}
                />
              )}
              {history && (
                historyCommitState === 'cleanup-failed' ||
                historyCommitState === 'source-cleanup-failed' ||
                historyCommitState === 'cancel-cleanup-failed' ||
                historyCommitState === 'storage-failed'
              ) && (
                <Button
                  label={t('leaveImportScreen')}
                  variant="ghost"
                  onPress={leaveProtectedSessionForExpiry}
                />
              )}
            </Section>
          )}

          {plan !== null && !scanning && (
            <>
              <Section index={1}>
                <View style={[styles.stats, { borderColor: theme.cardBorder }]}>
                  {(
                    [
                      [plan.txCount, t('matchedLabel'), theme.text],
                      [plan.newAccountCount, t('cardsTitle'), theme.text],
                      [
                        unreadCount,
                        history ? t('skippedLabel') : t('unreadLabel'),
                        unreadCount > 0 ? theme.warning : theme.textTertiary,
                      ],
                    ] as const
                  ).map(([value, label, color], i) => (
                    <View
                      key={label}
                      style={[
                        styles.statCell,
                        i > 0 && { borderStartWidth: 1, borderStartColor: theme.cardBorder },
                      ]}>
                      <ThemedText type="small" tabular style={[styles.statFigure, { color }]}>
                        {value}
                      </ThemedText>
                      <ThemedText type="nano" style={{ color }}>
                        {label}
                      </ThemedText>
                    </View>
                  ))}
                </View>
                {skippedCount > 0 && (
                  <ThemedText type="meta" themeColor="textTertiary" style={styles.skipped}>
                    {skippedCount} {t('alreadyFiledSkipped')}
                  </ThemedText>
                )}
                {plan.healedCount > 0 && (
                  <ThemedText type="meta" style={{ color: theme.income }}>
                    {tf('improvedExistingEntries', {
                      count: plan.healedCount,
                      ending: plan.healedCount === 1 ? 'y' : 'ies',
                    })}
                  </ThemedText>
                )}
              </Section>

              {newBills.length > 0 && (
                <Section index={2}>
                  <SectionHeader title={t('billRemindersDetected')} />
                  {newBills.map((p, i) => {
                    const tracked = trackedBills.has(i);
                    return (
                      <Row key={`bill-${i}`} last={i === newBills.length - 1}>
                        <CategoryTile category={p.categoryGuess} />
                        <View style={styles.rowText}>
                          <ThemedText type="small" numberOfLines={1}>
                            {p.merchant}
                          </ThemedText>
                          <ThemedText type="meta" themeColor="textTertiary">
                            {categoryLabel(p.categoryGuess)}
                            {p.dueDay ? ` · ${tf('dueDay', { day: p.dueDay })}` : ''}
                          </ThemedText>
                        </View>
                        {!history && (
                          <Button
                            variant={tracked ? 'ghost' : 'outline'}
                            label={tracked ? t('tracked') : t('track')}
                            disabled={tracked || applying}
                            onPress={() => void trackReminder(p, i)}
                            style={styles.trackButton}
                          />
                        )}
                        {history && (
                          <ThemedText type="meta" themeColor="textTertiary">
                            {t('filesOnConfirm')}
                          </ThemedText>
                        )}
                      </Row>
                    );
                  })}
                </Section>
              )}

              {previewRows.length > 0 && (
                <Section index={3}>
                  <SectionHeader
                    title={
                      history
                        ? t('readyToFile')
                        : plan.txCount > PREVIEW_LIMIT
                        ? tf('justFiledFirst', { shown: PREVIEW_LIMIT, total: plan.txCount })
                        : t('justFiled')
                    }
                  />
                  {previewRows.map((tx, i) => (
                    <Animated.View
                      key={`${tx.date}-${tx.title}-${i}`}
                      entering={
                        reducedMotion || i >= 6
                          ? undefined
                          : FadeInDown.delay(i * 45).duration(180)
                      }>
                      <Row last={i === previewRows.length - 1}>
                        <CategoryTile category={tx.category} />
                        <View style={styles.rowText}>
                          <ThemedText type="small" numberOfLines={1}>
                            {tx.title}
                          </ThemedText>
                          <ThemedText type="meta" themeColor="textTertiary" numberOfLines={1}>
                            {categoryLabel(tx.category)} · {shortDate(tx.date)}
                            {accountName(tx.accountId) ? ` · ${accountName(tx.accountId)}` : ''}
                          </ThemedText>
                        </View>
                        <Money
                          fils={tx.amountFils}
                          prefix={false}
                          sign={tx.type === 'income' ? 'plus' : 'minus'}
                          color={tx.type === 'income' ? theme.income : theme.text}
                        />
                      </Row>
                    </Animated.View>
                  ))}
                </Section>
              )}

              {unreadCount > 0 && (
                <Section index={4}>
                  <Block onPress={() => router.push('/accuracy')}>
                    <View style={styles.unreadRow}>
                      <Icon name="alert" size={17} color={theme.warning} />
                      <View style={styles.rowText}>
                        <ThemedText type="small">
                          {tf('unknownMessageFormats', {
                            count: unreadCount,
                            s: unreadCount === 1 ? '' : 's',
                          })}
                        </ThemedText>
                        <ThemedText type="meta" themeColor="textTertiary">
                          {t('shareMaskedFormatsHint')}
                        </ThemedText>
                      </View>
                      <Icon name="chevron-right" size={15} color={theme.textTertiary} />
                    </View>
                  </Block>
                </Section>
              )}
            </>
          )}

          {/* The answer to a paste that filed nothing. It sits ABOVE the
              alternative routes and leaves them on screen, because "we cannot
              read this one" and "here are the other ways in" are one thought. */}
          {pasteVerdict !== null && !scanning && (
            <Section index={1}>
              <Block>
                <View style={styles.unreadRow}>
                  <Icon
                    name="alert"
                    size={17}
                    color={pasteVerdict.kind === 'filed' ? theme.textTertiary : theme.warning}
                  />
                  <View style={styles.rowText}>
                    <ThemedText type="small">
                      {pasteVerdict.kind === 'filed'
                        ? t('upToDate')
                        : tf('unknownMessageFormats', {
                            count: pasteVerdict.count,
                            s: pasteVerdict.count === 1 ? '' : 's',
                          })}
                    </ThemedText>
                    <ThemedText type="meta" themeColor="textTertiary">
                      {pasteVerdict.kind === 'filed'
                        ? `${pasteVerdict.count} ${t('alreadyFiledSkipped')}`
                        : t('pasteHint')}
                    </ThemedText>
                  </View>
                </View>
              </Block>
            </Section>
          )}

          {!history && !scanning && plan === null && (
            <Section index={2}>
              <SupplementImports />
            </Section>
          )}
        </ScrollView>

        {plan !== null && !scanning && (
          plan.txCount > 0 ||
          plan.dueCount > 0 ||
          plan.healedCount > 0 ||
          (history && plan.billDues.length > 0)
        ) && (
          <View style={styles.footer}>
            {/* The button appears for dues and healed rows too, so labelling
                it from txCount alone offered to "File 0 entries" after a scan
                that found only statement reminders. Name what is actually
                about to be filed. */}
            <Button
              label={
                plan.txCount > 0
                  ? tf('fileEntries', {
                      count: plan.txCount,
                      ending: plan.txCount === 1 ? 'y' : 'ies',
                    })
                  : plan.dueCount > 0
                    ? tf('fileCardDues', {
                        count: plan.dueCount,
                        s: plan.dueCount === 1 ? '' : 's',
                      })
                    : history && plan.billDues.length > 0
                      ? tf('fileBillReminders', {
                          count: plan.billDues.length,
                          s: plan.billDues.length === 1 ? '' : 's',
                        })
                    : tf('fixEntries', {
                        count: plan.healedCount,
                        ending: plan.healedCount === 1 ? 'y' : 'ies',
                      })
              }
              onPress={applyPlan}
              disabled={applying}
            />
          </View>
        )}
        <HistoryDetailsSheet
          visible={historyDetailsVisible}
          onClose={() => setHistoryDetailsVisible(false)}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
  },
  safe: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  headerWrap: {
    paddingHorizontal: ScreenPadding,
  },
  content: {
    paddingHorizontal: ScreenPadding,
    paddingBottom: Spacing.five,
    gap: Spacing.four,
  },
  intro: {
    gap: Spacing.three - 2,
  },
  historyCard: {
    borderWidth: 1,
    borderRadius: Radius.sheet,
    padding: Spacing.three,
    gap: Spacing.three - 2,
  },
  historyCardHeading: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two + 2,
  },
  historySourceCounts: {
    gap: Spacing.half,
  },
  scanning: {
    gap: Spacing.three - 2,
  },
  panel: {
    height: PANEL_HEIGHT,
    borderWidth: 1,
    borderRadius: Radius.sheet,
    padding: Spacing.three + 2,
    gap: Spacing.three - 2,
    overflow: 'hidden',
  },
  panelLine: {
    height: 10,
    borderRadius: 5,
  },
  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 2,
  },
  progressLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  progressHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  textarea: {
    minHeight: 110,
    borderWidth: 1,
    borderRadius: Radius.control,
    padding: Spacing.three - 4,
    fontSize: 13,
    textAlignVertical: 'top',
  },
  parseRow: {
    flexDirection: 'row',
    gap: Spacing.two + 2,
  },
  stats: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.half,
    paddingVertical: Spacing.three - 2,
  },
  statFigure: {
    fontSize: 20,
    lineHeight: 24,
  },
  skipped: {
    paddingTop: Spacing.two,
  },
  rowText: {
    flex: 1,
    gap: Spacing.half,
  },
  trackButton: {
    minHeight: 36,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three - 2,
  },
  unreadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
  },
  footer: {
    paddingHorizontal: ScreenPadding,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
});
