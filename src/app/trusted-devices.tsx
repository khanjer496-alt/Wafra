import * as Device from 'expo-device';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Button } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { Block, ScreenHeader, Section, SectionHeader } from '@/components/ui/layout';
import { MaxContentWidth, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { committed, failed, tapped } from '@/lib/haptics';
import { t, tf, type Lang } from '@/lib/i18n';
import {
  DEFAULT_RELAY_URL,
  RelayError,
  createTrustedDeviceInvite,
  deleteTrustedVault,
  getRelayConfig,
  joinTrustedVault,
  listTrustedDevices,
  pairDevice,
  renameTrustedDevice,
  revokeTrustedDevice,
  type RelayConfig,
} from '@/lib/relay';
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
  const theme = useTheme();
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
      if (isSelf && shortcutCleanupApplies(true)) setShortcutLeft(true);
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
      if (shortcutCleanupApplies(true)) setShortcutLeft(true);
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
      <Block tone="expense" style={styles.noticeRow}>
        <Icon name="alert" size={16} color={theme.expense} />
        <View style={styles.flex}>
          <ThemedText type="smallBold" style={{ color: theme.expense }}>
            {notice.title}
          </ThemedText>
          <ThemedText type="meta" themeColor="textSecondary">
            {notice.body}
          </ThemedText>
        </View>
      </Block>
    </View>
  ) : null;

  const removeIsSelf = selected?.isCurrent === true;
  const removedName = selected?.name ?? t('trustedUnnamed', language);

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <ScreenHeader title={t('trustedTitle', language)} onBack={() => router.back()} />
        </View>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          refreshControl={config ? (
            <RefreshControl
              refreshing={refreshing}
              tintColor={theme.primary}
              onRefresh={() => {
                setRefreshing(true);
                void load(false);
              }}
            />
          ) : undefined}>
          <Section index={0}>
            <Block style={styles.hero}>
              <View style={styles.heroTop}>
                <View style={[styles.heroIcon, { backgroundColor: theme.primarySoft, borderColor: theme.primaryBorder }]}>
                  <Icon name="phone" size={22} color={theme.primary} />
                </View>
                <View style={[styles.linkLine, { backgroundColor: theme.primaryBorder }]} />
                <View style={[styles.heroIcon, { backgroundColor: theme.backgroundSelected, borderColor: theme.cardBorderStrong }]}>
                  <Icon name="lock" size={21} color={theme.textSecondary} />
                </View>
                <View style={[styles.linkLine, { backgroundColor: theme.primaryBorder }]} />
                <View style={[styles.heroIcon, { backgroundColor: theme.primarySoft, borderColor: theme.primaryBorder }]}>
                  <Icon name="phone" size={22} color={theme.primary} />
                </View>
              </View>
              <ThemedText type="heading" accessibilityRole="header">
                {t('trustedHeroTitle', language)}
              </ThemedText>
              <ThemedText type="default" themeColor="textSecondary">
                {t('trustedHeroBody', language)}
              </ThemedText>
              <View style={[styles.truthBand, { borderTopColor: theme.cardBorder }]}>
                <Icon name="check" size={15} color={theme.primary} />
                <ThemedText type="meta" themeColor="textSecondary" style={styles.flex}>
                  {Platform.OS === 'android'
                    ? t('trustedAndroidTruth', language)
                    : t('trustedIosTruth', language)}
                </ThemedText>
              </View>
            </Block>
          </Section>

          {noticeBlock && <Section index={1}>{noticeBlock}</Section>}

          {isPreview && (
            <Section index={1}>
              <Block style={[styles.notice, { backgroundColor: theme.primarySoft, borderColor: theme.primaryBorder }]}>
                <View style={styles.noticeTitle}>
                  <ThemedText type="micro" style={{ color: theme.primary }}>
                    {t('trustedPreview', language)}
                  </ThemedText>
                  <ThemedText type="nano" style={{ color: theme.primary }}>
                    {t('trustedDisabled', language)}
                  </ThemedText>
                </View>
                <ThemedText type="meta" themeColor="textSecondary">
                  {t('trustedPreviewBody', language)}
                </ThemedText>
              </Block>
            </Section>
          )}

          {!config && !loading && !isPreview && (
            <Section index={1}>
              <SectionHeader title={t('trustedStartHeader', language)} />
              {privateModeBlocksRelay && (
                <Block style={styles.privateNotice}>
                  <Icon name="lock" size={17} color={theme.warning} />
                  <ThemedText type="meta" themeColor="textSecondary" style={styles.flex}>
                    {t('trustedPrivateModeBody', language)}
                  </ThemedText>
                </Block>
              )}
              <View style={styles.actions}>
                <Button
                  label={busy ? t('trustedConnecting', language) : t('trustedCreateVault', language)}
                  icon="lock"
                  disabled={busy || privateModeBlocksRelay}
                  onPress={() => void createVault()}
                />
                <Button
                  label={t('trustedJoinVault', language)}
                  variant="outline"
                  icon="download"
                  disabled={busy || privateModeBlocksRelay}
                  onPress={() => setJoinVisible(true)}
                />
              </View>
              <ThemedText type="meta" themeColor="textTertiary">
                {t('trustedStartBody', language)}
              </ThemedText>
            </Section>
          )}

          {(config || isPreview) && (
            <Section index={2}>
              <SectionHeader
                title={t('trustedDevicesHeader', language)}
                trailing={
                  <ThemedText type="micro" themeColor="textTertiary" tabular>
                    {shownDevices.length}/{MAX_TRUSTED_DEVICES}
                  </ThemedText>
                }
              />
              {offline && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('trustedRetry', language)}
                  onPress={() => void load()}>
                  <View style={[styles.offline, { borderColor: theme.expenseSoftBorder, backgroundColor: theme.expenseSoftBg }]}>
                    <Icon name="alert" size={15} color={theme.expense} />
                    <ThemedText type="meta" style={{ color: theme.expense, flex: 1 }}>
                      {t('trustedOfflineBody', language)}
                    </ThemedText>
                    <ThemedText type="nano" style={{ color: theme.expense }}>
                      {t('trustedRetry', language)}
                    </ThemedText>
                  </View>
                </Pressable>
              )}
              <View style={[styles.deviceList, { borderColor: theme.cardBorder }]}>
                {shownDevices.map((device, index) => (
                  <Pressable
                    key={device.id}
                    accessibilityRole="button"
                    accessibilityLabel={device.name ?? t('trustedUnnamed', language)}
                    accessibilityHint={isPreview ? t('trustedPreviewA11y', language) : t('trustedManageA11y', language)}
                    onPress={() => openDevice(device)}
                    style={({ pressed }) => [
                      styles.deviceRow,
                      index > 0 && { borderTopColor: theme.cardBorder, borderTopWidth: StyleSheet.hairlineWidth },
                      pressed && !isPreview && { transform: [{ scale: 0.99 }] },
                    ]}>
                    <View style={[styles.deviceAvatar, { backgroundColor: device.isCurrent ? theme.primarySoft : theme.backgroundSelected }]}>
                      <Icon name="phone" size={18} color={device.isCurrent ? theme.primary : theme.textSecondary} />
                    </View>
                    <View style={styles.deviceCopy}>
                      <View style={styles.deviceTitleRow}>
                        <ThemedText type="smallBold" numberOfLines={1} style={styles.flex}>
                          {device.name ?? t('trustedUnnamed', language)}
                        </ThemedText>
                        {device.isCurrent && (
                          <View style={[styles.badge, { backgroundColor: theme.primarySoft }]}>
                            <ThemedText type="nano" style={{ color: theme.primary }}>
                              {t('trustedThisDevice', language)}
                            </ThemedText>
                          </View>
                        )}
                      </View>
                      <ThemedText type="meta" themeColor="textTertiary">
                        {t(device.role === 'owner' ? 'trustedRoleOwner' : 'trustedRoleMember', language)} · {relativeSeen(device.lastSeenAt, language)}
                      </ThemedText>
                    </View>
                    {!isPreview && <Icon name="chevron-right" size={15} color={theme.textTertiary} />}
                  </Pressable>
                ))}
              </View>
            </Section>
          )}

          {config && owner && (
            <Section index={3}>
              <SectionHeader title={t('trustedInviteHeader', language)} />
              {!invite ? (
                <Button
                  label={t('trustedInviteAction', language)}
                  icon="plus"
                  disabled={busy || devices.length >= MAX_TRUSTED_DEVICES || offline}
                  onPress={() => void makeInvite()}
                />
              ) : (
                <Block style={styles.inviteCard}>
                  <View style={styles.inviteTop}>
                    <View>
                      <ThemedText type="smallBold">{t('trustedInviteReady', language)}</ThemedText>
                      <ThemedText type="meta" themeColor="textTertiary">
                        {secondsLeft > 0
                          ? tf('trustedInviteCountdown', {
                              minutes: Math.floor(secondsLeft / 60),
                              seconds: String(secondsLeft % 60).padStart(2, '0'),
                            }, language)
                          : t('trustedInviteExpired', language)}
                      </ThemedText>
                    </View>
                    <View style={[styles.timer, { borderColor: secondsLeft > 0 ? theme.primaryBorder : theme.cardBorder }]}>
                      <ThemedText type="nano" tabular style={{ color: secondsLeft > 0 ? theme.primary : theme.textTertiary }}>
                        {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
                      </ThemedText>
                    </View>
                  </View>
                  <ThemedText type="meta" themeColor="textSecondary">
                    {t('trustedInvitePrivacy', language)}
                  </ThemedText>
                  <Button
                    label={secondsLeft > 0 ? t('trustedShareInvite', language) : t('trustedNewInvite', language)}
                    icon={secondsLeft > 0 ? 'upload' : 'repeat'}
                    onPress={secondsLeft > 0 ? () => void shareInvite() : () => void makeInvite()}
                  />
                </Block>
              )}
            </Section>
          )}

          {config && owner && (
            <Section index={4} style={styles.dangerSection}>
              <SectionHeader title={t('trustedVaultHeader', language)} />
              <ThemedText type="meta" themeColor="textTertiary">
                {t('trustedVaultBody', language)}
              </ThemedText>
              <Button
                label={t('trustedDeleteVaultAction', language)}
                variant="danger"
                icon="trash"
                disabled={busy || offline}
                onPress={confirmDeleteVault}
              />
            </Section>
          )}
        </ScrollView>
      </SafeAreaView>

      <BottomSheet
        visible={joinVisible}
        onClose={() => {
          setNotice(null);
          setJoinVisible(false);
        }}
        title={t('trustedJoinSheetTitle', language)}>
        <ThemedText type="default" themeColor="textSecondary">
          {t('trustedJoinSheetBody', language)}
        </ThemedText>
        <View style={styles.field}>
          <ThemedText type="micro" themeColor="textTertiary">{t('trustedDeviceName', language)}</ThemedText>
          <TextInput
            value={joinName}
            onChangeText={setJoinName}
            maxLength={60}
            autoCapitalize="words"
            accessibilityLabel={t('trustedDeviceName', language)}
            placeholder={suggestedName}
            placeholderTextColor={theme.textTertiary}
            style={[styles.input, { color: theme.text, borderColor: theme.cardBorderStrong, backgroundColor: theme.backgroundElement }]}
          />
        </View>
        <View style={styles.field}>
          <ThemedText type="micro" themeColor="textTertiary">{t('trustedInviteCode', language)}</ThemedText>
          <TextInput
            value={joinCode}
            onChangeText={setJoinCode}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={t('trustedInviteCode', language)}
            placeholder={t('trustedInvitePlaceholder', language)}
            placeholderTextColor={theme.textTertiary}
            style={[styles.input, styles.codeInput, { color: theme.text, borderColor: theme.cardBorderStrong, backgroundColor: theme.backgroundElement }]}
          />
        </View>
        {noticeBlock}
        <Button
          label={busy ? t('trustedJoining', language) : t('trustedJoinAction', language)}
          disabled={busy || !joinCode.trim() || !validTrustedDeviceName(joinName)}
          onPress={() => void join()}
        />
      </BottomSheet>

      <BottomSheet
        visible={!!selected}
        onClose={closeSelected}
        title={t('trustedManageDevice', language)}>
        {selected && (
          <>
            <View style={styles.selectedHero}>
              <View style={[styles.selectedIcon, { backgroundColor: theme.primarySoft }]}>
                <Icon name="phone" size={23} color={theme.primary} />
              </View>
              <View style={styles.flex}>
                <ThemedText type="subtitle">{selected.name ?? t('trustedUnnamed', language)}</ThemedText>
                <ThemedText type="meta" themeColor="textTertiary">
                  {t(selected.role === 'owner' ? 'trustedRoleOwner' : 'trustedRoleMember', language)} · {relativeSeen(selected.lastSeenAt, language)}
                </ThemedText>
              </View>
            </View>
            {canManageSelected && (
              <View style={styles.field}>
                <ThemedText type="micro" themeColor="textTertiary">{t('trustedDeviceName', language)}</ThemedText>
                <TextInput
                  value={rename}
                  onChangeText={setRename}
                  maxLength={60}
                  autoCapitalize="words"
                  accessibilityLabel={t('trustedDeviceName', language)}
                  style={[styles.input, { color: theme.text, borderColor: theme.cardBorderStrong, backgroundColor: theme.backgroundElement }]}
                />
                <Button
                  label={t('save', language)}
                  variant="outline"
                  disabled={busy || !validTrustedDeviceName(rename) || rename.trim() === (selected.name ?? '')}
                  onPress={() => void saveName()}
                />
              </View>
            )}
            {ownerIsProtected ? (
              <Block style={[styles.protected, { backgroundColor: theme.primarySoft, borderColor: theme.primaryBorder }]}>
                <Icon name="lock" size={16} color={theme.primary} />
                <ThemedText type="meta" themeColor="textSecondary" style={styles.flex}>
                  {t('trustedOwnerProtectedBody', language)}
                </ThemedText>
              </Block>
            ) : canManageSelected ? (
              <Button
                label={selected.isCurrent ? t('trustedLeaveAction', language) : t('trustedRemoveAction', language)}
                variant="danger"
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
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center' },
  safe: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  header: { paddingHorizontal: ScreenPadding },
  content: { paddingHorizontal: ScreenPadding, paddingBottom: Spacing.six, gap: Spacing.four + 2 },
  flex: { flex: 1 },
  hero: { gap: Spacing.three },
  heroTop: { flexDirection: 'row', alignItems: 'center', width: 202, alignSelf: 'center', marginBottom: Spacing.one },
  heroIcon: { width: 50, height: 50, borderRadius: 25, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  linkLine: { height: 1, flex: 1 },
  truthBand: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.three },
  notice: { gap: Spacing.two },
  noticeTitle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  privateNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, marginBottom: Spacing.three },
  noticeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  actions: { gap: Spacing.two, marginBottom: Spacing.two },
  offline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: 1, borderRadius: Radius.control, padding: Spacing.three, marginBottom: Spacing.two },
  deviceList: { borderWidth: 1, borderRadius: Radius.sheet, overflow: 'hidden' },
  deviceRow: { minHeight: 74, paddingHorizontal: Spacing.three, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 2 },
  deviceAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  deviceCopy: { flex: 1, gap: Spacing.half },
  deviceTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  badge: { borderRadius: Radius.chip, paddingHorizontal: 6, paddingVertical: 3 },
  inviteCard: { gap: Spacing.three },
  inviteTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  timer: { borderWidth: 1, borderRadius: Radius.chip, paddingHorizontal: Spacing.two, paddingVertical: 6 },
  dangerSection: { gap: Spacing.two },
  field: { gap: Spacing.two },
  input: { minHeight: 50, borderWidth: 1, borderRadius: Radius.control, paddingHorizontal: Spacing.three, fontSize: 15, textAlign: 'auto' },
  codeInput: {
    minHeight: 96,
    paddingTop: Spacing.three,
    textAlignVertical: 'top',
    textAlign: 'left',
    writingDirection: 'ltr',
    fontFamily: 'GeistMono-Regular',
    fontSize: 12,
  },
  selectedHero: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  selectedIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  protected: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
});
