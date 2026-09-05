import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { tapped } from '@/lib/haptics';

export type Segment<T extends string> = {
  value: T;
  label: string;
  accessibilityHint?: string;
};

export type SegmentedControlProps<T extends string> = {
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
};

export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  label,
}: SegmentedControlProps<T>) {
  const theme = useTheme();

  return (
    <View
      role="tablist"
      accessibilityLabel={label}
      style={[styles.track, { borderBottomColor: theme.cardBorder }]}>
      {segments.map((segment) => {
        const active = segment.value === value;
        return (
          <Pressable
            key={segment.value}
            accessibilityRole="tab"
            accessibilityLabel={segment.label}
            accessibilityHint={segment.accessibilityHint}
            accessibilityState={{ selected: active }}
            onPress={() => {
              if (!active) tapped();
              onChange(segment.value);
            }}
            style={[
              styles.segment,
              Platform.OS === 'android' && styles.androidSegment,
              active && {
                borderBottomColor: theme.primary,
              },
            ]}>
            <ThemedText
              type={active ? 'smallBold' : 'small'}
              style={{ color: active ? theme.primary : theme.textSecondary }}>
              {segment.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.one,
  },
  segment: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
  androidSegment: { minHeight: 48 },
});
