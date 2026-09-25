import { accountGroupsCopy as copy } from '@/lib/reference-copy';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { AccountTile } from '@/components/ui/tile';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { ProgressBar } from '@/components/ui/progress-bar';
import { useTheme } from '@/hooks/use-theme';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { ledgerCurrencyDisplay } from '@/lib/markets';
import { formatAED } from '@/lib/format';
import type { CardPaymentChoice, CardUsage } from '@/lib/money-places';
import { moneyPlacesWords } from '@/lib/money-places-copy';
import type { Account, CardDue } from '@/lib/types';

/** An open credit-card statement, as a Wallet row can speak and act on it. */
export interface AccountStatementLine {
  due: CardDue;
  /** Statement total as the bank quoted it. */
  totalFils: number;
  /** Spending Wafra captured on the card this money month — never a bank figure. */
  capturedFils: number;
  /** The bank stated a minimum (not an estimate) that is still below what is left. */
  minimumStated: boolean;
}

export interface AccountDisplayRow {
  account: Account;
  figureFils: number | null;
  caption: string;
  freshness: string;
  /** No new figure for two weeks: the figure is the latest known, not current. */
  quiet?: boolean;
  /** Credit cards with an open statement only. */
  statement?: AccountStatementLine;
  /** Drawn only with a user-entered limit and a bank figure (money-places.ts). */
  usage?: CardUsage | null;
  /** Bank and cash accounts can take "Set today's balance". */
  balanceEditable?: boolean;
}

export function AccountGroups({ rows, onOpen, onManage, onUpdateBalance, onHide, onMarkPaid }: {
  rows: readonly AccountDisplayRow[];
  onOpen: (account: Account) => void;
  onManage: (account: Account) => void;
  onUpdateBalance?: (account: Account) => void;
  onHide?: (account: Account) => void;
  onMarkPaid?: (due: CardDue, choice: CardPaymentChoice) => void;
}) {
  const theme = useTheme(); const lang = useLanguage(); const large = useLargeTextLayout();
  const w = copy[lang === 'ar' ? 'ar' : 'en'];
  const m = moneyPlacesWords(lang);
  const groups: { key: 'bank' | 'credit' | 'debit' | 'cash'; rows: AccountDisplayRow[] }[] = [
    { key: 'bank', rows: [] }, { key: 'credit', rows: [] },
    { key: 'debit', rows: [] }, { key: 'cash', rows: [] },
  ];
  for (const row of rows) {
    const a = row.account;
    const key = a.cardType === 'credit' ? 'credit' : a.kind === 'cash' ? 'cash'
      : a.kind === 'card' || a.cardType === 'debit' ? 'debit' : 'bank';
    groups.find((group) => group.key === key)!.rows.push(row);
  }
  const action = (label: string, a11y: string, onPress: () => void, testID: string, primary = false) => (
    <Pressable key={testID} accessibilityRole="button" accessibilityLabel={a11y} testID={testID} onPress={onPress}
      style={({ pressed }) => [styles.action, {
        borderColor: primary ? theme.primary : theme.controlBorder,
        backgroundColor: pressed ? theme.backgroundSelected : 'transparent',
      }]}>
      <ThemedText type="smallBold" style={{ color: primary ? theme.primary : theme.text }}>{label}</ThemedText>
    </Pressable>
  );
  return <View style={styles.root} testID="account-groups">
    {groups.filter((group) => group.rows.length > 0).map((group) => <View key={group.key}
      style={[styles.group, { backgroundColor: 'transparent', borderColor: theme.cardBorder }]}>
      <View style={[styles.groupHeader, { borderColor: theme.cardBorder }]}>
        <ThemedText type="micro" themeColor="textSecondary" accessibilityRole="header" style={styles.grow}>{w[group.key]}</ThemedText>
        <ThemedText type="meta" themeColor="textSecondary">{ledgerCurrencyDisplay()}</ThemedText>
      </View>
      {group.rows.map((row, i) => {
        const statement = row.statement;
        const quietActions = row.quiet && (onHide || (row.balanceEditable && onUpdateBalance));
        return <View key={row.account.id} style={[styles.item,
          i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.cardBorder }]}>
          <View style={styles.rowWrapper}>
            <Pressable accessibilityRole="button" onPress={() => onOpen(row.account)}
              accessibilityLabel={`${row.account.name}. ${row.figureFils === null ? w.unknown : formatAED(row.figureFils)}. ${row.caption}. ${row.freshness}`}
              style={({ pressed }) => [styles.row, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
              <AccountTile account={row.account} />
              <View style={styles.content}>
                <View style={[styles.line, large && styles.stack]}>
                  <ThemedText type="smallBold" style={styles.grow} numberOfLines={large ? undefined : 2}>{row.account.name}</ThemedText>
                  {row.figureFils === null ? <ThemedText type="smallBold" themeColor="textTertiary">—</ThemedText>
                    : <Money fils={row.figureFils} type="smallBold" prefix={false} />}
                </View>
                <ThemedText type="meta" themeColor={row.quiet ? 'warning' : 'textSecondary'}>
                  {row.account.last4 ? `•• ${row.account.last4} · ` : ''}
                  {row.account.snapshotKind === 'balance' && row.freshness ? row.freshness : row.caption}
                  {row.account.cardType === 'credit' && row.freshness ? ` · ${row.freshness}` : ''}
                </ThemedText>
                {statement && <ThemedText type="meta" themeColor="textSecondary" testID="wallet-card-statement">
                  {m.statementTotal(formatAED(statement.totalFils, { decimals: false }))}
                  {statement.capturedFils > 0 ? ` · ${m.capturedThisMonth(formatAED(statement.capturedFils, { decimals: false }))}` : ''}
                </ThemedText>}
                {row.usage && <View style={styles.usage} testID="wallet-card-usage">
                  <ProgressBar ratio={row.usage.ratio} color={theme.primary} height={4} />
                  <ThemedText type="meta" themeColor="textTertiary">
                    {m.usedOfLimit(formatAED(row.usage.usedFils, { decimals: false }), formatAED(row.usage.limitFils, { decimals: false }))}
                  </ThemedText>
                </View>}
              </View>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`${w.manage}: ${row.account.name}`} onPress={() => onManage(row.account)} style={styles.manage}>
              <Icon name="sliders" size={17} color={theme.textTertiary} />
            </Pressable>
          </View>
          {statement && onMarkPaid && <View style={styles.actions} testID="wallet-card-actions">
            {action(m.markPaid, m.markPaidA11y(row.account.name), () => onMarkPaid(statement.due, 'full'), `wallet-mark-paid-${row.account.id}`, true)}
            {statement.minimumStated && action(m.markMinimumPaid, m.markMinimumPaidA11y(row.account.name),
              () => onMarkPaid(statement.due, 'minimum'), `wallet-mark-minimum-${row.account.id}`)}
          </View>}
          {quietActions && <View style={styles.actions} testID="wallet-quiet-actions">
            {row.balanceEditable && onUpdateBalance && action(m.updateBalance, `${m.updateBalance}: ${row.account.name}`,
              () => onUpdateBalance(row.account), `wallet-update-balance-${row.account.id}`, true)}
            {onHide && action(m.hide, `${m.hide}: ${row.account.name}`, () => onHide(row.account), `wallet-hide-${row.account.id}`)}
          </View>}
        </View>;
      })}
    </View>)}
    {rows.length === 0 && <ThemedText type="small" themeColor="textSecondary">{w.empty}</ThemedText>}
  </View>;
}
const styles = StyleSheet.create({
  root: { gap: 12 }, group: { overflow: 'hidden' },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 6 },
  item: { paddingBottom: 2 },
  rowWrapper: { flexDirection: 'row', alignItems: 'center' }, row: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 64, paddingVertical: 10 },
  content: { flex: 1, minWidth: 0, gap: 4 }, line: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  grow: { flex: 1, minWidth: 0, gap: 4 }, stack: { flexDirection: 'column', alignItems: 'flex-start' },
  usage: { gap: 3, paddingTop: 2 },
  manage: { minWidth: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center', marginEnd: -8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingStart: 42, paddingBottom: 10 },
  action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 999, borderWidth: 1 },
});
