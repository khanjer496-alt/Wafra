/**
 * The chrome every design-language-E onboarding step shares: a full-bleed
 * band colour, the back control and the five progress dots, one oversized
 * Geist headline, a scrolling body and plain 56pt buttons.
 *
 * The step's colour is its band (useBand), so dark mode deepens it exactly
 * as it deepens the tabs. The footer scrolls with the content instead of
 * pinning over it, which is what lets every step stack at the accessibility
 * text sizes without a control sliding under another.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Fonts, type BandPalette } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { bandCopy } from '@/lib/band-copy';
import { tapped } from '@/lib/haptics';
import { ONBOARDING_E_TOTAL_STEPS } from '@/lib/onboarding-e';
import { onboardingECopy } from '@/lib/onboarding-e-copy';

/** The side gutter of the boards. */
export const E_GUTTER = 24;

/**
 * The largest pattern tile (up to `max`) whose 6 × 2 grid fits the screen
 * between the gutters, with the mosaic's own proportional gap.
 */
export function fitPatternTile(screenWidth: number, max = 52): number {
  const room = Math.max(120, Math.min(screenWidth, 560) - E_GUTTER * 2);
  // 6 tiles and 5 gaps of tile × 6/52.
  return Math.max(16, Math.min(max, Math.floor(room / (6 + 5 * (6 / 52)))));
}

/** A primary button set on a band: the band's text colour as the fill, the band as its label. */
export function bandButtonColor(palette: BandPalette): { fill: string; text: string } {
  return { fill: palette.onBand, text: palette.band };
}

/** Five dots; the current one is a short bar, done ones solid, the rest faint. */
export function EProgressDots({ step, palette }: { step: number; palette: BandPalette }) {
  const words = onboardingECopy(useLanguage());
  const label = words.stepOf(step, ONBOARDING_E_TOTAL_STEPS);
  return <View accessible accessibilityRole="progressbar" accessibilityLabel={label}
    accessibilityValue={{ min: 1, max: ONBOARDING_E_TOTAL_STEPS, now: step, text: label }}
    style={styles.dots} testID="onboarding-progress">
    {Array.from({ length: ONBOARDING_E_TOTAL_STEPS }, (_, index) => {
      const n = index + 1;
      return <View key={n} style={[styles.dot, {
        width: n === step ? 18 : 6,
        backgroundColor: n <= step ? palette.onBand : palette.bandRule,
      }]} />;
    })}
  </View>;
}

/** Back (and, in the Settings preview, Close) above a step. */
export function ETopRow({ palette, step, onBack, onClose, disabled }: {
  palette: BandPalette;
  step: number | null;
  onBack?: () => void;
  onClose?: () => void;
  disabled?: boolean;
}) {
  const words = bandCopy(useLanguage());
  return <View style={styles.topRow}>
    {onBack ? <Pressable accessibilityRole="button" accessibilityLabel={words.back} testID="onboarding-back"
      accessibilityState={{ disabled: !!disabled }} disabled={disabled} hitSlop={8}
      onPress={() => { tapped(); onBack(); }}
      style={({ pressed }) => [styles.iconButton, { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}>
      <Icon name="chevron-left" size={22} color={palette.onBand} strokeWidth={2.2} />
    </Pressable> : <View style={styles.iconButton} />}
    {step !== null ? <EProgressDots step={step} palette={palette} /> : <View />}
    {onClose ? <Pressable accessibilityRole="button" accessibilityLabel={words.close} testID="onboarding-close"
      onPress={onClose} hitSlop={8}
      style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.6 : 1 }]}>
      <Icon name="close" size={20} color={palette.onBand} />
    </Pressable> : <View style={styles.iconButton} />}
  </View>;
}

/** The step headline: large Geist SemiBold, never serif, never italic. */
export function EHeadline({ children, palette, size = 44, testID }: {
  children: string;
  palette: BandPalette;
  size?: number;
  testID?: string;
}) {
  const largeText = useLargeTextLayout();
  // Oversized already: at the accessibility sizes it starts smaller, still
  // scales with the person's text size, and wraps — never a scale ceiling.
  const fontSize = largeText ? Math.round(size * 0.62) : size;
  return <ThemedText accessibilityRole="header" testID={testID}
    style={[styles.headline, { color: palette.onBand, fontSize, lineHeight: Math.round(fontSize * 1.06) }]}>
    {children}
  </ThemedText>;
}

/** Body copy on the band. */
export function EBody({ children, palette, secondary = true, style }: {
  children: React.ReactNode;
  palette: BandPalette;
  secondary?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  return <ThemedText style={[styles.body, { color: secondary ? palette.onBandSecondary : palette.onBand }, style]}>
    {children}
  </ThemedText>;
}

/** A quiet text action on the band (Skip, Not now, Restore): 48pt tall. */
export function ETextAction({ label, onPress, palette, disabled, testID, accessibilityHint }: {
  label: string;
  onPress: () => void;
  palette: BandPalette;
  disabled?: boolean;
  testID?: string;
  accessibilityHint?: string;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={accessibilityHint}
    accessibilityState={{ disabled: !!disabled }} disabled={disabled} testID={testID}
    onPress={() => { tapped(); onPress(); }}
    style={({ pressed }) => [styles.textAction, { opacity: disabled ? 0.45 : pressed ? 0.6 : 1 }]}>
    <ThemedText type="smallBold" style={[styles.textActionLabel, { color: palette.onBand }]}>{label}</ThemedText>
  </Pressable>;
}

/**
 * One step: the band, the top row, the scrolling body, the footer at the
 * bottom of the scroll. `step` lights a progress dot; null hides the dots.
 */
export function EStepFrame({ palette, step, onBack, onClose, backDisabled, footer, children, testID, contentStyle }: {
  palette: BandPalette;
  step: number | null;
  onBack?: () => void;
  onClose?: () => void;
  backDisabled?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
  testID?: string;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const largeText = useLargeTextLayout();
  return <SafeAreaView edges={['top', 'bottom']} style={styles.safe} testID={testID}>
    {onBack || onClose || step !== null
      ? <ETopRow palette={palette} step={step} onBack={onBack} onClose={onClose} disabled={backDisabled} />
      : null}
    <ScrollView keyboardShouldPersistTaps="handled" bounces={largeText} alwaysBounceVertical={false}
      showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
      <View style={[styles.body_, contentStyle]}>{children}</View>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center' },
  topRow: {
    minHeight: 52, paddingHorizontal: E_GUTTER - 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 44 },
  dot: { height: 6, borderRadius: 3 },
  scroll: { flexGrow: 1, paddingHorizontal: E_GUTTER, paddingBottom: 20 },
  body_: { paddingTop: 12, gap: 16 },
  footer: { marginTop: 'auto', paddingTop: 24, gap: 6 },
  headline: { fontFamily: Fonts.sansSemi, letterSpacing: -1.4 },
  body: { fontSize: 17, lineHeight: 25 },
  textAction: { minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  textActionLabel: { fontSize: 15, textAlign: 'center' },
});
