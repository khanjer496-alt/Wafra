import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SetupHeader, SetupShell } from '@/components/onboarding/setup-shell';
import { SupplementImports } from '@/components/supplement-imports';
import { ScreenScaffold } from '@/components/ui/screen-scaffold';
import { MaxContentWidth, ScreenPadding, Spacing } from '@/constants/theme';
import { t } from '@/lib/i18n';

export default function StatementImportScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ fromOnboarding?: string }>();
  const fromOnboarding = params.fromOnboarding === '1';
  if (fromOnboarding) {
    // First-run step "Bring in your past spending": same night surface as the
    // rest of setup, and one way forward whether or not a file was added.
    return (
      <SetupShell onboarding>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            <SetupHeader
              onboarding
              title={t('onboardPastTitle')}
              back={{ label: t('onboardStatementBack'), onPress: router.back }}
            />
            <SupplementImports onboarding={{ onContinue: router.back }} />
          </ScrollView>
        </SafeAreaView>
      </SetupShell>
    );
  }
  return (
    <ScreenScaffold
      header={{
        title: t('statementImportTitle'),
        back: { label: t('back'), onPress: router.back },
      }}
      contentStyle={{ gap: Spacing.three }}
      scrollProps={{ showsVerticalScrollIndicator: false, keyboardShouldPersistTaps: 'handled' }}>
      <SupplementImports />
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center',
    paddingHorizontal: ScreenPadding, paddingBottom: Spacing.four, gap: Spacing.three,
  },
});
