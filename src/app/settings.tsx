/**
 * Settings.
 *
 * Grouped by what a row does TO YOU, not by what it does inside. The two
 * alerts you might have come here to silence are at the top; then what the
 * app is allowed to read; then the ledger chores and the exports; and the one
 * irreversible action stands alone at the bottom, with nothing above it to
 * mis-tap into.
 *
 * Two rules hold the screen together, and both were broken before:
 *
 * 1. A chevron means "a choice opens" — a screen, or a picker. It never means
 *    "tapping this has already changed the setting". Country and Language
 *    both used to be one-tap cycles wearing that chevron.
 * 2. A row that leads to the paywall says so before it is tapped. Back up and
 *    Restore bounced a free user to /pro while Export CSV and Expense report,
 *    one hairline below them, simply worked.
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
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ChoiceSheet } from '@/components/ui/choice-sheet';
import { Button, Segmented, Toggle } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { Block, Row, ScreenHeader, Section, SectionHeader } from '@/components/ui/layout';
import { WafraMark } from '@/components/wafra-logo';
import { MaxContentWidth, ScreenPadding, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { noFormatsReason, unreadFormatCount } from '@/lib/accuracy';
import { uncategorisedMerchants } from '@/lib/uncategorised';
import {
  clearBackgroundRelayRows,
  getChargeAlertPreference,
  setChargeAlertsEnabled,
} from '@/lib/background-relay';
import {
  cancelDailySummary,
  requestNotificationPermission,
  syncDailySummary,
} from '@/lib/notifications';
import { hasSmsPermission, isSmsScanningAvailable, requestSmsPermission } from '@/lib/auto-import';
import { tapped } from '@/lib/haptics';
import { monthEndISO, monthKey, monthStartISO } from '@/lib/format';
import { internalTransferIds, isSpending, liveAccountIds } from '@/lib/ledger';
import { canSelectMarket, ledgerCurrencyDisplay, MARKETS } from '@/lib/markets';
import { isProActive, trialDaysLeft } from '@/lib/purchases';
// Deliberately this branch's relay client, not the other one's isRelaySupported/
// unpairRelay/stopRelayWake trio: the two relay clients speak incompatible wire
// contracts (four scoped tokens here vs one there), and mixing their entry
// points compiles on a good day and 401s on the device.
import {
  getRelayConfig,
  isRelayPlatform,
  RelayError,
  unpairDevice,
  type RelayConfig,
} from '@/lib/relay';
import { promptDeleteShortcut, shortcutCleanupApplies } from '@/lib/shortcut-cleanup';
import {
  buildExpenseReportHtml,
  reportExpenses,
} from '@/lib/reimbursement-report';
import { useStore } from '@/lib/store';
import type { ThemePreference } from '@/lib/theme-preference';
import NotificationReader from '../../modules/notification-reader';
import SmsReader from '../../modules/sms-reader';
import { t, tf } from '@/lib/i18n';

/**
 * A language is named in its own language, in both languages: an Arabic
 * speaker looking for Arabic looks for "العربية", not for a translation of
 * the word "Arabic". These two are the same string in every locale, which is
 * why they are the only user-visible text on this screen that does not go
 * through t().
 */
const LANGUAGE_NAMES = { en: 'English', ar: 'العربية' } as const;

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
  const language: 'en' | 'ar' = state.language === 'ar' ? 'ar' : 'en';
  // `undefined` is "not read yet" and `null` is "read, and there is no pairing".
  // Collapsing the two would print "not connected" for a frame to a user whose
  // capture is in fact running, on the screen where they came to check.
  const [relay, setRelay] = useState<RelayConfig | null | undefined>(
    isRelayPlatform() ? undefined : null,
  );
  const [smsGranted, setSmsGranted] = useState(false);
  const formats = useMemo(() => unreadFormatCount(state), [state]);
  // Home only offers the categorise prompt above a floor, so a user who sorts
  // their way down to two merchants loses the only route to the screen with
  // the job half done. This row is the permanent way in, and it stays visible
  // at zero to say so.
  const unsorted = useMemo(() => uncategorisedMerchants(state), [state]);
  // A count of 0 is not a verdict on every device — see noFormatsReason().
  const noFormats = noFormatsReason({
    relayPlatform: isRelayPlatform(),
    privateMode: state.privateMode,
  });
  const version = Constants.expoConfig?.version ?? '1.0.0';

  const [instantAlerts, setInstantAlerts] = useState(false);
  // Only builds carrying the delivery receiver can post at delivery time.
  const instantAvailable = isSmsScanningAvailable() && SmsReader?.setInstantAlerts != null;
  // The per-charge alert exists on both platforms by two different mechanisms
  // and on the web by neither, so the notification group's closing hairline
  // has to be drawn under whichever row is actually last.
  const chargeAlertsAvailable = instantAvailable || isRelayPlatform();

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

  const proActive = isProActive(state);

  const gated = (fn: () => void) => () => {
    if (proActive) fn();
    else router.push('/pro');
  };

  /**
   * Founder unlock: 7 taps toggles Pro on side-load builds (Play builds grant
   * it through Google Play billing instead).
   *
   * On the VERSION ROW, which is where pro.tsx says it lives — "seven taps on
   * the version row in Settings, which nobody reaches by accident". It had
   * drifted onto the Wafra mark, the largest and most idly-tapped thing in the
   * section, announced to VoiceOver as a plain button that does nothing six
   * times out of seven. pro.tsx rejected a long-press on its own icon for
   * being "an ordinary thing to try"; poking a logo is no less ordinary.
   */
  const tapCount = React.useRef(0);
  const tapTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const onVersionTap = () => {
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
      // only honest "off" is the one in the system settings. So say where it
      // is AND open it — the alert used to type out "Settings → Apps → Wafra →
      // Permissions → SMS" and then offer a single OK, leaving the user to
      // walk there by hand from a screen that could have taken them.
      Alert.alert(t('turnSmsReadingOff'), t('smsRevokeHint'), [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('openPhoneSettings'),
          onPress: () => {
            void Linking.openSettings().catch(() => {});
          },
        },
      ]);
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

  /**
   * Defaults ON, unlike Android's per-charge banner, and the asymmetry is
   * deliberate: Android's is a heads-up over whatever is on screen, while this
   * one is posted passively on a device that iOS setup only asked provisional
   * authorization for — it lands quietly in Notification Center. Only an
   * explicit stored `false` turns it off, so a user who never opens this screen
   * still gets the alerts the relay was set up to deliver.
   */
  const [chargeAlerts, setChargeAlerts] = useState(true);
  /** Which region picker is open, if any. Only one can be. */
  const [regionSheet, setRegionSheet] = useState<'country' | 'language' | null>(null);
  const [reportScopeSheet, setReportScopeSheet] = useState(false);
  useEffect(() => {
    let current = true;
    void getChargeAlertPreference()
      .then((p) => {
        if (current) setChargeAlerts(p.enabled);
      })
      .catch(() => {
        // The stored preference is unreadable; the switch stays at its default
        // rather than claiming the feature is off.
      });
    return () => {
      current = false;
    };
  }, []);
  const toggleChargeAlerts = async (enabled: boolean) => {
    setChargeAlerts(enabled);
    try {
      await setChargeAlertsEnabled(enabled);
    } catch {
      // Put the switch back where it was rather than showing a state the
      // device did not actually store.
      setChargeAlerts(!enabled);
    }
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

  const marketName = (id: string) => t(id === 'SA' ? 'saudiName' : 'uaeName');

  /**
   * The country pack is a choice, not a cycle.
   *
   * It used to be one tap on a chevron row, advancing to the next pack in the
   * list modulo its length: no picker, no confirmation, no undo. Nothing
   * converts the ledger when it moves, so the same stored 125050 fils printed
   * "AED 1,250.50" before the tap and "SAR 1,250.50" after it — every figure
   * in the app relabelled in a currency the money was never in. It also swaps
   * the bank and merchant registry the parser matches senders against. A
   * thumb landing short of Language was enough to do all of that, and nothing
   * on screen said so.
   *
   * Now the row opens the list and the user names the country they mean.
   *
   * The list is a ChoiceSheet rather than an alert. `Alert.alert` cannot be
   * the control here on either platform this app actually ships to plus the
   * one it exports to: Android draws at most three alert buttons — the two
   * packs plus Cancel, already at the ceiling — and on react-native-web
   * `Alert.alert` is an empty method, so the row did nothing at all.
   */
  /**
   * A pack denominated differently from money already recorded is SHOWN and
   * refused, with the reason on the row.
   *
   * `setMarket` answers such a request by changing nothing at all — the right
   * answer, because there is no rate that could convert a ledger of
   * hand-entered amounts, bill totals and statement balances, and a plausible
   * wrong number is worse than an honest label. But a silent no-op is the
   * same class of defect as the alert that never opened: the user taps, the
   * app does nothing, and nothing says why. So the constraint is stated
   * before the tap rather than swallowed after it.
   *
   * Shown rather than omitted: a user hunting for Saudi Arabia in a list that
   * does not contain it concludes the app cannot do Saudi Arabia at all.
   */
  const marketChoices = MARKETS.map((m) => {
    const allowed = canSelectMarket(m.id);
    return {
      value: m.id,
      label: marketName(m.id),
      detail: allowed
        ? m.currency.display
        : tf('marketPinned', { currency: ledgerCurrencyDisplay() }),
      disabled: !allowed,
    };
  });

  const applyLanguage = (next: 'en' | 'ar') => {
    if (next === language) return;
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

  /**
   * Same disease as the country cycle, and worse consequences: one tap used to
   * flip the whole app to Arabic and mirror the layout, and the row's subtitle
   * ("English · العربية is available instantly") described availability rather
   * than saying which language was on. A user who mis-tapped had to find the
   * same row again in a mirrored UI they could not read. Naming both languages
   * up front costs one extra tap and removes that trap.
   */
  const languageChoices = (['en', 'ar'] as const).map((code) => ({
    value: code,
    label: LANGUAGE_NAMES[code],
  }));

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

  /**
   * Same reason as Country and Language: an alert is not a picker. This one
   * chooses what goes in the PDF, so getting it silently wrong — or, on web,
   * getting nothing at all — produces a report about the wrong months.
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
    // Re-read rather than using the `relay` state: this is the destructive
    // path, and a pairing created since this screen mounted must still be
    // torn down.
    let cfg: RelayConfig | null = null;
    try {
      cfg = await getRelayConfig();
    } catch {
      // Defensive: getRelayConfig() swallows its own Keychain errors and
      // answers null today. If that ever changes, wiping locally on the way
      // past would leave a live device row and a live ingest token behind
      // while telling the user everything is gone. Stop instead.
      //
      // The null it returns for a Keychain it could not read is still
      // indistinguishable from "never paired" — see the note in relay.ts.
      Alert.alert(t('eraseRelayFailedTitle'), t('eraseRelayFailedBody'));
      return;
    }

    if (cfg) {
      try {
        await unpairDevice(cfg);
      } catch (error) {
        // Three failures, three different truths. The old single catch told
        // every one of them "connect to the internet and try again", which for
        // an owner whose vault still has other devices is advice that can
        // never work: the relay answers 409 `last_owner` forever, and the
        // ledger was silently left intact behind a message about the network.
        if (error instanceof RelayError && error.code === 'last_owner') {
          Alert.alert(t('eraseVaultOwnerTitle'), t('eraseVaultOwnerBody'), [
            { text: t('cancel'), style: 'cancel' },
            {
              text: t('trustedSettingsRow'),
              onPress: () => router.push('/trusted-devices'),
            },
          ]);
          return;
        }
        Alert.alert(t('eraseRelayFailedTitle'), t('eraseRelayFailedBody'));
        return;
      }
    }

    try {
      await clearAll();
    } catch {
      // The relay half really did succeed — the device row, its queue and its
      // tokens are gone — and only the local ledger survived. Repeating the
      // relay message here would claim the opposite.
      Alert.alert(t('eraseLocalFailedTitle'), t('eraseLocalFailedBody'));
      return;
    }

    /**
     * The ledger is not the only bank data on this phone.
     *
     * A headless push wake parses relay rows and writes them to their OWN
     * encrypted database — `wafra-relay-inbox.db`, under its own key — where
     * they wait until a foreground import folds them into the ledger. Nothing
     * above touches it: `stateStorage.destroy` erases `wafra-private.db`, and
     * `unpairDevice` erases the relay credentials. Neither knows that file
     * exists. So the sentence this screen shows before erasing — "this
     * iPhone's relay queue will be permanently deleted" — was true of the
     * copy on the relay and false of the copy on the phone, and already-parsed
     * bank messages survived Erase Everything.
     *
     * After the ledger, not before: a failure here must never destroy staged
     * rows that the RESTORED ledger has not imported, which is the state a
     * failed erase leaves behind. And best-effort, because the alternative to
     * a retained row here is not a lie — the next scan folds it into the fresh
     * ledger, where the user can see it and delete it.
     */
    if (isRelayPlatform()) {
      await clearBackgroundRelayRows().catch(() => {
        // Staged rows outliving the erase is visible in the ledger a moment
        // later; an alert about a queue the user has never heard of is not.
      });
    }

    // Both halves are gone, and this is the moment the user believes nothing
    // is left. On iOS that is not yet true: the Shortcut they built is still
    // installed and still puts bank-message text on the network on every
    // matching alert. The relay refuses it now, but refusing is not the same
    // as not sending, and no API in existence lets this app delete it.
    if (shortcutCleanupApplies(cfg !== null)) {
      promptDeleteShortcut(t('shortcutCleanupErased'));
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
   * when it is not — and it now distinguishes WHICH half failed, because
   * "connect to the internet and try again" was being shown for a 409 that no
   * amount of connectivity will change.
   *
   * What it still cannot reach is the Shortcut itself: the bearer token lives
   * inside it and no API can edit it, so the automation keeps POSTing into a
   * device row that no longer exists. The relay rejects those at the auth
   * check, before it reads the body — but the message still leaves the phone,
   * which is the part a privacy claim has to own. So the confirmation says up
   * front that Wafra cannot delete the Shortcut, and a successful erase ends
   * with `promptDeleteShortcut`, which names the exact steps and opens the
   * Shortcuts app. See `src/lib/shortcut-cleanup.ts`.
   */
  const confirmErase = () => {
    // The Shortcut sentence is true only where a Shortcut can exist. An iPhone
    // that never paired has no automation to hunt for, and a warning that
    // cries wolf on that phone is a warning ignored on the one where it counts.
    // `undefined` is "not read yet", and on iOS the cautious reading is that a
    // pairing exists.
    const mentionsShortcut = Platform.OS === 'ios' && relay !== null;
    Alert.alert(
      t('eraseEverythingQ'),
      mentionsShortcut
        ? t('eraseEverythingIosBody')
        : // A phone that reads its own inbox rebuilds the entries on the next
          // scan. Promising they are "permanently deleted" and then handing
          // them straight back is the kind of thing that costs a user their
          // trust in every other privacy claim on this screen.
          isSmsScanningAvailable()
          ? t('eraseEverythingSmsBody')
          : t('eraseEverythingBody'),
      [
        { text: t('cancel'), style: 'cancel' },
        { text: t('eraseAction'), style: 'destructive', onPress: () => void eraseAllData() },
      ],
    );
  };

  /* ── Rows ───────────────────────────────────────────────────────────── */

  const chevron = language === 'ar' ? 'chevron-left' : 'chevron-right';

  /**
   * A row that opens something — a screen, or a picker sheet. The chevron is
   * that promise and nothing else on this screen may borrow it.
   *
   * `pro` draws the lock. Without it a gated row is indistinguishable from the
   * free row under it, and the first time a user learns which is which is the
   * paywall they did not ask for.
   */
  const linkRow = (
    title: string,
    subtitle: string | null,
    onPress: () => void,
    { last = false, pro = false }: { last?: boolean; pro?: boolean } = {},
  ) => {
    const locked = pro && !proActive;
    return (
      <Row
        onPress={onPress}
        last={last}
        accessibilityLabel={locked ? `${title} · ${t('wafraPro')}` : title}>
        <View style={styles.rowText}>
          <ThemedText type="small">{title}</ThemedText>
          {subtitle && (
            <ThemedText type="meta" themeColor="textTertiary">
              {subtitle}
            </ThemedText>
          )}
        </View>
        {locked && <Icon name="lock" size={13} color={theme.warning} />}
        <Icon name={chevron} size={15} color={theme.textTertiary} />
      </Row>
    );
  };

  /**
   * The label and its sub-line are part of the target.
   *
   * Row renders a plain View when it is handed neither press handler, which
   * left every toggle row here as a 44dp switch floating beside two lines of
   * dead text — while each link row beside them was tappable edge to edge.
   *
   * The handler goes on the TEXT, not on the Row. Handing Row an `onPress`
   * makes it one Pressable with accessibilityRole="button", and a Pressable is
   * an accessibility element by default: the switch inside it stops being
   * separately focusable and its on/off state — the only thing a screen-reader
   * user has on this row — is replaced by "button". `accessible={false}` here
   * keeps the text and the switch as the two things VoiceOver finds, and hands
   * the thumb the other 80% of the row.
   */
  const switchRow = (
    title: string,
    subtitle: string,
    value: boolean,
    onChange: (next: boolean) => void,
    last = false,
  ) => (
    <Row last={last}>
      <Pressable
        accessible={false}
        style={styles.rowText}
        onPress={() => {
          tapped();
          onChange(!value);
        }}>
        <ThemedText type="small">{title}</ThemedText>
        <ThemedText type="meta" themeColor="textTertiary">
          {subtitle}
        </ThemedText>
      </Pressable>
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
                <Icon name={chevron} size={15} color={theme.textTertiary} />
              </View>
            </Block>
          </Section>

          {/* Notifications, out of "Privacy" and up here.
              A 9pm digest of what you spent is not a privacy setting by any
              reading, and neither is a per-charge banner — they were filed
              there because the code that delivers them lives near the code
              that captures. Turning an alert off is one of the two things
              people actually open this screen to do, so it goes above the
              things they do twice a year. The group carries no header until
              one exists in both languages; the rows say what they are. */}
          <Section index={1}>
            {switchRow(
              t('dailySummarySetting'),
              state.dailySummary ? t('dailySummaryOn') : t('dailySummaryOff'),
              state.dailySummary,
              (next) => void toggleDailySummary(next),
              !chargeAlertsAvailable,
            )}
            {/* One outcome, one label.
                Android fires this from the SMS broadcast the instant the
                message lands; iPhone fires it when the relay wake delivers,
                which can be a moment later. That is a true difference and an
                invisible one — the two platforms are mutually exclusive, so no
                user ever sees both rows, which is exactly why they must not
                have had two different names ("Alert me on every charge" and
                "Transaction alerts"). The timing nuance lives in the sub-line,
                where it belongs. */}
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
                    Alert.alert(t('turnOnSmsFirst'), t('turnOnSmsFirstBody'));
                    return;
                  }
                  void toggleInstantAlerts(next);
                },
                true,
              )}
            {isRelayPlatform() &&
              switchRow(
                t('alertEveryCharge'),
                // Borrowed from the daily digest because it is the only plain
                // "Off" in the string table; the iPhone row wants its own
                // off-state sentence the way its Android twin has one.
                chargeAlerts ? t('chargeAlertsOn') : t('dailySummaryOff'),
                chargeAlerts,
                (next) => void toggleChargeAlerts(next),
                true,
              )}
          </Section>

          <Section index={2}>
            <SectionHeader title={t('privacyHeader')} />
            {switchRow(
              t('privateMode'),
              t(state.privateMode ? 'privateModeOn' : 'privateModeOff'),
              state.privateMode,
              togglePrivateMode,
            )}
            {switchRow(t('appLockTitle'), t('appLockDetail'), state.appLock, toggleAppLock)}
            {isSmsScanningAvailable() &&
              switchRow(
                t('readBankSms'),
                t(smsGranted ? 'smsGrantedLocal' : 'smsOffNoImport'),
                smsGranted,
                toggleSms,
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
            {/* Gated like every other capture row above it. Rendering this
                unconditionally made it the one dead end in the section on
                iOS: it read "Off · for banks that push instead of SMS", sent a
                non-Pro user to the paywall first because of gated(), and only
                then said notification access "works on the phone app only" —
                to someone holding a phone. There is no iOS equivalent to
                offer, so the row is not shown rather than shown broken. */}
            {notifAvailable &&
              linkRow(
                t('bankAppNotifsTitle'),
                t(notifEnabled ? 'bankPushOn' : 'bankPushOff'),
                gated(onNotificationAccess),
                { pro: true },
              )}
            {linkRow(
              t('trustedSettingsRow'),
              t('trustedSettingsDetail'),
              () => router.push('/trusted-devices'),
              { last: true },
            )}
            {/* The retention disclosure, as a footnote under the rows it is
                about rather than a ~50-word wall standing between the header
                and the first setting. It still describes both platforms on a
                device that is only ever one of them — cutting it to this phone
                needs copy that does not exist yet. */}
            <Block style={styles.privacyCopy}>
              <Icon name="lock" size={16} color={theme.textTertiary} />
              <ThemedText type="meta" themeColor="textSecondary" style={styles.privacyCopyText}>
                {t('privacyRetentionExact')}
              </ThemedText>
            </Block>
          </Section>

          <Section index={3}>
            <SectionHeader title={t('dataHeader')} />
            {/* The two "teach the app" chores first: both carry a live count,
                both are why someone opens this section on an ordinary day, and
                neither is an export. Back up and Restore follow, marked. */}
            {linkRow(
              t('sortShops'),
              unsorted.merchants.length > 0
                ? tf('sortShopsCount', {
                    count: unsorted.merchants.length,
                    s: unsorted.merchants.length === 1 ? '' : 's',
                  })
                : t('sortShopsNone'),
              () => router.push('/categorise'),
            )}
            {/* "No unrecognized formats" is a claim about message text this
                phone may never have had. On iOS the relay discards it before
                the row arrives and private mode deletes it on purpose, so the
                count is 0 either way — see noFormatsReason(). The row still
                leads somewhere on those devices: the card diagnostic is built
                from the ledger, not from raw, and works everywhere. */}
            {linkRow(
              t('improveAccuracy'),
              formats > 0
                ? tf('unreadFormatsCount', {
                    count: formats,
                    s: formats === 1 ? '' : 's',
                  })
                : noFormats === 'none-found'
                  ? t('noUnrecognized')
                  : t('formatsNotKeptRow'),
              () => router.push('/accuracy'),
            )}
            {linkRow(t('backupJson'), null, gated(backupJson), { pro: true })}
            {linkRow(t('restoreBackup'), null, gated(restoreFromFile), { pro: true })}
            {linkRow(t('exportCsv'), null, exportCsv)}
            {linkRow(t('exportExpensePdf'), null, () => setReportScopeSheet(true), { last: true })}
          </Section>

          <Section index={4}>
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

          <Section index={5}>
            <SectionHeader title={t('regionHeader')} />
            {/* "Country pack" was a developer's word for the pack architecture
                in markets.ts. The user picked a country. The sub-line already
                names the currency and what the pack changes. */}
            {linkRow(
              t('country'),
              tf('countryPackDetail', {
                country: marketName(market.id),
                currency: market.currency.display,
              }),
              () => setRegionSheet('country'),
            )}
            {/* The sub-line is the language that is ON, in that language —
                the one thing a glance needs and the old one never said. */}
            {linkRow(t('language'), LANGUAGE_NAMES[language], () => setRegionSheet('language'), {
              last: true,
            })}
          </Section>

          <Section index={6} style={styles.about}>
            <WafraMark size={34} />
            <ThemedText type="default" themeColor="textSecondary">
              {t('settingsTagline')}
            </ThemedText>
            <Pressable onPress={onVersionTap} hitSlop={8}>
              <ThemedText type="nano" themeColor="textTertiary">
                Wafra {version}
              </ThemedText>
            </Pressable>
          </Section>

          {/* Erase, alone.
              It used to be the seventh row of the Data list, one hairline
              below "Sort your shops", carrying the same chevron — a chevron
              that on every other row of this screen pushes a screen and on
              this one opened a destructive alert. Colour was the only thing
              separating a chore from the irreversible act. A button says
              "this does something" where a chevron says "a screen lives
              here", and the gap above it is there to be crossed deliberately.
              The confirmation copy behind it is untouched; it is the best
              writing on the screen. */}
          <Section index={7} style={styles.danger}>
            <Button label={t('eraseAll')} variant="danger" icon="trash" onPress={confirmErase} />
          </Section>
        </ScrollView>
      </SafeAreaView>

      {/* Outside the ScrollView: a sheet mounted inside a scrolling parent
          inherits its clipping and its scroll offset on web. */}
      <ChoiceSheet
        visible={regionSheet === 'country'}
        onClose={() => setRegionSheet(null)}
        title={t('country')}
        body={t('onboardMarketBody')}
        options={marketChoices}
        value={market.id}
        onSelect={setMarket}
      />
      <ChoiceSheet
        visible={regionSheet === 'language'}
        onClose={() => setRegionSheet(null)}
        title={t('language')}
        options={languageChoices}
        value={language}
        onSelect={applyLanguage}
      />
      <ChoiceSheet
        visible={reportScopeSheet}
        onClose={() => setReportScopeSheet(false)}
        title={t('expenseReportPeriod')}
        body={t('expenseReportPeriodBody')}
        options={reportScopeChoices}
        onSelect={(scope) => void createExpenseReport(scope)}
      />
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
  // The four styles for the 28-day salary-month grid are gone too. They
  // outlived the grid itself by a release and kept this file describing a
  // screen it no longer was — along with an orphan doc comment about which
  // days exist in February, attached to nothing.
  //
  // The grid was removed from Settings AND from onboarding at the owner's
  // request (961684b): a calendar standing between someone and the thing they
  // installed the app for, asking a question the app can answer for itself
  // from the salary credit it is about to read. `monthStartDay` stays in state
  // at its default so the setting can come back as an INFERRED value rather
  // than as a prompt. Putting the picker back here would re-ask the question
  // the owner deleted.
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
  // Twice the gap every other section gets. Erase is the only control on this
  // screen that cannot be undone, and the distance is the point.
  danger: {
    paddingTop: Spacing.four,
  },
});
