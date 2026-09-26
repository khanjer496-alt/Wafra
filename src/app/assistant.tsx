import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, AppState as NativeAppState, Keyboard, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AssistantMonthChart, AssistantPaymentRows } from '@/components/assistant-answer-extras';
import { AssistantEvidenceSheet } from '@/components/assistant-evidence-sheet';
import { AssistantCoverage, AssistantFindings } from '@/components/assistant-findings';
import { PeriodSheet } from '@/components/period-sheet';
import { ThemedText } from '@/components/themed-text';
import { BandScaffold } from '@/components/ui/band-scaffold';
import { EButton } from '@/components/ui/band/e-button';
import { Icon, type IconName } from '@/components/ui/icon';
import { Fonts, Radius, type BandPalette } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { scaleTextStyleForE2E } from '@/lib/e2e-font-scale';
import { assistantCopy as copy } from '@/lib/assistant-copy';
import { assistantScreenCopy, evidenceTransactionCount } from '@/lib/assistant-screen-copy';
import { categoryLabel } from '@/lib/categories';
import { toISODate } from '@/lib/format';
import { tapped } from '@/lib/haptics';
import { t, tf } from '@/lib/i18n';
import { groundLocalAssistantRequest, isIndependentAssistantQuestion, localAssistantPreviousRequest, normalizeLocalAssistantQuestion } from '@/lib/local-assistant-grounding';
import { improveAssistantRequestLocally } from '@/lib/local-semantic-assistant';
import { LOCAL_SEMANTIC_E5_ENABLED } from '@/lib/local-semantic-flags';
import { onDeviceAI, type OnDeviceAIAvailability } from '@/lib/on-device-ai';
import { improveAssistantRequestOnDevice } from '@/lib/on-device-assistant';
import { ledgerCurrencyCode } from '@/lib/markets';
import { currentMonthPeriod, periodLabel, periodRange } from '@/lib/period';
import { usePeriod } from '@/lib/period-context';
import { useStore } from '@/lib/store';
import { transferFingerprint } from '@/lib/transfer-reconciliation';
import type { AppState } from '@/lib/types';
import {
  assistantFollowUpQuestions, executeAssistantTool, latestAssistantContext, planAssistantCorrection, runWafraAssistant,
  runWafraAssistantCooperatively, suggestedAssistantQuestions,
  type AssistantAnswer, type AssistantCorrectionPlan, type AssistantFinding, type AssistantToolRequest,
} from '@/lib/wafra-assistant';

const MAX_TURNS = 12;
// Immutable store references invalidate old amounts after edits/imports.
// No ledger rows or raw messages are copied into persistent chat storage.
const ledgerInputs = (state: AppState): unknown[] => [state.transactions, state.accounts,
  state.bills, state.cardDues, state.notSubscriptions, state.monthStartDay,
  state.ledgerMoney, state.historyImport];

interface AssistantTurn {
  id: number;
  generation: number;
  question: string;
  answer: AssistantAnswer;
  request: AssistantToolRequest;
  answeredAt: Date;
  inputs: unknown[];
  /** The platform model chose the tool; Wafra still computed every figure. */
  interpretedOnDevice?: boolean;
}

/** Honest, state-specific status for the platform model. Null hides the line. */
function onDeviceStatusCopy(availability: OnDeviceAIAvailability | null): string | null {
  if (!availability) return null;
  switch (availability.status) {
    case 'available':
      return availability.provider === 'gemini-nano' ? copy.onDeviceAiReadyGemini : copy.onDeviceAiReadyApple;
    case 'not-enabled': return copy.onDeviceAiNotEnabled;
    case 'model-not-ready': return copy.onDeviceAiPreparing;
    default: return copy.onDeviceAiUnavailable;
  }
}

/**
 * An answer's action as a pill on the sheet: the first (primary) one is
 * filled with the band colour, the rest are cards with a rule. 48pt tall, so
 * each is a full touch target; the label wraps rather than being cut.
 */
function AskPill({ label, onPress, palette, primary = false, icon, testID }: {
  label: string;
  onPress: () => void;
  palette: BandPalette;
  primary?: boolean;
  icon?: IconName;
  testID?: string;
}) {
  const fg = primary ? palette.onFill : palette.text;
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={() => { tapped(); onPress(); }}
    style={({ pressed }) => [styles.pill, primary
      ? { backgroundColor: palette.fill, borderColor: palette.fill }
      : { backgroundColor: palette.card, borderColor: palette.rule }, { opacity: pressed ? 0.8 : 1 }]}>
    {icon ? <Icon name={icon} size={16} color={fg} strokeWidth={2} /> : null}
    <ThemedText type="smallBold" style={[styles.pillText, { color: fg }]}>{label}</ThemedText>
  </Pressable>;
}

export default function AssistantScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ question?: string }>();
  // Ask is a Home detail: it wears Home's ink band.
  const band = useBand('home');
  const largeText = useLargeTextLayout();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const { fontScale, height } = useWindowDimensions();
  const { state, getStateSnapshot, getStateGeneration, editTransaction, resolveTransfers,
    setMerchantOverride, setNotSubscription } = useStore();
  const { period } = usePeriod();
  // Redesign additions read plain state: no new hooks, so hook order is unchanged.
  const screenLanguage: 'en' | 'ar' = state.language === 'ar' ? 'ar' : 'en';
  const screenCopy = assistantScreenCopy(screenLanguage);
  const ledgerMoney = state.ledgerMoney ?? null;
  const periodKey = JSON.stringify(period);
  const generation = getStateGeneration();
  const scrollRef = useRef<ScrollView>(null);
  const needsScroll = useRef(false);
  const scrollFrame = useRef<number | null>(null);
  const nextId = useRef(0);
  const routeQuestionHandled = useRef<string | null>(null);
  const sendingRef = useRef(false);
  const previousGeneration = useRef(generation);
  const hadHydratedLedger = useRef(false);
  const previousPeriod = useRef(periodKey);
  const [question, setQuestion] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [aiAvailability, setAiAvailability] = useState<OnDeviceAIAvailability | null>(() => onDeviceAI.peekAvailability());
  const [preparingModel, setPreparingModel] = useState(false);
  useFocusEffect(useCallback(() => {
    let active = true;
    // Availability changes in Settings (Apple Intelligence on/off, model
    // downloaded) while Wafra is in the background: re-check on focus/return.
    const update = () => {
      void onDeviceAI.getAvailability({ refresh: true }).then((value) => { if (active) setAiAvailability(value); });
    };
    update();
    const subscription = NativeAppState.addEventListener('change', (status) => { if (status === 'active') update(); });
    return () => { active = false; subscription.remove(); };
  }, []));
  const aiStatus = onDeviceStatusCopy(aiAvailability);
  const prepareModel = () => {
    if (preparingModel) return;
    setPreparingModel(true);
    void onDeviceAI.prepare().then(setAiAvailability).finally(() => setPreparingModel(false));
  };
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [turns, setTurns] = useState<AssistantTurn[]>([]);
  const [droppedTurns, setDroppedTurns] = useState(false);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [evidenceSelection, setEvidenceSelection] = useState<{ turnId: number; findingId?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [today, setToday] = useState(() => toISODate(new Date()));
  const minInputHeight = Math.max(48, Math.ceil(22 * fontScale) + 24);
  const maxInputHeight = Math.max(minInputHeight, Math.min(160, height * 0.25));
  const [inputHeight, setInputHeight] = useState(minInputHeight);
  const currentTurns = turns.filter((turn) => turn.generation === generation);
  const latest = currentTurns.at(-1);
  const correctionContextTurn = [...currentTurns].reverse().find((turn) => turn.answer.tool !== 'help');
  const conversationContext = latestAssistantContext(currentTurns.map((turn) => turn.request));
  const contextPeriod = conversationContext && 'period' in conversationContext ? conversationContext.period : period;
  const suggestions = useMemo(() => state.hydrated ? suggestedAssistantQuestions(state, period) : [],
    // Suggestions read the ledger, not capture/progress metadata.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.hydrated, state.transactions, state.bills, state.cardDues, state.budgets, state.accounts, state.notSubscriptions, state.monthStartDay, period]);
  const latestSuggestions = latest?.answer.suggestions?.length &&
    (latest.request.tool !== 'help' || latest.request.suggestions?.length)
    ? latest.answer.suggestions : undefined;
  const followUps = latestSuggestions ?? (conversationContext ? assistantFollowUpQuestions(conversationContext) : []);
  const inputs = ledgerInputs(state);
  const isStale = (turn: AssistantTurn) => turn.answer.tool !== 'help' &&
    (toISODate(turn.answeredAt) !== today || turn.inputs.some((value, index) => value !== inputs[index]));
  const evidenceTurn = currentTurns.find((turn) => turn.id === evidenceSelection?.turnId);
  const selectedEvidence = evidenceSelection?.findingId
    ? evidenceTurn?.answer.findings?.find((finding) => finding.id === evidenceSelection.findingId)?.evidence
    : evidenceTurn?.answer.evidence;
  const hasRecords = state.transactions.length > 0 || state.bills.length > 0 || state.cardDues.length > 0;

  const scrollToLatest = useCallback(() => {
    if (!needsScroll.current) return;
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    // Both the footer and transcript can relayout after a send. Wait for the
    // completed layout rather than consuming the request on an earlier frame.
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = requestAnimationFrame(() => {
        if (needsScroll.current) scrollRef.current?.scrollToEnd({ animated: false });
        needsScroll.current = false;
        scrollFrame.current = null;
      });
    });
  }, []);

  useEffect(() => () => {
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
  }, []);

  const appendAnswer = (clean: string, result: { request: AssistantToolRequest; answer: AssistantAnswer; interpretedOnDevice?: boolean },
    snapshot: AppState, answeredAt: Date) => {
    const id = ++nextId.current;
    const currentGeneration = getStateGeneration();
    needsScroll.current = true;
    if (currentTurns.length >= MAX_TURNS) setDroppedTurns(true);
    setTurns((current) => [...current.filter((turn) => turn.generation === currentGeneration).slice(-(MAX_TURNS - 1)), {
      id, generation: currentGeneration, question: clean, ...result, answeredAt, inputs: ledgerInputs(snapshot),
    }]);
    setError(null);
    setQuestion('');
    setInputHeight(minInputHeight);
    if (result.answer.showEvidence && result.answer.evidence?.length) {
      Keyboard.dismiss();
      setEvidenceSelection({ turnId: id });
    }
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(result.answer.title + '. ' + result.answer.body);
    return id;
  };

  const appendCorrectionResult = (
    clean: string,
    summary: string,
    beforeGeneration: number,
    answeredAt: Date,
    contextRequest?: AssistantToolRequest,
  ) => {
    const snapshot = getStateSnapshot();
    const currentGeneration = getStateGeneration();
    // This generation change was caused by the correction the user just asked
    // for. Preserve the transcript, but keep the old input references so those
    // earlier answers visibly become stale rather than silently changing.
    previousGeneration.current = currentGeneration;
    const base = contextRequest
      ? executeAssistantTool(snapshot, contextRequest, answeredAt)
      : executeAssistantTool(snapshot, { tool: 'help', clarification: summary }, answeredAt);
    const answer: AssistantAnswer = contextRequest
      ? { ...base, title: tf('assistantCorrectionUpdatedTitle', { title: base.title }), body: `${summary} ${base.body}` }
      : base;
    const request = contextRequest ?? { tool: 'help' as const, clarification: summary };
    const id = ++nextId.current;
    needsScroll.current = true;
    setTurns((current) => {
      const rebased = current.filter((turn) => turn.generation === beforeGeneration)
        .map((turn) => ({ ...turn, generation: currentGeneration }));
      return [...rebased.slice(-(MAX_TURNS - 1)), {
        id, generation: currentGeneration, question: clean, request, answer,
        answeredAt, inputs: ledgerInputs(snapshot),
      }];
    });
    setQuestion('');
    setInputHeight(minInputHeight);
    setEvidenceSelection(null);
    setError(null);
    setToday(toISODate(answeredAt));
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(answer.title + '. ' + answer.body);
  };

  const applyCorrection = async (
    clean: string,
    correction: Exclude<AssistantCorrectionPlan, { kind: 'clarification' }>,
    snapshot: AppState,
    now: Date,
  ) => {
    const beforeGeneration = getStateGeneration();
    const contextRequest = correctionContextTurn?.request ?? conversationContext;
    const correctionLanguage: 'en' | 'ar' = snapshot.language === 'ar' ? 'ar' : 'en';
    let summary: string;
    if (correction.kind === 'merchant-category') {
      setMerchantOverride(correction.merchant, correction.category, true, correction.direction);
      summary = tf(
        correction.direction === 'income'
          ? 'assistantCorrectionMerchantCategoryIncome'
          : 'assistantCorrectionMerchantCategoryExpense',
        {
          merchant: correction.merchant,
          category: categoryLabel(correction.category, correctionLanguage),
        },
      );
    } else if (correction.kind === 'transaction-category') {
      editTransaction(correction.transactionId, { category: correction.category });
      summary = tf('assistantCorrectionTransactionCategory', {
        category: categoryLabel(correction.category, correctionLanguage),
      });
    } else if (correction.kind === 'not-subscription') {
      setNotSubscription(correction.merchant, true);
      summary = tf('assistantCorrectionNotSubscription', { merchant: correction.merchant });
    } else {
      const row = snapshot.transactions.find((transaction) => transaction.id === correction.transactionId);
      if (!row) throw new Error(t('assistantCorrectionTargetMissing'));
      await resolveTransfers({
        ids: [row.id], ownership: correction.ownership,
        expectedFingerprints: { [row.id]: transferFingerprint(row) }, expectedGeneration: beforeGeneration,
      });
      summary = correction.ownership === 'own'
        ? t('assistantCorrectionOwnTransfer')
        : t('assistantCorrectionExternalTransfer');
    }
    appendCorrectionResult(clean, summary, beforeGeneration, now, contextRequest);
  };

  const ask = async (value = question, usePrevious = true, contextRequest?: AssistantToolRequest) => {
    const clean = value.trim().slice(0, 1000);
    const initialSnapshot = getStateSnapshot();
    if (!clean || !initialSnapshot.hydrated || sendingRef.current) return;
    sendingRef.current = true;
    setIsSending(true);
    setPendingQuestion(clean);
    setQuestion('');
    setError(null);
    Keyboard.dismiss();
    try {
      // Android must get a committed frame before any ledger interpretation.
      // Without this yield, state updates above are batched with the synchronous
      // local engine: on a large history the text stays in the field and the
      // Send button looks dead until all calculation has already finished.
      if (Platform.OS === 'android') {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      const snapshot = getStateSnapshot();
      if (!snapshot.hydrated) throw new Error(copy.stale);
      const startGeneration = getStateGeneration();
      const renderIsCurrent = generation === startGeneration;
      if (!renderIsCurrent) previousGeneration.current = startGeneration;
      const now = new Date();
      const correction = usePrevious && renderIsCurrent
        ? planAssistantCorrection(snapshot, clean, correctionContextTurn?.answer)
        : undefined;
      if (correction?.kind === 'clarification') {
        const request: AssistantToolRequest = { tool: 'help', clarification: correction.body, suggestions: correction.suggestions };
        appendAnswer(clean, { request, answer: executeAssistantTool(snapshot, request, now) }, snapshot, now);
        return;
      }
      if (correction) {
        await applyCorrection(clean, correction, snapshot, now);
        return;
      }
      const interpretedQuestion = normalizeLocalAssistantQuestion(clean);
      const previous = usePrevious && renderIsCurrent
        ? contextRequest ?? localAssistantPreviousRequest(snapshot, interpretedQuestion, conversationContext, now, period)
        : null;
      let result = Platform.OS === 'android'
        ? await runWafraAssistantCooperatively(
            snapshot,
            interpretedQuestion,
            now,
            previous,
            period,
            () => startGeneration !== getStateGeneration(),
          )
        : runWafraAssistant(snapshot, interpretedQuestion, now, previous, period);
      if (result === null) return;
      let interpretedOnDevice = false;
      // Unrecognised fresh question: the platform model may pick ONE closed
      // tool. Wafra validates it and the ledger executor computes the answer.
      if (result.request.tool === 'help' && (!previous || isIndependentAssistantQuestion(clean))) {
        const outcome = await improveAssistantRequestOnDevice({
          question: clean,
          deterministicRequest: result.request,
          previousRequest: null,
          defaultPeriod: period,
          now,
          appLanguage: snapshot.language === 'ar' ? 'ar' : 'en',
          // Local names only, used to refuse plans that would drop or invent scope.
          knownMerchants: [...new Set(snapshot.transactions.map((row) => row.title).filter(Boolean))],
          knownAccountNames: [...new Set(snapshot.accounts.flatMap((row) => [row.name, row.bankName ?? '']).filter(Boolean))],
          cancelled: () => startGeneration !== getStateGeneration(),
        });
        if (startGeneration !== getStateGeneration()) throw new Error(copy.stale);
        if (outcome.source === 'on-device-ai') {
          result = { request: outcome.request, answer: executeAssistantTool(snapshot, outcome.request, now) };
          interpretedOnDevice = true;
        }
      }
      // Research builds only (EXPO_PUBLIC_WAFRA_LOCAL_E5=1): the old E5 path.
      if (LOCAL_SEMANTIC_E5_ENABLED && !interpretedOnDevice && result.request.tool === 'help' &&
        (!previous || isIndependentAssistantQuestion(clean))) {
        const improved = await improveAssistantRequestLocally({
          question: clean,
          deterministicRequest: result.request,
          previousRequest: null,
          groundRequest: (candidate) => groundLocalAssistantRequest(snapshot, clean, candidate, now, period),
          defaultPeriod: period,
          currentPeriod: currentMonthPeriod(now),
          cancelled: () => startGeneration !== getStateGeneration(),
        });
        if (startGeneration !== getStateGeneration()) throw new Error(copy.stale);
        if (improved !== result.request) {
          result = { request: improved, answer: executeAssistantTool(snapshot, improved, now) };
        }
      }
      if (startGeneration !== getStateGeneration()) throw new Error(copy.stale);
      appendAnswer(clean, { ...result, interpretedOnDevice }, snapshot, now);
    } catch {
      // Restore the draft when submission fails; financial records never enter logs.
      setQuestion((current) => current || clean);
      setError(copy.failed);
    } finally {
      sendingRef.current = false;
      setIsSending(false);
      setPendingQuestion(null);
    }
  };
  const askRef = useRef(ask);
  askRef.current = ask;

  const exploreFinding = (turn: AssistantTurn, finding: AssistantFinding) => {
    const snapshot = getStateSnapshot();
    const now = new Date();
    const latestInputs = ledgerInputs(snapshot);
    // A queued press can arrive before React disables a stale finding. Check
    // authoritative state again before reading or announcing financial data.
    if (!snapshot.hydrated || turn.generation !== getStateGeneration() ||
      toISODate(turn.answeredAt) !== toISODate(now) ||
      turn.inputs.some((input, index) => input !== latestInputs[index])) {
      setToday(toISODate(now));
      setError(copy.stale);
      return;
    }
    if (!finding.request) {
      if (finding.question) ask(finding.question, true, turn.request);
      return;
    }
    try {
      appendAnswer(finding.question ?? finding.title,
        { request: finding.request, answer: executeAssistantTool(snapshot, finding.request, now) }, snapshot, now);
    } catch { setError(copy.failed); }
  };

  const refreshAnswer = (turn: AssistantTurn) => {
    const snapshot = getStateSnapshot();
    if (!snapshot.hydrated || turn.generation !== getStateGeneration()) return;
    const now = new Date();
    try {
      const answer = executeAssistantTool(snapshot, turn.request, now);
      setTurns((current) => current.map((item) => item.id === turn.id
        ? { ...item, answer, answeredAt: now, inputs: ledgerInputs(snapshot) } : item));
      setToday(toISODate(now));
      setEvidenceSelection(null);
      setError(null);
    } catch { setError(copy.failed); }
  };

  const resetConversation = () => {
    needsScroll.current = false;
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = null;
    setTurns([]);
    setQuestion('');
    setDroppedTurns(false);
    setEvidenceSelection(null);
    setError(null);
    setInputHeight(minInputHeight);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  useEffect(() => {
    if (previousGeneration.current !== generation) {
      previousGeneration.current = generation;
      // Hydration also increments the store generation. Only a replacement of
      // an already-loaded ledger invalidates its old route question.
      if (hadHydratedLedger.current) routeQuestionHandled.current = typeof params.question === 'string' ? params.question.trim().slice(0, 1000) : null;
      resetConversation();
    }
    hadHydratedLedger.current ||= state.hydrated;
    // Clear session-only questions and evidence on ledger erase/restore.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation, state.hydrated]);

  useEffect(() => {
    if (previousPeriod.current === periodKey) return;
    previousPeriod.current = periodKey;
    // Explicit period changes start a fresh context so an old request cannot
    // override the period the user just chose.
    resetConversation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodKey]);

  useEffect(() => {
    const value = typeof params.question === 'string' ? params.question.trim().slice(0, 1000) : '';
    if (!state.hydrated || !value || routeQuestionHandled.current === value) return;
    // Let PeriodProvider apply the hydrated salary-day boundary before asking.
    // A changed period cancels this frame; only the settled request is marked
    // handled. Equal-value period objects do not clear a successful answer.
    const frame = requestAnimationFrame(() => {
      if (getStateGeneration() !== generation) return;
      routeQuestionHandled.current = value;
      askRef.current(value, false);
    });
    return () => cancelAnimationFrame(frame);
  }, [params.question, state.hydrated, periodKey, generation, getStateGeneration]);

  useFocusEffect(useCallback(() => {
    const updateDay = () => setToday(toISODate(new Date()));
    updateDay();
    const interval = setInterval(updateDay, 60_000);
    const subscription = NativeAppState.addEventListener('change', (status) => {
      if (status === 'active') updateDay();
    });
    return () => { clearInterval(interval); subscription.remove(); };
  }, []));

  useEffect(() => {
    if (keyboardHeight <= 0 || !latest) return;
    needsScroll.current = true;
    const frame = requestAnimationFrame(scrollToLatest);
    return () => cancelAnimationFrame(frame);
  }, [keyboardHeight, latest, scrollToLatest]);


  // The period, currency and on-device status sit in the pinned composer. At
  // the accessibility text sizes that composer would fill half the screen, so
  // there they scroll at the top of the sheet and only the question field and
  // Send stay pinned.
  const contextControls = <>
    <View style={styles.context}>
      <Pressable accessibilityRole="button" accessibilityLabel={copy.period + ': ' + periodLabel(contextPeriod)}
        onPress={() => { tapped(); Keyboard.dismiss(); setPeriodOpen(true); }} style={styles.period}>
        <Icon name="calendar" size={15} color={band.textSecondary} />
        <ThemedText type="meta" style={{ color: band.textSecondary }}>{periodLabel(contextPeriod)}</ThemedText>
        <Icon name="chevron-down" size={12} color={band.textSecondary} />
      </Pressable>
      <ThemedText type="meta" style={{ color: band.textSecondary }}>
        {`${ledgerCurrencyCode()} · ${copy.localShort}`}
      </ThemedText>
    </View>
    {Platform.OS !== 'web' && aiStatus ? <View style={styles.aiStatus}>
      <ThemedText testID="assistant-model-status" type="meta" style={[styles.aiStatusText, { color: band.textSecondary }]}>
        {aiStatus}
      </ThemedText>
      {aiAvailability?.canPrepare ? <Pressable testID="assistant-model-prepare" accessibilityRole="button"
        accessibilityLabel={copy.onDeviceAiPrepare} accessibilityState={{ disabled: preparingModel, busy: preparingModel }}
        disabled={preparingModel} onPress={() => { tapped(); prepareModel(); }} style={styles.aiPrepare}>
        <ThemedText type="meta" style={{ color: band.tint }}>{preparingModel ? copy.onDeviceAiDownloading : copy.onDeviceAiPrepare}</ThemedText>
      </Pressable> : null}
    </View> : null}
  </>;

  // The band holds the question being answered: the one in flight, else the
  // latest. Before the first question it names what the screen is for.
  const bandQuestion = pendingQuestion ?? latest?.question ?? null;
  const bandContent = <View style={styles.bandStack}>
    <View testID="assistant-local-badge" accessible accessibilityLabel={screenCopy.onThisPhoneA11y}
      style={[styles.localBadge, { backgroundColor: band.tile }]}>
      <Icon name="lock" size={12} color={band.accent} />
      <ThemedText type="meta" style={[styles.localBadgeText, { color: band.accent }]}>{screenCopy.onThisPhone}</ThemedText>
    </View>
    {bandQuestion !== null ? <View testID="assistant-band-question"
      style={[styles.bandBubble, !largeText && styles.bandBubbleInset, { backgroundColor: band.tile }]}>
      <ThemedText selectable style={[styles.bandBubbleText, { color: band.onBand }]}>{bandQuestion}</ThemedText>
    </View> : <ThemedText type="title" style={{ color: band.onBand }}>{copy.heading}</ThemedText>}
  </View>;

  return <>
    <BandScaffold testID="assistant-screen" band="home"
      // iOS avoids the keyboard with the scaffold's KeyboardAvoidingView.
      // Android keeps the composer's own measured lift below, which also
      // ignores a stale height when an OEM misses keyboardDidHide.
      keyboardAware={Platform.OS === 'ios'}
      // The root stack starts with `headerShown: false`, so no navigator
      // header sits above the keyboard-avoiding view.
      keyboardVerticalOffset={0}
      scrollRef={scrollRef}
      scrollProps={{ keyboardShouldPersistTaps: 'handled', keyboardDismissMode: 'on-drag',
        onContentSizeChange: scrollToLatest, onLayout: scrollToLatest }}
      nav={{ title: copy.title,
        close: () => router.canGoBack() ? router.back() : router.replace('/'),
        actions: currentTurns.length > 0 ? [{ icon: 'plus', label: copy.newChat, onPress: resetConversation, testID: 'assistant-new-chat' }] : [],
      }}
      bandContent={bandContent}
      contentStyle={styles.sheet}
      footer={<View testID="assistant-composer" style={[styles.composer, {
        // keyboardDidHide can occasionally be missed on some Android OEMs.
        // Never keep a stale keyboard height lifting the composer after the OS
        // itself says the keyboard is gone.
        marginBottom: Platform.OS === 'android' && Keyboard.isVisible()
          ? Math.max(0, keyboardHeight - insets.bottom)
          : 0,
      }]}>
        {largeText ? null : contextControls}
        {error ? <ThemedText type="meta" accessibilityRole="alert" style={{ color: band.statusOver }}>{error}</ThemedText> : null}
        <View style={[styles.inputRow, { borderColor: band.rule, backgroundColor: band.card }]}>
          <TextInput testID="assistant-input" value={question} onChangeText={(value) => { setQuestion(value); setError(null); }}
            onSubmitEditing={() => ask()} returnKeyType="send" submitBehavior="submit" multiline
            accessibilityLabel={copy.placeholder} maxLength={1000} editable={state.hydrated && !isSending}
            placeholder={copy.placeholder} placeholderTextColor={band.textSecondary}
            selectionColor={band.tint} autoComplete="off" textAlignVertical="top"
            onContentSizeChange={(event) => setInputHeight(event.nativeEvent.contentSize.height)}
            style={scaleTextStyleForE2E([styles.input, { height: Math.max(minInputHeight, Math.min(maxInputHeight, inputHeight)),
              color: band.text }], undefined, undefined)} />
          <Pressable testID="assistant-send" accessibilityRole="button" accessibilityLabel={copy.send}
            accessibilityState={{ disabled: !question.trim() || !state.hydrated || isSending, busy: isSending }}
            disabled={!question.trim() || !state.hydrated || isSending} onPress={() => { tapped(); void ask(); }}
            style={[styles.send, { backgroundColor: band.fill, opacity: question.trim() && state.hydrated && !isSending ? 1 : 0.4 }]}>
            <Icon name="arrow-up" size={20} color={band.onFill} />
          </Pressable>
        </View>
      </View>}>
      {largeText ? <View style={styles.contextInline}>{contextControls}</View> : null}
      {currentTurns.length === 0 ? <View style={styles.hero}>
        <ThemedText style={{ color: band.textSecondary }}>{copy.privacy}</ThemedText>
        {periodRange(period) ? <ThemedText type="meta" style={{ color: band.textSecondary }}>{periodRange(period)}</ThemedText> : null}
      </View> : null}
      {!state.hydrated ? <ThemedText accessibilityRole="progressbar" style={{ color: band.text }}>{copy.loading}</ThemedText>
        : !hasRecords && currentTurns.length === 0 ? <View style={styles.hero}>
          <ThemedText type="smallBold" style={{ color: band.text }}>{copy.emptyTitle}</ThemedText>
          <ThemedText style={{ color: band.textSecondary }}>{copy.emptyBody}</ThemedText>
          <EButton palette={band} label={copy.import} onPress={() => { tapped(); router.push('/import-sms'); }} />
          <EButton palette={band} variant="secondary" label={copy.add} onPress={() => { tapped(); router.push('/add-transaction'); }} />
        </View> : currentTurns.length === 0 ? <View style={styles.suggestions}>
          {suggestions.map((item) => <Pressable key={item} accessibilityRole="button" onPress={() => { tapped(); void ask(item); }}
            style={({ pressed }) => [styles.suggestion, { borderColor: band.rule, backgroundColor: band.card, opacity: pressed ? 0.8 : 1 }]}>
            <ThemedText type="small" style={[styles.suggestionText, { color: band.text }]}>{item}</ThemedText>
            <Icon name="chevron-right" size={16} color={band.textSecondary} />
          </Pressable>)}
        </View> : null}
      {droppedTurns ? <ThemedText type="meta" style={{ color: band.textSecondary }}>{copy.recentQuestions(MAX_TURNS)}</ThemedText> : null}
      {currentTurns.map((turn, index) => {
        // A lone question is on the band, right above its answer. Once the
        // band can scroll out of view behind earlier answers, every question
        // keeps its bubble beside its answer (the band still shows the latest).
        const questionInBand = currentTurns.length === 1 && !pendingQuestion;
        const stale = isStale(turn);
        const evidenceCount = evidenceTransactionCount(turn.answer.evidence);
        const hasEvidence = !!turn.answer.evidence?.length;
        return <View key={turn.id} testID="assistant-turn"
          style={[styles.turn, index > 0 && [styles.turnDivided, { borderTopColor: band.rule }]]}>
          {questionInBand ? null : <View style={[styles.questionBubble, { backgroundColor: band.card, borderColor: band.rule }]}>
            <ThemedText type="smallBold" selectable style={{ color: band.text }}>{turn.question}</ThemedText>
          </View>}
          <View accessibilityLiveRegion={index === currentTurns.length - 1 ? 'polite' : 'none'} style={styles.answer}>
            <ThemedText type="meta" style={{ color: band.textSecondary }}>{turn.answer.title}</ThemedText>
            {turn.interpretedOnDevice ? <ThemedText testID="assistant-interpreted-on-device" type="meta" style={{ color: band.textSecondary }}>
              {copy.onDeviceAiInterpreted}
            </ThemedText> : null}
            {turn.answer.headline ? <>
              <ThemedText type="title" selectable style={[styles.answerFigure, { color: band.text }]}>{turn.answer.headline}</ThemedText>
              {turn.answer.meta ? <ThemedText type="meta" selectable style={{ color: band.textSecondary }}>{turn.answer.meta}</ThemedText> : null}
            </> : <ThemedText type="heading" selectable style={[styles.answerSentence, { color: band.text }]}>{turn.answer.body}</ThemedText>}
            {turn.answer.monthlySeries?.length && ledgerMoney ? <AssistantMonthChart series={turn.answer.monthlySeries}
              highlight={turn.answer.monthlySeriesHighlight} money={ledgerMoney} language={screenLanguage} palette={band} largeText={largeText} /> : null}
            {turn.answer.payments?.length && ledgerMoney ? <AssistantPaymentRows payments={turn.answer.payments}
              money={ledgerMoney} language={screenLanguage} palette={band} />
            : turn.answer.facts?.length ? <View style={styles.facts}>
              {turn.answer.facts.map((fact, factIndex) => <View key={fact.label + '-' + factIndex} style={[styles.factRow, largeText && styles.factRowLarge]}>
                <ThemedText type="meta" style={[styles.factLabel, { color: band.textSecondary }]}>{fact.label}</ThemedText>
                <ThemedText type="smallBold" tabular selectable style={[styles.factValue, { color: band.text }]}>{fact.value}</ThemedText>
              </View>)}
            </View> : null}
            {turn.answer.findings?.length ? <AssistantFindings findings={turn.answer.findings}
              stale={stale} onReview={(findingId) => { Keyboard.dismiss(); setEvidenceSelection({ turnId: turn.id, findingId }); }}
              onAsk={(finding) => exploreFinding(turn, finding)} /> : null}
            {turn.answer.coverage ? <AssistantCoverage coverage={turn.answer.coverage} /> : null}
            {stale ? <View style={styles.hero}>
              <ThemedText type="meta" style={{ color: band.textSecondary }}>{copy.stale}</ThemedText>
              <View style={styles.pills}>
                <AskPill palette={band} primary label={copy.refresh} onPress={() => refreshAnswer(turn)} />
              </View>
            </View> : hasEvidence || turn.answer.destination ? <View style={styles.pills}>
              {hasEvidence ? <AskPill palette={band} primary icon="receipt"
                label={evidenceCount > 0 ? screenCopy.seeTransactions(evidenceCount) : copy.viewTransactions}
                onPress={() => { Keyboard.dismiss(); setEvidenceSelection({ turnId: turn.id }); }} /> : null}
              {turn.answer.destination ? <AskPill palette={band} primary={!hasEvidence} label={copy.viewPayments}
                onPress={() => router.push(turn.answer.destination!)} /> : null}
            </View> : null}
          </View>
        </View>;
      })}
      {pendingQuestion ? <View style={[styles.turn, currentTurns.length > 0 && [styles.turnDivided, { borderTopColor: band.rule }]]}
        testID="assistant-pending-turn">
        {currentTurns.length > 0 ? <View style={[styles.questionBubble, { backgroundColor: band.card, borderColor: band.rule }]}>
          <ThemedText type="smallBold" selectable style={{ color: band.text }}>{pendingQuestion}</ThemedText>
        </View> : null}
        <ThemedText type="meta" style={{ color: band.textSecondary }} accessibilityRole="progressbar">{copy.understanding}</ThemedText>
      </View> : null}
      {currentTurns.length > 0 && followUps.length > 0 ? <View testID="assistant-followups" style={styles.pills}>
        {followUps.map((item) => <AskPill key={item} palette={band} label={item} onPress={() => { void ask(item); }} />)}
      </View> : null}
    </BandScaffold>
    <PeriodSheet visible={periodOpen} selectedPeriod={contextPeriod} onApply={resetConversation} onClose={() => setPeriodOpen(false)} />
    {evidenceTurn && selectedEvidence?.length ? <AssistantEvidenceSheet key={evidenceTurn.id + ':' + (evidenceSelection?.findingId ?? 'all')}
      evidence={selectedEvidence} state={state} stale={isStale(evidenceTurn)}
      onClose={() => setEvidenceSelection(null)} onRefresh={() => refreshAnswer(evidenceTurn)} /> : null}
  </>;
}

const styles = StyleSheet.create({
  bandStack: { gap: 16 },
  localBadge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 4 },
  localBadgeText: { fontFamily: Fonts.sansSemi },
  // The question as a chat bubble on the band: end-aligned, its tail corner at
  // the logical bottom end so it mirrors under RTL.
  bandBubble: { alignSelf: 'flex-end', maxWidth: '100%', borderRadius: 22, borderBottomEndRadius: 6,
    paddingHorizontal: 16, paddingVertical: 14 },
  bandBubbleInset: { marginStart: 48 },
  bandBubbleText: { fontSize: 17, lineHeight: 24 },
  sheet: { gap: 16 },
  hero: { gap: 8 },
  suggestions: { gap: 8 },
  suggestion: { minHeight: 52, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16,
    paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  suggestionText: { flex: 1, minWidth: 0 },
  answer: { gap: 10 },
  // The answer's figure and sentence: Geist SemiBold with tabular digits
  // (never Geist Mono at this size, whose comma spaces out a figure).
  answerFigure: { fontFamily: Fonts.sansSemi, fontVariant: ['tabular-nums'], letterSpacing: -0.6 },
  answerSentence: { fontFamily: Fonts.sansSemi, fontVariant: ['tabular-nums'], fontSize: 22, lineHeight: 29, letterSpacing: -0.4 },
  turn: { gap: 10 },
  turnDivided: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 16 },
  questionBubble: { alignSelf: 'flex-end', maxWidth: '90%', borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18, borderBottomEndRadius: 6, paddingHorizontal: 14, paddingVertical: 10 },
  facts: { gap: 6 },
  factRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
  factRowLarge: { flexDirection: 'column', alignItems: 'stretch', gap: 2 },
  factLabel: { flex: 1, minWidth: 0 },
  factValue: { flexShrink: 1 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { minHeight: 48, maxWidth: '100%', flexShrink: 1, borderWidth: 1.5, borderRadius: 24,
    paddingHorizontal: 18, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  pillText: { flexShrink: 1, minWidth: 0 },
  composer: { gap: 6, paddingTop: 8 },
  context: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  period: { minHeight: 44, flexShrink: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  // The composer is one pill: the field, then Send inside its end.
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end', borderWidth: 1.5, borderRadius: 28,
    paddingStart: 6, paddingEnd: 3, paddingVertical: 3 },
  input: { flex: 1, minWidth: 0, borderRadius: Radius.control,
    paddingHorizontal: 12, paddingVertical: 12, fontSize: 15, lineHeight: 22, fontFamily: Fonts.sans },
  send: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center' },
  contextInline: { gap: 6 },
  aiStatus: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  aiStatusText: { flexShrink: 1, minWidth: 0 },
  aiPrepare: { minHeight: 44, justifyContent: 'center' },
});
