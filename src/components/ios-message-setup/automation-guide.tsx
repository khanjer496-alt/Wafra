import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t, tf, type StringKey } from '@/lib/i18n';
import { IOS_LOCAL_CAPTURE_SHORTCUT_NAME } from '@/lib/ios-local-capture-protocol';

const STEPS: readonly StringKey[] = [
  'iosMessageGuideEntry',
  'iosMessageGuideSender',
  'iosMessageGuideImmediate',
  'iosMessageGuideRunShortcut',
];

/** A compact visual checklist, not a simulated Apple UI or an install proof. */
export function AutomationGuide() {
  const theme = useTheme();
  const stepLabel = (step: StringKey) => tf(step, { shortcut: IOS_LOCAL_CAPTURE_SHORTCUT_NAME });
  return (
    <View style={styles.guide}>
      <ThemedText type="smallBold">{t('iosMessageGuideTitle')}</ThemedText>
      {STEPS.map((step, index) => (
        <View key={step} style={styles.row} accessible accessibilityLabel={`${index + 1}. ${stepLabel(step)}${step === 'iosMessageGuideSender' ? `. ${t('iosMessageGuideNoFilter')}` : ''}`}>
          <View style={[styles.icon, { backgroundColor: theme.primarySoft }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <ThemedText type="smallBold" themeColor="primary">{index + 1}</ThemedText>
          </View>
          <View style={styles.copy}>
            <ThemedText type="small">{stepLabel(step)}</ThemedText>
            {step === 'iosMessageGuideSender' && (
              <ThemedText type="small" themeColor="textSecondary">{t('iosMessageGuideNoFilter')}</ThemedText>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  guide: { gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  icon: { width: 32, height: 32, borderRadius: Radius.control, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, flexShrink: 1, gap: Spacing.one },
});
