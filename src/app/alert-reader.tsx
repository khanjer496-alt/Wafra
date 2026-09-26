import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Button, Toggle } from '@/components/ui/controls';
import { Row } from '@/components/ui/layout';
import { ScreenScaffold } from '@/components/ui/screen-scaffold';
import { SectionHeader } from '@/components/ui/section-header';
import { useToast } from '@/components/ui/toast';
import { Spacing } from '@/constants/theme';
import {
  AI_ALERT_MODEL_MANIFEST,
  aiAlertModelStatus,
  deleteAiAlertModel,
  downloadAiAlertModel,
  type AiAlertModelStatus,
} from '@/lib/ai-alert-model';
import { tapped } from '@/lib/haptics';
import { t, tf, type StringKey } from '@/lib/i18n';
import { onDeviceAI, type OnDeviceAIAvailability } from '@/lib/on-device-ai';
import { useStore } from '@/lib/store';

const downloadSize = (): string => {
  const bytes = AI_ALERT_MODEL_MANIFEST.artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0);
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
};

const phoneModelKey = (availability: OnDeviceAIAvailability | null): StringKey => {
  if (!availability) return 'aiReaderPhoneUnavailable';
  if (availability.status === 'available') {
    return availability.provider === 'gemini-nano' ? 'aiReaderGeminiAvailable' : 'aiReaderAppleAvailable';
  }
  if (availability.status === 'not-enabled') return 'aiReaderPhoneNotEnabled';
  if (availability.status === 'model-not-ready') return 'aiReaderPhoneNotReady';
  return 'aiReaderPhoneUnavailable';
};

/**
 * Settings → On-device alert reader. The switch covers every on-device
 * suggestion for alerts nothing else could read; the downloadable reader
 * (the tagger) is off until the person downloads it — Wi-Fi only by
 * default, pinned size and SHA-256 verified (ai-alert-model-manifest.ts),
 * deletable. Nothing here uploads anything.
 */
export default function AlertReaderScreen() {
  const router = useRouter();
  const toast = useToast();
  const { state, setAiAlertPrefill } = useStore();
  const enabled = state.aiAlertPrefill !== false;
  const [phoneModel, setPhoneModel] = useState<OnDeviceAIAvailability | null>(null);
  const [model, setModel] = useState<AiAlertModelStatus>(() => aiAlertModelStatus());
  const [wifiOnly, setWifiOnly] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const nativeApp = Platform.OS === 'ios' || Platform.OS === 'android';

  useEffect(() => {
    let live = true;
    void onDeviceAI.getAvailability({ refresh: true }).then((value) => { if (live) setPhoneModel(value); });
    return () => { live = false; };
  }, []);

  const download = useCallback(async () => {
    setDownloading(true);
    try {
      const networkType = await onDeviceAI.networkType();
      const next = await downloadAiAlertModel({ networkType, allowCellular: !wifiOnly });
      setModel(next);
      if (next.error === 'wifi-required') toast.show(t('aiReaderNeedsWifi'), { tone: 'info' });
      else if (next.state === 'failed') toast.show(t('aiReaderDownloadFailed'), { tone: 'error' });
    } finally {
      setDownloading(false);
    }
  }, [toast, wifiOnly]);

  const downloaded = model.state === 'downloaded' || model.state === 'ready';
  const busy = downloading || model.state === 'downloading';

  return (
    <>
      <ScreenScaffold
        testID="alert-reader-screen"
        header={{ title: t('aiReaderTitle'), back: { label: t('back'), onPress: router.back } }}
        contentStyle={styles.content}>
        <ThemedText type="default" themeColor="textSecondary">{t('aiReaderIntro')}</ThemedText>

        <View>
          <Row>
            <Pressable accessible={false} style={styles.copy} onPress={() => {
              tapped();
              setAiAlertPrefill(!enabled).catch(() => toast.show(t('learnedFormatsSaveFailed'), { tone: 'error' }));
            }}>
              <ThemedText type="small">{t('aiReaderToggleTitle')}</ThemedText>
              <ThemedText type="meta" themeColor="textTertiary">{t('aiReaderToggleBody')}</ThemedText>
            </Pressable>
            <Toggle value={enabled} label={t('aiReaderToggleTitle')} onChange={(next) => {
              setAiAlertPrefill(next).catch(() => toast.show(t('learnedFormatsSaveFailed'), { tone: 'error' }));
            }} />
          </Row>
          <Row last>
            <View style={styles.copy} accessible
              accessibilityLabel={`${t('aiReaderPhoneModel')}. ${t(phoneModelKey(phoneModel))}`}>
              <ThemedText type="small">{t('aiReaderPhoneModel')}</ThemedText>
              <ThemedText testID="alert-reader-phone-model" type="meta" themeColor="textTertiary">
                {t(phoneModelKey(phoneModel))}
              </ThemedText>
            </View>
          </Row>
        </View>

        <View style={styles.section}>
          <SectionHeader title={t('aiReaderDownloadTitle')} />
          <ThemedText type="small" themeColor="textSecondary">
            {tf('aiReaderDownloadBody', { size: downloadSize() })}
          </ThemedText>
          {!nativeApp ? (
            <ThemedText testID="alert-reader-native-only" type="meta" themeColor="textTertiary">{t('aiReaderNativeOnly')}</ThemedText>
          ) : downloaded ? (
            <>
              <ThemedText testID="alert-reader-downloaded" type="smallBold">{t('aiReaderDownloaded')}</ThemedText>
              <Button variant="outline" label={t('aiReaderDelete')} onPress={() => setConfirmDelete(true)} />
            </>
          ) : (
            <>
              <Row last>
                <Pressable accessible={false} style={styles.copy} onPress={() => { tapped(); setWifiOnly(!wifiOnly); }}>
                  <ThemedText type="small">{t('aiReaderWifiOnly')}</ThemedText>
                  <ThemedText type="meta" themeColor="textTertiary">{t('aiReaderWifiOnlyBody')}</ThemedText>
                </Pressable>
                <Toggle value={wifiOnly} label={t('aiReaderWifiOnly')} onChange={setWifiOnly} />
              </Row>
              <Button label={busy ? t('aiReaderDownloading') : tf('aiReaderDownload', { size: downloadSize() })}
                disabled={busy} onPress={() => void download()} />
            </>
          )}
        </View>
        <ThemedText type="meta" themeColor="textTertiary">{t('aiReaderNotGulf')}</ThemedText>
      </ScreenScaffold>

      <ConfirmSheet
        visible={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        question={t('aiReaderDeleteQ')}
        confirmLabel={t('aiReaderDelete')}
        destructive
        onConfirm={() => {
          void deleteAiAlertModel().finally(() => setModel(aiAlertModelStatus()));
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.four },
  section: { gap: Spacing.two },
  copy: { flex: 1, minWidth: 0, gap: 2 },
});
