import React from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts, type BandPalette } from '@/constants/theme';

/**
 * A text field set on a colour band (Add's merchant): a 48pt pill in the
 * band's own tone with light text, its label above it in the band's
 * secondary colour, and an error line under it in the band's text colour.
 * The label is the field's spoken name; the placeholder is an example.
 */
export function BandTextField({ palette, label, accessibilityLabel, value, onChangeText, placeholder, maxLength,
  invalid = false, errorText, arabic, testID }: {
  palette: BandPalette;
  label: string;
  accessibilityLabel?: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  invalid?: boolean;
  errorText?: string;
  arabic: boolean;
  testID?: string;
}) {
  return <View style={styles.root}>
    <ThemedText type="small" style={{ color: palette.onBandSecondary }}>{label}</ThemedText>
    <View style={[styles.pill, { backgroundColor: palette.tile, borderColor: invalid ? palette.onBand : 'transparent' }]}>
      <TextInput
        testID={testID}
        accessibilityLabel={accessibilityLabel ?? label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.onBandSecondary}
        selectionColor={palette.onBand}
        maxLength={maxLength}
        returnKeyType="done"
        style={[styles.input, { color: palette.onBand, fontFamily: arabic ? Fonts.arabic : Fonts.sans,
          textAlign: arabic ? 'right' : 'left' }]}
      />
    </View>
    {errorText ? <ThemedText type="meta" accessibilityLiveRegion="polite" style={{ color: palette.onBand }}>{errorText}</ThemedText> : null}
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 6 },
  pill: { minHeight: 48, borderRadius: 24, borderWidth: 1.5, paddingHorizontal: 16, justifyContent: 'center' },
  input: { fontSize: 17, minHeight: 46, paddingVertical: 10 },
});
