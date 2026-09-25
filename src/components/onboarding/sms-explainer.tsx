/**
 * What Android's SMS permission means for Wafra, shown BEFORE the system
 * prompt. Android words the READ_SMS grant as "send and view SMS messages";
 * a person reading only that sentence has good reason to refuse. This screen
 * says what Wafra actually does with it, then hands over to the real prompt.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { onboardingCopy } from '@/lib/onboarding-copy';

/** Onboarding is night mode regardless of the OS theme (see onboarding-gate). */
const night = Colors.dark;

export function SmsPermissionExplainer({ language, disabled, onContinue, onNotNow }: {
  language: 'en' | 'ar';
  disabled: boolean;
  onContinue: () => void;
  onNotNow: () => void;
}) {
  const copy = onboardingCopy(language);
  return (
    <View style={styles.root} testID="onboarding-sms-explainer">
      <View style={styles.icon}>
        <Icon name="mail" size={26} color={night.primary} />
      </View>
      <View style={styles.hero}>
        <ThemedText style={styles.title} accessibilityRole="header">{copy.smsExplainerTitle}</ThemedText>
        <ThemedText style={styles.body}>{copy.smsExplainerBody}</ThemedText>
      </View>
      <View style={styles.card}>
        <View style={styles.cardRow}>
          <Icon name="alert" size={16} color={night.textSecondary} />
          <ThemedText style={styles.cardText}>{copy.smsExplainerSystemName}</ThemedText>
        </View>
        <View style={styles.cardRow}>
          <Icon name="lock" size={16} color={night.primary} />
          <ThemedText style={styles.cardText}>{copy.smsExplainerNever}</ThemedText>
        </View>
      </View>
      <View style={styles.actions}>
        <Button
          wrapLabel
          label={copy.smsExplainerContinue}
          onPress={onContinue}
          disabled={disabled}
          labelColor={night.onPrimary}
          style={styles.primary}
        />
        <Button
          wrapLabel
          variant="ghost"
          label={copy.smsExplainerNotNow}
          onPress={onNotNow}
          disabled={disabled}
          labelColor={night.text}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, gap: Spacing.four },
  icon: {
    width: 56,
    height: 56,
    borderRadius: Radius.control,
    backgroundColor: night.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: { gap: Spacing.two },
  title: {
    fontFamily: Fonts.sansSemi,
    fontSize: 25,
    lineHeight: 31,
    letterSpacing: -0.7,
    color: night.text,
  },
  body: { color: night.textSecondary, fontSize: 16, lineHeight: 23 },
  card: {
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.sheet,
    borderWidth: 1,
    borderColor: night.cardBorder,
    backgroundColor: night.backgroundElement,
  },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  cardText: { flex: 1, color: night.textSecondary, fontSize: 14, lineHeight: 20 },
  actions: { marginTop: 'auto', gap: Spacing.two },
  primary: { backgroundColor: night.primary },
});
