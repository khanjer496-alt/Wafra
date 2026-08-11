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
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
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
import { Button } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { Block, Row, ScreenHeader, Section, SectionHeader } from '@/components/ui/layout';
import { Money } from '@/components/ui/money';
import { PulseDot } from '@/components/ui/states';
import { CategoryTile } from '@/components/ui/tile';
import { EASE, MaxContentWidth, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { useTheme } from '@/hooks/use-theme';
import {
  buildImportPlan,
  isSmsScanningAvailable,
  requestSmsPermission,
  scanInbox,
  type ImportPlan,
  type ScannedSms,
} from '@/lib/auto-import';
import { categoryLabel } from '@/lib/categories';
import { shortDate } from '@/lib/format';
import {
  parseHistoricalMessageRecords,
  type HistoricalImportResult,
} from '@/lib/historical-import';
import { isProActive, requiresPro } from '@/lib/purchases';
import { parseSmsBatch } from '@/lib/sms-parser';
import { useStore } from '@/lib/store';
import { t, tf } from '@/lib/i18n';

const EASING = Easing.bezier(EASE[0], EASE[1], EASE[2], EASE[3]);

const SAMPLE = `Purchase of AED 187.50 with Debit Card ending 1234 at CARREFOUR MALL OF EMIRATES, DUBAI on 17/07/2026. Avl balance AED 12,345.67

AED 55.00 was debited from your account for payment to SALIK RECHARGE on 16/07/2026

Salary of AED 18,500.00 has been credited to your account ending 5678`;

const PREVIEW_LIMIT = 60;
const PANEL_HEIGHT = 186;
const HISTORY_SHORTCUT_URL = 'shortcuts://run-shortcut?name=Wafra%20History%20Import';
const HISTORY_SHORTCUT_INSTALL_URL = process.env.EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL;
const HISTORY_SESSION_RE = /^[A-Za-z0-9_-]{8,128}$/;

function validHistorySession(value: string | undefined): value is string {
  return typeof value === 'string' && HISTORY_SESSION_RE.test(value);
}

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
  return billDues.length === plan.billDues.length ? plan : { ...plan, billDues };
}

function supportsHistoricalShortcut(): boolean {
  if (Platform.OS !== 'ios') return false;
  const [major = 0, minor = 0] = String(Platform.Version)
    .split('.')
    .map((part) => Number(part));
  return major > 26 || (major === 26 && minor >= 5);
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
function ScanPanel() {
  const theme = useTheme();
  const y = useSharedValue(0);

  useEffect(() => {
    y.value = withRepeat(withTiming(1, { duration: 2400, easing: EASING }), -1, false);
  }, [y]);

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
  const { auto, history } = useLocalSearchParams<{ auto?: string; history?: string }>();
  const { state, importBatch, ensureDurable, stageReviewAlerts, addBill } = useStore();

  const [text, setText] = useState('');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [showManual, setShowManual] = useState(() => !isSmsScanningAvailable());
  const [progress, setProgress] = useState<{ scanned: number; found: number } | null>(null);
  const [trackedBills, setTrackedBills] = useState<Set<number>>(new Set());
  const [skippedCount, setSkippedCount] = useState(0);
  const [pasteVerdict, setPasteVerdict] = useState<PasteVerdict | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [applying, setApplying] = useState(false);
  const [historyResult, setHistoryResult] = useState<HistoricalImportResult | null>(null);
  const [pendingScanCommit, setPendingScanCommit] = useState<(() => Promise<void>) | null>(null);
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const [historyCommitState, setHistoryCommitState] = useState<
    'idle' | 'writing' | 'storage-failed' | 'cleanup-failed'
  >('idle');
  const started = useRef(false);
  const processedHistory = useRef<string | null>(null);
  // State updates are not synchronous enough to protect a write/cleanup
  // critical section from a second tap. This latch is.
  const historyOperationLocked = useRef(false);

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
      const { parsed, reviewCandidates, newestTs, declined, commit } = await scanInbox(
        0,
        state.merchantOverrides,
        (scanned, found) => setProgress({ scanned, found }),
      );
      const reviewReceipt = stageReviewAlerts(reviewCandidates);
      await reviewReceipt.durable;
      // `declined` carried through, exactly as the automatic path does. Without
      // it this screen — the one a user reaches BECAUSE something looks wrong —
      // is the one path that cannot clear a refused transaction the ledger
      // recorded as spending.
      const p = buildImportPlan(parsed, state, newestTs, new Date(), declined);
      const txLike = parsed.filter((x) => x.kind === 'transaction' || x.kind === 'cardPayment');
      setSkippedCount(Math.max(0, txLike.length - p.txCount));
      setPlan(p);
      setTrackedBills(new Set());
      if (p.txCount === 0 && p.dueCount === 0 && p.billDues.length === 0 && p.healedCount === 0) {
        await commit();
        setNotice({ title: t('upToDate'), body: t('inboxAlreadyFiled') });
        setPendingScanCommit(null);
      } else {
        setPendingScanCommit(() => commit);
      }
    } finally {
      setScanning(false);
    }
  };

  /**
   * Free, on every platform. The user is holding the message; all Wafra does
   * is read it better than they would type it.
   */
  const runParse = (input: string) => {
    if (!state.hydrated) {
      setNotice({ title: t('importOneMoment'), body: t('dataStillLoading') });
      return;
    }
    setNotice(null);
    // Deliberately NO isProActive gate here. Pasting is the only ingestion
    // path an iPhone has without a Shortcut, so paywalling it charged an
    // iPhone user for the privilege of doing the work by hand that an Android
    // user gets automatically. Pasting is `manual` capture, and
    // requiresPro('manual') is false on every platform by design.
    const parsed: ScannedSms[] = parseSmsBatch(input, state.merchantOverrides);
    const p = buildImportPlan(parsed, state, state.lastScanTs);
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
      setPasteVerdict(
        skipped > 0
          ? { kind: 'filed', count: skipped }
          : { kind: 'unreadable', count: messageBlocks(input) },
      );
      return;
    }
    setPasteVerdict(null);
    setPlan(p);
  };

  const discardHistorySession = async () => {
    if (!validHistorySession(history) || Platform.OS !== 'ios') return;
    const native = await historyNativeModule();
    await native.discardSession(history);
  };

  const leaveScreen = async () => {
    if (historyOperationLocked.current) return;
    if (!history || !validHistorySession(history)) {
      router.back();
      return;
    }
    // A failed SQLCipher write has already updated in-memory state. Keep the
    // protected source session so recovery after restart remains possible.
    if (historyCommitState === 'storage-failed') {
      setNotice({ title: t('historyStorageFailed'), body: t('historyStorageFailedBody') });
      return;
    }
    historyOperationLocked.current = true;
    try {
      await discardHistorySession();
      router.back();
    } catch {
      historyOperationLocked.current = false;
      setHistoryCommitState('cleanup-failed');
      setNotice({ title: t('historyCleanupFailed'), body: t('historyCleanupFailedBody') });
    }
  };

  const leaveProtectedSessionForExpiry = () => {
    // A native deletion or encrypted-write failure must not trap the user on
    // an uncloseable route. The source remains under complete file protection
    // and the native store will purge it after the documented TTL.
    historyOperationLocked.current = false;
    router.back();
  };

  const applyPlan = async () => {
    if (!plan || applying || historyOperationLocked.current) return;
    historyOperationLocked.current = true;
    setApplying(true);
    setNotice(null);
    setHistoryCommitState('writing');
    // A live alert may land while this review is open. Rebuild against the
    // latest state at the moment of confirmation so history/live overlap does
    // not become two entries merely because the preview was old.
    const currentPlan = historyResult
      ? withoutExistingBillReminders(
          buildImportPlan(historyResult.parsed, state, 0, new Date(), historyResult.declined),
          state.bills.map((bill) => bill.title),
        )
      : plan;
    if (
      currentPlan.txCount === 0 &&
      currentPlan.dueCount === 0 &&
      currentPlan.healedCount === 0 &&
      currentPlan.billDues.length === 0
    ) {
      setPlan(null);
      setHistoryCommitState('idle');
      if (!history && pendingScanCommit) {
        try {
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
      if (history) {
        const existingBills = new Set(state.bills.map((bill) => bill.title.toLowerCase()));
        for (const due of currentPlan.billDues) {
          if (existingBills.has(due.merchant.toLowerCase())) continue;
          existingBills.add(due.merchant.toLowerCase());
          addBill({
            title: due.merchant,
            category: due.categoryGuess,
            amountFils: due.amountFils,
            dueDay: due.dueDay ?? (due.date ? Number(due.date.slice(8)) : 1),
            autoDetected: true,
          });
        }
      }
      // Dispatch happened synchronously. Remove the button now: retrying this
      // same plan would mint new transaction IDs even if the durable write or
      // the later source cleanup fails.
      setPlan(null);
      await receipt.durable;
      if (history && currentPlan.billDues.length > 0) await ensureDurable();
    } catch {
      historyOperationLocked.current = false;
      setHistoryCommitState('storage-failed');
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

  const retrySecureSave = async () => {
    if (applying || historyOperationLocked.current) return;
    historyOperationLocked.current = true;
    setApplying(true);
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
    if (auto === '1' && isSmsScanningAvailable() && !started.current) {
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
      setScanning(true);
      setNotice(null);
      setPasteVerdict(null);
      setPlan(null);
      setHistoryResult(null);
      setShowManual(false);
      setHistoryCommitState('idle');
      try {
        if (!validHistorySession(history)) {
          setNotice({
            title: t('historyImportInvalid'),
            body: t('historyImportInvalidBody'),
          });
          return;
        }
        const native = await historyNativeModule();
        await native.purgeExpired();
        const chunks = await native.listSessionChunks(history);
        const seenIds = new Set<string>();
        const result: HistoricalImportResult = {
          parsed: [], declined: [], totalCount: 0, acceptedCount: 0,
          invalidCount: 0, ignoredCount: 0, duplicateCount: 0, newestTs: 0,
        };
        for (const chunkIndex of chunks) {
          const records = await native.readChunk(history, chunkIndex);
          if (!active) return;
          const part = parseHistoricalMessageRecords(
            records,
            state.merchantOverrides,
            new Date(),
            seenIds,
          );
          result.parsed.push(...part.parsed);
          result.declined.push(...part.declined);
          result.totalCount += part.totalCount;
          result.acceptedCount += part.acceptedCount;
          result.invalidCount += part.invalidCount;
          result.ignoredCount += part.ignoredCount;
          result.duplicateCount += part.duplicateCount;
          result.newestTs = Math.max(result.newestTs, part.newestTs);
          setProgress({ scanned: result.totalCount, found: result.acceptedCount });
          // One native chunk is at most 50 records. Yield between chunks so a
          // multi-year import cannot monopolize the JS thread for one long
          // unresponsive frame or bridge the whole raw corpus at once.
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
        result.parsed.sort((a, b) => (a.smsTs ?? 0) - (b.smsTs ?? 0));
        result.declined.sort((a, b) => a.smsTs - b.smsTs);
        if (!active) return;
        setHistoryResult(result);
        const nextPlan = withoutExistingBillReminders(
          buildImportPlan(result.parsed, state, 0, new Date(), result.declined),
          state.bills.map((bill) => bill.title),
        );
        const txLike = result.parsed.filter(
          (row) => row.kind === 'transaction' || row.kind === 'cardPayment',
        );
        setSkippedCount(Math.max(0, txLike.length - nextPlan.txCount));
        setTrackedBills(new Set());
        if (
          nextPlan.txCount === 0 &&
          nextPlan.dueCount === 0 &&
          nextPlan.billDues.length === 0 &&
          nextPlan.healedCount === 0
        ) {
          const recognizedCount = result.acceptedCount + result.declined.length;
          setPlan(null);
          setNotice({
            title:
              result.totalCount === 0
                ? t('historyImportMissing')
                : recognizedCount === 0
                  ? t('historyImportNoneFound')
                  : t('upToDate'),
            body:
              result.totalCount === 0
                ? t('historyImportMissingBody')
                : recognizedCount === 0
                  ? tf('historyImportNoneFoundBody', {
                      read: result.totalCount,
                      skipped: result.invalidCount + result.ignoredCount,
                    })
                  : tf('historyImportNoNew', {
                      read: result.totalCount,
                      skipped: result.invalidCount + result.ignoredCount + result.duplicateCount,
                    }),
          });
          await native.discardSession(history);
          return;
        }
        setPlan(nextPlan);
        if (result.invalidCount + result.ignoredCount > 0) {
          setNotice({
            title: t('historyImportReviewReady'),
            body: tf('historyImportReviewCounts', {
              matched: result.acceptedCount,
              skipped: result.invalidCount + result.ignoredCount,
            }),
          });
        }
      } catch {
        if (active) {
          setNotice({ title: t('historyImportFailed'), body: t('historyImportFailedBody') });
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
    // restarting it. A new user retry increments historyAttempt explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, historyAttempt, state.hydrated, state.merchantOverrides]);

  const previewRows = useMemo(
    () => (plan?.batch.transactions ?? []).slice(0, PREVIEW_LIMIT),
    [plan],
  );

  /** Rows the parser had to guess at — the ones worth reporting. */
  const unreadCount = useMemo(
    () => historyResult
      ? historyResult.invalidCount + historyResult.ignoredCount
      : (plan?.batch.transactions ?? []).filter((tx) => tx.raw).length,
    [historyResult, plan],
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
      <Stack.Screen options={{ gestureEnabled: !validHistorySession(history) }} />
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
          {scanning ? (
            <Section index={0} style={styles.scanning}>
              <ScanPanel />
              <View style={styles.progressHead}>
                <View style={styles.progressLabel}>
                  <PulseDot color={theme.primary} />
                  <ThemedText type="micro" themeColor="textTertiary">
                    {t('importProgress')}
                  </ThemedText>
                </View>
                <ThemedText type="small" tabular>
                  {history
                    ? t('historyPreparingReview')
                    : tf('importProgressCounts', {
                        read: progress?.scanned ?? 0,
                        matched: progress?.found ?? 0,
                      })}
                </ThemedText>
              </View>
              <ThemedText type="meta" themeColor="textTertiary">
                {t('importProgressPrivacy')}
              </ThemedText>
            </Section>
          ) : (
            <Section index={0} style={styles.intro}>
              <ThemedText type="default" themeColor="textSecondary">
                {history
                  ? t('historyReviewPrivacy')
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
              {supportsHistoricalShortcut() && HISTORY_SHORTCUT_INSTALL_URL && !history && (
                <>
                  <Button
                    label={t('installHistoryShortcut')}
                    icon="download"
                    variant="outline"
                    onPress={() => {
                      Linking.openURL(HISTORY_SHORTCUT_INSTALL_URL).catch(() => {
                        setNotice({
                          title: t('historyShortcutMissing'),
                          body: t('historyShortcutMissingBody'),
                        });
                      });
                    }}
                  />
                  <Button
                    label={t('importPastMessages')}
                    icon="calendar"
                    onPress={async () => {
                      setNotice(null);
                      try {
                        await Linking.openURL(HISTORY_SHORTCUT_URL);
                      } catch {
                        setNotice({
                          title: t('historyShortcutMissing'),
                          body: t('historyShortcutMissingBody'),
                        });
                      }
                    }}
                  />
                  <ThemedText type="meta" themeColor="textTertiary">
                    {t('historyImportPrivacy')}
                  </ThemedText>
                </>
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
                        borderColor: theme.cardBorder,
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
              {validHistorySession(history) && historyResult === null && historyCommitState === 'idle' && (
                <Button
                  label={t('retryHistoryRead')}
                  variant="outline"
                  onPress={() => setHistoryAttempt((attempt) => attempt + 1)}
                />
              )}
              {history && historyCommitState === 'cleanup-failed' && (
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
                            disabled={tracked}
                            onPress={() => {
                              addBill({
                                title: p.merchant,
                                category: p.categoryGuess,
                                amountFils: p.amountFils,
                                dueDay: p.dueDay ?? (p.date ? Number(p.date.slice(8)) : 1),
                                autoDetected: true,
                              });
                              setTrackedBills(new Set(trackedBills).add(i));
                            }}
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
                    <Animated.View key={`${tx.date}-${tx.title}-${i}`} entering={FadeInDown.delay(i * 100)}>
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
