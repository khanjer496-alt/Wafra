/**
 * Trusted devices, in design language E.
 *
 * The slate band (Accounts' colour: this is about where money arrives) holds
 * the one figure that matters here — while an invite is live, how long it
 * stays valid, set large; otherwise the plain title and the platform's
 * relay-only truth. The sheet holds the devices, the invite's privacy line and
 * its share action, and vault deletion. Every relay action (pair, join,
 * invite, rename, revoke, delete) is unchanged and fingerprinted.
 *
 * Wording stays relay-only: a phone that joins receives new items relayed
 * after it joins; nothing older is copied, and local iPhone Message captures
 * never leave the iPhone.
 */
import { workflowCopy } from '@/components/workflows/workflow-copy';
import * as Device from 'expo-device';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  RefreshControl,
  Share,
  StyleSheet,
  View,
} from 'react-native';

import { BandTitle } from '@/components/settings-band/band-title';
import { SettingsGroupTitle } from '@/components/settings-rows';
import { ThemedText } from '@/components/themed-text';
import { EButton } from '@/components/ui/band/e-button';
import { GlyphTile } from '@/components/ui/band/glyph-tile';
import { BandScaffold, type BandNav } from '@/components/ui/band-scaffold';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Icon } from '@/components/ui/icon';
import { TextField } from '@/components/ui/text-field';
import { Fonts, Spacing } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { committed, failed, tapped } from '@/lib/haptics';
import { t, tf, type Lang } from '@/lib/i18n';
import {
  DEFAULT_RELAY_URL,
  RelayError,
  createTrustedDeviceInvite,
  deleteTrustedVault,
  getRelayConfig,
  isLegacyShortcutCaptureActive,
  joinTrustedVault,
  listTrustedDevices,
  pairDevice,
  renameTrustedDevice,
  revokeTrustedDevice,
  type RelayConfig,
} from '@/lib/relay';
import { settingsECopy } from '@/lib/settings-e-copy';
import { inviteCountdown } from '@/lib/settings-layout';
import { openShortcutsApp, shortcutCleanupApplies } from '@/lib/shortcut-cleanup';
import { useStore } from '@/lib/store';
import {
  MAX_TRUSTED_DEVICES,
  parseTrustedDeviceInvite,
  trustedDeviceInviteLink,
  validTrustedDeviceName,
  type TrustedDevice,
  type TrustedDeviceInvite,
} from '@/lib/trusted-device-contract';

type InviteState = TrustedDeviceInvite & { expiresAt: number; link: string };

function defaultDeviceName(language: Lang): string {
  const reported = Device.deviceName?.trim();
  if (reported && [...reported].length <= 40) return reported;
  if (language === 'ar') return Platform.OS === 'ios' ? 'هذا الآيفون' : 'هذا الهاتف';
  return Platform.OS === 'ios' ? 'This iPhone' : 'This phone';
}

function sampleDevices(language: Lang): TrustedDevice[] {
  const now = Math.floor(Date.now() / 1000);
  return [
    {
      id: '0196a0b0-7654-4f11-8a12-111111111111',
      name: language === 'ar' ? 'آيفون نورة' : "Noura's iPhone",
      role: 'owner',
      isCurrent: Platform.OS === 'ios',
      joinedAt: now - 2_592_000,
      lastSeenAt: now - 90,
      emailForwardingEnabled: true,
    },
    {
      id: '0196a0b0-7654-4f11-8a12-222222222222',
      name: language === 'ar' ? 'هاتف المنزل' : 'Home Pixel',
      role: 'member',
      isCurrent: Platform.OS !== 'ios',
      joinedAt: now - 604_800,
      lastSeenAt: now - 7_200,
      emailForwardingEnabled: false,
    },
  ];
}

function relativeSeen(timestamp: number, language: Lang): string {
  const delta = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
  if (delta < 120) return t('trustedSeenNow', language);
  if (delta < 3_600) return tf('trustedSeenMinutes', { count: Math.floor(delta / 60) }, language);
  if (delta < 86_400) return tf('trustedSeenHours', { count: Math.floor(delta / 3_600) }, language);
  return new Intl.DateTimeFormat(language === 'ar' ? 'ar-AE' : 'en-AE', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(timestamp * 1000));
}

function errorCopy(error: unknown, language: Lang): { title: string; body: string } {
  const code = error instanceof RelayError ? error.code : undefined;
  switch (code) {
    case 'bad_invite':
      return { title: t('trustedInviteExpiredTitle', language), body: t('trustedInviteExpiredBody', language) };
    case 'device_limit':
      return { title: t('trustedLimitTitle', language), body: t('trustedLimitBody', language) };
    case 'last_owner':
      return { title: t('trustedOwnerProtected', language), body: t('trustedOwnerProtectedBody', language) };
    case 'owner_required':
      return { title: t('trustedOwnerOnly', language), body: t('trustedOwnerOnlyBody', language) };
    case 'unauthorized':
      return { title: t('trustedAccessEnded', language), body: t('trustedAccessEndedBody', language) };
    case 'rate_limited':
      return { title: t('trustedTryLater', language), body: t('trustedTryLaterBody', language) };
    case 'bad_device_name':
      return { title: t('trustedNameInvalid', language), body: t('trustedNameInvalidBody', language) };
    default:
      return { title: t('trustedUnavailableTitle', language), body: t('trustedUnavailableBody', language) };
  }
}

export default function TrustedDevicesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ relay?: string; invite?: string }>();
  const language = useLanguage();
  // Design language E: Trusted devices wears the slate band.
  const band = useBand('accounts');
  const largeText = useLargeTextLayout();
  const { state } = useStore();
  const suggestedName = useMemo(() => defaultDeviceName(language), [language]);

  const [config, setConfig] = useState<RelayConfig | null>(null);
  const [devices, setDevices] = useState<TrustedDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [invite, setInvite] = useState<InviteState | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [joinVisible, setJoinVisible] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joinName, setJoinName] = useState(suggestedName);
  const [selected, setSelected] = useState<TrustedDevice | null>(null);
  const [rename, setRename] = useState('');
  /**
   * What the relay just refused, drawn on the screen that asked.
   *
   * Every one of these went through `Alert.alert(title, body)`, which is an
   * empty method on react-native-web — so a rejected invite, a device limit, a
   * revoked bearer and a rate limit all produced a spinner that stopped and
   * nothing else. `errorCopy` already returns exactly the two lines a notice
   * needs, so the mapping is unchanged; only the surface is.
   */
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(null);
  /**
   * Revoking is destructive and cannot be undone for that device, so it is
   * still gated — by a sheet this screen draws rather than by an alert whose
   * button array the web export never renders. `removing` is nested inside the
   * manage sheet (a Modal presented from within the presented one stacks);
   * `deletingVault` is a screen-level action and sits beside them.
   */
  const [removing, setRemoving] = useState(false);
  const [deletingVault, setDeletingVault] = useState(false);
  /**
   * The Shortcut this phone built is still installed, and still putting bank
   * text on the network — see shortcut-cleanup.ts. Raised after a revoke that
   * covers THIS device, and answered by opening Apple's Shortcuts app, which
   * is the only door either side of this app can reach.
   */
  const [shortcutLeft, setShortcutLeft] = useState(false);

  const load = useCallback(async (spinner = true) => {
    if (spinner) setLoading(true);
    try {
      const stored = await getRelayConfig();
      setConfig(stored);
      if (!stored) {
        setDevices([]);
        setOffline(false);
        return;
      }
      const next = await listTrustedDevices(stored);
      setDevices(next);
      setOffline(false);
    } catch {
      // Keep the last visible list during a transient refresh failure. It is
      // explicitly marked offline, never mutated as if a server action landed.
      setOffline(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const relay = Array.isArray(params.relay) ? params.relay[0] : params.relay;
    const token = Array.isArray(params.invite) ? params.invite[0] : params.invite;
    if (!relay || !token) return;
    try {
      setJoinCode(trustedDeviceInviteLink(relay, token));
      setJoinVisible(true);
    } catch {
      // The enrollment form will remain closed for malformed deep links.
    }
  }, [params.invite, params.relay]);

  useEffect(() => {
    if (!invite) {
      setSecondsLeft(0);
      return;
    }
    const update = () => setSecondsLeft(Math.max(0, Math.ceil((invite.expiresAt - Date.now()) / 1000)));
    update();
    const timer = setInterval(update, 1_000);
    return () => clearInterval(timer);
  }, [invite]);

  const isPreview = !config && !DEFAULT_RELAY_URL;
  const shownDevices = isPreview ? sampleDevices(language) : devices;
  const current = devices.find((device) => device.isCurrent) ?? null;
  const owner = current?.role === 'owner';
  const privateModeBlocksRelay = state.privateMode && !config;

  const showError = (error: unknown) => {
    failed();
    setNotice(errorCopy(error, language));
  };

  const createVault = async () => {
    if (!DEFAULT_RELAY_URL || privateModeBlocksRelay) return;
    setNotice(null);
    setBusy(true);
    try {
      const next = await pairDevice(DEFAULT_RELAY_URL, suggestedName);
      setConfig(next);
      setDevices(await listTrustedDevices(next));
      setOffline(false);
      committed();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    if (!DEFAULT_RELAY_URL || privateModeBlocksRelay) return;
    setNotice(null);
    const parsed = parseTrustedDeviceInvite(joinCode, DEFAULT_RELAY_URL);
    if (!parsed || parsed.relayUrl !== DEFAULT_RELAY_URL) {
      showError(new RelayError('Invalid invite', false, 'bad_invite'));
      return;
    }
    if (!validTrustedDeviceName(joinName)) {
      showError(new RelayError('Invalid name', false, 'bad_device_name'));
      return;
    }
    setBusy(true);
    try {
      const next = await joinTrustedVault(parsed.relayUrl, parsed.inviteToken, joinName);
      setConfig(next);
      setDevices(await listTrustedDevices(next));
      setJoinVisible(false);
      setJoinCode('');
      setOffline(false);
      committed();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const makeInvite = async () => {
    if (!config || !owner) return;
    setNotice(null);
    setBusy(true);
    try {
      const created = await createTrustedDeviceInvite(config);
      setInvite({
        ...created,
        expiresAt: Date.now() + created.expiresIn * 1_000,
        link: trustedDeviceInviteLink(config.baseUrl, created.inviteToken),
      });
      committed();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const shareInvite = async () => {
    if (!invite || secondsLeft <= 0) return;
    tapped();
    await Share.share({
      title: t('trustedShareTitle', language),
      message: `${t('trustedShareMessage', language)}\n\n${invite.link}`,
    }).catch(() => {});
  };

  const openDevice = (device: TrustedDevice) => {
    if (isPreview) return;
    tapped();
    setNotice(null);
    setRemoving(false);
    setSelected(device);
    setRename(device.name ?? suggestedName);
  };

  /** Closing the manage sheet takes its confirmation and its refusal with it. */
  const closeSelected = () => {
    setRemoving(false);
    setNotice(null);
    setSelected(null);
  };

  const saveName = async () => {
    if (!config || !selected || !validTrustedDeviceName(rename)) return;
    setNotice(null);
    setBusy(true);
    try {
      await renameTrustedDevice(config, selected.id, rename);
      setDevices((list) => list.map((device) =>
        device.id === selected.id ? { ...device, name: rename.trim() } : device));
      setSelected((device) => device ? { ...device, name: rename.trim() } : null);
      committed();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Revoking is real: DELETE /v1/devices/:id drops the row that holds every
   * one of that device's token hashes, so its ingest, sync and admin bearers
   * all authenticate against nothing afterwards. What it cannot drop is the
   * iOS Shortcut those tokens were pasted into, on either side of the
   * operation — so both confirmations say whose problem that is, and leaving
   * ends with the instructions for closing it here.
   */
  const removeSelected = () => {
    if (!config || !selected) return;
    setNotice(null);
    setRemoving(true);
  };

  /**
   * The revocation itself. Reachable from the confirmation sheet and from
   * nowhere else — it used to live inside an alert button's `onPress`, which
   * on the web export is code no tap can reach.
   */
  const performRemove = async () => {
    if (!config || !selected) return;
    const isSelf = selected.isCurrent;
    const id = selected.id;
    setBusy(true);
    try {
      await revokeTrustedDevice(config, id);
      setSelected(null);
      if (isSelf) {
        setConfig(null);
        setDevices([]);
      } else {
        setDevices((list) => list.filter((device) => device.id !== id));
      }
      committed();
      // Only for this phone. Another device's Shortcut lives on that phone,
      // and telling this user to go delete it here would send them looking
      // for something that is not on their device.
      if (isSelf && shortcutCleanupApplies(
        isLegacyShortcutCaptureActive(config),
      )) setShortcutLeft(true);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const confirmDeleteVault = () => {
    if (!config || !owner) return;
    setNotice(null);
    setDeletingVault(true);
  };

  const performDeleteVault = async () => {
    if (!config) return;
    setBusy(true);
    try {
      await deleteTrustedVault(config);
      setConfig(null);
      setDevices([]);
      setInvite(null);
      committed();
      // Every device in the vault is revoked, including this one. This is the
      // only one whose Shortcut this screen can speak to.
      if (shortcutCleanupApplies(
        isLegacyShortcutCaptureActive(config),
      )) setShortcutLeft(true);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const canManageSelected = !!selected && !!current && (owner || selected.isCurrent);
  const ownerIsProtected = selected?.role === 'owner';

  /**
   * Rendered wherever the refusal can arrive: the screen for pairing and
   * invites, the join sheet for a bad code, the manage sheet for a rename or
   * a revoke. A sheet covers the screen while it is open, so at most one of
   * these is ever on show, and both sheets clear it on the way in and out.
   */
  const noticeBlock = notice ? (
    <View accessibilityLiveRegion="polite">
      <View style={[styles.noticeRow, { backgroundColor: band.statusOverSoft }]}>
        <Icon name="alert" size={16} color={band.statusOver} />
        <View style={styles.flex}>
          <ThemedText type="smallBold" style={{ color: band.statusOver }}>
            {notice.title}
          </ThemedText>
          <ThemedText type="meta" style={{ color: band.textSecondary }}>
            {notice.body}
          </ThemedText>
        </View>
      </View>
    </View>
  ) : null;

  const removeIsSelf = selected?.isCurrent === true;
  const removedName = selected?.name ?? t('trustedUnnamed', language);
  const words = workflowCopy(language);
  const eWords = settingsECopy(language);
  const inviteLive = !!config && owner && !!invite;
  // While an invite is live its countdown is the band's figure and the
  // screen's name moves to the nav row; otherwise the name is the headline.
  const trustedNav: BandNav = { back: true, title: inviteLive ? t('trustedTitle', language) : undefined };
  const countdown = inviteCountdown(secondsLeft);
  const platformTruth = Platform.OS === 'android'
    ? t('trustedAndroidTruth', language)
    : t('trustedIosTruth', language);

  return (
    <>
      <BandScaffold
        band="accounts"
        testID="trusted-devices-screen"
        nav={trustedNav}
        contentStyle={styles.content}
        scrollProps={{ showsVerticalScrollIndicator: false }}
        refreshControl={config ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load(false);
              }}
            />
          ) : undefined}
        bandContent={inviteLive ? (
          <View style={styles.bandBody}>
            {/* The countdown is the hero: how long the one-use invite stays
                valid. It is announced once as a sentence, not re-read every
                second. */}
            <View
              testID="trusted-invite-countdown"
              accessible
              accessibilityLabel={secondsLeft > 0
                ? tf('trustedInviteCountdown', {
                    minutes: countdown.minutes,
                    seconds: countdown.seconds,
                  }, language)
                : t('trustedInviteExpired', language)}
              style={styles.inviteHero}>
              <ThemedText type="default" style={{ color: band.onBandSecondary }}>
                {secondsLeft > 0 ? eWords.inviteExpiresIn : eWords.inviteExpired}
              </ThemedText>
              <ThemedText
                type="display"
                maxFontSizeMultiplier={1.4}
                adjustsFontSizeToFit
                numberOfLines={1}
                style={[styles.countdown, largeText && styles.countdownLarge,
                  { color: secondsLeft > 0 ? band.onBand : band.onBandSecondary }]}>
                {countdown.text}
              </ThemedText>
            </View>
            <ThemedText type="default" style={{ color: band.onBandSecondary }}>
              {t('trustedRelayOnly', language)}
            </ThemedText>
          </View>
        ) : (
          <View style={styles.bandBody}>
            <BandTitle title={t('trustedTitle', language)} body={platformTruth} palette={band} testID="trusted-title" />
          </View>
        )}>
          {noticeBlock}

          {isPreview && (
            <View style={[styles.card, { backgroundColor: band.card, borderColor: band.rule }]}>
              <ThemedText type="smallBold" style={{ color: band.text }}>
                {t('trustedPreview', language)} · {t('trustedDisabled', language)}
              </ThemedText>
              <ThemedText type="meta" style={{ color: band.textSecondary }}>
                {t('trustedPreviewBody', language)}
              </ThemedText>
            </View>
          )}

          {!config && !loading && !isPreview && (
            <View style={styles.section}>
              <SettingsGroupTitle title={t('trustedStartHeader', language)} palette={band} />
              <ThemedText type="meta" style={{ color: band.textSecondary }}>{words.devicesBody}</ThemedText>
              {privateModeBlocksRelay && (
                <View style={[styles.privateNotice, { backgroundColor: band.statusNearSoft }]}>
                  <Icon name="lock" size={17} color={band.statusNear} />
                  <ThemedText type="meta" style={[styles.flex, { color: band.text }]}>
                    {t('trustedPrivateModeBody', language)}
                  </ThemedText>
                </View>
              )}
              {privateModeBlocksRelay && <EButton
                palette={band}
                variant="secondary"
                label={t('privacyLegacyReview', language)}
                onPress={() => router.push('/settings?section=privacy')}
              />}
              <View style={styles.actions}>
                <EButton
                  palette={band}
                  label={busy ? t('trustedConnecting', language) : t('trustedCreateVault', language)}
                  icon="lock"
                  disabled={busy || privateModeBlocksRelay}
                  onPress={() => void createVault()}
                />
                <EButton
                  palette={band}
                  label={t('trustedJoinVault', language)}
                  variant="secondary"
                  icon="download"
                  disabled={busy || privateModeBlocksRelay}
                  onPress={() => setJoinVisible(true)}
                />
              </View>
              <ThemedText type="meta" style={{ color: band.textSecondary }}>
                {t('trustedStartBody', language)}
              </ThemedText>
            </View>
          )}

          {(config || isPreview) && (
            <View style={styles.section} testID="trusted-devices-list">
              <SettingsGroupTitle
                title={t('trustedDevicesHeader', language)}
                palette={band}
                trailing={
                  <ThemedText type="meta" tabular style={{ color: band.textSecondary }}>
                    {shownDevices.length}/{MAX_TRUSTED_DEVICES}
                  </ThemedText>
                }
              />
              {offline && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('trustedRetry', language)}
                  onPress={() => void load()}>
                  <View style={[styles.offline, { backgroundColor: band.statusOverSoft }]}>
                    <Icon name="alert" size={15} color={band.statusOver} />
                    <ThemedText type="meta" style={{ color: band.statusOver, flex: 1 }}>
                      {t('trustedOfflineBody', language)}
                    </ThemedText>
                    <ThemedText type="smallBold" style={{ color: band.statusOver }}>
                      {t('trustedRetry', language)}
                    </ThemedText>
                  </View>
                </Pressable>
              )}
              <View>
                {shownDevices.map((device, index) => (
                  <Pressable
                    key={device.id}
                    accessibilityRole="button"
                    accessibilityLabel={device.name ?? t('trustedUnnamed', language)}
                    accessibilityHint={isPreview ? t('trustedPreviewA11y', language) : t('trustedManageA11y', language)}
                    onPress={() => openDevice(device)}
                    style={({ pressed }) => [
                      styles.deviceRow,
                      index < shownDevices.length - 1 && { borderBottomColor: band.rule, borderBottomWidth: StyleSheet.hairlineWidth },
                      pressed && !isPreview && { opacity: 0.7 },
                    ]}>
                    <GlyphTile icon="phone" palette={band} size={40} />
                    <View style={styles.deviceCopy}>
                      <View style={[styles.deviceTitleRow, largeText && styles.deviceTitleStacked]}>
                        <ThemedText type="smallBold" numberOfLines={largeText ? undefined : 1} style={[styles.flex, { color: band.text }]}>
                          {device.name ?? t('trustedUnnamed', language)}
                        </ThemedText>
                        {device.isCurrent && (
                          <View style={[styles.badge, { backgroundColor: band.glyphGround }]}>
                            <ThemedText type="meta" style={{ color: band.text }}>
                              {t('trustedThisDevice', language)}
                            </ThemedText>
                          </View>
                        )}
                      </View>
                      <ThemedText type="meta" style={{ color: band.textSecondary }}>
                        {t(device.role === 'owner' ? 'trustedRoleOwner' : 'trustedRoleMember', language)} · {relativeSeen(device.lastSeenAt, language)}
                      </ThemedText>
                    </View>
                    {!isPreview && <Icon name="chevron-right" size={18} strokeWidth={2} color={band.textSecondary} />}
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {config && owner && (
            <View style={styles.section} testID="trusted-invite">
              <SettingsGroupTitle title={t('trustedInviteHeader', language)} palette={band} />
              {!invite ? (
                <EButton
                  palette={band}
                  label={t('trustedInviteAction', language)}
                  icon="plus"
                  disabled={busy || devices.length >= MAX_TRUSTED_DEVICES || offline}
                  onPress={() => void makeInvite()}
                />
              ) : (
                <>
                  <ThemedText type="meta" style={{ color: band.textSecondary }}>
                    {t('trustedInvitePrivacy', language)}
                  </ThemedText>
                  <EButton
                    palette={band}
                    label={secondsLeft > 0 ? t('trustedShareInvite', language) : t('trustedNewInvite', language)}
                    icon={secondsLeft > 0 ? 'upload' : 'repeat'}
                    onPress={secondsLeft > 0 ? () => void shareInvite() : () => void makeInvite()}
                  />
                </>
              )}
            </View>
          )}

          {config && owner && (
            <View style={[styles.section, styles.dangerSection]}>
              <SettingsGroupTitle title={t('trustedVaultHeader', language)} palette={band} />
              <ThemedText type="meta" style={{ color: band.textSecondary }}>
                {t('trustedVaultBody', language)}
              </ThemedText>
              <EButton
                palette={band}
                label={t('trustedDeleteVaultAction', language)}
                color={{ fill: band.statusOver, text: band.onFill }}
                icon="trash"
                disabled={busy || offline}
                onPress={confirmDeleteVault}
              />
            </View>
          )}
      </BandScaffold>

      <BottomSheet
        visible={joinVisible}
        onClose={() => {
          setNotice(null);
          setJoinVisible(false);
        }}
        title={t('trustedJoinSheetTitle', language)}
        palette={band}>
        <ThemedText type="default" style={{ color: band.textSecondary }}>
          {t('trustedJoinSheetBody', language)}
        </ThemedText>
        <TextField
          label={t('trustedDeviceName', language)}
          value={joinName}
          onChangeText={setJoinName}
          maxLength={60}
          autoCapitalize="words"
          accessibilityLabel={t('trustedDeviceName', language)}
          placeholder={suggestedName}
        />
        <TextField
          label={t('trustedInviteCode', language)}
          value={joinCode}
          onChangeText={setJoinCode}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={t('trustedInviteCode', language)}
          placeholder={t('trustedInvitePlaceholder', language)}
          style={styles.codeInput}
        />
        {noticeBlock}
        <EButton
          palette={band}
          label={busy ? t('trustedJoining', language) : t('trustedJoinAction', language)}
          disabled={busy || !joinCode.trim() || !validTrustedDeviceName(joinName)}
          onPress={() => void join()}
        />
      </BottomSheet>

      <BottomSheet
        visible={!!selected}
        onClose={closeSelected}
        title={t('trustedManageDevice', language)}
        palette={band}>
        {selected && (
          <>
            <View style={styles.selectedHero}>
              <GlyphTile icon="phone" palette={band} size={48} />
              <View style={styles.flex}>
                <ThemedText type="subtitle" style={{ color: band.text }}>{selected.name ?? t('trustedUnnamed', language)}</ThemedText>
                <ThemedText type="meta" style={{ color: band.textSecondary }}>
                  {t(selected.role === 'owner' ? 'trustedRoleOwner' : 'trustedRoleMember', language)} · {relativeSeen(selected.lastSeenAt, language)}
                </ThemedText>
              </View>
            </View>
            {canManageSelected && (
              <View style={styles.field}>
                <TextField
                  label={t('trustedDeviceName', language)}
                  value={rename}
                  onChangeText={setRename}
                  maxLength={60}
                  autoCapitalize="words"
                  accessibilityLabel={t('trustedDeviceName', language)}
                />
                <EButton
                  palette={band}
                  label={t('save', language)}
                  variant="secondary"
                  disabled={busy || !validTrustedDeviceName(rename) || rename.trim() === (selected.name ?? '')}
                  onPress={() => void saveName()}
                />
              </View>
            )}
            {ownerIsProtected ? (
              <View style={[styles.protected, { backgroundColor: band.glyphGround }]}>
                <Icon name="lock" size={16} color={band.text} />
                <ThemedText type="meta" style={[styles.flex, { color: band.text }]}>
                  {t('trustedOwnerProtectedBody', language)}
                </ThemedText>
              </View>
            ) : canManageSelected ? (
              <EButton
                palette={band}
                label={selected.isCurrent ? t('trustedLeaveAction', language) : t('trustedRemoveAction', language)}
                color={{ fill: band.statusOver, text: band.onFill }}
                icon="trash"
                disabled={busy}
                onPress={removeSelected}
              />
            ) : null}
            {noticeBlock}
            {/* Nested inside this sheet rather than beside it: a Modal
                presented from within the presented one stacks, where
                dismissing this sheet and presenting another in the same frame
                does not. */}
            {removing && (
              <ConfirmSheet
                visible
                onClose={() => setRemoving(false)}
                question={
                  removeIsSelf
                    ? t('trustedLeaveTitle', language)
                    : t('trustedRemoveTitle', language)
                }
                body={
                  removeIsSelf
                    ? t('trustedLeaveBody', language)
                    : `${tf('trustedRemoveBody', { name: removedName }, language)}\n\n${t('trustedRemoveShortcutNote', language)}`
                }
                confirmLabel={
                  removeIsSelf
                    ? t('trustedLeaveAction', language)
                    : t('trustedRemoveAction', language)
                }
                destructive
                onConfirm={() => void performRemove()}
              />
            )}
          </>
        )}
      </BottomSheet>

      {deletingVault && (
        <ConfirmSheet
          visible
          onClose={() => setDeletingVault(false)}
          question={t('trustedDeleteVaultTitle', language)}
          body={t('trustedDeleteVaultBody', language)}
          confirmLabel={t('trustedDeleteVaultAction', language)}
          destructive
          onConfirm={() => void performDeleteVault()}
        />
      )}
      {shortcutLeft && (
        <ConfirmSheet
          visible
          onClose={() => setShortcutLeft(false)}
          question={t('shortcutStillInstalledTitle', language)}
          body={t('shortcutCleanupLeft', language)}
          confirmLabel={t('iosOpenShortcutsApp', language)}
          cancelLabel={t('iosDone', language)}
          onConfirm={openShortcutsApp}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.four },
  flex: { flex: 1, minWidth: 0 },
  bandBody: { gap: 12, paddingBottom: Spacing.two },
  inviteHero: { gap: 2 },
  // The band's figure: Geist SemiBold with tabular digits, never Geist Mono.
  countdown: { fontFamily: Fonts.sansSemi, fontSize: 84, lineHeight: 92, letterSpacing: -3, fontVariant: ['tabular-nums'] },
  countdownLarge: { fontSize: 64, lineHeight: 72, letterSpacing: -2 },
  section: { gap: Spacing.two },
  card: { gap: Spacing.one, padding: Spacing.three, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth },
  privateNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, padding: Spacing.three, borderRadius: 16 },
  noticeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, padding: Spacing.three, borderRadius: 16 },
  actions: { gap: Spacing.two },
  offline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: 14, padding: Spacing.three, minHeight: 48 },
  deviceRow: { minHeight: 68, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 14 },
  deviceCopy: { flex: 1, minWidth: 0, gap: Spacing.half },
  deviceTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  deviceTitleStacked: { flexDirection: 'column', alignItems: 'flex-start' },
  badge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  dangerSection: { paddingTop: Spacing.three },
  field: { gap: Spacing.two },
  codeInput: {
    minHeight: 96,
    paddingTop: Spacing.three,
    textAlignVertical: 'top',
    textAlign: 'left',
    writingDirection: 'ltr',
    fontFamily: 'GeistMono-Regular',
    fontSize: 14,
  },
  selectedHero: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  protected: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, padding: Spacing.three, borderRadius: 16 },
});
