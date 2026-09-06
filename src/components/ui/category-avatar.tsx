import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon } from '@/components/ui/icon';
import { Colors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getCategory } from '@/lib/categories';
import type { CategoryId } from '@/lib/types';

/** Stable, muted identity tints. Budget progress colours still describe health, not category. */
const tones = {
  peach: { light: ['#FBE9DD', '#975333'], dark: ['#4C352E', '#F4B89A'] },
  blue: { light: ['#E3F0FC', '#285F98'], dark: ['#213C48', '#A3CDEC'] },
  green: { light: ['#E1F1E7', '#1D7450'], dark: ['#20483A', '#A2DBBA'] },
  purple: { light: ['#EDE5F8', '#74539F'], dark: ['#3C3249', '#CAB2E7'] },
  rose: { light: ['#FAE3E5', '#A1445A'], dark: ['#4D303A', '#ECB1BF'] },
  sand: { light: ['#F5EBDC', '#8F6636'], dark: ['#463E2D', '#E6CCA0'] },
} as const;
const categoryTones: Partial<Record<CategoryId, keyof typeof tones>> = {
  rent: 'rose', dining: 'peach', groceries: 'green', utilities: 'green', telecom: 'blue', transport: 'blue',
  shopping: 'sand', entertainment: 'purple', software: 'purple', health: 'rose', 'personal-care': 'rose',
  'home-services': 'sand', travel: 'blue', education: 'purple', charity: 'peach', salary: 'green', business: 'green',
};
export function CategoryAvatar({ category, size = 36 }: { category: CategoryId; size?: number }) {
  const theme = useTheme(); const meta = getCategory(category);
  const tone = categoryTones[category];
  const colors = tone ? tones[tone][theme.background === Colors.dark.background ? 'dark' : 'light'] : [theme.backgroundSelected, theme.textSecondary];
  return <View style={[styles.tile, { width: size, height: size, borderRadius: size / 2, backgroundColor: colors[0] }]}>
    <Icon name={meta.icon} size={Math.round(size * 0.48)} color={colors[1]} strokeWidth={1.8} />
  </View>;
}
const styles = StyleSheet.create({ tile: { alignItems: 'center', justifyContent: 'center' } });
