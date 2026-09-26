import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GlyphTile } from '@/components/ui/band/glyph-tile';
import { Icon } from '@/components/ui/icon';
import type { BandPalette } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { localISODate } from '@/lib/home-today';
import { isLiveCapture } from '@/lib/transaction-source';
import type { Transaction } from '@/lib/types';
import {
  loadWidgetsHintDone, markWidgetsHintDone, oldestLiveCaptureISO, subscribeWidgetsHintDone,
  widgetsHintEligible, type WidgetsHintDone,
} from '@/lib/widgets-hint';
import { widgetsCopy } from '@/lib/widgets-copy';

/**
 * Home's one hint about widgets. Home says what its own state is (capture
 * set up, stopped, first days); this reads the stored "done" mark and the
 * oldest captured entry and applies `widgetsHintEligible`. Hidden until the
 * mark is read, so it never flashes and then disappears. Opening it goes to
 * the Widgets screen, which marks it done; the close button marks it
 * dismissed. Either way it never returns.
 */
export function WidgetsHint({ hydrated, onboarded, captureSetUp, captureStopped, firstDays, transactions, now, palette }: {
  hydrated: boolean;
  onboarded: boolean;
  captureSetUp: boolean;
  captureStopped: boolean;
  firstDays: boolean;
  transactions: readonly Transaction[];
  now: Date;
  palette: BandPalette;
}) {
  const router = useRouter();
  const language = useLanguage();
  const words = widgetsCopy(language);
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  const [done, setDone] = useState<WidgetsHintDone | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    void loadWidgetsHintDone().then((value) => { if (alive) setDone((current) => current ?? value); });
    const unsubscribe = subscribeWidgetsHintDone((value) => { if (alive) setDone(value); });
    return () => { alive = false; unsubscribe(); };
  }, []);

  // The ledger walk runs only when every cheaper condition already holds.
  const candidate = done === null && hydrated && onboarded && captureSetUp && !captureStopped && !firstDays;
  const oldest = useMemo(() => candidate ? oldestLiveCaptureISO(transactions, isLiveCapture) : null,
    [candidate, transactions]);
  const visible = widgetsHintEligible({
    hydrated, onboarded, captureSetUp, captureStopped, firstDays,
    oldestCaptureISO: oldest,
    todayISO: localISODate(now),
    platformHasWidgets: Platform.OS === 'ios' || Platform.OS === 'android',
    done,
  });
  if (!visible) return null;

  const title = words.hintTitle(platform);
  return <View testID="home-widgets-hint" style={[styles.card, { backgroundColor: palette.card, borderColor: palette.rule }]}>
    <Pressable testID="home-widgets-hint-open" accessibilityRole="button" accessibilityLabel={`${title}. ${words.hintBody}`}
      onPress={() => router.push('/widgets')}
      style={({ pressed }) => [styles.open, { opacity: pressed ? 0.7 : 1 }]}>
      <GlyphTile icon="home" palette={palette} size={40} />
      <View style={styles.copy}>
        <ThemedText type="smallBold" style={{ color: palette.text }}>{title}</ThemedText>
        <ThemedText type="meta" style={{ color: palette.textSecondary }}>{words.hintBody}</ThemedText>
      </View>
    </Pressable>
    <Pressable testID="home-widgets-hint-dismiss" accessibilityRole="button" accessibilityLabel={words.hintDismiss}
      hitSlop={4} onPress={() => { setDone('dismissed'); void markWidgetsHintDone('dismissed'); }}
      style={({ pressed }) => [styles.close, { opacity: pressed ? 0.6 : 1 }]}>
      <Icon name="close" size={18} color={palette.textSecondary} />
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, paddingStart: 14, paddingEnd: 4 },
  open: { flex: 1, minWidth: 0, minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
