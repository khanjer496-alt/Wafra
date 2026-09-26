/**
 * E4 · Watch (sand): "Anything to keep an eye on?". Pick everyday categories;
 * the one being set gets the dial (DialLimit, currency-scaled steps) and every
 * picked one with a limit becomes an ordinary monthly budget when the person
 * continues (onboarding-e.ts: watchBudgetChanges). A picked category left at
 * nothing is not saved. "Not now" writes nothing.
 *
 * The dial never guesses a starting figure: it starts at nothing and the
 * person turns it. The honest line says the Limit sheet shows their usual
 * once a month of spending is in.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { LedgerCurrencySheet } from '@/components/ledger-currency-sheet';
import { EBody, EHeadline, EStepFrame, ETextAction, bandButtonColor } from '@/components/onboarding/e-frame';
import { ThemedText } from '@/components/themed-text';
import { DialLimit } from '@/components/ui/band/dial-limit';
import { EButton } from '@/components/ui/band/e-button';
import { Icon } from '@/components/ui/icon';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { categoryLabel, getCategory } from '@/lib/categories';
import { tapped } from '@/lib/haptics';
import { formatMoneyText, typicalMinorAmount, type LedgerMoneySpec } from '@/lib/ledger-money';
import { WATCH_CATEGORIES, type WatchDraft } from '@/lib/onboarding-e';
import { onboardingECopy } from '@/lib/onboarding-e-copy';
import type { CategoryId } from '@/lib/types';

export function WatchStep({ draft, active, onToggle, onActivate, onLimit, moneySpec, currency, onCurrency,
  onContinue, onSkip, onBack, onClose, disabled }: {
  draft: readonly WatchDraft[];
  /** The picked category whose dial is showing. */
  active: CategoryId | null;
  onToggle: (category: CategoryId) => void;
  onActivate: (category: CategoryId) => void;
  onLimit: (category: CategoryId, limitMinor: number) => void;
  /** The ledger's money spec, or the confirmed currency's; null until a currency is known. */
  moneySpec: LedgerMoneySpec | null;
  currency: string | null;
  onCurrency: (code: string) => void;
  onContinue: () => void;
  onSkip: () => void;
  onBack: () => void;
  onClose?: () => void;
  disabled: boolean;
}) {
  const language = useLanguage();
  const lang = language === 'ar' ? 'ar' : 'en';
  const words = onboardingECopy(language);
  const band = useBand('settings');
  const largeText = useLargeTextLayout();
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const current = active ? draft.find((item) => item.category === active) ?? null : null;
  const step = moneySpec ? typicalMinorAmount(moneySpec, 25) : 0;
  // A full turn is ~AED 5,000 in this currency's scale; a larger limit kept
  // from an earlier pass stays reachable instead of snapping down.
  const max = moneySpec && current ? Math.max(typicalMinorAmount(moneySpec, 5000), current.limitMinor) : 0;
  const summaries = draft.filter((item) => item.limitMinor > 0 && item.category !== active);
  return <EStepFrame palette={band} step={3} onBack={onBack} onClose={onClose} backDisabled={disabled} testID="onboarding-watch"
    footer={<>
      <EButton palette={band} color={bandButtonColor(band)} label={words.continue} onPress={onContinue}
        disabled={disabled} testID="onboarding-watch-continue" />
      <ETextAction palette={band} label={words.notNow} onPress={onSkip} disabled={disabled} testID="onboarding-watch-skip" />
    </>}>
    <EHeadline palette={band} size={42}>{words.watchTitle}</EHeadline>
    <EBody palette={band}>{words.watchBody}</EBody>
    <View style={styles.grid} testID="onboarding-watch-options">
      {WATCH_CATEGORIES.map((category) => {
        const picked = draft.some((item) => item.category === category);
        const label = categoryLabel(category, lang);
        return <Pressable key={category} accessibilityRole="checkbox" accessibilityLabel={label}
          accessibilityState={{ checked: picked, disabled }} disabled={disabled} testID={`onboarding-watch-${category}`}
          onPress={() => { tapped(); onToggle(category); }}
          style={({ pressed }) => [styles.tile, largeText && styles.tileLarge, {
            // Light: the board's card on sand. Dark: the band's own tone, since
            // the dark card and the dark sand band are the same brown.
            backgroundColor: picked ? band.fill : band.scheme === 'dark' ? band.tile : band.card,
            opacity: pressed ? 0.8 : 1,
          }]}>
          <Icon name={getCategory(category).icon} size={24} color={picked ? band.onFill : band.text} strokeWidth={2} />
          <ThemedText type="smallBold" style={{ color: picked ? band.onFill : band.text }}>{label}</ThemedText>
        </Pressable>;
      })}
    </View>
    {current ? (moneySpec ? <View style={styles.dialBlock} testID="onboarding-watch-dial">
      <ThemedText type="smallBold" style={{ color: band.onBand }} accessibilityRole="header">
        {words.watchEditing(categoryLabel(current.category, lang))}
      </ThemedText>
      <DialLimit label={categoryLabel(current.category, lang)} valueMinor={current.limitMinor}
        onChange={(next) => onLimit(current.category, next)} palette={band} on="band"
        moneySpec={moneySpec} stepMinor={step} maxMinor={max} testID="onboarding-watch-limit" />
      <EBody palette={band} style={styles.usual}>
        {current.limitMinor > 0 ? words.watchUsual : words.watchSetLimit}
      </EBody>
    </View> : <View style={styles.dialBlock}>
      <EBody palette={band}>{words.watchNoCurrency}</EBody>
      <EButton palette={band} variant="secondary" label={words.currencyLabel} onPress={() => setCurrencyOpen(true)}
        testID="onboarding-watch-currency" />
    </View>) : null}
    {summaries.length > 0 && moneySpec ? <View style={styles.chips}>
      {summaries.map((item) => {
        const text = words.watchLimitSummary(categoryLabel(item.category, lang),
          formatMoneyText(item.limitMinor, moneySpec, { decimals: false }));
        return <Pressable key={item.category} accessibilityRole="button" accessibilityLabel={text}
          onPress={() => { tapped(); onActivate(item.category); }}
          style={({ pressed }) => [styles.chip, { backgroundColor: band.tile, opacity: pressed ? 0.7 : 1 }]}>
          <ThemedText type="meta" style={{ color: band.onBand }}>{text}</ThemedText>
        </Pressable>;
      })}
    </View> : null}
    <LedgerCurrencySheet visible={currencyOpen} value={currency} onClose={() => setCurrencyOpen(false)}
      onSelect={(code) => { onCurrency(code); setCurrencyOpen(false); }} />
  </EStepFrame>;
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    // Two across, so a long category name ("Entertainment", Arabic labels)
    // never breaks mid-word; one across at the accessibility sizes.
    flexBasis: '47%', flexGrow: 1, minHeight: 80, borderRadius: 20, padding: 12,
    justifyContent: 'space-between', gap: 8,
  },
  tileLarge: { flexBasis: '100%' },
  dialBlock: { gap: 12, alignItems: 'center', paddingTop: 4 },
  usual: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 44, borderRadius: 22, paddingHorizontal: 14, justifyContent: 'center' },
});
