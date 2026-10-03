/**
 * E4 · Watch (sand): "Anything to keep an eye on?". One row per everyday
 * category. Tapping a row only opens or closes it — one open at a time — and
 * never removes anything; an open row sets its monthly limit with four quick
 * amounts in the currency's own scale, a typed figure, or ± steps. A row
 * with a limit shows it and has its own Remove. Every row with a limit
 * becomes an ordinary monthly budget when the person saves
 * (onboarding-e.ts: watchBudgetChanges); the one button says what it will do
 * (watchFooterAction): Save N limits, Continue after a removal, or Skip.
 *
 * Nothing guesses a starting figure. The honest line says the Limit sheet
 * shows their usual once a month of spending is in. Without a currency the
 * rows wait for one, chosen right here instead of a dead end.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { LedgerCurrencySheet } from '@/components/ledger-currency-sheet';
import { choiceSurface } from '@/components/onboarding/e-choice-row';
import { EBody, EHeadline, EStepFrame, bandButtonColor } from '@/components/onboarding/e-frame';
import { ThemedText } from '@/components/themed-text';
import { EButton } from '@/components/ui/band/e-button';
import { Icon } from '@/components/ui/icon';
import { Fonts, type BandPalette } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useCategoryCatalog } from '@/hooks/use-category-catalog';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { normalizeArabicNumerals } from '@/lib/arabic-sms';
import { bandCopy } from '@/lib/band-copy';
import { parseAmountWithMoneySpec } from '@/lib/format';
import { tapped } from '@/lib/haptics';
import {
  currencyDisplayLabel,
  formatMinorUnits,
  formatMinorUnitsForInput,
  formatMoneyText,
  typicalMinorAmount,
  type LedgerMoneySpec,
} from '@/lib/ledger-money';
import { WATCH_CATEGORIES, WATCH_QUICK_REFERENCES, type WatchDraft, type WatchFooterAction } from '@/lib/onboarding-e';
import { onboardingECopy } from '@/lib/onboarding-e-copy';
import type { CategoryId } from '@/lib/types';

/**
 * A typed limit in minor units: the app's own amount reading (Arabic digits
 * and marks, the device's decimal and group marks). Blank or all zeros is no
 * limit; anything unreadable is null and leaves the limit as it was.
 */
export function parseWatchAmount(text: string, spec: LedgerMoneySpec): number | null {
  const digits = normalizeArabicNumerals(text).replace(/[^0-9]/g, '');
  if (!digits || /^0+$/.test(digits)) return 0;
  return parseAmountWithMoneySpec(text, spec);
}

/** Money for a screen reader: the ISO code and the exact figure. */
const spoken = (minor: number, spec: LedgerMoneySpec) => `${spec.currency} ${formatMinorUnits(minor, spec)}`;

/**
 * An open row's editor: quick amounts, the typed figure between − and +.
 * Every path reports whole minor units through `onChange`; 0 is no limit.
 */
function AmountEditor({ valueMinor, onChange, spec, label, palette, disabled, testID }: {
  valueMinor: number;
  onChange: (next: number) => void;
  spec: LedgerMoneySpec;
  label: string;
  palette: BandPalette;
  disabled: boolean;
  testID: string;
}) {
  const language = useLanguage();
  const words = onboardingECopy(language);
  const steps = bandCopy(language);
  const quick = WATCH_QUICK_REFERENCES.map((major) => typicalMinorAmount(spec, major));
  const step = typicalMinorAmount(spec, 50);
  const shown = (minor: number) => minor > 0 ? formatMinorUnitsForInput(minor, spec) : '';
  const [text, setText] = useState(() => shown(valueMinor));
  // The figure the text last stood for: a quick amount or a step replaces
  // the text, typing that already reads as the value leaves it alone.
  const typed = useRef(valueMinor);
  useEffect(() => {
    if (typed.current !== valueMinor) {
      typed.current = valueMinor;
      setText(shown(valueMinor));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueMinor]);
  // A quick amount or a step always rewrites the field, even when the limit
  // is unchanged, so an unreadable draft never stays next to a saved figure.
  const set = (next: number) => {
    const safe = Math.max(0, next);
    typed.current = safe;
    setText(shown(safe));
    if (safe === valueMinor) return;
    tapped();
    onChange(safe);
  };
  const currency = currencyDisplayLabel(spec.currency);
  return <View style={styles.editor} testID={testID}>
    <View style={styles.quickRow}>
      {quick.map((minor, index) => {
        const on = minor === valueMinor;
        return <Pressable key={minor} accessibilityRole="button" accessibilityLabel={spoken(minor, spec)}
          accessibilityState={{ selected: on, disabled }} disabled={disabled} testID={`${testID}-quick-${index}`}
          onPress={() => set(minor)}
          style={({ pressed }) => [styles.quick, {
            borderColor: on ? palette.onBand : palette.bandRule,
            backgroundColor: on ? palette.onBand : 'transparent',
            opacity: pressed ? 0.7 : 1,
          }]}>
          <ThemedText type="smallBold" tabular style={{ color: on ? palette.band : palette.onBand }}>
            {formatMinorUnits(minor, spec, { decimals: false })}
          </ThemedText>
        </Pressable>;
      })}
    </View>
    <View style={styles.stepRow}>
      <Pressable accessibilityRole="button" accessibilityLabel={steps.lower(spoken(step, spec))}
        disabled={disabled || valueMinor <= 0} testID={`${testID}-lower`} onPress={() => set(valueMinor - step)}
        style={({ pressed }) => [styles.stepper, { borderColor: palette.bandRule, opacity: valueMinor <= 0 ? 0.4 : pressed ? 0.7 : 1 }]}>
        <ThemedText type="heading" style={{ color: palette.onBand }}>−</ThemedText>
      </Pressable>
      <View style={[styles.field, { borderColor: palette.onBand }]}>
        <ThemedText type="meta" style={{ color: palette.onBandSecondary }}>{currency}</ThemedText>
        <TextInput value={text} editable={!disabled} accessibilityLabel={words.watchTypeAmount(label)}
          testID={`${testID}-input`} keyboardType={spec.exponent === 0 ? 'number-pad' : 'decimal-pad'}
          returnKeyType="done" placeholder="0"
          placeholderTextColor={palette.onBandSecondary} selectionColor={palette.onBand} cursorColor={palette.onBand}
          onChangeText={(next) => {
            setText(next);
            const parsed = parseWatchAmount(next, spec);
            if (parsed === null) return;
            typed.current = parsed;
            if (parsed !== valueMinor) onChange(parsed);
          }}
          // Leaving the field shows exactly the limit that will be saved.
          onBlur={() => { typed.current = valueMinor; setText(shown(valueMinor)); }}
          style={[styles.input, { color: palette.onBand }]} />
        <ThemedText type="meta" style={{ color: palette.onBandSecondary }}>{words.watchPerMonth}</ThemedText>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={steps.raise(spoken(step, spec))}
        disabled={disabled} testID={`${testID}-raise`} onPress={() => set(valueMinor + step)}
        style={({ pressed }) => [styles.stepper, { borderColor: palette.bandRule, opacity: pressed ? 0.7 : 1 }]}>
        <ThemedText type="heading" style={{ color: palette.onBand }}>+</ThemedText>
      </Pressable>
    </View>
    <EBody palette={palette} style={styles.usual}>{words.watchUsual}</EBody>
  </View>;
}

export function WatchStep({ draft, open, onOpen, onLimit, moneySpec, currency, onCurrency,
  action, onContinue, onBack, onClose, disabled }: {
  draft: readonly WatchDraft[];
  /** The row that is open, if any. */
  open: CategoryId | null;
  onOpen: (category: CategoryId | null) => void;
  /** 0 removes the row's limit. */
  onLimit: (category: CategoryId, limitMinor: number) => void;
  /** The ledger's money spec, or the confirmed currency's; null until a currency is known. */
  moneySpec: LedgerMoneySpec | null;
  currency: string | null;
  onCurrency: (code: string) => void;
  action: WatchFooterAction;
  onContinue: () => void;
  onBack: () => void;
  onClose?: () => void;
  disabled: boolean;
}) {
  const { categoryLabel, getCategory } = useCategoryCatalog();
  const language = useLanguage();
  const lang = language === 'ar' ? 'ar' : 'en';
  const words = onboardingECopy(language);
  const band = useBand('settings');
  // A row with a limit wears Spending's clay on its icon, as picked tiles do on the board.
  const clay = useBand('spending');
  const largeText = useLargeTextLayout();
  const [currencyOpen, setCurrencyOpen] = useState(false);
  /** The row tapped before a currency was chosen; it opens once one is. */
  const [pending, setPending] = useState<CategoryId | null>(null);
  const label = action.kind === 'save' ? words.watchSave(action.count)
    : action.kind === 'continue' ? words.continue : words.skipForNow;
  return <EStepFrame palette={band} step={3} onBack={onBack} onClose={onClose} backDisabled={disabled} testID="onboarding-watch"
    footer={<EButton palette={band} color={bandButtonColor(band)} label={label} onPress={onContinue}
      disabled={disabled} testID="onboarding-watch-continue" />}>
    <EHeadline palette={band} size={42}>{words.watchTitle}</EHeadline>
    <EBody palette={band}>{words.watchBody}</EBody>
    {moneySpec ? null : <View style={styles.currency}>
      <EBody palette={band} secondary={false}>{words.watchNoCurrency}</EBody>
      <EButton palette={band} variant="secondary" label={words.chooseCurrency} onPress={() => setCurrencyOpen(true)}
        testID="onboarding-watch-currency" />
    </View>}
    <View style={styles.list} testID="onboarding-watch-options">
      {WATCH_CATEGORIES.map((category) => {
        const name = categoryLabel(category, lang);
        const limit = draft.find((item) => item.category === category)?.limitMinor ?? 0;
        // Exact, never rounded: the row shows the figure that will be saved.
        const amount = limit > 0 && moneySpec ? formatMoneyText(limit, moneySpec) : null;
        const isOpen = open === category && moneySpec !== null;
        return <View key={category} style={[styles.row, choiceSurface(band, isOpen || amount !== null)]}>
          <View style={styles.head}>
            <Pressable accessibilityRole="button"
              accessibilityLabel={`${name}, ${limit > 0 && moneySpec ? spoken(limit, moneySpec) : words.watchNoLimit}`}
              accessibilityState={{ expanded: isOpen, disabled }} aria-expanded={isOpen} disabled={disabled}
              testID={`onboarding-watch-${category}`}
              onPress={() => {
                tapped();
                if (!moneySpec) { setPending(category); setCurrencyOpen(true); return; }
                onOpen(isOpen ? null : category);
              }}
              style={({ pressed }) => [styles.headPress, largeText && styles.headWrap,
                { opacity: disabled ? 0.5 : pressed ? 0.7 : 1 }]}>
              <View style={[styles.icon, {
                backgroundColor: amount ? clay.fill : band.scheme === 'dark' ? band.bandRule : band.card,
              }]}>
                <Icon name={getCategory(category).icon} size={20} color={amount ? clay.onFill : band.text} strokeWidth={2} />
              </View>
              <ThemedText type="smallBold" style={[styles.name, largeText && styles.nameWide, { color: band.onBand }]}>{name}</ThemedText>
              {amount ? <ThemedText type="smallBold" tabular style={{ color: band.onBand }}>{amount}</ThemedText>
                : isOpen ? null
                  : <ThemedText type="meta" style={{ color: band.onBandSecondary }}>{words.watchAdd}</ThemedText>}
              <View style={isOpen ? styles.flipped : null}>
                <Icon name="chevron-down" size={18} color={band.onBandSecondary} />
              </View>
            </Pressable>
            {amount ? <Pressable accessibilityRole="button" accessibilityLabel={words.watchRemove(name)} hitSlop={6}
              disabled={disabled} testID={`onboarding-watch-${category}-remove`}
              onPress={() => { tapped(); onLimit(category, 0); }}
              style={({ pressed }) => [styles.remove, { opacity: pressed ? 0.6 : 1 }]}>
              <Icon name="close" size={16} color={band.onBand} />
            </Pressable> : null}
          </View>
          {isOpen && moneySpec ? <AmountEditor valueMinor={limit} onChange={(next) => onLimit(category, next)}
            spec={moneySpec} label={name} palette={band} disabled={disabled} testID="onboarding-watch-limit" /> : null}
        </View>;
      })}
    </View>
    <LedgerCurrencySheet visible={currencyOpen} value={currency}
      onClose={() => { setCurrencyOpen(false); setPending(null); }}
      onSelect={(code) => {
        onCurrency(code);
        setCurrencyOpen(false);
        if (pending) onOpen(pending);
        setPending(null);
      }} />
  </EStepFrame>;
}

const styles = StyleSheet.create({
  currency: { gap: 10 },
  list: { gap: 8 },
  row: { borderRadius: 20, borderWidth: 1.5, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center' },
  headPress: {
    flex: 1, minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingStart: 12, paddingEnd: 14, paddingVertical: 10,
  },
  // At the accessibility sizes the amount may take its own line; never the chevron alone.
  headWrap: { flexWrap: 'wrap' },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  name: { flex: 1, minWidth: 0, fontSize: 17, lineHeight: 23 },
  // The name keeps a readable line; the amount and chevron wrap under it instead.
  nameWide: { minWidth: 140 },
  flipped: { transform: [{ rotate: '180deg' }] },
  remove: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginEnd: 6 },
  editor: { paddingHorizontal: 14, paddingBottom: 14, gap: 12 },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  quick: {
    flexGrow: 1, flexBasis: '20%', minHeight: 44, borderRadius: 22, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10,
  },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepper: { width: 48, height: 48, borderRadius: 24, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  field: {
    flex: 1, minWidth: 0, minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 8,
    borderBottomWidth: 2, paddingHorizontal: 4,
  },
  input: {
    flex: 1, minWidth: 48, fontFamily: Fonts.sansSemi, fontVariant: ['tabular-nums'], fontSize: 26, lineHeight: 32,
    paddingVertical: 6,
  },
  usual: { fontSize: 14, lineHeight: 20 },
});
