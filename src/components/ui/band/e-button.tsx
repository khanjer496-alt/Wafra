import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon, type IconName } from '@/components/ui/icon';
import { BandLayout, type BandPalette } from '@/constants/theme';
import { committed, tapped } from '@/lib/haptics';

export type EButtonVariant = 'primary' | 'secondary' | 'quiet';

/**
 * The plain E button: 56pt tall, 16pt radius, label centred. No arrow in a
 * circle. `primary` fills with the band colour (or the colour given, e.g.
 * cream on an ink onboarding step), `secondary` is a card with a rule,
 * `quiet` is text in the band tint. Press feedback is a 150ms-class dim,
 * nothing moves.
 */
export function EButton({ label, onPress, variant = 'primary', palette, color, icon, disabled = false, busy = false,
  accessibilityHint, testID, style, haptic = 'tap', reserveLabels }: {
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
  /** A tick for the press (default), a firmer tap when the press itself commits, or none. */
  haptic?: 'tap' | 'commit' | 'none';
  /**
   * Opt-in: every label this button can show. The button keeps the height of
   * the tallest, so a label that wraps at large text ("Skip for now") giving
   * way to a shorter one ("Continue") never changes its height. Unset (the
   * default) draws exactly as before.
   */
  reserveLabels?: readonly string[];
}) {
  const fill = variant === 'primary' ? (color?.fill ?? palette.fill) : variant === 'secondary' ? palette.card : 'transparent';
  const fg = variant === 'primary' ? (color?.text ?? palette.onFill) : variant === 'secondary' ? palette.text : palette.tint;
  const border = variant === 'secondary' ? palette.rule : 'transparent';
  const inactive = disabled || busy;
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={accessibilityHint}
    accessibilityState={{ disabled: inactive, busy }} disabled={inactive}
    onPress={() => { if (haptic === 'commit') committed(); else if (haptic === 'tap') tapped(); onPress(); }}
    style={({ pressed }) => [styles.button, { backgroundColor: fill, borderColor: border, opacity: disabled ? 0.45 : pressed ? 0.85 : 1 }, style]}>
    {busy ? <ActivityIndicator color={fg} /> : <>
      {icon ? <Icon name={icon} size={20} color={fg} strokeWidth={2} /> : null}
      {reserveLabels && reserveLabels.length > 0 ? <View style={styles.labelStack}>
        <ThemedText type="smallBold" style={[styles.label, styles.stacked, { color: fg }]}>{label}</ThemedText>
        {/* The other labels, invisible and laid over it: the row is as tall as the tallest. */}
        {reserveLabels.filter((other) => other !== label).map((other) => <ThemedText key={other} type="smallBold"
          aria-hidden accessibilityElementsHidden importantForAccessibility="no"
          style={[styles.label, styles.stacked, styles.reserved]}>{other}</ThemedText>)}
      </View> : <ThemedText type="smallBold" style={[styles.label, { color: fg }]}>{label}</ThemedText>}
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
  // Labels in one row, each the row's full width, the later ones pulled back over the first.
  labelStack: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  stacked: { width: '100%', flexShrink: 0 },
  reserved: { marginStart: '-100%', opacity: 0 },
});
