import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { useTheme } from '@/hooks/use-theme';
import { t, tf } from '@/lib/i18n';
import type { MoneyPictureProgressModel } from '@/lib/money-picture-progress';

export function MoneyPictureProgress({ model, onResume }: {
  model: MoneyPictureProgressModel;
  onResume: () => void;
}) {
  const theme = useTheme();
  const busy = model.state === 'building';
  const needsAction = model.state === 'saved' || model.state === 'attention';
  const subtitle = model.state === 'attention' ? t('moneyPictureAttention')
    : model.state === 'saved' ? t('moneyPictureSaved')
      : model.state === 'starting' ? t('moneyPictureStarting')
        : t('moneyPictureBuilding');

  const metrics = [
    model.historyScanned === null ? null : {
      key: 'checked', value: model.historyScanned, label: t('moneyPictureMessagesChecked'),
    },
    { key: 'entries', value: model.transactionCount, label: t('moneyPictureEntries') },
    { key: 'accounts', value: model.activeAccountCount, label: t('moneyPictureAccounts') },
    { key: 'obligations', value: model.obligationCount, label: t('moneyPicturePayments') },
  ].filter((metric): metric is { key: string; value: number; label: string } => metric !== null);

  return <View testID="money-picture-progress" style={[styles.root, { borderColor: theme.cardBorder }]}>
    <View style={styles.heading}>
      <View style={[styles.icon, { backgroundColor: theme.primarySoft }]}>
        {busy ? <ActivityIndicator size="small" color={theme.primary} accessible={false} />
          : <Icon name={model.state === 'attention' ? 'alert' : 'spark'} size={19}
              color={model.state === 'attention' ? theme.warning : theme.primary} />}
      </View>
      <View style={styles.grow}>
        <ThemedText type="smallBold">{t('moneyPictureTitle')}</ThemedText>
        <ThemedText type="meta" themeColor="textSecondary" accessibilityLiveRegion="polite">{subtitle}</ThemedText>
      </View>
      {needsAction && <Pressable accessibilityRole="button" onPress={onResume} style={styles.action}>
        <ThemedText type="smallBold" themeColor="primary">{t('moneyPictureContinue')}</ThemedText>
      </Pressable>}
    </View>

    <View style={styles.metrics}>
      {metrics.map((metric) => <View key={metric.key} style={styles.metric}>
        <ThemedText type="heading" tabular>{metric.value.toLocaleString()}</ThemedText>
        <ThemedText type="meta" themeColor="textSecondary">{metric.label}</ThemedText>
      </View>)}
    </View>

    {model.historyFound !== null && model.historyFound > 0 && <View style={styles.foundRow}>
      <Icon name="check" size={15} color={theme.primary} />
      <ThemedText type="meta" themeColor="textSecondary">
        {tf('moneyPictureHistoryFound', { count: model.historyFound })}
      </ThemedText>
    </View>}
    <ThemedText type="micro" themeColor="textTertiary">{t('moneyPictureTruthNote')}</ThemedText>
  </View>;
}

const styles = StyleSheet.create({
  root: { borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: 16, gap: 14 },
  heading: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  action: { minHeight: 48, justifyContent: 'center', paddingStart: 8 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 22, rowGap: 14 },
  metric: { minWidth: 92, flexGrow: 1, gap: 3 },
  foundRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
});
