/**
 * Settings.
 *
 * Grouped by what a row does TO YOU, not by what it does inside: what Wafra
 * captures, what it tells you, how it looks, where you bank, and who can get
 * in. Everything that works ON the ledger — exports, backup and restore, the
 * clean-ups, feedback, the public links and Erase — lives one tap further in,
 * on "Data and help" (settings-data.tsx). Nothing was dropped in that move.
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
import { workflowCopy } from '@/components/workflows/workflow-copy';
import * as LocalAuthentication from 'expo-local-authentication';

import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppState as RNAppState,
  I18nManager,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { BiometricGlyph, useBiometricKind } from '@/components/biometric-glyph';
import { SettingsIconTile, SettingsLinkRow, SettingsSwitchRow } from '@/components/settings-rows';
import { ThemedText } from '@/components/themed-text';
import { CountryPickerSheet, countryPickerName } from '@/components/country-picker-sheet';
import { LedgerCurrencySheet } from '@/components/ledger-currency-sheet';
import { COUNTRY_UNKNOWN } from '@/lib/country';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { ChoiceSheet } from '@/components/ui/choice-sheet';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Button } from '@/components/ui/controls';
import { Icon, type IconName } from '@/components/ui/icon';
import { Block, Row, Section } from '@/components/ui/layout';
import { ScreenScaffold } from '@/components/ui/screen-scaffold';
import type { ScreenHeaderProps } from '@/components/ui/screen-header';
import { SectionHeader } from '@/components/ui/section-header';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useAutoImport } from '@/hooks/use-auto-import';
import {
  getChargeAlertPreference,
  setChargeAlertsEnabled,
} from '@/lib/background-relay';
import {
  cancelDailySummary,
  notificationDeliveryAllowed,
  requestNotificationPermission,
  syncDailySummary,
} from '@/lib/notifications';
import {
  hasSmsPermission,
  isSmsScanningAvailable,
  openSmsPermissionSettings,
  requestSmsDeliveryPermission,
  requestSmsPermission,
} from '@/lib/auto-import';
import { tapped } from '@/lib/haptics';
import { resolvedAndroidCaptureSources } from '@/lib/android-capture-sources';
import { ledgerCurrencyDisplay } from '@/lib/markets';
import { isProActive, trialDaysLeft } from '@/lib/purchases';
// Deliberately this branch's relay client, not the other one's isRelaySupported/
// unpairRelay/stopRelayWake trio: the two relay clients speak incompatible wire
// contracts (four scoped tokens here vs one there), and mixing their entry
// points compiles on a good day and 401s on the device.
import {
  getRelayConfig,
  isLegacyShortcutCaptureActive,
  isRelayPlatform,
  type RelayConfig,
} from '@/lib/relay';
import { isCaptureAvailable } from '@/lib/capture';
import type { OnboardingAlertDelivery } from '@/lib/types';
import {
  ALERT_DELIVERY_PRESETS,
  onboardingHistoryGap,
  onboardingNoAutomaticCapture,
  onboardingProfileWithAlerts,
} from '@/lib/onboarding';
import { useStore } from '@/lib/store';
import { ledgerStateHasMoney } from '@/lib/ledger-money';
import { settingsCopy } from '@/lib/settings-copy';
import { androidSmsAddedThisMonth, captureLastHandledLabel } from '@/lib/settings-status';
import type { ThemePreference } from '@/lib/theme-preference';
import NotificationReader from '../../modules/notification-reader';
import {
  bankNotificationAdmissionExpiresAt,
  isBankNotificationCaptureAvailable,
} from '@/lib/trusted-bank-notification-packages';
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
/** The language row's tile glyph: the same letter in either interface language. */
const LANGUAGE_GLYPH = 'ع';

export default function SettingsScreen() {
  const theme = useTheme();
  const largeText = useLargeTextLayout();
  const router = useRouter();
  const {
    state,
    setAppLock,
    setDailySummary,
    setPrivateMode,
    setCaptureOptOut,
    setBestEffortAutoPost,
    setAndroidCaptureSources,
    beginHistoryImport,
    setLedgerMoney,
    setCountry,
    setUiLanguage,
    getStateSnapshot,
    setThemePreference,
    setOnboardingProfile,
  } = useStore();

  const themeChoice: ThemePreference =
    state.themePreference === 'light' || state.themePreference === 'dark'
      ? state.themePreference
      : 'system';

  const language: 'en' | 'ar' = state.language === 'ar' ? 'ar' : 'en';
  const reviewAlertCount = state.reviewTray.pending.filter(
    (item) => item.expiresAt > Date.now(),
  ).length;
  // `undefined` is "not read yet" and `null` is "read, and there is no pairing".
  // Collapsing the two would print "not connected" for a frame to a user whose
  // capture is in fact running, on the screen where they came to check.
  const [relay, setRelay] = useState<RelayConfig | null | undefined>(
    isRelayPlatform() ? undefined : null,
  );
  const relayStatusRefreshGeneration = useRef(0);
  const iosCapturePreferenceInFlight = useRef<Promise<void> | null>(null);
  const {
    captureState,
    iosCaptureStatus,
    recoverIosCaptureQueue,
  } = useAutoImport(false, true);
  const [smsGranted, setSmsGranted] = useState(false);
  const copy = settingsCopy(state.language);
  const biometricKind = useBiometricKind();
  const { section } = useLocalSearchParams<{ section?: string; onboarding?: string }>();
  const scrollRef = useRef<ScrollView>(null);
  const importsOffset = useRef<number | null>(null);
  const contentHeight = useRef(0);
  const recoveredSection = useRef<string | null>(null);
  const [privacyDetailsVisible, setPrivacyDetailsVisible] = useState(section === 'privacy');
  const scrollToRequestedSection = useCallback(() => {
    if (section !== 'imports' || recoveredSection.current === section ||
      importsOffset.current === null || contentHeight.current <= importsOffset.current || !scrollRef.current) return;
    scrollRef.current.scrollTo({ y: Math.max(0, importsOffset.current - Spacing.three), animated: false });
    recoveredSection.current = section;
  }, [section]);
  useEffect(() => {
    recoveredSection.current = null;
    if (section === 'privacy') setPrivacyDetailsVisible(true);
    scrollToRequestedSection();
  }, [section, scrollToRequestedSection]);
  const [currencySheetVisible, setCurrencySheetVisible] = useState(false);
  const [countrySheetVisible, setCountrySheetVisible] = useState(false);

  const [instantAlerts, setInstantAlerts] = useState(false);
  const [notificationDeliveryEnabled, setNotificationDeliveryEnabled] = useState(false);
  // Only builds carrying the delivery receiver can post at delivery time.
  const instantAvailable = isSmsScanningAvailable() && SmsReader?.setInstantAlerts != null;
  const notifAvailable = Platform.OS === 'android' &&
    isBankNotificationCaptureAvailable(NotificationReader?.isAvailable?.() === true);
  // The per-charge alert exists on both platforms by two different mechanisms
  // and on the web by neither, so the notification group's closing hairline
  // has to be drawn under whichever row is actually last.
  const legacyChargeAlertsAvailable = isLegacyShortcutCaptureActive(relay);
  const chargeAlertsAvailable = instantAvailable || notifAvailable || legacyChargeAlertsAvailable;

  const refreshRelayStatus = useCallback(async (): Promise<void> => {
    const generation = ++relayStatusRefreshGeneration.current;
    try {
      const cfg = await getRelayConfig();
      if (generation !== relayStatusRefreshGeneration.current) return;
      setRelay(cfg);
    } catch {
      if (generation !== relayStatusRefreshGeneration.current) return;
      setRelay(null);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!isRelayPlatform()) return;
      void refreshRelayStatus();
      return () => {
        relayStatusRefreshGeneration.current += 1;
      };
    }, [refreshRelayStatus]),
  );

  // Settings remains focused while Wafra is backgrounded behind Shortcuts.
  // Navigation focus therefore cannot refresh this row on its own.
  useEffect(() => {
    if (!isRelayPlatform()) return;
    const sub = RNAppState.addEventListener('change', (next) => {
      if (next === 'active') void refreshRelayStatus();
    });
    return () => {
      sub.remove();
      relayStatusRefreshGeneration.current += 1;
    };
  }, [refreshRelayStatus]);

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

  // Older versions offered a global local-only opt-out. Preserve that saved
  // choice until the person explicitly reviews what resuming would allow.
  const reviewLegacyPrivacyPreference = () => {
    setPrivacyDetailsVisible(false);
    setConfirmation({
      question: t('privacyResumeTitle'),
      body: t('privacyResumeBody'),
      confirmLabel: t('privacyResumeAction'),
      onConfirm: () => {
        void setPrivateMode(false).catch(() => Alert.alert(t('privacyPreferenceFailed')));
      },
    });
  };

  const toggleSms = async (enabled: boolean) => {
    if (!enabled) {
      try {
        // Android cannot revoke READ_SMS itself, so the durable source choice
        // is the real in-app barrier. Keep bank-app notifications alive when
        // the user selected that independent source.
        const currentSources = resolvedAndroidCaptureSources(getStateSnapshot());
        await setAndroidCaptureSources({ ...currentSources, sms: false });
        if (!currentSources.notifications) await setCaptureOptOut(true);
      } catch {
        Alert.alert(t('capturePreferenceFailed'));
        return;
      }
      // Android grants permissions but never takes them back on request; the
      // only honest "off" is the one in the system settings. So say where it
      // is AND open it — the alert used to type out "Settings → Apps → Wafra →
      // Permissions → SMS" and then offer a single OK, leaving the user to
      // walk there by hand from a screen that could have taken them.
      setConfirmation({
        question: t('turnSmsReadingOff'),
        body: t('smsRevokeHint'),
        confirmLabel: t('openPhoneSettings'),
        onConfirm: () => {
          void Linking.openSettings().catch(() => {});
        },
      });
      return;
    }
    const granted = await requestSmsPermission();
    setSmsGranted(granted);
    if (granted) {
      try {
        const currentSources = resolvedAndroidCaptureSources(getStateSnapshot());
        await setAndroidCaptureSources({ ...currentSources, sms: true });
        await setCaptureOptOut(false);
      } catch {
        Alert.alert(t('capturePreferenceFailed'));
      }
    }
  };

  const setIosAutomaticCapture = (enabled: boolean): Promise<void> => {
    if (iosCapturePreferenceInFlight.current) return iosCapturePreferenceInFlight.current;
    const operation = (async () => {
      try {
        if (!enabled) {
          await setCaptureOptOut(true);
          return;
        }
        await setCaptureOptOut(false);
        router.push('/ios-setup');
      } catch {
        Alert.alert(t('capturePreferenceFailed'));
      }
    })().finally(() => {
      if (iosCapturePreferenceInFlight.current === operation) {
        iosCapturePreferenceInFlight.current = null;
      }
    });
    iosCapturePreferenceInFlight.current = operation;
    return operation;
  };

  const confirmIosCaptureRecovery = () => {
    setConfirmation({
      question: t('captureIosRecoveryTitle'),
      body: t('captureIosRecoveryBody'),
      confirmLabel: t('captureIosRecoveryAction'),
      cancelLabel: t('iosDone'),
      onConfirm: () => {
        void recoverIosCaptureQueue()
          .then((recovered) => {
            Alert.alert(
              t(recovered
                ? 'captureIosRecoveryCompleteTitle'
                : 'captureIosRecoveryRetryTitle'),
              t(recovered
                ? 'captureIosRecoveryCompleteBody'
                : 'captureIosRecoveryRetryBody'),
            );
          })
          .catch(() => {
            Alert.alert(
              t('captureIosRecoveryRetryTitle'),
              t('captureIosRecoveryRetryBody'),
            );
          });
      },
    });
  };

  const toggleInstantAlerts = async (enabled: boolean) => {
    if (enabled) {
      // Notification-only bank capture should not force RECEIVE_SMS just to
      // let Wafra confirm an imported transaction. Ask for SMS delivery only
      // when this device is actually using the SMS path.
      if (smsGranted) {
        const receivesSms = await requestSmsDeliveryPermission();
        if (!receivesSms) {
          Alert.alert(t('instantAlertsSmsPermissionTitle'), t('instantAlertsSmsPermissionBody'));
          return;
        }
      }
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

  const requestInstantAlertsChange = (enabled: boolean) => {
    if (!enabled) {
      void toggleInstantAlerts(false);
      return;
    }
    // RECEIVE_SMS is a separate restricted permission from READ_SMS. Put the
    // disclosure immediately before the runtime request, not in a policy page
    // or a distant settings description, so consent is specific to live
    // delivery-time financial alerts.
    setConfirmation({
      question: t('instantSmsDisclosureTitle'),
      body: t('instantSmsDisclosureBody'),
      confirmLabel: t('enableAction'),
      onConfirm: () => void toggleInstantAlerts(true),
    });
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
      setNotificationDeliveryEnabled(false);
      setDailySummary(false);
      Alert.alert(t('notificationsOff'), t('notificationsOffBody'));
      return;
    }
    setNotificationDeliveryEnabled(true);
    setDailySummary(true);
    // Schedule from the state we are about to have, not the one in this
    // closure: the dispatch above has not re-rendered yet, and syncDailySummary
    // returns early on a false flag.
    await syncDailySummary({ ...state, dailySummary: true });
  };

  // A stored preference is not an OS grant. In particular, older builds
  // defaulted Daily Summary to true before iOS had ever shown its permission
  // sheet. Reconcile whenever Settings is focused so the switch can never claim
  // ON while the phone will deliver nothing.
  useFocusEffect(useCallback(() => {
    let active = true;
    void notificationDeliveryAllowed()
      .then((allowed) => {
        if (!active) return;
        setNotificationDeliveryEnabled(allowed);
        if (!allowed && getStateSnapshot().dailySummary) setDailySummary(false);
      })
      .catch(() => {
        if (active) setNotificationDeliveryEnabled(false);
      });
    return () => { active = false; };
  }, [getStateSnapshot, setDailySummary]));

  /** Per-charge Wafra alerts default on; the OS remains the final sound/banner control. */
  const [chargeAlerts, setChargeAlerts] = useState(true);
  /** Which compact preference picker is open, if any. Only one can be. */
  const [preferenceSheet, setPreferenceSheet] = useState<'appearance' | 'language' | 'alerts' | null>(null);
  /**
   * The one confirmation on this screen, whichever is currently being asked.
   *
   * Same shape as Bills, and here for the same reason: every gate on this
   * screen put its real work inside an `Alert.alert` button's `onPress`, and
   * on react-native-web `Alert.alert` is an empty method — so the work was
   * unreachable and the button was silent. That included **Erase everything
   * on this phone**, which is the one action on this screen that cannot be
   * undone and the one a user is most likely to press twice when nothing
   * appears to happen.
   *
   * `body` is optional here where Bills makes it required: two of these gates
   * are a bare question ("turn SMS reading off?") whose answer is the button
   * label, and padding them out would mean writing copy that adds nothing.
   */
  const [confirmation, setConfirmation] = useState<{
    question: string;
    body?: string;
    confirmLabel: string;
    /** Overrides "Cancel" where declining has its own word ("Done"). */
    cancelLabel?: string;
    destructive?: boolean;
    onConfirm: () => void;
  } | null>(null);
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
  useEffect(() => {
    if (relay === undefined || legacyChargeAlertsAvailable || !chargeAlerts) return;
    setChargeAlerts(false);
    void setChargeAlertsEnabled(false).catch(() => {
      // The switch remains hidden without an active legacy Shortcut. A later
      // status refresh retries the same source-free preference cleanup.
    });
  }, [chargeAlerts, legacyChargeAlertsAvailable, relay]);
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

  const [notifEnabled, setNotifEnabled] = useState(false);
  const selectedAndroidSources = resolvedAndroidCaptureSources(state);
  const smsSourceReady = smsGranted && selectedAndroidSources.sms;
  const instantAlertSourceReady = smsSourceReady || notifEnabled;
  const pendingNotificationConsent = useRef(false);
  useEffect(() => {
    const refresh = () => {
      try {
        const selected = resolvedAndroidCaptureSources(getStateSnapshot());
        setNotifEnabled(notifAvailable && selected.notifications &&
          NotificationReader?.isEnabled() === true &&
          NotificationReader?.hasSystemAccess?.() === true);
      }
      catch { setNotifEnabled(false); }
    };
    refresh();
    if (notifAvailable && selectedAndroidSources.notifications && !state.captureOptOut && proActive) {
      const reader = NotificationReader;
      const expiresAt = bankNotificationAdmissionExpiresAt(getStateSnapshot());
      const configure = reader?.setSourceConfiguration
        ? reader.setSourceConfiguration(true, expiresAt)
        : reader?.setCaptureEnabled(true, expiresAt);
      void configure?.then(refresh).catch(() => {});
    }
    const subscription = RNAppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      const reader = NotificationReader;
      if (!pendingNotificationConsent.current || !reader) { refresh(); return; }
      pendingNotificationConsent.current = false;
      let granted = false;
      try { granted = reader.hasSystemAccess(); } catch { /* Treat an unreadable OS grant as absent. */ }
      if (!granted || !proActive) { refresh(); return; }
      void (async () => {
        // The listener outlives the render that registered it; read the live
        // store rather than a snapshot captured when the effect last ran.
        const current = getStateSnapshot();
        const wasOptedOut = current.captureOptOut;
        try {
          // A canceled system permission flow must leave a prior global
          // opt-out intact. Resume only after the OS confirms this grant.
          const sources = resolvedAndroidCaptureSources(current);
          await setAndroidCaptureSources({ ...sources, notifications: true });
          if (wasOptedOut) await setCaptureOptOut(false);
          // The bank-listener grant lets Wafra READ bank-app notifications.
          // A separate Android permission controls whether Wafra can show its
          // own visible confirmation. Ask here, after the user explicitly
          // enabled bank notifications — never on app launch.
          await requestNotificationPermission().catch(() => false);
          refresh();
        } catch {
          if (wasOptedOut) await setCaptureOptOut(true).catch(() => {});
          refresh();
          Alert.alert(t('capturePreferenceFailed'));
        }
      })();
    });
    return () => subscription.remove();
  }, [getStateSnapshot, notifAvailable, proActive, setAndroidCaptureSources,
    setCaptureOptOut, state.androidCaptureSources?.notifications, state.captureOptOut]);
  const onNotificationAccess = () => {
    const reader = NotificationReader;
    if (!notifAvailable || !reader) {
      Alert.alert(t('notAvailable'), t('notifsPhoneOnly'));
      return;
    }
    setConfirmation({
      question: t('bankAppNotifsTitle'),
      body: t('notifAccessFull'),
      confirmLabel: notifEnabled ? t('openSettings') : t('enableAction'),
      onConfirm: () => {
        try {
          pendingNotificationConsent.current = true;
          pendingNotificationConsent.current = reader.openSettings() === true;
          if (!pendingNotificationConsent.current) Alert.alert(t('capturePreferenceFailed'));
        } catch {
          pendingNotificationConsent.current = false;
          Alert.alert(t('capturePreferenceFailed'));
        }
      },
    });
  };

  const languagePreference = state.languagePreference ?? 'system';
  const ledgerCurrencyLocked = ledgerStateHasMoney(state);
  const applyLanguage = (next: 'system' | 'en' | 'ar') => {
    if (next === languagePreference) return;
    // No alert, and nothing to restart. The strings re-render from this and
    // the layout mirrors from the `direction` style on the root — see the
    // Direction component in app/_layout.tsx for why I18nManager could never
    // do it live.
    setUiLanguage(next);
    // Still set, for react-navigation's own gesture and animation direction,
    // which reads I18nManager rather than the layout. That part is the only
    // thing left waiting for a restart.
    if (Platform.OS !== 'web') {
      const resolved = next === 'system' ? language : next;
      I18nManager.allowRTL(resolved === 'ar');
      I18nManager.forceRTL(resolved === 'ar');
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
  const languageChoices = [
    { value: 'system' as const, label: t('themeSystem') },
    ...(['en', 'ar'] as const).map((code) => ({
      value: code,
      label: LANGUAGE_NAMES[code],
    })),
  ];
  /**
   * The alert-delivery answer, after setup.
   *
   * Onboarding asks it, but the people it was written for are already
   * onboarded — the tester whose bank never texted him had finished setup
   * months before the question existed. Leaving it in the first run only
   * would have answered nobody's actual problem, so it lives here too, in the
   * section that holds the fix it points at.
   */
  const alertsAnswer = state.onboardingProfile?.alerts ?? null;
  const alertDeliveryChoices = ALERT_DELIVERY_PRESETS.map((preset) => ({
    value: preset.id,
    label: t(preset.titleKey),
    detail: t(preset.detailKey),
  }));
  const chooseAlertDelivery = (next: OnboardingAlertDelivery) => {
    setOnboardingProfile(onboardingProfileWithAlerts(state.onboardingProfile, next, Date.now()));
  };

  const appearanceChoices: { value: ThemePreference; label: string; detail?: string }[] = [
    { value: 'system', label: t('themeSystem'), detail: t('themeSystemDetail') },
    { value: 'light', label: t('themeLight') },
    { value: 'dark', label: t('themeDark') },
  ];

  /* ── Rows ───────────────────────────────────────────────────────────── */

  const settingsHeader: ScreenHeaderProps = {
    title: t('settingsTitle'),
    back: { label: t('back'), onPress: () => router.back() },
  };

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
    { last = false, pro = false, icon, glyph, value, testID }: {
      last?: boolean; pro?: boolean; icon?: IconName; glyph?: React.ReactNode; value?: string; testID?: string;
    } = {},
  ) => (
    <SettingsLinkRow
      title={title}
      subtitle={subtitle}
      value={value}
      onPress={onPress}
      icon={icon}
      glyph={glyph}
      last={last}
      locked={pro && !proActive}
      lockLabel={t('wafraPro')}
      testID={testID}
    />
  );

  /**
   * The label and its sub-line are part of the target; the switch keeps its
   * own accessibility state. See SettingsSwitchRow for why the Row itself is
   * not the Pressable.
   */
  const switchRow = (
    title: string,
    subtitle: string | null,
    value: boolean,
    onChange: (next: boolean) => void,
    last = false,
    icon?: IconName,
  ) => (
    <SettingsSwitchRow
      title={title}
      subtitle={subtitle}
      value={value}
      onChange={onChange}
      last={last}
      icon={icon}
    />
  );
  const iosCaptureSwitchRow = (
    subtitle: string,
    value: boolean,
    onManage: () => void,
  ) => (
    <SettingsSwitchRow
      title={t('automaticCapture')}
      subtitle={subtitle}
      value={value}
      icon="mail"
      testID="settings-automatic-capture"
      onTextPress={onManage}
      onChange={(enabled) => {
        if (enabled && captureState === 'queue-warning') {
          confirmIosCaptureRecovery();
          return;
        }
        if (enabled && captureState === 'paused') {
          router.push('/pro');
          return;
        }
        void setIosAutomaticCapture(enabled);
      }}
    />
  );
  const words = workflowCopy(state.language);
  const trial = trialDaysLeft(state);
  const captureAvailable = isSmsScanningAvailable() || isCaptureAvailable();
  const iosCaptureEnabled = !state.captureOptOut && iosCaptureStatus?.enabled === true;
  // "Working · last message 09:41" — only once a first alert has actually been
  // captured, and only from a time the native queue recorded. lastHandledAt
  // includes duplicates and non-financial texts, so the copy says "message",
  // never "transaction".
  const lastHandledLabel = captureLastHandledLabel(
    iosCaptureStatus?.lastHandledAt ?? null,
    new Date(),
    state.language,
  );
  const iosCaptureCopy = captureState === 'checking'
    ? t('settingStatusChecking')
    : captureState === 'first-alert-captured'
      ? lastHandledLabel
        ? copy.captureWorking(lastHandledLabel)
        : t('captureIosFirstAlertCaptured')
      : captureState === 'waiting-for-alert'
        ? t('captureIosWaitingForAlert')
        : captureState === 'needs-automation'
          ? t('captureIosNeedsAutomation')
          : captureState === 'queue-warning'
            ? t('captureIosQueueWarning')
            : captureState === 'migration-retry'
              ? t('captureIosMigrationRetry')
              : captureState === 'paused'
                ? t('capturePaused')
                : captureState === 'unsupported'
                  ? t('capturePhoneOnly')
                  : t('captureIosOff');
  // Android: what the SMS permission has actually produced this month.
  const smsAddedThisMonth = useMemo(
    () => (isSmsScanningAvailable() ? androidSmsAddedThisMonth(state.transactions, new Date()) : 0),
    [state.transactions],
  );
  const lockTitle = biometricKind ? copy.lockTitle[biometricKind] : t('appLockTitle');
  const proSubtitle = state.founderPro
    ? t('founderProActive')
    : state.pro
      ? t('activeOnThisDevice')
      : trial > 0
        ? copy.proTrialBody(trial)
        : t('trialEndedBanner');
  const proTitle = !state.founderPro && !state.pro && trial > 0 ? copy.proTrialTitle : copy.proTitle;

  return (
    <React.Fragment>
      <ScreenScaffold
        scrollRef={scrollRef}
        scrollProps={{ showsVerticalScrollIndicator: false, onContentSizeChange: (_width, height) => {
          contentHeight.current = height;
          scrollToRequestedSection();
        } }}
        headerMode="native"
        header={settingsHeader}
        contentStyle={styles.content}>
        <Section index={0}>
          <Pressable
            testID="settings-pro-card"
            accessibilityRole="button"
            accessibilityLabel={`${proTitle} · ${proSubtitle}`}
            onPress={() => {
              tapped();
              router.push('/pro');
            }}
            style={({ pressed }) => [
              styles.proCard,
              largeText && styles.proRowLarge,
              { backgroundColor: theme.inverseSurface, opacity: pressed ? 0.9 : 1 },
            ]}>
            <View style={[styles.proBadge, { backgroundColor: theme.primary }]}>
              <Icon name="diamond" size={20} color={theme.onPrimary} />
            </View>
            <View style={styles.rowText}>
              <ThemedText type="smallBold" style={{ color: theme.inverseText }}>{proTitle}</ThemedText>
              <ThemedText type="meta" style={{ color: theme.inverseText, opacity: 0.8 }}>
                {proSubtitle}
              </ThemedText>
            </View>
            <Icon name="chevron-right" size={15} color={theme.inverseText} />
          </Pressable>
        </Section>

        <Section index={1} testID="settings-imports" onLayout={({ nativeEvent }) => {
          importsOffset.current = nativeEvent.layout.y;
          scrollToRequestedSection();
        }} style={styles.settingsPanel}>
          <SectionHeader title={t('settingsImportsHeader')} />
          {isSmsScanningAvailable() &&
            switchRow(
              t('readBankSms'),
              smsSourceReady ? copy.smsAllowed(smsAddedThisMonth) : t('smsOffNoImport'),
              smsSourceReady,
              toggleSms,
              false,
              'mail',
            )}
          {state.historyImport && state.historyImport.status !== 'complete' ? (
            <Block style={styles.historyImportSettings}>
              <View style={styles.historyImportSettingsCopy}>
                <ThemedText type="smallBold">{t('historyImportSettingsTitle')}</ThemedText>
                <ThemedText type="meta" themeColor="textSecondary">
                  {state.historyImport.status === 'failed'
                    ? t(state.historyImport.error === 'inbox-access'
                        ? 'historyImportAccessBody'
                        : 'historyImportSavedBody')
                    : tf('historyImportLiveProgress', {
                        scanned: state.historyImport.scanned,
                        found: state.historyImport.found,
                      })}
                </ThemedText>
              </View>
              {state.historyImport.status === 'failed' ? (
                <Button
                  inline
                  variant="outline"
                  label={t(state.historyImport.error === 'inbox-access'
                    ? 'openPhoneSettings'
                    : 'retryHistoryImport')}
                  onPress={() => void (state.historyImport?.error === 'inbox-access'
                    ? openSmsPermissionSettings().then(() => beginHistoryImport())
                    : beginHistoryImport())}
                />
              ) : null}
            </Block>
          ) : null}
          {Platform.OS === 'ios' && captureAvailable &&
            iosCaptureSwitchRow(
              state.captureOptOut
                ? t('captureIosOff')
                : captureState === 'queue-warning' && iosCaptureStatus
                  ? tf('captureIosQueueCounts', {
                      pending: iosCaptureStatus.pending,
                      dropped: iosCaptureStatus.dropped,
                      corrupt: iosCaptureStatus.corrupt
                        ? t('settingStatusYes')
                        : t('settingStatusNo'),
                    })
                  : iosCaptureCopy,
              iosCaptureEnabled,
              () => {
                if (captureState === 'paused') {
                  router.push('/pro');
                  return;
                }
                if (captureState === 'queue-warning') {
                  confirmIosCaptureRecovery();
                  return;
                }
                if (state.captureOptOut || captureState === 'off' ||
                  captureState === 'needs-automation') {
                  void setIosAutomaticCapture(true);
                  return;
                }
                router.push('/ios-setup');
              },
            )}
          {Platform.OS === 'ios' && captureAvailable &&
            captureState === 'queue-warning' && (
              <Block style={styles.historyImportSettings}>
                <View style={styles.historyImportSettingsCopy}>
                  <ThemedText type="smallBold">{t('captureIosRecoveryAction')}</ThemedText>
                  <ThemedText type="meta" themeColor="textSecondary">
                    {t('captureIosRecoveryBody')}
                  </ThemedText>
                </View>
                <Button
                  inline
                  variant="outline"
                  label={t('captureIosRecoveryAction')}
                  onPress={confirmIosCaptureRecovery}
                />
              </Block>
            )}
          {notifAvailable &&
            linkRow(
              t('bankAppNotifsTitle'),
              notifEnabled ? t('bankPushOn') : copy.optionalOff,
              gated(onNotificationAccess),
              { pro: true, icon: 'bank' },
            )}
          {linkRow(
            t('statementImportTitle'),
            // The alert-delivery answer decides which of these sentences is
            // true, so the fix reads as the consequence of what the person
            // told us rather than as an unexplained suggestion.
            onboardingNoAutomaticCapture(alertsAnswer)
              ? t('statementImportNoCaptureDetail')
              : onboardingHistoryGap(alertsAnswer)
                ? t('statementImportGapDetail')
                : t('statementImportSettingsDetail'),
            () => router.push('/statement-import'),
            { icon: 'receipt' },
          )}
          {reviewAlertCount > 0 && linkRow(
            words.reviewTitle,
            tf('reviewAlertsSettingsCount', { count: reviewAlertCount }),
            () => router.push('/review-alerts'),
            { icon: 'alert' },
          )}
          {switchRow(
            t('autoAddedSettingTitle'),
            t('autoAddedSettingBody'),
            state.bestEffortAutoPost !== false,
            (next) => {
              setBestEffortAutoPost(next).catch(() => Alert.alert(t('autoAddedSettingTitle'), t('autoAddedSettingSaveFailed')));
            },
            false,
            'check',
          )}
          {linkRow(
            t('settingsAlertDeliveryTitle'),
            alertsAnswer
              ? t(ALERT_DELIVERY_PRESETS.find((preset) => preset.id === alertsAnswer)!.titleKey)
              : t('settingsAlertDeliveryUnset'),
            () => setPreferenceSheet('alerts'),
            { icon: 'bolt', last: Platform.OS !== 'ios' },
          )}
          {Platform.OS === 'ios' && linkRow(
            t('iosSetupTitle'),
            t('iosMessageSettingsDetail'),
            () => router.push('/ios-setup'),
            { icon: 'phone', last: true },
          )}
        </Section>

        <Section index={2} style={styles.settingsPanel}>
          <SectionHeader title={t('settingsNotificationsHeader')} />
          {switchRow(
            t('dailySummarySetting'),
            state.dailySummary && notificationDeliveryEnabled ? t('dailySummaryOn') : t('dailySummaryOff'),
            state.dailySummary && notificationDeliveryEnabled,
            (next) => void toggleDailySummary(next),
            !chargeAlertsAvailable,
            'calendar',
          )}
          {(instantAvailable || notifAvailable) &&
            switchRow(
              t('alertEveryCharge'),
              instantAlertSourceReady
                ? instantAlerts
                  ? t('instantAlertsOn')
                  : t('instantAlertsOff')
                : t('instantAlertsNeedBankSource'),
              instantAlerts && instantAlertSourceReady,
              (next) => {
                if (!instantAlertSourceReady) {
                  Alert.alert(t('turnOnBankCaptureFirst'), t('turnOnBankCaptureFirstBody'));
                  return;
                }
                requestInstantAlertsChange(next);
              },
              true,
              'bolt',
            )}
          {legacyChargeAlertsAvailable &&
            switchRow(
              t('alertEveryCharge'),
              chargeAlerts ? t('chargeAlertsOn') : t('dailySummaryOff'),
              chargeAlerts,
              (next) => void toggleChargeAlerts(next),
              true,
              'bolt',
            )}
        </Section>

        <Section index={3} style={styles.settingsPanel}>
          <SectionHeader title={t('settingsPreferencesHeader')} />
          {linkRow(
            copy.theme,
            null,
            () => setPreferenceSheet('appearance'),
            {
              icon: 'sun',
              value: themeChoice === 'system'
                ? t('themeSystem')
                : t(themeChoice === 'light' ? 'themeLight' : 'themeDark'),
            },
          )}
          {linkRow(t('language'), null, () => setPreferenceSheet('language'), {
            // No globe in the house icon set; the Arabic letter is the
            // language control's glyph in both languages.
            glyph: <ThemedText type="smallBold" themeColor="primary">{LANGUAGE_GLYPH}</ThemedText>,
            value: languagePreference === 'system'
              ? `${t('themeSystem')} · ${LANGUAGE_NAMES[language]}`
              : LANGUAGE_NAMES[language],
          })}
          {linkRow(
            t('homeCustomizeTitle'),
            t('homeCustomizeDetail'),
            () => router.push('/home-customize'),
            { icon: 'sliders', last: Platform.OS === 'web' },
          )}
          {Platform.OS !== 'web' && linkRow(
            t('settingsViewOnboarding'),
            t('settingsViewOnboardingDetail'),
            () => router.setParams({ onboarding: 'preview' }),
            { icon: 'play', last: true },
          )}
        </Section>

        <Section index={4} testID="settings-region" style={styles.settingsPanel}>
          <SectionHeader title={copy.countryAndCurrency} />
          {linkRow(
            t('settingsCountryTitle'),
            // An unknown country asks to be set rather than reading as a choice.
            `${state.country && state.country !== COUNTRY_UNKNOWN
              ? countryPickerName(state.country)
              : t('onboardCountryUnknown')} · ${t('settingsCountryDetail')}`,
            () => setCountrySheetVisible(true),
            { icon: 'plane' },
          )}
          {ledgerCurrencyLocked ? (
            <Row
              last
              accessibilityLabel={`${t('ledgerCurrencyTitle')}: ${state.ledgerMoney?.currency ?? ledgerCurrencyDisplay()}`}>
              <SettingsIconTile icon="cash" />
              <View style={styles.rowText}>
                <ThemedText type="small">{t('ledgerCurrencyTitle')}</ThemedText>
                <ThemedText type="meta" themeColor="textSecondary">
                  {(state.ledgerMoney?.currency ?? ledgerCurrencyDisplay()) + ' · ' + t('ledgerCurrencyPermanentHint')}
                </ThemedText>
              </View>
              <Icon name="lock" size={13} color={theme.textTertiary} />
            </Row>
          ) : linkRow(
            t('ledgerCurrencyTitle'),
            state.ledgerMoney?.currency ?? t('chooseLedgerCurrency'),
            () => setCurrencySheetVisible(true),
            { last: true, icon: 'cash' },
          )}
        </Section>

        <Section index={5} testID="settings-privacy" style={styles.settingsPanel}>
          <SectionHeader title={copy.privacyAndSecurity} />
          <SettingsSwitchRow
            title={lockTitle}
            subtitle={t('appLockDetail')}
            value={state.appLock}
            onChange={toggleAppLock}
            testID="settings-app-lock"
            glyph={<BiometricGlyph kind={biometricKind} size={17} color={theme.primary} />}
          />
          {Platform.OS !== 'web' && linkRow(
            copy.trustedRow,
            copy.trustedDetail,
            () => router.push('/trusted-devices'),
            { icon: 'phone', testID: 'settings-trusted-devices' },
          )}
          {linkRow(t('messagesPrivacy'), t('privacyBuiltInDetail'), () => setPrivacyDetailsVisible(true), { last: true, icon: 'lock' })}
          {(legacyChargeAlertsAvailable || relay === undefined) && (
            <Block style={styles.privacyCopy}>
              <Icon name="alert" size={16} color={theme.warning} />
              <ThemedText type="small" themeColor="warning" style={styles.privacyCopyText}>
                {t('legacyCapturePrivacyWarning')}
              </ThemedText>
            </Block>
          )}
        </Section>

        <Section index={6} style={styles.settingsPanel}>
          {linkRow(
            copy.dataAndHelp,
            copy.dataAndHelpDetail,
            () => router.push('/settings-data'),
            { last: true, icon: 'download', testID: 'settings-data-and-help' },
          )}
        </Section>
      </ScreenScaffold>

      <BottomSheet visible={privacyDetailsVisible} onClose={() => setPrivacyDetailsVisible(false)}
        title={t('messagesPrivacy')}>
        <View style={{ gap: Spacing.three }}>
          <ThemedText themeColor="textSecondary">{t('privacyBuiltInBody')}</ThemedText>
          <ThemedText themeColor="textSecondary">{t('privacyRetentionExact')}</ThemedText>
          <ThemedText themeColor="textSecondary">{t('privacySecurityExact')}</ThemedText>
          <ThemedText themeColor="textSecondary">{t('privacyLogosBody')}</ThemedText>
          {state.privateMode && <Block>
            <ThemedText type="smallBold">{t('privacyLegacyTitle')}</ThemedText>
            <ThemedText themeColor="textSecondary">{t('privacyLegacyBody')}</ThemedText>
            <Button label={t('privacyLegacyReview')} variant="outline" onPress={reviewLegacyPrivacyPreference} />
          </Block>}
        </View>
      </BottomSheet>

      <ChoiceSheet
        visible={preferenceSheet === 'alerts'}
        onClose={() => setPreferenceSheet(null)}
        // The caps header takes the noun; the question and its reason go in
        // the slots written for a sentence, or the sheet shouts the question.
        title={t('settingsAlertDeliveryHeader')}
        question={t('onboardAlertsTitle')}
        body={t('onboardAlertsBody')}
        options={alertDeliveryChoices}
        value={alertsAnswer ?? undefined}
        onSelect={chooseAlertDelivery}
      />
      <ChoiceSheet
        visible={preferenceSheet === 'appearance'}
        onClose={() => setPreferenceSheet(null)}
        title={t('appearanceHeader')}
        options={appearanceChoices}
        value={themeChoice}
        onSelect={setThemePreference}
      />
      <ChoiceSheet
        visible={preferenceSheet === 'language'}
        onClose={() => setPreferenceSheet(null)}
        title={t('language')}
        options={languageChoices}
        value={languagePreference}
        onSelect={applyLanguage}
      />
      <CountryPickerSheet
        visible={countrySheetVisible}
        value={state.country || null}
        suggested={[state.country]}
        title={t('settingsCountryTitle')}
        subtitle={t('settingsCountrySheetBody')}
        onClose={() => setCountrySheetVisible(false)}
        onSelect={setCountry}
        testID="settings-country-sheet"
      />
      <LedgerCurrencySheet
        visible={currencySheetVisible}
        value={state.ledgerMoney?.currency ?? null}
        onClose={() => setCurrencySheetVisible(false)}
        onSelect={setLedgerMoney}
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

const styles = StyleSheet.create({
  // The rows already carry rules. A second border above every section heading
  // boxed the label in and made a single preference occupy an entire panel.
  settingsPanel: { paddingTop: Spacing.two, gap: Spacing.one },
  content: {
    gap: Spacing.three,
  },
  proCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three - 2,
    padding: Spacing.three,
    borderRadius: Radius.sheet + 4,
    minHeight: 76,
  },
  proBadge: {
    width: 44,
    height: 44,
    borderRadius: Radius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  proRowLarge: {
    alignItems: 'flex-start',
  },
  rowText: {
    flex: 1,
    gap: Spacing.half,
  },
  // The four styles for the 28-day salary-month grid are gone, and the
  // board's "Your month · From payday" row is deliberately not built: the
  // grid was removed from Settings AND onboarding at the owner's request
  // (961684b). `monthStartDay` stays in state at its default so the setting
  // can come back as an INFERRED value rather than as a prompt.
  privacyCopy: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  privacyCopyText: {
    flex: 1,
    lineHeight: 18,
  },
  historyImportSettings: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  historyImportSettingsCopy: { flex: 1, gap: Spacing.half },
});
