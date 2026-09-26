/**
 * E8 · First payment (green): the pieces of step 5. The gate owns every
 * action (permissions, the Shortcuts hand-off, the durable opt-out); these
 * only draw them on the band:
 *
 * - `SourceRow`: one way in — bank SMS, bank-app alerts, statements, by hand —
 *   a real button with its own state;
 * - `ArrivedCard`: the newest payment that reached the ledger by itself, with
 *   the watched category's bar for this month — real figures, the Limit
 *   status colours, never an example;
 * - `ResultStrip`: what an import found, as counts the ledger holds.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { StatusBar as LimitBar } from '@/components/ui/band/status-bar';
import { Icon, type IconName } from '@/components/ui/icon';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import { Fonts, type BandPalette } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { categoryLabel } from '@/lib/categories';
import { tapped } from '@/lib/haptics';
import { formatMoneyText, type LedgerMoneySpec } from '@/lib/ledger-money';
import { onboardingECopy } from '@/lib/onboarding-e-copy';
import type { CategoryId, Transaction } from '@/lib/types';

export function SourceRow({ icon, title, body, ready, onPress, disabled, palette, testID }: {
  icon: IconName;
  title: string;
  body?: string;
  /** Connected: the row shows a check and reports itself selected. */
  ready?: boolean;
  onPress: () => void;
  disabled: boolean;
  palette: BandPalette;
  testID?: string;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={body ? `${title}. ${body}` : title}
    accessibilityState={{ selected: !!ready, disabled }} disabled={disabled} testID={testID}
    onPress={() => { tapped(); onPress(); }}
    style={({ pressed }) => [styles.source, {
      backgroundColor: ready ? palette.onBand : palette.tile,
      opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
    }]}>
    <View style={[styles.sourceIcon, { backgroundColor: ready ? palette.band : palette.bandRule }]}>
      <Icon name={icon} size={20} color={palette.onBand} />
    </View>
    <View style={styles.grow}>
      <ThemedText type="smallBold" style={{ color: ready ? palette.band : palette.onBand }}>{title}</ThemedText>
      {body ? <ThemedText type="meta" style={{ color: ready ? palette.band : palette.onBandSecondary }}>{body}</ThemedText> : null}
    </View>
    <Icon name={ready ? 'check' : 'chevron-right'} size={18} color={ready ? palette.band : palette.onBand} />
  </Pressable>;
}

/** The trust points under the capture choices: local capture, no bank login, optional. */
export function TrustLine({ items, palette }: { items: { icon: IconName; title: string; body: string }[]; palette: BandPalette }) {
  const largeText = useLargeTextLayout();
  return <View style={[styles.trust, largeText && styles.trustStacked]} testID="onboarding-context-trust">
    {items.map((item) => <View key={item.title} style={styles.trustItem} accessible accessibilityLabel={`${item.title}. ${item.body}`}>
      <Icon name={item.icon} size={16} color={palette.onBand} />
      <ThemedText type="micro" style={[styles.trustText, { color: palette.onBandSecondary }]}>{item.title}</ThemedText>
    </View>)}
  </View>;
}

/**
 * The first payment that arrived by itself, on a sheet-coloured card, and the
 * watched category's month so far against its limit. `watch` is null when no
 * limit was set, and then only the row is shown.
 */
export function ArrivedCard({ transaction, money, watch, palette }: {
  transaction: Transaction;
  money: LedgerMoneySpec | null;
  watch: { category: CategoryId; spentMinor: number; limitMinor: number } | null;
  palette: BandPalette;
}) {
  const language = useLanguage();
  const lang = language === 'ar' ? 'ar' : 'en';
  const words = onboardingECopy(language);
  const largeText = useLargeTextLayout();
  const amount = money
    ? formatMoneyText(transaction.type === 'income' ? Math.abs(transaction.amountFils) : -Math.abs(transaction.amountFils), money)
    : null;
  const category = categoryLabel(transaction.category, lang);
  const ofLimit = watch && money ? words.ofLimit(formatMoneyText(watch.spentMinor, money, { decimals: false }),
    formatMoneyText(watch.limitMinor, money, { decimals: false })) : null;
  // One sheet-coloured card, like Home's rows: the limit bar's status colours
  // are text-grade on the sheet, never on the green band.
  return <View style={styles.arrived} testID="onboarding-first-payment">
    <View style={[styles.card, { backgroundColor: palette.sheet }]}>
      <View style={[styles.row, largeText && styles.rowStacked]} accessible
        accessibilityLabel={[transaction.title, category, amount].filter(Boolean).join(', ')}>
        <MerchantAvatar title={transaction.title} category={transaction.category} size={40} />
        <View style={styles.grow}>
          <ThemedText type="smallBold" style={{ color: palette.text }}>{transaction.title}</ThemedText>
          <ThemedText type="meta" style={{ color: palette.textSecondary }}>{category}</ThemedText>
        </View>
        {amount ? <ThemedText type="smallBold" tabular style={{ color: palette.text }}>{amount}</ThemedText> : null}
      </View>
      {watch && ofLimit ? <View style={[styles.watch, { borderTopColor: palette.rule }]} accessible
        accessibilityLabel={`${categoryLabel(watch.category, lang)}, ${ofLimit}`} testID="onboarding-first-payment-watch">
        <View style={styles.watchHead}>
          <ThemedText type="smallBold" style={{ color: palette.text }}>{categoryLabel(watch.category, lang)}</ThemedText>
          <ThemedText type="meta" style={[styles.figure, { color: palette.textSecondary }]}>{ofLimit}</ThemedText>
        </View>
        <LimitBar spentMinor={watch.spentMinor} limitMinor={watch.limitMinor} palette={palette} />
      </View> : null}
    </View>
    <ThemedText type="meta" style={{ color: palette.onBandSecondary }}>{words.addedByItself}</ThemedText>
  </View>;
}

/** What an import found. Counts only; the ready summary below says where it went. */
export function ResultStrip({ cells, palette }: { cells: { value: number; label: string }[]; palette: BandPalette }) {
  return <View style={[styles.strip, { borderColor: palette.bandRule }]} testID="onboarding-result-strip">
    {cells.map((cell) => <View key={cell.label} style={styles.cell} accessible accessibilityLabel={`${cell.value} ${cell.label}`}>
      <ThemedText style={[styles.cellValue, { color: palette.onBand }]}>{cell.value}</ThemedText>
      <ThemedText type="micro" style={[styles.cellLabel, { color: palette.onBandSecondary }]}>{cell.label}</ThemedText>
    </View>)}
  </View>;
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0, gap: 2 },
  source: {
    minHeight: 68, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10,
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  sourceIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  trust: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  trustStacked: { flexDirection: 'column' },
  trustItem: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  trustText: { flexShrink: 1 },
  arrived: { gap: 14 },
  card: { borderRadius: 24, paddingHorizontal: 16, paddingVertical: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowStacked: { flexWrap: 'wrap' },
  watch: { gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  watchHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
  figure: { fontVariant: ['tabular-nums'] },
  strip: { flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: 10 },
  cell: { flex: 1, alignItems: 'center', gap: 2 },
  cellValue: { fontFamily: Fonts.sansSemi, fontSize: 26, lineHeight: 32, fontVariant: ['tabular-nums'] },
  cellLabel: { textAlign: 'center' },
});
