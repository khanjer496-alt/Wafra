import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '@/components/ui/icon';
import type { BandPalette } from '@/constants/theme';
import { getCategory } from '@/lib/categories';
import { CATEGORY_INK, categoryColor } from '@/lib/category-colors';
import type { CategoryId } from '@/lib/types';

/**
 * A category glyph on the sheet's one glyph ground, in the sheet's text
 * colour. One tone by default: identity is the glyph. Spending's category
 * list uses `tone="category"`, the category's own colour with dark ink, so a
 * row matches its coin on the band. Merchant rows keep their logo tile
 * (`MerchantAvatar`); this is for rows that are about a category, and the
 * fallback inside a logo tile.
 */
export function GlyphTile({ category, icon, size = 40, palette, tone = 'sheet', color }: {
  category?: CategoryId;
  icon?: IconName;
  size?: number;
  palette: BandPalette;
  /** On the sheet (default), set on the band itself, or in the category's own colour. */
  tone?: 'sheet' | 'band' | 'category';
  /** With `tone="category"`: the colour this view assigned (`categoryColors`), when it differs from the default. */
  color?: string;
}) {
  const name = icon ?? getCategory(category ?? 'other').icon;
  const ground = tone === 'category' ? color ?? categoryColor(category ?? 'other') : tone === 'band' ? palette.tile : palette.glyphGround;
  const ink = tone === 'category' ? CATEGORY_INK : tone === 'band' ? palette.onBand : palette.text;
  return <View accessible={false} importantForAccessibility="no" style={[styles.tile,
    { width: size, height: size, borderRadius: Math.round(size * 0.28), backgroundColor: ground }]}>
    <Icon name={name} size={Math.round(size * 0.5)} color={ink} strokeWidth={2} />
  </View>;
}

const styles = StyleSheet.create({ tile: { alignItems: 'center', justifyContent: 'center' } });
