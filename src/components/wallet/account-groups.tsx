import { accountGroupsCopy as copy } from '@/lib/reference-copy';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { AccountTile } from '@/components/ui/tile';
import { BandFigure } from '@/components/ui/band/band-figure';
import { GrowBar } from '@/components/ui/grow-bar';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { BandPalettes, type BandPalette } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { formatAED } from '@/lib/format';
import { limitFillPercent, type LimitStatus } from '@/lib/limit-status';
import type { CardPaymentChoice, CardUsage } from '@/lib/money-places';
import { cardUsageStatus } from '@/lib/money-places-band';
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

type GroupKey = 'bank' | 'credit' | 'debit' | 'cash';

/**
 * The usage bar on the ink card: status colour only (within, near ≥85%, over
 * the user's own limit). The card is dark in both schemes, so it takes the
 * light-on-dark status tints.
 */
function usageColor(status: LimitStatus): string {
  const onInk = BandPalettes.dark.home;
  return status === 'over' ? onInk.statusOver : status === 'near' ? onInk.statusNear : onInk.statusOk;
}

/**
 * Accounts' sheet (design language E): each account as a row — logo tile,
 * name, the freshness line (amber when the figure has gone quiet) and its
 * figure — and each credit card as a small ink card holding its statement,
 * a usage bar only against a limit the user entered, what Wafra captured on
 * it this month (labelled as captured, never a bank figure), and Mark paid
 * and Details. Card dues are never netted against the balances above.
 */
export function AccountGroups({ rows, onOpen, onManage, onUpdateBalance, onHide, onMarkPaid, palette }: {
  rows: readonly AccountDisplayRow[];
  onOpen: (account: Account) => void;
  onManage: (account: Account) => void;
  onUpdateBalance?: (account: Account) => void;
  onHide?: (account: Account) => void;
  onMarkPaid?: (due: CardDue, choice: CardPaymentChoice) => void;
  /** The slate band's sheet tokens. */
  palette: BandPalette;
}) {
  const lang = useLanguage(); const large = useLargeTextLayout();
  // The ink card: a small piece of the Home band, dark in both schemes.
  const ink = useBand('home');
  const w = copy[lang === 'ar' ? 'ar' : 'en'];
  const m = moneyPlacesWords(lang);
  const groups: { key: GroupKey; rows: AccountDisplayRow[] }[] = [
    { key: 'bank', rows: [] }, { key: 'credit', rows: [] },
    { key: 'debit', rows: [] }, { key: 'cash', rows: [] },
  ];
  for (const row of rows) {
    const a = row.account;
    const key = a.cardType === 'credit' ? 'credit' : a.kind === 'cash' ? 'cash'
      : a.kind === 'card' || a.cardType === 'debit' ? 'debit' : 'bank';
    groups.find((group) => group.key === key)!.rows.push(row);
  }
  const pill = (label: string, a11y: string, onPress: () => void, testID: string, colors: { bg: string; fg: string; border?: string }) => (
    <Pressable key={testID} accessibilityRole="button" accessibilityLabel={a11y} testID={testID} onPress={onPress}
      style={({ pressed }) => [styles.pill, {
        backgroundColor: colors.bg, borderColor: colors.border ?? colors.bg, opacity: pressed ? 0.8 : 1,
      }]}>
      <ThemedText type="smallBold" style={{ color: colors.fg }}>{label}</ThemedText>
    </Pressable>
  );
  const sheetPrimary = { bg: palette.fill, fg: palette.onFill };
  const sheetSecondary = { bg: palette.card, fg: palette.text, border: palette.rule };

  const accountRow = (row: AccountDisplayRow, i: number) => {
    const quietActions = row.quiet && (onHide || (row.balanceEditable && onUpdateBalance));
    const sub = `${row.account.last4 ? `•• ${row.account.last4} · ` : ''}${
      row.account.snapshotKind === 'balance' && row.freshness ? row.freshness : row.caption}`;
    return <View key={row.account.id} testID={`wallet-account-${row.account.id}`} style={[styles.item,
      i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: palette.rule }]}>
      <View style={styles.rowWrapper}>
        <Pressable accessibilityRole="button" onPress={() => onOpen(row.account)}
          accessibilityLabel={`${row.account.name}. ${row.figureFils === null ? w.unknown : formatAED(row.figureFils)}. ${row.caption}. ${row.freshness}`}
          style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}>
          <AccountTile account={row.account} size={40} />
          <View style={styles.content}>
            <View style={[styles.line, large && styles.stack]}>
              <ThemedText type="smallBold" style={styles.grow} numberOfLines={large ? undefined : 2}>{row.account.name}</ThemedText>
              {row.figureFils === null ? <ThemedText type="smallBold" style={{ color: palette.textSecondary }}>—</ThemedText>
                : <Money fils={row.figureFils} type="smallBold" />}
            </View>
            <ThemedText type="meta" testID={row.quiet ? 'wallet-quiet-line' : undefined}
              style={{ color: row.quiet ? palette.statusNear : palette.textSecondary }}>
              {sub}
            </ThemedText>
          </View>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`${w.manage}: ${row.account.name}`} onPress={() => onManage(row.account)} style={styles.manage}>
          <Icon name="sliders" size={17} color={palette.textSecondary} />
        </Pressable>
      </View>
      {quietActions && <View style={styles.actions} testID="wallet-quiet-actions">
        {row.balanceEditable && onUpdateBalance && pill(m.updateBalance, `${m.updateBalance}: ${row.account.name}`,
          () => onUpdateBalance(row.account), `wallet-update-balance-${row.account.id}`, sheetPrimary)}
        {onHide && pill(m.hide, `${m.hide}: ${row.account.name}`, () => onHide(row.account), `wallet-hide-${row.account.id}`, sheetSecondary)}
      </View>}
    </View>;
  };

  const cardBlock = (row: AccountDisplayRow) => {
    const statement = row.statement;
    const usage = row.usage;
    // The caption says what the figure is ("Owed") before when it was seen,
    // so a card's debt never reads as a balance under the band's figure.
    const sub = [
      row.account.last4 ? `•• ${row.account.last4}` : null,
      row.caption,
      row.freshness || null,
    ].filter(Boolean).join(' · ');
    const quietActions = row.quiet && onHide;
    // Status tints read on the ink card in both schemes (it is dark in both).
    const quietColor = BandPalettes.dark.home.statusNear;
    return <View key={row.account.id} testID={`wallet-card-${row.account.id}`}
      style={[styles.card, { backgroundColor: ink.band, borderColor: ink.bandRule }]}>
      <View style={styles.rowWrapper}>
        <Pressable accessibilityRole="button" onPress={() => onOpen(row.account)}
          accessibilityLabel={`${row.account.name}. ${row.figureFils === null ? w.unknown : formatAED(row.figureFils)}. ${row.caption}. ${row.freshness}`}
          style={({ pressed }) => [styles.cardHead, large && styles.stack, { opacity: pressed ? 0.8 : 1 }]}>
          <View style={styles.cardIdentity}>
            <AccountTile account={row.account} size={36} />
            <View style={styles.grow}>
              <ThemedText type="smallBold" style={{ color: ink.onBand }} numberOfLines={large ? undefined : 2}>{row.account.name}</ThemedText>
              <ThemedText type="meta" testID={row.quiet ? 'wallet-quiet-line' : undefined}
                style={{ color: row.quiet ? quietColor : ink.onBandSecondary }}>{sub}</ThemedText>
            </View>
          </View>
          {row.figureFils === null
            ? <ThemedText type="heading" style={{ color: ink.onBandSecondary }}>—</ThemedText>
            : <BandFigure fils={row.figureFils} decimals palette={ink} size="medium" fitInset={72} />}
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`${w.manage}: ${row.account.name}`} onPress={() => onManage(row.account)} style={styles.manage}>
          <Icon name="sliders" size={17} color={ink.onBandSecondary} />
        </Pressable>
      </View>
      {usage && <View style={styles.usage} testID="wallet-card-usage">
        <View style={[styles.track, { backgroundColor: ink.bandRule }]} importantForAccessibility="no-hide-descendants">
          <GrowBar axis="width" size={limitFillPercent(usage.usedFils, usage.limitFils)} delay={200}
            style={[styles.fill, { backgroundColor: usageColor(cardUsageStatus(usage)) }]} />
        </View>
        <ThemedText type="meta" style={{ color: ink.onBandSecondary }}>
          {m.usedOfLimit(formatAED(usage.usedFils, { decimals: false }), formatAED(usage.limitFils, { decimals: false }))}
        </ThemedText>
      </View>}
      {statement && <ThemedText type="meta" style={{ color: ink.onBandSecondary }} testID="wallet-card-statement">
        {m.statementTotal(formatAED(statement.totalFils, { decimals: false }))}
        {statement.capturedFils > 0 ? ` · ${m.capturedThisMonth(formatAED(statement.capturedFils, { decimals: false }))}` : ''}
      </ThemedText>}
      <View style={styles.cardActions} testID={statement && onMarkPaid ? 'wallet-card-actions' : undefined}>
        {statement && onMarkPaid && pill(m.markPaid, m.markPaidA11y(row.account.name), () => onMarkPaid(statement.due, 'full'),
          `wallet-mark-paid-${row.account.id}`, { bg: ink.accent, fg: ink.onAccent })}
        {statement && onMarkPaid && statement.minimumStated && pill(m.markMinimumPaid, m.markMinimumPaidA11y(row.account.name),
          () => onMarkPaid(statement.due, 'minimum'), `wallet-mark-minimum-${row.account.id}`, { bg: ink.tile, fg: ink.onBand })}
        {pill(m.details, m.detailsA11y(row.account.name), () => onOpen(row.account), `wallet-card-details-${row.account.id}`,
          { bg: ink.tile, fg: ink.onBand })}
        {quietActions && pill(m.hide, `${m.hide}: ${row.account.name}`, () => onHide(row.account), `wallet-hide-${row.account.id}`,
          { bg: 'transparent', fg: ink.onBand, border: ink.bandRule })}
      </View>
    </View>;
  };

  return <View style={styles.root} testID="account-groups">
    {groups.filter((group) => group.rows.length > 0).map((group) => <View key={group.key} style={styles.group}
      testID={`account-group-${group.key}`}>
      <ThemedText type="heading" accessibilityRole="header" style={styles.groupTitle}>{w[group.key]}</ThemedText>
      {group.key === 'credit'
        ? <View style={styles.cards}>{group.rows.map(cardBlock)}</View>
        : group.rows.map(accountRow)}
    </View>)}
    {rows.length === 0 && <ThemedText type="small" style={{ color: palette.textSecondary }}>{w.empty}</ThemedText>}
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 18 }, group: { gap: 2 },
  groupTitle: { paddingBottom: 4 },
  item: { paddingBottom: 2 },
  rowWrapper: { flexDirection: 'row', alignItems: 'center' },
  row: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, paddingVertical: 12 },
  content: { flex: 1, minWidth: 0, gap: 3 }, line: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  grow: { flex: 1, minWidth: 0, gap: 2 }, stack: { flexDirection: 'column', alignItems: 'flex-start' },
  // No negative end margin: it pulled the row's own hit area 8pt under this
  // control, and on the web the logical margin resolves to the physical right
  // even in Arabic.
  manage: { minWidth: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingStart: 54, paddingBottom: 12 },
  pill: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 22, borderWidth: 1 },
  cards: { gap: 10 },
  card: { borderRadius: 22, padding: 16, gap: 12, borderWidth: StyleSheet.hairlineWidth },
  cardHead: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  cardIdentity: { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1, minWidth: 0 },
  usage: { gap: 6 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden', width: '100%' },
  fill: { height: '100%', borderRadius: 4 },
  cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
