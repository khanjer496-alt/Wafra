/**
 * E1 · Welcome (ink). The mark draws itself, an example pattern builds and
 * rebuilds above the headline — labelled as an example, spoken as one —
 * then one plain sentence, Get started and the existing backup restore.
 * No language switch here (owner decision, 2026-09-25): the app already
 * follows the phone's language and Settings changes it.
 */
import React, { useMemo } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';

import { EBody, EHeadline, EStepFrame, ETextAction, bandButtonColor, fitPatternTile } from '@/components/onboarding/e-frame';
import { LogoDraw, useReplayKey } from '@/components/onboarding/e-motion';
import { ThemedText } from '@/components/themed-text';
import { EButton } from '@/components/ui/band/e-button';
import { PatternMosaic } from '@/components/ui/pattern-mosaic';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
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

export function WelcomeStep({ onStart, onRestore, restoreNote, onClose, disabled }: {
  onStart: () => void;
  /** Absent in the Settings preview and on web, where restore is not offered. */
  onRestore?: () => void;
  restoreNote: string | null;
  onClose?: () => void;
  disabled: boolean;
}) {
  const language = useLanguage();
  const words = onboardingECopy(language);
  const band = useBand('home');
  const tiles = useMemo(() => examplePattern(words.exampleInitial), [words.exampleInitial]);
  const replay = useReplayKey(9000);
  const tile = fitPatternTile(useWindowDimensions().width, 44);
  return <EStepFrame palette={band} step={null} onClose={onClose} testID="onboarding-welcome"
    footer={<>
      <EButton palette={band} color={bandButtonColor(band)} label={words.getStarted} onPress={onStart}
        disabled={disabled} testID="onboarding-get-started" />
      {onRestore ? <ETextAction palette={band} label={words.restoreBackup} onPress={onRestore}
        disabled={disabled} testID="onboarding-restore-backup" /> : null}
      {restoreNote ? <ThemedText accessibilityLiveRegion="polite" type="meta"
        style={[styles.note, { color: band.onBand }]}>{restoreNote}</ThemedText> : null}
    </>}>
    <View style={styles.logo}><LogoDraw size={38} color={band.accent} /></View>
    <View style={styles.example} testID="onboarding-example-pattern">
      <PatternMosaic key={replay} tiles={tiles} tile={tile} animate accessibilityLabel={words.exampleLabel} />
      <ThemedText type="meta" style={{ color: band.onBandSecondary }} accessible={false}>{words.exampleLabel}</ThemedText>
    </View>
    <EHeadline palette={band} size={Platform.OS === 'web' ? 52 : 56}>{words.welcomeHeadline}</EHeadline>
    <EBody palette={band}>{words.welcomeBody}</EBody>
  </EStepFrame>;
}

const styles = StyleSheet.create({
  logo: { paddingTop: 28 },
  example: { gap: 10, paddingTop: 12, paddingBottom: 16 },
  note: { textAlign: 'center' },
});
