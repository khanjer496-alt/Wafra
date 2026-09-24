import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/controls';
import { Icon, type IconName } from '@/components/ui/icon';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { tapped } from '@/lib/haptics';

/** Onboarding is night mode regardless of the OS theme (see onboarding-gate). */
const night = Colors.dark;

export interface SetupIntroAction {
  label: string;
  onPress(): void;
  disabled?: boolean;
  icon?: IconName;
}

export interface SetupIntroStepProps {
  testID: string;
  title: string;
  /** One sentence. Everything else belongs behind "How it works". */
  body: string;
  scene: React.ReactNode;
  primary: SetupIntroAction;
  /** The quiet way past this step: "Later" or "Not now". */
  secondary: SetupIntroAction;
  howLabel: string;
  onHow(): void;
  /** Live status while an action runs. */
  note?: string | null;
  actionsTestID?: string;
}

/**
 * One iPhone setup step after the questionnaire: a title, one sentence, a
 * picture, one primary action, one quiet way past it, and a disclosure.
 * Presentational only; the gate owns every effect of these actions.
 */
export function SetupIntroStep({
  testID, title, body, scene, primary, secondary, howLabel, onHow, note, actionsTestID,
}: SetupIntroStepProps) {
  return (
    <View style={styles.step} testID={testID}>
      <View style={styles.hero}>
        <ThemedText style={styles.title} accessibilityRole="header">{title}</ThemedText>
        <ThemedText style={styles.body}>{body}</ThemedText>
      </View>
      {scene}
      <View style={styles.actions} testID={actionsTestID}>
        <Button
          wrapLabel
          icon={primary.icon}
          label={primary.label}
          onPress={primary.onPress}
          disabled={primary.disabled}
          labelColor={night.onPrimary}
          style={styles.primary}
        />
        <Button
          wrapLabel
          variant="ghost"
          label={secondary.label}
          onPress={secondary.onPress}
          disabled={secondary.disabled}
          labelColor={night.text}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={howLabel}
          onPress={() => {
            tapped();
            onHow();
          }}
          hitSlop={4}
          style={({ pressed }) => [styles.how, { opacity: pressed ? 0.6 : 1 }]}>
          <Icon name="lock" size={13} color={night.textTertiary} />
          <ThemedText style={styles.howText}>{howLabel}</ThemedText>
        </Pressable>
      </View>
      {note ? <ThemedText style={styles.note} accessibilityLiveRegion="polite">{note}</ThemedText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  step: { flex: 1, gap: Spacing.four },
  hero: { gap: Spacing.two },
  title: {
    fontFamily: Fonts.sansSemi,
    fontSize: 25,
    lineHeight: 31,
    letterSpacing: -0.7,
    color: night.text,
  },
  body: { color: night.textSecondary, fontSize: 16, lineHeight: 23 },
  // Actions sit at the bottom of a fitting screen and scroll with it otherwise.
  actions: { marginTop: 'auto', gap: Spacing.two },
  primary: { backgroundColor: night.primary },
  how: {
    minHeight: 44,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.three,
  },
  howText: { color: night.textSecondary, fontFamily: Fonts.sansMedium, fontSize: 14 },
  note: { color: night.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center' },
});
