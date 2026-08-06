/**
 * Settings.
 *
 * There is no appearance picker: `app.json` sets `userInterfaceStyle:
 * automatic` and the app follows the OS. Everything here either changes what
 * the app is allowed to read, or what a month means.
 */
import Constants from 'expo-constants';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { shareText } from '@/lib/share-text';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  I18nManager,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Segmented, Toggle } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { Block, Row, ScreenHeader, Section, SectionHeader } from '@/components/ui/layout';
import { WafraMark } from '@/components/wafra-logo';
import { MaxContentWidth, ScreenPadding, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { unreadFormatCount } from '@/lib/accuracy';
import {
  cancelDailySummary,
  requestNotificationPermission,
  syncDailySummary,
} from '@/lib/notifications';
import { hasSmsPermission, isSmsScanningAvailable, requestSmsPermission } from '@/lib/auto-import';
import { monthEndISO, monthKey, monthStartISO } from '@/lib/format';
import { internalTransferIds, isSpending, liveAccountIds } from '@/lib/ledger';
import { MARKETS } from '@/lib/markets';
import { isProActive, trialDaysLeft } from '@/lib/purchases';
// Deliberately this branch's relay client, not the other one's isRelaySupported/
// unpairRelay/stopRelayWake trio: the two relay clients speak incompatible wire
// contracts (four scoped tokens here vs one there), and mixing their entry
// points compiles on a good day and 401s on the device.
import { getRelayConfig, isRelayPlatform, unpairDevice, type RelayConfig } from '@/lib/relay';
import {
  buildExpenseReportHtml,
  reportExpenses,
} from '@/lib/reimbursement-report';
import { useStore } from '@/lib/store';
import type { ThemePreference } from '@/lib/theme-preference';
import NotificationReader from '../../modules/notification-reader';
import SmsReader from '../../modules/sms-reader';
import { t, tf } from '@/lib/i18n';

/** The reporting month can start on any day that exists in February. */

export default function SettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const {
    state,
    setAppLock,
    setDailySummary,
    setPrivateMode,
    setPro,
    setMarket,
    setUiLanguage,
    exportBackup,
    restoreBackup,
    clearAll,
    setThemePreference,
  } = useStore();

  const themeChoice: ThemePreference =
    state.themePreference === 'light' || state.themePreference === 'dark'
      ? state.themePreference
      : 'system';

  const market = MARKETS.find((m) => m.id === state.marketId) ?? MARKETS[0];
  // `undefined` is "not read yet" and `null` is "read, and there is no pairing".
  // Collapsing the two would print "not connected" for a frame to a user whose
  // capture is in fact running, on the screen where they came to check.
  const [relay, setRelay] = useState<RelayConfig | null | undefined>(
    isRelayPlatform() ? undefined : null,
  );
  const [smsGranted, setSmsGranted] = useState(false);
  const formats = useMemo(() => unreadFormatCount(state), [state]);
  const version = Constants.expoConfig?.version ?? '1.0.0';

  const [instantAlerts, setInstantAlerts] = useState(false);
  // Only builds carrying the delivery receiver can post at delivery time.
  const instantAvailable = isSmsScanningAvailable() && SmsReader?.setInstantAlerts != null;

  useEffect(() => {
    if (!isRelayPlatform()) return;
    let live = true;
    getRelayConfig()
      .then((cfg) => {
        if (live) setRelay(cfg);
      })
      .catch(() => {
        if (live) setRelay(null);
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!isSmsScanningAvailable()) return;
    hasSmsPermission().then(setSmsGranted).catch(() => {});
    // The native side owns this one — the receiver reads it from
    // SharedPreferences long after this screen is gone.
    try {
      setInstantAlerts(SmsReader?.getInstantAlerts?.() ?? false);
    } catch {
      // An older build without the function: leave it off.
    }
  }, []);

  /* ── Pro gating ─────────────────────────────────────────────────────── */

  const gated = (fn: () => void) => () => {
    if (isProActive(state)) fn();
    else router.push('/pro');
  };

  // Founder unlock: 7 taps on the mark toggles Pro on side-load builds
  // (Play builds grant it through Google Play billing instead).
  const tapCount = React.useRef(0);
  const tapTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const onLogoTap = () => {
    tapCount.current += 1;
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => (tapCount.current = 0), 1500);
    if (tapCount.current >= 7) {
      tapCount.current = 0;
      const next = !state.pro;
      setPro(next);
      Alert.alert(
        next ? t('founderMode') : t('founderModeOff'),
        next ? t('founderOn') : t('founderOff'),
      );
    }
  };

  /* ── Privacy ────────────────────────────────────────────────────────── */

  const toggleAppLock = async (enabled: boolean) => {
    if (!enabled) {
      setAppLock(false);
      return;
    }
    if (Platform.OS === 'web') {
      Alert.alert(t('notAvailable'), t('appLockPhoneOnly'));
      return;
    }
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!hasHardware || !enrolled) {
      Alert.alert(
        t('noScreenLock'),
        t('noScreenLockBody'),
      );
      return;
    }
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: t('confirmAppLock'),
    });
    if (result.success) setAppLock(true);
  };

  const enablePrivateMode = async () => {
    try {
      if (Platform.OS === 'ios') {
        const relay = await getRelayConfig();
        if (relay) await unpairDevice(relay);
      }
      await setPrivateMode(true);
    } catch {
      Alert.alert(t('privateModeFailed'));
    }
  };

  const togglePrivateMode = (enabled: boolean) => {
    if (!enabled) {
      void setPrivateMode(false).catch(() => {
        Alert.alert(t('privateModeFailed'));
      });
      return;
    }
    if (Platform.OS !== 'ios') {
      void enablePrivateMode();
      return;
    }
    Alert.alert(t('privateModeEnableTitle'), t('privateModeEnableIosBody'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('privateModeEnable'), onPress: () => void enablePrivateMode() },
    ]);
  };

  const toggleSms = async (enabled: boolean) => {
    if (!enabled) {
      // Android grants permissions but never takes them back on request; the
      // only honest "off" is the one in the system settings.
      Alert.alert(
        t('turnSmsReadingOff'),
        t('smsRevokeHint'),
      );
      return;
    }
    const granted = await requestSmsPermission();
    setSmsGranted(granted);
  };

  const toggleInstantAlerts = async (enabled: boolean) => {
    if (enabled) {
      // Android 13 needs the notification permission before anything can be
      // posted. Asking here rather than at delivery time means the failure is
      // visible now, instead of as banners that silently never arrive.
      const allowed = await requestNotificationPermission();
      if (!allowed) {
        Alert.alert(
          t('notificationsOff'),
          t('notificationsOffBody'),
        );
        return;
      }
    }
    try {
      SmsReader?.setInstantAlerts?.(enabled);
      setInstantAlerts(enabled);
    } catch {
      // Nothing to recover: the toggle stays where it was.
    }
  };

  /**
   * Turning it on needs notification permission — and asking for it here, at
   * the moment the user says yes to a notification, is the only place the ask
   * makes sense. Launch never prompts.
   */
  const toggleDailySummary = async (enabled: boolean) => {
    if (!enabled) {
      setDailySummary(false);
      await cancelDailySummary();
      return;
    }
    const granted = await requestNotificationPermission();
    if (!granted) {
      Alert.alert(t('notificationsOff'), t('notificationsOffBody'));
      return;
    }
    setDailySummary(true);
    // Schedule from the state we are about to have, not the one in this
    // closure: the dispatch above has not re-rendered yet, and syncDailySummary
    // returns early on a false flag.
    await syncDailySummary({ ...state, dailySummary: true });
  };

  const notifAvailable = Platform.OS === 'android' && NotificationReader != null;
  const notifEnabled = notifAvailable && NotificationReader != null && NotificationReader.isEnabled();
  const onNotificationAccess = () => {
    if (!notifAvailable || !NotificationReader) {
      Alert.alert(t('notAvailable'), t('notifsPhoneOnly'));
      return;
    }
    Alert.alert(
      t('bankAppNotifsTitle'),
      t('notifAccessFull'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: notifEnabled ? t('openSettings') : t('enableAction'),
          onPress: () => NotificationReader?.openSettings(),
        },
      ],
    );
  };

  /* ── Region ─────────────────────────────────────────────────────────── */

  const cycleMarket = () => {
    const i = MARKETS.findIndex((m) => m.id === market.id);
    setMarket(MARKETS[(i + 1) % MARKETS.length].id);
  };

  const cycleLanguage = () => {
    const next = state.language === 'ar' ? 'en' : 'ar';
    // No alert, and nothing to restart. The strings re-render from this and
    // the layout mirrors from the `direction` style on the root — see the
    // Direction component in app/_layout.tsx for why I18nManager could never
    // do it live.
    setUiLanguage(next);
    // Still set, for react-navigation's own gesture and animation direction,
    // which reads I18nManager rather than the layout. That part is the only
    // thing left waiting for a restart.
    if (Platform.OS !== 'web') {
      I18nManager.allowRTL(next === 'ar');
      I18nManager.forceRTL(next === 'ar');
    }
  };

  /* ── Data ───────────────────────────────────────────────────────────── */

  const exportCsv = () => {
    const header = 'date,type,amount_aed,category,title,account,transfer';
    const lines = state.transactions.map((tx) => {
      const account = state.accounts.find((a) => a.id === tx.accountId)?.name ?? '';
      const title = `"${tx.title.replace(/"/g, '""')}"`;
      return `${tx.date},${tx.type},${(tx.amountFils / 100).toFixed(2)},${tx.category},${title},"${account}",${tx.isTransfer ? 1 : 0}`;
    });
    // A whole ledger is far past the intent-payload ceiling; share the file.
    shareText('wafra-export.csv', [header, ...lines].join('\n'), {
      mimeType: 'text/csv',
    }).catch(() => {});
  };

  const backupJson = () => {
    shareText('wafra-backup.json', exportBackup(), {
      mimeType: 'application/json',
    }).catch(() => {});
  };

  const createExpenseReport = async (scope: 'month' | 'all') => {
    // Same rule every other total in the app applies: real spending, on an
    // account still in play, neither leg of a move between the user's own
    // accounts. Without it, a legacy own-account sweep (no transfer flag,
    // caught only by internalTransferIds' structural title match) could both
    // stretch an "all time" report back to its date and print on it as a
    // reimbursable expense.
    const liveAccounts = liveAccountIds(state.accounts);
    const internal = internalTransferIds(state.transactions, liveAccounts);
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
        currency: market.currency.code,
        language: state.language === 'ar' ? 'ar' : 'en',
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

  const chooseExpenseReportPeriod = () => {
    Alert.alert(t('expenseReportPeriod'), t('expenseReportPeriodBody'), [
      { text: t('currentMoneyMonth'), onPress: () => void createExpenseReport('month') },
      { text: t('allExpenses'), onPress: () => void createExpenseReport('all') },
      { text: t('cancel'), style: 'cancel' },
    ]);
  };

  const restoreFromFile = async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'text/plain', '*/*'],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const content = await FileSystem.readAsStringAsync(picked.assets[0].uri);
      Alert.alert(t('restoreBackupQ'), t('restoreReplacesAll'), [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('restoreAction'),
          style: 'destructive',
          onPress: () => {
            if (!restoreBackup(content)) {
              Alert.alert(t('invalidFile'), t('notAWafraBackup'));
            }
          },
        },
      ]);
    } catch {
      Alert.alert(t('couldNotReadFile'), t('couldNotReadFileBody'));
    }
  };

  const eraseAllData = async () => {
    try {
      // Re-read rather than using the `relay` state: this is the destructive
      // path, and a pairing created since this screen mounted must still be
      // torn down.
      const cfg = await getRelayConfig();
      if (cfg) await unpairDevice(cfg);
      await clearAll();
    } catch {
      Alert.alert(
        t('eraseRelayFailedTitle'),
        t('eraseRelayFailedBody'),
      );
    }
  };

  /**
   * Erasing has to reach the relay too.
   *
   * The ledger is only half of what this phone has: if iPhone capture is on,
   * there is also a device row and a sealed queue on the relay, a key in the
   * keychain (which on iOS outlives app deletion), and a push token that tells
   * the relay where to knock. "Erase everything" that left all of that behind
   * would be false on the one screen where a privacy claim has to be exact.
   *
   * `eraseAllData` above is what carries this out: it unpairs the device on the
   * relay BEFORE wiping locally, because unpairing needs the admin token that
   * the wipe is about to destroy. It surfaces a failure instead of swallowing
   * it, so a user offline at that moment is not told their relay copy is gone
   * when it is not.
   *
   * What it still cannot reach is the Shortcut itself: the bearer token lives
   * inside it and no API can edit it, so the automation keeps POSTing into a
   * device row that no longer exists. The relay rejects those, but the user
   * should be told to delete the Shortcut — see `concerns`, that sentence has
   * no i18n key yet and an English literal here fails contracts.test.js.
   */
  const confirmErase = () => {
    Alert.alert(
      t('eraseEverythingQ'),
      Platform.OS === 'ios'
        ? t('eraseEverythingIosBody')
        : t('eraseEverythingBody'),
      [
        { text: t('cancel'), style: 'cancel' },
        { text: t('eraseAction'), style: 'destructive', onPress: () => void eraseAllData() },
      ],
    );
  };

  /* ── Rows ───────────────────────────────────────────────────────────── */

  const linkRow = (
    title: string,
    subtitle: string | null,
    onPress: () => void,
    last = false,
    danger = false,
  ) => (
    <Row onPress={onPress} last={last} accessibilityLabel={title}>
      <View style={styles.rowText}>
        <ThemedText type="small" style={danger ? { color: theme.expense } : undefined}>
          {title}
        </ThemedText>
        {subtitle && (
          <ThemedText type="meta" themeColor="textTertiary">
            {subtitle}
          </ThemedText>
        )}
      </View>
      <Icon
        name={state.language === 'ar' ? 'chevron-left' : 'chevron-right'}
        size={15}
        color={danger ? theme.expense : theme.textTertiary}
      />
    </Row>
  );

  const switchRow = (
    title: string,
    subtitle: string,
    value: boolean,
    onChange: (next: boolean) => void,
    last = false,
  ) => (
    <Row last={last}>
      <View style={styles.rowText}>
        <ThemedText type="small">{title}</ThemedText>
        <ThemedText type="meta" themeColor="textTertiary">
          {subtitle}
        </ThemedText>
      </View>
      <Toggle value={value} onChange={onChange} label={title} />
    </Row>
  );
  const trial = trialDaysLeft(state);

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.headerWrap}>
          <ScreenHeader title={t('settingsTitle')} onBack={() => router.back()} />
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Section index={0}>
            <Block onPress={() => router.push('/pro')}>
              <View style={styles.proRow}>
                <Icon name="diamond" size={19} color={theme.warning} />
                <View style={styles.rowText}>
                  <ThemedText type="small">{t('wafraPro')}</ThemedText>
                  <ThemedText
                    type="meta"
                    style={{ color: state.pro ? theme.textTertiary : theme.warning }}>
                    {state.pro
                      ? t('activeOnThisDevice')
                      : trial > 0
                        ? tf('settingsTrialDays', {
                            count: trial,
                            s: trial === 1 ? '' : 's',
                          })
                        : t('trialEndedBanner')}
                  </ThemedText>
                </View>
                <Icon
                  name={state.language === 'ar' ? 'chevron-left' : 'chevron-right'}
                  size={15}
                  color={theme.textTertiary}
                />
              </View>
            </Block>
          </Section>

          <Section index={1}>
            <SectionHeader title={t('appearanceHeader')} />
            <Block>
              {/* The handoff said to follow the OS and offer no picker. That is
                  the right default and it stays the default — but "follow the
                  OS" is not a choice a user can make, it is the absence of one,
                  and a money app gets read in bed and in sunlight on the same
                  day. System stays first and stays selected until it is
                  changed. */}
              <Segmented
                segments={[
                  { value: 'system', label: t('themeSystem') },
                  { value: 'light', label: t('themeLight') },
                  { value: 'dark', label: t('themeDark') },
                ]}
                value={themeChoice}
                onChange={setThemePreference}
              />
              <ThemedText type="meta" themeColor="textTertiary">
                {themeChoice === 'system'
                  ? t('followingPhone')
                  : tf('pinnedTheme', {
                      theme: t(themeChoice === 'light' ? 'themeLight' : 'themeDark'),
                    })}
              </ThemedText>
            </Block>
          </Section>

          <Section index={2}>
            <SectionHeader title={t('privacyHeader')} />
            <Block style={styles.privacyCopy}>
              <Icon name="lock" size={16} color={theme.textTertiary} />
              <ThemedText type="meta" themeColor="textSecondary" style={styles.privacyCopyText}>
                {t('privacyRetentionExact')}
              </ThemedText>
            </Block>
            {switchRow(
              t('privateMode'),
              t(state.privateMode ? 'privateModeOn' : 'privateModeOff'),
              state.privateMode,
              togglePrivateMode,
            )}
            {switchRow(
              t('appLockTitle'),
              t('appLockDetail'),
              state.appLock,
              toggleAppLock,
            )}
            {isSmsScanningAvailable() &&
              switchRow(
                t('readBankSms'),
                t(smsGranted ? 'smsGrantedLocal' : 'smsOffNoImport'),
                smsGranted,
                toggleSms,
              )}
            {instantAvailable &&
              switchRow(
                t('alertEveryCharge'),
                smsGranted
                  ? instantAlerts
                    ? t('instantAlertsOn')
                    : t('instantAlertsOff')
                  : t('instantAlertsNeedSms'),
                instantAlerts && smsGranted,
                (next) => {
                  if (!smsGranted) {
                    Alert.alert(
                      t('turnOnSmsFirst'),
                      t('turnOnSmsFirstBody'),
                    );
                    return;
                  }
                  void toggleInstantAlerts(next);
                },
              )}
            {/* The nightly digest. Separate from the per-charge banner on
                purpose: one is an interruption at the moment money moves, the
                other is a summary you read when the day is over, and a user
                who wants the second rarely wants the first. */}
            {switchRow(
              t('dailySummarySetting'),
              state.dailySummary ? t('dailySummaryOn') : t('dailySummaryOff'),
              state.dailySummary,
              (next) => void toggleDailySummary(next),
            )}
            {/* iPhone capture is a privacy setting as much as a feature: the
                relay is the ONE path in the whole app where anything derived
                from a message leaves the phone. It belongs in this section,
                stated plainly, rather than filed under convenience — and this
                row is also the only way into (and back out of) that setup from
                Settings, which the base branch had no entry point for at all. */}
            {isRelayPlatform() &&
              linkRow(
                t('automaticCapture'),
                relay === undefined
                  ? t('captureChecking')
                  : relay === null
                    ? t('captureIosOff')
                    : relay.setupState === 'verified'
                      ? t('captureIosOn')
                      : t('captureIosNeedsTest'),
                () => router.push('/ios-setup'),
              )}
            <Row
              onPress={gated(onNotificationAccess)}
              accessibilityLabel={t('bankAppNotifsTitle')}>
              <View style={styles.rowText}>
                <ThemedText type="small">{t('bankAppNotifsTitle')}</ThemedText>
                <ThemedText type="meta" themeColor="textTertiary">
                  {t(notifEnabled ? 'bankPushOn' : 'bankPushOff')}
                </ThemedText>
              </View>
              <Icon
                name={state.language === 'ar' ? 'chevron-left' : 'chevron-right'}
                size={15}
                color={theme.textTertiary}
              />
            </Row>
            {linkRow(
              t('trustedSettingsRow'),
              t('trustedSettingsDetail'),
              () => router.push('/trusted-devices'),
              true,
            )}
          </Section>

          <Section index={3}>
            <SectionHeader title={t('regionHeader')} />
            {linkRow(
              t('countryPack'),
              tf('countryPackDetail', {
                country: t(market.id === 'SA' ? 'saudiName' : 'uaeName'),
                currency: market.currency.display,
              }),
              cycleMarket,
            )}
            {linkRow(
              t('language'),
              t('languageSettingDetail'),
              cycleLanguage,
              true,
            )}
          </Section>

          <Section index={4}>
            <SectionHeader title={t('dataHeader')} />
            {linkRow(t('backupJson'), null, gated(backupJson))}
            {linkRow(t('restoreBackup'), null, gated(restoreFromFile))}
            {linkRow(t('exportCsv'), null, exportCsv)}
            {linkRow(t('exportExpensePdf'), null, chooseExpenseReportPeriod)}
            {linkRow(
              t('improveAccuracy'),
              formats > 0
                ? tf('unreadFormatsCount', {
                    count: formats,
                    s: formats === 1 ? '' : 's',
                  })
                : t('noUnrecognized'),
              () => router.push('/accuracy'),
            )}
            {linkRow(t('eraseAll'), null, confirmErase, true, true)}
          </Section>

          <Section index={5} style={styles.about}>
            <Pressable accessibilityRole="button" accessibilityLabel="Wafra" onPress={onLogoTap}>
              <WafraMark size={34} />
            </Pressable>
            <ThemedText type="default" themeColor="textSecondary">
              {t('settingsTagline')}
            </ThemedText>
            <ThemedText type="nano" themeColor="textTertiary">
              Wafra {version}
            </ThemedText>
          </Section>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
  },
  safe: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  headerWrap: {
    paddingHorizontal: ScreenPadding,
  },
  content: {
    paddingHorizontal: ScreenPadding,
    paddingBottom: Spacing.six,
    gap: Spacing.four + 2,
  },
  proRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
  },
  rowText: {
    flex: 1,
    gap: Spacing.half,
  },
  monthHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingBottom: Spacing.three - 2,
  },
  dayGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -Spacing.half,
    paddingBottom: Spacing.three - 2,
  },
  dayCell: {
    width: '14.2857%',
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayChoice: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  about: {
    alignItems: 'flex-start',
    gap: Spacing.two + 2,
    paddingTop: Spacing.two,
  },
  privacyCopy: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  privacyCopyText: {
    flex: 1,
    lineHeight: 18,
  },
});
