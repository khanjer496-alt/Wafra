import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon } from '@/components/ui/icon';
import { useTheme } from '@/hooks/use-theme';
import { getCategory } from '@/lib/categories';
import type { CategoryId } from '@/lib/types';

/** Category identity is the glyph, never a separate competing palette. */
export function CategoryAvatar({ category, size = 36 }: { category: CategoryId; size?: number }) {
  const theme = useTheme();
  return <View style={[styles.tile, { width: size, height: size }]} accessible={false}>
    <Icon name={getCategory(category).icon} size={Math.round(size * 0.52)} color={theme.textSecondary} strokeWidth={1.8} />
  </View>;
}
const styles = StyleSheet.create({ tile: { alignItems: 'center', justifyContent: 'center' } });
