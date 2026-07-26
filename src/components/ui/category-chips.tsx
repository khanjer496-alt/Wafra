import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { CategoryMeta } from '@/lib/categories';
import type { CategoryId } from '@/lib/types';

interface CategoryChipsProps {
  categories: CategoryMeta[];
  /** A single selection, or a set when several can be on at once. */
  selected: CategoryId | null | Set<CategoryId>;
  onToggle: (id: CategoryId) => void;
  /** `scroll` for one horizontal line, `wrap` when the full set should be visible. */
  layout?: 'scroll' | 'wrap';
}

/**
 * The category picker, in one place.
 *
 * This markup was copy-pasted into four screens, each with its own idea of what
 * a selected chip looks like. Selection is now a single rule everywhere —
 * filled ink with a reversed label — which also removes the last place where a
 * category was carrying its own hue.
 */
export function CategoryChips({
  categories,
  selected,
  onToggle,
  layout = 'scroll',
}: CategoryChipsProps) {
  const theme = useTheme();
  const isOn = (id: CategoryId) =>
    selected instanceof Set ? selected.has(id) : selected === id;

  const chips = categories.map((c) => {
    const on = isOn(c.id);
    return (
      <Pressable
        key={c.id}
        onPress={() => onToggle(c.id)}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        style={[
          styles.chip,
          {
            backgroundColor: on ? theme.text : 'transparent',
            borderColor: on ? theme.text : theme.cardBorder,
          },
        ]}>
        <Icon name={c.icon} size={13} color={on ? theme.background : theme.textSecondary} />
        <ThemedText type="meta" style={{ color: on ? theme.background : theme.text }}>
          {c.label}
        </ThemedText>
      </Pressable>
    );
  });

  if (layout === 'wrap') return <View style={styles.wrap}>{chips}</View>;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.row}>
      {chips}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: Spacing.two, paddingRight: Spacing.three },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
});
