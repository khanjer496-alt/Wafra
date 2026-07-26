import React, { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { monthKey, shiftMonthKey, toISODate } from '@/lib/format';
import { usePeriod } from '@/lib/period-context';
import type { Period } from '@/lib/period';

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface PeriodSheetProps {
  visible: boolean;
  onClose: () => void;
}

/** Global reporting-period picker: quick presets, month grid, year, custom range. */
export function PeriodSheet({ visible, onClose }: PeriodSheetProps) {
  const theme = useTheme();
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
    { label: 'This month', period: { mode: 'month', key: nowKey } },
    { label: 'Last month', period: { mode: 'month', key: shiftMonthKey(nowKey, -1) } },
    { label: 'Last 7 days', period: { mode: 'range', from: daysAgoISO(6), to: toISODate(now) } },
    { label: 'Last 30 days', period: { mode: 'range', from: daysAgoISO(29), to: toISODate(now) } },
    { label: 'Last 90 days', period: { mode: 'range', from: daysAgoISO(89), to: toISODate(now) } },
    { label: `This year`, period: { mode: 'year', year: thisYear } },
    { label: `${thisYear - 1}`, period: { mode: 'year', year: thisYear - 1 } },
    { label: 'All time', period: { mode: 'all' } },
  ];

  const isActive = (p: Period): boolean => JSON.stringify(p) === JSON.stringify(period);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}
          onPress={() => {}}>
          <View style={[styles.grabber, { backgroundColor: theme.cardBorder }]} />
          <View style={styles.sheetHeader}>
            <ThemedText type="heading">Reporting period</ThemedText>
            <Pressable onPress={onClose} hitSlop={8}>
              <Icon name="close" size={20} color={theme.textSecondary} />
            </Pressable>
          </View>

          <View style={styles.chipRow}>
            {presets.map((p) => (
              <Pressable
                key={p.label}
                onPress={() => apply(p.period)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: isActive(p.period) ? `${theme.primary}22` : theme.backgroundSelected,
                    borderColor: isActive(p.period) ? theme.primary : 'transparent',
                  },
                ]}>
                <ThemedText type="small">{p.label}</ThemedText>
              </Pressable>
            ))}
          </View>

          <View style={styles.gridHeader}>
            <Pressable onPress={() => setGridYear(gridYear - 1)} hitSlop={8}>
              <Icon name="chevron-left" size={16} color={theme.textSecondary} />
            </Pressable>
            <ThemedText type="smallBold" tabular>
              {gridYear}
            </ThemedText>
            <Pressable
              disabled={gridYear >= thisYear}
              onPress={() => setGridYear(gridYear + 1)}
              hitSlop={8}
              style={{ opacity: gridYear >= thisYear ? 0.3 : 1 }}>
              <Icon name="chevron-right" size={16} color={theme.textSecondary} />
            </Pressable>
          </View>
          <View style={styles.monthGrid}>
            {MONTH_ABBR.map((label, i) => {
              const key = `${gridYear}-${String(i + 1).padStart(2, '0')}`;
              const future = key > nowKey;
              const active = period.mode === 'month' && period.key === key;
              return (
                <Pressable
                  key={key}
                  disabled={future}
                  onPress={() => apply({ mode: 'month', key })}
                  style={[
                    styles.monthCell,
                    {
                      backgroundColor: active ? `${theme.primary}22` : theme.backgroundSelected,
                      borderColor: active ? theme.primary : 'transparent',
                      opacity: future ? 0.3 : 1,
                    },
                  ]}>
                  <ThemedText type="small">{label}</ThemedText>
                </Pressable>
              );
            })}
          </View>

          <ThemedText type="micro" themeColor="textSecondary">Custom range</ThemedText>
          <View style={styles.rangeRow}>
            <TextInput
              value={fromText}
              onChangeText={setFromText}
              placeholder="From YYYY-MM-DD"
              placeholderTextColor={theme.textSecondary}
              style={[
                styles.input,
                {
                  backgroundColor: theme.backgroundSelected,
                  color: fromText && !dateValid(fromText) ? theme.expense : theme.text,
                },
              ]}
            />
            <TextInput
              value={toText}
              onChangeText={setToText}
              placeholder="To YYYY-MM-DD"
              placeholderTextColor={theme.textSecondary}
              style={[
                styles.input,
                {
                  backgroundColor: theme.backgroundSelected,
                  color: toText && !dateValid(toText) ? theme.expense : theme.text,
                },
              ]}
            />
            <Pressable
              disabled={!rangeValid}
              onPress={() => apply({ mode: 'range', from: fromText, to: toText })}
              style={[
                styles.rangeBtn,
                { backgroundColor: theme.primary, opacity: rangeValid ? 1 : 0.4 },
              ]}>
              <Icon name="check" size={16} color={theme.onPrimary} strokeWidth={2.6} />
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(7, 15, 12, 0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.four,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginTop: -Spacing.two,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    paddingHorizontal: Spacing.two + 4,
    paddingVertical: Spacing.two,
    borderRadius: Radius.full,
    borderWidth: 1.5,
  },
  gridHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.four,
  },
  monthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  monthCell: {
    width: '22.5%',
    alignItems: 'center',
    paddingVertical: Spacing.two + 2,
    borderRadius: Radius.sm,
    borderWidth: 1.5,
  },
  rangeRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'center',
  },
  input: {
    flex: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.two + 4,
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  rangeBtn: {
    width: 42,
    height: 42,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
