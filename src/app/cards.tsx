import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CardDetailSheet } from '@/components/card-detail-sheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/controls';
import { Row, ScreenHeader, Section, SectionHeader } from '@/components/ui/layout';
import { AmountField, Money } from '@/components/ui/money';
import { AccountTile } from '@/components/ui/tile';
import { MaxContentWidth, ScreenPadding, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isSpending } from '@/lib/ledger';
import { accountLastActivityISO, isInactiveAccount, openDues } from '@/lib/cards';
import { formatAmount, monthKey, parseAmountToFils, shortDate } from '@/lib/format';
import { reliableBalanceFils, useStore } from '@/lib/store';
import type { Account } from '@/lib/types';
import { t, tf } from '@/lib/i18n';

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
  const router = useRouter();
  const { state, editAccount, deleteAccount } = useStore();
  const now = useMemo(() => new Date(), []);

  const [showInactive, setShowInactive] = useState(false);
  const [detail, setDetail] = useState<Account | null>(null);
  const [limitFor, setLimitFor] = useState<Account | null>(null);
  const [limitText, setLimitText] = useState('');

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
  const dues = useMemo(() => openDues(state, now), [state, now]);
  const monthSpend = useMemo(() => {
    const key = monthKey(now);
    const map = new Map<string, number>();
    for (const tx of state.transactions) {
      if (!isSpending(tx) || monthKey(tx.date) !== key) continue;
      map.set(tx.accountId, (map.get(tx.accountId) ?? 0) + tx.amountFils);
    }
    return map;
  }, [state.transactions, now]);

  const askCreditLimit = (card: Account) => {
    setLimitText(card.creditLimitFils ? String(Math.round(card.creditLimitFils / 100)) : '');
    setLimitFor(card);
  };

  const saveCreditLimit = () => {
    const fils = parseAmountToFils(limitText);
    if (limitFor && fils) editAccount(limitFor.id, { creditLimitFils: fils });
    setLimitFor(null);
  };

  const cardOptions = (card: Account) => {
    Alert.alert(card.name, card.archived ? t('hiddenFromLists') : undefined, [
      ...(card.cardType === 'credit'
        ? [{ text: t('setCreditLimit'), onPress: () => askCreditLimit(card) }]
        : []),
      {
        text: card.archived ? t('unhide') : t('hideCard'),
        onPress: () => editAccount(card.id, { archived: !card.archived }),
      },
      {
        text: t('deleteCardAndEntries'),
        style: 'destructive' as const,
        onPress: () =>
          Alert.alert(t('deleteCardTitle'), tf('deleteCardBody', { name: card.name }), [
            { text: t('cancel'), style: 'cancel' },
            { text: t('delete'), style: 'destructive', onPress: () => deleteAccount(card.id) },
          ]),
      },
      { text: t('cancel'), style: 'cancel' as const },
    ]);
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
        onLongPress={() => cardOptions(card)}
        last={i === list.length - 1}
        accessibilityLabel={tf('cardOpenHistoryA11y', { name: card.name })}
        style={inactive ? styles.inactiveRow : undefined}>
        <AccountTile account={card} />
        <View style={styles.rowText}>
          <ThemedText type="small" numberOfLines={1}>
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
          <ThemedText
            type="nano"
            themeColor="textTertiary"
            onPress={isCredit && limitLeft === null ? () => askCreditLimit(card) : undefined}
            style={isCredit && limitLeft === null ? { color: theme.primary } : undefined}>
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
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.headerWrap}>
          <ScreenHeader title={t('cardsTitle')} onBack={() => router.back()} />
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
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
                action={showInactive ? t('hide') : t('show')}
                onAction={() => setShowInactive(!showInactive)}
              />
              {showInactive && inactiveCards.map((c, i) => renderCard(c, i, inactiveCards, true))}
            </Section>
          )}

          <ThemedText type="meta" themeColor="textTertiary" style={styles.hint}>
            {t('longPressHint')}
          </ThemedText>
        </ScrollView>
      </SafeAreaView>

      <CardDetailSheet account={detail} onClose={() => setDetail(null)} />

      <BottomSheet visible={limitFor !== null} onClose={() => setLimitFor(null)} title={t('creditLimitTitle')}>
        <ThemedText type="default" themeColor="textSecondary">
          {tf('creditLimitBody', { name: limitFor?.name ?? t('card') })}
        </ThemedText>
        <AmountField label={t('totalCreditLimit')} value={limitText} onChangeText={setLimitText} fontSize={34} />
        <Button label={t('saveLimit')} onPress={saveCreditLimit} disabled={!parseAmountToFils(limitText)} />
      </BottomSheet>
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
  headerWrap: {
    paddingHorizontal: ScreenPadding,
  },
  content: {
    paddingHorizontal: ScreenPadding,
    paddingBottom: Spacing.six,
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
  hint: {
    paddingTop: Spacing.two,
  },
});
