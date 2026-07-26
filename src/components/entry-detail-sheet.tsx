import React, { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button, Chip, Toggle } from '@/components/ui/controls';
import { Block, LabelTable } from '@/components/ui/layout';
import { Money } from '@/components/ui/money';
import { CategoryTile } from '@/components/ui/tile';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { EXPENSE_CATEGORIES, getCategory, INCOME_CATEGORIES } from '@/lib/categories';
import { formatAmount, friendlyDate, parseAmountToFils, shortDate, toISODate } from '@/lib/format';
import { useStore } from '@/lib/store';
import type { CategoryId, Transaction } from '@/lib/types';

interface EntryDetailSheetProps {
  /** The entry to show, or null to keep the sheet closed. */
  transaction: Transaction | null;
  onClose: () => void;
}

/**
 * One entry, read before it is written.
 *
 * The old sheet opened straight into a form, so the commonest reason to tap a
 * row — "what actually was this?" — was answered by six input boxes. Reading
 * comes first now; editing is one tap away.
 */
export function EntryDetailSheet({ transaction, onClose }: EntryDetailSheetProps) {
  const theme = useTheme();
  const { state, editTransaction, deleteTransaction, setMerchantOverride } = useStore();
  const [editing, setEditing] = useState(false);

  const [title, setTitle] = useState('');
  const [amountText, setAmountText] = useState('');
  const [category, setCategory] = useState<CategoryId>('other');
  const [accountId, setAccountId] = useState('');
  const [dateText, setDateText] = useState('');
  const [isTransfer, setIsTransfer] = useState(false);

  useEffect(() => {
    if (!transaction) return;
    setEditing(false);
    setTitle(transaction.title);
    // The FULL amount, fils included. Seeding the field from the display
    // string — which hides the fils — meant opening an entry and saving any
    // other change rewrote its amount: AED 76.99 came back as 77, and the row
    // was stamped userEdited, so no re-parse could ever heal it. Below a
    // dirham it was worse; 0.49 seeded "0", which fails validation, and the
    // entry could not be saved at all.
    setAmountText(formatAmount(transaction.amountFils, { decimals: true }).replace(/,/g, ''));
    setCategory(transaction.category);
    setAccountId(transaction.accountId);
    setDateText(transaction.date);
    setIsTransfer(!!transaction.isTransfer);
  }, [transaction]);

  const sameMerchantCount = useMemo(() => {
    if (!transaction) return 0;
    const key = transaction.title.trim().toLowerCase();
    if (key.length < 3) return 0;
    return state.transactions.filter(
      (t) => t.id !== transaction.id && t.title.trim().toLowerCase() === key,
    ).length;
  }, [transaction, state.transactions]);

  if (!transaction) return null;

  const meta = getCategory(transaction.category);
  const account = state.accounts.find((a) => a.id === transaction.accountId);
  const income = transaction.type === 'income';
  const categories = income ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  const amountFils = parseAmountToFils(amountText);
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(dateText);
  const canSave = !!amountFils && !!title.trim() && dateValid;

  const save = () => {
    if (!canSave || !amountFils) return;
    const categoryChanged = category !== transaction.category;
    editTransaction(transaction.id, {
      title: title.trim(),
      amountFils,
      category,
      accountId,
      date: dateText,
      isTransfer: isTransfer || undefined,
    });
    const merchant = title.trim();
    if (categoryChanged && merchant.length > 2) {
      Alert.alert(
        `Remember for ${merchant}?`,
        sameMerchantCount > 0
          ? `Future imports from ${merchant} will use this category. Also update ${sameMerchantCount} existing entr${sameMerchantCount === 1 ? 'y' : 'ies'}?`
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
    Alert.alert('Delete this entry?', `${transaction.title} · ${formatAmount(transaction.amountFils)}`, [
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

  const sourceLabel = transaction.source === 'sms' ? 'Bank SMS' : 'Added by hand';

  return (
    <BottomSheet visible onClose={onClose} title={editing ? 'Edit entry' : 'Entry detail'}>
      <View style={styles.head}>
        <CategoryTile category={transaction.category} size={46} />
        <View style={styles.headText}>
          <ThemedText type="subtitle" numberOfLines={1}>
            {transaction.title}
          </ThemedText>
          <ThemedText type="meta" themeColor="textTertiary">
            {friendlyDate(transaction.date, toISODate(new Date()))}
          </ThemedText>
        </View>
        {/* Decimals on. This sheet exists to answer "what exactly was this",
            and it sat above an edit field showing 72.73 while itself reading
            −73. Lists round; the place you go to check does not. */}
        <Money
          fils={transaction.amountFils}
          type="sheetAmount"
          sign={income ? 'plus' : 'minus'}
          prefix={false}
          decimals
          color={income ? theme.income : theme.text}
          style={styles.headAmount}
        />
      </View>

      {editing ? (
        <>
          <View style={styles.field}>
            <ThemedText type="micro" themeColor="textTertiary">
              Description
            </ThemedText>
            <TextInput
              accessibilityLabel="Description"
              value={title}
              onChangeText={setTitle}
              placeholderTextColor={theme.textTertiary}
              selectionColor={theme.primary}
              style={[styles.input, { borderColor: theme.cardBorder, color: theme.text }]}
            />
          </View>

          <View style={styles.pairRow}>
            <View style={[styles.field, styles.flex]}>
              <ThemedText type="micro" themeColor="textTertiary">
                Amount
              </ThemedText>
              <TextInput
                accessibilityLabel="Amount"
                value={amountText}
                onChangeText={setAmountText}
                keyboardType="decimal-pad"
                selectionColor={theme.primary}
                style={[
                  styles.input,
                  styles.mono,
                  { borderColor: theme.cardBorder, color: amountFils ? theme.text : theme.expense },
                ]}
              />
            </View>
            <View style={[styles.field, styles.flex]}>
              <ThemedText type="micro" themeColor="textTertiary">
                Date
              </ThemedText>
              <TextInput
                accessibilityLabel="Date"
                value={dateText}
                onChangeText={setDateText}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={theme.textTertiary}
                selectionColor={theme.primary}
                style={[
                  styles.input,
                  styles.mono,
                  { borderColor: theme.cardBorder, color: dateValid ? theme.text : theme.expense },
                ]}
              />
            </View>
          </View>

          {/* A transfer settles a balance rather than buying anything, so it
              has no spending category and is excluded from every total. */}
          {isTransfer ? (
            <ThemedText type="default" themeColor="textSecondary">
              Transfers have no category — this moves money between your own accounts rather than
              spending it.
            </ThemedText>
          ) : (
            <View style={styles.field}>
              <ThemedText type="micro" themeColor="textTertiary">
                Category
              </ThemedText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {categories.map((c) => (
                  <Chip
                    key={c.id}
                    label={c.label}
                    active={category === c.id}
                    onPress={() => setCategory(c.id)}
                  />
                ))}
              </ScrollView>
            </View>
          )}

          <View style={styles.field}>
            <ThemedText type="micro" themeColor="textTertiary">
              Account
            </ThemedText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {state.accounts.map((a) => (
                <Chip
                  key={a.id}
                  label={a.name}
                  active={accountId === a.id}
                  onPress={() => setAccountId(a.id)}
                />
              ))}
            </ScrollView>
          </View>

          <View style={styles.transferRow}>
            <View style={styles.flex}>
              <ThemedText type="small">Transfer between my accounts</ThemedText>
              <ThemedText type="meta" themeColor="textTertiary">
                Kept in balances, excluded from income and spending
              </ThemedText>
            </View>
            <Toggle
              value={isTransfer}
              onChange={setIsTransfer}
              label="Transfer between my accounts"
            />
          </View>

          <View style={styles.actions}>
            <Button inline label="Save changes" onPress={save} disabled={!canSave} />
            <Button inline variant="outline" label="Cancel" onPress={() => setEditing(false)} />
          </View>
        </>
      ) : (
        <>
          <LabelTable
            rows={[
              {
                label: 'Category',
                value: transaction.isTransfer ? (
                  <ThemedText type="small">Transfer</ThemedText>
                ) : (
                  <ThemedText
                    type="small"
                    accessibilityRole="button"
                    onPress={() => setEditing(true)}
                    style={{ color: theme.primary }}>
                    {meta.label}
                  </ThemedText>
                ),
              },
              {
                label: 'Account',
                value: <ThemedText type="small">{account?.name ?? 'Unassigned'}</ThemedText>,
              },
              {
                label: 'Source',
                value: (
                  <ThemedText type="small">
                    {sourceLabel}
                    {transaction.source === 'sms' ? ` · filed ${shortDate(transaction.date)}` : ''}
                  </ThemedText>
                ),
              },
              ...(transaction.raw
                ? [
                    {
                      label: 'Original',
                      value: (
                        <ThemedText type="default" themeColor="textSecondary" style={styles.raw}>
                          “{transaction.raw}”
                        </ThemedText>
                      ),
                    },
                  ]
                : []),
            ]}
          />

          {/* The merchant override already exists in the store; this is the
              one place the user can see what it will do before using it. */}
          {!transaction.isTransfer && sameMerchantCount > 0 && (
            <Block>
              <ThemedText type="default" themeColor="textSecondary">
                This merchant is always {meta.label} — change it once and the other{' '}
                {sameMerchantCount} {transaction.title} charge{sameMerchantCount === 1 ? '' : 's'}{' '}
                follow.
              </ThemedText>
            </Block>
          )}

          <View style={styles.actions}>
            <Button inline label="Edit entry" onPress={() => setEditing(true)} />
            <Button inline variant="danger" label="Delete" onPress={remove} />
          </View>
        </>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three - 2,
  },
  headText: {
    flex: 1,
    gap: Spacing.half,
  },
  headAmount: {
    alignSelf: 'center',
  },
  field: {
    gap: Spacing.two,
  },
  flex: {
    flex: 1,
  },
  pairRow: {
    flexDirection: 'row',
    gap: Spacing.two + 2,
  },
  input: {
    borderWidth: 1,
    borderRadius: Radius.control,
    paddingHorizontal: Spacing.three - 4,
    paddingVertical: Spacing.three - 5,
    fontSize: 15,
  },
  mono: {
    fontVariant: ['tabular-nums'],
  },
  chipRow: {
    gap: Spacing.two,
    paddingRight: Spacing.three,
  },
  transferRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two + 2,
  },
  raw: {
    fontSize: 12.5,
    lineHeight: 18,
  },
});
