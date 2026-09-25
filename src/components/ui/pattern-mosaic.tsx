import React, { useEffect, useRef } from 'react';
import { Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSpring } from 'react-native-reanimated';

import { Icon } from '@/components/ui/icon';
import { Fonts, MotionSpring, PatternPalette, type PatternColor } from '@/constants/theme';
import { useBandScheme } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useMotionPreference } from '@/hooks/use-reduced-motion';
import { bandCopy } from '@/lib/band-copy';
import { getCategory } from '@/lib/categories';
import { hasArabicScript } from '@/lib/i18n';
import { PATTERN_COLUMNS, PATTERN_ROWS, patternSize, type PatternTile } from '@/lib/pattern';

/** The boards' tile and gap at full size. */
const BASE_TILE = 52;
const BASE_GAP = 6;
/** Reveal stagger between tiles on the first appearance. */
const STAGGER_MS = 70;

function Shape({ tile, size, fill, mark }: { tile: PatternTile; size: number; fill: Record<PatternColor, string>; mark: Record<PatternColor, string> }) {
  const color = fill[tile.color];
  const rotate = tile.rotation ? { transform: [{ rotate: `${tile.rotation}deg` }] } : null;
  switch (tile.kind) {
    case 'square':
      return <View style={{ width: size, height: size, borderRadius: size * 10 / 52, backgroundColor: color }} />;
    case 'circle':
      return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
    case 'quarter':
      return <View style={[{ width: size, height: size, borderTopLeftRadius: size, backgroundColor: color }, rotate]} />;
    case 'half':
      return <View style={{ width: size, height: size, justifyContent: 'flex-end' }}>
        <View style={{ width: size, height: size / 2, borderTopLeftRadius: size / 2, borderTopRightRadius: size / 2, backgroundColor: color }} />
      </View>;
    case 'ring':
      return <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: size / 6, borderColor: color }} />;
    case 'dot':
      return <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: size / 3, height: size / 3, borderRadius: size / 6, backgroundColor: color }} />
      </View>;
    case 'bars':
      return <View style={[styles.bars, { width: size, height: size, padding: size * 8 / 52, gap: size / 14 }]}>
        {[40, 75, 55, 95].map((height) => <View key={height}
          style={{ width: size / 7, height: `${height}%`, borderRadius: Math.max(1, size / 17), backgroundColor: color }} />)}
      </View>;
    case 'glyph':
      return <View style={[styles.center, { width: size, height: size, borderRadius: size * 10 / 52, backgroundColor: color }]}>
        <Icon name={getCategory(tile.category ?? 'other').icon} size={Math.round(size * 0.46)} color={mark[tile.mark ?? 'ink']} strokeWidth={2} />
      </View>;
    case 'letter': {
      const letter = tile.letter ?? '';
      return <View style={[styles.center, { width: size, height: size, borderRadius: size * 10 / 52, backgroundColor: color }]}>
        <Text allowFontScaling={false} style={{
          fontFamily: hasArabicScript(letter) ? Fonts.arabicBold : Fonts.sansSemi,
          fontSize: Math.round(size * 0.56), lineHeight: Math.round(size * (hasArabicScript(letter) ? 0.9 : 0.66)),
          letterSpacing: hasArabicScript(letter) ? 0 : -size * 0.02, color: mark[tile.mark ?? 'cream'], includeFontPadding: false,
        }}>{letter}</Text>
      </View>;
    }
    default:
      return null;
  }
}

/** One tile's pop-in: scale from nothing with a quarter turn, once. */
function PopIn({ order, animate, children }: { order: number; animate: boolean; children: React.ReactNode }) {
  const { ready, reducedMotion } = useMotionPreference();
  const moving = animate && !reducedMotion && Platform.OS !== 'android';
  const progress = useSharedValue(moving ? 0 : 1);
  const shown = useRef(!moving);
  useEffect(() => {
    if (!moving) { shown.current = true; progress.value = 1; return; }
    if (!ready || shown.current) return;
    shown.current = true;
    progress.value = withDelay(order * STAGGER_MS, withSpring(1, MotionSpring));
  }, [moving, order, progress, ready]);
  const style = useAnimatedStyle(() => ({
    opacity: Math.min(1, progress.value * 1.5),
    transform: [{ scale: progress.value }, { rotate: `${(1 - progress.value) * -90}deg` }],
  }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

/**
 * The personal pattern, drawn from `buildPattern()` tiles on a 6 × 2 grid.
 * Decoration with a meaning: one image to assistive tech ("Your pattern"),
 * never money. `tile` scales it (Home's header draws it at 26). Static by
 * default; `animate` pops the tiles in 70ms apart on first appearance, which
 * Reduce Motion, a screen reader and Android all show as a still picture.
 * The grid mirrors under RTL with the rest of the layout.
 */
export function PatternMosaic({ tiles, tile = BASE_TILE, gap, animate = false, scheme, accessibilityLabel, style, testID }: {
  tiles: readonly PatternTile[];
  /** Tile edge in points. */
  tile?: number;
  gap?: number;
  animate?: boolean;
  scheme?: 'light' | 'dark';
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const resolved = useBandScheme(scheme);
  const words = bandCopy(useLanguage());
  const palette = PatternPalette[resolved];
  const spacing = gap ?? Math.max(2, Math.round((tile * BASE_GAP) / BASE_TILE));
  const size = patternSize(tile, spacing);
  const byCell = new Map(tiles.map((item) => [`${item.col}:${item.row}`, item]));
  return <View testID={testID} accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel ?? words.pattern}
    style={[{ width: size.width, height: size.height, gap: spacing }, style]}>
    {Array.from({ length: PATTERN_ROWS }, (_row, row) => <View key={row} style={[styles.row, { gap: spacing }]}>
      {Array.from({ length: PATTERN_COLUMNS }, (_col, col) => {
        const item = byCell.get(`${col}:${row}`);
        return <View key={col} style={{ width: tile, height: tile }}>
          {item ? <PopIn order={item.order} animate={animate}>
            <Shape tile={item} size={tile} fill={palette.fill} mark={palette.mark} />
          </PopIn> : null}
        </View>;
      })}
    </View>)}
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  center: { alignItems: 'center', justifyContent: 'center' },
  bars: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center' },
});
