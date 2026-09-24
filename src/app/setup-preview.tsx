import { Redirect, useLocalSearchParams } from 'expo-router';
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AutomationGuide } from '@/components/ios-message-setup/automation-guide';
import { SetupResult, SetupStep, StepProgress } from '@/components/ios-message-setup/setup-step';
import { CaptureMarketScene } from '@/components/onboarding/alive-scenes';
import { SetupHeader, SetupShell } from '@/components/onboarding/setup-shell';
import { SetupIntroStep } from '@/components/onboarding/setup-intro-step';
import { StatementScene } from '@/components/onboarding/statement-scene';
import { SupplementImports, type SupplementImportsPreview } from '@/components/supplement-imports';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { Colors, Fonts, MaxContentWidth, ScreenPadding, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { t, tf } from '@/lib/i18n';
import { iosShortcutSetupCopy } from '@/lib/ios-shortcut-setup-copy';
import { SUPPLEMENT_COPY } from '@/lib/supplement-copy';
import { useStore } from '@/lib/store';

/**
 * Design preview for iPhone-only setup screens, rendered on the web E2E build.
 *
 * The web export cannot run the iOS branches (Shortcuts, Messages automation),
 * so this route draws the same presentational components those screens use,
 * with fixed states, for screenshots in light/dark and English/Arabic. It
 * exists only in the E2E demo build; every other build redirects home.
 */
const PREVIEW_ENABLED = process.env.EXPO_PUBLIC_WAFRA_E2E_DEMO === '1';
const SHORTCUT = 'Wafra Capture v3';
const noop = () => {};
const night = Colors.dark;

export default function SetupPreview() {
  const { screen = 'past', mode = 'onboarding' } = useLocalSearchParams<{ screen?: string; mode?: string }>();
  if (!PREVIEW_ENABLED) return <Redirect href="/" />;
  if (screen === 'past' || screen === 'live') return <IntroPreview step={screen} />;
  if (screen.startsWith('statement')) return <StatementPreview state={screen} onboarding={mode === 'onboarding'} />;
  return <GuidePreview state={screen} onboarding={mode === 'onboarding'} />;
}

function IntroPreview({ step }: { step: 'past' | 'live' }) {
  const { state } = useStore();
  const index = step === 'past' ? 1 : 2;
  return (
    <SetupShell onboarding>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.introHeader}>
          <View style={styles.introTopline}>
            <View style={styles.introBack}>
              <Icon name="chevron-left" size={18} color={night.textSecondary} />
              <ThemedText style={styles.introBackLabel}>{t('onboardBack')}</ThemedText>
            </View>
            <ThemedText style={styles.introStep}>{tf('onboardStepOf', { step: index, total: 2 })}</ThemedText>
          </View>
          <View style={styles.introTrack}>
            {[1, 2].map((item) => (
              <View key={item} style={[styles.introSegment,
                { backgroundColor: item <= index ? night.primary : night.backgroundSelected }]} />
            ))}
          </View>
        </View>
        <ScrollView contentContainerStyle={styles.introContent} alwaysBounceVertical={false}>
          {step === 'past' ? (
            <SetupIntroStep
              testID="onboarding-ios-past"
              title={t('onboardPastTitle')}
              body={t('onboardPastBody')}
              scene={<StatementScene reducedMotion />}
              primary={{ label: t('onboardPastAction'), icon: 'upload', onPress: noop }}
              secondary={{ label: t('onboardLater'), onPress: noop }}
              howLabel={t('onboardHowItWorks')}
              onHow={noop}
            />
          ) : (
            <SetupIntroStep
              testID="onboarding-ios-live"
              title={t('onboardLiveTitle')}
              body={t('onboardLiveBody')}
              scene={<CaptureMarketScene marketId={state.marketId} country={state.country} />}
              primary={{ label: t('onboardLiveAction'), icon: 'bolt', onPress: noop }}
              secondary={{ label: t('onboardNotNow'), onPress: noop }}
              howLabel={t('onboardHowItWorks')}
              onHow={noop}
            />
          )}
        </ScrollView>
      </SafeAreaView>
    </SetupShell>
  );
}

function GuidePreview({ state, onboarding }: { state: string; onboarding: boolean }) {
  const language = useLanguage();
  const copy = iosShortcutSetupCopy(language);
  const labels = [copy.stepAdd, copy.stepTest, copy.stepAutomate];
  const fill = (value: string) => value.replace('{shortcut}', SHORTCUT);
  const guideIndex = state.startsWith('automate-') ? Number(state.slice('automate-'.length)) - 1 : -1;
  const guide = guideIndex >= 0 ? copy.guide[Math.min(guideIndex, copy.guide.length - 1)] : null;
  const stage = state === 'add' || state === 'confirm' ? 1 : state.startsWith('test') ? 2 : guide ? 3 : 4;
  let body: React.ReactNode;
  if (state === 'add') {
    body = (
      <SetupStep badge="1" title={copy.add} body={copy.bundled} chips={copy.bundledChips}>
        <Button label={t('iosLocalInstallShortcut')} onPress={noop} wrapLabel />
      </SetupStep>
    );
  } else if (state === 'confirm') {
    body = (
      <SetupStep badge="1" title={copy.confirmTitle} body={copy.confirmBody}>
        <Button label={copy.addedCheck} onPress={noop} wrapLabel />
        <Button label={t('iosMessageAddAgain')} variant="ghost" onPress={noop} wrapLabel />
      </SetupStep>
    );
  } else if (state === 'test' || state === 'test-fail') {
    const failed = state === 'test-fail';
    body = (
      <SetupStep badge="2" title={copy.check} body={copy.checkBody}
        result={failed ? { tone: 'fail', title: copy.failed, body: copy.repairBody } : null}>
        {failed ? (
          <>
            <Button label={copy.repair} onPress={noop} wrapLabel />
            <Button label={copy.retry} variant="outline" onPress={noop} wrapLabel />
          </>
        ) : <Button label={t('iosMessageRunPermissionCheck')} onPress={noop} wrapLabel />}
      </SetupStep>
    );
  } else if (guide) {
    const last = guideIndex >= copy.guide.length - 1;
    body = (
      <>
        <SetupStep badge={`3.${guideIndex + 1}`} title={guide.title} body={fill(guide.body)}
          chips={guide.chips.map(fill)} chipsPrefix={copy.inShortcuts}>
          {guideIndex === 0 ? (
            <>
              <Button label={t('iosLocalOpenAutomation')} onPress={noop} wrapLabel />
              <Button label={copy.next} variant="ghost" onPress={noop} wrapLabel />
            </>
          ) : (
            <>
              <Button label={last ? t('iosLocalAutomationAdded') : copy.next} onPress={noop} wrapLabel />
              <Button label={copy.previous} variant="ghost" onPress={noop} wrapLabel />
            </>
          )}
        </SetupStep>
        <Button label={copy.allSteps} variant="ghost" onPress={noop} wrapLabel />
        {state === 'automate-all' && <AutomationGuide shortcutName={SHORTCUT} />}
      </>
    );
  } else {
    body = (
      <SetupStep badge="✓" title={copy.doneTitle} body={copy.doneBody}
        result={{ tone: 'pass', title: copy.testPassed, body: copy.waitingAutomation }} />
    );
  }
  return (
    <SetupShell onboarding={onboarding}>
      <ThemedView style={[styles.root, onboarding && styles.clear]}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <ScrollView contentContainerStyle={styles.content}>
            <SetupHeader onboarding={onboarding} title={copy.liveTitle} subtitle={copy.liveSubtitle}
              back={{ label: t('back'), onPress: noop }}
              actions={[{ label: t('iosMessageLearnMore'), onPress: noop }]} />
            <View style={styles.guide}>
              {stage <= 3 && <StepProgress current={stage} labels={labels} template={copy.stepOf} />}
              {body}
              {state === 'error' && <SetupResult tone="fail" title={t('iosLocalShortcutInstallFailed')} />}
            </View>
          </ScrollView>
          <View style={styles.footer}>
            {stage === 4
              ? <Button label={t(onboarding ? 'iosMessageContinue' : 'iosMessageDone')} onPress={noop} wrapLabel />
              : onboarding ? <Button label={t('iosMessageContinueManual')} variant="ghost" onPress={noop} wrapLabel /> : null}
          </View>
        </SafeAreaView>
      </ThemedView>
    </SetupShell>
  );
}

function StatementPreview({ state, onboarding }: { state: string; onboarding: boolean }) {
  const language = useLanguage();
  const copy = SUPPLEMENT_COPY[language];
  const preview = useMemo<SupplementImportsPreview>(() => {
    if (state === 'statement-progress') {
      return { progress: { index: 2, total: 3 }, status: copy.uploadingProgress.replace('{index}', '2').replace('{total}', '3') };
    }
    if (state === 'statement-result') {
      return {
        summary: { added: 142, review: 3, skipped: 5 },
        files: [
          { name: 'Statement-Aug-2026.pdf', ok: true, detail: '96' },
          { name: 'Card-Jul-2026.csv', ok: false, detail: copy.errDates },
        ],
      };
    }
    if (state === 'statement-error') return { error: copy.errUnreadable };
    return {};
  }, [copy, state]);
  const content = <SupplementImports preview={preview} onboarding={onboarding ? { onContinue: noop } : undefined} />;
  if (onboarding) {
    return (
      <SetupShell onboarding>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <ScrollView contentContainerStyle={styles.content}>
            <SetupHeader onboarding title={t('onboardPastTitle')} back={{ label: t('onboardStatementBack'), onPress: noop }} />
            {content}
          </ScrollView>
        </SafeAreaView>
      </SetupShell>
    );
  }
  return (
    <SetupShell onboarding={false}>
      <ThemedView style={styles.root}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <ScrollView contentContainerStyle={styles.content}>
            <SetupHeader onboarding={false} title={t('statementImportTitle')} back={{ label: t('back'), onPress: noop }} />
            {content}
          </ScrollView>
        </SafeAreaView>
      </ThemedView>
    </SetupShell>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  clear: { backgroundColor: 'transparent' },
  safe: { flex: 1 },
  content: {
    width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center',
    paddingHorizontal: ScreenPadding, paddingBottom: Spacing.four, gap: 14,
  },
  guide: { gap: Spacing.three },
  footer: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingHorizontal: ScreenPadding, paddingVertical: 12 },
  introHeader: { paddingHorizontal: ScreenPadding, paddingTop: Spacing.two },
  introTopline: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  introBack: { minHeight: 48, flexDirection: 'row', gap: 4, alignItems: 'center' },
  introBackLabel: { color: night.textSecondary, fontFamily: Fonts.sansMedium, fontSize: 12 },
  introStep: { color: night.textTertiary, fontFamily: Fonts.monoMedium, fontSize: 11 },
  introTrack: { flexDirection: 'row', gap: 5 },
  introSegment: { flex: 1, height: 3, borderRadius: 2 },
  introContent: { flexGrow: 1, paddingHorizontal: ScreenPadding, paddingBottom: 12, paddingTop: 10 },
});
