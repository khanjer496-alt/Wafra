import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { tapped } from '@/lib/haptics';
import { alignEnd } from '@/lib/i18n';

type SectionHeaderTrailing =
  | { value: string; action?: never; trailing?: never }
  | { value?: never; action: { label: string; onPress: () => void }; trailing?: never }
  | { value?: never; action?: never; trailing: React.ReactNode }
  | { value?: never; action?: never; trailing?: never };

export type SectionHeaderProps = SectionHeaderTrailing & { title: string };

export function SectionHeader({ title, value, action, trailing }: SectionHeaderProps) {
  return (
    <View style={styles.row}>
      <ThemedText
        type="smallBold"
        accessibilityRole="header"
        style={styles.title}>
        {title}
      </ThemedText>
      {value !== undefined ? (
        <ThemedText type="meta" themeColor="textSecondary" tabular style={[styles.value, { textAlign: alignEnd() }]}>
          {value}
        </ThemedText>
      ) : null}
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={() => {
            tapped();
            action.onPress();
          }}
          style={({ pressed }) => [styles.action, Platform.OS === 'android' && styles.androidAction,
            { opacity: pressed ? 0.65 : 1 }]}>
          <ThemedText type="linkPrimary" themeColor="primary" style={styles.actionLabel}>
            {action.label}
          </ThemedText>
        </Pressable>
      ) : null}
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    flexWrap: 'wrap',
    marginBottom: Spacing.two,
  },
  title: { flexGrow: 1, flexShrink: 1 },
  // textAlign is resolved per language at render: figures end the row.
  value: { flexShrink: 1 },
  action: { minWidth: 44, minHeight: 44, maxWidth: '100%', alignItems: 'center', justifyContent: 'center' },
  actionLabel: { flexShrink: 1 },
  androidAction: { minWidth: 48, minHeight: 48 },
});
