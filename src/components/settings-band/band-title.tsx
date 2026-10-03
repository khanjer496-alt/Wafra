import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts, type BandPalette } from '@/constants/theme';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';

/**
 * A screen's plain title set large on its band ("Settings", "Data and help",
 * "Customize Home"), with at most one sentence under it. Geist SemiBold — no
 * serif, no slogan; the title says what the screen is. At the accessibility
 * text sizes it steps down and its growth is capped (1.5×, 45pt), so a long
 * word ("Customize", "feedback") still fits the width instead of breaking
 * mid-word; the sentence under it scales freely.
 */
export function BandTitle({ title, body, palette, testID }: {
  title: string;
  body?: string | null;
  palette: BandPalette;
  testID?: string;
}) {
  const largeText = useLargeTextLayout();
  return (
    <View style={styles.wrap} testID={testID}>
      <ThemedText accessibilityRole="header" maxFontSizeMultiplier={largeText ? 1.5 : 1.4}
        style={[largeText ? styles.titleLarge : styles.title, { color: palette.onBand }]}>
        {title}
      </ThemedText>
      {body ? (
        <ThemedText type="default" style={{ color: palette.onBandSecondary }}>{body}</ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  title: { fontFamily: Fonts.sansSemi, fontSize: 38, lineHeight: 44, letterSpacing: -1.3 },
  titleLarge: { fontFamily: Fonts.sansSemi, fontSize: 30, lineHeight: 38, letterSpacing: -0.6 },
});
