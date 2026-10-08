import { accountGroupsCopy as copy } from '@/lib/reference-copy';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { AccountTile } from '@/components/ui/tile';
import { Money } from '@/components/ui/money';
import { type BandPalette } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { formatAED } from '@/lib/format';
import { moneyPlacesWords } from '@/lib/money-places-copy';
import type { Account } from '@/lib/types';

/** The tone of a row's status line: neutral, good news, needs attention, late. */
export type AccountStatusTone = 'neutral' | 'ok' | 'near' | 'over';

export interface AccountDisplayRow {
  account: Account;
  /** A bank or cash account (a balance), a credit card (what is owed) or another card (no figure). */
  kind: 'account' | 'credit' | 'card';
  /** The one figure; null when there is none to show (a debit card never has one). */
  figureFils: number | null;
  /** What the figure is, said under it ("owed", "used") — empty for a balance. */
  figureCaption: string;
  /** The row's status line: freshness for a balance, the statement for a credit card, the link for a debit card. */
  status: string;
  statusTone: AccountStatusTone;
  /** Everything the row says, for the screen reader, in reading order. */
  spoken: string;
  /** No new figure for two weeks: the figure is the latest known, not current. */
  quiet?: boolean;
  /** Bank and cash accounts can take "Set today's balance". */
  balanceEditable?: boolean;
}

type GroupKey = 'bank' | 'credit' | 'debit' | 'cash';

/**
 * Accounts' sheet (design language E, compact list): one short row per
 * account or card — the bank's logo, the name, the last four and a status
 * line, the figure at the end — grouped as bank accounts, credit cards,
 * debit cards and cash. A tap opens the account or card; the pencil at the
 * end (or a long press) opens its manage sheet. A credit card
 * shows one figure, the latest the bank reported, and its statement on the
 * status line; a debit card shows none, as it has no balance of its own.
 * Card dues are never netted against the balances on the band.
 */
export function AccountGroups({ rows, onOpen, onManage, onUpdateBalance, onHide, palette }: {
  rows: readonly AccountDisplayRow[];
  onOpen: (account: Account) => void;
  onManage: (account: Account) => void;
  onUpdateBalance?: (account: Account) => void;
  onHide?: (account: Account) => void;
  /** The slate band's sheet tokens. */
  palette: BandPalette;
}) {
  const lang = useLanguage(); const large = useLargeTextLayout();
  const w = copy[lang === 'ar' ? 'ar' : 'en'];
  const m = moneyPlacesWords(lang);
  const groups: { key: GroupKey; rows: AccountDisplayRow[] }[] = [
    { key: 'bank', rows: [] }, { key: 'credit', rows: [] },
    { key: 'debit', rows: [] }, { key: 'cash', rows: [] },
  ];
  for (const row of rows) {
    const key = row.kind === 'credit' ? 'credit' : row.kind === 'card' ? 'debit'
      : row.account.kind === 'cash' ? 'cash' : 'bank';
    groups.find((group) => group.key === key)!.rows.push(row);
  }
  const toneColor = (tone: AccountStatusTone) => tone === 'over' ? palette.statusOver
    : tone === 'near' ? palette.statusNear : tone === 'ok' ? palette.statusOk : palette.textSecondary;
  const pill = (label: string, a11y: string, onPress: () => void, testID: string, colors: { bg: string; fg: string; border?: string }) => (
    <Pressable key={testID} accessibilityRole="button" accessibilityLabel={a11y} testID={testID} onPress={onPress}
      style={({ pressed }) => [styles.pill, {
        backgroundColor: colors.bg, borderColor: colors.border ?? colors.bg, opacity: pressed ? 0.8 : 1,
      }]}>
      <ThemedText type="smallBold" numberOfLines={1} style={{ color: colors.fg }}>{label}</ThemedText>
    </Pressable>
  );

  const row = (item: AccountDisplayRow, i: number) => {
    const a = item.account;
    const manageLabel = `${w.manage}: ${a.name}`;
    const quietActions = item.quiet && (onHide || (item.balanceEditable && onUpdateBalance));
    const testID = item.kind === 'credit' ? `wallet-card-${a.id}` : `wallet-account-${a.id}`;
    return <View key={a.id} testID={testID} style={[styles.item,
      i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: palette.rule }]}>
      <View style={styles.rowWrapper}>
      <Pressable accessibilityRole="button" onPress={() => onOpen(a)} onLongPress={() => onManage(a)}
        accessibilityLabel={item.spoken}
        style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}>
        <AccountTile account={a} size={36} />
        {/* Two lines: the name with the figure at its end, then the status
            line (full width, so a statement fits) with what the figure is. */}
        <View style={styles.body}>
          <View style={[styles.line, large && styles.lineStacked]}>
            <ThemedText type="smallBold" numberOfLines={large ? undefined : 2} style={styles.name}>{a.name}</ThemedText>
            {item.kind === 'card' ? null : item.figureFils === null
              ? <ThemedText type="smallBold" style={{ color: palette.textSecondary }}>—</ThemedText>
              : <Money fils={item.figureFils} type="smallBold" style={styles.figure} />}
          </View>
          <View style={[styles.line, large && styles.lineStacked]}>
            <ThemedText type="meta" numberOfLines={large ? undefined : 2}
              testID={item.quiet ? 'wallet-quiet-line' : `wallet-status-${a.id}`}
              style={[styles.status, { color: item.quiet ? palette.statusNear : toneColor(item.statusTone) }]}>
              {/* The last four is one left-to-right run, so Arabic never reorders it into "· ·". */}
              {a.last4 ? <ThemedText type="meta" style={{ color: palette.textSecondary }}>{`\u2066•• ${a.last4}\u2069 · `}</ThemedText> : null}
              {item.status}
            </ThemedText>
            {item.figureCaption ? <ThemedText type="meta" numberOfLines={1} style={{ color: palette.textSecondary }}>
              {item.figureCaption}</ThemedText> : null}
          </View>
        </View>
      </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={manageLabel} testID={`wallet-manage-${a.id}`}
          onPress={() => onManage(a)} hitSlop={4} style={styles.manage}>
          <Icon name="pencil" size={16} color={palette.textSecondary} />
        </Pressable>
      </View>
      {quietActions && <View style={[styles.actions, large && styles.actionsStacked]} testID="wallet-quiet-actions">
        {item.balanceEditable && onUpdateBalance && pill(m.updateBalance, `${m.updateBalance}: ${a.name}`,
          () => onUpdateBalance(a), `wallet-update-balance-${a.id}`, { bg: palette.fill, fg: palette.onFill })}
        {onHide && pill(m.hide, `${m.hide}: ${a.name}`, () => onHide(a), `wallet-hide-${a.id}`,
          { bg: palette.card, fg: palette.text, border: palette.rule })}
      </View>}
    </View>;
  };

  return <View style={styles.root} testID="account-groups">
    {groups.filter((group) => group.rows.length > 0).map((group) => {
      const title = group.key === 'debit' && group.rows.every((r) => r.account.cardType === 'debit') ? w.debitCards : w[group.key];
      return <View key={group.key} style={styles.group} testID={`account-group-${group.key}`}>
        <View style={styles.groupHead}>
          <ThemedText type="heading" accessibilityRole="header" style={styles.groupTitle}>{title}</ThemedText>
          {group.rows.length > 1 ? <ThemedText type="meta" style={{ color: palette.textSecondary }}>
            {group.rows.length}</ThemedText> : null}
        </View>
        {group.rows.map(row)}
      </View>;
    })}
    {rows.length === 0 && <ThemedText type="small" style={{ color: palette.textSecondary }}>{w.empty}</ThemedText>}
  </View>;
}

/** The spoken label of a row: name, figure and what it is, status. */
export function accountRowSpoken(name: string, figureFils: number | null, unknown: string, ...parts: string[]): string {
  return [name, figureFils === null ? unknown : formatAED(figureFils), ...parts].filter(Boolean).join('. ');
}

const styles = StyleSheet.create({
  root: { gap: 18 }, group: { gap: 0 },
  groupHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingBottom: 2 },
  groupTitle: { flexShrink: 1 },
  item: {},
  rowWrapper: { flexDirection: 'row', alignItems: 'center' },
  // Manage (a pencil): a 44pt target at the row's end.
  manage: { minWidth: 40, minHeight: 44, alignItems: 'center', justifyContent: 'center', marginEnd: -8 },
  // One short row: 36pt logo, two lines of text, the figure at the end.
  row: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingVertical: 10 },
  body: { flex: 1, minWidth: 0, gap: 2 },
  line: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  lineStacked: { flexDirection: 'column', alignItems: 'flex-start', gap: 2 },
  name: { flex: 1, minWidth: 0 },
  status: { flex: 1, minWidth: 0 },
  figure: { flexShrink: 0 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingStart: 48, paddingBottom: 10 },
  actionsStacked: { paddingStart: 0 },
  pill: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 22, borderWidth: 1 },
});
