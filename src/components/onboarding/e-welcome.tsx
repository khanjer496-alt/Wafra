/**
 * E1 · Welcome (ink). The mark draws itself, then the headline and one plain
 * sentence; below them, filling the screen down to Get started, the hero:
 * an example bank alert whose amount lifts off as a coin into its category,
 * and the example pattern settling around that tile (sms-coin-scene.tsx) —
 * labelled as an example, spoken as one — then Get started and the existing
 * backup restore. No language switch here (owner decision, 2026-09-25): the
 * app already follows the phone's language and Settings changes it.
 */
import React, { useMemo } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';

import { EBody, EHeadline, EStepFrame, ETextAction, bandButtonColor, fitPatternTile } from '@/components/onboarding/e-frame';
import { LogoDraw } from '@/components/onboarding/e-motion';
import { SmsCoinScene } from '@/components/onboarding/sms-coin-scene';
import { ThemedText } from '@/components/themed-text';
import { EButton } from '@/components/ui/band/e-button';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { onboardingECopy } from '@/lib/onboarding-e-copy';
import { buildPattern } from '@/lib/pattern';

/** Every answer drawn once, so the example shows what a pattern can hold. */
function examplePattern(initial: string) {
  return buildPattern({
    name: initial,
    goals: ['bills', 'salary', 'subscriptions', 'cash-cards', 'spend-less'],
    watched: ['dining', 'groceries'],
    reminders: { bills: true, cards: true, dailySummary: true },
  });
}

export function WelcomeStep({ onStart, onRestore, restoreNote, onClose, disabled, currency, country }: {
  onStart: () => void;
  /** Absent in the Settings preview and on web, where restore is not offered. */
  onRestore?: () => void;
  restoreNote: string | null;
  onClose?: () => void;
  disabled: boolean;
  /** The example alert's currency; the phone's suggested currency when absent. */
  currency?: string | null;
  /** A confirmed country, for the example's regional grocer; the phone's Region when absent. */
  country?: string | null;
}) {
  const language = useLanguage();
  const words = onboardingECopy(language);
  const band = useBand('home');
  const tiles = useMemo(() => examplePattern(words.exampleInitial), [words.exampleInitial]);
  const { width, height } = useWindowDimensions();
  const largeText = useLargeTextLayout();
  // Short phones and the accessibility text sizes draw the pattern smaller so
  // Get started stays close; the scene still stacks above it.
  const tile = fitPatternTile(width, largeText || height < 700 ? 34 : 44);
  const pattern = useMemo(() => ({ tiles, tile, label: words.exampleLabel }), [tiles, tile, words.exampleLabel]);
  return <EStepFrame palette={band} step={null} onClose={onClose} testID="onboarding-welcome" contentStyle={styles.content}
    footer={<>
      <EButton palette={band} color={bandButtonColor(band)} label={words.getStarted} onPress={onStart}
        disabled={disabled} testID="onboarding-get-started" />
      {onRestore ? <ETextAction palette={band} label={words.restoreBackup} onPress={onRestore}
        disabled={disabled} testID="onboarding-restore-backup" /> : null}
      {restoreNote ? <ThemedText accessibilityLiveRegion="polite" type="meta"
        style={[styles.note, { color: band.onBand }]}>{restoreNote}</ThemedText> : null}
    </>}>
    <View style={styles.logo}><LogoDraw size={38} color={band.accent} /></View>
    <EHeadline palette={band} size={Platform.OS === 'web' ? 52 : 56}>{words.welcomeHeadline}</EHeadline>
    <EBody palette={band}>{words.welcomeBody}</EBody>
    <View style={styles.hero}>
      <SmsCoinScene palette={band} sender={words.exampleSender} pattern={pattern} currency={currency} country={country}
        testID="onboarding-sms-coin-scene" />
    </View>
  </EStepFrame>;
}

const styles = StyleSheet.create({
  content: { flexGrow: 1 },
  logo: { paddingTop: 28 },
  // The space between the sentence and Get started is the scene's.
  hero: { flexGrow: 1, justifyContent: 'center', paddingTop: 12, paddingBottom: 8 },
  note: { textAlign: 'center' },
});
