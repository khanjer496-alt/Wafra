import React, { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BankAvatar } from '@/components/ui/bank-avatar';
import { Icon } from '@/components/ui/icon';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatAED, shortDate } from '@/lib/format';
import { useStore } from '@/lib/store';
import type { Account } from '@/lib/types';

interface CardDetailSheetProps {
  /** The card to show, or null to keep the sheet closed. */
  account: Account | null;
  onClose: () => void;
}

/**
 * Statements and payment history for one card.
 *
 * Shared rather than owned by the Cards screen because the Bills tab needs the
 * same thing: tapping a due there used to navigate away to Cards, which threw
 * away where the user was for information that fits in a sheet. A due is a
 * question about one card, not a reason to change screens.
 */
export function CardDetailSheet({ account, onClose }: CardDetailSheetProps) {
  const theme = useTheme();
  const { state } = useStore();

  const data = useMemo(() => {
    if (!account) return null;
    const statements = state.cardDues
      .filter((d) => d.accountId === account.id)
      .slice()
      .sort((a, b) => b.dueDate.localeCompare(a.dueDate));
    // Every transfer on a credit card is a payment INTO it — you cannot spend
    // out of a card by transfer, and the importer records a settlement as an
    // expense because the money left an account.
    const payments = state.transactions
      .filter((t) => t.accountId === account.id && t.isTransfer)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    const paidTotal = payments.reduce((s, t) => s + t.amountFils, 0);
    const open = statements.filter((d) => !d.settledAt && d.paidFils < d.totalDueFils);
    const outstanding = open.reduce((s, d) => s + Math.max(0, d.totalDueFils - d.paidFils), 0);
    const billed = open.reduce((s, d) => s + d.totalDueFils, 0);
    return { statements, payments, paidTotal, outstanding, billed, openCount: open.length };
  }, [account, state.cardDues, state.transactions]);

  const settledShare =
    data && data.billed > 0 ? Math.min(1, (data.billed - data.outstanding) / data.billed) : 0;

  return (
    <Modal
      visible={account !== null}
      transparent
      animationType="slide"
      onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}
          onPress={() => {}}>
          <View style={[styles.grabber, { backgroundColor: theme.cardBorder }]} />

          {account && data && (
            <>
              <View style={styles.header}>
                <BankAvatar
                  name={account.bankName ?? account.name}
                  color={account.color}
                  size={38}
                />
                <View style={styles.headerText}>
                  <ThemedText type="subtitle" numberOfLines={1}>
                    {account.bankName ?? account.name}
                  </ThemedText>
                  <ThemedText type="micro" themeColor="textSecondary" tabular>
                    {account.cardType === 'credit' ? 'Credit' : 'Debit'}
                    {account.last4 ? ` ·· ${account.last4}` : ''}
                  </ThemedText>
                </View>
                <Pressable onPress={onClose} hitSlop={10}>
                  <Icon name="close" size={19} color={theme.textSecondary} />
                </Pressable>
              </View>

              {/* The one number the user opened this for, before any list. */}
              {data.openCount > 0 && (
                <View style={[styles.summary, { backgroundColor: theme.backgroundSelected }]}>
                  <View style={styles.summaryRow}>
                    <ThemedText type="micro" themeColor="textSecondary">
                      STILL OWED
                    </ThemedText>
                    <ThemedText type="micro" themeColor="textSecondary" tabular>
                      {data.openCount} open statement{data.openCount === 1 ? '' : 's'}
                    </ThemedText>
                  </View>
                  <ThemedText type="title" tabular style={{ color: theme.expense }}>
                    {formatAED(data.outstanding, { decimals: false })}
                  </ThemedText>
                  {/* Progress is only honest when something has been paid; a
                      full-width empty track reads as a bug. */}
                  {settledShare > 0 && (
                    <View style={[styles.track, { backgroundColor: theme.cardBorder }]}>
                      <View
                        style={[
                          styles.fill,
                          { width: `${Math.round(settledShare * 100)}%`, backgroundColor: theme.income },
                        ]}
                      />
                    </View>
                  )}
                </View>
              )}

              <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}>
                <ThemedText type="micro" themeColor="textSecondary" style={styles.sectionLabel}>
                  STATEMENTS
                </ThemedText>
                {data.statements.length === 0 ? (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
                    No statement message has arrived for this card yet.
                  </ThemedText>
                ) : (
                  data.statements.map((d, i) => {
                    const settled = !!d.settledAt || d.paidFils >= d.totalDueFils;
                    return (
                      <View
                        key={d.id}
                        style={[
                          styles.row,
                          i > 0 && {
                            borderTopWidth: StyleSheet.hairlineWidth,
                            borderTopColor: theme.cardBorder,
                          },
                        ]}>
                        <View
                          style={[
                            styles.dot,
                            { backgroundColor: settled ? theme.income : theme.expense },
                          ]}
                        />
                        <View style={{ flex: 1 }}>
                          <ThemedText type="small" tabular>
                            Due {shortDate(d.dueDate)}
                          </ThemedText>
                          <ThemedText type="micro" themeColor="textSecondary" tabular>
                            {settled
                              ? 'Settled'
                              : `${formatAED(d.paidFils, { decimals: false })} of ${formatAED(d.totalDueFils, { decimals: false })} paid`}
                          </ThemedText>
                        </View>
                        <ThemedText type="smallBold" tabular>
                          {formatAED(d.totalDueFils, { decimals: false })}
                        </ThemedText>
                      </View>
                    );
                  })
                )}

                <View style={styles.section}>
                  <View style={styles.sectionHead}>
                    <ThemedText type="micro" themeColor="textSecondary">
                      PAYMENTS MADE
                    </ThemedText>
                    <ThemedText type="micro" themeColor="textSecondary" tabular>
                      {formatAED(data.paidTotal, { decimals: false })} total
                    </ThemedText>
                  </View>
                  {data.payments.length === 0 ? (
                    <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
                      No payment to this card has been detected yet.
                    </ThemedText>
                  ) : (
                    data.payments.slice(0, 24).map((p, i) => (
                      <View
                        key={p.id}
                        style={[
                          styles.row,
                          i > 0 && {
                            borderTopWidth: StyleSheet.hairlineWidth,
                            borderTopColor: theme.cardBorder,
                          },
                        ]}>
                        <View style={[styles.dot, { backgroundColor: theme.income }]} />
                        <ThemedText type="small" tabular style={{ flex: 1 }}>
                          {shortDate(p.date)}
                        </ThemedText>
                        <ThemedText type="smallBold" tabular style={{ color: theme.income }}>
                          {formatAED(p.amountFils, { decimals: false })}
                        </ThemedText>
                      </View>
                    ))
                  )}
                </View>
              </ScrollView>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0008' },
  sheet: {
    maxHeight: '86%',
    flexShrink: 1,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.six,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: Spacing.two,
    marginBottom: Spacing.three,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  headerText: { flex: 1, gap: 1 },
  summary: {
    borderRadius: Radius.md,
    padding: Spacing.three,
    gap: Spacing.one,
    marginTop: Spacing.three,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  track: { height: 4, borderRadius: 2, overflow: 'hidden', marginTop: Spacing.one },
  fill: { height: '100%', borderRadius: 2 },
  scroll: { flex: 1, marginTop: Spacing.three },
  // The last row must clear the gesture bar, or it sits under it.
  scrollContent: { paddingBottom: Spacing.six },
  sectionLabel: { marginBottom: Spacing.one },
  section: { marginTop: Spacing.five },
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  empty: { paddingVertical: Spacing.three },
});
