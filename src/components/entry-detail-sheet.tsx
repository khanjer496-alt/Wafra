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
import { categoryLabel, EXPENSE_CATEGORIES, getCategory, INCOME_CATEGORIES } from '@/lib/categories';
import { formatAmount, friendlyDate, fullDateTime, parseAmountToFils, shortDate, toISODate } from '@/lib/format';
import { formatOriginalCurrency } from '@/lib/fx';
import { getActiveMarket } from '@/lib/markets';
import { useStore } from '@/lib/store';
import type { CategoryId, Transaction } from '@/lib/types';
import { t, tf } from '@/lib/i18n';

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
  const stamp = transaction ? fullDateTime(transaction) : '';
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
        tf('rememberForMerchant', { merchant }),
        sameMerchantCount > 0
          ? tf('merchantRuleAlso', {
              merchant,
              n: sameMerchantCount,
              entries: sameMerchantCount === 1 ? 'entry' : 'entries',
            })
          : tf('merchantRuleOnly', { merchant }),
        sameMerchantCount > 0
          ? [
              { text: t('no'), style: 'cancel' },
              { text: t('justFuture'), onPress: () => setMerchantOverride(merchant, category, false) },
              { text: t('yesUpdateAll'), onPress: () => setMerchantOverride(merchant, category, true) },
            ]
          : [
              { text: t('no'), style: 'cancel' },
              { text: t('remember'), onPress: () => setMerchantOverride(merchant, category, false) },
            ],
      );
    }
    onClose();
  };

  const remove = () => {
    Alert.alert(t('deleteThisEntry'), `${transaction.title} · ${formatAmount(transaction.amountFils)}`, [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: () => {
          deleteTransaction(transaction.id);
          onClose();
        },
      },
    ]);
  };

  const sourceLabel = transaction.source === 'sms' ? t('bankSmsSource') : t('addedByHand');
  const fxSourceLabel =
    transaction.fxSource === 'bank'
      ? t('bankQuotedRate')
      : transaction.fxSource === 'reference' && transaction.fxRateDate
        ? tf('datedReferenceRate', { date: shortDate(transaction.fxRateDate) })
        : t('offlineFxEstimate');

  return (
    <BottomSheet visible onClose={onClose} title={editing ? t('editEntry') : t('entryDetail')}>
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
              {t('description')}
            </ThemedText>
            <TextInput
              accessibilityLabel={t('description')}
              value={title}
              onChangeText={setTitle}
              placeholderTextColor={theme.textTertiary}
              selectionColor={theme.primary}
              style={[styles.input, { borderColor: theme.cardBorder, color: theme.text, textAlign: state.language === 'ar' ? 'right' : 'left' }]}
            />
          </View>

          <View style={styles.pairRow}>
            <View style={[styles.field, styles.flex]}>
              <ThemedText type="micro" themeColor="textTertiary">
                {t('amount')}
              </ThemedText>
              <TextInput
                accessibilityLabel={t('amount')}
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
                {/* The field edits the DAY, so it stays YYYY-MM-DD. The label
                    carries the full stamp — year included, and the clock the
                    bank sent — because that is the part the row cannot show
                    and the part that answers "which charge was this?". */}
                {t('date')} · {stamp}
              </ThemedText>
              <TextInput
                accessibilityLabel={t('date')}
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
              {t('transfersNoCategory')}
            </ThemedText>
          ) : (
            <View style={styles.field}>
              <ThemedText type="micro" themeColor="textTertiary">
                {t('category')}
              </ThemedText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {categories.map((c) => (
                  <Chip
                    key={c.id}
                    label={categoryLabel(c)}
                    active={category === c.id}
                    onPress={() => setCategory(c.id)}
                  />
                ))}
              </ScrollView>
            </View>
          )}

          <View style={styles.field}>
            <ThemedText type="micro" themeColor="textTertiary">
              {t('account')}
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
              <ThemedText type="small">{t('transferBetweenMine')}</ThemedText>
              <ThemedText type="meta" themeColor="textTertiary">
                {t('transferExplainer')}
              </ThemedText>
            </View>
            <Toggle
              value={isTransfer}
              onChange={setIsTransfer}
              label={t('transferBetweenMine')}
            />
          </View>

          <View style={styles.actions}>
            <Button inline label={t('saveChanges')} onPress={save} disabled={!canSave} />
            <Button inline variant="outline" label={t('cancel')} onPress={() => setEditing(false)} />
          </View>
        </>
      ) : (
        <>
          <LabelTable
            rows={[
              {
                label: t('category'),
                value: transaction.isTransfer ? (
                  <ThemedText type="small">{t('transferLabel')}</ThemedText>
                ) : (
                  <ThemedText
                    type="small"
                    accessibilityRole="button"
                    onPress={() => setEditing(true)}
                    style={{ color: theme.primary }}>
                    {categoryLabel(meta)}
                  </ThemedText>
                ),
              },
              {
                label: t('account'),
                value: <ThemedText type="small">{account?.name ?? t('unassigned')}</ThemedText>,
              },
              {
                label: t('source'),
                value: (
                  <ThemedText type="small">
                    {sourceLabel}
                    {transaction.source === 'sms' ? ` · ${tf('filedOn', { date: shortDate(transaction.date) })}` : ''}
                  </ThemedText>
                ),
              },
              ...(transaction.originalCurrency &&
              transaction.originalAmountMinor !== undefined &&
              transaction.fxRate !== undefined
                ? [
                    {
                      label: t('originalAmount'),
                      value: (
                        <ThemedText type="small" tabular>
                          {formatOriginalCurrency(
                            transaction.originalAmountMinor,
                            transaction.originalCurrency,
                            state.language === 'ar' ? 'ar' : 'en',
                          )}
                        </ThemedText>
                      ),
                    },
                    {
                      label: t('exchangeRate'),
                      value: (
                        <ThemedText type="small" themeColor="textSecondary">
                          {tf('fxRateValue', {
                            from: transaction.originalCurrency,
                            to: getActiveMarket().currency.code,
                            rate: transaction.fxRate.toFixed(4),
                            source: fxSourceLabel,
                          })}
                        </ThemedText>
                      ),
                    },
                  ]
                : []),
              ...(transaction.raw
                ? [
                    {
                      label: t('retainedBankMessage'),
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
                {tf('merchantCategoryRule', {
                  category: categoryLabel(meta),
                  count: sameMerchantCount,
                  merchant: transaction.title,
                  s: sameMerchantCount === 1 ? '' : 's',
                })}
              </ThemedText>
            </Block>
          )}

          <View style={styles.actions}>
            <Button inline label={t('editEntry')} onPress={() => setEditing(true)} />
            <Button inline variant="danger" label={t('delete')} onPress={remove} />
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
    paddingEnd: Spacing.three,
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
