import { useCategoryCatalog } from '@/hooks/use-category-catalog';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Radius, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { tapped } from '@/lib/haptics';
import { type CategoryMeta } from '@/lib/categories';
import { TextField } from '@/components/ui/text-field';
import { EButton } from '@/components/ui/band/e-button';
import { useBand } from '@/hooks/use-band';
import { useStoreActions } from '@/lib/store';
import { customCategoryCopy } from '@/lib/custom-category-copy';
import type { CategoryId, TransactionType } from '@/lib/types';

interface CategoryChipsProps {
  categories: CategoryMeta[];
  /** A single selection, or a set when several can be on at once. */
  selected: CategoryId | null | Set<CategoryId>;
  onToggle: (id: CategoryId) => void;
  /** `scroll` for one horizontal line, `wrap` when the full set should be visible. */
  layout?: 'scroll' | 'wrap';
  /** Editing pickers may create a category; filters only select existing ones. */
  createType?: TransactionType;
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
  createType,
}: CategoryChipsProps) {
  const { categoryLabel } = useCategoryCatalog();
  const theme = useTheme();
  const language = useLanguage();
  const band = useBand('spending');
  const { createCustomCategory } = useStoreActions();
  const copy = customCategoryCopy[language];
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const saving = useRef(false);
  const create = () => {
    if (!createType || saving.current) return;
    saving.current = true;
    try {
      const result = createCustomCategory(name, createType);
      if (!result.ok) { setError(copy.errors[result.reason]); return; }
      setCreating(false); setName(''); setError(undefined);
      onToggle(result.id);
    } finally { saving.current = false; }
  };
  const isOn = (id: CategoryId) =>
    selected instanceof Set ? selected.has(id) : selected === id;

  /**
   * Scroll the selected chip into view.
   *
   * Opening a Shopping entry showed Groceries, Dining, Transport, Utilities
   * and nothing selected — the current category was off the right edge, so the
   * editor looked like it had lost the value it was editing. Each chip reports
   * its own offset as it lays out; the single-selection case scrolls to it.
   */
  const scroller = useRef<ScrollView>(null);
  const offsets = useRef(new Map<CategoryId, number>());
  const single = selected instanceof Set ? null : selected;

  const remember = useCallback((id: CategoryId, x: number) => {
    offsets.current.set(id, x);
  }, []);

  useEffect(() => {
    if (layout !== 'scroll' || !single) return;
    // After layout, or the offset is not there yet on first render.
    const id = setTimeout(() => {
      const x = offsets.current.get(single);
      if (x === undefined) return;
      scroller.current?.scrollTo({ x: Math.max(0, x - 16), animated: false });
    }, 0);
    return () => clearTimeout(id);
  }, [single, layout]);

  const chips = categories.map((c) => {
    const on = isOn(c.id);
    const label = categoryLabel(c, language);
    return (
      <Pressable
        key={c.id}
        onPress={() => {
          tapped();
          onToggle(c.id);
        }}
        onLayout={(e) => remember(c.id, e.nativeEvent.layout.x)}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: on }}
        aria-pressed={on}
        style={[
          styles.chip,
          {
            backgroundColor: on ? theme.text : 'transparent',
            borderColor: on ? theme.text : theme.controlBorder,
          },
        ]}>
        <Icon name={c.icon} size={13} color={on ? theme.background : theme.textSecondary} />
        <ThemedText type="meta" style={{ color: on ? theme.background : theme.text }}>
          {label}
        </ThemedText>
      </Pressable>
    );
  });

  const add = createType ? <Pressable key="create" accessibilityRole="button"
    accessibilityLabel={copy.newCategory} testID="category-create-open"
    onPress={() => { setCreating(true); setError(undefined); }}
    style={[styles.chip, { borderColor: theme.controlBorder }]}>
    <Icon name="plus" size={13} color={theme.textSecondary} />
    <ThemedText type="meta">{copy.newCategory}</ThemedText>
  </Pressable> : null;

  return <View style={{ gap: Spacing.three }}>
    {layout === 'wrap' ? <View style={styles.wrap}>{chips}{add}</View> : (
      <ScrollView ref={scroller} horizontal showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled" contentContainerStyle={styles.row}>
        {chips}{add}
      </ScrollView>
    )}
    {creating && createType ? <View style={{ gap: Spacing.three }} testID="category-create-form">
      <TextField label={copy.name} value={name} onChangeText={(value) => { setName(value); setError(undefined); }}
        autoFocus maxLength={80} helperText={copy.hint} errorText={error}
        testID="category-create-name" returnKeyType="done" onSubmitEditing={create} />
      <EButton palette={band} label={copy.create} onPress={create} disabled={!name.trim()} testID="category-create-save" />
      <EButton palette={band} variant="quiet" label={copy.cancel}
        onPress={() => { setCreating(false); setName(''); setError(undefined); }} />
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  row: { gap: Spacing.two, paddingEnd: Spacing.three },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    gap: 6,
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
});
