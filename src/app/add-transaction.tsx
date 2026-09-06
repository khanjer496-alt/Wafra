import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  findNodeHandle,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { CategoryChips } from '@/components/ui/category-chips';
import { ScreenScaffold } from '@/components/ui/screen-scaffold';
import { TextField } from '@/components/ui/text-field';
import { useToast } from '@/components/ui/toast';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { categorySupportsType, categoryLabel, EXPENSE_CATEGORIES, getCategory, INCOME_CATEGORIES } from '@/lib/categories';
import { parseAmountToFils, toISODate } from '@/lib/format';
import { committed } from '@/lib/haptics';
import { t as tUi } from '@/lib/i18n';
import { ledgerCurrencyDisplay } from '@/lib/markets';
import { useStore } from '@/lib/store';
import { reviewTemplateRuleFor } from '@/lib/review-promotion';
import { isUniversalReviewAlert, type ReviewAlert } from '@/lib/alert-review-tray';
import { UniversalReviewFields, UniversalReviewFacts, isOrdinaryUniversalPosting } from '@/components/universal-review-fields';
import type { UniversalInstrument, UniversalMoney } from '@/lib/universal-types';
import { suggestUniversalCategory } from '@/lib/universal-categorization';
import type { CategoryId, TransactionType } from '@/lib/types';

type WebGroupAriaProps = {
  'aria-labelledby': string;
  'aria-describedby'?: string;
  'aria-invalid': boolean;
};

function validReviewDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

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
  const toast = useToast();
  const params = useLocalSearchParams<{ reviewId?: string | string[] }>();
  const reviewId = Array.isArray(params.reviewId) ? params.reviewId[0] : params.reviewId;
  const { state, addTransaction, promoteReviewAlert } = useStore();
  const reviewItem = reviewId
    ? state.reviewTray.pending.find((item) => item.id === reviewId) ?? null
    : null;
  const genericItem = reviewItem && isUniversalReviewAlert(reviewItem) ? reviewItem : null;
  const registeredItem = reviewItem && !isUniversalReviewAlert(reviewItem) ? reviewItem : null;
  const event = genericItem?.event;
  const rememberedReview = reviewItem ? reviewTemplateRuleFor(state, reviewItem) : null;
  const reviewBinding = useRef(reviewItem ? { sourceKey: reviewItem.sourceKey, observedAt: reviewItem.observedAt } : null);
  const reviewDirection = event?.direction ?? registeredItem?.direction;
  const reviewFamily = event?.family ?? registeredItem?.family;
  const reviewInstrument = event?.instrument.evidence === 'explicit' ? event.instrument.value : registeredItem?.instrument;
  const ordinaryPosting = !event || isOrdinaryUniversalPosting(event);


  const reviewType: TransactionType = rememberedReview?.type ??
    (reviewDirection === 'credit' ? 'income' : 'expense');
  const categorySuggestion = event ? suggestUniversalCategory(event, { overrides: state.merchantOverrides }) : null;
  const reviewCategory: CategoryId | null = categorySuggestion && !categorySuggestion.needsReview
    ? categorySuggestion.category : reviewFamily === 'utility'
      ? 'utilities'
      : reviewFamily === 'cash-withdrawal'
        ? 'cash-withdrawal'
        : null;
  const reviewTitle = rememberedReview?.title ?? (event
    ? event.merchant.evidence === 'explicit' ? event.merchant.value ?? '' : ''
    : registeredItem ? defaultReviewTitle(registeredItem) : '');
  const matchingAccounts = reviewInstrument?.last4 ? state.accounts.filter((account) =>
    account.last4 === reviewInstrument.last4 &&
    (reviewInstrument.kind === 'card' ? account.kind === 'card'
      : reviewInstrument.kind === 'account' ? account.kind === 'bank' : account.kind !== 'card')) : [];
  const matchedAccount = matchingAccounts.length === 1 ? matchingAccounts[0] : null;


  const [type, setType] = useState<TransactionType>(reviewType);
  const [directionConfirmed, setDirectionConfirmed] = useState(!event || event.direction === 'debit' || event.direction === 'credit');
  const [postedConfirmed, setPostedConfirmed] = useState(event?.status === 'posted');
  const [selectedMoney, setSelectedMoney] = useState<UniversalMoney | null>(event?.amount.evidence === 'explicit' ? event.amount.value : null);
  const [selectedInstrument, setSelectedInstrument] = useState<UniversalInstrument | null>(reviewInstrument ?? null);
  const [amountText, setAmountText] = useState('');
  const [category, setCategory] = useState<CategoryId | null>(
    rememberedReview ? rememberedReview.category as CategoryId : reviewItem
      ? reviewCategory && categorySupportsType(reviewCategory, reviewType) ? reviewCategory : null : 'groceries',
  );
  const [accountId, setAccountId] = useState(
    reviewItem ? rememberedReview?.accountId ?? matchedAccount?.id ?? '' : state.accounts[0]?.id ?? '',
  );
  const [title, setTitle] = useState(reviewTitle);
  const [dayOffset, setDayOffset] = useState(0);
  const [reviewDate, setReviewDate] = useState(
    event ? event.transactionDate.evidence === 'explicit' ? event.transactionDate.value ?? '' : ''
      : reviewItem ? toISODate(new Date(reviewItem.observedAt)) : '',
  );
  const [betweenOwnAccounts, setBetweenOwnAccounts] = useState(
    rememberedReview?.betweenOwnAccounts ?? false,
  );
  const [saving, setSaving] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const amountRef = useRef<TextInput>(null);
  const categoryRef = useRef<View>(null);
  const accountRef = useRef<View>(null);
  const reviewDateRef = useRef<TextInput>(null);

  const categories = type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  const amountFils = parseAmountToFils(amountText);
  const reviewRouteInvalid = !!reviewId && (!reviewItem || reviewItem.expiresAt <= Date.now());
  const sourceChanged = !!genericItem && (reviewBinding.current?.sourceKey !== genericItem.sourceKey ||
    reviewBinding.current?.observedAt !== genericItem.observedAt);
  const moneyMatchesLedger = !selectedMoney || !state.ledgerMoney ||
    (state.ledgerMoney.currency === selectedMoney.currency && state.ledgerMoney.exponent === selectedMoney.exponent);
  const genericReady = !event || (ordinaryPosting && !sourceChanged && !!selectedMoney &&
    /^[1-9]\d*$/.test(selectedMoney.minorUnits) && moneyMatchesLedger && directionConfirmed && postedConfirmed &&
    title.trim().length > 0 && title.trim().length <= 80 &&
    (event.instrument.evidence !== 'ambiguous' || selectedInstrument !== null));
  const canSave = !saving && !!accountId && !!category && !reviewRouteInvalid && genericReady &&
    (reviewItem ? validReviewDate(reviewDate) : !!amountFils);
  const amountInvalid = showValidation && !reviewItem && !amountFils;
  const categoryInvalid = showValidation && !category;
  const accountInvalid = showValidation && !accountId;
  const reviewDateInvalid = showValidation && !!reviewItem &&
    !validReviewDate(reviewDate);
  const categoryLabelId = 'add-transaction-category-label';
  const categoryErrorId = 'add-transaction-category-error';
  const accountLabelId = 'add-transaction-account-label';
  const accountErrorId = 'add-transaction-account-error';
  const categoryWebAriaProps: WebGroupAriaProps = {
    'aria-labelledby': categoryLabelId,
    'aria-describedby': categoryInvalid ? categoryErrorId : undefined,
    'aria-invalid': categoryInvalid,
  };
  const accountWebAriaProps: WebGroupAriaProps = {
    'aria-labelledby': accountLabelId,
    'aria-describedby': accountInvalid ? accountErrorId : undefined,
    'aria-invalid': accountInvalid,
  };

  const date = useMemo(() => {
    if (reviewItem) return reviewDate;
    const d = new Date();
    d.setDate(d.getDate() - dayOffset);
    return toISODate(d);
  }, [dayOffset, reviewDate, reviewItem]);

  const switchType = (t: TransactionType) => {
    setType(t);
    setDirectionConfirmed(true);
    const suggestion = event ? suggestUniversalCategory(event, { type: t, overrides: state.merchantOverrides }) : null;
    setCategory(reviewItem ? suggestion && !suggestion.needsReview ? suggestion.category : null
      : t === 'expense' ? 'groceries' : 'salary');
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
          ...(genericItem && selectedMoney && reviewBinding.current ? { universal: {
            confirmed: true as const, postingStatus: 'posted' as const, amount: selectedMoney,
            expectedSourceKey: reviewBinding.current.sourceKey,
            expectedObservedAt: reviewBinding.current.observedAt,
            ...(selectedInstrument ? { instrument: selectedInstrument } : {}),
          } } : {}),
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

  const focusGroup = (ref: React.RefObject<View | null>) => {
    const node = findNodeHandle(ref.current);
    if (node !== null) AccessibilityInfo.setAccessibilityFocus(node);
  };

  const focusFirstInvalid = () => {
    if (!reviewItem && !amountFils) {
      amountRef.current?.focus();
      return;
    }
    if (!category) {
      focusGroup(categoryRef);
      return;
    }
    if (!accountId) {
      focusGroup(accountRef);
      return;
    }
    if (reviewItem && !validReviewDate(reviewDate)) {
      reviewDateRef.current?.focus();
    }
  };

  const onSavePress = () => {
    if (!canSave) {
      setShowValidation(true);
      if (genericItem) toast.show(tUi(sourceChanged || reviewRouteInvalid ? 'genericSourceChanged'
        : !moneyMatchesLedger ? 'genericCurrencyMismatch' : 'genericCompleteFields'), { tone: 'warning' });
      focusFirstInvalid();
      return;
    }
    void save();
  };

  if (genericItem && !ordinaryPosting) {
    const family = genericItem.event.family;
    const titleKey = family === 'statement' ? 'genericStatement' : family === 'balance' ? 'genericBalanceUpdate'
      : family === 'card-payment' ? 'genericCardPayment' : 'genericBill';
    return (
      <ScreenScaffold headerMode="inline" header={{ title: tUi(titleKey),
        back: { label: tUi('close'), icon: 'close', onPress: () => router.back() } }} contentStyle={styles.content}>
        <ThemedText type="small" themeColor="textSecondary">{tUi('genericInformational')}</ThemedText>
        <UniversalReviewFacts event={genericItem.event} includeAmount />
        <Pressable accessibilityRole="button" style={[styles.saveBtn, { backgroundColor: theme.primary }]}
          onPress={() => router.push(family === 'balance' ? '/(tabs)/wallet' : family === 'bill' ? '/(tabs)/bills' : '/cards')}>
          <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>{tUi(family === 'balance'
            ? 'genericOpenWallet' : family === 'bill' ? 'genericOpenBills' : 'genericOpenCards')}</ThemedText>
        </Pressable>
      </ScreenScaffold>
    );
  }

  return (
    <ScreenScaffold
      keyboardAware
      headerMode="inline"
      header={{
        title: tUi(genericItem ? 'genericReviewTitle' : reviewItem ? 'reviewAlertAddTitle' : 'newTransaction'),
        back: { label: tUi('close'), icon: 'close', onPress: () => router.back() },
      }}
      scrollProps={{ keyboardShouldPersistTaps: 'handled' }}
      contentStyle={styles.content}
      footer={(
        <View
          style={[
            styles.footer,
            { borderTopColor: theme.cardBorder, backgroundColor: theme.background },
          ]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tUi(saving ? 'savingSecurely' : genericItem ? 'genericConfirmAdd' : 'saveTransaction')}
            accessibilityState={{ disabled: saving || reviewRouteInvalid, busy: saving }}
            onPress={onSavePress}
            disabled={saving || reviewRouteInvalid}
            style={[
              styles.saveBtn,
              {
                backgroundColor: theme.primary,
                opacity: saving || reviewRouteInvalid ? 0.4 : 1,
              },
            ]}>
            <Icon name="check" size={20} color={theme.onPrimary} strokeWidth={2.6} />
            <ThemedText type="smallBold" style={{ color: theme.onPrimary, fontSize: 16 }}>
              {tUi(saving ? 'savingSecurely' : genericItem ? 'genericConfirmAdd' : reviewItem ? 'reviewAlertAdd' : 'saveTransaction')}
            </ThemedText>
          </Pressable>
        </View>
      )}>
      {/* Type switch */}
      <View style={[styles.segment, { backgroundColor: theme.backgroundSelected }]}>
              {(['expense', 'income'] as TransactionType[]).map((t) => {
                const active = type === t && directionConfirmed;
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

      {event && !directionConfirmed ? <ThemedText type="small" themeColor="textSecondary">{tUi('genericChooseDirection')}</ThemedText> : null}
      {sourceChanged ? <ThemedText type="small" themeColor="textSecondary">{tUi('genericSourceChanged')}</ThemedText> : null}
      {!moneyMatchesLedger ? <ThemedText type="small" themeColor="textSecondary">{tUi('genericCurrencyMismatch')}</ThemedText> : null}
      {/* Amount */}
      {event && genericItem ? (
        <UniversalReviewFields event={event} money={selectedMoney} onMoneyChange={setSelectedMoney}
          instrument={selectedInstrument} onInstrumentChange={(value) => { setSelectedInstrument(value); setAccountId(''); }}
          postedConfirmed={postedConfirmed} onPostedConfirmed={setPostedConfirmed}
          date={reviewDate} onDateChange={setReviewDate} observedDate={toISODate(new Date(genericItem.observedAt))}
          observedDateLabel={tUi(genericItem.channel === 'paste' ? 'genericUsePasteDate' : 'genericUseMessageDate')} />
      ) : registeredItem ? (
        <View style={styles.amountWrap}>
              <ThemedText type="smallBold" themeColor="textSecondary" style={styles.currency}>
            {registeredItem.amount.currency}
              </ThemedText>
          <ThemedText type="title" tabular style={styles.reviewAmount}>
            {reviewMajorAmount(registeredItem)}
          </ThemedText>
        </View>
      ) : (
        <TextField
          ref={amountRef}
          label={tUi('amountInLedgerCurrency')}
          value={amountText}
          onChangeText={setAmountText}
          numeric
          placeholder="0"
          autoFocus
          invalid={amountInvalid}
          errorText={amountInvalid ? tUi('amountInLedgerCurrency') : undefined}
          leading={(
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.currency}>
              {ledgerCurrencyDisplay()}
            </ThemedText>
          )}
          style={[styles.amountInput, { color: theme.text, fontFamily: state.language === 'ar' ? Fonts.arabicBold : Fonts.sansSemi }]}
        />
      )}

      {/* Category grid */}
      {reviewFamily === 'transfer' && (
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

      <View
        ref={categoryRef}
        collapsable={false}
        accessibilityRole="radiogroup"
        accessibilityLabel={tUi('category')}
        accessibilityLabelledBy={categoryLabelId}
        accessibilityHint={tUi('reviewAlertChooseCategory')}
        {...(Platform.OS === 'web' ? categoryWebAriaProps : {})}
        style={styles.fieldBlock}>
              <ThemedText
          type="small"
          themeColor="textSecondary"
          nativeID={categoryLabelId}>
          {tUi('category')}
        </ThemedText>
              <CategoryChips
                categories={categories}
                selected={category}
                onToggle={setCategory}
                layout="wrap"
              />
        {categoryInvalid && (
          <ThemedText
            type="meta"
            themeColor="expense"
            nativeID={categoryErrorId}
            accessibilityLiveRegion="polite"
            selectable>
                  {tUi('reviewAlertChooseCategory')}
                </ThemedText>
              )}
      </View>

      {/* Account */}
      <View
        ref={accountRef}
        collapsable={false}
        accessibilityRole="radiogroup"
        accessibilityLabel={tUi('account')}
        accessibilityLabelledBy={accountLabelId}
        accessibilityHint={tUi('reviewAlertChooseAccount')}
        {...(Platform.OS === 'web' ? accountWebAriaProps : {})}
        style={styles.fieldBlock}>
        <ThemedText
          type="small"
          themeColor="textSecondary"
          nativeID={accountLabelId}>
          {tUi('account')}
        </ThemedText>
              {/* Bleeds to both screen edges. Inset inside the page padding, a
                  chip that overflowed was sliced 16px short of the edge — it
                  read as a clipped label ("Casl"), not as a row that scrolls.
                  Cut at the edge itself, it reads as more to come. */}
              <View style={styles.accountRow}>
                {state.accounts.map((a) => {
                  const active = accountId === a.id;
                  return (
                    <Pressable
                      key={a.id}
                      accessibilityRole="radio"
                      accessibilityLabel={a.name}
                      accessibilityState={{ checked: active }}
                      onPress={() => setAccountId(a.id)}
                      style={[
                        styles.accountChip,
                        {
                          backgroundColor: active ? `${a.color}26` : theme.backgroundElement,
                          borderColor: active ? a.color : theme.cardBorder,
                        },
                      ]}>
                      <View style={[styles.accountDot, { backgroundColor: a.color }]} />
                      <ThemedText type="small" style={{ flex: 1, flexShrink: 1 }}>{a.name}</ThemedText>
                    </Pressable>
                  );
                })}
              </View>
        {accountInvalid && (
          <ThemedText
            type="meta"
            themeColor="expense"
            nativeID={accountErrorId}
            accessibilityLiveRegion="polite"
            selectable>
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
              {reviewItem ? (
          <TextField
            ref={reviewDateRef}
            label={tUi('when')}
                  value={reviewDate}
                  onChangeText={setReviewDate}
                  accessibilityLabel={tUi('reviewAlertDateA11y')}
                  placeholder="YYYY-MM-DD"
            inputMode="numeric"
            invalid={reviewDateInvalid}
            errorText={reviewDateInvalid ? tUi('reviewAlertDateA11y') : undefined}
                />
              ) : (
          <>
            <ThemedText type="small" themeColor="textSecondary">{tUi('when')}</ThemedText>
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
          </>
              )}
      </View>

      {/* Title */}
      <TextField
        label={tUi(genericItem ? 'genericMerchantTitle' : 'descriptionOptional')}
                value={title}
                onChangeText={setTitle}
                accessibilityLabel={tUi(genericItem ? 'genericMerchantTitle' : 'descriptionOptionalA11y')}
                maxLength={genericItem ? 80 : undefined}
                invalid={!!genericItem && (title.length > 80 || (showValidation && !title.trim()))}
                errorText={genericItem && title.length > 80 ? tUi('genericShortenTitle') : undefined}
                placeholder={type === 'expense' ? tUi('expenseExample') : tUi('incomeExample')}
              />
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing.three + 4,
  },
  segment: {
    flexDirection: 'row',
    borderRadius: 26,
    padding: 4,
    gap: 4,
  },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two + 2,
    minHeight: 48,
    borderRadius: 22,
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
    fontSize: 40,
    fontFamily: Fonts.sansSemi,
    minWidth: 0,
    flexShrink: 1,
    textAlign: 'center',
    padding: 0,
  },
  reviewAmount: { fontSize: 36, fontFamily: Fonts.sansSemi },
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
  accountScroll: {
    marginHorizontal: -Spacing.three,
  },
  accountRow: {
    gap: Spacing.two,
    paddingHorizontal: 0,
  },
  accountChip: {
    minHeight: 52,
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
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two,
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
