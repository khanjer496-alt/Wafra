import { Pressable, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useTheme } from '@/hooks/use-theme';
import { tapped } from '@/lib/haptics';

export type Segment<T extends string> = { value: T; label: string; accessibilityHint?: string };
export type SegmentedControlProps<T extends string> = {
  segments: Segment<T>[]; value: T; onChange: (value: T) => void; label: string;
};
/** One rounded control shared by tabs-within-a-tab and all form selectors. */
export function SegmentedControl<T extends string>({ segments, value, onChange, label }: SegmentedControlProps<T>) {
  const theme = useTheme();
  const large = useLargeTextLayout();
  return <View role="tablist" accessibilityLabel={label} style={[styles.track, large && styles.stack, { backgroundColor: theme.backgroundSelected }]}>
    {segments.map((segment) => {
      const active = segment.value === value;
      return <Pressable key={segment.value} accessibilityRole="tab" accessibilityLabel={segment.label}
        accessibilityHint={segment.accessibilityHint} accessibilityState={{ selected: active }}
        onPress={() => { if (!active) tapped(); onChange(segment.value); }}
        style={[styles.segment, { backgroundColor: active ? theme.inverseSurface : 'transparent' }]}>
        <ThemedText type={active ? 'smallBold' : 'small'} style={[styles.label, { color: active ? theme.inverseText : theme.textSecondary }]}>
          {segment.label}</ThemedText>
      </Pressable>;
    })}
  </View>;
}
const styles = StyleSheet.create({
  stack: { flexDirection: 'column', borderRadius: 18 },
  track: { flexDirection: 'row', padding: 4, borderRadius: 28, gap: 4 },
  segment: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, paddingVertical: 8, borderRadius: 24 },
  label: { textAlign: 'center', flexShrink: 1 },
});
