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
 * the two ways out where a thumb already is. It should be unreachable: every
 * link the app generates is an `AppRoute` (see `@/lib/routes`), and `tsc`
 * rejects a destination with no screen behind it. This is the net under that.
 */
import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { MaxContentWidth, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function NotFoundScreen() {
  const theme = useTheme();
  const router = useRouter();

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.body}>
          <View style={[styles.glyph, { borderColor: theme.cardBorderStrong }]}>
            <Icon name="search" size={22} color={theme.textTertiary} />
          </View>

          <ThemedText type="heading">This page moved on</ThemedText>
          <ThemedText type="default" themeColor="textSecondary" style={styles.copy}>
            Nothing lives at that link. Your entries are untouched — this is a signpost pointing at
            a room that isn&apos;t there.
          </ThemedText>

          <View style={styles.actions}>
            <Button inline label="Go home" onPress={() => router.replace('/')} />
            {router.canGoBack() && (
              <Button inline variant="outline" label="Back" onPress={() => router.back()} />
            )}
          </View>
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center' },
  safe: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  body: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingHorizontal: ScreenPadding,
    gap: Spacing.two,
  },
  glyph: {
    width: 46,
    height: 46,
    borderRadius: Radius.control,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.three,
  },
  copy: { maxWidth: 320 },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two + 2,
    marginTop: Spacing.four,
  },
});
