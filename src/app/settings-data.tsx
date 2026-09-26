/**
 * Settings → Data and help.
 *
 * Everything that works ON the ledger rather than configuring the app moved
 * here from Settings: exports, the plain-JSON backup and its restore, the
 * category and format clean-ups, feedback, the public links, the founder mark
 * and version, and — alone at the bottom, with distance above it — Erase.
 * Nothing was dropped on the way; the capability inventory test reads both
 * screens together.
 *
 * Design language E: the sand band carries the plain title; the sheet holds
 * the grouped rows. Erase is the one irreversible action in the app. Its
 * confirmation is a centred alert card on the sheet surface rather than a
 * bottom sheet, and the way out is named for what it keeps ("Keep my data"),
 * not "Cancel" — and it is the primary button.
 */
import Constants from 'expo-constants';
import * as DocumentPicker from 'expo-document-picker';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState as RNAppState,
  InteractionManager,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { DiagnosticExportControl } from '@/components/diagnostic-export-control';
import { BandTitle } from '@/components/settings-band/band-title';
import { SettingsGroupTitle, SettingsLinkRow } from '@/components/settings-rows';
import { TesterDiagnosticsControl } from '@/components/tester-diagnostics-control';
import { ThemedText } from '@/components/themed-text';
import { EButton } from '@/components/ui/band/e-button';
import { BandScaffold, type BandNav } from '@/components/ui/band-scaffold';
import { ChoiceSheet } from '@/components/ui/choice-sheet';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Icon, type IconName } from '@/components/ui/icon';
import { Row } from '@/components/ui/layout';
import { WafraMark } from '@/components/wafra-logo';
import { BandLayout, Fonts, ScreenPadding, Spacing, type BandPalette } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useTheme } from '@/hooks/use-theme';
import { noFormatsReason, unreadFormatCount } from '@/lib/accuracy';
import { clearBackgroundRelayRows } from '@/lib/background-relay';
import { hasSmsPermission, isSmsScanningAvailable, requestSmsPermission } from '@/lib/auto-import';
import { eraseIosCaptureStore, isCaptureAvailable, setIosCaptureEnabled } from '@/lib/capture';
import {
  EMPTY_FOUNDER_TAP_SEQUENCE,
  isFounderUnlockBuild,
  recordFounderTap,
} from '@/lib/founder-pro';
import { monthEndISO, monthKey, monthStartISO } from '@/lib/format';
import { tapped } from '@/lib/haptics';
import { t, tf } from '@/lib/i18n';
import {
  createIosHistoryPostEraseCleanup,
  eraseIosHistorySessions,
  iosSupportsMessageHistory,
} from '@/lib/ios-history-setup';
import { clearIosMessageSetupProgress } from '@/lib/ios-message-onboarding';
import {
  isInternalLaunchDiagnosticsEnabled,
  serializeLaunchMetrics,
} from '@/lib/launch-performance';
import { internalTransferIdsForState, isSpending, liveAccountIds } from '@/lib/ledger';
import { buildLedgerCsv } from '@/lib/ledger-export';
import { displayRegion } from '@/lib/ledger-money';
import { marketCurrencyCode } from '@/lib/markets';
import { configuredPublicUrl } from '@/lib/public-links';
// The same relay client Settings used for erase; see the note there about the
// two incompatible relay clients.
import {
  getRelayConfig,
  getRelayConfigStrict,
  isLegacyShortcutCaptureActive,
  isRelayPlatform,
  RelayError,
  unpairDevice,
  type RelayConfig,
} from '@/lib/relay';
import {
  buildExpenseReportHtml,
  reportExpenses,
} from '@/lib/reimbursement-report';
import { settingsCopy } from '@/lib/settings-copy';
import { readBackupPickerCopy, shareText, shareTextFile } from '@/lib/share-text';
import { openShortcutsApp, shortcutCleanupApplies } from '@/lib/shortcut-cleanup';
import { isSmsCorpusExportAvailable, sharePersonalDataForReview } from '@/lib/sms-corpus-export';
import { ClearAllError, useStore } from '@/lib/store';
import { uncategorisedMerchants } from '@/lib/uncategorised';
import NotificationReader from '../../modules/notification-reader';
import SmsReader from '../../modules/sms-reader';

export default function SettingsDataScreen() {
  // Design language E: Data and help wears Settings' sand band.
  const band = useBand('settings');
  const router = useRouter();
  const {
    state,
    exportBackup,
    getStateSnapshot,
    getStateGeneration,
    restoreBackup,
    clearAll,
    unlockFounderPro,
  } = useStore();
  const copy = settingsCopy(state.language);
  const version = Constants.expoConfig?.version ?? '1.0.0';
  const privacyPolicyUrl = configuredPublicUrl('privacyPolicyUrl');
  const termsOfUseUrl = configuredPublicUrl('termsOfUseUrl');
  const supportUrl = configuredPublicUrl('supportUrl');
  const founderUnlockEnabled =
    Platform.OS !== 'web' && isFounderUnlockBuild();
  const founderTapSequence = useRef(EMPTY_FOUNDER_TAP_SEQUENCE);
  const [publicLinkNotice, setPublicLinkNotice] = useState(false);
  const [eraseDialogVisible, setEraseDialogVisible] = useState(false);
  const [eraseDialogBody, setEraseDialogBody] = useState('');
  const eraseAfterDismiss = useRef(false);
  const [reportScopeSheet, setReportScopeSheet] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    question: string;
    body?: string;
    confirmLabel: string;
    cancelLabel?: string;
    destructive?: boolean;
    onConfirm: () => void;
  } | null>(null);

  // Counts on the two clean-up rows. Both helpers walk the whole ledger, which
  // is full-history maintenance, so they never run during the screen's first
  // paint: the rows show their plain description until the scan has run once
  // interactions settle, and a store update refreshes the counts the same way.
  const [cleanupCounts, setCleanupCounts] = useState<{ place: number; unread: number } | null>(null);
  // A zero "formats Wafra couldn't read" is only a finding where the message
  // text is kept (Android, outside Private Mode). On an iPhone or in Private
  // Mode there is nothing to count, so the row keeps its plain description.
  const formatsCountable = noFormatsReason({
    relayPlatform: isRelayPlatform(),
    localCaptureAvailable: isCaptureAvailable(),
    privateMode: state.privateMode,
  }) === 'none-found';
  // Re-run only when an input of the two scans changes, not on every store
  // update (a toggle elsewhere must not re-walk the ledger).
  const { transactions, accounts, merchantOverrides, billAliases } = state;
  useFocusEffect(useCallback(() => {
    let active = true;
    const task = InteractionManager.runAfterInteractions(() => {
      if (!active) return;
      const snapshot = getStateSnapshot();
      const summary = uncategorisedMerchants(snapshot);
      setCleanupCounts({
        place: summary.merchants.length + summary.paymentPurposes.length,
        unread: unreadFormatCount(snapshot),
      });
    });
    return () => {
      active = false;
      task.cancel();
    };
  // The listed fields are exactly what the two scans read.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getStateSnapshot, transactions, accounts, merchantOverrides, billAliases]));

  /* ── Relay status, for the erase wording ─────────────────────────────── */

  // `undefined` is "not read yet"; on iOS the cautious reading of that is
  // that a pairing exists, so the erase dialog mentions the Shortcut.
  const [relay, setRelay] = useState<RelayConfig | null | undefined>(
    isRelayPlatform() ? undefined : null,
  );
  useFocusEffect(useCallback(() => {
    if (!isRelayPlatform()) return;
    let active = true;
    void getRelayConfig()
      .then((cfg) => { if (active) setRelay(cfg); })
      .catch(() => { if (active) setRelay(null); });
    return () => { active = false; };
  }, []));

  /* ── Personal review export (tester builds) ──────────────────────────── */

  const [personalReviewBusy, setPersonalReviewBusy] = useState(false);
  const [personalReviewCount, setPersonalReviewCount] = useState(0);
  const personalReviewRunning = useRef(false);
  const personalReviewEpoch = useRef(0);
  const personalReviewFocused = useRef(false);
  const personalReviewBackup = useRef(exportBackup);
  personalReviewBackup.current = exportBackup;
  const personalReviewGeneration = getStateGeneration();
  useFocusEffect(useCallback(() => {
    personalReviewFocused.current = true;
    setPersonalReviewBusy(personalReviewRunning.current);
    return () => {
      personalReviewFocused.current = false;
      personalReviewEpoch.current++;
    };
  }, []));
  useEffect(() => { personalReviewEpoch.current++; }, [state.privateMode, personalReviewGeneration]);
  useEffect(() => {
    const subscription = RNAppState.addEventListener('change', next => {
      if (next === 'background') personalReviewEpoch.current++;
    });
    return () => subscription.remove();
  }, []);

  const onFounderLogoTap = async () => {
    if (!founderUnlockEnabled || state.founderPro) return;
    tapped();
    const result = recordFounderTap(founderTapSequence.current, Date.now());
    founderTapSequence.current = result.next;
    if (!result.unlocked) return;
    try {
      await unlockFounderPro();
      Alert.alert(t('founderProUnlockedTitle'), t('founderProUnlockedBody'));
    } catch {
      Alert.alert(t('founderProFailedTitle'), t('founderProFailedBody'));
    }
  };

  const openPublicLink = async (url: string) => {
    setPublicLinkNotice(false);
    try {
      await Linking.openURL(url);
    } catch {
      setPublicLinkNotice(true);
    }
  };

  /* ── Data ───────────────────────────────────────────────────────────── */

  const exportCsv = () => {
    const csv = buildLedgerCsv(state.transactions, state.accounts, state.ledgerMoney);
    // A whole ledger is far past the intent-payload ceiling; share the file.
    shareText('wafra-export.csv', csv, {
      mimeType: 'text/csv',
    }).catch(() => {});
  };

  const backupJson = () => {
    shareText('wafra-backup.json', exportBackup(), {
      mimeType: 'application/json',
    }).catch(() => {});
  };

  const exportPersonalReview = async () => {
    if (personalReviewRunning.current || !isSmsCorpusExportAvailable() || getStateSnapshot().privateMode) return;
    personalReviewRunning.current = true;
    setPersonalReviewBusy(true);
    setPersonalReviewCount(0);
    const epoch = ++personalReviewEpoch.current;
    const generation = getStateGeneration();
    const active = () => personalReviewFocused.current && epoch === personalReviewEpoch.current &&
      generation === getStateGeneration() && !getStateSnapshot().privateMode && RNAppState.currentState === 'active';
    try {
      const granted = await hasSmsPermission() || await requestSmsPermission();
      if (!active()) return;
      if (!granted) {
        Alert.alert(t('smsCorpusPermissionTitle'), t('smsCorpusPermissionBody'));
        return;
      }
      await sharePersonalDataForReview({
        getBackup: () => personalReviewBackup.current(),
        shouldContinue: active,
        onProgress: count => { if (active()) setPersonalReviewCount(count); },
        dialogTitle: t('personalReviewExportTitle'),
      });
    } catch {
      if (active()) Alert.alert(t('personalReviewExportFailed'), t('smsCorpusFailedBody'));
    } finally {
      personalReviewRunning.current = false;
      if (personalReviewFocused.current) setPersonalReviewBusy(false);
    }
  };

  const confirmPersonalReviewExport = () => {
    if (personalReviewRunning.current || !isSmsCorpusExportAvailable() || getStateSnapshot().privateMode) return;
    const consentEpoch = personalReviewEpoch.current;
    setConfirmation({
      question: t('personalReviewExportConfirmTitle'),
      body: t('personalReviewExportConfirmBody'),
      confirmLabel: t('personalReviewExportConfirm'),
      onConfirm: () => {
        if (personalReviewFocused.current && consentEpoch === personalReviewEpoch.current) void exportPersonalReview();
      },
    });
  };

  const exportLaunchMetrics = () => {
    shareTextFile('wafra-launch-metrics.json', serializeLaunchMetrics(), {
      mimeType: 'application/json',
      dialogTitle: t('launchMetricsDialog'),
    }).catch(() => Alert.alert(t('launchMetricsExportFailed')));
  };

  const createExpenseReport = async (scope: 'month' | 'all') => {
    // Same rule every other total in the app applies: real spending, on an
    // account still in play, neither leg of a move between the user's own
    // accounts. Without it, a legacy own-account sweep (no transfer flag,
    // caught only by internalTransferIds' structural title match) could both
    // stretch an "all time" report back to its date and print on it as a
    // reimbursable expense.
    const liveAccounts = liveAccountIds(state.accounts);
    const internal = internalTransferIdsForState(state);
    const expenses = state.transactions.filter((tx) => isSpending(tx, liveAccounts, internal));
    const currentMonth = monthKey(new Date());
    const from =
      scope === 'month'
        ? monthStartISO(currentMonth)
        : expenses.reduce((earliest, tx) => (tx.date < earliest ? tx.date : earliest), '9999-12-31');
    const to =
      scope === 'month'
        ? monthEndISO(currentMonth)
        : expenses.reduce((latest, tx) => (tx.date > latest ? tx.date : latest), '0000-01-01');

    if (expenses.length === 0 || reportExpenses(expenses, from, to, liveAccounts, internal).length === 0) {
      Alert.alert(t('noExpensesToExport'));
      return;
    }

    try {
      const html = buildExpenseReportHtml({
        transactions: state.transactions,
        accounts: state.accounts,
        currency: state.ledgerMoney?.currency ?? marketCurrencyCode(state.marketId),
        currencyExponent: state.ledgerMoney?.exponent ?? 2,
        language: state.language === 'ar' ? 'ar' : 'en',
        // The device Region, not the language: an English (US) phone in the
        // UAE keeps day-first UAE dates.
        region: displayRegion(),
        from,
        to,
      });
      const { uri } = await Print.printToFileAsync({
        html,
        width: 595,
        height: 842,
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
      });
      // Expo Print opens the browser print dialog itself on web. Local URI
      // sharing is deliberately unsupported there.
      if (Platform.OS === 'web') return;
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert(t('reportShareUnavailable'));
        return;
      }
      await Sharing.shareAsync(uri, {
        dialogTitle: t('exportExpensePdf'),
        mimeType: 'application/pdf',
        UTI: 'com.adobe.pdf',
      });
    } catch {
      Alert.alert(t('reportExportFailed'));
    }
  };

  /**
   * An alert is not a picker: this one chooses what goes in the PDF, so
   * getting it silently wrong — or, on web, getting nothing at all —
   * produces a report about the wrong months.
   */
  const reportScopeChoices = [
    { value: 'month' as const, label: t('currentMoneyMonth') },
    { value: 'all' as const, label: t('allExpenses') },
  ];

  const restoreFromFile = async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'text/plain', '*/*'],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const content = await readBackupPickerCopy(picked.assets[0].uri);
      setConfirmation({
        question: t('restoreBackupQ'),
        body: t('restoreReplacesAll'),
        confirmLabel: t('restoreAction'),
        destructive: true,
        onConfirm: () => {
          if (!restoreBackup(content)) {
            Alert.alert(t('invalidFile'), t('notAWafraBackup'));
          }
        },
      });
    } catch {
      Alert.alert(t('couldNotReadFile'), t('couldNotReadFileBody'));
    }
  };

  const eraseAllData = async () => {
    if (Platform.OS === 'ios') {
      try {
        await setIosCaptureEnabled(false);
      } catch {
        Alert.alert(t('eraseLocalFailedTitle'), t('eraseCaptureDisableFailedBody'));
        return;
      }
    }
    // Re-read rather than using the `relay` state: this is the destructive
    // path, and a pairing created since this screen mounted must still be
    // torn down.
    let cfg: RelayConfig | null = null;
    try {
      cfg = await getRelayConfigStrict();
    } catch {
      // A locked or damaged Keychain is not proof that this phone was never
      // paired. Stop rather than erase locally while a remote queue and the
      // Shortcut's ingest credential may still be live.
      Alert.alert(t('eraseRelayFailedTitle'), t('eraseRelayFailedBody'));
      return;
    }

    const hadLegacyShortcut = isLegacyShortcutCaptureActive(cfg);
    if (cfg) {
      try {
        await unpairDevice(cfg);
      } catch (error) {
        // Three failures, three different truths. For an owner whose vault
        // still has other devices the relay answers 409 `last_owner` forever,
        // and "connect to the internet and try again" can never work — so
        // that one routes to Trusted devices instead.
        if (error instanceof RelayError && error.code === 'last_owner') {
          setConfirmation({
            question: t('eraseVaultOwnerTitle'),
            body: t('eraseVaultOwnerBody'),
            confirmLabel: t('trustedSettingsRow'),
            onConfirm: () => router.push('/trusted-devices'),
          });
          return;
        }
        Alert.alert(t('eraseRelayFailedTitle'), t('eraseRelayFailedBody'));
        return;
      }
    }

    try {
      const notificationReader = NotificationReader;
      const cleanupCaptureQueue = isRelayPlatform()
        ? createIosHistoryPostEraseCleanup({
            eraseCapture: eraseIosCaptureStore,
            eraseHistory: eraseIosHistorySessions,
            clearMessageSetup: clearIosMessageSetupProgress,
            clearBackground: async () => {
              await clearBackgroundRelayRows();
            },
          })
        : Platform.OS === 'android'
          ? async () => {
              if (!SmsReader?.clearCaptured || !(await SmsReader.clearCaptured())) {
                throw new Error('sms_capture_cleanup_failed');
              }
              if (notificationReader && !(await notificationReader.clearCaptured())) {
                throw new Error('notification_capture_cleanup_failed');
              }
            }
          : undefined;
      await clearAll(cleanupCaptureQueue);
    } catch (error) {
      if (!(error instanceof ClearAllError) || error.stage === 'erase') {
        // The relay half really did succeed — the device row, its queue and its
        // tokens are gone — and only the local ledger survived. Repeating the
        // relay message here would claim the opposite.
        Alert.alert(t('eraseLocalFailedTitle'), t('eraseLocalFailedBody'));
        return;
      }
      const cleanupFailed = error.stage === 'cleanup';
      const failureTitle = cleanupFailed
        ? t('eraseQueueCleanupFailedTitle')
        : t('eraseLocalInitializeFailedTitle');
      const failureBody = cleanupFailed
        ? t('eraseQueueCleanupFailedBody')
        : t('eraseLocalInitializeFailedBody');
      if (shortcutCleanupApplies(hadLegacyShortcut)) {
        Alert.alert(
          failureTitle,
          `${failureBody}\n\n${t('shortcutCleanupErased')}`,
        );
      } else {
        Alert.alert(failureTitle, failureBody);
      }
      return;
    }

    // Both halves are gone, and this is the moment the user believes nothing
    // is left. On iOS a legacy Shortcut may still be installed and still send
    // bank-message text; no API lets this app delete it, so say where it is.
    if (shortcutCleanupApplies(hadLegacyShortcut)) {
      setConfirmation({
        question: t('shortcutStillInstalledTitle'),
        body: t('shortcutCleanupErased'),
        confirmLabel: t('iosOpenShortcutsApp'),
        cancelLabel: t('iosDone'),
        onConfirm: openShortcutsApp,
      });
    }
  };

  /**
   * Erasing reaches the relay too: `eraseAllData` unpairs this phone BEFORE
   * wiping locally, because unpairing needs the admin token the wipe is about
   * to destroy, and it says which half failed rather than swallowing it.
   * The Shortcut sentence is true only where a Shortcut can exist, so a phone
   * that never paired is not warned about one.
   */
  const confirmErase = () => {
    const mentionsShortcut = shortcutCleanupApplies(
      isLegacyShortcutCaptureActive(relay),
    );
    setEraseDialogBody(mentionsShortcut
      ? t('eraseEverythingIosBody')
      : // A phone that reads its own inbox rebuilds the entries on the next
        // scan; promising they are gone for good would be false there.
        isSmsScanningAvailable()
        ? t('eraseEverythingSmsBody')
        : t('eraseEverythingBody'));
    setEraseDialogVisible(true);
  };

  /* ── Rows ───────────────────────────────────────────────────────────── */

  const nav: BandNav = { back: true };

  const linkRow = (
    title: string,
    subtitle: string | null,
    onPress: () => void,
    { last = false, icon }: { last?: boolean; icon?: IconName } = {},
  ) => (
    <SettingsLinkRow title={title} subtitle={subtitle} onPress={onPress} last={last} icon={icon} palette={band} />
  );

  const publicLinkRow = (
    title: string,
    url: string | null,
    last = false,
  ) => {
    if (url) return linkRow(title, null, () => void openPublicLink(url), { last });
    return (
      <Row last={last}>
        <View style={styles.rowText}>
          <ThemedText type="smallBold" style={{ color: band.text }}>{title}</ThemedText>
          <ThemedText type="meta" style={{ color: band.textSecondary }}>
            {t('publicLinkUnavailable')}
          </ThemedText>
        </View>
        <Icon name="alert" size={15} color={band.statusNear} />
      </Row>
    );
  };

  return (
    <React.Fragment>
      <BandScaffold
        band="settings"
        testID="settings-data-screen"
        nav={nav}
        scrollProps={{ showsVerticalScrollIndicator: false }}
        contentStyle={styles.content}
        bandContent={<View style={styles.bandBody}><BandTitle title={copy.dataAndHelp} palette={band} /></View>}>
        <View testID="settings-data-your-data" style={styles.panel}>
          <SettingsGroupTitle title={copy.yourData} palette={band} />
          {linkRow(t('exportExpensePdf'), copy.exportPdfDetail, () => setReportScopeSheet(true), { icon: 'receipt' })}
          {linkRow(t('exportCsv'), copy.exportCsvDetail, exportCsv, { icon: 'download' })}
          {linkRow(copy.backupTitle, copy.backupDetail, backupJson, { icon: 'upload' })}
          {linkRow(copy.restoreTitle, copy.restoreDetail, restoreFromFile, {
            icon: 'repeat',
            last: !isSmsCorpusExportAvailable() && !isInternalLaunchDiagnosticsEnabled(),
          })}
          {isSmsCorpusExportAvailable() && (
            <View style={styles.tester}>
              <EButton
                palette={band}
                variant="secondary"
                label={t('personalReviewExportTitle')}
                icon="download"
                disabled={personalReviewBusy || state.privateMode}
                onPress={confirmPersonalReviewExport}
              />
              <ThemedText type="meta" style={{ color: band.textSecondary }} accessibilityLiveRegion="polite">
                {personalReviewBusy
                  ? tf('smsCorpusExportProgress', { count: personalReviewCount })
                  : t(state.privateMode ? 'personalReviewExportPrivateMode' : 'personalReviewExportDetail')}
              </ThemedText>
            </View>
          )}
          <DiagnosticExportControl />
          {isInternalLaunchDiagnosticsEnabled() &&
            linkRow(t('launchMetricsInternal'), t('launchMetricsDetail'), exportLaunchMetrics, { last: true, icon: 'code' })}
        </View>

        <View testID="settings-data-help" style={styles.panel}>
          <SettingsGroupTitle title={copy.helpImprove} palette={band} />
          {linkRow(
            t('sortShops'),
            cleanupCounts ? copy.merchantsToPlace(cleanupCounts.place) : t('sortShopsSettingsDetail'),
            () => router.push('/categorise'),
            { icon: 'sliders' },
          )}
          {linkRow(
            copy.unreadAlerts,
            cleanupCounts && formatsCountable ? copy.unreadFormats(cleanupCounts.unread) : t('improveAccuracySettingsDetail'),
            () => router.push('/accuracy'),
            { icon: 'mail' },
          )}
          {linkRow(
            t('sendFeedback'),
            t('sendFeedbackDetail'),
            () => router.push('/feedback'),
            { last: true, icon: 'spark' },
          )}
        </View>

        {Platform.OS === 'ios' && iosSupportsMessageHistory(Platform.Version) && (
          <View style={styles.panel}>
            {/* Statements bring in the past on iPhone. Reading old texts through
                Shortcuts stays available, but only here, as an experiment. */}
            <SettingsGroupTitle title={copy.advanced} palette={band} />
            {linkRow(
              t('iosPastSmsTitle'),
              t('iosPastSmsDetail'),
              () => router.push({ pathname: '/ios-setup', params: { section: 'history' } }),
              { last: true, icon: 'calendar' },
            )}
          </View>
        )}

        <View testID="settings-data-about" style={styles.panel}>
          <SettingsGroupTitle title={copy.about} palette={band} />
          {publicLinkRow(t('privacyPolicy'), privacyPolicyUrl)}
          {publicLinkRow(t('termsOfUse'), termsOfUseUrl)}
          {publicLinkRow(t('supportWebsite'), supportUrl, true)}
          {publicLinkNotice && (
            <View
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              style={styles.publicLinkNotice}>
              <Icon name="alert" size={16} color={band.statusOver} />
              <View style={styles.rowText}>
                <ThemedText type="smallBold" style={{ color: band.text }}>{t('legalLinkFailed')}</ThemedText>
                <ThemedText type="meta" style={{ color: band.textSecondary }}>
                  {t('legalLinkFailedBody')}
                </ThemedText>
              </View>
            </View>
          )}
          <View style={styles.about}>
            {founderUnlockEnabled ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('wafraLogo')}
                disabled={state.founderPro}
                hitSlop={4}
                onPress={() => void onFounderLogoTap()}
                style={styles.founderLogoTap}>
                <WafraMark size={34} />
              </Pressable>
            ) : (
              <WafraMark size={34} />
            )}
          </View>
          <TesterDiagnosticsControl />
        </View>

        {/* Twice the gap every other group gets, and nothing routine beside
            it: Erase is the only control here that cannot be undone. */}
        <View testID="settings-data-erase" style={styles.danger}>
          <EButton
            label={t('eraseAll')}
            palette={band}
            icon="trash"
            // Destructive: the status-over tone, with the text colour the
            // band's own fill takes, which reads on it in both schemes.
            color={{ fill: band.statusOver, text: band.onFill }}
            onPress={confirmErase}
          />
          <ThemedText
            type="meta"
            style={[styles.footer, { color: band.textSecondary }]}
            testID="settings-version-footer">
            {copy.versionFooter(version)}
          </ThemedText>
        </View>
      </BandScaffold>

      <ChoiceSheet
        visible={reportScopeSheet}
        onClose={() => setReportScopeSheet(false)}
        title={t('expenseReportPeriod')}
        body={t('expenseReportPeriodBody')}
        options={reportScopeChoices}
        onSelect={(scope) => void createExpenseReport(scope)}
      />
      <EraseDialog
        palette={band}
        visible={eraseDialogVisible}
        title={copy.eraseTitle}
        body={eraseDialogBody}
        confirmLabel={copy.eraseConfirm}
        keepLabel={copy.eraseKeep}
        onKeep={() => setEraseDialogVisible(false)}
        onErase={() => {
          // iOS drops an alert raised while a Modal is still dismissing, and
          // eraseAllData reports failures through Alert. So on iOS the erase
          // starts from the Modal's onDismiss, after it has fully closed.
          if (Platform.OS === 'ios') eraseAfterDismiss.current = true;
          setEraseDialogVisible(false);
          if (Platform.OS !== 'ios') void eraseAllData();
        }}
        onDismiss={() => {
          if (!eraseAfterDismiss.current) return;
          eraseAfterDismiss.current = false;
          void eraseAllData();
        }}
      />
      {confirmation && (
        <ConfirmSheet
          visible
          onClose={() => setConfirmation(null)}
          question={confirmation.question}
          body={confirmation.body}
          confirmLabel={confirmation.confirmLabel}
          cancelLabel={confirmation.cancelLabel}
          destructive={confirmation.destructive}
          onConfirm={confirmation.onConfirm}
        />
      )}
    </React.Fragment>
  );
}

/**
 * A centred, alert-shaped dialog for the one irreversible action. Drawn, not
 * delegated to `Alert.alert`, because react-native-web's Alert is an empty
 * method and an erase that silently does nothing gets tapped twice. Modal's
 * fade is a cross-fade, which is also what Reduce Motion asks for.
 *
 * Design language E: a card on the sheet surface, lifted, with the sheet's
 * 28pt radius. "Keep my data" is the primary (filled) action and comes
 * first; Erase is the destructive one under it. At the accessibility text
 * sizes the card scrolls rather than pushing its buttons off screen.
 */
function EraseDialog({
  visible,
  title,
  body,
  confirmLabel,
  keepLabel,
  onKeep,
  onErase,
  onDismiss,
  palette,
}: {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  keepLabel: string;
  onKeep: () => void;
  onErase: () => void;
  /** iOS only: called once the Modal has fully closed. */
  onDismiss: () => void;
  palette: BandPalette;
}) {
  const theme = useTheme();
  const largeText = useLargeTextLayout();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onDismiss={onDismiss}
      onRequestClose={onKeep}>
      <View style={[styles.scrim, { backgroundColor: theme.scrim }]}>
        <View
          accessibilityViewIsModal
          accessibilityRole="alert"
          onAccessibilityEscape={onKeep}
          testID="settings-erase-dialog"
          style={[styles.dialog, { backgroundColor: palette.sheet, borderColor: palette.rule }]}>
          <ScrollView bounces={false} contentContainerStyle={styles.dialogBody}
            scrollEnabled={largeText} showsVerticalScrollIndicator={largeText}>
            <ThemedText accessibilityRole="header" style={[styles.dialogTitle, { color: palette.text }]}>
              {title}
            </ThemedText>
            <ThemedText type="default" style={{ color: palette.textSecondary }}>
              {body}
            </ThemedText>
            <View style={styles.dialogActions}>
              <EButton palette={palette} label={keepLabel} onPress={onKeep} testID="settings-erase-keep" />
              <EButton
                palette={palette}
                label={confirmLabel}
                color={{ fill: palette.statusOver, text: palette.onFill }}
                onPress={onErase}
                testID="settings-erase-confirm"
              />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.two },
  bandBody: { paddingBottom: Spacing.two },
  panel: { gap: 0 },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  tester: { gap: Spacing.two, paddingVertical: Spacing.two },
  about: {
    alignItems: 'flex-start',
    paddingTop: Spacing.three,
  },
  founderLogoTap: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  publicLinkNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    paddingTop: Spacing.two,
  },
  // Twice the gap every other group gets. Erase is the only control here
  // that cannot be undone, and the distance is the point.
  danger: {
    paddingTop: Spacing.five,
    gap: Spacing.two,
  },
  footer: {
    textAlign: 'center',
    paddingTop: Spacing.three,
  },
  scrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: ScreenPadding,
  },
  dialog: {
    width: '100%',
    maxWidth: 380,
    maxHeight: '90%',
    borderRadius: BandLayout.sheetRadius,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  dialogBody: { padding: Spacing.four, gap: Spacing.two + 2 },
  dialogTitle: { fontFamily: Fonts.sansSemi, fontSize: 26, lineHeight: 32, letterSpacing: -0.8 },
  dialogActions: {
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
});
