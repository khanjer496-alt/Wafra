/**
 * What Android's SMS permission means for Wafra, shown BEFORE the system
 * prompt. Android words the READ_SMS grant as "send and view SMS messages";
 * a person reading only that sentence has good reason to refuse. This screen
 * says what Wafra actually does with it, then hands over to the real prompt.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ETextAction } from '@/components/onboarding/e-frame';
import { ThemedText } from '@/components/themed-text';
import { EButton } from '@/components/ui/band/e-button';
import { Icon } from '@/components/ui/icon';
import { Fonts, Spacing, type BandPalette } from '@/constants/theme';
import { onboardingCopy } from '@/lib/onboarding-copy';

/** Drawn on the first-payment band (design language E), in its palette. */
export function SmsPermissionExplainer({ language, disabled, onContinue, onNotNow, palette }: {
  language: 'en' | 'ar';
  disabled: boolean;
  onContinue: () => void;
  onNotNow: () => void;
  palette: BandPalette;
}) {
  const copy = onboardingCopy(language);
  return (
    <View style={styles.root} testID="onboarding-sms-explainer">
      <View style={[styles.icon, { backgroundColor: palette.tile }]}>
        <Icon name="mail" size={26} color={palette.onBand} />
      </View>
      <View style={styles.hero}>
        <ThemedText style={[styles.title, { color: palette.onBand }]} accessibilityRole="header">{copy.smsExplainerTitle}</ThemedText>
        <ThemedText style={[styles.body, { color: palette.onBandSecondary }]}>{copy.smsExplainerBody}</ThemedText>
      </View>
      <View style={[styles.card, { backgroundColor: palette.sheet }]}>
        <View style={styles.cardRow}>
          <Icon name="alert" size={16} color={palette.textSecondary} />
          <ThemedText style={[styles.cardText, { color: palette.text }]}>{copy.smsExplainerSystemName}</ThemedText>
        </View>
        <View style={styles.cardRow}>
          <Icon name="lock" size={16} color={palette.tint} />
          <ThemedText style={[styles.cardText, { color: palette.text }]}>{copy.smsExplainerNever}</ThemedText>
        </View>
      </View>
      <View style={styles.actions}>
        <EButton palette={palette} color={{ fill: palette.onBand, text: palette.band }}
          label={copy.smsExplainerContinue} onPress={onContinue} disabled={disabled} testID="onboarding-sms-explainer-continue" />
        <ETextAction palette={palette} label={copy.smsExplainerNotNow} onPress={onNotNow} disabled={disabled} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, gap: Spacing.four },
  icon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: { gap: Spacing.two },
  title: {
    fontFamily: Fonts.sansSemi,
    fontSize: 25,
    lineHeight: 31,
    letterSpacing: -0.7,
  },
  body: { fontSize: 16, lineHeight: 23 },
  card: {
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: 24,
  },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  cardText: { flex: 1, fontSize: 14, lineHeight: 20 },
  actions: { marginTop: 'auto', gap: Spacing.two },
});
