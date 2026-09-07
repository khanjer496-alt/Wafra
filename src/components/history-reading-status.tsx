import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/lib/i18n';
import type { HistoryImportProgress } from '@/lib/history-import';
import { ledgerLightCopy } from '@/lib/ledger-light-copy';

/** Read-only presentation of durable counters. There is no known inbox total,
 * so do not fabricate a percentage, ETA, processing phase or background promise. */
export function HistoryReadingStatus({ progress, onResume }: {
  progress: HistoryImportProgress; onResume: () => void;
}) {
  const theme = useTheme();
  const w = ledgerLightCopy[useLanguage() === 'ar' ? 'ar' : 'en'];
  const running = progress.status === 'running';
  const failed = progress.status === 'failed';
  const title = running ? w.reading : failed ? w.failed : progress.status === 'complete' ? w.complete : w.paused;
  return <View testID="history-reading-status" style={[styles.root, { borderColor: theme.cardBorder }]}>
    <View style={styles.heading}>
      {running ? <ActivityIndicator size="small" color={theme.primary} accessible={false} />
        : <Icon name={failed ? 'alert' : progress.status === 'complete' ? 'check' : 'mail'} size={20} color={failed ? theme.warning : theme.primary} />}
      <ThemedText type="smallBold" style={styles.grow} accessibilityLiveRegion="polite">{title}</ThemedText>
      {!running && progress.status !== 'complete' && <Pressable accessibilityRole="button"
        onPress={onResume} style={styles.action} accessibilityLabel={progress.error === 'inbox-access' ? t('openPhoneSettings') : w.resume}>
        <ThemedText type="smallBold" themeColor="primary">{progress.error === 'inbox-access' ? t('openPhoneSettings') : w.resume}</ThemedText>
      </Pressable>}
    </View>
    <View style={styles.counters}>
      <View style={styles.counter}><ThemedText type="heading" tabular>{progress.scanned.toLocaleString()}</ThemedText>
        <ThemedText type="meta" themeColor="textSecondary">{w.checked}</ThemedText></View>
      <View style={styles.counter}><ThemedText type="heading" tabular>{progress.found.toLocaleString()}</ThemedText>
        <ThemedText type="meta" themeColor="textSecondary">{w.found}</ThemedText></View>
    </View>
    {progress.status !== 'complete' && <ThemedText type="meta" themeColor="textSecondary">
      {failed ? t(progress.error === 'inbox-access' ? 'historyImportAccessBody' : 'historyImportSavedBody') : running ? w.readingNote : w.pausedNote}
    </ThemedText>}
  </View>;
}
const styles = StyleSheet.create({
  root: { borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: 16, gap: 12 },
  heading: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  grow: { flex: 1, minWidth: 120 }, action: { minWidth: 48, minHeight: 48, justifyContent: 'center' },
  counters: { flexDirection: 'row', flexWrap: 'wrap', gap: 24 }, counter: { flexGrow: 1, gap: 4 },
});
