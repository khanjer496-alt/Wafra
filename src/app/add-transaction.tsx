import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Icon } from '@/components/ui/icon';
import { CategoryChips } from '@/components/ui/category-chips';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { EXPENSE_CATEGORIES, getCategory, INCOME_CATEGORIES } from '@/lib/categories';
import { parseAmountToFils, toISODate } from '@/lib/format';
import { committed } from '@/lib/haptics';
import { useStore } from '@/lib/store';
import type { CategoryId, TransactionType } from '@/lib/types';

export default function AddTransactionScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { state, addTransaction } = useStore();

  const [type, setType] = useState<TransactionType>('expense');
  const [amountText, setAmountText] = useState('');
  const [category, setCategory] = useState<CategoryId>('groceries');
  const [accountId, setAccountId] = useState(state.accounts[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [dayOffset, setDayOffset] = useState(0);

  const categories = type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  const amountFils = parseAmountToFils(amountText);
  const canSave = !!amountFils && !!accountId;

  const date = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - dayOffset);
    return toISODate(d);
  }, [dayOffset]);

  const switchType = (t: TransactionType) => {
    setType(t);
    setCategory(t === 'expense' ? 'groceries' : 'salary');
  };

  const save = () => {
    if (!amountFils || !accountId) return;
    committed();
    addTransaction({
      type,
      amountFils,
      category,
      accountId,
      title: title.trim() || getCategory(category).label,
      date,
      source: 'manual',
    });
    router.back();
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.header}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={() => router.back()}
              style={[styles.closeBtn, { backgroundColor: theme.backgroundSelected }]}>
              <Icon name="close" size={18} color={theme.text} />
            </Pressable>
            <ThemedText type="smallBold" style={styles.headerTitle}>
              New transaction
            </ThemedText>
            <View style={styles.closeBtn} />
          </View>

          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {/* Type switch */}
            <View style={[styles.segment, { backgroundColor: theme.backgroundSelected }]}>
              {(['expense', 'income'] as TransactionType[]).map((t) => {
                const active = type === t;
                const color = t === 'expense' ? theme.expense : theme.income;
                return (
                  <Pressable
                    key={t}
                    onPress={() => switchType(t)}
                    style={[
                      styles.segmentItem,
                      active && { backgroundColor: theme.card, borderColor: color },
                    ]}>
                    <ThemedText
                      type="smallBold"
                      style={{ color: active ? color : theme.textSecondary }}>
                      {t === 'expense' ? '− Expense' : '+ Income'}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>

            {/* Amount */}
            <View style={styles.amountWrap}>
              <ThemedText type="smallBold" themeColor="textSecondary" style={styles.currency}>
                AED
              </ThemedText>
              <TextInput
                value={amountText}
                onChangeText={setAmountText}
                keyboardType="decimal-pad"
                placeholder="0"
                autoFocus
                placeholderTextColor={theme.textSecondary}
                style={[styles.amountInput, { color: theme.text }]}
              />
            </View>

            {/* Category grid */}
            <View style={styles.fieldBlock}>
              <ThemedText type="small" themeColor="textSecondary">Category</ThemedText>
              <CategoryChips
                categories={categories}
                selected={category}
                onToggle={setCategory}
                layout="wrap"
              />
            </View>

            {/* Account */}
            <View style={styles.fieldBlock}>
              <ThemedText type="small" themeColor="textSecondary">Account</ThemedText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.accountRow}>
                {state.accounts.map((a) => {
                  const active = accountId === a.id;
                  return (
                    <Pressable
                      key={a.id}
                      onPress={() => setAccountId(a.id)}
                      style={[
                        styles.accountChip,
                        {
                          backgroundColor: active ? `${a.color}26` : theme.backgroundElement,
                          borderColor: active ? a.color : theme.cardBorder,
                        },
                      ]}>
                      <View style={[styles.accountDot, { backgroundColor: a.color }]} />
                      <ThemedText type="small">{a.name}</ThemedText>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            {/* Date quick-pick */}
            <View style={styles.fieldBlock}>
              <ThemedText type="small" themeColor="textSecondary">When</ThemedText>
              <View style={styles.dateRow}>
                {[
                  { label: 'Today', offset: 0 },
                  { label: 'Yesterday', offset: 1 },
                  { label: '2 days ago', offset: 2 },
                  { label: '3 days ago', offset: 3 },
                ].map((d) => {
                  const active = dayOffset === d.offset;
                  return (
                    <Pressable
                      key={d.offset}
                      onPress={() => setDayOffset(d.offset)}
                      style={[
                        styles.dateChip,
                        {
                          backgroundColor: active ? `${theme.primary}22` : theme.backgroundElement,
                          borderColor: active ? theme.primary : theme.cardBorder,
                        },
                      ]}>
                      <ThemedText type="small">{d.label}</ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Title */}
            <View style={styles.fieldBlock}>
              <ThemedText type="small" themeColor="textSecondary">Description (optional)</ThemedText>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder={`e.g. ${type === 'expense' ? 'Carrefour weekly shop' : 'July salary'}`}
                placeholderTextColor={theme.textSecondary}
                style={[
                  styles.titleInput,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.cardBorder,
                    color: theme.text,
                  },
                ]}
              />
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              onPress={save}
              disabled={!canSave}
              style={[
                styles.saveBtn,
                { backgroundColor: theme.primary, opacity: canSave ? 1 : 0.4 },
              ]}>
              <Icon name="check" size={20} color={theme.onPrimary} strokeWidth={2.6} />
              <ThemedText type="smallBold" style={{ color: theme.onPrimary, fontSize: 16 }}>
                Save transaction
              </ThemedText>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
  },
  safe: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  headerTitle: {
    fontSize: 16,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: Spacing.three,
    gap: Spacing.four,
  },
  segment: {
    flexDirection: 'row',
    borderRadius: Radius.md,
    padding: 4,
    gap: 4,
  },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two + 2,
    borderRadius: Radius.md - 4,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  amountWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  currency: {
    fontSize: 18,
  },
  amountInput: {
    fontSize: 52,
    fontWeight: '800',
    minWidth: 120,
    textAlign: 'center',
    padding: 0,
  },
  fieldBlock: {
    gap: Spacing.two,
  },
  catGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  catChip: {
    paddingHorizontal: Spacing.two + 4,
    paddingVertical: Spacing.two,
    borderRadius: Radius.full,
    borderWidth: 1.5,
  },
  accountRow: {
    gap: Spacing.two,
  },
  accountChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two + 4,
    paddingVertical: Spacing.two,
    borderRadius: Radius.full,
    borderWidth: 1.5,
  },
  accountDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dateRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  dateChip: {
    paddingHorizontal: Spacing.two + 4,
    paddingVertical: Spacing.two,
    borderRadius: Radius.full,
    borderWidth: 1.5,
  },
  titleInput: {
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 15,
    fontWeight: '500',
  },
  footer: {
    padding: Spacing.three,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderRadius: Radius.md + 2,
    paddingVertical: Spacing.three + 2,
  },
});
