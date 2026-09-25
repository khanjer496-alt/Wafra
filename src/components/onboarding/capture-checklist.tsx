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
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { tapped } from '@/lib/haptics';
import type { IosChecklistRow, IosChecklistRowId } from '@/lib/ios-capture-checklist';

/** Onboarding is night mode regardless of the OS theme (see onboarding-gate). */
const night = Colors.dark;

export function CaptureChecklist({ rows, titles, details, doneLabel, toDoLabel, openShortcutsLabel, onOpenShortcuts }: {
  rows: IosChecklistRow[];
  titles: Record<IosChecklistRowId, string>;
  details: Partial<Record<IosChecklistRowId, string>>;
  doneLabel: string;
  toDoLabel: string;
  openShortcutsLabel: string;
  onOpenShortcuts: () => void;
}) {
  return (
    <View style={styles.list} testID="onboarding-ios-checklist">
      {rows.map((row, index) => (
        <View
          key={row.id}
          testID={`onboarding-ios-checklist-${row.id}`}
          style={[styles.row, index > 0 && styles.rowDivider]}>
          <View
            accessible
            accessibilityLabel={`${index + 1}. ${titles[row.id]}. ${row.done ? doneLabel : toDoLabel}`}
            style={styles.rowMain}>
            <View style={[styles.mark, row.done && styles.markDone]}>
              {row.done
                ? <Icon name="check" size={15} color={night.onPrimary} strokeWidth={2.1} />
                : <ThemedText style={styles.markNumber}>{index + 1}</ThemedText>}
            </View>
            <View style={styles.copy}>
              <ThemedText style={[styles.title, row.done && styles.titleDone]}>{titles[row.id]}</ThemedText>
              {details[row.id] ? <ThemedText style={styles.detail}>{details[row.id]}</ThemedText> : null}
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
              style={({ pressed }) => [styles.inlineButton, { opacity: pressed ? 0.7 : 1 }]}>
              <ThemedText style={styles.inlineButtonText}>{openShortcutsLabel}</ThemedText>
            </Pressable>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    borderRadius: Radius.sheet,
    borderWidth: 1,
    borderColor: night.cardBorder,
    backgroundColor: night.backgroundElement,
    paddingHorizontal: Spacing.three,
  },
  row: { paddingVertical: Spacing.three, gap: Spacing.two },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: night.cardBorder },
  rowMain: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  mark: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: night.controlBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markDone: { backgroundColor: night.primary, borderColor: night.primary },
  markNumber: { color: night.textSecondary, fontFamily: Fonts.monoMedium, fontSize: 13 },
  copy: { flex: 1, gap: 2 },
  title: { color: night.text, fontFamily: Fonts.sansMedium, fontSize: 15, lineHeight: 21 },
  titleDone: { color: night.textSecondary },
  detail: { color: night.textSecondary, fontSize: 13, lineHeight: 19 },
  inlineButton: {
    alignSelf: 'flex-start',
    marginStart: 28 + Spacing.three,
    minHeight: 44,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.control,
    borderWidth: 1,
    borderColor: night.primaryBorder,
    justifyContent: 'center',
  },
  inlineButtonText: { color: night.primary, fontFamily: Fonts.sansSemi, fontSize: 14 },
});
