import React, { useEffect, useMemo, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { COIN_MOVE, nativeDriver, useAnimatedNumber } from '@/components/ui/coins/coin-motion';
import { Icon } from '@/components/ui/icon';
import { BandPalettes, type BandPalette } from '@/constants/theme';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useMotionPreference } from '@/hooks/use-reduced-motion';
import { tapped } from '@/lib/haptics';
import { limitFillPercent } from '@/lib/limit-status';
import { blendHex } from '@/lib/spending-calendar-tiles';
import { cardUsage } from '@/lib/money-places';
import { cardUsageStatus } from '@/lib/money-places-band';
import type { Account } from '@/lib/types';

import {
  CARD_HEIGHT,
  PERSPECTIVE,
  STACK_TILT_DEG,
  cardFaceColors,
  stackLayout,
} from '@/components/card-stack/card-face';

/**
 * The user's credit cards as a stack of card faces above the Payment cards
 * rows: which card is which (its own colour, bank and last four) and how much
 * of its limit is in use (a fill along the bottom edge in the limit status
 * colour, drawn only where `cardUsage` knows the figure — the same rule as
 * Accounts' usage bar).
 *
 * Purely decorative: the whole drawing is hidden from assistive tech and from
 * keyboard focus. Every row, written figure and spoken label stays in the list
 * below it, so a screen reader hears each card once, exactly as before. A tap
 * on a face is a shortcut to what tapping that card's row opens.
 *
 * Stacked, the cards lie offset and tilted; a tap fans them out into a list on
 * the app's one spring, and the chevron folds them back. Reduce Motion or a
 * running screen reader keeps the same stack and fans or folds it at once.
 * Larger Text draws no faces at all: a face would have to grow with its text,
 * and a tall pile of hidden faces would only push the rows the person uses
 * down the screen. One card is one face, with nothing to fan.
 */
export function CardStack({ cards, palette, labelFor, onOpen }: {
  cards: readonly Account[];
  /** The Accounts band's sheet tokens (status colours, track). */
  palette: BandPalette;
  /** The bank name a card's row shows. */
  labelFor: (card: Account) => string;
  /** What tapping the card's row opens. */
  onOpen: (card: Account) => void;
}) {
  const { reducedMotion } = useMotionPreference();
  const large = useLargeTextLayout();
  const stacked = cards.length > 1 && !large;
  const [fanned, setFanned] = useState(false);
  // The container keeps the fanned height until a fold has finished, so the
  // cards travel up inside it (paint only) before the rows below move.
  const [tall, setTall] = useState(false);
  const progress = useAnimatedNumber(0);

  useEffect(() => {
    if (!stacked) return;
    const target = fanned ? 1 : 0;
    if (reducedMotion) {
      progress.setValue(target);
      if (!fanned) setTall(false);
      return;
    }
    const run = Animated.spring(progress, { toValue: target, ...COIN_MOVE, useNativeDriver: nativeDriver });
    run.start(({ finished }) => {
      if (finished && !fanned) setTall(false);
    });
    // A tap mid-fold carries on from wherever the cards are, so reversing
    // never snaps them to the far end first.
    return () => run.stop();
  }, [fanned, stacked, reducedMotion, progress]);

  const layout = useMemo(() => stackLayout(cards.length), [cards.length]);
  // Built once per stack size, not on every store update that re-renders Accounts.
  const motion = useMemo(() => layout.placements.map((place) => ({
    translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [place.stackedOffset, 0] }),
    scale: progress.interpolate({ inputRange: [0, 1], outputRange: [place.stackedScale, 1] }),
    rotateX: progress.interpolate({ inputRange: [0, 1], outputRange: [`${STACK_TILT_DEG}deg`, '0deg'] }),
    // On a dark sheet a darkened back card disappears; it is shaded half as much there.
    shade: progress.interpolate({ inputRange: [0, 1], outputRange: [place.stackedShade * (palette.scheme === 'dark' ? 0.5 : 1), 0] }),
    // A card behind the front one shows only its coloured edge stacked;
    // its words appear as it fans out.
    words: place.depth === 0 ? 1 : progress.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 0, 1] }),
  })), [layout, palette.scheme, progress]);

  if (cards.length === 0 || large) return null;

  const toggle = () => {
    tapped();
    const next = !fanned;
    if (next) setTall(true);
    setFanned(next);
  };

  const hidden = {
    accessibilityElementsHidden: true,
    importantForAccessibility: 'no-hide-descendants' as const,
  };

  if (!stacked) {
    return (
      <View {...hidden} testID="card-stack" style={styles.list}>
        {cards.map((card) => (
          <Pressable key={card.id} focusable={false} testID={`card-stack-face-${card.id}`}
            onPress={() => onOpen(card)} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
            <CardFace card={card} palette={palette} label={labelFor(card)} large={large} />
          </Pressable>
        ))}
      </View>
    );
  }

  const shadeColor = BandPalettes.light.home.band;
  const order = cards.map((card, index) => ({ card, index })).reverse();

  return (
    <View {...hidden} testID="card-stack" style={styles.stackRoot}>
      <Pressable focusable={false} disabled={fanned} onPress={toggle} testID="card-stack-collapsed"
        style={{ height: tall || fanned ? layout.fannedHeight : layout.stackedHeight }}>
        {order.map(({ card, index }) => {
          const place = layout.placements[index]!;
          const { translateY, scale, rotateX, shade, words } = motion[index]!;
          return (
            <Animated.View key={card.id} style={[styles.placed, {
              top: place.fannedTop,
              transform: [{ perspective: PERSPECTIVE }, { translateY }, { rotateX }, { scale }],
            }]}>
              <Pressable focusable={false} disabled={!fanned} onPress={() => onOpen(card)}
                testID={`card-stack-face-${card.id}`} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
                <CardFace card={card} palette={palette} label={labelFor(card)} large={false} words={words} />
                <Animated.View pointerEvents="none"
                  style={[styles.shade, { backgroundColor: shadeColor, opacity: shade }]} />
              </Pressable>
            </Animated.View>
          );
        })}
      </Pressable>
      <Pressable focusable={false} onPress={toggle} testID="card-stack-toggle" style={styles.toggle}>
        <View style={fanned ? styles.flipped : undefined}>
          <Icon name="chevron-down" size={20} color={palette.textSecondary} />
        </View>
      </Pressable>
    </View>
  );
}

/** One card face: its colour, bank, last four, and the usage fill along its bottom edge. */
function CardFace({ card, palette, label, large, words = 1 }: {
  card: Account;
  palette: BandPalette;
  label: string;
  large: boolean;
  words?: number | Animated.AnimatedInterpolation<number>;
}) {
  const colors = cardFaceColors(card.color, palette.scheme);
  const usage = cardUsage(card);
  const status = usage ? cardUsageStatus(usage) : null;
  // Drawn from the face's own ink so it reads on any card colour in both
  // themes; near and over keep their warning colours.
  const fill = status === 'over' ? palette.statusOver : status === 'near' ? palette.statusNear : colors.text;
  const track = blendHex(colors.text, colors.face, 0.22);
  return (
    <View style={[styles.face, large ? styles.faceGrow : styles.faceFixed,
      { backgroundColor: colors.face, borderColor: colors.edge }]}>
      <Animated.View style={[styles.words, { opacity: words }]}>
        <ThemedText type="smallBold" numberOfLines={large ? undefined : 1} style={{ color: colors.text }}>
          {label}
        </ThemedText>
        {card.last4 ? (
          <ThemedText type="meta" style={{ color: colors.text }}>{`•• ${card.last4}`}</ThemedText>
        ) : null}
      </Animated.View>
      {usage ? (
        <View testID={`card-stack-usage-${card.id}`} style={[styles.track, { backgroundColor: track }]}>
          <View testID={`card-stack-fill-${card.id}`}
            style={[styles.fill, { width: `${limitFillPercent(usage.usedFils, usage.limitFils)}%`, backgroundColor: fill }]} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 10, marginBottom: 12 },
  stackRoot: { marginBottom: 4 },
  placed: { position: 'absolute', start: 0, end: 0 },
  face: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    justifyContent: 'space-between',
    overflow: 'hidden',
    gap: 10,
  },
  faceFixed: { height: CARD_HEIGHT },
  faceGrow: { minHeight: CARD_HEIGHT },
  words: { gap: 2, alignItems: 'flex-start' },
  track: { height: 6, borderRadius: 3, overflow: 'hidden', width: '100%' },
  fill: { height: '100%', borderRadius: 3 },
  shade: { ...StyleSheet.absoluteFillObject, borderRadius: 16 },
  toggle: { alignSelf: 'center', minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  flipped: { transform: [{ rotate: '180deg' }] },
});
