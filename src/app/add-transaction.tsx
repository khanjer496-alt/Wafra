import { useLocalSearchParams, useRouter } from 'expo-router';
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
import { useToast } from '@/components/ui/toast';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { useTheme } from '@/hooks/use-theme';
import { categoryLabel, EXPENSE_CATEGORIES, getCategory, INCOME_CATEGORIES } from '@/lib/categories';
import { parseAmountToFils, toISODate } from '@/lib/format';
import { committed } from '@/lib/haptics';
import { t as tUi } from '@/lib/i18n';
import { ledgerCurrencyDisplay } from '@/lib/markets';
import { useStore } from '@/lib/store';
import { reviewTemplateRuleFor } from '@/lib/review-promotion';
import type { ReviewAlert } from '@/lib/alert-review-tray';
import type { CategoryId, TransactionType } from '@/lib/types';

function reviewMajorAmount(item: ReviewAlert): string {
  const { minorUnits, exponent } = item.amount;
  if (exponent === 0) return minorUnits;
  const padded = minorUnits.padStart(exponent + 1, '0');
  const split = padded.length - exponent;
  return `${padded.slice(0, split)}.${padded.slice(split)}`;
}

function defaultReviewTitle(item: ReviewAlert): string {
  if (item.family === 'cash-withdrawal') return 'ATM withdrawal';
  if (item.family === 'refund') return 'Refund';
  if (item.family === 'fee') return 'Bank fee';
  if (item.family === 'utility') return 'Bill payment';
  if (item.family === 'transfer') {
    return item.direction === 'credit' ? 'Incoming transfer' : 'Outgoing transfer';
  }
  if (item.family === 'recurring-payment') return 'Card payment';
  return 'Card payment';
}

export default function AddTransactionScreen() {
  const theme = useTheme();
  const router = useRouter();
  const keyboardHeight = useKeyboardHeight();
  const toast = useToast();
  const params = useLocalSearchParams<{ reviewId?: string | string[] }>();
  const reviewId = Array.isArray(params.reviewId) ? params.reviewId[0] : params.reviewId;
  const { state, addTransaction, promoteReviewAlert } = useStore();
  const reviewItem = reviewId
    ? state.reviewTray.pending.find((item) => item.id === reviewId) ?? null
    : null;
  const rememberedReview = reviewItem ? reviewTemplateRuleFor(state, reviewItem) : null;

  const reviewType: TransactionType = rememberedReview?.type ??
    (reviewItem?.direction === 'credit' ? 'income' : 'expense');
  const reviewCategory: CategoryId | null = reviewItem?.family === 'utility'
      ? 'utilities'
      : reviewItem?.family === 'cash-withdrawal'
        ? 'cash-withdrawal'
        : null;
  const reviewTitle = rememberedReview?.title ?? (reviewItem ? defaultReviewTitle(reviewItem) : '');
  const matchedAccount = reviewItem?.instrument?.last4
    ? state.accounts.find((account) => account.last4 === reviewItem.instrument?.last4)
    : null;

  const [type, setType] = useState<TransactionType>(reviewType);
  const [amountText, setAmountText] = useState('');
  const [category, setCategory] = useState<CategoryId | null>(
    rememberedReview ? rememberedReview.category as CategoryId : reviewItem ? reviewCategory : 'groceries',
  );
  const [accountId, setAccountId] = useState(
    reviewItem ? rememberedReview?.accountId ?? matchedAccount?.id ?? '' : state.accounts[0]?.id ?? '',
  );
  const [title, setTitle] = useState(reviewTitle);
  const [dayOffset, setDayOffset] = useState(0);
  const [reviewDate, setReviewDate] = useState(
    reviewItem ? toISODate(new Date(reviewItem.observedAt)) : '',
  );
  const [betweenOwnAccounts, setBetweenOwnAccounts] = useState(
    rememberedReview?.betweenOwnAccounts ?? false,
  );
  const [saving, setSaving] = useState(false);

  const categories = type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  const amountFils = parseAmountToFils(amountText);
  const reviewRouteInvalid = !!reviewId && !reviewItem;
  const canSave = !saving && !!accountId && !!category && !reviewRouteInvalid &&
    (reviewItem ? /^\d{4}-\d{2}-\d{2}$/.test(reviewDate) : !!amountFils);

  const date = useMemo(() => {
    if (reviewItem) return reviewDate;
    const d = new Date();
    d.setDate(d.getDate() - dayOffset);
    return toISODate(d);
  }, [dayOffset, reviewDate, reviewItem]);

  const switchType = (t: TransactionType) => {
    setType(t);
    setCategory(t === 'expense' ? 'groceries' : 'salary');
  };

  const save = async () => {
    if (!canSave || !accountId || !category) return;
    committed();
    if (reviewItem) {
      setSaving(true);
      try {
        await promoteReviewAlert({
          reviewId: reviewItem.id,
          type,
          title: title.trim() || reviewTitle,
          category,
          accountId,
          date: reviewDate,
          betweenOwnAccounts,
        });
        toast.show(tUi('reviewAlertAdded'), { tone: 'success' });
        router.back();
      } catch {
        toast.show(tUi('reviewAlertAddFailed'), { tone: 'error' });
      } finally {
        setSaving(false);
      }
      return;
    }
    if (!amountFils) return;
    addTransaction({
      type,
      amountFils,
      category,
      accountId,
      title: title.trim() || categoryLabel(getCategory(category)),
      date,
      source: 'manual',
    });
    router.back();
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {/* behavior was undefined on Android, which makes this component a
            no-op — the platform this app ships to had no keyboard handling at
            all, and the amount, merchant, date, account and Save button were
            all under the keys. The measured height below is what actually
            moves them. */}
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.header}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tUi('close')}
              onPress={() => router.back()}
              style={[styles.closeBtn, { backgroundColor: theme.backgroundSelected }]}>
              <Icon name="close" size={18} color={theme.text} />
            </Pressable>
            <ThemedText type="smallBold" accessibilityRole="header" style={styles.headerTitle}>
              {tUi(reviewItem ? 'reviewAlertAddTitle' : 'newTransaction')}
            </ThemedText>
            <View style={styles.closeBtn} />
          </View>

          <ScrollView
            contentContainerStyle={[styles.content, { paddingBottom: keyboardHeight + Spacing.six }]}
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
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={t === 'expense' ? tUi('expenseLabel') : tUi('incomeLabel')}
                    onPress={() => switchType(t)}
                    style={[
                      styles.segmentItem,
                      active && { backgroundColor: theme.card, borderColor: color },
                    ]}>
                    <ThemedText
                      type="smallBold"
                      style={{ color: active ? color : theme.textSecondary }}>
                      {t === 'expense' ? `− ${tUi('expenseLabel')}` : `+ ${tUi('incomeLabel')}`}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>

            {/* Amount */}
            <View style={styles.amountWrap}>
              <ThemedText type="smallBold" themeColor="textSecondary" style={styles.currency}>
                {reviewItem?.amount.currency ?? ledgerCurrencyDisplay()}
              </ThemedText>
              {reviewItem ? (
                <ThemedText type="title" tabular style={styles.reviewAmount}>
                  {reviewMajorAmount(reviewItem)}
                </ThemedText>
              ) : (
                <TextInput
                  value={amountText}
                  onChangeText={setAmountText}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  accessibilityLabel={tUi('amountInLedgerCurrency')}
                  autoFocus
                  placeholderTextColor={theme.textSecondary}
                  style={[styles.amountInput, { color: theme.text }]}
                />
              )}
            </View>

            {/* Category grid */}
            {reviewItem?.family === 'transfer' && (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: betweenOwnAccounts }}
                accessibilityLabel={tUi('reviewAlertOwnAccounts')}
                onPress={() => setBetweenOwnAccounts((value) => !value)}
                style={[styles.transferChoice, { borderColor: theme.controlBorder }]}>
                <Icon
                  name={betweenOwnAccounts ? 'check' : 'repeat'}
                  size={18}
                  color={betweenOwnAccounts ? theme.primary : theme.textSecondary}
                />
                <ThemedText type="small">{tUi('reviewAlertOwnAccounts')}</ThemedText>
              </Pressable>
            )}

            <View style={styles.fieldBlock}>
              <ThemedText type="small" themeColor="textSecondary">{tUi('category')}</ThemedText>
              <CategoryChips
                categories={categories}
                selected={category}
                onToggle={setCategory}
                layout="wrap"
              />
              {reviewItem && !category && (
                <ThemedText type="meta" themeColor="textTertiary">
                  {tUi('reviewAlertChooseCategory')}
                </ThemedText>
              )}
            </View>

            {/* Account */}
            <View style={styles.fieldBlock}>
              <ThemedText type="small" themeColor="textSecondary">{tUi('account')}</ThemedText>
              {/* Bleeds to both screen edges. Inset inside the page padding, a
                  chip that overflowed was sliced 16px short of the edge — it
                  read as a clipped label ("Casl"), not as a row that scrolls.
                  Cut at the edge itself, it reads as more to come. */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.accountScroll}
                contentContainerStyle={styles.accountRow}>
                {state.accounts.map((a) => {
                  const active = accountId === a.id;
                  return (
                    <Pressable
                      key={a.id}
                      accessibilityRole="button"
                      accessibilityLabel={a.name}
                      accessibilityState={{ selected: active }}
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
              {reviewItem && !accountId && state.accounts.length > 0 && (
                <ThemedText type="meta" themeColor="textTertiary">
                  {tUi('reviewAlertChooseAccount')}
                </ThemedText>
              )}
              {state.accounts.length === 0 && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push('/wallet')}
                  style={styles.emptyAccountAction}>
                  <ThemedText type="small" style={{ color: theme.primary }}>
                    {tUi('reviewAlertCreateAccount')}
                  </ThemedText>
                </Pressable>
              )}
            </View>

            {/* Date quick-pick */}
            <View style={styles.fieldBlock}>
              <ThemedText type="small" themeColor="textSecondary">{tUi('when')}</ThemedText>
              {reviewItem ? (
                <TextInput
                  value={reviewDate}
                  onChangeText={setReviewDate}
                  accessibilityLabel={tUi('reviewAlertDateA11y')}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={theme.textSecondary}
                  style={[
                    styles.titleInput,
                    {
                      backgroundColor: theme.backgroundElement,
                      borderColor: theme.controlBorder,
                      color: theme.text,
                    },
                  ]}
                />
              ) : (
              <View style={styles.dateRow}>
                {[
                  { label: tUi('today'), offset: 0 },
                  { label: tUi('yesterday'), offset: 1 },
                  { label: tUi('twoDaysAgo'), offset: 2 },
                  { label: tUi('threeDaysAgo'), offset: 3 },
                ].map((d) => {
                  const active = dayOffset === d.offset;
                  return (
                    <Pressable
                      key={d.offset}
                      accessibilityRole="button"
                      accessibilityLabel={d.label}
                      accessibilityState={{ selected: active }}
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
              )}
            </View>

            {/* Title */}
            <View style={styles.fieldBlock}>
              <ThemedText type="small" themeColor="textSecondary">{tUi('descriptionOptional')}</ThemedText>
              <TextInput
                value={title}
                onChangeText={setTitle}
                accessibilityLabel={tUi('descriptionOptionalA11y')}
                placeholder={type === 'expense' ? tUi('expenseExample') : tUi('incomeExample')}
                placeholderTextColor={theme.textSecondary}
                style={[
                  styles.titleInput,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.controlBorder,
                    color: theme.text,
                    textAlign: state.language === 'ar' ? 'right' : 'left',
                  },
                ]}
              />
            </View>
          </ScrollView>

          {/* A docked bar, and it has to read as one. Undivided, the solid
              green block simply began part-way down the description field and
              looked like it was sitting on top of it. The rule says where the
              scroll ends; the content padding above keeps the last field clear
              of it once you reach the bottom. */}
          <View
            style={[
              styles.footer,
              { borderTopColor: theme.cardBorder, backgroundColor: theme.background },
            ]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tUi(saving ? 'savingSecurely' : 'saveTransaction')}
              accessibilityState={{ disabled: !canSave, busy: saving }}
              onPress={() => void save()}
              disabled={!canSave}
              style={[
                styles.saveBtn,
                { backgroundColor: theme.primary, opacity: canSave ? 1 : 0.4 },
              ]}>
              <Icon name="check" size={20} color={theme.onPrimary} strokeWidth={2.6} />
              <ThemedText type="smallBold" style={{ color: theme.onPrimary, fontSize: 16 }}>
                {tUi(saving ? 'savingSecurely' : reviewItem ? 'reviewAlertAdd' : 'saveTransaction')}
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
    paddingBottom: Spacing.four,
    gap: Spacing.three + 4,
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
  reviewAmount: { fontSize: 42, fontWeight: '800' },
  transferChoice: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
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
  accountScroll: {
    marginHorizontal: -Spacing.three,
  },
  accountRow: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
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
  emptyAccountAction: {
    minHeight: 44,
    alignSelf: 'flex-start',
    justifyContent: 'center',
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
    borderTopWidth: StyleSheet.hairlineWidth,
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
