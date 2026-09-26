import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { SupplementImports } from '@/components/supplement-imports';
import { ThemedText } from '@/components/themed-text';
import { BandScaffold } from '@/components/ui/band-scaffold';
import { Fonts } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { t } from '@/lib/i18n';

/**
 * Statement import on the sand band (settings and data): the plain title,
 * one line and the choose-file control on the band; files, results, the
 * password step, what to download and the privacy lines on the sheet. The
 * first-run step "Bring in your past spending" is the same screen with its
 * own title and one way forward whether or not a file was added.
 */
export default function StatementImportScreen() {
  const router = useRouter();
  const band = useBand('settings');
  const params = useLocalSearchParams<{ fromOnboarding?: string }>();
  const fromOnboarding = params.fromOnboarding === '1';
  const title = fromOnboarding ? t('onboardPastTitle') : t('statementImportTitle');
  return (
    <SupplementImports
      onboarding={fromOnboarding ? { onContinue: router.back } : undefined}
      frame={({ band: bandPart, sheet }) => (
        <BandScaffold
          band="settings"
          testID="statement-import"
          nav={{ back: router.back }}
          bandContent={<View style={styles.band}>
            <ThemedText accessibilityRole="header" style={[styles.title, { color: band.onBand }]}>{title}</ThemedText>
            {bandPart}
          </View>}
          scrollProps={{ showsVerticalScrollIndicator: false, keyboardShouldPersistTaps: 'handled' }}
          keyboardAware>
          {sheet}
        </BandScaffold>
      )}
    />
  );
}

const styles = StyleSheet.create({
  band: { gap: 12, paddingTop: 4, paddingBottom: 8 },
  title: { fontFamily: Fonts.sansSemi, fontSize: 36, lineHeight: 42, letterSpacing: -1.2 },
});
