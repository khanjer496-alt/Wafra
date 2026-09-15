import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon } from '@/components/ui/icon';
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
export function CategoryAvatar({ category, size = 36, color }: { category: CategoryId; size?: number; color?: string }) {
  const theme = useTheme();
  return <View style={[styles.tile, { width: size, height: size }]} accessible={false}>
    <Icon name={getCategory(category).icon} size={Math.round(size * 0.52)} color={color ?? theme.textSecondary} strokeWidth={2} />
  </View>;
}
const styles = StyleSheet.create({ tile: { alignItems: 'center', justifyContent: 'center' } });
