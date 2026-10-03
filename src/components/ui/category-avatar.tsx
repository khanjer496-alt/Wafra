import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon } from '@/components/ui/icon';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getCategory } from '@/lib/categories';
import type { CategoryId } from '@/lib/types';

/**
 * Category identity is the glyph. Where a surface has a category palette (the
 * Spending donut and its list), it passes the slice colour as `color` so the
 * icon carries the same hue as the pie wedge — no separate corner dot needed,
 * because the icon itself is the colour swatch. Callers without a palette omit
 * `color` and the icon falls back to the default secondary ink.
 */
export function CategoryAvatar({ category, size = 36, color, ground }: {
  category: CategoryId;
  size?: number;
  color?: string;
  /**
   * The one glyph ground shared by every category (the sheet's
   * `glyphGround`), when the glyph stands in for a missing merchant logo:
   * the row then keeps the same tile as its neighbours with artwork. Never a
   * per-category hue.
   */
  ground?: string;
}) {
  const theme = useTheme();
  return <View style={[styles.tile, { width: size, height: size },
    ground ? { backgroundColor: ground, borderRadius: size >= 40 ? Radius.control : Radius.tile } : null]} accessible={false}>
    <Icon name={getCategory(category).icon} size={Math.round(size * 0.52)} color={color ?? (ground ? theme.text : theme.textSecondary)} strokeWidth={2} />
  </View>;
}
const styles = StyleSheet.create({ tile: { alignItems: 'center', justifyContent: 'center' } });
