import { accountGroupsCopy as copy } from '@/lib/reference-copy';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { AccountTile } from '@/components/ui/tile';
import { Icon, type IconName } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { useTheme } from '@/hooks/use-theme';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { ledgerCurrencyDisplay } from '@/lib/markets';
import { formatAED } from '@/lib/format';
import type { Account } from '@/lib/types';

export interface AccountDisplayRow {
  account: Account;
  figureFils: number | null;
  caption: string;
  freshness: string;
}

export function AccountGroups({ rows, onOpen, onManage }: {
  rows: readonly AccountDisplayRow[];
  onOpen: (account: Account) => void;
  onManage: (account: Account) => void;
}) {
  const theme = useTheme(); const lang = useLanguage(); const large = useLargeTextLayout();
  const w = copy[lang === 'ar' ? 'ar' : 'en'];
  const groups: { key: 'bank' | 'credit' | 'debit' | 'cash'; icon: IconName; rows: AccountDisplayRow[] }[] = [
    { key: 'bank', icon: 'bank', rows: [] }, { key: 'credit', icon: 'wallet', rows: [] },
    { key: 'debit', icon: 'wallet', rows: [] }, { key: 'cash', icon: 'cash', rows: [] },
  ];
  for (const row of rows) {
    const a = row.account;
    const key = a.cardType === 'credit' ? 'credit' : a.kind === 'cash' ? 'cash'
      : a.kind === 'card' || a.cardType === 'debit' ? 'debit' : 'bank';
    groups.find((group) => group.key === key)!.rows.push(row);
  }
  return <View style={styles.root} testID="account-groups">
    {groups.filter((group) => group.rows.length > 0).map((group) => <View key={group.key}
      style={[styles.group, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
      <View style={[styles.groupHeader, { borderColor: theme.cardBorder }]}>
        <View style={[styles.groupIcon, { backgroundColor: group.key === 'credit' ? theme.goldSoft : theme.primarySoft }]}>
          <Icon name={group.icon} size={18} color={group.key === 'credit' ? theme.gold : theme.primary} />
        </View>
        <ThemedText type="smallBold" style={styles.grow}>{w[group.key]}</ThemedText>
        <ThemedText type="meta" themeColor="textSecondary">{ledgerCurrencyDisplay()}</ThemedText>
      </View>
      {group.rows.map((row, i) => <View key={row.account.id} style={[styles.rowWrapper,
        i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.cardBorder }]}>
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
            <ThemedText type="meta" themeColor="textSecondary">
              {row.account.last4 ? `•• ${row.account.last4} · ` : ''}
              {row.account.snapshotKind === 'balance' && row.freshness ? row.freshness : row.caption}
              {row.account.cardType === 'credit' && row.freshness ? ` · ${row.freshness}` : ''}
            </ThemedText>
          </View>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`${w.manage}: ${row.account.name}`} onPress={() => onManage(row.account)} style={styles.manage}>
          <Icon name="sliders" size={17} color={theme.textTertiary} />
        </Pressable>
      </View>)}
    </View>)}
    {rows.length === 0 && <ThemedText type="small" themeColor="textSecondary">{w.empty}</ThemedText>}
    <View style={[styles.note, { backgroundColor: theme.goldSoft }]}>
      <Icon name="wallet" size={24} color={theme.gold} />
      <View style={styles.grow}><ThemedText type="smallBold">{w.sourceNote}</ThemedText>
        <ThemedText type="meta" themeColor="textSecondary">{w.sourceBody}</ThemedText></View>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  root: { gap: 16 }, group: { borderRadius: 18, borderWidth: 1, paddingHorizontal: 14, overflow: 'hidden' },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 12 },
  groupIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowWrapper: { flexDirection: 'row', alignItems: 'center' }, row: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  content: { flex: 1, minWidth: 0, gap: 4 }, line: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  grow: { flex: 1, minWidth: 0, gap: 4 }, stack: { flexDirection: 'column', alignItems: 'flex-start' },
  manage: { minWidth: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center', marginEnd: -8 },
  freshness: { fontSize: 12, lineHeight: 18 }, note: { borderRadius: 18, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
});
