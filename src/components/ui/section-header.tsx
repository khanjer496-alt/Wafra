import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { tapped } from '@/lib/haptics';

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
        type="micro"
        themeColor="textTertiary"
        accessibilityRole="header"
        style={styles.title}>
        {title}
      </ThemedText>
      {value !== undefined ? (
        <ThemedText type="micro" themeColor="textTertiary" tabular>
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
          style={[styles.action, Platform.OS === 'android' && styles.androidAction]}>
          <ThemedText type="micro" themeColor="primary">
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
    marginBottom: Spacing.two,
  },
  title: { flexShrink: 1 },
  action: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  androidAction: { minWidth: 48, minHeight: 48 },
});
