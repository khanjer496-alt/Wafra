import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/controls';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Spacing } from '@/constants/theme';
import { t, type StringKey } from '@/lib/i18n';

interface DetailsSheetProps {
  visible: boolean;
  language?: string;
  onClose(): void;
  section: 'future' | 'history';
  source?: 'message' | 'notification' | 'apple-pay';
  fromOnboarding?: boolean;
  actions?: { label: string; onPress(): void }[];
  privacyExpanded: boolean;
  onTogglePrivacy(): void;
}

export const DetailsSheet = ({
  visible, onClose, section, source = 'message', language = 'en', fromOnboarding, actions = [], privacyExpanded, onTogglePrivacy,
}: DetailsSheetProps) => {
  const walletHelp = t('iosApplePayWalletHelp', language === 'ar' ? 'ar' : 'en');
  const lines: StringKey[] = section === 'future'
    ? source === 'apple-pay' ? [] : source === 'notification' ? ['iosNotificationSetupSummary', 'iosNotificationHelpInput', 'iosNotificationHelpStatus']
    : ['iosMessageHelpLocal', 'iosMessageGuideSender', 'iosMessageGuideNoFilter',
      'iosMessagePermissionBody', 'iosMessagePermissionLocked',
      'iosMessageHelpProof', 'iosMessageSenderUnavailable']
    : ['iosMessageHelpReadable', 'iosMessageHelpCoverage', 'historyReadyCompact',
      'iosMessagePastTiming', 'iosMessageHistoryKeepOpen',
      fromOnboarding ? 'iosMessageHistoryUnavailableOnboarding' : 'iosMessageHistoryUnavailableHelp'];

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('iosMessageDetailsTitle')}>
      <View style={styles.content}>
        {actions.map((action) => (
          <Button key={action.label} label={action.label} variant="outline" wrapLabel
            onPress={() => { onClose(); action.onPress(); }} />
        ))}
        <View style={styles.section}>
          {section === 'future' && source === 'apple-pay' && <ThemedText type="small" themeColor="textSecondary">{walletHelp}</ThemedText>}
          {lines.map((key) => (
            <View key={key} style={styles.line}>
              <ThemedText type="small" themeColor="textSecondary" accessible={false}>·</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.lineText}>{t(key)}</ThemedText>
            </View>
          ))}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t('iosMessagePrivacyDetails')}
          accessibilityState={{ expanded: privacyExpanded }} onPress={onTogglePrivacy} style={styles.disclosure}>
          <ThemedText type="linkPrimary">{t('iosMessagePrivacyDetails')}</ThemedText>
        </Pressable>
        {privacyExpanded && (
          <View style={styles.section}>
            <ThemedText type="small" themeColor="textSecondary">
              {section === 'future' && source === 'apple-pay' ? (language === 'ar' ? 'تُحفظ بيانات الدفع على هذا الجهاز للمراجعة. لا تُرسل إلى خادم.' : 'Payment details stay on this device for Review. They are not sent to a server.') : t(section === 'future' ? source === 'notification' ? 'iosNotificationPrivacyBody' : 'iosLocalPrivacyBody' : 'historyImportPrivacy')}
            </ThemedText>
            {section === 'future' && source === 'message' && (
              <ThemedText type="small" themeColor="textSecondary">{t('iosLocalMigrationBody')}</ThemedText>
            )}
          </View>
        )}
      </View>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  content: { gap: Spacing.three },
  section: { gap: Spacing.two },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  lineText: { flex: 1 },
  disclosure: { minHeight: 44, justifyContent: 'center' },
});
