import { useHeaderHeight } from '@react-navigation/elements';
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
import { toISODate } from '@/lib/format';
import { ledgerCurrencyCode } from '@/lib/markets';
import { periodLabel, periodRange } from '@/lib/period';
import { usePeriod } from '@/lib/period-context';
import { useStore } from '@/lib/store';
import type { AppState } from '@/lib/types';
import {
  assistantFollowUpQuestions, executeAssistantTool, runWafraAssistant, suggestedAssistantQuestions,
  type AssistantAnswer, type AssistantFinding, type AssistantToolRequest,
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
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const { fontScale, height } = useWindowDimensions();
  const { state, getStateSnapshot, getStateGeneration } = useStore();
  const { period } = usePeriod();
  const periodKey = JSON.stringify(period);
  const generation = getStateGeneration();
  const scrollRef = useRef<ScrollView>(null);
  const needsScroll = useRef(false);
  const scrollFrame = useRef<number | null>(null);
  const nextId = useRef(0);
  const routeQuestionHandled = useRef<string | null>(null);
  const previousGeneration = useRef(generation);
  const hadHydratedLedger = useRef(false);
  const previousPeriod = useRef(periodKey);
  const [question, setQuestion] = useState('');
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
  const contextPeriod = latest && 'period' in latest.request ? latest.request.period : period;
  const suggestions = useMemo(() => state.hydrated ? suggestedAssistantQuestions(state, period) : [], [state, period]);
  const followUps = latest?.answer.suggestions ?? (latest ? assistantFollowUpQuestions(latest.request) : []);
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
  };

  const ask = (value = question, usePrevious = true, contextRequest?: AssistantToolRequest) => {
    const clean = value.trim().slice(0, 1000);
    const snapshot = getStateSnapshot();
    if (!clean || !snapshot.hydrated || generation !== getStateGeneration()) return;
    const now = new Date();
    try {
      const result = runWafraAssistant(snapshot, clean, now, usePrevious ? contextRequest ?? latest?.request : null, period);
      appendAnswer(clean, result, snapshot, now);
    } catch {
      // Keep the question available to edit; financial records never enter logs.
      setError(copy.failed);
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
      keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
      scrollRef={scrollRef}
      scrollProps={{ keyboardShouldPersistTaps: 'handled', keyboardDismissMode: 'on-drag',
        onContentSizeChange: scrollToLatest, onLayout: scrollToLatest }}
      header={{ title: copy.title,
        back: { label: copy.back, onPress: () => router.canGoBack() ? router.back() : router.replace('/') },
        actions: currentTurns.length > 0 ? [{ label: copy.newChat, onPress: resetConversation }] : [],
      }}
      footer={<View testID="assistant-composer" style={[styles.composer, {
        borderColor: theme.cardBorder,
        marginBottom: Platform.OS === 'android' ? Math.max(0, keyboardHeight - insets.bottom) : 0,
      }]}>
        <View style={styles.context}>
          <Pressable accessibilityRole="button" accessibilityLabel={copy.period + ': ' + periodLabel(contextPeriod)}
            onPress={() => { Keyboard.dismiss(); setPeriodOpen(true); }} style={styles.period}>
            <Icon name="calendar" size={15} color={theme.textSecondary} />
            <ThemedText type="meta" themeColor="textSecondary">{periodLabel(contextPeriod)}</ThemedText>
            <Icon name="chevron-down" size={12} color={theme.textSecondary} />
          </Pressable>
          <ThemedText type="meta" themeColor="textSecondary">{ledgerCurrencyCode()}</ThemedText>
        </View>
        {error ? <ThemedText type="meta" accessibilityRole="alert" themeColor="expense">{error}</ThemedText> : null}
        <View style={styles.inputRow}>
          <TextInput testID="assistant-input" value={question} onChangeText={(value) => { setQuestion(value); setError(null); }}
            onSubmitEditing={() => ask()} returnKeyType="send" submitBehavior="submit" multiline
            accessibilityLabel={copy.placeholder} maxLength={1000} editable={state.hydrated}
            placeholder={copy.placeholder} placeholderTextColor={theme.textTertiary}
            selectionColor={theme.primary} autoComplete="off" textAlignVertical="top"
            onContentSizeChange={(event) => setInputHeight(event.nativeEvent.contentSize.height)}
            style={[styles.input, { height: Math.max(minInputHeight, Math.min(maxInputHeight, inputHeight)),
              color: theme.text, borderColor: theme.controlBorder, backgroundColor: theme.backgroundElement }]} />
          <Pressable testID="assistant-send" accessibilityRole="button" accessibilityLabel={copy.send}
            accessibilityState={{ disabled: !question.trim() || !state.hydrated }}
            disabled={!question.trim() || !state.hydrated} onPress={() => ask()}
            style={[styles.send, { backgroundColor: theme.primary, opacity: question.trim() && state.hydrated ? 1 : 0.4 }]}>
            <Icon name="arrow-up" size={20} color={theme.onPrimary} />
          </Pressable>
        </View>
        <ThemedText type="meta" themeColor="textTertiary">{copy.local}</ThemedText>
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
          {suggestions.map((item) => <Pressable key={item} accessibilityRole="button" onPress={() => ask(item)}
            style={[styles.suggestion, { borderColor: theme.cardBorder, backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="small" style={styles.suggestionText}>{item}</ThemedText>
            <Icon name="chevron-right" size={16} color={theme.textTertiary} />
          </Pressable>)}
        </View> : null}
      {droppedTurns ? <ThemedText type="meta" themeColor="textTertiary">{copy.recentQuestions(MAX_TURNS)}</ThemedText> : null}
      {currentTurns.map((turn, index) => <View key={turn.id} style={styles.turn} testID="assistant-turn">
        <View style={[styles.questionBubble, { backgroundColor: theme.backgroundElement, borderColor: theme.cardBorder }]}>
          <ThemedText type="smallBold" selectable>{turn.question}</ThemedText>
        </View>
        <View accessibilityLiveRegion={index === currentTurns.length - 1 ? 'polite' : 'none'}
          style={[styles.answer, { borderColor: theme.primaryBorder, backgroundColor: theme.primarySoft }]}>
          <ThemedText type="micro" themeColor="primary">{turn.answer.title}</ThemedText>
          <ThemedText selectable>{turn.answer.body}</ThemedText>
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
      {currentTurns.length > 0 && followUps.length > 0 ? <View style={styles.quickFollowUps}>
        {followUps.map((item) => <Pressable key={item} accessibilityRole="button" onPress={() => ask(item)}
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
  answer: { borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius.sheet, padding: 14, gap: 12 },
  turn: { gap: 8, paddingTop: 4 },
  questionBubble: { alignSelf: 'flex-end', maxWidth: '90%', borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.control, paddingHorizontal: 12, paddingVertical: 10 },
  facts: { gap: 8 },
  factRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
  factRowLarge: { flexDirection: 'column', alignItems: 'stretch', gap: 2 },
  factLabel: { flex: 1, minWidth: 0 },
  factValue: { flexShrink: 1 },
  quickFollowUps: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  followUpChip: { minHeight: 44, maxWidth: '100%', flexShrink: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16,
    paddingHorizontal: 12, paddingVertical: 10, justifyContent: 'center' },
  followUpText: { flexShrink: 1, minWidth: 0 },
  composer: { gap: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  context: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  period: { minHeight: 44, flexShrink: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  input: { flex: 1, minWidth: 0, borderWidth: 1, borderRadius: Radius.control,
    paddingHorizontal: 12, paddingVertical: 12, fontSize: 15, lineHeight: 22, fontFamily: Fonts.sans },
  send: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center' },
});
