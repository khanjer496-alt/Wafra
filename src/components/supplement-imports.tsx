import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { Block, SectionHeader } from '@/components/ui/layout';
import { Radius, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { buildImportPlan } from '@/lib/auto-import';
import {
  createEmailForwardingAddress,
  getImportCapabilities,
  revokeEmailForwardingAddress,
  uploadPdfStatement,
} from '@/lib/cloud-import';
import {
  CloudImportError,
  type ImportCapabilities,
} from '@/lib/cloud-import-contract';
import {
  ackRelay,
  clearRelayEmailCredential,
  DEFAULT_RELAY_URL,
  getRelayConfig,
  pairDevice,
  saveRelayEmailCredential,
  syncRelay,
  type RelayConfig,
} from '@/lib/relay';
import { useStore } from '@/lib/store';
import { SUPPLEMENT_COPY } from '@/lib/supplement-copy';


type Busy = 'connect' | 'capabilities' | 'pdf' | 'email-create' | 'email-check' | 'email-revoke' | null;

function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));
}

export function SupplementImports() {
  const language = useLanguage();
  const copy = SUPPLEMENT_COPY[language];
  const theme = useTheme();
  const { state, importBatch, ensureDurable } = useStore();
  const stateRef = useRef(state);
  stateRef.current = state;
  const clipboardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [cfg, setCfg] = useState<RelayConfig | null>(null);
  const [capabilities, setCapabilities] = useState<ImportCapabilities | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const errorText = useCallback((value: unknown): string => {
    if (!(value instanceof CloudImportError)) return copy.errUnexpected;
    if (value.code === 'network') return copy.errNetwork;
    if (value.code === 'unauthorized') return copy.errAuth;
    if (value.code === 'invalid_pdf' || value.code === 'pdf_required') return copy.errInvalid;
    if (value.code === 'too_large' || value.code === 'too_many_pages' || value.code === 'too_many_rows') return copy.errLarge;
    if (value.code === 'unreadable_pdf') return copy.errUnreadable;
    if (value.code === 'unsupported_statement_format') return copy.errFormat;
    if (value.code === 'rate_limited' || value.code === 'queue_full') return copy.errRate;
    if (value.code === 'email_not_configured') return copy.errEmailOff;
    if (value.code === 'service') return copy.serviceError;
    return copy.errUnexpected;
  }, [copy]);

  const loadCapabilities = useCallback(async (active: RelayConfig) => {
    setBusy('capabilities');
    setError(null);
    try {
      setCapabilities(await getImportCapabilities(active));
    } catch (e) {
      setCapabilities(null);
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }, [errorText]);

  useEffect(() => {
    let live = true;
    void getRelayConfig().then((existing) => {
      if (!live) return;
      setCfg(existing);
      if (existing) void loadCapabilities(existing);
    });
    return () => {
      live = false;
      if (clipboardTimer.current) clearTimeout(clipboardTimer.current);
    };
  }, [loadCapabilities]);

  const connect = async () => {
    if (!DEFAULT_RELAY_URL) {
      setError(copy.unavailable);
      return;
    }
    setBusy('connect');
    setError(null);
    setStatus(null);
    try {
      const connected = await pairDevice(DEFAULT_RELAY_URL);
      setCfg(connected);
      await loadCapabilities(connected);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const syncQueued = useCallback(async (active: RelayConfig): Promise<number> => {
    if (!stateRef.current.hydrated) throw new Error(copy.notHydrated);
    const queued = await syncRelay(active);
    const newestTs = queued.parsed.reduce(
      (max, row) => Math.max(max, row.smsTs ?? 0),
      stateRef.current.lastScanTs,
    );
    const plan = buildImportPlan(queued.parsed, stateRef.current, newestTs);
    if (queued.parsed.length > 0) {
      await importBatch(plan.batch).durable;
    } else {
      await ensureDurable();
    }
    if (queued.ids.length > 0) await ackRelay(active, queued.ids);
    return plan.txCount;
  }, [copy.notHydrated, ensureDurable, importBatch]);

  const pickAndUpload = async () => {
    if (!cfg || !capabilities) return;
    setError(null);
    setStatus(null);
    let pickedFile: File | null = null;
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets[0]) return;
      const asset = picked.assets[0];
      pickedFile = new File(asset.uri);
      setBusy('pdf');
      const accepted = await uploadPdfStatement(cfg, asset, capabilities);
      try {
        const imported = await syncQueued(cfg);
        setStatus(interpolate(imported > 0 ? copy.pdfSuccess : copy.pdfNoNew, {
          accepted: accepted.acceptedRows,
          pages: accepted.pages,
          imported,
        }));
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {
        setStatus(interpolate(copy.acceptedPending, { accepted: accepted.acceptedRows }));
      }
    } catch (e) {
      setError(e instanceof Error && e.message === copy.notHydrated ? e.message : errorText(e));
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      try {
        if (pickedFile?.exists) pickedFile.delete();
      } catch {
        // The OS may already have reclaimed its picker cache copy.
      }
      setBusy(null);
    }
  };

  const createAddress = async () => {
    if (!cfg) return;
    setBusy('email-create');
    setError(null);
    try {
      const issued = await createEmailForwardingAddress(cfg);
      const next = await saveRelayEmailCredential(cfg, issued.emailToken, issued.forwardingAddress);
      setCfg(next);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const copyAddress = async () => {
    if (!cfg?.forwardingAddress) return;
    const address = cfg.forwardingAddress;
    await Clipboard.setStringAsync(address);
    setCopied(true);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    if (clipboardTimer.current) clearTimeout(clipboardTimer.current);
    clipboardTimer.current = setTimeout(() => {
      void Clipboard.getStringAsync().then((current) => {
        if (current === address) void Clipboard.setStringAsync('');
      });
      setCopied(false);
    }, 60_000);
  };

  const checkEmail = async () => {
    if (!cfg) return;
    setBusy('email-check');
    setError(null);
    setStatus(null);
    try {
      const imported = await syncQueued(cfg);
      setStatus(interpolate(imported > 0 ? copy.emailSuccess : copy.emailNoNew, { imported }));
    } catch (e) {
      setError(e instanceof Error && e.message === copy.notHydrated ? e.message : errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const revoke = () => {
    if (!cfg?.forwardingAddress) return;
    Alert.alert(copy.revokeTitle, copy.revokeBody, [
      { text: language === 'ar' ? 'إلغاء' : 'Cancel', style: 'cancel' },
      {
        text: copy.revoke,
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setBusy('email-revoke');
            setError(null);
            try {
              await revokeEmailForwardingAddress(cfg);
              setCfg(await clearRelayEmailCredential(cfg));
            } catch (e) {
              setError(errorText(e));
            } finally {
              setBusy(null);
            }
          })();
        },
      },
    ]);
  };

  const locked = state.privateMode;
  const mb = capabilities ? Math.round(capabilities.pdf.maxBytes / 1048576) : 0;

  return (
    <View style={styles.root}>
      <SectionHeader title={copy.header} />
      <View style={styles.hero}>
        <ThemedText type="heading">{copy.title}</ThemedText>
        <ThemedText type="default" themeColor="textSecondary">
          {Platform.OS === 'android' ? copy.introAndroid : copy.introIos}
        </ThemedText>
      </View>

      {locked ? (
        <Block>
          <View style={styles.cardHead}>
            <Icon name="lock" size={20} color={theme.warning} />
            <ThemedText type="small">{copy.privateTitle}</ThemedText>
          </View>
          <ThemedText type="meta" themeColor="textTertiary">{copy.privateBody}</ThemedText>
        </Block>
      ) : !cfg ? (
        <Block>
          <View style={styles.cardHead}>
            <Icon name="lock" size={20} color={theme.primary} />
            <ThemedText type="small">{copy.connectTitle}</ThemedText>
          </View>
          <ThemedText type="meta" themeColor="textTertiary">{copy.connectBody}</ThemedText>
          <Button
            label={busy === 'connect' ? copy.connecting : copy.connect}
            onPress={() => void connect()}
            disabled={busy !== null}
          />
        </Block>
      ) : (
        <>
          {busy === 'capabilities' && (
            <ThemedText type="meta" themeColor="textTertiary">{copy.checking}</ThemedText>
          )}
          {!capabilities && busy !== 'capabilities' && (
            <Button
              variant="outline"
              label={copy.retry}
              onPress={() => void loadCapabilities(cfg)}
              disabled={busy !== null}
            />
          )}

          <Block style={styles.importCard}>
            <View style={styles.cardHead}>
              <View style={[styles.iconWell, { backgroundColor: theme.primarySoft }]}>
                <Icon name="upload" size={20} color={theme.primary} />
              </View>
              <View style={styles.cardCopy}>
                <ThemedText type="small">{copy.pdfTitle}</ThemedText>
                <ThemedText type="meta" themeColor="textTertiary">{copy.pdfBody}</ThemedText>
              </View>
            </View>
            {capabilities && (
              <ThemedText type="nano" themeColor="textTertiary" tabular>
                {interpolate(copy.pdfLimits, {
                  mb,
                  pages: capabilities.pdf.maxPages,
                  rows: capabilities.pdf.maxRows,
                })}
              </ThemedText>
            )}
            <Button
              icon="upload"
              label={busy === 'pdf' ? copy.uploading : copy.choosePdf}
              onPress={() => void pickAndUpload()}
              disabled={!capabilities || busy !== null}
            />
          </Block>

          <Block style={styles.importCard}>
            <View style={styles.cardHead}>
              <View style={[styles.iconWell, { backgroundColor: theme.backgroundSelected }]}>
                <Icon name="mail" size={20} color={theme.text} />
              </View>
              <View style={styles.cardCopy}>
                <ThemedText type="small">{copy.emailTitle}</ThemedText>
                <ThemedText type="meta" themeColor="textTertiary">{copy.emailBody}</ThemedText>
              </View>
            </View>
            {cfg.forwardingAddress ? (
              <>
                <View style={[styles.address, { borderColor: theme.cardBorderStrong, backgroundColor: theme.background }]}>
                  <ThemedText type="code" selectable style={styles.addressText}>
                    {cfg.forwardingAddress}
                  </ThemedText>
                </View>
                <Button
                  icon="mail"
                  label={copied ? copy.copied : copy.copyAddress}
                  onPress={() => void copyAddress()}
                  disabled={busy !== null}
                />
                <Button
                  variant="outline"
                  label={busy === 'email-check' ? copy.checkingEmail : copy.checkEmail}
                  onPress={() => void checkEmail()}
                  disabled={busy !== null}
                />
                <Button
                  variant="ghost"
                  label={busy === 'email-revoke' ? copy.revoking : copy.revoke}
                  onPress={revoke}
                  disabled={busy !== null}
                />
              </>
            ) : (
              <>
                <ThemedText type="meta" themeColor="textTertiary">{copy.oldConnection}</ThemedText>
                <Button
                  icon="mail"
                  label={busy === 'email-create' ? copy.creatingAddress : copy.createAddress}
                  onPress={() => void createAddress()}
                  disabled={!capabilities?.email.enabled || busy !== null}
                />
              </>
            )}
          </Block>
        </>
      )}

      {error && (
        <View style={[styles.message, { backgroundColor: theme.expenseSoftBg, borderColor: theme.expenseSoftBorder }]}>
          <Icon name="alert" size={17} color={theme.expense} />
          <ThemedText type="meta" style={[styles.messageText, { color: theme.expense }]}>{error}</ThemedText>
        </View>
      )}
      {status && (
        <View style={[styles.message, { backgroundColor: theme.primarySoft, borderColor: theme.primaryBorder }]}>
          <Icon name="check" size={17} color={theme.primary} />
          <ThemedText type="meta" style={styles.messageText}>{status}</ThemedText>
        </View>
      )}

      <View style={[styles.privacy, { borderTopColor: theme.cardBorder }]}>
        <Icon name="lock" size={17} color={theme.primary} />
        <View style={styles.cardCopy}>
          <ThemedText type="small">{copy.privacyTitle}</ThemedText>
          <ThemedText type="meta" themeColor="textTertiary">{copy.privacyBody}</ThemedText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: Spacing.three },
  hero: { gap: Spacing.one },
  importCard: { gap: Spacing.three },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2 },
  cardCopy: { flex: 1, gap: Spacing.half },
  iconWell: {
    width: 42,
    height: 42,
    borderRadius: Radius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  address: { borderWidth: 1, borderRadius: Radius.control, padding: Spacing.three },
  addressText: { writingDirection: 'ltr', textAlign: 'left' },
  message: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Radius.control,
    padding: Spacing.three,
  },
  messageText: { flex: 1 },
  privacy: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.three,
  },
});
