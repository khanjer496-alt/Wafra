import { useRouter } from 'expo-router';
import React from 'react';

import { SupplementImports } from '@/components/supplement-imports';
import { ScreenScaffold } from '@/components/ui/screen-scaffold';
import { Spacing } from '@/constants/theme';
import { t } from '@/lib/i18n';

export default function StatementImportScreen() {
  const router = useRouter();
  return (
    <ScreenScaffold
      header={{
        title: t('statementImportTitle'),
        back: { label: t('back'), onPress: router.back },
      }}
      contentStyle={{ gap: Spacing.three }}
      scrollProps={{ showsVerticalScrollIndicator: false }}>
      <SupplementImports />
    </ScreenScaffold>
  );
}
