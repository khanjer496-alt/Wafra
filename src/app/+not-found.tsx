/**
 * The screen for a link that leads nowhere.
 *
 * expo-router ships a stock "Unmatched Route" page with a stack trace and a
 * "Sitemap" button. That is a developer's tool, and a person who has just
 * tapped a sentence about their own money should never be shown it — in a
 * finance app an unexplained developer screen reads as "something is wrong
 * with my account".
 *
 * So this says the small true thing instead, in the app's own voice, and puts
 * the way out where a thumb already is. It should be unreachable: every link
 * the app generates is an `AppRoute` (see `@/lib/routes`), and `tsc` rejects a
 * destination with no screen behind it. This is the net under that.
 *
 * Design language E: a plain sand screen — "Page not found", one line, one
 * button back to Home. No stamp, no mono eyebrow, no illustration.
 */
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { EButton } from '@/components/ui/band/e-button';
import { BAND_GUTTER } from '@/components/ui/band-scaffold';
import { Fonts, MaxContentWidth, Spacing } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { settingsECopy } from '@/lib/settings-e-copy';

export default function NotFoundScreen() {
  const router = useRouter();
  const band = useBand('settings');
  const insets = useSafeAreaInsets();
  const largeText = useLargeTextLayout();
  // The language is read as a value: the compiler memoises this component on
  // what it can see going in, and the module-level language is not one of
  // those things.
  const words = settingsECopy(useLanguage());

  return (
    <View testID="not-found-screen" style={[styles.root, {
      backgroundColor: band.band,
      paddingTop: insets.top + Spacing.five,
      paddingBottom: insets.bottom + Spacing.four,
    }]}>
      <StatusBar style={band.statusBar} />
      <ScrollView style={styles.flex} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <ThemedText accessibilityRole="header"
          style={[styles.title, largeText && styles.titleLarge, { color: band.onBand }]}>
          {words.notFoundTitle}
        </ThemedText>
        <ThemedText type="default" style={[styles.copy, { color: band.onBand }]}>
          {words.notFoundBody}
        </ThemedText>
      </ScrollView>
      <View style={styles.footer}>
        <EButton palette={band} label={words.notFoundHome} onPress={() => router.replace('/')} testID="not-found-home" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: BAND_GUTTER },
  flex: { flex: 1 },
  body: { gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  title: { fontFamily: Fonts.sansSemi, fontSize: 44, lineHeight: 48, letterSpacing: -1.6 },
  titleLarge: { fontSize: 32, lineHeight: 40, letterSpacing: -0.6 },
  copy: { fontSize: 17, lineHeight: 26, maxWidth: 360 },
  footer: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
});
