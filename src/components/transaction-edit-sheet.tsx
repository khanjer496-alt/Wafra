import React, { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/lib/categories';
import { formatAmount, parseAmountToFils } from '@/lib/format';
import { useStore } from '@/lib/store';
import type { CategoryId, Transaction } from '@/lib/types';

interface TransactionEditSheetProps {
  transaction: Transaction | null;
  onClose: () => void;
}

/** Bottom sheet for editing any field of a transaction, with merchant learning. */
export function TransactionEditSheet({ transaction, onClose }: TransactionEditSheetProps) {
  const theme = useTheme();
  const { state, editTransaction, deleteTransaction, setMerchantOverride } = useStore();

  const [title, setTitle] = useState('');
  const [amountText, setAmountText] = useState('');
  const [category, setCategory] = useState<CategoryId>('other');
  const [accountId, setAccountId] = useState('');
  const [dateText, setDateText] = useState('');
  const [isTransfer, setIsTransfer] = useState(false);

  useEffect(() => {
    if (!transaction) return;
    setTitle(transaction.title);
    setAmountText(formatAmount(transaction.amountFils, { decimals: false }).replace(/,/g, ''));
    setCategory(transaction.category);
    setAccountId(transaction.accountId);
    setDateText(transaction.date);
    setIsTransfer(!!transaction.isTransfer);
  }, [transaction]);

  if (!transaction) return null;

  const categories = transaction.type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  const amountFils = parseAmountToFils(amountText);
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(dateText);
  const canSave = !!amountFils && !!title.trim() && dateValid;
  const categoryChanged = category !== transaction.category;

  const save = () => {
    if (!canSave || !amountFils) return;
    editTransaction(transaction.id, {
      title: title.trim(),
      amountFils,
      category,
      accountId,
      date: dateText,
      isTransfer: isTransfer || undefined,
    });
    const merchant = title.trim();
    if (categoryChanged && merchant && merchant.length > 2) {
      const sameMerchantCount = state.transactions.filter(
        (t) => t.id !== transaction.id && t.title.trim().toLowerCase() === merchant.toLowerCase(),
      ).length;
      Alert.alert(
        `Remember for ${merchant}?`,
        sameMerchantCount > 0
          ? `Future imports from ${merchant} will use this category. Also update ${sameMerchantCount} existing transaction${sameMerchantCount === 1 ? '' : 's'}?`
          : `Future imports from ${merchant} will use this category.`,
        sameMerchantCount > 0
          ? [
              { text: 'No', style: 'cancel' },
              { text: 'Just future', onPress: () => setMerchantOverride(merchant, category, false) },
              { text: 'Yes, update all', onPress: () => setMerchantOverride(merchant, category, true) },
            ]
          : [
              { text: 'No', style: 'cancel' },
              { text: 'Remember', onPress: () => setMerchantOverride(merchant, category, false) },
            ],
      );
    }
    onClose();
  };

  const remove = () => {
    Alert.alert('Delete transaction?', `${transaction.title} · ${formatAmount(transaction.amountFils)}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteTransaction(transaction.id);
          onClose();
        },
      },
    ]);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}
          onPress={() => {}}>
          <View style={[styles.grabber, { backgroundColor: theme.cardBorder }]} />
          <View style={styles.sheetHeader}>
            <ThemedText type="heading">Edit transaction</ThemedText>
            <Pressable onPress={remove} hitSlop={8}>
              <Icon name="trash" size={19} color={theme.expense} />
            </Pressable>
          </View>

          <View style={styles.inputRow}>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Description"
              placeholderTextColor={theme.textSecondary}
              style={[
                styles.input,
                styles.titleInput,
                { backgroundColor: theme.backgroundSelected, color: theme.text },
              ]}
            />
          </View>

          <View style={styles.inputRow}>
            <View style={[styles.amountBox, { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText type="smallBold" themeColor="textSecondary">AED</ThemedText>
              <TextInput
                value={amountText}
                onChangeText={setAmountText}
                keyboardType="decimal-pad"
                placeholderTextColor={theme.textSecondary}
                style={[styles.amountInput, { color: theme.text }]}
              />
            </View>
            <TextInput
              value={dateText}
              onChangeText={setDateText}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={theme.textSecondary}
              style={[
                styles.input,
                styles.dateInput,
                {
                  backgroundColor: theme.backgroundSelected,
                  color: dateValid ? theme.text : theme.expense,
                },
              ]}
            />
          </View>

          {/* A transfer has no spending category — it settles a balance rather
              than buying anything, and it is excluded from every total. Asking
              for one and showing "Other" selected made a correctly handled card
              payment look miscategorised. */}
          {isTransfer ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.transferNote}>
              Transfers have no category — this moves money between your own
              accounts rather than spending it.
            </ThemedText>
          ) : (
            <>
          <ThemedText type="micro" themeColor="textSecondary">Category</ThemedText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {categories.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => setCategory(c.id)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: category === c.id ? `${c.color}2c` : theme.backgroundSelected,
                    borderColor: category === c.id ? c.color : 'transparent',
                  },
                ]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <Icon name={c.icon} size={13} color={c.color} />
                    <ThemedText type="small">{c.label}</ThemedText>
                  </View>
              </Pressable>
            ))}
          </ScrollView>
            </>
          )}

          <ThemedText type="micro" themeColor="textSecondary">Account</ThemedText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {state.accounts.map((a) => (
              <Pressable
                key={a.id}
                onPress={() => setAccountId(a.id)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: accountId === a.id ? `${a.color}26` : theme.backgroundSelected,
                    borderColor: accountId === a.id ? a.color : 'transparent',
                  },
                ]}>
                <ThemedText type="small">{a.name}</ThemedText>
              </Pressable>
            ))}
          </ScrollView>

          <Pressable
            onPress={() => setIsTransfer(!isTransfer)}
            style={[
              styles.transferRow,
              {
                backgroundColor: isTransfer ? `${theme.primary}18` : theme.backgroundSelected,
                borderColor: isTransfer ? theme.primary : 'transparent',
              },
            ]}>
            <Icon
              name={isTransfer ? 'check' : 'repeat'}
              size={16}
              color={isTransfer ? theme.primary : theme.textSecondary}
              strokeWidth={2.2}
            />
            <View style={styles.transferText}>
              <ThemedText type="smallBold">Transfer between my accounts</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Kept in balances, excluded from income and spending
              </ThemedText>
            </View>
          </Pressable>

          <Pressable
            onPress={save}
            disabled={!canSave}
            style={[styles.saveBtn, { backgroundColor: theme.primary, opacity: canSave ? 1 : 0.45 }]}>
            <Icon name="check" size={18} color={theme.onPrimary} strokeWidth={2.6} />
            <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>Save changes</ThemedText>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(7, 15, 12, 0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.four,
    paddingBottom: Spacing.five,
    gap: Spacing.two + 2,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginTop: -Spacing.two,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  inputRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  input: {
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 4,
    fontSize: 15,
    fontWeight: '600',
  },
  titleInput: {
    flex: 1,
  },
  dateInput: {
    flex: 1,
  },
  amountBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
  },
  amountInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    paddingVertical: Spacing.two + 4,
  },
  transferNote: { paddingVertical: 2 },
  chipRow: {
    gap: Spacing.two,
  },
  chip: {
    paddingHorizontal: Spacing.two + 4,
    paddingVertical: Spacing.two,
    borderRadius: Radius.full,
    borderWidth: 1.5,
  },
  transferRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
  },
  transferText: {
    flex: 1,
    gap: 1,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderRadius: Radius.md,
    paddingVertical: Spacing.three,
    marginTop: Spacing.one,
  },
});
