import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GlyphTile } from '@/components/ui/band/glyph-tile';
import { Icon, type IconName } from '@/components/ui/icon';
import type { BandPalette } from '@/constants/theme';

/**
 * A row on the sheet that opens another screen: a glyph tile, the title and
 * one line under it, and a chevron (mirrored in Arabic by `Icon`). 56pt.
 */
export function SheetLinkRow({ title, body, icon, onPress, palette, testID, last = false }: {
  title: string;
  body?: string;
  icon: IconName;
  onPress: () => void;
  palette: BandPalette;
  testID?: string;
  last?: boolean;
}) {
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={body ? `${title}. ${body}` : title}
    onPress={onPress}
    style={({ pressed }) => [styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.rule },
      { opacity: pressed ? 0.7 : 1 }]}>
    <GlyphTile icon={icon} palette={palette} size={40} />
    <View style={styles.copy}>
      <ThemedText type="smallBold" style={{ color: palette.text }}>{title}</ThemedText>
      {body ? <ThemedText type="meta" style={{ color: palette.textSecondary }}>{body}</ThemedText> : null}
    </View>
    <Icon name="chevron-right" size={18} color={palette.textSecondary} />
  </Pressable>;
}

/** A plain section title on the sheet. */
export function SheetSectionTitle({ title, palette, testID }: { title: string; palette: BandPalette; testID?: string }) {
  return <ThemedText testID={testID} type="smallBold" accessibilityRole="header"
    style={[styles.title, { color: palette.text }]}>{title}</ThemedText>;
}

const styles = StyleSheet.create({
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 17, lineHeight: 24 },
});
