import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Button } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { Block, SectionHeader } from '@/components/ui/layout';
import { Radius, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { createCaptureExecutor } from '@/lib/capture-executor';
import {
  createEmailForwardingAddress,
  getImportCapabilities,
  revokeEmailForwardingAddress,
  uploadCsvStatement,
  uploadPdfStatement,
} from '@/lib/cloud-import';
import {
  CloudImportError,
  type ImportCapabilities,
} from '@/lib/cloud-import-contract';
import {
  clearRelayEmailCredential,
  DEFAULT_RELAY_URL,
  getRelayConfig,
  pairDevice,
  saveRelayEmailCredential,
  type RelayConfig,
} from '@/lib/relay';
import { useStore } from '@/lib/store';
import { SUPPLEMENT_COPY } from '@/lib/supplement-copy';


type Busy = 'connect' | 'capabilities' | 'statement' | 'email-create' | 'email-check' | 'email-revoke' | null;

function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));
}

export function SupplementImports() {
  const language = useLanguage();
  const copy = SUPPLEMENT_COPY[language];
  const theme = useTheme();
  const {
    state,
    importBatch,
    stageReviewAlerts,
    ensureDurable,
    setMarket,
  } = useStore();
  const stateRef = useRef(state);
  stateRef.current = state;
  const captureExecutor = useMemo(
    () =>
      createCaptureExecutor({
        ledger: {
          getState: () => stateRef.current,
          importBatch,
          stageReviewAlerts,
          ensureDurable,
          setMarket: (market) => setMarket(market),
        },
      }),
    [ensureDurable, importBatch, setMarket, stageReviewAlerts],
  );
  const clipboardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedAddress = useRef<string | null>(null);
  const disposed = useRef(false);

  const [cfg, setCfg] = useState<RelayConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [capabilities, setCapabilities] = useState<ImportCapabilities | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);

  const errorText = useCallback((value: unknown): string => {
    if (!(value instanceof CloudImportError)) return copy.errUnexpected;
    if (value.code === 'network') return copy.errNetwork;
    if (value.code === 'unauthorized') return copy.errAuth;
    if (
      value.code === 'invalid_pdf' || value.code === 'pdf_required' ||
      value.code === 'invalid_csv' || value.code === 'csv_required'
    ) return copy.errInvalid;
    if (value.code === 'too_large' || value.code === 'too_many_pages' || value.code === 'too_many_rows') return copy.errLarge;
    if (value.code === 'unreadable_pdf') return copy.errUnreadable;
    if (value.code === 'unsupported_statement_format') return copy.errFormat;
    if (value.code === 'rate_limited' || value.code === 'queue_full') return copy.errRate;
    if (value.code === 'email_not_configured') return copy.errEmailOff;
    if (value.code === 'service') return copy.serviceError;
    return copy.errUnexpected;
  }, [copy]);

  const clearCopiedAddress = useCallback(async (address: string): Promise<void> => {
    try {
      const current = await Clipboard.getStringAsync();
      if (current === address) await Clipboard.setStringAsync('');
    } catch {
      // Best effort: never replace a different clipboard value while cleaning.
    } finally {
      if (copiedAddress.current === address) copiedAddress.current = null;
    }
  }, []);

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
    disposed.current = false;
    void getRelayConfig()
      .then((existing) => {
        if (!live) return;
        setCfg(existing);
        if (existing) void loadCapabilities(existing);
      })
      .finally(() => {
        if (live) setLoadingConfig(false);
      });
    return () => {
      live = false;
      disposed.current = true;
      if (clipboardTimer.current) clearTimeout(clipboardTimer.current);
      const address = copiedAddress.current;
      if (address) void clearCopiedAddress(address);
    };
  }, [clearCopiedAddress, loadCapabilities]);

  const connect = async () => {
    if (loadingConfig || busy !== null) return;
    if (!DEFAULT_RELAY_URL) {
      setError(copy.unavailable);
      return;
    }
    setBusy('connect');
    setError(null);
    setStatus(null);
    try {
      // Keychain is authoritative at the action boundary too: another screen
      // may have connected while this surface was mounted. Never mint a new
      // identity over the token already installed in the user's Shortcut.
      const existing = await getRelayConfig();
      if (existing) {
        setCfg(existing);
        await loadCapabilities(existing);
        return;
      }
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

  const syncQueued = useCallback(async (): Promise<number> => {
    const outcome = await captureExecutor.execute('supplemental');
    if (outcome.kind === 'not-hydrated') throw new Error(copy.notHydrated);
    if (outcome.kind === 'needs-setup') throw new Error(copy.unavailable);
    return outcome.kind === 'imported' || outcome.kind === 'up-to-date'
      ? outcome.transactions
      : 0;
  }, [captureExecutor, copy.notHydrated, copy.unavailable]);

  const pickAndUpload = async () => {
    if (!cfg || !capabilities) return;
    setError(null);
    setStatus(null);
    let pickedFile: File | null = null;
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: [...capabilities.pdf.accepts, ...capabilities.csv.accepts],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets[0]) return;
      const asset = picked.assets[0];
      pickedFile = new File(asset.uri);
      setBusy('statement');
      const csv = /\.(?:csv|tsv)$/i.test(asset.name) ||
        capabilities.csv.accepts.includes(asset.mimeType?.split(';', 1)[0].toLowerCase() ?? '');
      const accepted = csv
        ? await uploadCsvStatement(cfg, asset, capabilities)
        : await uploadPdfStatement(cfg, asset, capabilities);
      try {
        const imported = await syncQueued();
        if ('pages' in accepted) {
          setStatus(interpolate(imported > 0 ? copy.pdfSuccess : copy.pdfNoNew, {
            accepted: accepted.acceptedRows,
            pages: accepted.pages,
            imported,
          }));
        } else {
          setStatus(interpolate(imported > 0 ? copy.csvSuccess : copy.csvNoNew, {
            accepted: accepted.acceptedRows,
            rejected: accepted.rejectedRows,
            imported,
          }));
        }
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
    copiedAddress.current = address;
    await Clipboard.setStringAsync(address);
    if (disposed.current) {
      await clearCopiedAddress(address);
      return;
    }
    setCopied(true);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    if (clipboardTimer.current) clearTimeout(clipboardTimer.current);
    clipboardTimer.current = setTimeout(() => {
      void clearCopiedAddress(address);
      setCopied(false);
    }, 60_000);
  };

  const checkEmail = async () => {
    if (!cfg) return;
    setBusy('email-check');
    setError(null);
    setStatus(null);
    try {
      const imported = await syncQueued();
      setStatus(interpolate(imported > 0 ? copy.emailSuccess : copy.emailNoNew, { imported }));
    } catch (e) {
      setError(e instanceof Error && e.message === copy.notHydrated ? e.message : errorText(e));
    } finally {
      setBusy(null);
    }
  };

  /**
   * The revocation itself, reachable from the confirmation sheet and from
   * nowhere else — it used to sit inside an alert button's `onPress`, which on
   * the web export is code no tap can reach: `Alert.alert` is `static alert() {}`
   * there, so "Revoke address" did nothing at all and said nothing about it.
   */
  const revokeAddress = () => {
    if (!cfg) return;
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
  };

  const locked = state.privateMode;
  const pdfMb = capabilities ? Math.round(capabilities.pdf.maxBytes / 1048576) : 0;
  const csvMb = capabilities ? Math.round(capabilities.csv.maxBytes / 1048576) : 0;

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
      ) : loadingConfig ? (
        <Block>
          <ThemedText type="meta" themeColor="textTertiary">{copy.checking}</ThemedText>
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
                <ThemedText type="small">{copy.statementTitle}</ThemedText>
                <ThemedText type="meta" themeColor="textTertiary">{copy.statementBody}</ThemedText>
              </View>
            </View>
            {capabilities && (
              <ThemedText type="nano" themeColor="textTertiary" tabular>
                {interpolate(copy.statementLimits, {
                  pdfMb,
                  csvMb,
                  pages: capabilities.pdf.maxPages,
                  rows: capabilities.pdf.maxRows,
                })}
              </ThemedText>
            )}
            <Button
              icon="upload"
              label={busy === 'statement' ? copy.uploading : copy.chooseStatement}
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
                  onPress={() => setConfirmingRevoke(true)}
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

      {/* A sibling, not a nested sheet: this block is a section of a scrolling
          screen, not a presented modal, so there is no parent to stack under.
          Mounted only while there is something to confirm, so the sheet's
          entry animation runs on every open. The address guard was the alert's
          own early return and still has to hold — the button is drawn only in
          that branch, but the sheet's own confirm must not fire against a
          config that lost its credential while the sheet was open. */}
      {confirmingRevoke && cfg?.forwardingAddress && (
        <ConfirmSheet
          visible
          onClose={() => setConfirmingRevoke(false)}
          question={copy.revokeTitle}
          body={copy.revokeBody}
          confirmLabel={copy.revoke}
          destructive
          onConfirm={revokeAddress}
        />
      )}
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
