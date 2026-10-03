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
        onPress={() => { if (!active) tapped(); onChange(segment.value); }}
        style={[styles.segment, large && styles.segmentLarge]}>
        {/* The whole 44pt cell is the target; the selected pill is drawn inset within it. */}
        <View style={[styles.pill, large && styles.pillLarge, { backgroundColor: active ? palette.selected : 'transparent' }]}>
          <ThemedText type="smallBold" style={[styles.label, !large && styles.labelCompact, { color: active ? palette.onSelected : palette.onBand }]}>
            {segment.label}
          </ThemedText>
        </View>
      </Pressable>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  // Design language E: a 44pt track whose cells are the 44pt targets, with the
  // selected pill drawn 4pt inside them; Larger Text keeps the padded track.
  track: { flexDirection: 'row', borderRadius: 22, paddingHorizontal: 4 },
  stack: { flexDirection: 'column', borderRadius: 20, padding: 4, gap: 4 },
  segment: { flex: 1, minHeight: 44, paddingVertical: 4 },
  segmentLarge: { paddingVertical: 0 },
  pill: { flexGrow: 1, borderRadius: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 4 },
  pillLarge: { minHeight: 44, borderRadius: 22, paddingVertical: 8 },
  label: { textAlign: 'center', flexShrink: 1 },
  labelCompact: { fontSize: 14, lineHeight: 20 },
});
