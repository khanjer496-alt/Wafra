import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon, type IconName } from '@/components/ui/icon';
import { BandLayout, type BandPalette } from '@/constants/theme';

export type EButtonVariant = 'primary' | 'secondary' | 'quiet';

/**
 * The plain E button: 56pt tall, 16pt radius, label centred. No arrow in a
 * circle. `primary` fills with the band colour (or the colour given, e.g.
 * cream on an ink onboarding step), `secondary` is a card with a rule,
 * `quiet` is text in the band tint. Press feedback is a 150ms-class dim,
 * nothing moves.
 */
export function EButton({ label, onPress, variant = 'primary', palette, color, icon, disabled = false, busy = false,
  accessibilityHint, testID, style }: {
  label: string;
  onPress: () => void;
  variant?: EButtonVariant;
  palette: BandPalette;
  /** Overrides the primary fill and its text (a button set on a band). */
  color?: { fill: string; text: string };
  icon?: IconName;
  disabled?: boolean;
  /** Shows a spinner in place of the label and blocks presses. */
  busy?: boolean;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const fill = variant === 'primary' ? (color?.fill ?? palette.fill) : variant === 'secondary' ? palette.card : 'transparent';
  const fg = variant === 'primary' ? (color?.text ?? palette.onFill) : variant === 'secondary' ? palette.text : palette.tint;
  const border = variant === 'secondary' ? palette.rule : 'transparent';
  const inactive = disabled || busy;
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={accessibilityHint}
    accessibilityState={{ disabled: inactive, busy }} disabled={inactive} onPress={onPress}
    style={({ pressed }) => [styles.button, { backgroundColor: fill, borderColor: border, opacity: disabled ? 0.45 : pressed ? 0.85 : 1 }, style]}>
    {busy ? <ActivityIndicator color={fg} /> : <>
      {icon ? <Icon name={icon} size={20} color={fg} strokeWidth={2} /> : null}
      <ThemedText type="smallBold" style={[styles.label, { color: fg }]}>{label}</ThemedText>
    </>}
  </Pressable>;
}

const styles = StyleSheet.create({
  button: {
    minHeight: BandLayout.buttonHeight, borderRadius: BandLayout.buttonRadius, borderWidth: 1.5,
    paddingHorizontal: 20, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    alignSelf: 'stretch',
  },
  label: { fontSize: 17, lineHeight: 22, textAlign: 'center', flexShrink: 1 },
});
