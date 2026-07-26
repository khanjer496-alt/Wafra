import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as LocalAuthentication from 'expo-local-authentication';
import { useRouter } from 'expo-router';
import React from 'react';
import { Alert, I18nManager, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Icon } from '@/components/ui/icon';
import { WafraLogo } from '@/components/wafra-logo';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/lib/i18n';
import { MARKETS } from '@/lib/markets';
import { isProActive, trialDaysLeft } from '@/lib/purchases';
import { useStore } from '@/lib/store';
import NotificationReader from '../../modules/notification-reader';

export default function SettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { state, setAppLock, setMonthStartDay, setPro, setMarket, setUiLanguage, exportBackup, restoreBackup, loadDemoData, clearAll } =
    useStore();

  const market = MARKETS.find((m) => m.id === state.marketId) ?? MARKETS[0];
  const cycleLanguage = () => {
    const next = state.language === 'ar' ? 'en' : 'ar';
    setUiLanguage(next);
    // RTL flips on next app start (a React Native constraint).
    if (Platform.OS !== 'web') {
      I18nManager.allowRTL(next === 'ar');
      I18nManager.forceRTL(next === 'ar');
      Alert.alert(t('language'), t('restartForLanguage'));
    }
  };
  const cycleMarket = () => {
    const i = MARKETS.findIndex((m) => m.id === market.id);
    const next = MARKETS[(i + 1) % MARKETS.length];
    setMarket(next.id);
  };

  // Pro gating: locked features route to the paywall instead of running.
  // Everything is unlocked during the free trial.
  const gated = (fn: () => void) => () => {
    if (isProActive(state)) fn();
    else router.push('/pro');
  };

  // Founder unlock: 7 taps on the logo toggles Pro on side-load builds
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
      Alert.alert(next ? 'Founder mode' : 'Founder mode off',
        next ? 'Wafra Pro unlocked on this device.' : 'Wafra Pro disabled on this device.');
    }
  };

  const notifAvailable = Platform.OS === 'android' && NotificationReader != null;
  const notifEnabled = notifAvailable && NotificationReader != null && NotificationReader.isEnabled();
  const onNotificationAccess = () => {
    if (!notifAvailable || !NotificationReader) {
      Alert.alert('Not available', 'Bank app notifications work on the phone app only.');
      return;
    }
    Alert.alert(
      'Bank app notifications',
      'Some banks send push notifications instead of SMS. Grant Wafra notification access and ' +
        'money alerts import automatically. Only alerts that mention an amount are kept, and ' +
        'they never leave this phone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: notifEnabled ? 'Open settings' : 'Enable',
          onPress: () => NotificationReader?.openSettings(),
        },
      ],
    );
  };

  const toggleAppLock = async (enabled: boolean) => {
    if (!enabled) {
      setAppLock(false);
      return;
    }
    if (Platform.OS === 'web') {
      Alert.alert('Not available', 'App lock works on the phone app only.');
      return;
    }
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!hasHardware || !enrolled) {
      Alert.alert(
        'No screen lock set up',
        'Set up a fingerprint, face unlock, or PIN in your phone settings first.',
      );
      return;
    }
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Confirm to enable app lock',
    });
    if (result.success) setAppLock(true);
  };

  const exportCsv = () => {
    const header = 'date,type,amount_aed,category,title,account,transfer';
    const lines = state.transactions.map((t) => {
      const account = state.accounts.find((a) => a.id === t.accountId)?.name ?? '';
      const title = `"${t.title.replace(/"/g, '""')}"`;
      return `${t.date},${t.type},${(t.amountFils / 100).toFixed(2)},${t.category},${title},"${account}",${t.isTransfer ? 1 : 0}`;
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
      Alert.alert('Restore backup?', 'This replaces everything currently in the app.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          style: 'destructive',
          onPress: () => {
            if (!restoreBackup(content)) {
              Alert.alert('Invalid file', 'That does not look like a Wafra backup.');
            }
          },
        },
      ]);
    } catch {
      Alert.alert('Could not read file', 'Try exporting a fresh backup and restoring that.');
    }
  };

  const confirmReset = (demo: boolean) => {
    Alert.alert(
      demo ? 'Load demo data?' : 'Erase everything?',
      demo
        ? 'This replaces your current data with the sample UAE dataset.'
        : 'All accounts, transactions, bills, and goals will be permanently deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: demo ? 'Load demo' : 'Erase',
          style: demo ? 'default' : 'destructive',
          onPress: demo ? loadDemoData : clearAll,
        },
      ],
    );
  };

  const row = (
    icon: React.ComponentProps<typeof Icon>['name'],
    label: string,
    onPress: () => void,
    danger = false,
  ) => (
    <Pressable style={styles.settingRow} onPress={onPress}>
      <View style={styles.rowLeft}>
        <Icon name={icon} size={15} color={danger ? theme.expense : theme.textSecondary} />
        <ThemedText type="small" style={danger ? { color: theme.expense } : undefined}>
          {label}
        </ThemedText>
      </View>
      <Icon name="chevron-right" size={16} color={theme.textSecondary} />
    </Pressable>
  );

  const divider = <View style={[styles.divider, { backgroundColor: theme.cardBorder }]} />;

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            style={[styles.backBtn, { backgroundColor: theme.backgroundSelected }]}>
            <Icon name="chevron-left" size={18} color={theme.text} />
          </Pressable>
          <ThemedText type="heading">{t('settingsTitle')}</ThemedText>
          <View style={styles.backBtn} />
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.section}>
            <ThemedText type="micro" themeColor="textSecondary">{t('featuresHeader')}</ThemedText>
            <View>
              <Pressable onPress={() => router.push('/pro')} style={styles.settingRow}>
                <View style={styles.rowLeft}>
                  <Icon name="diamond" size={15} color={theme.gold} />
                  <View>
                    <ThemedText type="small">{t('wafraPro')}</ThemedText>
                    <ThemedText type="micro" themeColor="textSecondary">
                      {state.pro
                        ? t('proActive')
                        : trialDaysLeft(state) > 0
                          ? `Free trial · ${trialDaysLeft(state)} day${trialDaysLeft(state) === 1 ? '' : 's'} left`
                          : 'Trial ended · tracking paused'}
                    </ThemedText>
                  </View>
                </View>
                <Icon name="chevron-right" size={15} color={theme.textSecondary} />
              </Pressable>
              {divider}
              {row('calendar', t('billsAndSubs'), () => router.push('/bills'))}
              {divider}
              {row('mail', t('importFromSms'), () => router.push('/import-sms'))}
              {divider}
              <Pressable onPress={gated(onNotificationAccess)} style={styles.settingRow}>
                <View style={styles.rowLeft}>
                  <Icon name="mail" size={15} color={theme.textSecondary} />
                  <View>
                    <ThemedText type="small">{t('bankAppNotifs')}</ThemedText>
                    <ThemedText type="micro" themeColor="textSecondary">
                      {notifEnabled
                        ? 'On · push alerts import automatically'
                        : 'Off · for banks that push instead of SMS'}
                    </ThemedText>
                  </View>
                </View>
                <Icon name="chevron-right" size={15} color={theme.textSecondary} />
              </Pressable>
              {divider}
              <View style={styles.settingRow}>
                <View style={styles.rowLeft}>
                  <Icon name="lock" size={15} color={theme.textSecondary} />
                  <ThemedText type="small">{t('appLock')}</ThemedText>
                </View>
                <Switch
                  value={state.appLock}
                  onValueChange={toggleAppLock}
                  trackColor={{ true: theme.primary, false: theme.track }}
                  thumbColor={theme.background}
                />
              </View>
              {divider}
              {/* Country pack: currency, banks, and merchant vocabulary. */}
              <Pressable onPress={cycleMarket} style={styles.settingRow}>
                <View style={styles.rowLeft}>
                  <Icon name="bank" size={15} color={theme.textSecondary} />
                  <View>
                    <ThemedText type="small">{t('country')}</ThemedText>
                    <ThemedText type="micro" themeColor="textSecondary">
                      {market.flag} {market.name} · {market.currency.code} · {t('tapToChange')}
                    </ThemedText>
                  </View>
                </View>
                <Icon name="chevron-right" size={15} color={theme.textSecondary} />
              </Pressable>
              {divider}
              <Pressable onPress={cycleLanguage} style={styles.settingRow}>
                <View style={styles.rowLeft}>
                  <Icon name="receipt" size={15} color={theme.textSecondary} />
                  <View>
                    <ThemedText type="small">{t('language')}</ThemedText>
                    <ThemedText type="micro" themeColor="textSecondary">
                      {state.language === 'ar' ? 'العربية' : 'English'} · {t('tapToChange')}
                    </ThemedText>
                  </View>
                </View>
                <Icon name="chevron-right" size={15} color={theme.textSecondary} />
              </Pressable>
              {divider}
              {/* Salary-day month start: "my month" begins when the salary lands. */}
              <View style={styles.settingRow}>
                <View style={styles.rowLeft}>
                  <Icon name="calendar" size={15} color={theme.textSecondary} />
                  <View>
                    <ThemedText type="small">{t('monthStartsOn')}</ThemedText>
                    <ThemedText type="micro" themeColor="textSecondary">
                      {state.monthStartDay > 1
                        ? `Your money month runs day ${state.monthStartDay} to day ${state.monthStartDay - 1}`
                        : t('calendarMonths')}
                    </ThemedText>
                  </View>
                </View>
                <View style={styles.stepper}>
                  <Pressable
                    onPress={gated(() => setMonthStartDay(Math.max(1, state.monthStartDay - 1)))}
                    style={[styles.stepBtn, { backgroundColor: theme.backgroundSelected }]}>
                    <ThemedText type="smallBold">−</ThemedText>
                  </Pressable>
                  <ThemedText type="smallBold" tabular style={styles.stepValue}>
                    {state.monthStartDay}
                  </ThemedText>
                  <Pressable
                    onPress={gated(() => setMonthStartDay(Math.min(28, state.monthStartDay + 1)))}
                    style={[styles.stepBtn, { backgroundColor: theme.backgroundSelected }]}>
                    <ThemedText type="smallBold">+</ThemedText>
                  </Pressable>
                </View>
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <ThemedText type="micro" themeColor="textSecondary">{t('dataHeader')}</ThemedText>
            <View>
              {row('download', t('backupJson'), gated(backupJson))}
              {divider}
              {row('upload', t('restoreBackup'), gated(restoreFromFile))}
              {divider}
              {row('receipt', t('exportCsv'), exportCsv)}
              {divider}
              {row('search', t('improveAccuracy'), () => router.push('/accuracy'))}
              {divider}
              {row('spark', t('loadDemo'), () => confirmReset(true))}
              {divider}
              {row('trash', t('eraseAll'), () => confirmReset(false), true)}
            </View>
          </View>

          <View style={styles.about}>
            <Pressable onPress={onLogoTap}>
              <WafraLogo markSize={36} />
            </Pressable>
            <ThemedText type="small" themeColor="textSecondary" style={styles.aboutText}>
              Know where it goes. Watch it grow. All data stays on this device.
            </ThemedText>
          </View>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: Spacing.three,
    paddingBottom: Spacing.six,
    gap: Spacing.four,
  },
  section: {
    gap: Spacing.two,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: {
    minWidth: 22,
    textAlign: 'center',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.two + 3,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  about: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.four,
  },
  aboutText: {
    textAlign: 'center',
    maxWidth: 280,
  },
});
