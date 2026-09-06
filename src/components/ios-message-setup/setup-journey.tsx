import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { futureSetupConfigured, iosSetupJourneyCopy } from '@/lib/ios-setup-journey';
import type { IosSetupReadiness } from '@/lib/ios-capture-setup';
import type { IosMessageSetupStatus } from '@/lib/ios-message-onboarding';

export interface IosSetupJourneyProps {
  language: string;
  historyStatus: IosMessageSetupStatus;
  futureReadiness: IosSetupReadiness;
  automationConfirmed: boolean;
  detectedBanks: readonly string[];
}

/** Explanation/evidence, never a bank picker or a source of completion flags. */
export function IosSetupJourney({ language, historyStatus, futureReadiness,
  automationConfirmed, detectedBanks }: IosSetupJourneyProps) {
  const copy = iosSetupJourneyCopy(language);
  const configured = futureSetupConfigured(futureReadiness, automationConfirmed);
  const futureDetail = futureReadiness === 'first-alert-captured' ? copy.received
    : configured ? copy.waiting
      : futureReadiness === 'shortcut-proven' ? copy.proofOnly : copy.needsSetup;
  const historyDetail = historyStatus === 'complete' ? copy.historyComplete
    : historyStatus === 'in-progress' ? copy.historyRunning : copy.historyPending;
  return (
    <View style={styles.root} testID="ios-setup-journey">
      <ThemedText type="small" themeColor="textSecondary">{copy.intro}</ThemedText>
      <View testID="ios-detected-banks" style={styles.group}>
        {detectedBanks.length > 0 ? <>
          <ThemedText type="smallBold">{copy.detected}</ThemedText>
          {detectedBanks.map((name) => <ThemedText key={name} type="small">{name}</ThemedText>)}
          <ThemedText type="meta" themeColor="textSecondary">{copy.detectedHelp}</ThemedText>
        </> : null}
      </View>
      <View style={styles.group} accessibilityLiveRegion="polite" testID="ios-setup-evidence">
        <ThemedText type="smallBold">{copy.checkTitle}</ThemedText>
        <ThemedText type="meta" themeColor="textSecondary">{historyDetail}</ThemedText>
        <ThemedText type="meta" themeColor="textSecondary">{futureDetail}</ThemedText>
        {futureReadiness === 'shortcut-proven' &&
          <ThemedText type="meta" themeColor="textSecondary">{copy.proofHelp}</ThemedText>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: Spacing.two, paddingBottom: Spacing.two },
  group: { gap: Spacing.one },
});
