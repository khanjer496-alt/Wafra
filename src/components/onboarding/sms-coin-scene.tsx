/**
 * Welcome's hero: what Wafra does, in one glance. A bank alert arrives (an
 * EXAMPLE: the sender is "your bank", never a named one), Wafra picks out the
 * amount and the merchant, and the amount drops off the alert as a coin and
 * arcs into the category the merchant belongs to. The example pattern rests
 * dimmed below from the first frame; the coin's arrival pops its category
 * tile and the rest of the pattern settles to full strength. The SMS permission explainer draws the same story without
 * the pattern: the coin lands in its category tile.
 *
 * Decoration with one spoken part: the example pattern keeps its own label
 * ("An example pattern"); the alert, the coin and the landing tile are hidden
 * from assistive tech and never take a touch. The alert's amount is the
 * coffee-sized sample (`sampleAmount`) in the person's currency, so a
 * yen or dinar phone never sees an AED figure; nothing here touches the store.
 *
 * Motion is core Animated on the native driver (paint only), so it runs on
 * Android too, with the coin springs. It starts only once the motion
 * preference is known, loops slowly while the app is in front, and stops on
 * unmount. Reduce Motion or a screen reader shows the composed final frame:
 * the alert with its amount and merchant marked, the coin settled on its
 * tile and the pattern in place.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, Easing, Platform, StyleSheet, View, type LayoutChangeEvent, type LayoutRectangle } from 'react-native';

import { suggestedLedgerCurrency } from '@/components/ledger-currency-sheet';
import { onboardingDeviceRegion } from '@/components/onboarding/alive-scenes';
import { ThemedText } from '@/components/themed-text';
import { GOLD } from '@/components/ui/coins/coin-disc';
import { COIN_MOVE, COIN_POP, COIN_RISE, nativeDriver, useAnimatedNumber } from '@/components/ui/coins/coin-motion';
import { CoinToken } from '@/components/ui/coins/coin-token';
import { Icon } from '@/components/ui/icon';
import { PatternMosaic } from '@/components/ui/pattern-mosaic';
import { Fonts, PatternPalette, type BandPalette } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useMotionPreference } from '@/hooks/use-reduced-motion';
import { categoryLabel, getCategory } from '@/lib/categories';
import { t } from '@/lib/i18n';
import { currencyDisplayLabel, formatMinorUnits, ledgerMoneySpec, typicalMinorAmount } from '@/lib/ledger-money';
import { onboardingAlertExamples, type AlertSegment, type AlertToken } from '@/lib/onboarding-alert-examples';
import { onboardingBankRegion } from '@/lib/onboarding-bank-examples';
import type { PatternTile } from '@/lib/pattern';
import type { CategoryId } from '@/lib/types';

/* ── the example, pure ──────────────────────────────────────────────── */

/**
 * The sample coffee purchase in `currency` — about AED 24.50, sized to the
 * currency (AED 24.50, ¥2,450, KWD 2.450, ₹245) — or a bare figure when no
 * currency is known yet. Never a silent AED on a non-AED phone. (The same
 * rule as the retired money-preview's helper of the same name.)
 */
export function sampleAmount(currency?: string | null): { text: string; spoken: string } {
  const spec = currency ? ledgerMoneySpec(currency) : null;
  if (!spec) return { text: '24.50', spoken: '24.50' };
  const figure = formatMinorUnits(Math.round(typicalMinorAmount(spec, 1) * 24.5), spec);
  return { text: `${currencyDisplayLabel(spec.currency)} ${figure}`, spoken: `${spec.currency} ${figure}` };
}

/** The category the example purchase lands in: every regional grocer is filed under Groceries. */
export const SMS_COIN_CATEGORY: CategoryId = 'groceries';

/**
 * The example purchase alert, from the regional examples, with its amount
 * replaced by the currency-sized sample (written with the ISO code, as a
 * bank's own text writes it) and any other figure (a closing balance)
 * dropped, so the only money on screen is the one the coin carries.
 */
export function smsCoinSegments(region: Parameters<typeof onboardingAlertExamples>[0], currency: string | null): readonly AlertSegment[] {
  // The alert body is a bank's English text in every language; its grocer label is English too.
  const purchase = onboardingAlertExamples(region, {
    grocery: t('onboardSceneGroceryStore', 'en'),
    electricity: t('onboardSceneElectricity', 'en'),
    salary: t('onboardSceneIncomeCategory', 'en'),
  }).find((example) => example.kind === 'purchase');
  const amount = sampleAmount(currency).spoken;
  return (purchase?.segments ?? []).map((segment): AlertSegment => segment.token === 'amount'
    ? { text: amount, token: 'amount' }
    : !segment.token && /\d/.test(segment.text) ? { text: '.' } : segment);
}

export interface SmsPiece { readonly text: string; readonly token?: AlertToken }
/** Words that wrap as one: a token and the punctuation touching it stay together. */
export interface SmsChunk { readonly pieces: readonly SmsPiece[]; readonly spaceAfter: boolean }

/** The alert split at its spaces, so each token can be measured and marked on its own. */
export function smsChunks(segments: readonly AlertSegment[]): SmsChunk[] {
  const chunks: { pieces: SmsPiece[]; spaceAfter: boolean }[] = [];
  let open = false;
  const add = (piece: SmsPiece) => {
    if (open && chunks.length) chunks[chunks.length - 1]!.pieces.push(piece);
    else chunks.push({ pieces: [piece], spaceAfter: false });
    open = true;
  };
  for (const segment of segments) {
    if (segment.token) { add({ text: segment.text, token: segment.token }); continue; }
    for (const part of segment.text.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        if (chunks.length) chunks[chunks.length - 1]!.spaceAfter = true;
        open = false;
      } else add({ text: part });
    }
  }
  return chunks;
}

/* ── the drawing ────────────────────────────────────────────────────── */

/** The pattern palette drawn on an ink band: the Welcome band is ink in both schemes. */
const ON_INK = PatternPalette.light;
const COIN = 26;
const BADGE = 18;
/** Time the composed frame rests before the alert plays again (about 9s a loop). */
const HOLD_MS = 5200;
const OUT_MS = 280;
/** The example pattern's opacity before the payment lands in it. */
export const AT_REST = 0.4;
/** The flight from the alert to the tile: timed, not sprung, so the eye can follow the arc (as Transfers' route coin). */
const FLIGHT_MS = 720;
const FLIGHT_EASE = Easing.bezier(0.65, 0, 0.35, 1);

const hidden = { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const };

type BoxKey = 'bubble' | 'wrap' | 'chunk' | 'piece' | 'example' | 'board' | 'tile' | 'badge';
interface Flight { from: { x: number; y: number }; to: { x: number; y: number } }

/**
 * Where the coin starts and lands, from measured layout. It starts just
 * outside the alert, under the amount it stands for (in the gap the scene
 * keeps for it), so it never covers a word of the alert, and lands on the
 * badge spot on the tile.
 */
export function flightFrom(boxes: Partial<Record<BoxKey, LayoutRectangle>>, pattern: boolean): Flight | null {
  const { bubble, wrap, chunk, piece, example, board, tile, badge } = boxes;
  if (!bubble || !wrap || !chunk || !piece || !tile || !badge) return null;
  if (pattern && (!example || !board)) return null;
  const base = pattern ? { x: example!.x + board!.x, y: example!.y + board!.y } : { x: board?.x ?? 0, y: board?.y ?? 0 };
  return {
    from: { x: bubble.x + wrap.x + chunk.x + piece.x + piece.width / 2, y: bubble.y + bubble.height + COIN / 2 + 1 },
    to: { x: base.x + tile.x + badge.x + badge.width / 2, y: base.y + tile.y + badge.y + badge.height / 2 },
  };
}

type Grow = Animated.Value | Animated.AnimatedInterpolation<number>;
interface ScenePaint {
  bubble: { opacity: Grow; transform: { translateY: Grow }[] };
  amountMark: Grow;
  merchantMark: Grow;
  tile: { opacity: Grow; transform: { scale: Grow }[] };
  badge: { opacity: Grow; transform: { scale: Grow }[] };
  rise: { opacity: Grow; transform: ({ translateY: Grow } | { scale: Grow })[] };
}

/** Every interpolation the scene paints with, built from its values once. */
function scenePaint(values: { bubble: Animated.Value; amountMark: Animated.Value; merchantMark: Animated.Value;
  pop: Animated.Value; settle: Animated.Value; board: Animated.Value }): ScenePaint {
  const { bubble, amountMark, merchantMark, pop, settle, board } = values;
  const span = (value: Animated.Value, from: number, to: number) => value.interpolate({ inputRange: [0, 1], outputRange: [from, to] });
  return {
    bubble: { opacity: bubble, transform: [{ translateY: span(bubble, 14, 0) }] },
    amountMark: span(amountMark, 0, 0.34),
    merchantMark: span(merchantMark, 0, 0.24),
    tile: { opacity: pop, transform: [{ scale: span(pop, 0.4, 1) }] },
    badge: { opacity: settle, transform: [{ scale: span(settle, 0.3, 1) }] },
    // At rest the example is drawn dimmed, never absent: no frame shows its caption under empty space.
    rise: { opacity: span(board, AT_REST, 1), transform: [{ translateY: span(board, 4, 0) }, { scale: span(board, 0.98, 1) }] },
  };
}

/**
 * A side offset from the start or end edge. Native lays out logically
 * (start/end) under the app's direction — the root's `direction` style and,
 * after an Arabic relaunch, I18nManager.forceRTL, whose left/right swap would
 * mirror a physical side a second time. The web build resolves start/end from
 * the device instead of the app, so there the side is physical, from the
 * app's language.
 */
export function sideFrom(rtl: boolean, platform: string = Platform.OS) {
  return (offset: number, edge: 'start' | 'end' = 'start'): { start?: number; end?: number; left?: number; right?: number } => {
    if (platform !== 'web') return edge === 'start' ? { start: offset } : { end: offset };
    const left = (edge === 'start') !== rtl;
    return left ? { left: offset } : { right: offset };
  };
}

/** The category's glyph tile, drawn as the pattern draws a glyph tile, with the coin that settled on it. */
function LandingTile({ size, model, pop, settle, onLayout, onBadgeLayout, position, rtl = false }: {
  size: number;
  model: Pick<PatternTile, 'color' | 'mark' | 'category'>;
  /** Built once per scene (see `paint`), so a re-render never swaps native nodes mid-loop. */
  pop: ScenePaint['tile'];
  settle: ScenePaint['badge'];
  onLayout: (event: LayoutChangeEvent) => void;
  onBadgeLayout: (event: LayoutChangeEvent) => void;
  position?: { start: number; top: number };
  /** The app's reading direction (its language). */
  rtl?: boolean;
}) {
  const side = sideFrom(rtl);
  return <Animated.View {...hidden} pointerEvents="none" onLayout={onLayout} testID="sms-coin-tile"
    style={[position ? { position: 'absolute', top: position.top, ...side(position.start) } : null, styles.center, {
      width: size, height: size, borderRadius: size * 10 / 52, backgroundColor: ON_INK.fill[model.color],
      ...pop,
    }]}>
    <Icon name={getCategory(model.category ?? SMS_COIN_CATEGORY).icon} size={Math.round(size * 0.46)}
      color={ON_INK.mark[model.mark ?? 'ink']} strokeWidth={2} />
    <Animated.View onLayout={onBadgeLayout} testID="sms-coin-badge" style={[styles.badge, {
      // The badge sits on the tile's end corner: its right in English, its left in Arabic.
      top: -BADGE / 3, ...side(-BADGE / 3, 'end'), ...settle,
    }]}>
      <CoinToken size={BADGE} />
    </Animated.View>
  </Animated.View>;
}

export function SmsCoinScene({ palette, sender, pattern, currency, country, language = 'en', testID }: {
  palette: BandPalette;
  /** "Your bank · example": the alert's sender, never a bank's name. */
  sender: string;
  /**
   * Welcome: the example pattern the payment lands in, spoken by `label`.
   * Absent (the SMS explainer), the coin lands in its own category tile.
   */
  pattern?: { tiles: readonly PatternTile[]; tile: number; label: string };
  /** The person's chosen or suggested currency; the phone's own guess by default. */
  currency?: string | null;
  /** A confirmed country outranks the phone's Region for the regional grocer. */
  country?: string | null;
  /** Names the landing category when there is no pattern. */
  language?: string;
  testID?: string;
}) {
  // The app's own language decides the layout's direction (the root's `direction`), whatever names the category.
  const appLanguage = useLanguage();
  // Null and absent read the same: the phone's suggested currency, from Welcome or the SMS explainer alike.
  const money = useMemo(() => currency ?? suggestedLedgerCurrency(), [currency]);
  // The same Region reader as the other onboarding scenes and the country control.
  const region = useMemo(() => onboardingBankRegion(null, country ?? onboardingDeviceRegion()), [country]);
  const chunks = useMemo(() => smsChunks(smsCoinSegments(region, money ?? region?.currency ?? null)), [region, money]);

  const landing: Pick<PatternTile, 'color' | 'mark' | 'category' | 'col' | 'row'> = useMemo(() =>
    pattern?.tiles.find((item) => item.kind === 'glyph' && item.category === SMS_COIN_CATEGORY)
      ?? { col: 0, row: 0, color: 'sand', mark: 'green', category: SMS_COIN_CATEGORY }, [pattern?.tiles]);
  const tileSize = pattern?.tile ?? 44;
  const gap = Math.max(2, Math.round((tileSize * 6) / 52));
  const inPattern = !!pattern?.tiles.some((item) => item.kind === 'glyph' && item.category === SMS_COIN_CATEGORY);

  const { ready, reducedMotion } = useMotionPreference();
  // At the accessibility text sizes the alert's words would outgrow the
  // screen; the scene keeps only the example pattern, still (no ceiling on text).
  const largeText = useLargeTextLayout();
  const still = reducedMotion || largeText;
  const initial = still ? 1 : 0;
  const bubble = useAnimatedNumber(initial);
  const amountMark = useAnimatedNumber(initial);
  const merchantMark = useAnimatedNumber(initial);
  const coin = useAnimatedNumber(initial);
  const travel = useAnimatedNumber(initial);
  const pop = useAnimatedNumber(initial);
  const settle = useAnimatedNumber(initial);
  const board = useAnimatedNumber(initial);
  // Interpolations are native nodes: build them once, not on every render of the step around the scene.
  const paint = useMemo(() => scenePaint({ bubble, amountMark, merchantMark, pop, settle, board }),
    [bubble, amountMark, merchantMark, pop, settle, board]);

  useEffect(() => {
    const all = [bubble, amountMark, merchantMark, coin, travel, pop, settle, board];
    // Interrupted or still: everything where it ends.
    const land = () => all.forEach((value) => value.setValue(1));
    if (still) { land(); return; }
    if (!ready) return;
    let alive = true;
    let running: Animated.CompositeAnimation | null = null;
    const spring = (value: Animated.Value, config: typeof COIN_MOVE | typeof COIN_POP | typeof COIN_RISE) =>
      Animated.spring(value, { toValue: 1, ...config, useNativeDriver: nativeDriver });
    const fade = (value: Animated.Value, toValue: number, duration: number) =>
      Animated.timing(value, { toValue, duration, useNativeDriver: nativeDriver });
    const play = (animation: Animated.CompositeAnimation, next: () => void) => {
      running = animation;
      animation.start(({ finished }) => { if (finished && alive) next(); });
    };
    const stop = () => { const current = running; running = null; current?.stop(); };
    const cycle = () => {
      all.forEach((value) => value.setValue(0));
      play(Animated.sequence([
        spring(bubble, COIN_MOVE),
        Animated.delay(240),
        fade(amountMark, 1, 220),
        Animated.delay(120),
        fade(merchantMark, 1, 220),
        Animated.delay(320),
        spring(coin, COIN_POP),
        Animated.parallel([
          Animated.timing(travel, { toValue: 1, duration: FLIGHT_MS, easing: FLIGHT_EASE, useNativeDriver: nativeDriver }),
          // The tile pops as the coin comes down to it; the coin settles on it as the flight ends.
          Animated.sequence([Animated.delay(FLIGHT_MS * 0.6), spring(pop, COIN_POP)]),
          Animated.sequence([Animated.delay(FLIGHT_MS - 40), spring(settle, COIN_RISE)]),
        ]),
      ]), () => {
        // The rest of the pattern settles around the tile the payment landed in.
        play(Animated.sequence([
          spring(board, COIN_RISE),
          Animated.delay(HOLD_MS),
          // The travelling coin is already gone; the rest fades before the next alert.
          Animated.parallel([bubble, amountMark, merchantMark, pop, settle, board].map((value) => fade(value, 0, OUT_MS))),
        ]), cycle);
      });
    };
    // Only while the app is in front; back in front, the alert plays again.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') { if (!running && alive) cycle(); } else { stop(); land(); }
    });
    cycle();
    return () => { alive = false; subscription.remove(); stop(); land(); };
  }, [still, ready, bubble, amountMark, merchantMark, coin, travel, pop, settle, board]);

  // Measured layout (physical points, so RTL needs no arithmetic here).
  const boxes = useRef<Partial<Record<BoxKey, LayoutRectangle>>>({});
  const [flight, setFlight] = useState<Flight | null>(null);
  const measure = useCallback((key: BoxKey) => (event: LayoutChangeEvent) => {
    boxes.current[key] = event.nativeEvent.layout;
    const next = flightFrom(boxes.current, !!pattern);
    if (!next) return;
    setFlight((previous) => previous && Math.round(previous.from.x) === Math.round(next.from.x) &&
      Math.round(previous.from.y) === Math.round(next.from.y) && Math.round(previous.to.x) === Math.round(next.to.x) &&
      Math.round(previous.to.y) === Math.round(next.to.y) ? previous : next);
  }, [pattern]);
  const onLayout = useMemo(() => ({
    bubble: measure('bubble'), wrap: measure('wrap'), chunk: measure('chunk'), piece: measure('piece'),
    example: measure('example'), board: measure('board'), tile: measure('tile'), badge: measure('badge'),
  }), [measure]);

  const amountChunk = chunks.findIndex((chunk) => chunk.pieces.some((piece) => piece.token === 'amount'));
  const markFor = (token?: AlertToken) => token === 'amount' ? { opacity: paint.amountMark, color: GOLD.face }
    : token === 'merchant' ? { opacity: paint.merchantMark, color: ON_INK.fill[landing.color] } : null;

  const alert = <Animated.View {...hidden} pointerEvents="none" onLayout={onLayout.bubble} testID="sms-coin-alert"
    style={[styles.bubble, { backgroundColor: palette.tile, borderColor: palette.bandRule, ...paint.bubble }]}>
    <View style={styles.sender}>
      <Icon name="mail" size={14} color={palette.onBandSecondary} />
      <ThemedText type="meta" style={{ color: palette.onBandSecondary }}>{sender}</ThemedText>
    </View>
    {/* A bank's text reads left to right in every language. */}
    <View style={styles.message} onLayout={onLayout.wrap}>
      {chunks.map((chunk, index) => <View key={index} style={[styles.chunk, chunk.spaceAfter ? styles.space : null]}
        onLayout={index === amountChunk ? onLayout.chunk : undefined}>
        {chunk.pieces.map((piece, at) => {
          const mark = markFor(piece.token);
          const words = <ThemedText
            style={[styles.text, { color: palette.onBand }, piece.token ? styles.token : null]}>{piece.text}</ThemedText>;
          if (!mark) return <React.Fragment key={at}>{words}</React.Fragment>;
          return <View key={at} style={styles.marked} onLayout={piece.token === 'amount' ? onLayout.piece : undefined}
            testID={`sms-coin-token-${piece.token}`}>
            <Animated.View style={[StyleSheet.absoluteFillObject, styles.mark, { backgroundColor: mark.color, opacity: mark.opacity }]} />
            {words}
          </View>;
        })}
      </View>)}
    </View>
  </Animated.View>;

  const tileNode = <LandingTile size={tileSize} model={landing} pop={paint.tile} settle={paint.badge}
    onLayout={onLayout.tile} onBadgeLayout={onLayout.badge} rtl={appLanguage === 'ar'}
    position={pattern && inPattern ? { start: landing.col * (tileSize + gap), top: landing.row * (tileSize + gap) } : undefined} />;

  const rise = paint.rise;

  const target = pattern
    ? <View style={styles.example} testID="onboarding-example-pattern" onLayout={onLayout.example}>
      <View onLayout={onLayout.board}>
        <Animated.View style={rise}>
          <PatternMosaic tiles={pattern.tiles} tile={pattern.tile} gap={gap} scheme="light" animate
            accessibilityLabel={pattern.label} />
        </Animated.View>
        {inPattern && !largeText ? tileNode : null}
      </View>
      <ThemedText type="meta" style={{ color: palette.onBandSecondary }} accessible={false}>{pattern.label}</ThemedText>
    </View>
    : <View {...hidden} pointerEvents="none" style={styles.filed} onLayout={onLayout.board}>
      {tileNode}
      <Animated.View style={[rise, styles.filedLabel]}>
        <ThemedText type="smallBold" style={{ color: palette.onBand }}>
          {categoryLabel(SMS_COIN_CATEGORY, language === 'ar' ? 'ar' : 'en')}
        </ThemedText>
      </Animated.View>
    </View>;

  if (largeText && !pattern) return null;
  return <View pointerEvents="none" style={styles.scene} testID={testID}>
    {largeText ? null : alert}
    {target}
    {flight && !largeText ? <FlyingCoin flight={flight} coin={coin} travel={travel} /> : null}
  </View>;
}

/** The amount as a coin: pops off the alert, flips once along an arc, and hands over to the badge on the tile. */
function FlyingCoin({ flight, coin, travel }: { flight: Flight; coin: Animated.Value; travel: Animated.Value }) {
  // Rebuilt only when the measured flight changes, never on an unrelated render.
  const style = useMemo(() => {
    const { from, to } = flight;
    // Bowed, but never rising back over the alert above its start.
    const lift = Math.max(0, Math.min(56, (to.y - from.y) / 4));
    const steps = [0, 0.25, 0.5, 0.75, 1];
    return {
      opacity: Animated.multiply(coin, travel.interpolate({ inputRange: [0, 0.94, 1], outputRange: [1, 1, 0] })),
      transform: [
        { perspective: 600 },
        { translateX: travel.interpolate({ inputRange: [0, 1], outputRange: [from.x - COIN / 2, to.x - COIN / 2] }) },
        { translateY: travel.interpolate({ inputRange: steps,
          outputRange: steps.map((step) => from.y + (to.y - from.y) * step - lift * 4 * step * (1 - step) - COIN / 2) }) },
        { scale: Animated.multiply(coin, travel.interpolate({ inputRange: [0, 1], outputRange: [1, BADGE / COIN] })) },
        { rotateY: travel.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
      ],
    };
  }, [flight, coin, travel]);
  return <Animated.View {...hidden} pointerEvents="none" testID="sms-coin-flying" style={[styles.flying, style]}>
    <CoinToken size={COIN} />
  </Animated.View>;
}

const styles = StyleSheet.create({
  scene: { gap: 28 },
  bubble: { alignSelf: 'stretch', gap: 6, paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: 18, borderTopStartRadius: 6, borderWidth: StyleSheet.hairlineWidth },
  sender: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  message: { direction: 'ltr', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', rowGap: 2 },
  chunk: { flexDirection: 'row', alignItems: 'center' },
  space: { marginRight: 4 },
  text: { fontFamily: Fonts.sans, fontSize: 14, lineHeight: 20, writingDirection: 'ltr', textAlign: 'left' },
  token: { fontFamily: Fonts.sansMedium },
  marked: { paddingHorizontal: 2, marginHorizontal: -2 },
  mark: { borderRadius: 5 },
  example: { gap: 10 },
  filed: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  filedLabel: { flexShrink: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute' },
  flying: { position: 'absolute', left: 0, top: 0 },
});
