import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { SupplementImports } from '@/components/supplement-imports';
import { ThemedText } from '@/components/themed-text';
import { BandScaffold } from '@/components/ui/band-scaffold';
import { Icon } from '@/components/ui/icon';
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
          // From first-run setup the way back says where it goes ("Back to
          // setup"), as it did before; the shared nav's back only says "Back".
          nav={fromOnboarding ? {
            leading: <Pressable testID="statement-import-back-to-setup" accessibilityRole="button"
              accessibilityLabel={t('onboardStatementBack')} onPress={router.back} hitSlop={4}
              style={({ pressed }) => [styles.setupBack, { opacity: pressed ? 0.6 : 1 }]}>
              <Icon name="chevron-left" size={22} color={band.onBand} strokeWidth={2.2} />
              <ThemedText type="smallBold" style={{ color: band.onBand }}>{t('onboardStatementBack')}</ThemedText>
            </Pressable>,
          } : { back: router.back }}
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
  setupBack: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4, marginStart: -8, paddingEnd: 8 },

});
