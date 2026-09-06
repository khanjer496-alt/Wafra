import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { CardDetailSheet } from '@/components/card-detail-sheet';
import { ThemedText } from '@/components/themed-text';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { ChoiceSheet, type Choice } from '@/components/ui/choice-sheet';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Button } from '@/components/ui/controls';
import { Row, Section, SectionHeader } from '@/components/ui/layout';
import { AmountField, Money } from '@/components/ui/money';
import { ScreenScaffold } from '@/components/ui/screen-scaffold';
import type { ScreenHeaderProps } from '@/components/ui/screen-header';
import { AccountTile } from '@/components/ui/tile';
import { Spacing } from '@/constants/theme';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useTheme } from '@/hooks/use-theme';
import { internalTransferIds, isSpending, liveAccountIds } from '@/lib/ledger';
import { accountLastActivityISO, isInactiveAccount, openDues } from '@/lib/cards';
import { formatAmount, monthKey, parseAmountToFils, shortDate } from '@/lib/format';
import { reliableBalanceFils, useStore } from '@/lib/store';
import type { Account } from '@/lib/types';
import { t, tf } from '@/lib/i18n';

/**
 * A confirmation waiting on the user, or null.
 *
 * Deleting a card and its entries was gated by `Alert.alert`, nested inside a
 * second `Alert.alert` that offered the long-press options. On
 * react-native-web `Alert.alert` is `static alert() {}` — an empty method, no
 * dialog, no warning, no throw — so neither ever drew: the long press did
 * nothing at all, and `deleteAccount` sat as unreachable code inside a button
 * that was never rendered. Both halves are drawn now, the menu as a
 * `ChoiceSheet` and the confirmation as a `ConfirmSheet`.
 */
type Confirmation = {
  question: string;
  body: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
};

/** What card management offers after opening a row or using its shortcut. */
type CardAction = 'visibility' | 'delete';

/**
 * Every card as a row: bank, last four, and the one figure that is actually
 * known for it.
 *
 * Banks quote headroom, never the limit, so a card with no bank-quoted
 * outstanding figure says what it does know — this month's spend — rather
 * than inventing a balance out of a partial SMS history.
 */
export default function CardsScreen() {
  const theme = useTheme();
  const largeText = useLargeTextLayout();
  const router = useRouter();
  const { state, editAccount, deleteAccount } = useStore();
  const now = useMemo(() => new Date(), []);

  const [showInactive, setShowInactive] = useState(false);
  const [detail, setDetail] = useState<Account | null>(null);
  const [limitFor, setLimitFor] = useState<Account | null>(null);
  const [limitText, setLimitText] = useState('');
  // The card a long press is asking about, and the confirmation that the
  // destructive answer to it opens second.
  const [optionsFor, setOptionsFor] = useState<Account | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  // Opened from a due row: land straight on that card's history.
  const { card: cardParam } = useLocalSearchParams<{ card?: string }>();
  useEffect(() => {
    if (!cardParam) return;
    const target = state.accounts.find((a) => a.id === cardParam);
    if (target) setDetail(target);
  }, [cardParam, state.accounts]);

  const cards = useMemo(
    () => state.accounts.filter((a) => a.kind === 'card' || a.cardType),
    [state.accounts],
  );
  const activeCards = useMemo(
    () => cards.filter((c) => !isInactiveAccount(state, c, now)),
    [cards, state, now],
  );
  const inactiveCards = useMemo(
    () => cards.filter((c) => isInactiveAccount(state, c, now)),
    [cards, state, now],
  );
  const inactiveDisclosureLabel = `${t('inactiveCards')} ${inactiveCards.length}. ${
    showInactive ? t('hide') : t('show')
  }`;
  const dues = useMemo(() => openDues(state, now), [state, now]);
  const liveAccounts = useMemo(() => liveAccountIds(state.accounts), [state.accounts]);
  const internal = useMemo(
    () => internalTransferIds(state.transactions, liveAccounts),
    [state.transactions, liveAccounts],
  );
  /**
   * This month's spend per card.
   *
   * Both halves of a move between the user's own accounts are excluded, the
   * same as on Home and Flow: a legacy sweep is stored with a structural title
   * and no transfer flag, so `isSpending` alone let AED 19,000 of the user's
   * own money read as a month's spending on the card it left.
   *
   * The live-account set is deliberately NOT applied. Every other total in the
   * app is a single figure that a hidden account must not contribute to; this
   * is a per-card figure printed on the card's own row, and this screen shows
   * hidden cards on purpose in the drawer below. Filtering by account here
   * would print "AED 0 this month" beside a card that plainly spent money —
   * hiding a card must stop it counting in the headline, not rewrite its own
   * history. Nothing sums this map, so no total can disagree with Home.
   */
  const monthSpend = useMemo(() => {
    const key = monthKey(now);
    const map = new Map<string, number>();
    for (const tx of state.transactions) {
      if (!isSpending(tx, undefined, internal) || monthKey(tx.date) !== key) continue;
      map.set(tx.accountId, (map.get(tx.accountId) ?? 0) + tx.amountFils);
    }
    return map;
  }, [state.transactions, now, internal]);

  const askCreditLimit = (card: Account) => {
    setLimitText(card.creditLimitFils ? formatAmount(card.creditLimitFils).replace(/,/g, '') : '');
    setLimitFor(card);
  };

  const saveCreditLimit = () => {
    const fils = parseAmountToFils(limitText);
    if (limitFor && fils) editAccount(limitFor.id, { creditLimitFils: fils });
    setLimitFor(null);
  };

  const cardActions = (card: Account): Choice<CardAction>[] => [
    { value: 'visibility', label: card.archived ? t('unhide') : t('hideCard') },
    { value: 'delete', label: t('deleteCardAndEntries') },
  ];

  // Hiding happens on the spot; deleting the card and its entries asks first,
  // exactly as the two stacked alerts did.
  const onCardAction = (card: Account, action: CardAction) => {
    if (action === 'visibility') editAccount(card.id, { archived: !card.archived });
    else
      setConfirmation({
        question: t('deleteCardTitle'),
        body: tf('deleteCardBody', { name: card.name }),
        confirmLabel: t('delete'),
        destructive: true,
        onConfirm: () => deleteAccount(card.id),
      });
  };

  const cardsHeader: ScreenHeaderProps = {
    title: t('cardsTitle'),
    back: { label: t('back'), onPress: () => router.back() },
  };

  const renderCard = (card: Account, i: number, list: Account[], inactive: boolean) => {
    const isCredit = card.cardType === 'credit';
    // Only a bank-quoted outstanding figure is trustworthy.
    const reliable = reliableBalanceFils(state, card);
    const outstanding = isCredit && reliable !== null ? Math.abs(reliable) : null;
    const quotedLeft =
      card.snapshotKind === 'limit' && card.snapshotFils !== undefined ? card.snapshotFils : null;
    // A bank quote wins; otherwise the user's own limit minus what is
    // outstanding gives the same answer without inventing anything.
    const limitLeft =
      quotedLeft ??
      (isCredit && card.creditLimitFils !== undefined && outstanding !== null
        ? Math.max(0, card.creditLimitFils - outstanding)
        : null);
    const spent = monthSpend.get(card.id) ?? 0;
    const due = dues.find((d) => d.due.accountId === card.id);
    const lastUsed = inactive ? accountLastActivityISO(state, card.id) : null;

    return (
      <Row
        key={card.id}
        onPress={() => setDetail(card)}
        onLongPress={() => setOptionsFor(card)}
        last={i === list.length - 1}
        accessibilityLabel={tf('cardOpenHistoryA11y', { name: card.name })}
        style={inactive ? styles.inactiveRow : undefined}>
        <AccountTile account={card} />
        <View style={styles.rowText}>
          <ThemedText type="small" numberOfLines={largeText ? undefined : 1}>
            {card.bankName ??
              (card.name.replace(/\s*(?:credit|debit)?\s*card.*$/i, '').trim() || t('card'))}
          </ThemedText>
          <ThemedText type="meta" themeColor="textTertiary">
            {isCredit ? t('credit') : t('debit')} ·· {card.last4 ?? '????'}
            {due
              ? ` · ${tf('dueOn', { date: shortDate(due.due.dueDate) })}`
              : lastUsed
                ? ` · ${t('lastUsed').toLowerCase()} ${shortDate(lastUsed)}`
                : ''}
          </ThemedText>
        </View>
        <View style={[styles.rowFigure, { alignItems: state.language === 'ar' ? 'flex-start' : 'flex-end' }]}>
          <Money
            fils={outstanding ?? spent}
            prefix={false}
            color={due && (due.status === 'overdue' || due.status === 'urgent') ? theme.expense : theme.text}
          />
          {/* The caption has to name the figure ABOVE it, and those are two
              independent facts: the bank may quote headroom without ever
              quoting an outstanding balance. When it does, the big figure
              falls back to this month's spend — and captioning that
              "15,000 left" read as a balance of 3,200 against an 18,200
              limit. The caption says which figure it is first, and headroom
              rides along after it.

              The invitation to set a limit rides along too, for the same
              reason: on its own, "Set limit" under AED 5,353 reads as the
              limit BEING 5,353, while Wallet captions the identical figure
              "spent this month" one tap away. */}
          <ThemedText type="nano" themeColor="textTertiary">
            {outstanding !== null ? t('outstandingTitle') : t('thisMonth')}
            {limitLeft !== null
              ? ` · ${tf('creditLeft', { amount: formatAmount(limitLeft, { decimals: false }) })}`
              : isCredit
                ? ` · ${t('setLimit')}`
                : ''}
          </ThemedText>
        </View>
      </Row>
    );
  };

  return (
    <>
      <ScreenScaffold
        headerMode="native"
        header={cardsHeader}
        contentStyle={styles.content}
        scrollProps={{ showsVerticalScrollIndicator: false }}>
          <Section index={0}>
            {activeCards.map((c, i) => renderCard(c, i, activeCards, false))}
            {activeCards.length === 0 && (
              <ThemedText type="default" themeColor="textSecondary">
                {t('noCardsYet')}
              </ThemedText>
            )}
          </Section>

          {inactiveCards.length > 0 && (
            <Section index={1}>
              <SectionHeader
                title={`${t('inactiveCards')} · ${inactiveCards.length}`}
                trailing={(
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={inactiveDisclosureLabel}
                    accessibilityState={{ expanded: showInactive }}
                    onPress={() => setShowInactive((current) => !current)}
                    style={[styles.disclosureAction, Platform.OS === 'android' && styles.androidDisclosureAction]}>
                    <ThemedText type="micro" themeColor="primary">
                      {showInactive ? t('hide') : t('show')}
                    </ThemedText>
                  </Pressable>
                )}
              />
              {showInactive && inactiveCards.map((c, i) => renderCard(c, i, inactiveCards, true))}
            </Section>
          )}
      </ScreenScaffold>

      <CardDetailSheet
        account={detail}
        onClose={() => setDetail(null)}
        footer={detail ? (
          <View style={styles.detailActions}>
            {detail.cardType === 'credit' && (
              <Button
                label={t('setCreditLimit')}
                onPress={() => {
                  setDetail(null);
                  askCreditLimit(detail);
                }}
              />
            )}
            <Button
              variant="outline"
              label={t('manage')}
              onPress={() => {
                setDetail(null);
                setOptionsFor(detail);
              }}
            />
          </View>
        ) : undefined}
      />

      <BottomSheet visible={limitFor !== null}
        onClose={() => setLimitFor(null)}
        title={t('creditLimitTitle')}
        footer={(
          <Button wrapLabel label={t('saveLimit')} onPress={saveCreditLimit} disabled={!parseAmountToFils(limitText)} />
        )}>
        <ThemedText type="default" themeColor="textSecondary">
          {tf('creditLimitBody', { name: limitFor?.name ?? t('card') })}
        </ThemedText>
        <AmountField label={t('totalCreditLimit')} value={limitText} onChangeText={setLimitText} fontSize={34} />
      </BottomSheet>

      {/* Outside the ScrollView: a sheet mounted inside a scrolling parent
          inherits its clipping and its scroll offset on web. */}
      {optionsFor && (
        <ChoiceSheet
          visible
          onClose={() => setOptionsFor(null)}
          title={optionsFor.name}
          body={optionsFor.archived ? t('hiddenFromLists') : undefined}
          options={cardActions(optionsFor)}
          onSelect={(action) => onCardAction(optionsFor, action)}
        />
      )}
      {/* Mounted only while there is something to confirm, so the entry
          animation runs on every open rather than once per screen. */}
      {confirmation && (
        <ConfirmSheet
          visible
          onClose={() => setConfirmation(null)}
          question={confirmation.question}
          body={confirmation.body}
          confirmLabel={confirmation.confirmLabel}
          destructive={confirmation.destructive}
          onConfirm={confirmation.onConfirm}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing.four + 2,
  },
  rowText: {
    flex: 1,
    gap: Spacing.half,
  },
  rowFigure: {
    alignItems: 'flex-end',
    gap: Spacing.half,
  },
  inactiveRow: {
    opacity: 0.6,
  },
  disclosureAction: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  androidDisclosureAction: { minWidth: 48, minHeight: 48 },
  detailActions: {
    gap: Spacing.two,
  },
});
