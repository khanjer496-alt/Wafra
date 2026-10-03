import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import type { BandPalette } from '@/constants/theme';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { tapped } from '@/lib/haptics';

export interface BandSegment<T extends string> {
  value: T;
  label: string;
  accessibilityHint?: string;
  testID?: string;
}

/**
 * Segmented control set on a band (Spending's Categories · Compare ·
 * Calendar, Bills' Next 30 days · All). The track is the band's own tone;
 * the selected pill is the sheet surface with band-colour text (on the light
 * ochre and sand bands, an ink pill with cream text). Selection is immediate.
 * A tablist for assistive tech; at the accessibility text sizes the segments
 * stack instead of truncating.
 */
export function BandSegmented<T extends string>({ segments, value, onChange, label, palette, testID }: {
  segments: readonly BandSegment<T>[];
  value: T;
  onChange: (value: T) => void;
  /** What the control switches between, spoken with the tablist. */
  label: string;
  palette: BandPalette;
  testID?: string;
}) {
  const large = useLargeTextLayout();
  return <View testID={testID} role="tablist" accessibilityRole="tablist" accessibilityLabel={label}
    style={[styles.track, large && styles.stack, { backgroundColor: palette.tile }]}>
    {segments.map((segment) => {
      const active = segment.value === value;
      return <Pressable key={segment.value} testID={segment.testID} accessibilityRole="tab" accessibilityLabel={segment.label}
        accessibilityHint={segment.accessibilityHint} accessibilityState={{ selected: active }} aria-selected={active}
        onPress={() => { if (!active) tapped(); onChange(segment.value); }} hitSlop={large ? undefined : { top: 4, bottom: 4 }}
        style={[styles.segment, large && styles.segmentLarge, { backgroundColor: active ? palette.selected : 'transparent' }]}>
        <ThemedText type="smallBold" style={[styles.label, !large && styles.labelCompact, { color: active ? palette.onSelected : palette.onBand }]}>
          {segment.label}
        </ThemedText>
      </Pressable>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  // Design language E: a 42pt track whose 36pt segments keep a 44pt target
  // through their hit slop; Larger Text restores full-height segments.
  track: { flexDirection: 'row', padding: 3, borderRadius: 22, gap: 3 },
  stack: { flexDirection: 'column', borderRadius: 20 },
  segment: { flex: 1, minHeight: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 6 },
  segmentLarge: { minHeight: 44, borderRadius: 22, paddingVertical: 8 },
  label: { textAlign: 'center', flexShrink: 1 },
  labelCompact: { fontSize: 14, lineHeight: 20 },
});
