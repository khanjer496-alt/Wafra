import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Spacing } from '@/constants/theme';
import { t } from '@/lib/i18n';

interface HistoryDetailsSheetProps {
  visible: boolean;
  onClose(): void;
}

export const HistoryDetailsSheet = ({
  visible,
  onClose,
}: HistoryDetailsSheetProps) => (
  <BottomSheet
    visible={visible}
    onClose={onClose}
    title={t('historyDetailsTitle')}>
    <View style={styles.content}>
      <ThemedText type="small" themeColor="textSecondary">
        {t('historyLocalProcessing')}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {t('historyFirstRunGuidance')}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {t('historyNoLiveProgressDetails')}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {t('historyImportPrivacy')}
      </ThemedText>
    </View>
  </BottomSheet>
);

const styles = StyleSheet.create({
  content: {
    gap: Spacing.two,
  },
});
