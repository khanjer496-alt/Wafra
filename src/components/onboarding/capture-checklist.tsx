/**
 * The four iPhone capture steps as a checklist, each row showing whether it
 * is done from recorded evidence (see ios-capture-checklist.ts). The
 * automation row carries its own "Open Shortcuts" button because that step
 * happens in the Shortcuts app. The Test step stays: it is how the app proves
 * the shortcut reaches it.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Fonts, Radius, Spacing, type BandPalette } from '@/constants/theme';
import { tapped } from '@/lib/haptics';
import type { IosChecklistRow, IosChecklistRowId } from '@/lib/ios-capture-checklist';

/**
 * Drawn as a sheet-coloured card on the first-payment band (design language
 * E): the band palette's sheet, text and tint, in either scheme.
 */
export function CaptureChecklist({ rows, titles, details, doneLabel, toDoLabel, openShortcutsLabel, onOpenShortcuts, palette }: {
  palette: BandPalette;
  rows: IosChecklistRow[];
  titles: Record<IosChecklistRowId, string>;
  details: Partial<Record<IosChecklistRowId, string>>;
  doneLabel: string;
  toDoLabel: string;
  openShortcutsLabel: string;
  onOpenShortcuts: () => void;
}) {
  return (
    <View style={[styles.list, { backgroundColor: palette.sheet }]} testID="onboarding-ios-checklist">
      {rows.map((row, index) => (
        <View
          key={row.id}
          testID={`onboarding-ios-checklist-${row.id}`}
          style={[styles.row, index > 0 && [styles.rowDivider, { borderTopColor: palette.rule }]]}>
          <View
            accessible
            accessibilityLabel={`${index + 1}. ${titles[row.id]}. ${row.done ? doneLabel : toDoLabel}`}
            style={styles.rowMain}>
            <View style={[styles.mark, { borderColor: row.done ? palette.fill : palette.rule, backgroundColor: row.done ? palette.fill : 'transparent' }]}>
              {row.done
                ? <Icon name="check" size={15} color={palette.onFill} strokeWidth={2.1} />
                : <ThemedText style={[styles.markNumber, { color: palette.textSecondary }]}>{index + 1}</ThemedText>}
            </View>
            <View style={styles.copy}>
              <ThemedText style={[styles.title, { color: row.done ? palette.textSecondary : palette.text }]}>{titles[row.id]}</ThemedText>
              {details[row.id] ? <ThemedText style={[styles.detail, { color: palette.textSecondary }]}>{details[row.id]}</ThemedText> : null}
            </View>
          </View>
          {row.id === 'automate' && !row.done ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={openShortcutsLabel}
              onPress={() => {
                tapped();
                onOpenShortcuts();
              }}
              style={({ pressed }) => [styles.inlineButton, { borderColor: palette.tint, opacity: pressed ? 0.7 : 1 }]}>
              <ThemedText style={[styles.inlineButtonText, { color: palette.tint }]}>{openShortcutsLabel}</ThemedText>
            </Pressable>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    borderRadius: 24,
    paddingHorizontal: Spacing.three,
  },
  row: { paddingVertical: Spacing.three, gap: Spacing.two },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth },
  rowMain: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  mark: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markNumber: { fontFamily: Fonts.sansSemi, fontSize: 13, fontVariant: ['tabular-nums'] },
  copy: { flex: 1, gap: 2 },
  title: { fontFamily: Fonts.sansMedium, fontSize: 15, lineHeight: 21 },
  detail: { fontSize: 13, lineHeight: 19 },
  inlineButton: {
    alignSelf: 'flex-start',
    marginStart: 28 + Spacing.three,
    minHeight: 44,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.control,
    borderWidth: 1.5,
    justifyContent: 'center',
  },
  inlineButtonText: { fontFamily: Fonts.sansSemi, fontSize: 14 },
});
