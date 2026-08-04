import React, { useMemo, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button, Chip } from '@/components/ui/controls';
import { Radius, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { monthKey, monthLabel, shiftMonthKey, toISODate } from '@/lib/format';
import { t } from '@/lib/i18n';
import { usePeriod } from '@/lib/period-context';
import type { Period } from '@/lib/period';

interface PeriodSheetProps {
  visible: boolean;
  onClose: () => void;
}

/** The reporting period every screen reads from: presets, month grid, range. */
export function PeriodSheet({ visible, onClose }: PeriodSheetProps) {
  const theme = useTheme();
  const language = useLanguage();
  const { period, setPeriod } = usePeriod();

  const now = useMemo(() => new Date(), []);
  const nowKey = monthKey(now);
  const thisYear = now.getFullYear();

  const [gridYear, setGridYear] = useState(thisYear);
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');

  const apply = (p: Period) => {
    setPeriod(p);
    onClose();
  };

  const dateValid = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  const rangeValid = dateValid(fromText) && dateValid(toText) && fromText <= toText;

  const daysAgoISO = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    return toISODate(d);
  };

  const presets: { label: string; period: Period }[] = [
    { label: t('thisMonth'), period: { mode: 'month', key: nowKey } },
    { label: t('lastMonth'), period: { mode: 'month', key: shiftMonthKey(nowKey, -1) } },
    { label: t('lastSevenDays'), period: { mode: 'range', from: daysAgoISO(6), to: toISODate(now) } },
    { label: t('lastThirtyDays'), period: { mode: 'range', from: daysAgoISO(29), to: toISODate(now) } },
    { label: t('lastNinetyDays'), period: { mode: 'range', from: daysAgoISO(89), to: toISODate(now) } },
    { label: t('thisYear'), period: { mode: 'year', year: thisYear } },
    { label: `${thisYear - 1}`, period: { mode: 'year', year: thisYear - 1 } },
    { label: t('allTimeTitle'), period: { mode: 'all' } },
  ];

  const isActive = (p: Period): boolean => JSON.stringify(p) === JSON.stringify(period);

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('reportingPeriodTitle')}>
      <View style={styles.chipRow}>
        {presets.map((p) => (
          <Chip key={p.label} label={p.label} active={isActive(p.period)} onPress={() => apply(p.period)} />
        ))}
      </View>

      <View style={styles.gridHeader}>
        <ThemedText
          type="micro"
          themeColor="textTertiary"
          accessibilityRole="button"
          onPress={() => setGridYear(gridYear - 1)}>
          ‹ {gridYear - 1}
        </ThemedText>
        <ThemedText type="micro">{gridYear}</ThemedText>
        <ThemedText
          type="micro"
          themeColor="textTertiary"
          accessibilityRole="button"
          onPress={() => gridYear < thisYear && setGridYear(gridYear + 1)}
          style={{ opacity: gridYear >= thisYear ? 0.3 : 1 }}>
          {gridYear + 1} ›
        </ThemedText>
      </View>

      <View style={styles.monthGrid}>
        {Array.from({ length: 12 }, (_, i) => monthLabel(`${gridYear}-${String(i + 1).padStart(2, '0')}`, true).replace(/\s+\d+$/, '')).map((label, i) => {
          const key = `${gridYear}-${String(i + 1).padStart(2, '0')}`;
          const future = key > nowKey;
          const active = period.mode === 'month' && period.key === key;
          return (
            <View key={key} style={[styles.monthCell, { opacity: future ? 0.3 : 1 }]}>
              <Chip
                label={label}
                active={active}
                onPress={future ? undefined : () => apply({ mode: 'month', key })}
              />
            </View>
          );
        })}
      </View>

      <View style={styles.range}>
        <ThemedText type="micro" themeColor="textTertiary">
          {t('customRange')}
        </ThemedText>
        <View style={styles.rangeRow}>
          {(
            [
              [t('fromLabel'), t('fromDate'), t('fromDatePlaceholder'), fromText, setFromText],
              [t('toLabel'), t('toDate'), t('toDatePlaceholder'), toText, setToText],
            ] as const
          ).map(([label, accessibilityLabel, placeholder, value, set]) => (
            <TextInput
              key={label}
              accessibilityLabel={accessibilityLabel}
              value={value}
              onChangeText={set}
              placeholder={placeholder}
              placeholderTextColor={theme.textTertiary}
              selectionColor={theme.primary}
              style={[
                styles.input,
                {
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.cardBorder,
                  color: value && !dateValid(value) ? theme.expense : theme.text,
                  textAlign: language === 'ar' ? 'right' : 'left',
                },
              ]}
            />
          ))}
        </View>
        <Button
          label={t('applyRange')}
          disabled={!rangeValid}
          onPress={() => apply({ mode: 'range', from: fromText, to: toText })}
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  gridHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  monthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  monthCell: {
    width: '22%',
  },
  range: {
    gap: Spacing.two + 2,
  },
  rangeRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  input: {
    flex: 1,
    minWidth: 0,
    borderRadius: Radius.control,
    borderWidth: 1,
    paddingHorizontal: Spacing.three - 4,
    paddingVertical: Spacing.three - 5,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
});
