import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { ChoiceSheet } from '@/components/ui/choice-sheet';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Button, Chip, Toggle } from '@/components/ui/controls';
import { Block, LabelTable } from '@/components/ui/layout';
import { Money } from '@/components/ui/money';
import { CategoryTile } from '@/components/ui/tile';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { categoryLabel, EXPENSE_CATEGORIES, getCategory, INCOME_CATEGORIES } from '@/lib/categories';
import { formatAmount, friendlyDate, fullDateTime, parseAmountToFils, shortDate, toISODate } from '@/lib/format';
import { formatOriginalCurrency } from '@/lib/fx';
import { ledgerCurrencyCode } from '@/lib/markets';
import { overrideFitsDirection } from '@/lib/sms-parser';
import { useStore } from '@/lib/store';
import { overrideAppliesTo } from '@/lib/uncategorised';
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

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  /**
   * The merchant-rule question, frozen at the moment Save was pressed.
   *
   * It is a snapshot rather than a read of the live fields because the edit has
   * already been filed by then: `sameMerchantCount` recomputes off the new
   * store, and the sheet would be offering to move a number that had already
   * moved underneath it.
   */
  const [ruleAsk, setRuleAsk] = useState<{
    merchant: string;
    category: CategoryId;
    count: number;
  } | null>(null);

  useEffect(() => {
    if (!transaction) return;
    setEditing(false);
    setConfirmingDelete(false);
    setRuleAsk(null);
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

  /**
   * How many OTHER entries "yes, update all" would move.
   *
   * Two things this is careful about, both of which it used to get wrong:
   *
   * 1. It counts through `overrideAppliesTo` — the same predicate the
   *    `setMerchantOverride` reducer applies — rather than matching the bare
   *    key. A plain key match counted rows the rule must not touch (income
   *    refunds, hand-filed decisions, transfer legs) and would have gone on
   *    over-reporting the moment the reducer started filtering.
   * 2. It keys on the title as it stands in the FIELD, not as it arrived. The
   *    rule `save` writes is keyed on the edited name, so counting the old one
   *    described a different merchant than the button acted on. Outside edit
   *    mode the two are the same string, seeded above.
   *
   * The row being edited is excluded by id because the prompt says "also
   * update N entries"; its own category is already applied by the edit.
   */
  const sameMerchantCount = useMemo(() => {
    if (!transaction) return 0;
    const key = title.trim().toLowerCase();
    if (key.length < 3) return 0;
    // 3. An income category moves nothing. `overrideAppliesTo` is expense-only
    //    and `overrideFitsDirection` says an income category may not decide an
    //    expense row, so the reducer now declines the bulk rewrite outright.
    //    Without this the sheet offered "also update 5 entries" over a rule
    //    that reaches none of them.
    if (!overrideFitsDirection(category, 'expense')) return 0;
    return state.transactions.filter(
      (t) => t.id !== transaction.id && overrideAppliesTo(t, key),
    ).length;
  }, [transaction, title, category, state.transactions]);

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
    const receiptAccountChanged =
      transaction.paymentFlowSide === 'receipt' && accountId !== transaction.accountId;
    editTransaction(transaction.id, {
      title: title.trim(),
      amountFils,
      category,
      accountId,
      date: dateText,
      isTransfer: isTransfer || undefined,
      ...(receiptAccountChanged ? { paymentInstrumentSource: 'user' as const } : {}),
    });
    const merchant = title.trim();
    if (categoryChanged && merchant.length > 2) {
      // The rule question is drawn from inside this sheet now, so the sheet
      // cannot close first the way it did when the question was an OS dialog
      // that outlived it. It closes when the question is answered — or
      // dismissed, which is the "No" the alert used to spell out.
      setRuleAsk({ merchant, category, count: sameMerchantCount });
      return;
    }
    onClose();
  };

  // Answering the rule question — either way — finishes the save, so it closes
  // the whole sheet. ChoiceSheet and ConfirmSheet both run `onClose` before
  // they commit, so the store call lands after this sheet is on its way out.
  const closeRule = () => {
    setRuleAsk(null);
    onClose();
  };

  const removeEntry = () => {
    deleteTransaction(transaction.id);
    onClose();
  };

  const sourceLabel = transaction.source === 'sms' ? t('bankSmsSource') : t('addedByHand');
  const fxSourceLabel =
    transaction.fxSource === 'bank'
      ? tf('bankQuotedRate', { currency: ledgerCurrencyCode() })
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
              style={[styles.input, { borderColor: theme.controlBorder, color: theme.text, textAlign: state.language === 'ar' ? 'right' : 'left' }]}
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
                  { borderColor: theme.controlBorder, color: amountFils ? theme.text : theme.expense },
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
                  { borderColor: theme.controlBorder, color: dateValid ? theme.text : theme.expense },
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
                            to: ledgerCurrencyCode(),
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
            <Button
              inline
              variant="danger"
              label={t('delete')}
              onPress={() => setConfirmingDelete(true)}
            />
          </View>
        </>
      )}

      {/* Both of these are nested inside this sheet rather than rendered beside
          it: a Modal presented from within the presented one stacks, where
          dismissing this sheet and presenting another in the same frame does
          not. Each is mounted only while it has something to ask, so the entry
          animation runs on every open. */}
      {confirmingDelete && (
        <ConfirmSheet
          visible
          onClose={() => setConfirmingDelete(false)}
          question={t('deleteThisEntry')}
          body={`${transaction.title} · ${formatAmount(transaction.amountFils)}`}
          confirmLabel={t('delete')}
          destructive
          onConfirm={removeEntry}
        />
      )}

      {/* Two shapes, because the alert had two: with other entries to move it
          is a choice between two rules, and with none it is a plain yes/no. */}
      {ruleAsk && ruleAsk.count > 0 && (
        <ChoiceSheet
          visible
          onClose={closeRule}
          // The caps header names the thing being decided; the question goes
          // in sentence case underneath. Passed as `title` it rendered as
          // "REMEMBER FOR CARREFOUR?", which the copy never asked to be.
          title={t('remember')}
          question={tf('rememberForMerchant', { merchant: ruleAsk.merchant })}
          body={tf('merchantRuleAlso', {
            merchant: ruleAsk.merchant,
            n: ruleAsk.count,
            entries: ruleAsk.count === 1 ? 'entry' : 'entries',
          })}
          options={[
            { value: 'future', label: t('justFuture') },
            { value: 'all', label: t('yesUpdateAll') },
          ]}
          onSelect={(scope) => setMerchantOverride(ruleAsk.merchant, ruleAsk.category, scope === 'all')}
        />
      )}
      {ruleAsk && ruleAsk.count === 0 && (
        <ConfirmSheet
          visible
          onClose={closeRule}
          question={tf('rememberForMerchant', { merchant: ruleAsk.merchant })}
          body={tf('merchantRuleOnly', { merchant: ruleAsk.merchant })}
          confirmLabel={t('remember')}
          cancelLabel={t('no')}
          onConfirm={() => setMerchantOverride(ruleAsk.merchant, ruleAsk.category, false)}
        />
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
