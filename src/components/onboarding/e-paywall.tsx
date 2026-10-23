/**
 * E9 · The paywall (ink), with the person's pattern behind it.
 *
 * It sells exactly what Pro gates — capture that runs by itself — tied to
 * what they just set up (their watched category's limit, their reminders),
 * and it is honest about the trial: Wafra's own free days from first launch,
 * no card, and at the end automatic capture pauses, nothing is charged and
 * the ledger stays (purchases.ts). No "we remind you" step: the app sends no
 * trial-ending reminder, so none is promised.
 *
 * Plans come from the real billing layer (Superwall via useWafraBilling):
 * the storefront's own price strings, the same purchase call, legal-link and
 * outcome handling as the Pro screen. A plan the store did not return is
 * shown as unavailable, never at a guessed price. "Start the free N days"
 * is always there and never needs the store.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, Easing, Linking, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { E_GUTTER, EBody, EHeadline, EStepFrame, ETextAction, fitPatternTile } from '@/components/onboarding/e-frame';
import { STEP_ARRIVE_DELAY_MS, useStepPhase } from '@/components/onboarding/e-motion';
import { PATTERN_MOSAIC_TOP } from '@/components/onboarding/e-pattern';
import { useWafraBilling, type ProPlanOffer, type ProPurchaseOutcome } from '@/components/superwall-billing-context';
import { ThemedText } from '@/components/themed-text';
import { EButton } from '@/components/ui/band/e-button';
import { CoinToken } from '@/components/ui/coins/coin-token';
import { COIN_MOVE, COIN_RISE, nativeDriver, useAnimatedNumber } from '@/components/ui/coins/coin-motion';
import { PatternMosaic } from '@/components/ui/pattern-mosaic';
import type { BandPalette } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useMotionPreference } from '@/hooks/use-reduced-motion';
import { t, tf } from '@/lib/i18n';
import { trialTimeline } from '@/lib/onboarding-e';
import { onboardingECopy } from '@/lib/onboarding-e-copy';
import { compactPattern, patternSize, type PatternTile } from '@/lib/pattern';
import { configuredPublicUrl } from '@/lib/public-links';
import { PLAN_ORDER, planChargeTimingKey, planPeriod } from '@/lib/pro-plans';
import { billingStore, yearlySavingPercent, type ProPlan } from '@/lib/purchases';

/** How strongly the pattern shows behind the paywall's words, per scheme. */
const BACKDROP_LIGHT = 0.42;
const BACKDROP_DARK = 0.62;
export function paywallBackdropOpacity(scheme: 'light' | 'dark'): number {
  return scheme === 'dark' ? BACKDROP_DARK : BACKDROP_LIGHT;
}
/** The backdrop's top, under the safe area: just below the header's 52pt row. */
export const PAYWALL_BACKDROP_TOP = 56;

type Notice = { title: string; body: string } | null;

/**
 * The Pro screen's purchase rules, for onboarding: refuse before the store is
 * asked when the legal links or the storefront are missing, and report the
 * store's answer literally — a cancellation is not a failure, a deferred
 * approval is not a purchase.
 */
function useOnboardingCheckout(enabled: boolean, onPurchased: () => void) {
  const billing = useWafraBilling();
  const billingRef = useRef(billing);
  billingRef.current = billing;
  const checkoutReady = billing.available && billing.configured;
  const [offers, setOffers] = useState<ProPlanOffer[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [plan, setPlan] = useState<ProPlan>('yearly');
  const [busy, setBusy] = useState<'purchase' | 'restore' | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const latch = useRef(false);
  const request = useRef(0);
  const legalReady = configuredPublicUrl('privacyPolicyUrl') !== null && configuredPublicUrl('termsOfUseUrl') !== null;

  const load = useCallback(async () => {
    if (!enabled || !checkoutReady) { setState('unavailable'); return; }
    const id = ++request.current;
    setState('loading');
    setOffers([]);
    const loaded = await billingRef.current.fetchProOffers().catch(() => [] as ProPlanOffer[]);
    if (id !== request.current) return;
    setOffers(loaded);
    setState(loaded.length > 0 ? 'ready' : 'unavailable');
    setPlan((current) => loaded.some((offer) => offer.plan === current) ? current : loaded[0]?.plan ?? current);
  }, [checkoutReady, enabled]);

  useEffect(() => {
    void load();
    return () => { request.current += 1; };
  }, [load]);

  const selected = state === 'ready' ? offers.find((offer) => offer.plan === plan) ?? null : null;

  const purchase = async () => {
    if (latch.current) return;
    setNotice(null);
    if (!legalReady) { setNotice({ title: t('purchaseUnavailable'), body: t('purchaseLegalMissingBody') }); return; }
    if (!checkoutReady) {
      setNotice({ title: t('purchaseUnavailable'), body: billing.configurationError ? t('purchaseFailedBody') : t('playOnlyBody') });
      return;
    }
    if (!selected) { setNotice({ title: t('priceUnavailable'), body: t('priceUnavailableBody') }); return; }
    latch.current = true;
    setBusy('purchase');
    let outcome: ProPurchaseOutcome;
    try {
      outcome = await billing.purchasePro(selected.productId);
    } catch {
      outcome = 'failed';
    } finally {
      latch.current = false;
      setBusy(null);
    }
    if (outcome === 'cancelled') return;
    if (outcome === 'purchased') { onPurchased(); return; }
    if (outcome === 'pending') { setNotice({ title: t('purchasePendingTitle'), body: t('purchasePendingBody') }); return; }
    if (outcome === 'unavailable') { setNotice({ title: t('purchaseUnavailable'), body: t('playOnlyBody') }); return; }
    setNotice({ title: t('purchaseFailed'), body: t('purchaseFailedBody') });
  };

  const restore = async () => {
    if (latch.current) return;
    setNotice(null);
    if (!checkoutReady) { setNotice({ title: t('restoreFailed'), body: t('restoreFailedBody') }); return; }
    latch.current = true;
    setBusy('restore');
    let restored: boolean | null;
    try {
      restored = await billing.restorePro();
    } catch {
      restored = null;
    } finally {
      latch.current = false;
      setBusy(null);
    }
    if (restored === null) setNotice({ title: t('restoreFailed'), body: t('restoreFailedBody') });
    else if (!restored) setNotice({ title: t('noPurchaseFound'), body: t('noPurchaseFoundBody') });
    else onPurchased();
  };

  return { checkoutReady, offers, state, plan, setPlan, selected, busy, notice, setNotice, purchase, restore, load };
}

/**
 * One plan. The yearly card adds "Most popular", the saving against a year of
 * weekly payments (from the store's own two prices, absent when it cannot be
 * compared) and the store SDK's per-week figure, all smaller than the billed
 * price, which stays the clearest number on the card.
 */
function PlanCard({ offer, plan, selected, onPress, palette, savingPercent }: {
  offer: ProPlanOffer | null;
  plan: ProPlan;
  selected: boolean;
  onPress: () => void;
  palette: BandPalette;
  savingPercent: number | null;
}) {
  const words = onboardingECopy(useLanguage());
  const label = plan === 'yearly' ? words.planYearly : words.planWeekly;
  const period = planPeriod(plan);
  if (!offer) {
    return <View accessible accessibilityLabel={`${label}. ${t('priceUnavailable')}`}
      style={[styles.plan, { borderColor: palette.bandRule }]} testID={`onboarding-plan-${plan}-unavailable`}>
      <ThemedText type="smallBold" style={{ color: palette.onBand }}>{label}</ThemedText>
      <ThemedText type="meta" style={{ color: palette.onBandSecondary }}>{t('priceUnavailable')}</ThemedText>
    </View>;
  }
  const yearly = plan === 'yearly';
  const saving = yearly && savingPercent !== null ? tf('proSavePercent', { percent: savingPercent }) : null;
  const perWeek = yearly && offer.weeklyPriceString ? tf('proYearlyPerWeek', { price: offer.weeklyPriceString }) : null;
  const spoken = [label, yearly ? t('proMostPopular') : null, saving, `${offer.priceString} ${period}`, perWeek]
    .filter(Boolean).join(' · ');
  return <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }}
    accessibilityLabel={spoken} testID={`onboarding-plan-${plan}`}
    onPress={onPress}
    style={({ pressed }) => [styles.plan, {
      borderColor: selected ? palette.accent : palette.bandRule,
      borderWidth: selected ? 2 : 1.5,
      backgroundColor: selected ? palette.tile : 'transparent',
      opacity: pressed ? 0.85 : 1,
    }]}>
    <View style={[styles.radio, { borderColor: selected ? palette.accent : palette.onBandSecondary }]}>
      {selected ? <View style={[styles.radioDot, { backgroundColor: palette.accent }]} /> : null}
    </View>
    <ThemedText type="smallBold" style={{ color: palette.onBand }}>{label}</ThemedText>
    {yearly ? <ThemedText type="meta" style={{ color: palette.accentOnBand }} testID="onboarding-plan-yearly-popular">
      {saving ? `${t('proMostPopular')} · ${saving}` : t('proMostPopular')}
    </ThemedText> : null}
    <ThemedText type="smallBold" tabular style={{ color: palette.onBand }}>{offer.priceString}</ThemedText>
    <ThemedText type="meta" style={{ color: palette.onBandSecondary }}>{period}</ThemedText>
    {perWeek ? <ThemedText type="meta" tabular style={{ color: palette.onBandSecondary }} testID="onboarding-plan-yearly-per-week">
      {perWeek}
    </ThemedText> : null}
  </Pressable>;
}

/**
 * What the decoration draws, in a 46 × 50 box: the category tile at the bottom
 * start, two coins already resting at its foot (the tray), and room above the
 * tile for the next coin to fall through in plain sight.
 */
const DROP_TILE = 30;
const DROP_COIN = 12;
const DROP_ROOM = 20;
const TRAY_COIN = 12;
const KEEPS_WIDTH = 46;
const KEEPS_HEIGHT = DROP_ROOM + DROP_TILE;
/** The falling coin starts wholly above the tile and lands centred on its face. */
const COIN_START = (DROP_TILE - DROP_COIN) / 2;
const COIN_FALL = DROP_ROOM + (DROP_TILE - DROP_COIN) / 2;
/** One coin's fall, its sinking into the tile, then a rest before the next. */
const FALL_MS = 620;
const SINK_MS = 240;
const REST_MS = 1500;
/** The still frame (Reduce Motion, paused, in the background): the next coin poised above the tile. */
const STILL = 0.2;
/** Where it sits: inside the 52pt top row, clear of the backdrop that starts 56pt down. */
const KEEPS_TOP = 3;
/**
 * Nothing watched: an example tile, the "other" category's glyph. It names
 * no category of theirs and carries no figure.
 */
const EXAMPLE_TILE: PatternTile = { key: 'watch:example', group: 'watch', kind: 'glyph', col: 0, row: 0,
  color: 'sand', mark: 'green', category: 'other', order: 0 };

/**
 * What Pro keeps doing, as a quiet loop in the header's corner: a coin
 * falls onto their own watched category's tile (the one in their pattern)
 * and sinks into it, one at a time, beside the coins it has already taken —
 * the way each alert lands by itself. Decoration only: hidden
 * from assistive tech, untouchable, a fixed size so nothing around it moves.
 * It holds still under Reduce Motion or a screen reader, while a purchase or
 * restore is busy, and while the app is not in the foreground; core Animated
 * on the native driver, stopped when it unmounts.
 */
export function KeepsGoing({ tile, paused }: { tile: PatternTile | null; paused: boolean }) {
  const { ready, reducedMotion } = useMotionPreference();
  const drop = useAnimatedNumber(STILL);
  const sink = useAnimatedNumber(0);
  const dip = useAnimatedNumber(0);
  useEffect(() => {
    const rest = () => { drop.setValue(STILL); sink.setValue(0); dip.setValue(0); };
    if (reducedMotion || !ready || paused) { rest(); return; }
    let loop: Animated.CompositeAnimation | null = null;
    const start = () => {
      if (loop) return;
      drop.setValue(0);
      sink.setValue(0);
      dip.setValue(0);
      loop = Animated.loop(Animated.sequence([
        Animated.timing(drop, { toValue: 1, duration: FALL_MS, easing: Easing.in(Easing.quad), useNativeDriver: nativeDriver }),
        // The coin lands on the tile's face and sinks into it; the tile takes it with a small dip.
        Animated.parallel([
          Animated.timing(sink, { toValue: 1, duration: SINK_MS, easing: Easing.in(Easing.quad), useNativeDriver: nativeDriver }),
          Animated.sequence([
            Animated.timing(dip, { toValue: 1, duration: 90, useNativeDriver: nativeDriver }),
            Animated.spring(dip, { toValue: 0, ...COIN_RISE, useNativeDriver: nativeDriver }),
          ]),
        ]),
        Animated.delay(REST_MS),
        Animated.timing(drop, { toValue: 0, duration: 0, useNativeDriver: nativeDriver }),
        Animated.timing(sink, { toValue: 0, duration: 0, useNativeDriver: nativeDriver }),
      ]));
      loop.start();
    };
    const stop = () => {
      loop?.stop();
      loop = null;
      rest();
    };
    if (AppState.currentState !== 'background') start();
    const subscription = AppState.addEventListener('change', (next) => { if (next === 'active') start(); else stop(); });
    return () => {
      subscription.remove();
      stop();
    };
  }, [dip, drop, paused, ready, reducedMotion, sink]);
  const paint = useMemo(() => ({
    coin: {
      opacity: Animated.multiply(
        drop.interpolate({ inputRange: [0, 0.08, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' }),
        sink.interpolate({ inputRange: [0, 1], outputRange: [1, 0], extrapolate: 'clamp' })),
      transform: [
        { translateY: drop.interpolate({ inputRange: [0, 1], outputRange: [0, COIN_FALL] }) },
        { scale: sink.interpolate({ inputRange: [0, 1], outputRange: [1, 0.4], extrapolate: 'clamp' }) },
      ],
    },
    tile: {
      transform: [
        { translateY: dip.interpolate({ inputRange: [0, 1], outputRange: [0, 3] }) },
        { scale: dip.interpolate({ inputRange: [0, 1], outputRange: [1, 0.95] }) },
      ],
    },
  }), [dip, drop, sink]);
  return <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
    style={styles.keepsGoing} testID="onboarding-paywall-keeps-going">
    <Animated.View style={[styles.dropTile, paint.tile]} testID="onboarding-paywall-keeps-going-tile">
      <PatternMosaic tiles={[tile ?? EXAMPLE_TILE]} tile={DROP_TILE} compact accessibilityLabel="" />
    </Animated.View>
    {/* The tray: coins this tile has already taken, resting at its foot. */}
    <View style={[styles.trayCoin, { start: DROP_TILE - TRAY_COIN / 2 }]}><CoinToken size={TRAY_COIN} /></View>
    <View style={[styles.trayCoin, { start: DROP_TILE + TRAY_COIN / 3 }]}><CoinToken size={TRAY_COIN} /></View>
    {/* Drawn last, over the tile: the coin falls in plain sight and lands on the tile's face. */}
    <Animated.View style={[styles.dropCoin, paint.coin]} testID="onboarding-paywall-keeps-going-coin">
      <CoinToken size={DROP_COIN} />
    </Animated.View>
  </View>;
}

/**
 * The backdrop arriving from the pattern reveal (same ink band, no wipe):
 * it starts where the reveal's mosaic stood (PATTERN_MOSAIC_TOP), at full
 * strength, and once the reveal's words have gone it rises the difference and
 * dims into its place behind the paywall's words. Read once, when the paywall
 * appears. Otherwise (Reduce Motion, a screen reader, or from anywhere else)
 * it is simply dimmed in its place and fades with the step.
 */
function useBackdropSettle(fromPattern: boolean, dim: number) {
  const { ready, reducedMotion } = useMotionPreference();
  const [settling] = useState(() => fromPattern && ready && !reducedMotion);
  const settle = useAnimatedNumber(settling ? 0 : 1);
  useEffect(() => {
    if (!settling) return;
    const run = Animated.sequence([Animated.delay(STEP_ARRIVE_DELAY_MS),
      Animated.spring(settle, { toValue: 1, ...COIN_MOVE, useNativeDriver: nativeDriver })]);
    run.start();
    return () => { run.stop(); settle.setValue(1); };
  }, [settle, settling]);
  return useMemo(() => ({
    settling,
    place: { transform: [{ translateY: settle.interpolate({ inputRange: [0, 1],
      outputRange: [PATTERN_MOSAIC_TOP - PAYWALL_BACKDROP_TOP, 0] }) }] },
    dimming: { opacity: settling ? settle.interpolate({ inputRange: [0, 1], outputRange: [1, dim], extrapolate: 'clamp' }) : dim },
  }), [dim, settle, settling]);
}

export function PaywallStep({ tiles, watchedCategory, remindersOn, trialDays, captureOn, onFinish, onBack, onClose, preview, finishing,
  arrivedFrom = null }: {
  tiles: readonly PatternTile[];
  /** The first watched category's name, if they set a limit. */
  watchedCategory: string | null;
  /** Whether notifications for reminders were allowed. */
  remindersOn: boolean;
  /** Whole free days left (trialDaysLeft), 0 when the trial is over. */
  trialDays: number;
  /** Whether automatic capture is actually on for this person right now. */
  captureOn: boolean;
  /** Leave onboarding: after a purchase, a restore, or the free days. */
  onFinish: () => void;
  onBack?: () => void;
  onClose?: () => void;
  /** The Settings preview never buys. */
  preview: boolean;
  finishing: boolean;
  /**
   * The step this one arrived from, while it is still fading (the gate's
   * leaving step). From the pattern reveal, the backdrop starts as that
   * step's mosaic — same place, full strength — and settles up into its
   * dimmed place, so the picture never vanishes and comes back.
   */
  arrivedFrom?: string | null;
}) {
  const words = onboardingECopy(useLanguage());
  const band = useBand('home');
  const largeText = useLargeTextLayout();
  const tile = fitPatternTile(useWindowDimensions().width, 52);
  // Packed as Home's header draws it, so the backdrop is the picture they will land on.
  const backdrop = compactPattern(tiles);
  const backdropSize = patternSize(tile, Math.max(2, Math.round((tile * 6) / 52)), backdrop.columns, backdrop.rows);
  const watchTile = tiles.find((item) => item.group === 'watch') ?? null;
  const insets = useSafeAreaInsets();
  // The step layer's fade (in the gate), so the drawings outside the frame arrive and leave with it.
  const phase = useStepPhase();
  const checkout = useOnboardingCheckout(!preview, onFinish);
  // After the checkout's own state (its hooks keep their order).
  const dim = paywallBackdropOpacity(band.scheme);
  const backdrop_ = useBackdropSettle(arrivedFrom === 'pattern', dim);
  const timeline = trialTimeline(trialDays);
  // From the two prices this storefront returned; null leaves the saving out.
  const savingPercent = checkout.state === 'ready' ? yearlySavingPercent(checkout.offers) : null;
  const store = billingStore();
  const privacyUrl = configuredPublicUrl('privacyPolicyUrl');
  const termsUrl = configuredPublicUrl('termsOfUseUrl');
  const busy = checkout.busy !== null || finishing;
  const freeLabel = trialDays > 0 ? words.startFree(trialDays) : words.continueFree;
  // Without a Pro button (the web, a store that is not there), the free way on
  // is the screen's one action, so it is drawn as one rather than as a link.
  const proShown = checkout.state !== 'unavailable';
  const openLegal = (url: string) => {
    void Linking.openURL(url).catch(() => checkout.setNotice({ title: t('legalLinkFailed'), body: t('legalLinkFailedBody') }));
  };
  return <View style={styles.root}>
    {/* Both drawings sit outside EStepFrame, so they take the step's own fade (phase.paint): they
        arrive with the words, after the pattern step's mosaic has gone, and leave with them. */}
    <Animated.View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants"
      style={[styles.behind, { top: insets.top + PAYWALL_BACKDROP_TOP },
        backdrop_.settling && !phase.leaving ? backdrop_.place : phase.paint]} testID="onboarding-paywall-backdrop">
      <View style={styles.behindFrame}>
        {/* Dimmed behind the words; the dark band needs more of it for the tiles to stay visible. */}
        <Animated.View style={backdrop_.dimming} testID="onboarding-paywall-backdrop-dim">
          <PatternMosaic tiles={tiles} tile={tile} compact accessibilityLabel="" />
        </Animated.View>
      </View>
    </Animated.View>
    {/* In the header's own room, beside the back control and above the backdrop: out of the
        scrolling column, so the price, plans, terms and buttons sit exactly where they would without it. */}
    <Animated.View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants"
      style={[styles.behind, { top: insets.top + KEEPS_TOP }, phase.paint]} testID="onboarding-paywall-corner">
      <View style={[styles.keepsFrame, onClose ? styles.keepsBesideClose : null]}>
        <KeepsGoing tile={watchTile} paused={busy} />
      </View>
    </Animated.View>
    <EStepFrame palette={band} step={null} onBack={onBack} onClose={onClose} backDisabled={busy} testID="onboarding-paywall"
      contentStyle={{ paddingTop: backdropSize.height + 40 }} pinActions={false}
      footer={<>
        {proShown ? <EButton palette={band}
          color={{ fill: band.accent, text: band.onAccent }}
          label={checkout.busy === 'purchase' ? t('purchaseInProgress') : words.continuePro}
          onPress={() => void checkout.purchase()} disabled={busy || preview || !checkout.selected} busy={checkout.busy === 'purchase'}
          testID="onboarding-paywall-pro" /> : null}
        {proShown ? <ETextAction palette={band} label={freeLabel} onPress={onFinish} disabled={busy} testID="onboarding-paywall-free" />
          : <EButton palette={band} color={{ fill: band.accent, text: band.onAccent }} label={freeLabel}
            onPress={onFinish} disabled={busy} testID="onboarding-paywall-free" />}
        {Platform.OS !== 'web' && !preview ? <ETextAction palette={band} label={t('restorePurchase')}
          onPress={() => void checkout.restore()} disabled={busy} testID="onboarding-paywall-restore" /> : null}
      </>}>
      <EHeadline palette={band} size={42}>{words.paywallTitle}</EHeadline>
      <EBody palette={band}>{words.paywallBody(watchedCategory, remindersOn)}</EBody>
      {timeline.length > 0 ? <View style={[styles.timeline, largeText && styles.stacked]} accessible
        accessibilityLabel={`${words.trialTimelineLabel}. ${words.trialToday}: ${captureOn ? words.trialTodayBody : words.trialTodayBodyOff} ${words.trialEnd(timeline[1]!.day)}: ${words.trialEndBody}`}
        testID="onboarding-trial-timeline">
        <View style={[styles.stage, { backgroundColor: band.tile }]}>
          <ThemedText type="smallBold" style={{ color: band.accentOnBand }}>{words.trialToday}</ThemedText>
          <ThemedText type="meta" style={{ color: band.onBand }}>{captureOn ? words.trialTodayBody : words.trialTodayBodyOff}</ThemedText>
        </View>
        <View style={[styles.stage, { backgroundColor: band.tile }]}>
          <ThemedText type="smallBold" style={{ color: band.onBand }}>{words.trialEnd(timeline[1]!.day)}</ThemedText>
          <ThemedText type="meta" style={{ color: band.onBand }}>{words.trialEndBody}</ThemedText>
        </View>
      </View> : null}
      {checkout.state === 'loading' ? <ThemedText type="meta" style={{ color: band.onBandSecondary }}>{t('priceLoading')}</ThemedText>
        : checkout.state === 'ready' ? <>
          <View style={[styles.plans, largeText && styles.stacked]} accessibilityRole="radiogroup" testID="onboarding-plans">
            {PLAN_ORDER.map((plan) => <PlanCard key={plan} plan={plan} palette={band}
              offer={checkout.offers.find((offer) => offer.plan === plan) ?? null}
              savingPercent={savingPercent}
              selected={checkout.plan === plan} onPress={() => checkout.setPlan(plan)} />)}
          </View>
          {checkout.selected ? <ThemedText type="meta" style={{ color: band.onBandSecondary }}>
            {tf(planChargeTimingKey(checkout.plan), { price: checkout.selected.priceString })}
            {' '}
            {store === 'appStore' ? t('subscriptionRenewalTermsIos') : store === 'play' ? t('subscriptionRenewalTermsAndroid') : t('proStoreConfirmsPrice')}
          </ThemedText> : null}
        </> : <View testID="onboarding-plans-unavailable">
          <ThemedText type="meta" style={{ color: band.onBandSecondary }}>
            {checkout.checkoutReady ? t('priceUnavailableBody') : t('playOnlyBody')}
          </ThemedText>
          {/* The copy asks the user to try again, so give them the control. */}
          {checkout.checkoutReady ? <Pressable accessibilityRole="button" hitSlop={8} style={styles.legalLink}
            onPress={() => void checkout.load()} testID="onboarding-plans-retry">
            <ThemedText type="smallBold" style={{ color: band.onBand }}>{t('retryPrices')}</ThemedText>
          </Pressable> : null}
        </View>}
      {checkout.notice ? <View accessibilityRole="alert" accessibilityLiveRegion="polite"
        style={[styles.notice, { backgroundColor: band.sheet }]} testID="onboarding-paywall-notice">
        <ThemedText type="smallBold" style={{ color: band.text }}>{checkout.notice.title}</ThemedText>
        <ThemedText type="meta" style={{ color: band.textSecondary }}>{checkout.notice.body}</ThemedText>
      </View> : null}
      {privacyUrl || termsUrl ? <View style={styles.legal}>
        {privacyUrl ? <Pressable accessibilityRole="link" accessibilityLabel={t('privacyPolicy')} hitSlop={8}
          onPress={() => openLegal(privacyUrl)} style={styles.legalLink}>
          <ThemedText type="meta" style={{ color: band.onBand }}>{t('privacyPolicy')}</ThemedText>
        </Pressable> : null}
        {termsUrl ? <Pressable accessibilityRole="link" accessibilityLabel={t('termsOfUse')} hitSlop={8}
          onPress={() => openLegal(termsUrl)} style={styles.legalLink}>
          <ThemedText type="meta" style={{ color: band.onBand }}>{t('termsOfUse')}</ThemedText>
        </Pressable> : null}
      </View> : null}
    </EStepFrame>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, width: '100%' },
  behind: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  // EStepFrame's own column (560 wide at most, its gutter), so the backdrop starts where the words start.
  behindFrame: { width: '100%', maxWidth: 560, paddingHorizontal: E_GUTTER, alignItems: 'flex-start' },
  keepsGoing: { width: KEEPS_WIDTH, height: KEEPS_HEIGHT },
  keepsFrame: { width: '100%', maxWidth: 560, paddingHorizontal: E_GUTTER, alignItems: 'flex-end' },
  // The close control (the Settings preview) keeps the end corner; the drawing sits just inside it.
  keepsBesideClose: { paddingEnd: E_GUTTER + 44 },
  dropCoin: { position: 'absolute', top: 0, start: COIN_START },
  dropTile: { position: 'absolute', top: DROP_ROOM, start: 0 },
  trayCoin: { position: 'absolute', top: KEEPS_HEIGHT - TRAY_COIN },
  timeline: { flexDirection: 'row', gap: 8 },
  stacked: { flexDirection: 'column' },
  stage: { flex: 1, borderRadius: 16, padding: 12, gap: 4 },
  plans: { flexDirection: 'row', gap: 8 },
  plan: { flex: 1, minHeight: 112, borderRadius: 20, padding: 14, gap: 4, borderWidth: 1.5 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  notice: { borderRadius: 16, padding: 14, gap: 4 },
  legal: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  legalLink: { minHeight: 44, maxWidth: '100%', flexShrink: 1, justifyContent: 'center' },
});
