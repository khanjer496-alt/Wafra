import { useCategoryCatalog } from '@/hooks/use-category-catalog';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MerchantSpendingLink } from '@/components/merchant-spending-link';
import { accountDisplayName, isMoneyMovementOnly, isTransfer as isLedgerTransfer, isUnassignedIncome, cachedTransferReconciliationForState } from '@/lib/ledger';
import { canMarkOwnTransfer, isTransferCandidate, transferOwnership, type TransferAssessment } from '@/lib/transfer-reconciliation';
import { currentAnswer, ownCandidates, transferFingerprintsOf, type TransferAnswer } from '@/lib/transfer-answer';
import { transferActivityCopy } from '@/lib/transfer-activity-copy';
import { useTransferAnswer } from '@/hooks/use-transfer-answer';
import { TransferAnswerChoices } from '@/components/transfers/transfer-answer-choices';
import { transferReviewCopy } from '@/lib/transfer-review-copy';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { CategoryChips } from '@/components/ui/category-chips';
import { ChoiceSheet } from '@/components/ui/choice-sheet';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { BandFigure } from '@/components/ui/band/band-figure';
import { EButton } from '@/components/ui/band/e-button';
import { Icon } from '@/components/ui/icon';
import { LabelTable } from '@/components/ui/layout';
import { Money } from '@/components/ui/money';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import { TextField } from '@/components/ui/text-field';
import { BandLayout, Fonts, Radius, Spacing, type BandId } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useTheme } from '@/hooks/use-theme';

import { formatAmount, formatAmountForInput, friendlyDate, fullDateTime, parseAmountToFils, shortDate, toISODate } from '@/lib/format';
import { formatOriginalCurrency, originalMoneyOf } from '@/lib/fx';
import { ledgerCurrencyCode } from '@/lib/markets';
import { overrideFitsDirection } from '@/lib/sms-parser';
import { useStore } from '@/lib/store';
import { overrideAppliesTo } from '@/lib/uncategorised';
import { entryDetailCopy } from '@/lib/reference-copy';
import { transactionSource } from '@/lib/transaction-source';
import { maskLedgerIdentifiers, transactionPresentation, transactionPresentationWords } from '@/lib/transaction-presentation';
import { billAliasAppliesTo } from '@/lib/bill-alias';
import type { CategoryId, Transaction, TransactionType } from '@/lib/types';
import { t, tf } from '@/lib/i18n';

/**
 * Which state the sheet opens in: reading the entry, or choosing its category
 * (the Category row swipe). The Transfer swipe opens it in read mode, where a
 * transfer candidate asks "What is this?".
 */
export type EntryDetailMode = 'read' | 'category';

interface EntryDetailSheetProps {
  /** The entry to show, or null to keep the sheet closed. */
  transaction: Transaction | null;
  onClose: () => void;
  showMerchantLink?: boolean;
  /** Current ledger assessment for transfer-history presentation, never a saved decision. */
  transferAssessment?: TransferAssessment;
  initialMode?: EntryDetailMode;
  /**
   * Open on the "which account?" picker when several accounts could be the
   * other side (Transfers sets it after the person chose "own" on its card).
   */
  startWithAccountPicker?: boolean;
  /**
   * The band of the screen it opens over (design language E): the sheet is
   * that screen's sheet, lifted, and its Done button takes the band colour.
   * Transactions and Home are ink.
   */
  band?: BandId;
  /**
   * The screen's own transfer answer hook (Transfers passes its one), so the
   * screen knows while this sheet saves or clears an answer and holds its
   * controls. Without it the sheet uses its own.
   */
  transferAnswers?: Pick<ReturnType<typeof useTransferAnswer>, 'answer' | 'undo' | 'busy'>;
}

/**
 * One entry, read before it is written.
 *
 * The old sheet opened straight into a form, so the commonest reason to tap a
 * row — "what actually was this?" — was answered by six input boxes. Reading
 * comes first now; editing is one tap away.
 */
export function EntryDetailSheet({ transaction, onClose, showMerchantLink = true, transferAssessment: passedAssessment, initialMode = 'read', startWithAccountPicker = false, band: bandId = 'home', transferAnswers }: EntryDetailSheetProps) {
  const { getCategory, categoryLabel, expenseCategories, incomeCategories } = useCategoryCatalog();
  const theme = useTheme();
  const band = useBand(bandId);
  const language = useLanguage();
  const extra = entryDetailCopy[language === 'ar' ? 'ar' : 'en'];
  const largeText = useLargeTextLayout();
  const { state, editTransaction, deleteTransaction, resolveBestEffort, setMerchantOverride, setBillAlias } = useStore();
  // Transactions and Transfers pass the assessment from the reconciliation they
  // already hold. Every other sheet (account, Flow, Home, card, merchant, ...)
  // reads the one already cached for the stored transfer receipt, so a confirmed
  // pair shows its answer and link and "own" can link the other side. Only a
  // cache read, and only while an entry is shown: opening an entry must never
  // walk the ledger's transfer graph. Without a cached result (a provisional
  // import receipt, a restored ledger with none) the row answers for itself.
  const transferAssessment = passedAssessment ?? (transaction
    ? cachedTransferReconciliationForState(state)?.byId.get(transaction.id) : undefined);
  const [editing, setEditing] = useState(false);

  const [title, setTitle] = useState('');
  const [amountText, setAmountText] = useState('');
  const [category, setCategory] = useState<CategoryId>('other');
  const [accountId, setAccountId] = useState('');
  const [dateText, setDateText] = useState('');

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
  // The category sheet state: a clear Cancel/Done choice. Declared after the older states.
  const [categoryPicking, setCategoryPicking] = useState(false);
  const [pickedCategory, setPickedCategory] = useState<CategoryId>('other');
  // The "What is this?" answer. Like every hook here it runs before the early return below.
  const ownAnswers = useTransferAnswer();
  const { answer, undo, busy } = transferAnswers ?? ownAnswers;
  const activityWords = transferActivityCopy(language);
  const answerWords = activityWords.answers;
  const rowsById = useMemo(() => new Map(state.transactions.map(row => [row.id, row] as const)), [state.transactions]);
  const opensOnPicker = () => startWithAccountPicker && !!transaction &&
    ownCandidates(transaction, transferAssessment, rowsById).length > 1;
  const [picking, setPicking] = useState(opensOnPicker);

  useEffect(() => {
    if (!transaction) return;
    setEditing(false);
    setConfirmingDelete(false);
    setRuleAsk(null);
    setBillRuleAsk(null);
    setPickedCategory(transaction.category);
    setCategoryPicking(initialMode === 'category');
    setPicking(opensOnPicker());
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
  const sourceKind = transactionSource(transaction);
  const transferReview = isTransferCandidate(transaction) || transferAssessment !== undefined;
  const transferWords = transferReviewCopy();
  const ownership = transferAssessment?.status === 'confirmed-own' ? 'own'
    : transferAssessment?.status === 'confirmed-external' ? 'external'
      : transferOwnership(transaction);
  const confirmedTransfer = ownership === 'own' || isLedgerTransfer(transaction);
  const confirmedOwnTransfer = ownership === 'own';
  const presentation = transactionPresentation(transaction, language, confirmedOwnTransfer);
  const presentationWords = transactionPresentationWords(language);
  const pendingTransfer = !confirmedTransfer && isTransferCandidate(transaction) && ownership === 'unknown';
  // A confirmed transfer has no spending category to edit.
  const isTransfer = isLedgerTransfer(transaction);
  const transferCandidate = isTransferCandidate(transaction);
  const answered = currentAnswer(transaction, transferAssessment);
  const candidates = ownCandidates(transaction, transferAssessment, rowsById);
  // Only a confirmed pair is linked; a likely-own counterpart is a suggestion, not a link.
  const linkedTo = transferAssessment?.status === 'confirmed-own' && transferAssessment.counterpartId
    ? rowsById.get(transferAssessment.counterpartId) : undefined;
  // The likely other side while it is still a suggestion: a matching entry on another of the person's
  // accounts or cards (same amount, close in time), shown under "my own account" as "Looks like your …".
  // Only a likely own-account pair is linked when answered; a likely card repayment is saved as own
  // without a link (ownCandidates offers nothing for it), so neither is ever called "Linked to".
  const suggestedOther = !answered && transferAssessment?.counterpartId &&
    (transferAssessment.status === 'likely-own' || transferAssessment.status === 'likely-card-repayment')
    ? rowsById.get(transferAssessment.counterpartId) : undefined;
  const answerLabels = transaction.type === 'income' ? answerWords.in : answerWords.out;
  const accountLabelFor = (id: string) => {
    const found = state.accounts.find((a) => a.id === id);
    return found ? accountDisplayName(found) : activityWords.accountUnknown;
  };
  const account = state.accounts.find((a) => a.id === transaction.accountId);
  const income = transaction.type === 'income';
  const categories = income ? incomeCategories : expenseCategories;

  const amountFils = parseAmountToFils(amountText);
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(dateText);
  // PDF/CSV relay clocks are synthetic. Show the recorded date, not a fake time.
  const stamp = fullDateTime(sourceKind === 'statement' ? { date: transaction.date } : transaction);
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
  // The one-tap own-account action for an ordinary row. The row is then a
  // transfer candidate, so reopening it offers the three answers (and "Not a
  // transfer") to change it.
  const markAsTransfer = () => {
    editTransaction(transaction.id, {
      isTransfer: true,
      ...(transaction.bestEffort ? { bestEffort: undefined } : {}),
    });
    onClose();
  };
  // The way back for a captured row marked above: it is not a candidate (only
  // manual rows count the flag), so it has no question to change the answer.
  const unmarkTransfer = () => {
    editTransaction(transaction.id, {
      isTransfer: undefined,
      ...(transaction.bestEffort ? { bestEffort: undefined } : {}),
    });
    onClose();
  };

  // Close the sheet and reset the picker only when the answer is applied
  // ('saved', or 'unsaved' = applied in memory with the write still pending).
  // The hook has already told the person about every other outcome.
  const choose = async (next: TransferAnswer, counterpart?: Transaction) => {
    // The answer already shown, with the same link (or none), changes nothing: save nothing.
    if (next === answered && (next !== 'own' || counterpart?.id === linkedTo?.id)) {
      setPicking(false);
      return;
    }
    const outcome = await answer({ transaction, answer: next, counterpart, label: answerLabels[next] });
    if (outcome === 'saved' || outcome === 'unsaved') {
      setPicking(false);
      onClose();
    }
  };

  // A notification capture is stored with `source: 'sms'` and `viaPush`, so
  // reading `source` alone called every bank-app alert an SMS. That is not
  // cosmetic: which channel a row came from is the first thing anyone asks
  // when a charge looks wrong, and the wrong answer sends them looking for a
  // message their bank never sent.
  const sourceLabel = sourceKind === 'notification' ? t('bankNotificationSource')
    : sourceKind === 'bank-text' ? t('bankSmsSource')
      : sourceKind === 'apple-pay' ? extra.applePay
        : sourceKind === 'statement' ? transaction.captureSource === 'csv' ? extra.statementCsv : extra.statementPdf
          : sourceKind === 'email' ? extra.bankEmail
            : t('addedByHand');
  // The own-account action is for ordinary rows only: a transfer candidate
  // answers through the question below, and a transfer is already one.
  // Rows the system flags itself (card payments, payment flows, salary, settlement titles) get neither.
  const canMarkTransfer = !transferReview && !confirmedTransfer && !pendingTransfer &&
    canMarkOwnTransfer(transaction) && !transaction.isTransfer;
  const canUnmarkTransfer = canMarkOwnTransfer(transaction) && transaction.isTransfer === true;
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

  // The read footer's three actions; the order is the layout's (see footer).
  const readDelete = <EButton key="delete" palette={{ ...band, tint: band.statusOver }} size="compact" variant="quiet"
    label={t('delete')} onPress={() => setConfirmingDelete(true)} style={styles.quietAction} />;
  const readEdit = <EButton key="edit" palette={band} size="compact" variant="secondary" label={extra.edit}
    accessibilityLabel={t('editEntry')} onPress={() => setEditing(true)} style={styles.rowAction} />;
  const readDone = <EButton key="done" palette={band} size="compact" label={extra.done} onPress={onClose}
    testID="entry-detail-done" style={styles.rowAction} />;

  return (
    <BottomSheet
      visible
      testID="entry-detail-sheet"
      onClose={onClose}
      title={categoryPicking ? t('category') : editing ? t('editEntry') : t('entryDetail')}
      palette={band}
      footer={categoryPicking ? (
          <View testID="entry-detail-actions" style={[styles.actions, largeText && styles.actionsLarge]}>
            <EButton palette={band} size="compact" variant="secondary" label={t('cancel')} onPress={cancelCategory} style={styles.action} />
            <EButton palette={band} size="compact" label={extra.done} onPress={commitCategory} style={styles.action} />
          </View>
      ) : editing ? (
          <View testID="entry-detail-actions" style={[styles.actions, largeText && styles.actionsLarge]}>
            <EButton palette={band} size="compact" label={t('saveChanges')} onPress={save} disabled={!canSave} style={styles.action} />
            <EButton palette={band} size="compact" variant="secondary" label={t('cancel')} onPress={() => setEditing(false)} style={styles.action} />
          </View>
      ) : (
          // Reading an entry ends with Done; changing it is one step aside, in
          // the same short row (Delete at the start, Done at the end). Stacked
          // at the accessibility sizes, Done leads.
          <View testID="entry-detail-actions" style={[styles.actions, largeText ? styles.actionsLarge : styles.readActions]}>
            {largeText ? [readDone, readEdit, readDelete] : [readDelete, readEdit, readDone]}
          </View>
      )}>
      {editing ? <View style={[styles.head, styles.editHead, { borderColor: band.rule }]}>
        <ThemedText type="smallBold" style={styles.editHeadTitle}>{presentation.title}</ThemedText>
        <Money
          fils={transaction.amountFils}
          type="smallBold"
          sign={presentation.sign}
          prefix
          decimals
          color={income && !pendingTransfer && !confirmedTransfer ? theme.income : band.text}
          style={styles.editHeadAmount}
        />
      </View> : <View style={styles.head} testID="entry-detail-head">
        {/* Who and when beside a 44pt logo, then the figure: the sheet's
            answer stays in view with its question and actions below it. */}
        <View style={styles.headRow}>
          <MerchantAvatar title={transaction.title} category={transaction.category} size={44} />
          <View style={styles.headText}>
            <ThemedText type="heading" style={styles.headTitle}>{presentation.title}</ThemedText>
            <ThemedText type="meta" style={{ color: band.textSecondary }}>
              {friendlyDate(transaction.date, toISODate(new Date()))}
            </ThemedText>
          </View>
        </View>
        {/* Decimals on. This sheet exists to answer "what exactly was this",
            and it sat above an edit field showing 72.73 while itself reading
            −73. Both the list and details now retain the exact minor units. */}
        <BandFigure testID="entry-detail-amount" fils={transaction.amountFils} sign={presentation.sign} decimals
          palette={band} size="large" fitInset={8}
          color={income && !pendingTransfer && !confirmedTransfer ? theme.income : band.text}
          secondaryColor={band.textSecondary} />
        {fxLine ? <ThemedText type="meta" tabular testID="entry-fx-line" style={{ color: band.textSecondary }}>
          {fxLine}</ThemedText> : null}
      </View>}

      {/* What it was, as chips: its category (opens the picker) and, on an
          ordinary row, the one-tap "Moved to my own account". */}
      {!editing && !categoryPicking ? <View style={styles.chips} testID="entry-detail-chips">
        {confirmedTransfer || pendingTransfer ? <View accessible accessibilityRole="text" style={[styles.chip, { backgroundColor: band.card, borderColor: band.rule }]}>
          <Icon name="repeat" size={16} color={band.text} />
          <ThemedText type="small" style={[styles.chipText, { color: band.text }]}>{presentation.repayment ? presentation.tag : pendingTransfer ? transferWords.ownershipUnknown
            : confirmedOwnTransfer ? transferWords.confirmedOwn : t('transferLabel')}</ThemedText>
        </View> : <Pressable accessibilityRole="button" testID="entry-category-chip"
          accessibilityLabel={`${t('category')}: ${categoryLabel(meta)}`}
          onPress={() => { setPickedCategory(transaction.category); setCategoryPicking(true); }}
          style={({ pressed }) => [styles.chip, { backgroundColor: band.fill, borderColor: band.fill, opacity: pressed ? 0.8 : 1 }]}>
          <Icon name={meta.icon} size={16} color={band.onFill} />
          <ThemedText type="smallBold" style={[styles.chipText, { color: band.onFill }]}>{categoryLabel(meta)}</ThemedText>
        </Pressable>}
        {canMarkTransfer ? <Pressable accessibilityRole="button" testID="entry-mark-transfer"
          accessibilityLabel={answerLabels.own}
          onPress={markAsTransfer}
          style={({ pressed }) => [styles.chip, { backgroundColor: band.card, borderColor: band.rule, opacity: pressed ? 0.8 : 1 }]}>
          <Icon name="repeat" size={16} color={band.text} />
          <ThemedText type="small" style={[styles.chipText, { color: band.text }]}>{answerLabels.own}</ThemedText>
        </Pressable> : null}
        {canUnmarkTransfer ? <Pressable accessibilityRole="button" testID="entry-unmark-transfer"
          accessibilityLabel={answerLabels.none}
          onPress={unmarkTransfer}
          style={({ pressed }) => [styles.chip, { backgroundColor: band.card, borderColor: band.rule, opacity: pressed ? 0.8 : 1 }]}>
          <Icon name="repeat" size={16} color={band.text} />
          <ThemedText type="small" style={[styles.chipText, { color: band.text }]}>{answerLabels.none}</ThemedText>
        </Pressable> : null}
      </View> : null}

      {categoryPicking ? (
        <View style={styles.field} testID="entry-category-picker">
          <ThemedText type="meta" themeColor="textTertiary">{extra.chooseCategory}</ThemedText>
          <CategoryChips createType={income ? 'income' : 'expense'} categories={categories} selected={pickedCategory} onToggle={setPickedCategory} layout="wrap" />
        </View>
      ) : null}
      {!categoryPicking && <>

      {!editing && presentation.explanation ? <View testID="entry-purpose-explainer"
        style={[styles.transferMeaning, { borderColor: band.rule, backgroundColor: band.card }]}>
        <ThemedText type="smallBold">{presentation.note}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{presentation.explanation}</ThemedText>
      </View> : null}

      {(confirmedOwnTransfer || pendingTransfer) && (
        <View
          testID={confirmedOwnTransfer ? 'own-transfer-explainer' : 'pending-transfer-explainer'}
          style={[styles.transferMeaning, { borderColor: band.rule, backgroundColor: band.card }]}>
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
          style={[styles.transferMeaning, { borderColor: band.rule, backgroundColor: band.card }]}>
          <ThemedText type="smallBold">{t('autoAddedCheck')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{t('autoAddedExplain')}</ThemedText>
          <View style={[styles.actions, largeText && styles.actionsLarge]}>
            <EButton palette={band} size="compact" label={t('autoAddedLooksRight')} style={styles.action}
              onPress={() => resolveBestEffort(transaction.id, 'confirm')} />
            <EButton palette={band} size="compact" variant="secondary" label={t('autoAddedUndo')} style={styles.action}
              onPress={() => setConfirmingUndo(true)} />
          </View>
          <ThemedText type="meta" themeColor="textTertiary">{t('autoAddedUndoHint')}</ThemedText>
        </View>
      )}

      {!editing && transferCandidate && <View testID="entry-transfer-question" style={styles.transferQuestion}>
        <ThemedText type="smallBold" accessibilityRole="header">{answerWords.question}</ThemedText>
        {/* Why Wafra already treats it as the person's own money, when other bank alerts say so.
            No receipt is invented; the answers below still correct it. */}
        {transferAssessment?.reason === 'known-account' || transferAssessment?.reason === 'known-card'
          ? <ThemedText testID="transfer-known-ownership-evidence" type="small" themeColor="textSecondary">
            {transferAssessment.reason === 'known-card' ? transferWords.knownCardEvidence : transferWords.knownAccountEvidence}
          </ThemedText> : null}
        {picking ? <View style={styles.picker}>
          <ThemedText type="small" themeColor="textSecondary">{answerWords.whichAccount}</ThemedText>
          {candidates.map((candidate) => <Pressable key={candidate.id} testID={`entry-transfer-candidate-${candidate.id}`}
            accessibilityRole="button" disabled={busy}
            accessibilityLabel={`${accountLabelFor(candidate.accountId)}. ${shortDate(candidate.date)}`}
            onPress={() => void choose('own', candidate)}
            style={[styles.pickRow, { borderColor: band.rule, backgroundColor: band.card, opacity: busy ? 0.6 : 1 }]}>
            <ThemedText type="smallBold">{accountLabelFor(candidate.accountId)}</ThemedText>
            <ThemedText type="meta" themeColor="textSecondary">{shortDate(candidate.date)}</ThemedText>
          </Pressable>)}
          <Pressable testID="entry-transfer-candidate-none" accessibilityRole="button" disabled={busy}
            onPress={() => void choose('own')}
            style={[styles.pickRow, { borderColor: band.rule, backgroundColor: band.card, opacity: busy ? 0.6 : 1 }]}>
            <ThemedText type="small">{answerWords.noLink}</ThemedText>
          </Pressable>
          <Pressable testID="entry-transfer-picker-back" accessibilityRole="button" disabled={busy}
            accessibilityLabel={t('back')} onPress={() => setPicking(false)}
            style={[styles.pickRow, { borderColor: band.rule, opacity: busy ? 0.6 : 1 }]}>
            <ThemedText type="small" themeColor="textSecondary">{t('back')}</ThemedText>
          </Pressable>
        </View> : <TransferAnswerChoices incoming={income} value={answered} layout="radios" palette={band} disabled={busy}
          linkedLabel={linkedTo ? activityWords.route.linked(accountLabelFor(linkedTo.accountId)) : undefined}
          suggestion={suggestedOther && suggestedOther.accountId !== transaction.accountId
            ? answerWords.looksLike(accountLabelFor(suggestedOther.accountId)) : undefined}
          suggestionDetail={suggestedOther ? [suggestedOther.title, fullDateTime(suggestedOther),
            `${ledgerCurrencyCode()} ${formatAmount(suggestedOther.amountFils, { decimals: true })}`].join(' · ') : undefined}
          onChange={(next) => {
            if (next === 'own' && candidates.length > 1) { setPicking(true); return; }
            void choose(next, next === 'own' ? candidates[0] : undefined);
          }} />}
        {/* The person's own saved answer can be taken back, as the toast's Undo does: the entry
            returns to waiting for an answer (both sides of a link are cleared). */}
        {!picking && transaction.transferDecision ? <Pressable testID="entry-transfer-clear" accessibilityRole="button"
          accessibilityLabel={answerWords.clear} disabled={busy}
          onPress={() => {
            // Clear exactly the answer shown here: if either row has changed since, nothing is cleared.
            const counterpartId = transaction.transferDecision?.counterpartId;
            const shown = new Map([[transaction.id, transaction], ...(counterpartId && rowsById.get(counterpartId)
              ? [[counterpartId, rowsById.get(counterpartId)!] as const] : [])]);
            void undo(transaction.id, counterpartId, transferFingerprintsOf([...shown.keys()], shown)).then(onClose);
          }}
          style={({ pressed }) => [styles.clearAnswer, { opacity: busy ? 0.6 : pressed ? 0.7 : 1 }]}>
          <ThemedText type="small" style={{ color: band.tint }}>{answerWords.clear}</ThemedText>
        </Pressable> : null}
      </View>}
      {!editing && showMerchantLink && !presentation.purposeUnclear && !confirmedTransfer && !pendingTransfer && !isMoneyMovementOnly(transaction) && transaction.title.trim() &&
        <MerchantSpendingLink merchant={transaction.title} displayName={presentation.title} type={transaction.type} onClose={onClose} />}
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
              <CategoryChips createType={income ? 'income' : 'expense'} categories={categories} selected={category} onToggle={setCategory} layout="wrap" />
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

        </>
      ) : (
        <>
          <LabelTable
            rows={[
              {
                label: t('account'),
                value: <ThemedText type="small">{account ? accountDisplayName(account) : t('unassigned')}</ThemedText>,
              },
              {
                label: t('source'),
                value: <ThemedText type="small">{sourceLabel}</ThemedText>,
              },
              ...(presentation.recordedDescription ? [{
                label: presentationWords.recordedDescription,
                value: <ThemedText testID="entry-recorded-description" type="small" themeColor="textSecondary">{presentation.recordedDescription}</ThemedText>,
              }] : []),
              ...(presentation.tag && !confirmedTransfer && !pendingTransfer ? [{
                label: presentationWords.kind,
                value: <ThemedText type="small">{presentation.tag}</ThemedText>,
              }] : []),
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
                          “{maskLedgerIdentifiers(transaction.raw)}”
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
          body={`${presentation.title} · ${formatAmount(transaction.amountFils)}. ${t('autoAddedUndoHint')}`}
          confirmLabel={t('autoAddedUndo')}
          destructive
          onConfirm={() => { resolveBestEffort(transaction.id, 'undo'); onClose(); }}
        />
      )}
      {confirmingDelete && (
        <ConfirmSheet
          visible
          onClose={() => setConfirmingDelete(false)}
          question={t('deleteThisEntry')}
          body={`${presentation.title} · ${formatAmount(transaction.amountFils)}`}
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
  head: { gap: Spacing.two },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4 },
  headText: { flex: 1, minWidth: 0, gap: 2 },
  editHead: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: Spacing.two, paddingHorizontal: 0,
    paddingVertical: Spacing.two, alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  editHeadTitle: { flexShrink: 1 },
  editHeadAmount: { alignSelf: 'center' },
  headTitle: { flexShrink: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  // A long chip ("Between your accounts · not spending" at a larger text
  // size) wraps inside the sheet instead of running off both edges.
  chip: {
    minHeight: BandLayout.chipHeight, borderRadius: BandLayout.chipHeight / 2, paddingHorizontal: 14,
    flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, maxWidth: '100%',
  },
  chipText: { flexShrink: 1 },
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
  transferQuestion: { gap: Spacing.two },
  clearAnswer: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  picker: { gap: Spacing.two },
  pickRow: { minHeight: 48, borderWidth: 1, borderRadius: Radius.control, paddingHorizontal: Spacing.three - 2,
    paddingVertical: Spacing.two + 2, gap: 2, justifyContent: 'center' },
  transferMeaning: {
    gap: 2,
    borderWidth: 1,
    borderRadius: Radius.control,
    paddingHorizontal: Spacing.three - 2,
    paddingVertical: Spacing.two + 2,
  },
  actionsLarge: { flexDirection: 'column' },
  actions: {
    flexShrink: 0,
    flexDirection: 'row',
    gap: Spacing.two + 2,
  },
  // Side by side the two buttons share the row; stacked they take its width.
  action: { flexGrow: 1, flexBasis: 0, alignSelf: 'auto' },
  // The read row: Edit and Done share what Delete (sized to its word) leaves.
  // On a very narrow screen a whole button moves to a second line rather
  // than any label breaking inside one.
  readActions: { flexWrap: 'wrap' },
  rowAction: { flexGrow: 1, flexShrink: 1, flexBasis: 'auto', alignSelf: 'auto', maxWidth: '100%' },
  quietAction: { flexGrow: 0, flexShrink: 1, flexBasis: 'auto', alignSelf: 'auto', maxWidth: '100%' },
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
