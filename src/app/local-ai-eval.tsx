import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Keyboard, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/controls';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Icon } from '@/components/ui/icon';
import { Block, ScreenHeader, Section, SectionHeader } from '@/components/ui/layout';
import { MaxContentWidth, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import {
  LOCAL_AI_BENCHMARK,
  runLocalAiBenchmark,
  type LocalAiBenchmarkResult,
  type LocalAiVerdict,
} from '@/lib/local-ai-contract';
import LocalAiModel from '@/lib/local-ai-model-adapter';
import {
  LOCAL_AI_EVALUATION_ENABLED,
  LOCAL_AI_MODEL,
  type LocalAiModelProgress,
  type LocalAiModelStatus,
} from '@/lib/local-ai-model';
import LocalAiRuntime from '@/lib/local-ai-runtime-adapter';
import type { LocalAiRuntimeProgress } from '@/lib/local-ai-runtime';
import { t, tf } from '@/lib/i18n';

type Busy = 'download' | 'benchmark' | 'single' | 'remove' | null;

const gib = (bytes: number) => (bytes / (1024 ** 3)).toFixed(2);

export default function LocalAiEvaluationScreen() {
  const router = useRouter();
  const theme = useTheme();
  const language = useLanguage();
  const [status, setStatus] = useState<LocalAiModelStatus>({ state: 'missing' });
  const [busy, setBusy] = useState<Busy>(null);
  const [phase, setPhase] = useState<string>('');
  const [progress, setProgress] = useState<number | null>(null);
  const [benchmark, setBenchmark] = useState<LocalAiBenchmarkResult | null>(null);
  const [benchmarkCompleted, setBenchmarkCompleted] = useState(0);
  const [source, setSource] = useState('');
  const [verdict, setVerdict] = useState<LocalAiVerdict | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const refreshStatus = async () => setStatus(await LocalAiModel.status());

  useEffect(() => {
    void refreshStatus();
    return () => {
      // Frees the model's memory and its KV cache when the internal lab closes.
      void LocalAiRuntime.release();
    };
  }, []);

  const modelProgress = (next: LocalAiModelProgress) => {
    setPhase(t(next.phase === 'downloading' ? 'localAiDownloading' : 'localAiVerifying'));
    setProgress(next.phase === 'downloading' ? null : next.completed / next.total);
  };

  const runtimeProgress = (next: LocalAiRuntimeProgress) => {
    setPhase(t(next.phase === 'loading' ? 'localAiLoading' : 'localAiVerifying'));
    setProgress(next.total > 0 ? next.completed / next.total : null);
  };

  const download = async () => {
    setBusy('download');
    setBenchmark(null);
    setProgress(null);
    try {
      await LocalAiModel.download(modelProgress);
      await refreshStatus();
    } catch (error) {
      Alert.alert(
        t('localAiDownloadFailed'),
        error instanceof Error && error.message === 'local-ai-storage'
          ? t('localAiStorageFailed')
          : t('localAiTryAgain'),
      );
    } finally {
      setBusy(null);
      setPhase('');
      setProgress(null);
    }
  };

  const runBenchmark = async () => {
    setBusy('benchmark');
    setBenchmark(null);
    setBenchmarkCompleted(0);
    try {
      const result = await runLocalAiBenchmark(
        (alert) => LocalAiRuntime.classify(alert, runtimeProgress),
        (completed) => {
          setBenchmarkCompleted(completed);
          setPhase(t('localAiRunning'));
          setProgress(completed / LOCAL_AI_BENCHMARK.length);
        },
      );
      setBenchmark(result);
    } catch {
      Alert.alert(t('localAiRunFailed'), t('localAiTryAgain'));
    } finally {
      setBusy(null);
      setPhase('');
      setProgress(null);
    }
  };

  const classifyOne = async () => {
    if (!source.trim()) return;
    Keyboard.dismiss();
    setBusy('single');
    setVerdict(null);
    try {
      const result = await LocalAiRuntime.classify(source, runtimeProgress);
      setVerdict(result);
      // The alert exists only long enough to run inference. The screen keeps
      // the structured verdict and immediately drops the original text.
      setSource('');
    } catch {
      Alert.alert(t('localAiRunFailed'), t('localAiTryAgain'));
    } finally {
      setBusy(null);
      setPhase('');
      setProgress(null);
    }
  };

  const remove = async () => {
    setBusy('remove');
    try {
      await LocalAiRuntime.release();
      await LocalAiModel.remove();
      setBenchmark(null);
      setVerdict(null);
      await refreshStatus();
    } finally {
      setBusy(null);
    }
  };

  const installed = status.state === 'installed';
  const statusCopy = status.state === 'installed'
    ? tf('localAiInstalled', { size: gib(status.bytes) })
    : status.state === 'invalid'
      ? t('localAiInvalid')
      : t('localAiNotInstalled');

  if (!LOCAL_AI_EVALUATION_ENABLED) {
    return (
      <ThemedView style={styles.root}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={styles.headerWrap}>
            <ScreenHeader title={t('localAiTitle')} onBack={() => router.back()} />
          </View>
          <View style={styles.unavailable}>
            <Icon name="lock" size={24} color={theme.textTertiary} />
            <ThemedText type="default" themeColor="textSecondary">
              {t('localAiUnavailable')}
            </ThemedText>
          </View>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.headerWrap}>
          <ScreenHeader title={t('localAiTitle')} onBack={() => router.back()} />
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}>
          <Section index={0} style={styles.group}>
            <Block style={styles.warningBlock}>
              <Icon name="alert" size={18} color={theme.warning} />
              <View style={styles.grow}>
                <ThemedText type="smallBold">{t('localAiShadowTitle')}</ThemedText>
                <ThemedText type="meta" themeColor="textSecondary">
                  {t('localAiShadowBody')}
                </ThemedText>
              </View>
            </Block>
          </Section>

          <Section index={1} style={styles.group}>
            <SectionHeader title={t('localAiModelHeader')} />
            <Block style={styles.modelBlock}>
              <View style={styles.modelRow}>
                <Icon name="code" size={20} color={theme.primary} />
                <View style={styles.grow}>
                  <ThemedText type="smallBold">{LOCAL_AI_MODEL.displayName}</ThemedText>
                  <ThemedText type="meta" themeColor="textTertiary">{statusCopy}</ThemedText>
                </View>
              </View>
              <ThemedText type="meta" themeColor="textSecondary">
                {t('localAiModelBody')}
              </ThemedText>
              {!installed ? (
                <Button
                  label={busy === 'download' ? t('localAiDownloading') : t('localAiDownload')}
                  icon="download"
                  disabled={busy !== null}
                  onPress={() => void download()}
                />
              ) : (
                <Button
                  label={t('localAiRemove')}
                  variant="outline"
                  icon="trash"
                  disabled={busy !== null}
                  onPress={() => setConfirmRemove(true)}
                />
              )}
              {busy && phase ? (
                <View accessibilityRole="progressbar" style={styles.progressWrap}>
                  <View style={[styles.progressTrack, { backgroundColor: theme.track }]}>
                    <View
                      style={[
                        styles.progressFill,
                        { backgroundColor: theme.primary, width: `${Math.round((progress ?? 0.08) * 100)}%` },
                      ]}
                    />
                  </View>
                  <ThemedText type="meta" themeColor="textTertiary">
                    {phase}
                  </ThemedText>
                </View>
              ) : null}
            </Block>
          </Section>

          <Section index={2} style={styles.group}>
            <SectionHeader title={t('localAiBenchmarkHeader')} />
            <ThemedText type="default" themeColor="textSecondary">
              {t('localAiBenchmarkBody')}
            </ThemedText>
            <Button
              label={busy === 'benchmark'
                ? tf('localAiBenchmarkProgress', {
                    completed: benchmarkCompleted,
                    total: LOCAL_AI_BENCHMARK.length,
                  })
                : t('localAiBenchmarkAction')}
              icon="play"
              disabled={!installed || busy !== null}
              onPress={() => void runBenchmark()}
            />
            {benchmark ? (
              <Block style={styles.resultBlock}>
                <Icon
                  name={benchmark.releaseEligible ? 'check' : 'alert'}
                  size={22}
                  color={benchmark.releaseEligible ? theme.income : theme.warning}
                />
                <View style={styles.grow}>
                  <ThemedText type="smallBold">
                    {benchmark.releaseEligible ? t('localAiGatePassed') : t('localAiGateFailed')}
                  </ThemedText>
                  <ThemedText type="meta" themeColor="textSecondary">
                    {tf('localAiBenchmarkResult', {
                      exact: benchmark.exact,
                      total: benchmark.total,
                      safety: benchmark.safetyFailures,
                    })}
                  </ThemedText>
                </View>
              </Block>
            ) : null}
          </Section>

          <Section index={3} style={styles.group}>
            <SectionHeader title={t('localAiSingleHeader')} />
            <ThemedText type="default" themeColor="textSecondary">
              {t('localAiSingleBody')}
            </ThemedText>
            <TextInput
              accessibilityLabel={t('localAiInputA11y')}
              multiline
              maxLength={4096}
              value={source}
              onChangeText={(next) => {
                setSource(next);
                setVerdict(null);
              }}
              placeholder={t('localAiInputPlaceholder')}
              placeholderTextColor={theme.textTertiary}
              style={[
                styles.input,
                {
                  color: theme.text,
                  borderColor: theme.cardBorder,
                  backgroundColor: theme.backgroundElement,
                  textAlign: language === 'ar' ? 'right' : 'left',
                },
              ]}
            />
            <Button
              label={busy === 'single' ? t('localAiRunning') : t('localAiSingleAction')}
              icon="spark"
              disabled={!installed || busy !== null || !source.trim()}
              onPress={() => void classifyOne()}
            />
            {verdict ? (
              <Block style={styles.verdictBlock}>
                <ThemedText type="smallBold">{t('localAiVerdict')}</ThemedText>
                <ThemedText type="code" themeColor="textSecondary">
                  {`${verdict.status} · ${verdict.kind} · ${verdict.direction} · ${verdict.confidence}`}
                </ThemedText>
              </Block>
            ) : null}
          </Section>
        </ScrollView>
        <ConfirmSheet
          visible={confirmRemove}
          onClose={() => setConfirmRemove(false)}
          question={t('localAiRemoveQuestion')}
          body={t('localAiRemoveBody')}
          confirmLabel={t('delete')}
          destructive
          onConfirm={() => void remove()}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center' },
  safe: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  headerWrap: { paddingHorizontal: ScreenPadding },
  content: { paddingHorizontal: ScreenPadding, paddingBottom: Spacing.six, gap: Spacing.five },
  group: { gap: Spacing.three },
  grow: { flex: 1, gap: 2 },
  warningBlock: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  modelBlock: { gap: Spacing.three },
  modelRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  progressWrap: { gap: Spacing.two },
  progressTrack: { height: 5, borderRadius: Radius.full, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: Radius.full },
  resultBlock: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  input: {
    minHeight: 132,
    maxHeight: 240,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.three,
    textAlignVertical: 'top',
    fontSize: 15,
    lineHeight: 22,
  },
  verdictBlock: { gap: Spacing.two },
  unavailable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingHorizontal: ScreenPadding,
  },
});
