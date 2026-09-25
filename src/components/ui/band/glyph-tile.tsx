import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '@/components/ui/icon';
import type { BandPalette } from '@/constants/theme';
import { getCategory } from '@/lib/categories';
import type { CategoryId } from '@/lib/types';

/**
 * A category glyph on the sheet's one glyph ground, in the sheet's text
 * colour. One tone for every category: identity is the glyph, never a hue.
 * Merchant rows keep their logo tile (`MerchantAvatar`); this is for rows
 * that are about a category, and the fallback inside a logo tile.
 */
export function GlyphTile({ category, icon, size = 40, palette, tone = 'sheet' }: {
  category?: CategoryId;
  icon?: IconName;
  size?: number;
  palette: BandPalette;
  /** On the sheet (default) or set on the band itself. */
  tone?: 'sheet' | 'band';
}) {
  const name = icon ?? getCategory(category ?? 'other').icon;
  const ground = tone === 'band' ? palette.tile : palette.glyphGround;
  const ink = tone === 'band' ? palette.onBand : palette.text;
  return <View accessible={false} importantForAccessibility="no" style={[styles.tile,
    { width: size, height: size, borderRadius: Math.round(size * 0.28), backgroundColor: ground }]}>
    <Icon name={name} size={Math.round(size * 0.5)} color={ink} strokeWidth={2} />
  </View>;
}

const styles = StyleSheet.create({ tile: { alignItems: 'center', justifyContent: 'center' } });
