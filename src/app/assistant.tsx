import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, AppState as NativeAppState, Keyboard, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AssistantEvidenceSheet } from '@/components/assistant-evidence-sheet';
import { AssistantCoverage, AssistantFindings } from '@/components/assistant-findings';
import { PeriodSheet } from '@/components/period-sheet';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { ScreenScaffold } from '@/components/ui/screen-scaffold';
import { Fonts, Radius } from '@/constants/theme';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useTheme } from '@/hooks/use-theme';
import { assistantCopy as copy } from '@/lib/assistant-copy';
import { categoryLabel } from '@/lib/categories';
import { toISODate } from '@/lib/format';
import { tapped } from '@/lib/haptics';
import { t, tf } from '@/lib/i18n';
import { improveAssistantRequestLocally } from '@/lib/local-semantic-assistant';
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
}

export default function AssistantScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ question?: string }>();
  const theme = useTheme();
  const largeText = useLargeTextLayout();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const { fontScale, height } = useWindowDimensions();
  const { state, getStateSnapshot, getStateGeneration, editTransaction, resolveTransfers,
    setMerchantOverride, setNotSubscription } = useStore();
  const { period } = usePeriod();
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
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [turns, setTurns] = useState<AssistantTurn[]>([]);
  const [droppedTurns, setDroppedTurns] = useState(false);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [evidenceSelection, setEvidenceSelection] = useState<{ turnId: number; findingId?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [today, setToday] = useState(() => toISODate(new Date()));
  const [composerHeight, setComposerHeight] = useState(0);
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

  const appendAnswer = (clean: string, result: { request: AssistantToolRequest; answer: AssistantAnswer }, snapshot: AppState, answeredAt: Date) => {
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
      const previous = usePrevious && renderIsCurrent ? contextRequest ?? conversationContext : null;
      let result = Platform.OS === 'android'
        ? await runWafraAssistantCooperatively(
            snapshot,
            clean,
            now,
            previous,
            period,
            () => startGeneration !== getStateGeneration(),
          )
        : runWafraAssistant(snapshot, clean, now, previous, period);
      if (result === null) return;
      if (result.request.tool === 'help' && !previous) {
        const improved = await improveAssistantRequestLocally({
          question: clean,
          deterministicRequest: result.request,
          previousRequest: previous,
          defaultPeriod: period,
          currentPeriod: currentMonthPeriod(now),
          cancelled: () => startGeneration !== getStateGeneration(),
        });
        if (improved !== result.request && improved.tool !== 'help') {
          result = { request: improved, answer: executeAssistantTool(snapshot, improved, now) };
        }
      }
      appendAnswer(clean, result, snapshot, now);
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

  return <>
    <ScreenScaffold testID="assistant-screen"
      keyboardAware={Platform.OS === 'ios'}
      // ScreenScaffold owns this screen's header. `useHeaderHeight()` cannot be
      // used here because the root stack starts with `headerShown: false`; on
      // Android it throws before the first frame, leaving only the window
      // background visible. The keyboard-avoiding view already lives below the
      // native header on iOS, so no navigator-header offset is required.
      keyboardVerticalOffset={0}
      scrollRef={scrollRef}
      contentStyle={composerHeight > 0 ? { paddingBottom: composerHeight + 12 } : undefined}
      scrollProps={{ keyboardShouldPersistTaps: 'handled', keyboardDismissMode: 'on-drag',
        onContentSizeChange: scrollToLatest, onLayout: scrollToLatest }}
      header={{ title: copy.title,
        back: { label: copy.back, onPress: () => router.canGoBack() ? router.back() : router.replace('/') },
        actions: currentTurns.length > 0 ? [{ label: copy.newChat, onPress: resetConversation }] : [],
      }}
      footer={<View testID="assistant-composer" onLayout={(event) => {
        const next = Math.ceil(event.nativeEvent.layout.height);
        if (next !== composerHeight) setComposerHeight(next);
      }} style={[styles.composer, {
        borderColor: theme.cardBorder,
        // keyboardDidHide can occasionally be missed on some Android OEMs.
        // Never keep a stale keyboard height lifting the composer after the OS
        // itself says the keyboard is gone.
        marginBottom: Platform.OS === 'android' && Keyboard.isVisible()
          ? Math.max(0, keyboardHeight - insets.bottom)
          : 0,
      }]}>
        <View style={styles.context}>
          <Pressable accessibilityRole="button" accessibilityLabel={copy.period + ': ' + periodLabel(contextPeriod)}
            onPress={() => { tapped(); Keyboard.dismiss(); setPeriodOpen(true); }} style={styles.period}>
            <Icon name="calendar" size={15} color={theme.textSecondary} />
            <ThemedText type="meta" themeColor="textSecondary">{periodLabel(contextPeriod)}</ThemedText>
            <Icon name="chevron-down" size={12} color={theme.textSecondary} />
          </Pressable>
          <ThemedText type="meta" themeColor="textSecondary">
            {`${ledgerCurrencyCode()} · ${copy.localShort}`}
          </ThemedText>
        </View>
        {error ? <ThemedText type="meta" accessibilityRole="alert" themeColor="expense">{error}</ThemedText> : null}
        <View style={styles.inputRow}>
          <TextInput testID="assistant-input" value={question} onChangeText={(value) => { setQuestion(value); setError(null); }}
            onSubmitEditing={() => ask()} returnKeyType="send" submitBehavior="submit" multiline
            accessibilityLabel={copy.placeholder} maxLength={1000} editable={state.hydrated && !isSending}
            placeholder={copy.placeholder} placeholderTextColor={theme.textTertiary}
            selectionColor={theme.primary} autoComplete="off" textAlignVertical="top"
            onContentSizeChange={(event) => setInputHeight(event.nativeEvent.contentSize.height)}
            style={[styles.input, { height: Math.max(minInputHeight, Math.min(maxInputHeight, inputHeight)),
              color: theme.text, borderColor: theme.controlBorder, backgroundColor: theme.backgroundElement }]} />
          <Pressable testID="assistant-send" accessibilityRole="button" accessibilityLabel={copy.send}
            accessibilityState={{ disabled: !question.trim() || !state.hydrated || isSending, busy: isSending }}
            disabled={!question.trim() || !state.hydrated || isSending} onPress={() => { tapped(); void ask(); }}
            style={[styles.send, { backgroundColor: theme.primary, opacity: question.trim() && state.hydrated && !isSending ? 1 : 0.4 }]}>
            <Icon name="arrow-up" size={20} color={theme.onPrimary} />
          </Pressable>
        </View>
      </View>}>
      {currentTurns.length === 0 ? <View style={styles.hero}>
        <ThemedText type="heading">{copy.heading}</ThemedText>
        <ThemedText themeColor="textSecondary">{copy.privacy}</ThemedText>
        {periodRange(period) ? <ThemedText type="meta" themeColor="textSecondary">{periodRange(period)}</ThemedText> : null}
      </View> : null}
      {!state.hydrated ? <ThemedText accessibilityRole="progressbar">{copy.loading}</ThemedText>
        : !hasRecords && currentTurns.length === 0 ? <View style={styles.hero}>
          <ThemedText type="smallBold">{copy.emptyTitle}</ThemedText>
          <ThemedText themeColor="textSecondary">{copy.emptyBody}</ThemedText>
          <Button label={copy.import} onPress={() => router.push('/import-sms')} />
          <Button label={copy.add} variant="outline" onPress={() => router.push('/add-transaction')} />
        </View> : currentTurns.length === 0 ? <View style={styles.suggestions}>
          {suggestions.map((item) => <Pressable key={item} accessibilityRole="button" onPress={() => { tapped(); void ask(item); }}
            style={[styles.suggestion, { borderColor: theme.cardBorder, backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="small" style={styles.suggestionText}>{item}</ThemedText>
            <Icon name="chevron-right" size={16} color={theme.textTertiary} />
          </Pressable>)}
        </View> : null}
      {droppedTurns ? <ThemedText type="meta" themeColor="textTertiary">{copy.recentQuestions(MAX_TURNS)}</ThemedText> : null}
      {pendingQuestion ? <View style={styles.turn} testID="assistant-pending-turn">
        <View style={[styles.questionBubble, { backgroundColor: theme.backgroundElement, borderColor: theme.cardBorder }]}>
          <ThemedText type="smallBold" selectable>{pendingQuestion}</ThemedText>
        </View>
        <ThemedText type="meta" themeColor="textTertiary" accessibilityRole="progressbar">{copy.understanding}</ThemedText>
      </View> : null}
      {currentTurns.map((turn, index) => <View key={turn.id} style={styles.turn} testID="assistant-turn">
        <View style={[styles.questionBubble, { backgroundColor: theme.backgroundElement, borderColor: theme.cardBorder }]}>
          <ThemedText type="smallBold" selectable>{turn.question}</ThemedText>
        </View>
        <View accessibilityLiveRegion={index === currentTurns.length - 1 ? 'polite' : 'none'}
          style={[styles.answer, { borderColor: theme.primaryBorder, backgroundColor: theme.primarySoft }]}>
          <ThemedText type="micro" themeColor="primary">{turn.answer.title}</ThemedText>
          {turn.answer.headline ? <>
            <ThemedText type="heading" tabular selectable>{turn.answer.headline}</ThemedText>
            {turn.answer.meta ? <ThemedText type="meta" themeColor="textSecondary" selectable>{turn.answer.meta}</ThemedText> : null}
          </> : <ThemedText selectable>{turn.answer.body}</ThemedText>}
          {turn.answer.facts?.length ? <View style={styles.facts}>
            {turn.answer.facts.map((fact, factIndex) => <View key={fact.label + '-' + factIndex} style={[styles.factRow, largeText && styles.factRowLarge]}>
              <ThemedText type="meta" themeColor="textSecondary" style={styles.factLabel}>{fact.label}</ThemedText>
              <ThemedText type="smallBold" tabular selectable style={styles.factValue}>{fact.value}</ThemedText>
            </View>)}
          </View> : null}
          {turn.answer.findings?.length ? <AssistantFindings findings={turn.answer.findings}
            stale={isStale(turn)} onReview={(findingId) => { Keyboard.dismiss(); setEvidenceSelection({ turnId: turn.id, findingId }); }}
            onAsk={(finding) => exploreFinding(turn, finding)} /> : null}
          {turn.answer.coverage ? <AssistantCoverage coverage={turn.answer.coverage} /> : null}
          {isStale(turn) ? <View style={styles.hero}>
            <ThemedText type="meta" themeColor="textSecondary">{copy.stale}</ThemedText>
            <Button label={copy.refresh} variant="outline" onPress={() => refreshAnswer(turn)} />
          </View> : <>
            {turn.answer.evidence?.length ? <Button label={copy.viewTransactions} icon="receipt" variant="outline"
              onPress={() => { Keyboard.dismiss(); setEvidenceSelection({ turnId: turn.id }); }} /> : null}
            {turn.answer.destination ? <Button label={copy.viewPayments} variant="outline"
              onPress={() => router.push(turn.answer.destination!)} /> : null}
          </>}
        </View>
      </View>)}
      {currentTurns.length > 0 && followUps.length > 0 ? <View testID="assistant-followups" style={styles.quickFollowUps}>
        {followUps.map((item) => <Pressable key={item} accessibilityRole="button" onPress={() => { tapped(); void ask(item); }}
          style={[styles.followUpChip, { borderColor: theme.cardBorder, backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="meta" style={styles.followUpText}>{item}</ThemedText>
        </Pressable>)}
      </View> : null}
    </ScreenScaffold>
    <PeriodSheet visible={periodOpen} selectedPeriod={contextPeriod} onApply={resetConversation} onClose={() => setPeriodOpen(false)} />
    {evidenceTurn && selectedEvidence?.length ? <AssistantEvidenceSheet key={evidenceTurn.id + ':' + (evidenceSelection?.findingId ?? 'all')}
      evidence={selectedEvidence} state={state} stale={isStale(evidenceTurn)}
      onClose={() => setEvidenceSelection(null)} onRefresh={() => refreshAnswer(evidenceTurn)} /> : null}
  </>;
}

const styles = StyleSheet.create({
  hero: { gap: 8 },
  suggestions: { gap: 8 },
  suggestion: { minHeight: 48, borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius.control,
    paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  suggestionText: { flex: 1, minWidth: 0 },
  answer: { borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius.sheet, padding: 12, gap: 8 },
  turn: { gap: 6, paddingTop: 2 },
  questionBubble: { alignSelf: 'flex-end', maxWidth: '90%', borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.control, paddingHorizontal: 12, paddingVertical: 10 },
  facts: { gap: 6 },
  factRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
  factRowLarge: { flexDirection: 'column', alignItems: 'stretch', gap: 2 },
  factLabel: { flex: 1, minWidth: 0 },
  factValue: { flexShrink: 1 },
  quickFollowUps: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  followUpChip: { minHeight: 40, maxWidth: '100%', flexShrink: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16,
    paddingHorizontal: 12, paddingVertical: 8, justifyContent: 'center' },
  followUpText: { flexShrink: 1, minWidth: 0 },
  composer: { gap: 6, paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth },
  context: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  period: { minHeight: 44, flexShrink: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  input: { flex: 1, minWidth: 0, borderWidth: 1, borderRadius: Radius.control,
    paddingHorizontal: 12, paddingVertical: 12, fontSize: 15, lineHeight: 22, fontFamily: Fonts.sans },
  send: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center' },
});
