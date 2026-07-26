import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CardDetailSheet } from '@/components/card-detail-sheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BankAvatar } from '@/components/ui/bank-avatar';
import { Icon } from '@/components/ui/icon';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/lib/i18n';
import { accountLastActivityISO, isInactiveAccount, openDues } from '@/lib/cards';
import { formatAED, monthKey, parseAmountToFils, shortDate } from '@/lib/format';
import { reliableBalanceFils, useStore } from '@/lib/store';
import type { Account } from '@/lib/types';

/** Every card as a wallet-style tile: bank, last4, live figures. */
export default function CardsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { state, editAccount, deleteAccount } = useStore();
  const now = useMemo(() => new Date(), []);
  const [showInactive, setShowInactive] = useState(false);
  const [detail, setDetail] = useState<Account | null>(null);

  // Opened from a due row on the Bills tab: land straight on that card's
  // statements and payment history rather than on the grid.
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
  // Expired/unused cards (silent 90+ days, or hidden by hand) go to the bottom.
  const activeCards = useMemo(
    () => cards.filter((c) => !isInactiveAccount(state, c, now)),
    [cards, state, now],
  );
  const inactiveCards = useMemo(
    () => cards.filter((c) => isInactiveAccount(state, c, now)),
    [cards, state, now],
  );

  /**
   * Banks quote headroom, never the limit. Entering it once turns every
   * masked-balance card from "no figure" into a real one.
   *
   * A Modal rather than Alert.prompt: that API is iOS-only, and on Android it
   * is simply absent — the button would have done nothing at all on the
   * platform this app actually ships to.
   */
  const [limitFor, setLimitFor] = useState<Account | null>(null);
  const [limitText, setLimitText] = useState('');
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
    Alert.alert(card.name, card.archived ? 'Hidden from lists.' : undefined, [
      ...(card.cardType === 'credit'
        ? [{ text: 'Set credit limit', onPress: () => askCreditLimit(card) }]
        : []),
      {
        text: card.archived ? 'Unhide' : 'Hide card',
        onPress: () => editAccount(card.id, { archived: !card.archived }),
      },
      {
        text: 'Delete card + its transactions',
        style: 'destructive',
        onPress: () =>
          Alert.alert('Delete card?', `"${card.name}" and all its transactions will be removed.`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => deleteAccount(card.id) },
          ]),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };
  const dues = useMemo(() => openDues(state, now), [state, now]);
  const monthSpend = useMemo(() => {
    const key = monthKey(now);
    const map = new Map<string, number>();
    for (const t of state.transactions) {
      if (t.type !== 'expense' || t.isTransfer || monthKey(t.date) !== key) continue;
      map.set(t.accountId, (map.get(t.accountId) ?? 0) + t.amountFils);
    }
    return map;
  }, [state.transactions, now]);

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            style={[styles.backBtn, { backgroundColor: theme.backgroundSelected }]}>
            <Icon name="chevron-left" size={18} color={theme.text} />
          </Pressable>
          <ThemedText type="heading">Cards</ThemedText>
          <View style={styles.backBtn} />
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {(() => {
          const renderCard = (card: Account, i: number, inactive: boolean) => {
            const isCredit = card.cardType === 'credit';
            // Only a bank-quoted outstanding figure is trustworthy; partial
            // SMS history can't reconstruct one, so we fall back to spend.
            const reliable = reliableBalanceFils(state, card);
            const outstanding = isCredit && reliable !== null ? Math.abs(reliable) : null;
            const quotedLeft =
              card.snapshotKind === 'limit' && card.snapshotFils !== undefined
                ? card.snapshotFils
                : null;
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
              <Animated.View
                key={card.id}
                entering={FadeInDown.delay(i * 70).duration(350)}
                style={inactive ? styles.inactiveTile : undefined}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${card.name}, open statements and payments`}
                  onPress={() => setDetail(card)}
                  onLongPress={() => cardOptions(card)}
                  style={({ pressed }) => [
                    styles.tile,
                    {
                      backgroundColor: theme.card,
                      borderColor: `${card.color}55`,
                      transform: [{ scale: pressed ? 0.99 : 1 }],
                    },
                  ]}>
                  {/* A flat brand wash. The old build stacked a 220px circle on
                      top of it, which cropped to a hard arc across the tile. */}
                  <View style={[styles.tileWash, { backgroundColor: `${card.color}14` }]} />
                  <View style={[styles.tileEdge, { backgroundColor: card.color }]} />

                  <View style={styles.tileTop}>
                    <BankAvatar name={card.bankName ?? card.name} color={card.color} size={34} />
                    <View style={styles.tileTopText}>
                      <ThemedText type="smallBold" numberOfLines={1}>
                        {card.bankName ??
                          (card.name.replace(/\s*(?:credit|debit)?\s*card.*$/i, '').trim() || 'Card')}
                      </ThemedText>
                      <ThemedText type="micro" themeColor="textSecondary" tabular>
                        {isCredit ? 'CREDIT' : 'DEBIT'} ·· {card.last4 ?? '????'}
                      </ThemedText>
                    </View>
                    {due && (
                      <View
                        style={[
                          styles.dueChip,
                          {
                            backgroundColor:
                              due.status === 'overdue' || due.status === 'urgent'
                                ? `${theme.expense}1f`
                                : `${theme.warning}1f`,
                          },
                        ]}>
                        <ThemedText
                          type="micro"
                          style={{
                            color:
                              due.status === 'overdue' || due.status === 'urgent'
                                ? theme.expense
                                : theme.warning,
                            fontWeight: '700',
                          }}>
                          {due.status === 'overdue'
                            ? 'OVERDUE'
                            : `DUE ${shortDate(due.due.dueDate).toUpperCase()}`}
                        </ThemedText>
                      </View>
                    )}
                  </View>

                  {/* One row, not three stacked blocks. The figure and its
                      label sit together, and headroom sits beside it rather
                      than in a footer of its own — eleven cards at the old
                      height was five screens of scrolling to compare two of
                      them. */}
                  <View style={styles.tileFigures}>
                    <View style={styles.figure}>
                      <ThemedText type="micro" themeColor="textSecondary">
                        {outstanding !== null ? 'OUTSTANDING' : 'SPENT'}
                      </ThemedText>
                      <ThemedText type="subtitle" tabular>
                        {formatAED(outstanding ?? spent, { decimals: false })}
                      </ThemedText>
                    </View>
                    {limitLeft !== null ? (
                      <View style={[styles.figure, styles.figureRight]}>
                        <ThemedText type="micro" themeColor="textSecondary">
                          LIMIT LEFT
                        </ThemedText>
                        <ThemedText type="subtitle" tabular themeColor="textSecondary">
                          {formatAED(limitLeft, { decimals: false })}
                        </ThemedText>
                      </View>
                    ) : outstanding !== null && spent > 0 ? (
                      <View style={[styles.figure, styles.figureRight]}>
                        <ThemedText type="micro" themeColor="textSecondary">
                          SPENT
                        </ThemedText>
                        <ThemedText type="subtitle" tabular themeColor="textSecondary">
                          {formatAED(spent, { decimals: false })}
                        </ThemedText>
                      </View>
                    ) : lastUsed ? (
                      <View style={[styles.figure, styles.figureRight]}>
                        <ThemedText type="micro" themeColor="textSecondary">
                          {t('lastUsed').toUpperCase()}
                        </ThemedText>
                        <ThemedText type="small" tabular themeColor="textSecondary">
                          {shortDate(lastUsed)}
                        </ThemedText>
                      </View>
                    ) : isCredit ? (
                      // Blank space reads as broken. Saying the bank never
                      // quoted it — and offering the way to fix that — is the
                      // difference between missing data and a bug.
                      <Pressable
                        onPress={() => askCreditLimit(card)}
                        style={[styles.figure, styles.figureRight]}
                        hitSlop={8}>
                        <ThemedText type="micro" themeColor="textSecondary">
                          LIMIT LEFT
                        </ThemedText>
                        <ThemedText type="small" style={{ color: theme.primary }}>
                          Set limit
                        </ThemedText>
                      </Pressable>
                    ) : null}
                  </View>
                </Pressable>

                {due && (
                  <View style={styles.facts}>
                    <ThemedText
                      type="smallBold"
                      tabular
                      style={{
                        color:
                          due.status === 'overdue' || due.status === 'urgent'
                            ? theme.expense
                            : theme.warning,
                      }}>
                      Pay {formatAED(due.remainingFils, { decimals: false })} by{' '}
                      {shortDate(due.due.dueDate)}
                    </ThemedText>
                  </View>
                )}
              </Animated.View>
            );
          };
          return (
            <>
              {activeCards.map((c, i) => renderCard(c, i, false))}

              {inactiveCards.length > 0 && (
                <Pressable
                  onPress={() => setShowInactive((v) => !v)}
                  style={[styles.inactiveHeader, { borderColor: theme.cardBorder }]}>
                  <ThemedText type="smallBold" themeColor="textSecondary">
                    {t('inactiveCards')} ({inactiveCards.length})
                  </ThemedText>
                  <Icon
                    name={showInactive ? 'chevron-down' : 'chevron-right'}
                    size={16}
                    color={theme.textSecondary}
                  />
                </Pressable>
              )}
              {showInactive && inactiveCards.map((c, i) => renderCard(c, i, true))}
              {showInactive && inactiveCards.length > 0 && (
                <ThemedText type="micro" themeColor="textSecondary" style={styles.inactiveHint}>
                  No activity for 90+ days. Long-press a card to hide it for good or delete it.
                </ThemedText>
              )}
            </>
          );
          })()}

          {cards.length === 0 && (
            <View style={styles.empty}>
              <View style={[styles.emptyIcon, { backgroundColor: theme.backgroundSelected }]}>
                <Icon name="wallet" size={26} color={theme.textSecondary} strokeWidth={1.7} />
              </View>
              <ThemedText type="smallBold">No cards yet</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
                Cards appear automatically when bank SMS mention them.
              </ThemedText>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>

      <CardDetailSheet account={detail} onClose={() => setDetail(null)} />

      <Modal visible={limitFor !== null} transparent animationType="fade" onRequestClose={() => setLimitFor(null)}>
        <Pressable style={styles.limitBackdrop} onPress={() => setLimitFor(null)}>
          <Pressable
            style={[styles.limitBox, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}
            onPress={() => {}}>
            <ThemedText type="subtitle">Credit limit</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Your bank quotes how much is left, not the limit itself. Enter the total limit and
              Wafra works out the headroom.
            </ThemedText>
            <TextInput
              value={limitText}
              onChangeText={setLimitText}
              keyboardType="numeric"
              placeholder="e.g. 20000"
              placeholderTextColor={theme.textSecondary}
              autoFocus
              onSubmitEditing={saveCreditLimit}
              style={[styles.limitInput, { color: theme.text, backgroundColor: theme.backgroundSelected }]}
            />
            <View style={styles.limitActions}>
              <Pressable onPress={() => setLimitFor(null)} hitSlop={8}>
                <ThemedText type="small" themeColor="textSecondary">Cancel</ThemedText>
              </Pressable>
              <Pressable onPress={saveCreditLimit} hitSlop={8}>
                <ThemedText type="smallBold" style={{ color: theme.primary }}>Save</ThemedText>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: Spacing.three,
    paddingBottom: Spacing.six,
    gap: Spacing.four,
  },
  limitBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0009', padding: Spacing.five },
  limitBox: {
    width: '100%',
    maxWidth: 380,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  limitInput: {
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 17,
    fontVariant: ['tabular-nums'],
  },
  limitActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.five },
  tile: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.three,
    overflow: 'hidden',
  },
  tileWash: {
    ...StyleSheet.absoluteFillObject,
  },
  /** A single brand stripe reads as identity; the old corner circle read as a crop artifact. */
  tileEdge: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
  },
  tileTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
  },
  tileTopText: {
    flex: 1,
    gap: 1,
  },
  dueChip: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Radius.full,
  },
  tileFigures: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: Spacing.four,
  },
  figure: { gap: 1 },
  figureRight: { alignItems: 'flex-end' },
  facts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
    paddingTop: Spacing.two,
    paddingHorizontal: Spacing.one,
  },
  inactiveTile: {
    opacity: 0.55,
  },
  inactiveHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  inactiveHint: {
    opacity: 0.8,
    marginTop: -Spacing.two,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(7, 15, 12, 0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.four,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
    maxHeight: '82%',
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginTop: -Spacing.two,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
  },
  sheetTitle: {
    flex: 1,
    gap: 1,
  },
  sheetScroll: {
    marginHorizontal: -Spacing.one,
    paddingHorizontal: Spacing.one,
  },
  sheetSection: {
    marginTop: Spacing.four,
    gap: Spacing.one,
  },
  sheetSectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.two + 2,
  },
  sheetRowText: {
    flex: 1,
    gap: 1,
  },
  sheetRowRight: {
    alignItems: 'flex-end',
    gap: 1,
  },
  sheetEmpty: {
    paddingVertical: Spacing.three,
  },
  empty: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.six,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    textAlign: 'center',
    maxWidth: 280,
  },
});
