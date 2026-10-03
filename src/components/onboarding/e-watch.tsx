import { useCategoryCatalog } from '@/hooks/use-category-catalog';
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
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { LedgerCurrencySheet } from '@/components/ledger-currency-sheet';
import { EBody, EHeadline, EStepFrame, ETextAction, bandButtonColor } from '@/components/onboarding/e-frame';
import { ThemedText } from '@/components/themed-text';
import { DialLimit } from '@/components/ui/band/dial-limit';
import { EButton } from '@/components/ui/band/e-button';
import { Icon } from '@/components/ui/icon';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';

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
  const { categoryLabel, getCategory } = useCategoryCatalog();
  const language = useLanguage();
  const lang = language === 'ar' ? 'ar' : 'en';
  const words = onboardingECopy(language);
  const band = useBand('settings');
  // The picked tile wears Spending's clay, as on the board.
  const clay = useBand('spending');
  const largeText = useLargeTextLayout();
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const current = active ? draft.find((item) => item.category === active) ?? null : null;
  const step = moneySpec ? typicalMinorAmount(moneySpec, 25) : 0;
  // A full turn is ~AED 5,000 in this currency's scale; a larger limit kept
  // from an earlier pass stays reachable instead of snapping down.
  const max = moneySpec && current ? Math.max(typicalMinorAmount(moneySpec, 5000), current.limitMinor) : 0;
  const summaries = draft.filter((item) => item.limitMinor > 0 && item.category !== active);
  // The board draws three across. A label never breaks inside a word, so each
  // label's longest word is measured at the current text size and sets its
  // tile's narrowest width; a row is three tiles only when all three fit, else
  // two (or one). Larger Text starts at two.
  const labels = WATCH_CATEGORIES.map((category) => categoryLabel(category, lang));
  const labelWords = [...new Set(labels.flatMap(wordsOf))];
  const [gridWidth, setGridWidth] = useState(0);
  const [wordWidths, setWordWidths] = useState<Record<string, number>>({});
  const tileMins = labelWords.every((word) => wordWidths[word] !== undefined)
    ? labels.map((label) => Math.max(0, ...wordsOf(label).map((word) => wordWidths[word]!)) + TILE_PAD_X * 2 + 2)
    : null;
  const columns = watchColumns(gridWidth, tileMins, largeText ? 2 : 3);
  const rows = chunk(WATCH_CATEGORIES.map((category, index) => ({ category, index })), columns);
  const onWord = (word: string) => (event: LayoutChangeEvent) => {
    const width = Math.ceil(event.nativeEvent.layout.width);
    setWordWidths((current) => current[word] === width ? current : { ...current, [word]: width });
  };
  return <EStepFrame palette={band} step={3} onBack={onBack} onClose={onClose} backDisabled={disabled} testID="onboarding-watch"
    footer={<>
      <EButton palette={band} color={bandButtonColor(band)} label={words.continue} onPress={onContinue}
        disabled={disabled} testID="onboarding-watch-continue" />
      <ETextAction palette={band} label={words.notNow} onPress={onSkip} disabled={disabled} testID="onboarding-watch-skip" />
    </>}>
    <EHeadline palette={band} size={42}>{words.watchTitle}</EHeadline>
    <EBody palette={band}>{words.watchBody}</EBody>
    <View style={styles.grid} testID="onboarding-watch-options"
      onLayout={(event) => setGridWidth(Math.floor(event.nativeEvent.layout.width))}>
      {/* Invisible, unconstrained copies of each word: their widths pick the column count. */}
      <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        aria-hidden style={styles.measure}>
        {labelWords.map((word) => <ThemedText key={word} type="smallBold" onLayout={onWord(word)}>{word}</ThemedText>)}
      </View>
      {rows.map((row) => <View key={row[0]!.category} style={styles.gridRow}>{row.map(({ category, index }) => {
        const picked = draft.some((item) => item.category === category);
        const label = labels[index]!;
        return <Pressable key={category} accessibilityRole="checkbox" accessibilityLabel={label}
          accessibilityState={{ checked: picked, disabled }} aria-checked={picked} disabled={disabled} testID={`onboarding-watch-${category}`}
          onPress={() => { tapped(); onToggle(category); }}
          style={({ pressed }) => [styles.tile, tileMins && gridWidth > 0 && { minWidth: Math.min(tileMins[index]!, gridWidth) }, {
            // Picked: the board's clay. Light: the board's card on sand. Dark:
            // the band's own tone, since the dark card and the dark sand band
            // are the same brown.
            backgroundColor: picked ? clay.fill : band.scheme === 'dark' ? band.tile : band.card,
            opacity: pressed ? 0.8 : 1,
          }]}>
          <Icon name={getCategory(category).icon} size={22} color={picked ? clay.onFill : band.text} strokeWidth={2} />
          <ThemedText type="smallBold" style={{ color: picked ? clay.onFill : band.text }}>{label}</ThemedText>
        </Pressable>;
      })}</View>)}
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

const GRID_GAP = 8;
const TILE_PAD_X = 10;

const wordsOf = (label: string) => label.split(/\s+/).filter(Boolean);
function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let at = 0; at < items.length; at += size) out.push(items.slice(at, at + size));
  return out;
}

/**
 * How many tiles go across: the most (up to `max`) for which every row's
 * tiles, each at least as wide as its longest word plus padding, fit the grid.
 * Until the grid and the words are measured, the board's own count.
 */
export function watchColumns(gridWidth: number, tileMins: readonly number[] | null, max: 1 | 2 | 3): 1 | 2 | 3 {
  if (!gridWidth || !tileMins) return max;
  for (let columns = max; columns > 1; columns--) {
    const fits = chunk(tileMins, columns).every((row) =>
      row.reduce((sum, min) => sum + min, 0) + GRID_GAP * (row.length - 1) <= gridWidth);
    if (fits) return columns as 1 | 2 | 3;
  }
  return 1;
}

const styles = StyleSheet.create({
  grid: { gap: GRID_GAP },
  gridRow: { flexDirection: 'row', gap: GRID_GAP },
  tile: {
    // Equal shares of the row; a tile whose word needs more takes it (minWidth).
    flexGrow: 1, flexShrink: 0, flexBasis: 0, minHeight: 88, borderRadius: 18, paddingHorizontal: TILE_PAD_X, paddingVertical: 12,
    justifyContent: 'space-between', gap: 8,
  },
  // Off to the side of nothing: absolute, invisible and sized to its content,
  // so each word reports its unbroken width.
  measure: { position: 'absolute', top: 0, left: 0, opacity: 0, alignItems: 'flex-start' },
  dialBlock: { gap: 12, alignItems: 'center', paddingTop: 4 },
  usual: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 44, borderRadius: 22, paddingHorizontal: 14, justifyContent: 'center' },
});
