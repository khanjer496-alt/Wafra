import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AssistantAnswerCard } from '@/components/assistant-answer-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button, Chip } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { Block, ScreenHeader } from '@/components/ui/layout';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { CATEGORIES } from '@/lib/categories';
import { fallbackAssistantQuestion } from '@/lib/assistant-fallback';
import { runAssistantQuery, type AssistantQueryResult } from '@/lib/assistant-query';
import {
  assistantPlanFitsQuestion,
  type AssistantPlan,
  type AssistantPlanningContext,
} from '@/lib/assistant-contract';
import { toISODate } from '@/lib/format';
import { t } from '@/lib/i18n';
import { ledgerCurrencyCode } from '@/lib/markets';
import LocalAiModel from '@/lib/local-ai-model-adapter';
import { LOCAL_AI_EVALUATION_ENABLED, type LocalAiModelStatus } from '@/lib/local-ai-model';
import LocalAiRuntime from '@/lib/local-ai-runtime-adapter';
import type { LocalAiRuntimeProgress } from '@/lib/local-ai-runtime';
import { useStore } from '@/lib/store';

interface Exchange {
  id: string;
  question: string;
  result: AssistantQueryResult;
  usedFallback: boolean;
}

const prompts = [
  'assistantPromptTalabat',
  'assistantPromptCashOut',
  'assistantPromptBills',
  'assistantPromptLarge',
] as const;

export default function AssistantScreen() {
  const router = useRouter();
  const theme = useTheme();
  const language = useLanguage();
  const { state } = useStore();
  const [modelStatus, setModelStatus] = useState<LocalAiModelStatus>({ state: 'missing' });
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState<'download' | 'query' | null>(null);
  const [phase, setPhase] = useState('');
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const listRef = useRef<FlatList<Exchange>>(null);

  const refreshModel = async () => setModelStatus(await LocalAiModel.status());
  useEffect(() => {
    void refreshModel();
    return () => { void LocalAiRuntime.release(); };
  }, []);

  const context = useMemo<AssistantPlanningContext>(() => ({
    todayISO: toISODate(new Date()),
    currency: ledgerCurrencyCode(),
    categories: CATEGORIES.map((row) => row.id),
    accounts: state.accounts.map((row) => row.name),
    language,
  }), [language, state.accounts]);

  const runtimeProgress = (progress: LocalAiRuntimeProgress) => {
    setPhase(t(progress.phase === 'loading' ? 'localAiLoading' : 'localAiVerifying', language));
  };

  const ask = async (value = question) => {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    setBusy('query');
    setPhase(t('assistantThinking', language));
    try {
      let plan: AssistantPlan | null = null;
      if (modelStatus.state === 'installed') {
        plan = await LocalAiRuntime.plan(trimmed, context, runtimeProgress);
      }
      const usedFallback = plan === null;
      const fallback = plan === null ? fallbackAssistantQuestion(trimmed, state) : null;
      const safePlan = plan ?? fallback!.plan;
      const result = runAssistantQuery(
        state,
        safePlan,
        new Date(),
        fallback?.unsupportedReason ?? (
          assistantPlanFitsQuestion(safePlan, trimmed) ? null : 'historical-bills'
        ),
      );
      setExchanges((rows) => [...rows, {
        id: `${Date.now()}-${rows.length}`,
        question: trimmed,
        result,
        usedFallback,
      }]);
      setQuestion('');
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch {
      Alert.alert(t('localAiRunFailed', language), t('localAiTryAgain', language));
    } finally {
      setBusy(null);
      setPhase('');
    }
  };

  const download = async () => {
    setBusy('download');
    try {
      await LocalAiModel.download((progress) => {
        setPhase(t(progress.phase === 'downloading' ? 'localAiDownloading' : 'localAiVerifying', language));
      });
      await refreshModel();
    } catch (error) {
      Alert.alert(
        t('localAiDownloadFailed', language),
        error instanceof Error && error.message === 'local-ai-storage'
          ? t('localAiStorageFailed', language)
          : t('localAiTryAgain', language),
      );
    } finally {
      setBusy(null);
      setPhase('');
    }
  };

  if (!LOCAL_AI_EVALUATION_ENABLED) {
    return (
      <ThemedView style={styles.root}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <ScreenHeader title={t('assistantTitle', language)} onBack={() => router.back()} />
          <View style={styles.unavailable}>
            <Icon name="lock" size={24} color={theme.textTertiary} />
            <ThemedText type="default" themeColor="textSecondary">
              {t('assistantUnavailable', language)}
            </ThemedText>
          </View>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScreenHeader title={t('assistantTitle', language)} onBack={() => router.back()} />
        <KeyboardAvoidingView
          style={styles.grow}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}>
          <FlatList
            ref={listRef}
            data={exchanges}
            keyExtractor={(row) => row.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}
            ListHeaderComponent={
              <View style={styles.intro}>
                <Block style={styles.privacy}>
                  <Icon name="lock" size={16} color={theme.primary} />
                  <ThemedText type="meta" themeColor="textSecondary" style={styles.grow}>
                    {t('assistantPrivacy', language)}
                  </ThemedText>
                </Block>
                {exchanges.length === 0 ? (
                  <View style={styles.welcome}>
                    <View style={[styles.heroIcon, { backgroundColor: theme.primarySoft }]}>
                      <Icon name="spark" size={26} color={theme.primary} />
                    </View>
                    <ThemedText type="heading" accessibilityRole="header">
                      {t('assistantWelcomeTitle', language)}
                    </ThemedText>
                    <ThemedText type="default" themeColor="textSecondary">
                      {t('assistantWelcomeBody', language)}
                    </ThemedText>
                    <View style={styles.chips}>
                      {prompts.map((key) => (
                        <Chip key={key} label={t(key, language)} onPress={() => void ask(t(key, language))} />
                      ))}
                    </View>
                  </View>
                ) : null}
                {modelStatus.state !== 'installed' ? (
                  <Block style={styles.modelCard}>
                    <View style={styles.modelHeader}>
                      <Icon name="download" size={20} color={theme.primary} />
                      <View style={styles.grow}>
                        <ThemedText type="smallBold">
                          {t('assistantModelNeededTitle', language)}
                        </ThemedText>
                        <ThemedText type="meta" themeColor="textSecondary">
                          {t('assistantModelNeededBody', language)}
                        </ThemedText>
                      </View>
                    </View>
                    <Button
                      label={busy === 'download' ? t('localAiDownloading', language) : t('assistantDownloadModel', language)}
                      disabled={busy !== null}
                      onPress={() => void download()}
                    />
                  </Block>
                ) : null}
              </View>
            }
            renderItem={({ item }) => (
              <View style={styles.exchange}>
                <View style={[styles.question, { backgroundColor: theme.backgroundSelected }]}>
                  <ThemedText type="micro" themeColor="textSecondary">
                    {t('assistantQuestionLabel', language)}
                  </ThemedText>
                  <ThemedText type="small">{item.question}</ThemedText>
                </View>
                <AssistantAnswerCard
                  result={item.result}
                  transactions={state.transactions}
                  accounts={state.accounts}
                  usedFallback={item.usedFallback}
                  onOpenTransaction={(id) => router.push({ pathname: '/transactions', params: { transactionId: id } })}
                  onOpenBills={() => router.push('/bills')}
                />
              </View>
            )}
          />

          {busy === 'query' ? (
            <View style={styles.status} accessibilityLiveRegion="polite">
              <Icon name="spark" size={15} color={theme.primary} />
              <ThemedText type="meta" themeColor="textSecondary">{phase}</ThemedText>
            </View>
          ) : null}
          <View style={[styles.composer, { borderTopColor: theme.cardBorder }]}>
            <TextInput
              accessibilityLabel={t('assistantInputPlaceholder', language)}
              value={question}
              onChangeText={setQuestion}
              onSubmitEditing={() => void ask()}
              returnKeyType="send"
              placeholder={t('assistantInputPlaceholder', language)}
              placeholderTextColor={theme.textTertiary}
              multiline
              maxLength={600}
              style={[
                styles.input,
                {
                  color: theme.text,
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.cardBorder,
                  textAlign: language === 'ar' ? 'right' : 'left',
                },
              ]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('assistantSend', language)}
              disabled={!question.trim() || busy !== null}
              onPress={() => void ask()}
              style={({ pressed }) => [
                styles.send,
                { backgroundColor: theme.primary, opacity: !question.trim() || busy ? 0.45 : pressed ? 0.75 : 1 },
              ]}>
              <Icon name="arrow-up" size={20} color={theme.onPrimary} />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center' },
  safe: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  grow: { flex: 1 },
  content: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.three, gap: Spacing.four },
  intro: { gap: Spacing.three },
  privacy: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  welcome: { gap: Spacing.three, paddingVertical: Spacing.four },
  heroIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  modelCard: { gap: Spacing.three },
  modelHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  exchange: { gap: Spacing.two, marginBottom: Spacing.four },
  question: {
    alignSelf: 'flex-end',
    maxWidth: '88%',
    borderRadius: Radius.sheet,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 4,
    gap: Spacing.one,
  },
  status: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 112,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.control,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 4,
    fontSize: 15,
  },
  send: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  unavailable: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.four },
});
