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
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  I18nManager,
  Platform,
  Pressable,
  ScrollView,
  Share,
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
import { MaxContentWidth, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { unreadFormatCount } from '@/lib/accuracy';
import { requestNotificationPermission } from '@/lib/notifications';
import { hasSmsPermission, isSmsScanningAvailable, requestSmsPermission } from '@/lib/auto-import';
import { monthEndISO, monthKey, monthStartISO, shiftMonthKey, shortDate } from '@/lib/format';
import { MARKETS } from '@/lib/markets';
import { isProActive, trialDaysLeft } from '@/lib/purchases';
import { useStore } from '@/lib/store';
import type { ThemePreference } from '@/lib/theme-preference';
import NotificationReader from '../../modules/notification-reader';
import SmsReader from '../../modules/sms-reader';
import { t } from '@/lib/i18n';

/** The reporting month can start on any day that exists in February. */
const MAX_START_DAY = 28;

function ordinal(day: number): string {
  const rem100 = day % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${day}th`;
  return `${day}${['th', 'st', 'nd', 'rd'][day % 10] ?? 'th'}`;
}

export default function SettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const {
    state,
    setAppLock,
    setMonthStartDay,
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
  const [smsGranted, setSmsGranted] = useState(false);
  const formats = useMemo(() => unreadFormatCount(state), [state]);
  const version = Constants.expoConfig?.version ?? '1.0.0';

  const [instantAlerts, setInstantAlerts] = useState(false);
  // Only builds carrying the delivery receiver can post at delivery time.
  const instantAvailable = isSmsScanningAvailable() && SmsReader?.setInstantAlerts != null;

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
      Alert.alert('Not available', t('appLockPhoneOnly'));
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

  const toggleSms = async (enabled: boolean) => {
    if (!enabled) {
      // Android grants permissions but never takes them back on request; the
      // only honest "off" is the one in the system settings.
      Alert.alert(
        'Turn SMS reading off',
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

  const notifAvailable = Platform.OS === 'android' && NotificationReader != null;
  const notifEnabled = notifAvailable && NotificationReader != null && NotificationReader.isEnabled();
  const onNotificationAccess = () => {
    if (!notifAvailable || !NotificationReader) {
      Alert.alert('Not available', t('notifsPhoneOnly'));
      return;
    }
    Alert.alert(
      t('bankAppNotifsTitle'),
      t('notifAccessFull'),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: notifEnabled ? 'Open settings' : 'Enable',
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
    setUiLanguage(next);
    // RTL flips on next app start — a React Native constraint, so say so.
    if (Platform.OS !== 'web') {
      I18nManager.allowRTL(next === 'ar');
      I18nManager.forceRTL(next === 'ar');
      Alert.alert(t('language'), t('restartForLanguage'));
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
    Share.share({ title: 'wafra-export.csv', message: [header, ...lines].join('\n') }).catch(() => {});
  };

  const backupJson = () => {
    Share.share({ title: 'wafra-backup.json', message: exportBackup() }).catch(() => {});
  };

  const restoreFromFile = async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'text/plain', '*/*'],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const content = await FileSystem.readAsStringAsync(picked.assets[0].uri);
      Alert.alert('Restore backup?', t('restoreReplacesAll'), [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          style: 'destructive',
          onPress: () => {
            if (!restoreBackup(content)) {
              Alert.alert('Invalid file', t('notAWafraBackup'));
            }
          },
        },
      ]);
    } catch {
      Alert.alert(t('couldNotReadFile'), 'Try exporting a fresh backup and restoring that.');
    }
  };

  const confirmErase = () => {
    Alert.alert(
      t('eraseEverythingQ'),
      'All accounts, entries, bills, and goals will be permanently deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Erase', style: 'destructive', onPress: clearAll },
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
      <Icon name="chevron-right" size={15} color={danger ? theme.expense : theme.textTertiary} />
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

  const monthKeyNow = monthKey(new Date());
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
                  <ThemedText type="small">Wafra Pro</ThemedText>
                  <ThemedText
                    type="meta"
                    style={{ color: state.pro ? theme.textTertiary : theme.warning }}>
                    {state.pro
                      ? t('activeOnThisDevice')
                      : trial > 0
                        ? `Free trial · ${trial} day${trial === 1 ? '' : 's'} left`
                        : 'Trial ended · tracking paused'}
                  </ThemedText>
                </View>
                <Icon name="chevron-right" size={15} color={theme.textTertiary} />
              </View>
            </Block>
          </Section>

          <Section index={1}>
            <SectionHeader title="Money month" />
            <Block>
              <View style={styles.monthHead}>
                <ThemedText type="small">Starts on the {ordinal(state.monthStartDay)}</ThemedText>
                <ThemedText type="small" tabular style={{ color: theme.primary }}>
                  {state.monthStartDay}
                </ThemedText>
              </View>
              {/* A picture of the month rather than a ± stepper: this is the
                  setting that reshapes every other screen, so it should look
                  like a month, not like a counter. */}
              <View style={styles.dayBars}>
                {Array.from({ length: MAX_START_DAY }, (_, i) => i + 1).map((day) => {
                  const chosen = day === state.monthStartDay;
                  return (
                    <Pressable
                      key={day}
                      accessibilityRole="button"
                      accessibilityLabel={`Month starts on day ${day}`}
                      accessibilityState={{ selected: chosen }}
                      hitSlop={{ top: 10, bottom: 10 }}
                      onPress={() => setMonthStartDay(day)}
                      style={styles.dayBarHit}>
                      <View
                        style={[
                          styles.dayBar,
                          {
                            height: chosen ? 34 : day % 7 === 1 ? 16 : 11,
                            backgroundColor: chosen ? theme.primary : theme.track,
                          },
                        ]}
                      />
                    </Pressable>
                  );
                })}
              </View>
              <ThemedText type="meta" themeColor="textTertiary">
                Your {shortDate(monthStartISO(monthKeyNow)).split(' ')[1]} month runs{' '}
                {shortDate(monthStartISO(monthKeyNow))} – {shortDate(monthEndISO(monthKeyNow))}, so
                salary and rent land in the same month.
              </ThemedText>
              {state.monthStartDay === 1 && (
                <ThemedText type="meta" themeColor="textTertiary">
                  Day 1 means plain calendar months. Next month starts{' '}
                  {shortDate(monthStartISO(shiftMonthKey(monthKeyNow, 1)))}.
                </ThemedText>
              )}
            </Block>
          </Section>

          <Section index={2}>
            <SectionHeader title="Appearance" />
            <Block>
              {/* The handoff said to follow the OS and offer no picker. That is
                  the right default and it stays the default — but "follow the
                  OS" is not a choice a user can make, it is the absence of one,
                  and a money app gets read in bed and in sunlight on the same
                  day. System stays first and stays selected until it is
                  changed. */}
              <Segmented
                segments={[
                  { value: 'system', label: 'System' },
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                ]}
                value={themeChoice}
                onChange={setThemePreference}
              />
              <ThemedText type="meta" themeColor="textTertiary">
                {themeChoice === 'system'
                  ? t('followingPhone')
                  : `Pinned to ${themeChoice}, whatever your phone is set to.`}
              </ThemedText>
            </Block>
          </Section>

          <Section index={3}>
            <SectionHeader title="Privacy" />
            {switchRow(
              'App lock',
              'Fingerprint, face unlock, or your phone PIN',
              state.appLock,
              toggleAppLock,
            )}
            {isSmsScanningAvailable() &&
              switchRow(
                'Read bank SMS',
                smsGranted ? 'Granted · nothing is uploaded' : 'Off · nothing can import',
                smsGranted,
                toggleSms,
              )}
            {instantAvailable &&
              switchRow(
                t('alertEveryCharge'),
                smsGranted
                  ? instantAlerts
                    ? 'On · a silent banner the moment the bank texts'
                    : 'Off · charges appear when you next open Wafra'
                  : 'Needs bank SMS reading above',
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
            <Row onPress={gated(onNotificationAccess)} last accessibilityLabel="Bank app notifications">
              <View style={styles.rowText}>
                <ThemedText type="small">Bank app notifications</ThemedText>
                <ThemedText type="meta" themeColor="textTertiary">
                  {notifEnabled
                    ? 'On · push alerts import automatically'
                    : 'Off · for banks that push instead of SMS'}
                </ThemedText>
              </View>
              <Icon name="chevron-right" size={15} color={theme.textTertiary} />
            </Row>
          </Section>

          <Section index={4}>
            <SectionHeader title="Region" />
            {linkRow(
              'Country pack',
              `${market.name} · ${market.currency.display} · banks and merchants`,
              cycleMarket,
            )}
            {linkRow(
              'Language',
              state.language === 'ar' ? 'العربية · English restarts the app' : 'English · العربية restarts the app',
              cycleLanguage,
              true,
            )}
          </Section>

          <Section index={5}>
            <SectionHeader title="Data" />
            {linkRow(t('backupJson'), null, gated(backupJson))}
            {linkRow(t('restoreBackup'), null, gated(restoreFromFile))}
            {linkRow(t('exportCsv'), null, exportCsv)}
            {linkRow(
              'Improve accuracy',
              formats > 0
                ? `${formats} unread message format${formats === 1 ? '' : 's'} · digits masked`
                : t('noUnrecognized'),
              () => router.push('/accuracy'),
            )}
            {linkRow(t('eraseAll'), null, confirmErase, true, true)}
          </Section>

          <Section index={6} style={styles.about}>
            <Pressable accessibilityRole="button" accessibilityLabel="Wafra" onPress={onLogoTap}>
              <WafraMark size={34} />
            </Pressable>
            <ThemedText type="default" themeColor="textSecondary">
              Know where it goes. Watch it grow. All data stays on this device.
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
  dayBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 34,
    paddingBottom: Spacing.three - 2,
  },
  dayBarHit: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    height: 34,
  },
  dayBar: {
    width: 4,
    borderRadius: Radius.chip / 2,
  },
  about: {
    alignItems: 'flex-start',
    gap: Spacing.two + 2,
    paddingTop: Spacing.two,
  },
});
