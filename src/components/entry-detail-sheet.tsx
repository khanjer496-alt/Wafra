import React, { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MerchantSpendingLink } from '@/components/merchant-spending-link';
import { accountDisplayName, isTransfer as isLedgerTransfer, isUnassignedIncome } from '@/lib/ledger';
import { isTransferCandidate, transferOwnership, type TransferAssessment } from '@/lib/transfer-reconciliation';
import { transferReviewCopy } from '@/lib/transfer-review-copy';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { CategoryChips } from '@/components/ui/category-chips';
import { ChoiceSheet } from '@/components/ui/choice-sheet';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Button, Toggle } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { LabelTable } from '@/components/ui/layout';
import { Money } from '@/components/ui/money';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import { TextField } from '@/components/ui/text-field';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useTheme } from '@/hooks/use-theme';
import { categoryLabel, EXPENSE_CATEGORIES, getCategory, INCOME_CATEGORIES } from '@/lib/categories';
import { formatAmount, formatAmountForInput, friendlyDate, fullDateTime, parseAmountToFils, shortDate, toISODate } from '@/lib/format';
import { formatOriginalCurrency, originalMoneyOf } from '@/lib/fx';
import { ledgerCurrencyCode } from '@/lib/markets';
import { overrideFitsDirection } from '@/lib/sms-parser';
import { useStore } from '@/lib/store';
import { overrideAppliesTo } from '@/lib/uncategorised';
import { entryDetailCopy } from '@/lib/reference-copy';
import { transactionSource } from '@/lib/transaction-source';
import { billAliasAppliesTo } from '@/lib/bill-alias';
import type { CategoryId, Transaction, TransactionType } from '@/lib/types';
import { t, tf } from '@/lib/i18n';

/**
 * Which state the sheet opens in: reading the entry, choosing its category,
 * or confirming it as a transfer (the row swipe actions open the last two).
 */
export type EntryDetailMode = 'read' | 'category' | 'transfer';

interface EntryDetailSheetProps {
  /** The entry to show, or null to keep the sheet closed. */
  transaction: Transaction | null;
  onClose: () => void;
  showMerchantLink?: boolean;
  /** Current ledger assessment for transfer-history presentation, never a saved decision. */
  transferAssessment?: TransferAssessment;
  initialMode?: EntryDetailMode;
}

/**
 * One entry, read before it is written.
 *
 * The old sheet opened straight into a form, so the commonest reason to tap a
 * row — "what actually was this?" — was answered by six input boxes. Reading
 * comes first now; editing is one tap away.
 */
export function EntryDetailSheet({ transaction, onClose, showMerchantLink = true, transferAssessment, initialMode = 'read' }: EntryDetailSheetProps) {
  const router = useRouter();
  const theme = useTheme();
  const language = useLanguage();
  const extra = entryDetailCopy[language === 'ar' ? 'ar' : 'en'];
  const largeText = useLargeTextLayout();
  const { state, editTransaction, deleteTransaction, resolveBestEffort, setMerchantOverride, setBillAlias } = useStore();
  const [editing, setEditing] = useState(false);

  const [title, setTitle] = useState('');
  const [amountText, setAmountText] = useState('');
  const [category, setCategory] = useState<CategoryId>('other');
  const [accountId, setAccountId] = useState('');
  const [dateText, setDateText] = useState('');
  const [isTransfer, setIsTransfer] = useState(false);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingUndo, setConfirmingUndo] = useState(false);
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [accountSearch, setAccountSearch] = useState('');
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
    type: TransactionType;
    count: number;
  } | null>(null);
  const [billRuleAsk, setBillRuleAsk] = useState<{
    sourceTitle: string;
    billIdentity: string;
    title: string;
    category: CategoryId;
    count: number;
  } | null>(null);
  // The category sheet state (a clear Cancel/Done choice) and the direct
  // "Mark as transfer" confirmation. Declared after the older states.
  const [categoryPicking, setCategoryPicking] = useState(false);
  const [pickedCategory, setPickedCategory] = useState<CategoryId>('other');
  const [confirmingTransfer, setConfirmingTransfer] = useState(false);

  useEffect(() => {
    if (!transaction) return;
    setEditing(false);
    setConfirmingDelete(false);
    setRuleAsk(null);
    setBillRuleAsk(null);
    setPickedCategory(transaction.category);
    setCategoryPicking(initialMode === 'category');
    setConfirmingTransfer(initialMode === 'transfer');
    setTitle(transaction.title);
    // The FULL amount, fils included. Seeding the field from the display
    // string — which hides the fils — meant opening an entry and saving any
    // other change rewrote its amount: AED 76.99 came back as 77, and the row
    // was stamped userEdited, so no re-parse could ever heal it. Below a
    // dirham it was worse; 0.49 seeded "0", which fails validation, and the
    // entry could not be saved at all.
    setAmountText(formatAmountForInput(transaction.amountFils, { decimals: true }));
    setCategory(transaction.category);
    setAccountId(transaction.accountId);
    setDateText(transaction.date);
    setIsTransfer(isLedgerTransfer(transaction));
    // Keyed on the entry's id, not the object. Callers that hold the row in
    // their own state pass a stable reference, but the assistant's evidence
    // sheet derives it from a map rebuilt out of the store — so a background
    // import tick handed this a new object for the SAME entry and wiped the
    // fields the user was part-way through typing, flipping `editing` off.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transaction?.id]);

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
  const countMerchantMatches = (merchant: string, nextCategory: CategoryId) => {
    if (!transaction) return 0;
    const key = merchant.trim().toLowerCase();
    if (key.length < 3) return 0;
    // Count the same direction and exclusions the rule will actually update.
    if (!overrideFitsDirection(nextCategory, transaction.type)) return 0;
    return state.transactions.filter(
      (t) => t.id !== transaction.id && overrideAppliesTo(t, key, transaction.type),
    ).length;
  };

  if (!transaction) return null;

  const meta = getCategory(transaction.category);
  const transferReview = isTransferCandidate(transaction) || transferAssessment !== undefined;
  const transferWords = transferReviewCopy();
  const ownership = transferAssessment?.status === 'confirmed-own' ? 'own'
    : transferAssessment?.status === 'confirmed-external' ? 'external'
      : transferOwnership(transaction);
  const confirmedTransfer = ownership === 'own' || isLedgerTransfer(transaction);
  const confirmedOwnTransfer = ownership === 'own';
  const pendingTransfer = !confirmedTransfer && isTransferCandidate(transaction) && ownership === 'unknown';
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
      ...(!transferReview ? { isTransfer: isTransfer || undefined } : {}),
      ...(receiptAccountChanged ? { paymentInstrumentSource: 'user' as const } : {}),
      // Saving a correction is the person checking the row.
      ...(transaction.bestEffort ? { bestEffort: undefined } : {}),
    });
    const merchant = title.trim();
    const billChanged = transaction.paymentFlowSide === 'receipt' && !!transaction.billIdentity &&
      (merchant !== transaction.title || categoryChanged);
    if (billChanged) {
      setBillRuleAsk({
        sourceTitle: transaction.title,
        billIdentity: transaction.billIdentity!,
        title: merchant,
        category,
        count: state.transactions.filter((candidate) =>
          candidate.id !== transaction.id &&
          billAliasAppliesTo(candidate, transaction.title, transaction.billIdentity!)).length,
      });
      return;
    }
    if (categoryChanged && merchant.length > 2) {
      // The rule question is drawn from inside this sheet now, so the sheet
      // cannot close first the way it did when the question was an OS dialog
      // that outlived it. It closes when the question is answered — or
      // dismissed, which is the "No" the alert used to spell out.
      setRuleAsk({ merchant, category, type: transaction.type, count: countMerchantMatches(merchant, category) });
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

  const closeBillRule = () => {
    setBillRuleAsk(null);
    onClose();
  };

  const removeEntry = () => {
    deleteTransaction(transaction.id);
    onClose();
  };

  // The category sheet commits through the same edit and the same
  // remember-for-merchant question as Save, with its future-only / update-all
  // choice and the count of other entries it would move.
  const cancelCategory = () => {
    setCategoryPicking(false);
    setPickedCategory(transaction.category);
    if (initialMode === 'category') onClose();
  };
  const commitCategory = () => {
    setCategoryPicking(false);
    const next = pickedCategory;
    if (next === transaction.category) {
      if (initialMode === 'category') onClose();
      return;
    }
    editTransaction(transaction.id, {
      category: next,
      ...(transaction.bestEffort ? { bestEffort: undefined } : {}),
    });
    const merchant = transaction.title.trim();
    if (transaction.paymentFlowSide === 'receipt' && transaction.billIdentity) {
      setBillRuleAsk({
        sourceTitle: transaction.title,
        billIdentity: transaction.billIdentity,
        title: merchant,
        category: next,
        count: state.transactions.filter((candidate) =>
          candidate.id !== transaction.id &&
          billAliasAppliesTo(candidate, transaction.title, transaction.billIdentity!)).length,
      });
      return;
    }
    if (merchant.length > 2) {
      setRuleAsk({ merchant, category: next, type: transaction.type, count: countMerchantMatches(merchant, next) });
      return;
    }
    onClose();
  };
  // The same flag the edit form's transfer toggle writes, after a confirm.
  const markAsTransfer = () => {
    editTransaction(transaction.id, {
      isTransfer: true,
      ...(transaction.bestEffort ? { bestEffort: undefined } : {}),
    });
    onClose();
  };

  // A notification capture is stored with `source: 'sms'` and `viaPush`, so
  // reading `source` alone called every bank-app alert an SMS. That is not
  // cosmetic: which channel a row came from is the first thing anyone asks
  // when a charge looks wrong, and the wrong answer sends them looking for a
  // message their bank never sent.
  const sourceKind = transactionSource(transaction);
  const sourceLabel = sourceKind === 'notification' ? t('bankNotificationSource')
    : sourceKind === 'bank-text' ? t('bankSmsSource')
      : sourceKind === 'apple-pay' ? extra.applePay
        : sourceKind === 'statement' ? transaction.captureSource === 'csv' ? extra.statementCsv : extra.statementPdf
          : sourceKind === 'email' ? extra.bankEmail
            : t('addedByHand');
  // Marking a transfer directly is offered only where the edit form's toggle
  // would be: not for rows the transfer review owns, not for transfers.
  const canMarkTransfer = !transferReview && !confirmedTransfer && !pendingTransfer;
  const originalMoney = originalMoneyOf(transaction);
  const fxSourceLabel =
    transaction.fxSource === 'bank'
      ? tf('bankQuotedRate', { currency: ledgerCurrencyCode() })
      : transaction.fxSource === 'reference' && transaction.fxRateDate
        ? tf('datedReferenceRate', { date: shortDate(transaction.fxRateDate) })
        : t('offlineFxEstimate');
  // The original amount and the rate under the headline figure, labelled by
  // where the rate came from (bank-stated, dated reference, or an estimate).
  const fxLine = originalMoney && transaction.fxRate !== undefined
    ? `${formatOriginalCurrency(originalMoney.minorUnits, originalMoney.currency, state.language === 'ar' ? 'ar' : 'en', originalMoney.exponent)} · ${tf('fxRateValue', {
      from: originalMoney.currency,
      to: ledgerCurrencyCode(),
      rate: transaction.fxRate >= 0.01 ? transaction.fxRate.toFixed(4) : String(Number(transaction.fxRate.toPrecision(4))),
      source: fxSourceLabel,
    })}`
    : null;

  return (
    <BottomSheet
      visible
      testID="entry-detail-sheet"
      onClose={onClose}
      title={categoryPicking ? t('category') : editing ? t('editEntry') : t('entryDetail')}
      footer={categoryPicking ? (
          <View testID="entry-detail-actions" style={[styles.actions, largeText && styles.actionsLarge]}>
            <Button inline={!largeText} wrapLabel variant="outline" label={t('cancel')} onPress={cancelCategory} />
            <Button inline={!largeText} wrapLabel label={extra.done} onPress={commitCategory} />
          </View>
      ) : editing ? (
          <View testID="entry-detail-actions" style={[styles.actions, largeText && styles.actionsLarge]}>
            <Button inline={!largeText} wrapLabel label={t('saveChanges')} onPress={save} disabled={!canSave} />
            <Button inline={!largeText} wrapLabel variant="outline" label={t('cancel')} onPress={() => setEditing(false)} />
          </View>
      ) : (
          <View testID="entry-detail-actions" style={[styles.actions, largeText && styles.actionsLarge]}>
            <Button inline={!largeText} wrapLabel label={t('editEntry')} onPress={() => setEditing(true)} />
            <Button
              inline={!largeText}
              wrapLabel
              variant="ghost"
              labelColor={theme.expense}
              label={t('delete')}
              onPress={() => setConfirmingDelete(true)}
            />
          </View>
      )}>
      <View style={[styles.head, editing && styles.editHead, { borderColor: theme.cardBorder }]}>
        {!editing && <MerchantAvatar title={transaction.title} category={transaction.category} size={52} />}
        <ThemedText type={editing ? "smallBold" : "heading"} style={editing ? styles.editHeadTitle : styles.headTitle}>
          {transaction.title}
        </ThemedText>
        {!editing && <ThemedText type="meta" themeColor="textTertiary" style={styles.headDate}>
          {friendlyDate(transaction.date, toISODate(new Date()))}
        </ThemedText>}
        {/* Decimals on. This sheet exists to answer "what exactly was this",
            and it sat above an edit field showing 72.73 while itself reading
            −73. Lists round; the place you go to check does not. */}
        <Money
          fils={transaction.amountFils}
          type={editing ? "smallBold" : "sheetAmount"}
          sign={income ? 'plus' : 'minus'}
          prefix
          decimals
          color={income && !pendingTransfer && !confirmedTransfer ? theme.income : theme.text}
          style={editing ? styles.editHeadAmount : styles.headAmount}
        />
        {!editing && fxLine ? <ThemedText type="meta" themeColor="textSecondary" tabular testID="entry-fx-line" style={styles.fxLine}>
          {fxLine}</ThemedText> : null}
      </View>

      {categoryPicking ? (
        <View style={styles.field} testID="entry-category-picker">
          <ThemedText type="meta" themeColor="textTertiary">{extra.chooseCategory}</ThemedText>
          <CategoryChips categories={categories} selected={pickedCategory} onToggle={setPickedCategory} layout="wrap" />
        </View>
      ) : null}
      {!categoryPicking && <>

      {(confirmedOwnTransfer || pendingTransfer) && (
        <View
          testID={confirmedOwnTransfer ? 'own-transfer-explainer' : 'pending-transfer-explainer'}
          style={[styles.transferMeaning, { borderColor: theme.cardBorder, backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="smallBold">
            {confirmedOwnTransfer ? transferWords.confirmedOwn : transferWords.ownershipUnknown}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {confirmedOwnTransfer ? transferWords.ownBody : transferWords.pendingBody}
          </ThemedText>
        </View>
      )}

      {!editing && transaction.bestEffort && (
        <View
          testID="best-effort-check"
          style={[styles.transferMeaning, { borderColor: theme.cardBorder, backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="smallBold">{t('autoAddedCheck')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{t('autoAddedExplain')}</ThemedText>
          <View style={[styles.actions, largeText && styles.actionsLarge]}>
            <Button inline={!largeText} wrapLabel label={t('autoAddedLooksRight')}
              onPress={() => resolveBestEffort(transaction.id, 'confirm')} />
            <Button inline={!largeText} wrapLabel variant="outline" label={t('autoAddedUndo')}
              onPress={() => setConfirmingUndo(true)} />
          </View>
          <ThemedText type="meta" themeColor="textTertiary">{t('autoAddedUndoHint')}</ThemedText>
        </View>
      )}

      {transferReview && <View style={styles.field} testID="entry-transfer-review">
        {pendingTransfer && <ThemedText type="small" themeColor="textSecondary">{transferWords.noticeBody}</ThemedText>}
        <Button variant="outline" wrapLabel label={transferWords.title} onPress={() => {
          onClose();
          router.push({ pathname: '/review-transfers', params: { transactionId: transaction.id } });
        }} />
      </View>}
      {!editing && canMarkTransfer && <Button variant="outline" wrapLabel icon="repeat" label={extra.markTransfer}
        onPress={() => setConfirmingTransfer(true)} />}
      {!editing && showMerchantLink && !confirmedTransfer && !pendingTransfer && transaction.title.trim() &&
        <MerchantSpendingLink merchant={transaction.title} type={transaction.type} onClose={onClose} />}
      {isUnassignedIncome(transaction) && <ThemedText type="small" themeColor="textSecondary" testID="income-account-review">
        {t('incomeAccountReviewBody')}</ThemedText>}

      {editing ? (
        <>
          <View style={styles.field}>
            <ThemedText type="meta" themeColor="textTertiary">
              {t('description')}
            </ThemedText>
            <TextInput
              accessibilityLabel={t('description')}
              value={title}
              onChangeText={setTitle}
              placeholderTextColor={theme.textTertiary}
              selectionColor={theme.primary}
              style={[styles.input, { borderColor: theme.cardBorderStrong, backgroundColor: theme.card, color: theme.text, fontFamily: state.language === 'ar' ? Fonts.arabic : Fonts.sans, textAlign: state.language === 'ar' ? 'right' : 'left' }]}
            />
          </View>

          <View style={[styles.pairRow, largeText && { flexDirection: 'column' }]}>
            <View style={[styles.field, styles.flex]}>
              <ThemedText type="meta" themeColor="textTertiary">
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
                  { borderColor: theme.cardBorderStrong, backgroundColor: theme.card, fontFamily: state.language === 'ar' ? Fonts.arabic : Fonts.sans, color: amountFils ? theme.text : theme.expense },
                ]}
              />
            </View>
            <View style={[styles.field, styles.flex]}>
              <ThemedText type="meta" themeColor="textTertiary">
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
                  { borderColor: theme.cardBorderStrong, backgroundColor: theme.card, color: dateValid ? theme.text : theme.expense },
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
              <ThemedText type="meta" themeColor="textTertiary">
                {t('category')}
              </ThemedText>
              <CategoryChips categories={categories} selected={category} onToggle={setCategory} layout="wrap" />
            </View>
          )}

          <View style={styles.field}>
            <ThemedText type="meta" themeColor="textTertiary">
              {t('account')}
            </ThemedText>
            {(() => {
              const selected = state.accounts.find((a) => a.id === accountId) ?? null;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={selected ? `${t('account')}: ${accountDisplayName(selected)}` : t('account')}
                  onPress={() => setAccountPickerOpen(true)}
                  style={({ pressed }) => [
                    styles.accountTrigger,
                    {
                      borderColor: selected ? selected.color : theme.controlBorder,
                      backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement,
                    },
                  ]}>
                  {selected ? <>
                    <View style={[styles.accountDot, { backgroundColor: selected.color }]} />
                    <ThemedText type="small" style={styles.accountTriggerName} numberOfLines={1}>{accountDisplayName(selected)}</ThemedText>
                  </> : <ThemedText type="small" themeColor="textSecondary" style={styles.accountTriggerName}>
                    {t('account')}
                  </ThemedText>}
                  <Icon name="chevron-down" size={16} color={theme.textSecondary} />
                </Pressable>
              );
            })()}
          </View>

          <View style={styles.transferRow}>
            <View style={styles.flex}>
              <ThemedText type="small">{t('transferBetweenMine')}</ThemedText>
              <ThemedText type="meta" themeColor="textTertiary">
                {t('transferExplainer')}
              </ThemedText>
            </View>
            {!transferReview && <Toggle
              value={isTransfer}
              onChange={setIsTransfer}
              label={t('transferBetweenMine')}
            />}
          </View>


        </>
      ) : (
        <>
          <LabelTable
            rows={[
              {
                label: t('category'),
                value: confirmedTransfer || pendingTransfer ? (
                  <ThemedText type="small">{pendingTransfer ? transferWords.ownershipUnknown
                    : confirmedOwnTransfer ? transferWords.confirmedOwn : t('transferLabel')}</ThemedText>
                ) : (
                  <ThemedText
                    type="small"
                    accessibilityRole="button"
                    onPress={() => { setPickedCategory(transaction.category); setCategoryPicking(true); }}
                    style={{ color: theme.primary }}>
                    {categoryLabel(meta)}
                  </ThemedText>
                ),
              },
              {
                label: t('account'),
                value: <ThemedText type="small">{account ? accountDisplayName(account) : t('unassigned')}</ThemedText>,
              },
              {
                label: t('source'),
                value: <ThemedText type="small">{sourceLabel}</ThemedText>,
              },
              {
                label: t('transactionDateLabel'),
                value: <ThemedText type="small">{stamp}</ThemedText>,
              },
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




        </>
      )}

      </>}

      {/* Both of these are nested inside this sheet rather than rendered beside
          it: a Modal presented from within the presented one stacks, where
          dismissing this sheet and presenting another in the same frame does
          not. Each is mounted only while it has something to ask, so the entry
          animation runs on every open. */}
      {confirmingUndo && (
        <ConfirmSheet
          visible
          onClose={() => setConfirmingUndo(false)}
          question={t('autoAddedUndoConfirm')}
          body={`${transaction.title} · ${formatAmount(transaction.amountFils)}. ${t('autoAddedUndoHint')}`}
          confirmLabel={t('autoAddedUndo')}
          destructive
          onConfirm={() => { resolveBestEffort(transaction.id, 'undo'); onClose(); }}
        />
      )}
      {confirmingTransfer && canMarkTransfer && (
        <ConfirmSheet
          visible
          onClose={() => { setConfirmingTransfer(false); if (initialMode === 'transfer') onClose(); }}
          question={extra.markTransferQuestion}
          body={`${transaction.title} · ${formatAmount(transaction.amountFils)}. ${extra.markTransferBody}`}
          confirmLabel={extra.markTransfer}
          onConfirm={markAsTransfer}
        />
      )}
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
          onSelect={(scope) => setMerchantOverride(ruleAsk.merchant, ruleAsk.category, scope === 'all', ruleAsk.type)}
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
          onConfirm={() => setMerchantOverride(ruleAsk.merchant, ruleAsk.category, false, ruleAsk.type)}
        />
      )}
      {billRuleAsk && billRuleAsk.count > 0 && (
        <ChoiceSheet
          visible
          onClose={closeBillRule}
          title={t('remember')}
          question={t('rememberThisBill')}
          body={tf('billAliasAlso', {
            title: billRuleAsk.title,
            category: categoryLabel(billRuleAsk.category),
            n: billRuleAsk.count,
            s: billRuleAsk.count === 1 ? '' : 's',
          })}
          options={[
            { value: 'future', label: t('justFuture') },
            { value: 'all', label: t('yesUpdateAll') },
          ]}
          onSelect={(scope) => setBillAlias(
            billRuleAsk.sourceTitle,
            billRuleAsk.billIdentity,
            billRuleAsk.title,
            billRuleAsk.category,
            scope === 'all',
          )}
        />
      )}
      {billRuleAsk && billRuleAsk.count === 0 && (
        <ConfirmSheet
          visible
          onClose={closeBillRule}
          question={t('rememberThisBill')}
          body={tf('billAliasFuture', {
            title: billRuleAsk.title,
            category: categoryLabel(billRuleAsk.category),
          })}
          confirmLabel={t('remember')}
          cancelLabel={t('no')}
          onConfirm={() => setBillAlias(
            billRuleAsk.sourceTitle,
            billRuleAsk.billIdentity,
            billRuleAsk.title,
            billRuleAsk.category,
            false,
          )}
        />
      )}
      <BottomSheet
        visible={accountPickerOpen}
        onClose={() => { setAccountPickerOpen(false); setAccountSearch(''); }}
        title={t('account')}
        testID="entry-detail-account-picker">
        <View style={styles.pickerContent}>
          <TextField
            label={t('searchLabel')}
            value={accountSearch}
            onChangeText={setAccountSearch}
            placeholder={t('searchAccounts')}
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
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'column',
    paddingVertical: 16,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  editHead: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: Spacing.two, paddingHorizontal: 0, paddingVertical: Spacing.two },
  editHeadTitle: { flexShrink: 1 },
  editHeadAmount: { alignSelf: 'center' },
  headTitle: {
    textAlign: 'center',
    marginTop: 8,
    maxWidth: '90%',
  },
  headDate: {
    textAlign: 'center',
  },
  headAmount: {
    alignSelf: 'center',
    marginTop: 8,
  },
  fxLine: { textAlign: 'center' },
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
    fontFamily: Fonts.sans,
    fontSize: 16,
    minHeight: 52,
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
  transferMeaning: {
    gap: Spacing.one,
    borderWidth: 1,
    borderRadius: Radius.control,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
  },
  actionsLarge: { flexDirection: 'column' },
  actions: {
    flexShrink: 0,
    flexDirection: 'row',
    gap: Spacing.two + 2,
  },
  raw: {
    fontSize: 12.5,
    lineHeight: 18,
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
  accountDot: { width: 10, height: 10, borderRadius: 5 },
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
});
