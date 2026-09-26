import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { BandChip } from '@/components/ui/band/band-chip';
import { BandFigure } from '@/components/ui/band/band-figure';
import { EButton } from '@/components/ui/band/e-button';
import { Fonts, type BandPalette } from '@/constants/theme';
import { t } from '@/lib/i18n';
import { moneyPlacesWords } from '@/lib/money-places-copy';


type BalanceOverviewProps = {
  balanceCoverageText: string; balanceFils: number; knownBalanceCount: number;
  activeSourceCount: number;
  /** Credit cards kept apart from the balances (their dues are never netted). */
  creditCardCount: number;
  /** What the figure is and is not ("not a live bank connection…"). */
  sourceNote: string;
  language: string;
  largeText: boolean;
  /** The slate band it sits on. */
  palette: BandPalette;
  onAddAccount: () => void;
};

/**
 * Accounts' band (design language E, slate): the recorded balances as the
 * one figure — the latest each bank reported, plus cash kept by hand — with
 * two facts as chips: how many accounts that covers, and how many credit
 * cards are shown on their own. There is deliberately no merged "net" figure:
 * card dues and incomplete balances are never subtracted from it.
 */
export function BalanceOverview(p: BalanceOverviewProps) {
  const w = moneyPlacesWords(p.language);
  const band = p.palette;
  return <View style={styles.root} testID="reference-account-balance">
    {p.knownBalanceCount > 0
      ? <BandFigure testID="wallet-balance-figure" label={t('availableBalances')} fils={p.balanceFils}
          qualifier={p.sourceNote} palette={band} />
      : <View accessible accessibilityRole="text" testID="wallet-balance-figure"
          accessibilityLabel={`${t('availableBalances')}. ${w.noBalanceFigure}. ${p.balanceCoverageText}`} style={styles.empty}>
          <ThemedText type="small" style={{ color: band.onBandSecondary }}>{t('availableBalances')}</ThemedText>
          <ThemedText maxFontSizeMultiplier={1.5} style={[styles.dash, { color: band.onBand }]}>—</ThemedText>
          <ThemedText type="meta" style={{ color: band.onBandSecondary }}>{p.sourceNote}</ThemedText>
        </View>}
    <View style={[styles.chips, p.largeText && styles.stack]} testID="wallet-coverage-chips">
      <BandChip palette={band} label={p.balanceCoverageText} testID="wallet-coverage-chip" />
      {p.creditCardCount > 0 ? <BandChip palette={band} label={w.cardsApart(p.creditCardCount)} testID="wallet-cards-apart-chip" /> : null}
    </View>
    {p.activeSourceCount === 0
      ? <EButton palette={band} label={t('newAccount')} icon="plus" onPress={p.onAddAccount} testID="wallet-add-first-account"
          color={{ fill: band.accent, text: band.onAccent }} />
      : null}
  </View>;
}
const styles = StyleSheet.create({
  root: { gap: 16 },
  empty: { gap: 4 },
  dash: { fontFamily: Fonts.sansSemi, fontSize: 56, lineHeight: 62 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stack: { flexDirection: 'column', alignItems: 'flex-start' },
});
