import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { CategoryChips } from '@/components/ui/category-chips';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { LedgerCurrencySheet, suggestedLedgerCurrency } from '@/components/ledger-currency-sheet';
import { ScreenScaffold } from '@/components/ui/screen-scaffold';
import { TextField } from '@/components/ui/text-field';
import { useToast } from '@/components/ui/toast';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { categorySupportsType, categoryLabel, EXPENSE_CATEGORIES, getCategory, INCOME_CATEGORIES } from '@/lib/categories';
import { parseAmountToFils, parseAmountWithMoneySpec, shortDate, toISODate } from '@/lib/format';
import { committed } from '@/lib/haptics';
import { t as tUi, tf as tfUi } from '@/lib/i18n';
import { accountDisplayName } from '@/lib/ledger';
import { useStore } from '@/lib/store';
import { reviewTemplateRuleFor, type PromoteReviewAlertInput } from '@/lib/review-promotion';
import { isUniversalReviewAlert, type ReviewAlert, type ReviewEntry, type UniversalReviewAlert } from '@/lib/alert-review-tray';
import { reviewAlertCopy } from '@/lib/review-alert-copy';
import { UniversalReviewFields, UniversalReviewFacts, isOrdinaryUniversalPosting, reviewMoneyChoices } from '@/components/universal-review-fields';
import type { UniversalInstrument, UniversalMoney } from '@/lib/universal-types';
import { suggestUniversalCategory } from '@/lib/universal-categorization';
import type { CategoryId, TransactionType } from '@/lib/types';

type WebGroupAriaProps = {
  'aria-labelledby': string;
  'aria-describedby'?: string;
  'aria-invalid': boolean;
};


const isApplePaySource = (item: ReviewEntry): boolean =>
  item.channel === 'push' && /^apple_pay_review_source_[a-f0-9]{32}$/.test(item.sourceKey);

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
  const { state, getStateSnapshot, getStateGeneration, addTransaction, setLedgerMoney, promoteReviewAlert, dismissReviewAlert } = useStore();
  const reviewItem = reviewId
    ? state.reviewTray.pending.find((item) => item.id === reviewId) ?? null
    : null;
  const genericItem = reviewItem && isUniversalReviewAlert(reviewItem) ? reviewItem : null;
  const applePayItem = genericItem && isApplePaySource(genericItem);
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
  const universalFallbackTitle = event ? tUi(event.family === 'purchase' || event.family === 'recurring-payment'
    ? 'genericCardPayment'
    : event.family === 'transfer' ? 'reviewAlertPossibleTransfer'
      : event.family === 'cash-withdrawal' ? 'reviewAlertPossibleCash'
        : event.family === 'refund' ? 'reviewAlertPossibleRefund'
          : event.family === 'fee' ? 'reviewAlertPossibleFee'
            : event.family === 'utility' ? 'reviewAlertPossibleUtility'
              : 'newTransaction') : '';
  const explicitMerchantTitle = event?.merchant.evidence === 'explicit'
    ? event.merchant.value?.trim() ?? ''
    : '';
  const reviewTitle = rememberedReview?.title?.trim() || (event
    ? explicitMerchantTitle || universalFallbackTitle
    : registeredItem ? defaultReviewTitle(registeredItem) : '');
  const matchingAccounts = reviewInstrument?.last4 ? state.accounts.filter((account) =>
    account.last4 === reviewInstrument.last4 &&
    (reviewInstrument.kind === 'card' ? account.kind === 'card'
      : reviewInstrument.kind === 'account' ? account.kind === 'bank' : account.kind !== 'card')) : [];
  const matchedAccount = matchingAccounts.length === 1 ? matchingAccounts[0] : null;


  const [type, setType] = useState<TransactionType>(reviewType);
  const [directionConfirmed, setDirectionConfirmed] = useState(!event || event.direction === 'debit' || event.direction === 'credit');
  const [selectedMoney, setSelectedMoney] = useState<UniversalMoney | null>(() => {
    if (!event) return null;
    if (event.amount.evidence === 'explicit' && event.amount.value) return event.amount.value;
    const choices = reviewMoneyChoices(event);
    return choices.length === 1 ? choices[0] : null;
  });
  const [selectedInstrument, setSelectedInstrument] = useState<UniversalInstrument | null>(reviewInstrument ?? null);
  const [amountText, setAmountText] = useState('');
  const [currencySheetVisible, setCurrencySheetVisible] = useState(false);
  const suggestedCurrency = useMemo(suggestedLedgerCurrency, []);
  const [category, setCategory] = useState<CategoryId | null>(
    rememberedReview ? rememberedReview.category as CategoryId : reviewItem
      ? reviewCategory && categorySupportsType(reviewCategory, reviewType) ? reviewCategory : 'other' : 'groceries',
  );
  const [accountId, setAccountId] = useState(
    reviewItem ? rememberedReview?.accountId ?? matchedAccount?.id ?? '' : state.accounts[0]?.id ?? '',
  );
  const [title, setTitle] = useState(reviewTitle);
  const [dayOffset, setDayOffset] = useState(0);
  const observedReviewDate = reviewItem ? toISODate(new Date(reviewItem.observedAt)) : '';
  const explicitReviewDate = event?.transactionDate.evidence === 'explicit'
    ? event.transactionDate.value
    : null;
  const [reviewDate, setReviewDate] = useState(
    explicitReviewDate && validReviewDate(explicitReviewDate) ? explicitReviewDate : observedReviewDate,
  );
  const [betweenOwnAccounts, setBetweenOwnAccounts] = useState(
    rememberedReview?.betweenOwnAccounts ?? false,
  );
  const reviewDirectionKnown = reviewDirection === 'credit' || reviewDirection === 'debit';
  const [saving, setSaving] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [accountSearch, setAccountSearch] = useState('');
  const amountRef = useRef<TextInput>(null);
  const categoryRef = useRef<View>(null);
  const accountRef = useRef<View>(null);
  const reviewDateRef = useRef<TextInput>(null);
  const [confirmingInformationDismiss, setConfirmingInformationDismiss] = useState(false);
  const [informationItem] = useState<UniversalReviewAlert | null>(() => genericItem && !ordinaryPosting ? genericItem : null);
  const [informationDismissFailed, setInformationDismissFailed] = useState(false);
  const [duplicateReview, setDuplicateReview] = useState<{
    item: ReviewEntry; generation: number; input: PromoteReviewAlertInput;
  } | null>(null);
  const [duplicateDismissFailed, setDuplicateDismissFailed] = useState(false);
  const [confirmingSeparate, setConfirmingSeparate] = useState(false);
  const [separateFailed, setSeparateFailed] = useState(false);
  const separateAttempted = useRef(false);
  const separateInFlight = useRef(false);
  const duplicateDismissAttempted = useRef(false);
  const duplicateDismissInFlight = useRef(false);
  const informationDismissInFlight = useRef(false);
  const informationDismissActive = useRef(true);
  const informationDismissAttempted = useRef(false);
  const informationGeneration = useRef(getStateGeneration());
  const informationRouteId = useRef(reviewId);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  informationRouteId.current = reviewId;
  useEffect(() => {
    informationDismissActive.current = true;
    return () => { informationDismissActive.current = false; };
  }, []);

  const categories = type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  const manualMoneySpec = state.ledgerMoney;
  const amountFils = reviewItem
    ? parseAmountToFils(amountText)
    : manualMoneySpec ? parseAmountWithMoneySpec(amountText, manualMoneySpec) : null;
  const reviewRouteInvalid = !!reviewId && (!reviewItem || reviewItem.expiresAt <= Date.now());
  const sourceChanged = !!genericItem && (reviewBinding.current?.sourceKey !== genericItem.sourceKey ||
    reviewBinding.current?.observedAt !== genericItem.observedAt);
  const moneyMatchesLedger = !selectedMoney || !state.ledgerMoney ||
    (state.ledgerMoney.currency === selectedMoney.currency && state.ledgerMoney.exponent === selectedMoney.exponent);
  const genericReady = !event || (ordinaryPosting && !sourceChanged && !!selectedMoney &&
    /^[1-9]\d*$/.test(selectedMoney.minorUnits) && moneyMatchesLedger && directionConfirmed &&
    title.trim().length > 0 && title.trim().length <= 80 &&
    (event.instrument.evidence !== 'ambiguous' || selectedInstrument !== null));
  const canSave = !saving && !!accountId && !!category && !reviewRouteInvalid && genericReady &&
    (!!reviewItem || !!manualMoneySpec) &&
    (reviewItem ? validReviewDate(reviewDate) : !!amountFils);
  const amountInvalid = showValidation && !reviewItem && !amountFils;
  const categoryInvalid = showValidation && !category;
  const accountInvalid = showValidation && !accountId;
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
    setCategory(reviewItem ? suggestion && !suggestion.needsReview ? suggestion.category : 'other'
      : t === 'expense' ? 'groceries' : 'salary');
  };

  const save = async () => {
    if (!canSave || !accountId || !category) return;
    committed();
    if (reviewItem) {
      const saveGeneration = getStateGeneration();
      setSaving(true);
      const input: PromoteReviewAlertInput = {
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
      };
      try {
        await promoteReviewAlert(input);
        toast.show(tUi('reviewAlertAdded'), { tone: 'success' });
        router.back();
      } catch (error) {
        // Any review the ledger refuses as a possible Apple Pay duplicate
        // (Wallet vs bank row, or bank alert vs Wallet row) opens the explicit
        // choice, bound to this exact item, generation and submitted input.
        if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'ReviewPromotionError' &&
          'reason' in error && error.reason === 'possible-duplicate' && getStateGeneration() === saveGeneration &&
          informationRouteId.current === reviewItem.id && reviewBinding.current?.sourceKey === reviewItem.sourceKey &&
          reviewBinding.current?.observedAt === reviewItem.observedAt) {
          duplicateDismissAttempted.current = false;
          separateAttempted.current = false;
          setDuplicateDismissFailed(false);
          setSeparateFailed(false);
          setConfirmingSeparate(false);
          setDuplicateReview({ item: reviewItem, generation: saveGeneration, input });
        } else {
          toast.show(tUi('reviewAlertAddFailed'), { tone: 'error' });
        }
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
    }, state.ledgerMoney ? undefined : manualMoneySpec ?? undefined);
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

  // Preserve captured facts after an optimistic dismissal removes the row.
  // A failed durable write must never expose an empty add form.
  if (duplicateReview && reviewId === duplicateReview.item.id) {
    const captured = duplicateReview.item;
    const capturedWallet = isApplePaySource(captured);
    const capturedEvent = isUniversalReviewAlert(captured) ? captured.event : null;
    const samePending = () => {
      const current = getStateSnapshot().reviewTray.pending.find(item => item.id === captured.id);
      return !!current && isUniversalReviewAlert(current) === isUniversalReviewAlert(captured) &&
        current.sourceKey === captured.sourceKey && current.observedAt === captured.observedAt &&
        current.expiresAt > Date.now();
    };
    const boundToThisReview = () => informationRouteId.current === captured.id &&
      getStateGeneration() === duplicateReview.generation && captured.expiresAt > Date.now();
    const canResolveDuplicate = () => {
      if (!boundToThisReview() || separateAttempted.current) return false;
      const tray = getStateSnapshot().reviewTray;
      if (tray.pending.some(item => item.id === captured.id)) return samePending();
      // Only this already-confirmed attempt can retry its own failed write.
      return duplicateDismissAttempted.current && tray.tombstones.some(item =>
        item.sourceKey === captured.sourceKey && item.outcome === 'duplicate');
    };
    // The separate-purchase override writes at most once: only after the
    // user's explicit confirmation, never after an "Already recorded" attempt,
    // never retried, and only for the same pending source in the same ledger
    // generation the user was shown.
    const canAddSeparate = () => boundToThisReview() && !duplicateDismissAttempted.current &&
      !separateAttempted.current && samePending();
    const valid = canResolveDuplicate();
    const separateAvailable = canAddSeparate();
    const stillPending = getStateSnapshot().reviewTray.pending.some(item =>
      item.id === captured.id && item.sourceKey === captured.sourceKey && item.observedAt === captured.observedAt);
    const canKeep = !saving &&
      ((!duplicateDismissAttempted.current && !separateAttempted.current) || stillPending || !valid);
    const keepInReview = () => {
      if (canKeep && !duplicateDismissInFlight.current && !separateInFlight.current) router.back();
    };
    const resolveDuplicate = async () => {
      if (duplicateDismissInFlight.current || separateInFlight.current || !canResolveDuplicate()) return;
      duplicateDismissInFlight.current = true;
      duplicateDismissAttempted.current = true;
      setConfirmingSeparate(false);
      setDuplicateDismissFailed(false);
      setSaving(true);
      try {
        await dismissReviewAlert(captured.id, 'duplicate');
        if (informationDismissActive.current && canResolveDuplicate()) router.back();
      } catch {
        if (informationDismissActive.current) setDuplicateDismissFailed(true);
      } finally {
        duplicateDismissInFlight.current = false;
        if (informationDismissActive.current) setSaving(false);
      }
    };
    const addSeparate = async () => {
      if (separateInFlight.current || duplicateDismissInFlight.current || !canAddSeparate()) return;
      separateInFlight.current = true;
      separateAttempted.current = true;
      setSaving(true);
      try {
        await promoteReviewAlert({ ...duplicateReview.input, reviewId: captured.id,
          separatePurchase: { confirmed: true, expectedSourceKey: captured.sourceKey,
            expectedObservedAt: captured.observedAt } });
        if (informationDismissActive.current && informationRouteId.current === captured.id &&
          getStateGeneration() === duplicateReview.generation) {
          toast.show(tUi('reviewAlertAdded'), { tone: 'success' });
          router.back();
        }
      } catch {
        if (informationDismissActive.current) setSeparateFailed(true);
      } finally {
        separateInFlight.current = false;
        if (informationDismissActive.current) {
          setConfirmingSeparate(false);
          setSaving(false);
        }
      }
    };
    const confirming = confirmingSeparate && separateAvailable;
    const actions = confirming ? <View style={{ gap: Spacing.two }}>
      <Pressable testID="apple-pay-confirm-separate" accessibilityRole="button"
        accessibilityLabel={tUi('duplicateSeparateConfirm')} disabled={saving}
        accessibilityState={{ disabled: saving, busy: saving }} onPress={() => void addSeparate()}
        style={[styles.saveBtn, { backgroundColor: theme.primary }]}>
        <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>{saving ? tUi('savingSecurely')
          : tUi('duplicateSeparateConfirm')}</ThemedText>
      </Pressable>
      <Pressable testID="apple-pay-cancel-separate" accessibilityRole="button" accessibilityLabel={tUi('cancel')}
        disabled={saving} accessibilityState={{ disabled: saving }}
        onPress={() => { if (!separateInFlight.current) setConfirmingSeparate(false); }}
        style={[styles.saveBtn, { opacity: saving ? 0.4 : 1 }]}>
        <ThemedText type="smallBold">{tUi('cancel')}</ThemedText>
      </Pressable>
    </View> : <View style={{ gap: Spacing.two }}>
      <Pressable testID="apple-pay-already-recorded" accessibilityRole="button"
        accessibilityLabel={duplicateDismissFailed ? tUi('applePayReviewRetry') : tUi('applePayReviewRecorded')}
        disabled={saving || !valid} accessibilityState={{ disabled: saving || !valid, busy: saving }}
        onPress={() => void resolveDuplicate()} style={[styles.saveBtn, { backgroundColor: theme.primary }]}>
        <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>{saving ? tUi('savingSecurely')
          : duplicateDismissFailed ? tUi('applePayReviewRetry') : tUi('applePayReviewRecorded')}</ThemedText>
      </Pressable>
      <Pressable testID="apple-pay-add-separate" accessibilityRole="button"
        accessibilityLabel={tUi('duplicateAddSeparate')} disabled={saving || !separateAvailable}
        accessibilityState={{ disabled: saving || !separateAvailable }}
        onPress={() => { if (canAddSeparate()) setConfirmingSeparate(true); }}
        style={[styles.saveBtn, { opacity: saving || !separateAvailable ? 0.4 : 1 }]}>
        <ThemedText type="smallBold">{tUi('duplicateAddSeparate')}</ThemedText>
      </Pressable>
      <Pressable testID="apple-pay-keep-review" accessibilityRole="button" disabled={!canKeep}
        accessibilityState={{ disabled: !canKeep }} onPress={keepInReview}
        style={[styles.saveBtn, { opacity: canKeep ? 1 : 0.4 }]}>
        <ThemedText type="smallBold">{valid ? tUi('applePayReviewKeep') : tUi('close')}</ThemedText>
      </Pressable>
    </View>;
    const sheetTitle = capturedWallet ? tUi('applePayReviewTitle') : tUi('reviewAlertAddTitle');
    const merchant = capturedEvent?.merchant.value;
    return <>
      <ScreenScaffold testID="apple-pay-duplicate-review" headerMode="inline" contentStyle={styles.content}
        header={{ title: sheetTitle, back: { label: tUi('back'), onPress: keepInReview, disabled: !canKeep } }}>
        {valid && capturedEvent ? <UniversalReviewFacts event={capturedEvent} includeAmount /> : null}
      </ScreenScaffold>
      <BottomSheet visible onClose={keepInReview} title={sheetTitle} footer={actions}>
        <View style={{ gap: Spacing.three }}>
          <ThemedText type="subtitle" accessibilityRole="header">{confirming
            ? tUi('duplicateSeparateConfirmTitle') : tUi('applePayReviewQuestion')}</ThemedText>
          <ThemedText type="small">{confirming ? tUi('duplicateSeparateConfirmBody')
            : capturedWallet ? tUi('applePayReviewBody') : tUi('reviewAlertMatchesApplePay')}</ThemedText>
          {valid && merchant ? <ThemedText type="smallBold">{merchant}</ThemedText> : null}
          {!valid || duplicateDismissFailed ? <ThemedText testID="apple-pay-duplicate-save-error"
            accessibilityRole="alert" themeColor="expense">
            {valid ? tUi('applePayReviewFailed') : tUi('genericSourceChanged')}</ThemedText> : null}
          {separateFailed ? <ThemedText testID="apple-pay-separate-save-error" accessibilityRole="alert"
            themeColor="expense">{tUi('duplicateSeparateFailed')}</ThemedText> : null}
        </View>
      </BottomSheet>
    </>;
  }

  // Dismissal removes the pending row before its encrypted write resolves.
  // Keep this read-only detail visible on failure so Retry can persist the
  // same explicit dismissal instead of exposing a blank transaction form.
  if (informationItem) {
    const words = reviewAlertCopy[state.language === 'ar' ? 'ar' : 'en'];
    const family = informationItem.event.family;
    const titleKey = family === 'statement' ? 'genericStatement' : family === 'balance' ? 'genericBalanceUpdate'
      : family === 'card-payment' ? 'genericCardPayment' : family === 'bill' ? 'genericBill' : 'genericReviewTitle';
    const canDismissInformation = () => {
      if (informationRouteId.current !== informationItem.id || informationItem.expiresAt <= Date.now() ||
        getStateGeneration() !== informationGeneration.current) return false;
      const current = getStateSnapshot().reviewTray.pending.find(item => item.id === informationItem.id);
      // A failed optimistic write can remove our own row in memory. Only that
      // same confirmed attempt may retry persistence without a pending row.
      if (!current) return informationDismissAttempted.current;
      return isUniversalReviewAlert(current) && !isOrdinaryUniversalPosting(current.event) &&
        current.sourceKey === informationItem.sourceKey && current.observedAt === informationItem.observedAt &&
        current.expiresAt > Date.now();
    };
    const informationValid = canDismissInformation();
    const dismissInformation = async () => {
      if (informationDismissInFlight.current || !canDismissInformation()) return;
      informationDismissInFlight.current = true;
      informationDismissAttempted.current = true;
      setInformationDismissFailed(false);
      setSaving(true);
      try {
        await dismissReviewAlert(informationItem.id, 'dismissed');
        if (informationDismissActive.current && canDismissInformation()) {
          toast.show(tUi('reviewAlertDismissed'), { tone: 'info' });
          router.back();
        }
      } catch {
        if (informationDismissActive.current) setInformationDismissFailed(true);
      } finally {
        informationDismissInFlight.current = false;
        if (informationDismissActive.current) setSaving(false);
      }
    };
    return (
      <>
        <ScreenScaffold testID="informational-review" headerMode="inline" header={{ title: tUi(titleKey),
          back: { label: tUi('close'), icon: 'close', onPress: () => router.back(), disabled: saving } }} contentStyle={styles.content}>
          <ThemedText type="small" themeColor="textSecondary">{words.informationHint}</ThemedText>
          {informationValid && <UniversalReviewFacts event={informationItem.event} includeAmount />}
          {informationValid && ['statement', 'balance', 'card-payment', 'bill'].includes(family) && <Pressable accessibilityRole="button"
            disabled={saving} accessibilityState={{ disabled: saving }}
            style={[styles.saveBtn, { backgroundColor: theme.primary }]}
            onPress={() => router.push(family === 'balance' ? '/(tabs)/wallet' : family === 'bill' ? '/(tabs)/bills' : '/cards')}>
            <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>{tUi(family === 'balance'
              ? 'genericOpenWallet' : family === 'bill' ? 'genericOpenBills' : 'genericOpenCards')}</ThemedText>
          </Pressable>}
          {!informationValid || informationDismissFailed ? <ThemedText accessibilityRole="alert" themeColor="expense">
            {tUi(informationValid ? 'reviewAlertDismissFailed' : 'genericSourceChanged')}</ThemedText> : null}
          {saving ? <ThemedText accessibilityLiveRegion="polite">{words.dismissing}</ThemedText> : null}
          <Pressable accessibilityRole="button" accessibilityLabel={informationDismissFailed ? words.retryDismiss : words.dismissAlert}
            disabled={saving || !informationValid} accessibilityState={{ disabled: saving || !informationValid, busy: saving }}
            style={[styles.saveBtn, { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.cardBorder }]}
            onPress={() => informationDismissFailed ? void dismissInformation() : setConfirmingInformationDismiss(true)}>
            <ThemedText type="smallBold">{informationDismissFailed ? words.retryDismiss : words.dismissAlert}</ThemedText>
          </Pressable>
        </ScreenScaffold>
        <ConfirmSheet visible={confirmingInformationDismiss && informationValid} onClose={() => setConfirmingInformationDismiss(false)}
          question={tUi('reviewAlertDismissQuestion')} body={tUi('reviewAlertDismissBody')}
          confirmLabel={tUi('dismiss')} destructive onConfirm={() => void dismissInformation()} />
      </>
    );
  }

  return (
    <>
    <ScreenScaffold
      keyboardAware
      headerMode="inline"
      header={{
        title: tUi(reviewItem ? 'genericReviewTitle' : 'newTransaction'),
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
      {/* A captured alert asks only what Wafra genuinely does not know. If the
          bank already supplied debit/credit direction, do not make the person
          reconfirm it. Manual entries still need the normal type switch. */}
      {(!reviewItem || !reviewDirectionKnown) ? <View style={[styles.segment, { backgroundColor: theme.backgroundSelected }]}>
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
      </View> : null}

      {event && !directionConfirmed ? <ThemedText type="small" themeColor="textSecondary">{tUi('genericChooseDirection')}</ThemedText> : null}
      {sourceChanged ? <ThemedText type="small" themeColor="textSecondary">{tUi('genericSourceChanged')}</ThemedText> : null}
      {!moneyMatchesLedger ? <ThemedText type="small" themeColor="textSecondary">{tUi('genericCurrencyMismatch')}</ThemedText> : null}
      {/* A manual-only first run has no bank alert to establish accounting
          currency. Require one explicit choice instead of inheriting the
          parser pack's fallback currency. The phone region is only a hint. */}
      {!reviewItem && !state.ledgerMoney && (
        <View style={styles.fieldBlock}>
          <ThemedText type="small" themeColor="textSecondary">{tUi('ledgerCurrencyTitle')}</ThemedText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tUi('chooseLedgerCurrency')}
            onPress={() => setCurrencySheetVisible(true)}
            style={({ pressed }) => [
              styles.currencyPicker,
              { borderColor: state.ledgerMoney ? theme.primary : theme.controlBorder,
                backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
            ]}>
            <View style={styles.currencyPickerCopy}>
              <ThemedText type="smallBold">{tUi('chooseLedgerCurrency')}</ThemedText>
              <ThemedText type="meta" themeColor="textTertiary">
                {suggestedCurrency
                  ? tfUi('currencyPhoneSuggestion', { currency: suggestedCurrency })
                  : tUi('ledgerCurrencyRequiredHint')}
              </ThemedText>
            </View>
            <Icon name="chevron-right" size={17} color={theme.textSecondary} />
          </Pressable>
        </View>
      )}

      {/* Amount */}
      {event && genericItem ? (
        <View style={styles.reviewSummary} testID="generic-review-summary">
          <ThemedText type="meta" themeColor="textSecondary">
            {tUi(event.family === 'purchase' ? 'reviewAlertPossiblePurchase'
              : event.family === 'transfer' ? 'reviewAlertPossibleTransfer'
                : event.family === 'cash-withdrawal' ? 'reviewAlertPossibleCash'
                  : event.family === 'refund' ? 'reviewAlertPossibleRefund'
                    : event.family === 'fee' ? 'reviewAlertPossibleFee'
                      : event.family === 'utility' ? 'reviewAlertPossibleUtility'
                        : event.family === 'recurring-payment' ? 'reviewAlertPossibleRecurring' : 'genericReviewTitle')}
          </ThemedText>
          {explicitMerchantTitle ? <ThemedText type="heading">{explicitMerchantTitle}</ThemedText> : null}
        <UniversalReviewFields event={event} money={selectedMoney} onMoneyChange={setSelectedMoney}
          instrument={selectedInstrument} onInstrumentChange={(value) => { setSelectedInstrument(value); setAccountId(''); }}
          date={reviewDate} onDateChange={setReviewDate} observedDate={toISODate(new Date(genericItem.observedAt))}
          observedDateLabel={applePayItem ? tUi('applePayReviewUseDate') : tUi(genericItem.channel === 'paste' ? 'genericUsePasteDate' : 'genericUseMessageDate')} />
          <View style={[styles.reviewFacts, { borderColor: theme.cardBorder }]}>
            {state.accounts.find((account) => account.id === accountId) ? <View style={styles.reviewFact}>
              <ThemedText type="meta" themeColor="textSecondary">{tUi('account')}</ThemedText>
              <ThemedText type="small">{accountDisplayName(state.accounts.find((account) => account.id === accountId)!)}</ThemedText>
            </View> : null}
            {explicitReviewDate && validReviewDate(explicitReviewDate) ? <View style={styles.reviewFact}>
              <ThemedText type="meta" themeColor="textSecondary">{tUi('genericTransactionDate')}</ThemedText>
              <ThemedText type="small">{shortDate(explicitReviewDate)}</ThemedText>
            </View> : null}
            <View style={styles.reviewFact}>
              <ThemedText type="meta" themeColor="textSecondary">{tUi('source')}</ThemedText>
              <ThemedText type="small">{applePayItem ? tUi('applePayReviewSource') : tUi('genericUnverifiedIssuer')}</ThemedText>
            </View>
            <View style={styles.reviewFact}>
              <ThemedText type="meta" themeColor="textSecondary">{applePayItem ? tUi('applePayReviewObserved') : tUi('reviewAlertObservedDate')}</ThemedText>
              <ThemedText type="small">{shortDate(observedReviewDate)}</ThemedText>
            </View>
          </View>
        </View>
      ) : registeredItem ? (
        <View style={styles.reviewSummary} testID="registered-review-summary">
          <ThemedText type="smallBold">
            {tUi(registeredItem.direction === 'debit' ? 'reviewAlertMoneyOut' : 'reviewAlertMoneyIn')}
          </ThemedText>
          <View style={styles.amountWrap}>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.currency}>
              {registeredItem.amount.currency}
            </ThemedText>
            <ThemedText type="title" tabular style={styles.reviewAmount}>
              {reviewMajorAmount(registeredItem)}
            </ThemedText>
          </View>
          {rememberedReview?.title?.trim() ? <ThemedText type="smallBold">{rememberedReview.title.trim()}</ThemedText> : null}
          <View style={[styles.reviewFacts, { borderColor: theme.cardBorder }]}>
            <View style={styles.reviewFact}>
              <ThemedText type="meta" themeColor="textSecondary">{tUi('source')}</ThemedText>
              <ThemedText type="small">{registeredItem.institution.replace(/-/g, ' ')}</ThemedText>
            </View>
            {registeredItem.instrument?.last4 ? <ThemedText type="small" themeColor="textSecondary">
              {tfUi(registeredItem.instrument.kind === 'card' ? 'reviewAlertCardEnding'
                : registeredItem.instrument.kind === 'account' ? 'reviewAlertAccountEnding' : 'reviewAlertWalletEnding',
              { last4: registeredItem.instrument.last4 })}
            </ThemedText> : null}
            {state.accounts.find((account) => account.id === accountId) ? <View style={styles.reviewFact}>
              <ThemedText type="meta" themeColor="textSecondary">{tUi('account')}</ThemedText>
              <ThemedText type="small">{accountDisplayName(state.accounts.find((account) => account.id === accountId)!)}</ThemedText>
            </View> : null}
            <View style={styles.reviewFact}>
              <ThemedText type="meta" themeColor="textSecondary">{tUi('reviewAlertObservedDate')}</ThemedText>
              <ThemedText type="small">{shortDate(observedReviewDate)}</ThemedText>
            </View>
          </View>
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
              {state.ledgerMoney?.currency ?? '—'}
            </ThemedText>
          )}
          style={[styles.amountInput, { color: theme.text, fontFamily: state.language === 'ar' ? Fonts.arabicBold : Fonts.sansSemi }]}
        />
      )}

      {/* Title */}
      {!reviewItem ? <TextField
        label={tUi(genericItem ? 'genericMerchantTitle' : 'descriptionOptional')}
                value={title}
                onChangeText={setTitle}
                accessibilityLabel={tUi(genericItem ? 'genericMerchantTitle' : 'descriptionOptionalA11y')}
                maxLength={genericItem ? 80 : undefined}
                invalid={!!genericItem && (title.length > 80 || (showValidation && !title.trim()))}
                errorText={genericItem && title.length > 80 ? tUi('genericShortenTitle') : undefined}
                placeholder={type === 'expense' ? tUi('expenseExample') : tUi('incomeExample')}
              /> : null}

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

      {!reviewItem ? <View
        ref={categoryRef}
        collapsable={false}
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
        <Pressable
          testID="category-picker-trigger"
          accessibilityRole="button"
          accessibilityLabel={category ? `${tUi('category')}: ${categoryLabel(getCategory(category))}` : tUi('category')}
          accessibilityState={{ expanded: categoryPickerOpen }}
          onPress={() => setCategoryPickerOpen(true)}
          style={({ pressed }) => [styles.accountTrigger, {
            borderColor: categoryInvalid ? theme.expense : theme.controlBorder,
            backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement,
          }]}>
          {category && <Icon name={getCategory(category).icon} size={18} color={theme.textSecondary} />}
          <ThemedText type="small" style={styles.accountTriggerName}>
            {category ? categoryLabel(getCategory(category)) : tUi('category')}
          </ThemedText>
          <Icon name="chevron-down" size={16} color={theme.textSecondary} />
        </Pressable>
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
      </View> : null}

      {/* Account picker: a compact selected-pill trigger that opens a sheet.
          The old inline chip list rendered every account as its own 52-tall
          row; users with 30-40 saved cards saw the field eat the whole page.
          Hidden entirely when a review already matched a single account and
          the parsed instrument is unambiguous — that's just a re-confirmation. */}
      {(!reviewItem || !matchedAccount || event?.instrument.evidence === 'ambiguous') ? <View
        ref={accountRef}
        collapsable={false}
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
        {state.accounts.length > 0 ? (() => {
          const selected = state.accounts.find((a) => a.id === accountId) ?? null;
          const borderColor = accountInvalid ? theme.expense : selected ? selected.color : theme.controlBorder;
          return (
            <Pressable
              testID="account-picker-trigger"
              accessibilityRole="button"
              accessibilityLabel={selected ? `${tUi('account')}: ${accountDisplayName(selected)}` : tUi('reviewAlertChooseAccount')}
              accessibilityHint={tUi('reviewAlertChooseAccount')}
              onPress={() => setAccountPickerOpen(true)}
              style={({ pressed }) => [
                styles.accountTrigger,
                {
                  borderColor,
                  backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement,
                },
              ]}>
              {selected ? <>
                <View style={[styles.accountDot, { backgroundColor: selected.color }]} />
                <ThemedText type="small" style={styles.accountTriggerName} numberOfLines={1}>{accountDisplayName(selected)}</ThemedText>
              </> : <ThemedText type="small" themeColor="textSecondary" style={styles.accountTriggerName}>
                {tUi('reviewAlertChooseAccount')}
              </ThemedText>}
              <Icon name="chevron-down" size={16} color={theme.textSecondary} />
            </Pressable>
          );
        })() : null}
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
      </View> : null}

      {/* Date quick-pick */}
      {!reviewItem ? <View style={styles.fieldBlock}>
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
      </View> : null}


    </ScreenScaffold>
    <LedgerCurrencySheet
      visible={currencySheetVisible}
      value={state.ledgerMoney?.currency ?? null}
      onClose={() => setCurrencySheetVisible(false)}
      onSelect={setLedgerMoney}
    />
    <BottomSheet
      visible={categoryPickerOpen}
      onClose={() => setCategoryPickerOpen(false)}
      title={tUi('category')}
      testID="category-picker-sheet">
      <View accessibilityRole="radiogroup" accessibilityLabel={tUi('category')}>
        <CategoryChips
          categories={categories}
          selected={category}
          onToggle={(value) => { setCategory(value); setCategoryPickerOpen(false); }}
          layout="wrap"
        />
      </View>
    </BottomSheet>
    <BottomSheet
      visible={accountPickerOpen}
      onClose={() => { setAccountPickerOpen(false); setAccountSearch(''); }}
      title={tUi('account')}
      testID="account-picker-sheet">
      <View accessibilityRole="radiogroup" accessibilityLabel={tUi('account')} style={styles.pickerContent}>
        <TextField
          label={tUi('searchLabel')}
          value={accountSearch}
          onChangeText={setAccountSearch}
          placeholder={tUi('searchAccounts')}
          autoCorrect={false}
        />
        <View style={styles.pickerList}>
          {state.accounts
            .filter((a) => {
              const needle = accountSearch.trim().toLocaleLowerCase();
              return !needle || accountDisplayName(a).toLocaleLowerCase().includes(needle);
            })
            .map((a) => {
              const active = accountId === a.id;
              return (
                <Pressable
                  key={a.id}
                  accessibilityRole="radio"
                  accessibilityLabel={accountDisplayName(a)}
                  accessibilityState={{ checked: active }}
                  onPress={() => { setAccountId(a.id); setAccountPickerOpen(false); setAccountSearch(''); }}
                  style={({ pressed }) => [
                    styles.pickerRow,
                    {
                      borderColor: theme.cardBorder,
                      backgroundColor: active ? `${a.color}22` : pressed ? theme.backgroundSelected : 'transparent',
                    },
                  ]}>
                  <View style={[styles.accountDot, { backgroundColor: a.color }]} />
                  <ThemedText type="small" style={styles.pickerRowName} numberOfLines={2}>{accountDisplayName(a)}</ThemedText>
                  {active && <Icon name="check" size={18} color={theme.primary} strokeWidth={2.4} />}
                </Pressable>
              );
            })}
        </View>
      </View>
    </BottomSheet>
    </>
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
  reviewSummary: { gap: Spacing.two },
  reviewFacts: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.three, gap: Spacing.three },
  reviewFact: { gap: Spacing.one },
  amountWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  currency: {
    fontSize: 18,
  },
  currencyPicker: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Radius.control,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  currencyPickerCopy: { flex: 1, minWidth: 0, gap: 2 },
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
  accountTrigger: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three - 2,
    paddingVertical: Spacing.two,
    borderRadius: Radius.control,
    borderWidth: 1.5,
  },
  accountTriggerName: { flex: 1, minWidth: 0 },
  accountDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  pickerContent: { gap: Spacing.three - 2, maxHeight: 480 },
  pickerList: { gap: 0 },
  pickerRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three - 4,
    paddingHorizontal: Spacing.three - 4,
    paddingVertical: Spacing.two + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  pickerRowName: { flex: 1, minWidth: 0 },
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
