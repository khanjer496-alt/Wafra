import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeInLeft,
  FadeInRight,
  FadeInUp,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { BankAvatar } from '@/components/ui/bank-avatar';
import { useCategoricalPalette } from '@/components/ui/charts';
import { Icon } from '@/components/ui/icon';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import { WafraMark } from '@/components/wafra-logo';
import { EASE, Fonts, Motion, Radius, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/hooks/use-theme';
import { shortDate, weekdayName } from '@/lib/format';
import { formatMinorUnits, type LedgerMoneySpec } from '@/lib/ledger-money';
import { figureFontMultiplier } from '@/lib/large-text-figure';
import { tapped } from '@/lib/haptics';
import { isRTL } from '@/lib/i18n';
import { recapCopy as copy } from '@/lib/recap-copy';
import type { RecapSnapshot } from '@/lib/recap';

const STORY_MS = 7_000;

/** Match Wafra's app-wide policy: screen readers suppress motion too. */
function useRecapEntering() {
  const reducedMotion = useReducedMotion();
  return <T,>(animation: T): T | undefined => reducedMotion ? undefined : animation;
}


/**
 * Larger Text caps for the story's display type, following the iOS ramp
 * (Large Title grows 1.76x at the largest size while Body grows 3.1x). Body
 * copy and labels in the story are not capped.
 */
const STORY_TITLE_MAX = 1.75;
const STORY_TITLE_SMALL_MAX = 2;
const STORY_NUMERAL_MAX = 1.5;

function HeroMoney({ fils, moneySpec, color }: { fils: number; moneySpec: LedgerMoneySpec; color?: string }) {
  const amount = formatMinorUnits(Math.abs(fils), moneySpec);
  const amountSize = amount.length >= 11
    ? styles.heroAmountTight
    : amount.length >= 8
      ? styles.heroAmountMedium
      : undefined;
  const { width, fontScale } = useWindowDimensions();
  const size = (amountSize ?? styles.heroAmount).fontSize ?? 52;
  // Never truncated: shrinks toward the story width, never under 60% of the
  // size Larger Text asked for, and wraps past that.
  const fit = figureFontMultiplier(amount.length + (fils < 0 ? 1 : 0), size, STORY_TITLE_MAX, width - 48, fontScale);
  return <View style={styles.heroMoney} accessible accessibilityLabel={`${moneySpec.currency} ${formatMinorUnits(Math.abs(fils), moneySpec)}`}>
    <ThemedText type="meta" themeColor="textSecondary" style={styles.heroCurrency}>{moneySpec.currency}</ThemedText>
    <ThemedText tabular maxFontSizeMultiplier={fit ?? STORY_TITLE_MAX} style={[styles.heroAmount, amountSize, color ? { color } : undefined]}>
      {fils < 0 ? '−' : ''}{amount}
    </ThemedText>
  </View>;
}

function MoneyText({ fils, moneySpec }: { fils: number; moneySpec: LedgerMoneySpec }) {
  return <ThemedText type="smallBold" tabular>{moneySpec.currency} {formatMinorUnits(Math.abs(fils), moneySpec)}</ThemedText>;
}

function Rule({ color }: { color: string }) {
  return <View style={[styles.rule, { backgroundColor: color }]} />;
}

function IntroMark() {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const reveal = useSharedValue(reducedMotion ? 1 : 0);
  useEffect(() => {
    if (reducedMotion) {
      reveal.value = 1;
      return;
    }
    reveal.value = withTiming(1, { duration: Motion.sectionEnter, easing: Easing.bezier(...EASE) });
    return () => cancelAnimation(reveal);
  }, [reducedMotion, reveal]);
  const motion = useAnimatedStyle(() => ({
    opacity: reveal.value,
    transform: [{ translateY: (1 - reveal.value) * 12 }, { scale: 0.94 + reveal.value * 0.06 }],
  }));
  return <Animated.View style={[styles.introMark, motion]}>
    <WafraMark size={58} />
    <View style={[styles.introMarkRule, { backgroundColor: theme.primary }]} />
  </Animated.View>;
}

function LedgerBackdrop({ variant = 0 }: { variant?: number }) {
  const theme = useTheme();
  return <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
    <View style={[styles.ledgerMargin, { backgroundColor: theme.primary }]} />
    {Array.from({ length: 6 }, (_, i) => (
      <View key={i} style={[styles.ledgerRule, { top: `${18 + i * 13}%` as `${number}%`, backgroundColor: theme.cardBorder }]} />
    ))}
    {/* A 3.5%-opacity watermark numeral: decoration, so it does not grow. */}
    <ThemedText accessible={false} allowFontScaling={false} style={[styles.pageIndex, { color: theme.text }]}>
      {String(variant + 1).padStart(2, '0')}
    </ThemedText>
  </View>;
}

function IntroScene({ snapshot }: { snapshot: RecapSnapshot }) {
  const language = useLanguage();
  const w = copy[language === 'ar' ? 'ar' : 'en'];
  const enter = useRecapEntering();
  return <View style={styles.sceneIntro}>
    <Animated.View entering={enter(FadeIn.duration(Motion.sectionEnter))}>
      <IntroMark />
    </Animated.View>
    <Animated.View entering={enter(FadeInUp.delay(80).duration(420))} style={styles.introCopy}>
      <ThemedText type="micro" themeColor="textTertiary">{w.recap} · {snapshot.descriptor.label}</ThemedText>
      <ThemedText maxFontSizeMultiplier={STORY_TITLE_MAX} style={styles.storyTitle}>{snapshot.descriptor.kind === 'year' ? w.yearIntro : w.monthIntro}</ThemedText>
      <ThemedText type="default" themeColor="textSecondary">{w.introBody}</ThemedText>
    </Animated.View>
    <Animated.View entering={enter(FadeInUp.delay(180).duration(360))} style={styles.introFooter}>
      <View style={styles.introFooterRule} />
      <ThemedText type="meta" themeColor="textTertiary">{shortDate(snapshot.from)} — {shortDate(snapshot.to)}</ThemedText>
    </Animated.View>
  </View>;
}

function SpendScene({ snapshot, moneySpec }: { snapshot: RecapSnapshot; moneySpec: LedgerMoneySpec }) {
  const language = useLanguage();
  const w = copy[language === 'ar' ? 'ar' : 'en'];
  const theme = useTheme();
  const change = snapshot.spendChangePercent;
  const enter = useRecapEntering();
  return <View style={styles.sceneSpread}>
    <Animated.View entering={enter(FadeInDown.duration(380))} style={styles.sceneHeading}>
      <ThemedText type="micro" themeColor="textTertiary">{w.spent.toUpperCase()}</ThemedText>
      <HeroMoney fils={snapshot.totalSpendFils} moneySpec={moneySpec} />
      {change !== null && <View style={[styles.changeChip, { backgroundColor: change <= 0 ? theme.primarySoft : theme.expenseSoftBg }]}>
        <Icon name={change <= 0 ? 'arrow-down-right' : 'arrow-up-right'} size={15} color={change <= 0 ? theme.income : theme.expense} />
        <ThemedText type="meta" style={{ color: change <= 0 ? theme.income : theme.expense }}>
          {Math.abs(change)}% {change <= 0 ? w.less : w.more}
        </ThemedText>
      </View>}
      <ThemedText type="meta" themeColor="textSecondary">
        {snapshot.spendingCount} {w.transactions} · {snapshot.merchantCount} {w.merchants}
      </ThemedText>
    </Animated.View>
    <View style={[styles.metricRail, styles.pushBottom]}>
      <Metric currency={moneySpec.currency} value={formatMinorUnits(snapshot.totalIncomeFils, moneySpec)} label={w.income} delay={100} />
      <Metric currency={moneySpec.currency} value={`${snapshot.netFils < 0 ? '−' : ''}${formatMinorUnits(Math.abs(snapshot.netFils), moneySpec)}`} label={w.net} delay={160} />
    </View>
  </View>;
}

function Metric({ value, label, currency, delay = 0 }: { value: string; label: string; currency?: string; delay?: number }) {
  const enter = useRecapEntering();
  const { width, fontScale } = useWindowDimensions();
  return <Animated.View entering={enter(FadeInUp.delay(delay).duration(360))}
    accessible accessibilityLabel={`${label}. ${currency ? `${currency} ` : ''}${value}`}
    style={[styles.metric, { minWidth: Math.min(140 * Math.max(fontScale, 1), width - Spacing.four * 2) }]}>
    {currency ? <ThemedText type="meta" themeColor="textSecondary">{currency}</ThemedText> : null}
    <ThemedText maxFontSizeMultiplier={STORY_TITLE_SMALL_MAX} style={[styles.metricValue, value.length > 9 && styles.metricValueTight]} tabular>{value}</ThemedText>
    <ThemedText type="meta" themeColor="textSecondary">{label}</ThemedText>
  </Animated.View>;
}

function CategoryScene({ snapshot, moneySpec }: { snapshot: RecapSnapshot; moneySpec: LedgerMoneySpec }) {
  const language = useLanguage();
  const w = copy[language === 'ar' ? 'ar' : 'en'];
  const palette = useCategoricalPalette();
  const enter = useRecapEntering();
  const top = snapshot.topCategories[0];
  return <View style={styles.sceneSpread}>
    <View style={styles.sceneHeading}>
      <ThemedText type="micro" themeColor="textTertiary">{w.categories}</ThemedText>
      {top && <View style={styles.categoryHeadline}>
        <ThemedText maxFontSizeMultiplier={STORY_NUMERAL_MAX} style={styles.categoryPercent} tabular>{top.percent}%</ThemedText>
        <View style={styles.categoryHeadlineCopy}>
          <ThemedText maxFontSizeMultiplier={STORY_TITLE_SMALL_MAX} style={styles.storyTitleSmall}>{top.label}</ThemedText>
          <ThemedText type="meta" themeColor="textSecondary">{w.topCategory}</ThemedText>
        </View>
      </View>}
    </View>
    <Animated.View entering={enter(FadeIn.delay(80).duration(420))} style={styles.categoryStack}>
      {snapshot.topCategories.map((row, index) => (
        <View key={row.category} style={[styles.categorySegment, {
          flex: Math.max(1, row.percent),
          backgroundColor: palette[index % palette.length],
        }]} />
      ))}
    </Animated.View>
    <View style={[styles.categoryList, styles.pushBottom]}>
      {snapshot.topCategories.slice(0, 4).map((row, index) =>
        <Animated.View key={row.category} entering={enter(FadeInUp.delay(100 + index * 45).duration(320))} style={styles.categoryRow}>
          <View style={[styles.rankDot, { backgroundColor: palette[index % palette.length] }]} />
          <ThemedText type="smallBold" style={styles.flex}>{row.label}</ThemedText>
          <ThemedText type="meta" themeColor="textSecondary" tabular>{row.percent}%</ThemedText>
          <MoneyText fils={row.spendFils} moneySpec={moneySpec} />
        </Animated.View>)}
    </View>
  </View>;
}

function MerchantScene({ snapshot, moneySpec }: { snapshot: RecapSnapshot; moneySpec: LedgerMoneySpec }) {
  const language = useLanguage();
  const w = copy[language === 'ar' ? 'ar' : 'en'];
  const top = snapshot.topMerchants[0];
  const enter = useRecapEntering();
  if (!top) return null;
  return <View style={styles.sceneSpread}>
    <View style={styles.sceneHeading}><ThemedText type="micro" themeColor="textTertiary">{w.merchant}</ThemedText></View>
    <Animated.View entering={enter(FadeInUp.duration(430))} style={styles.merchantFeature}>
      <View style={styles.merchantFeatureTop}>
        <ThemedText maxFontSizeMultiplier={STORY_NUMERAL_MAX} style={styles.featureRank} themeColor="textTertiary">01</ThemedText>
        <MerchantAvatar title={top.title} category={top.category} size={74} />
      </View>
      <ThemedText maxFontSizeMultiplier={STORY_TITLE_MAX} style={styles.storyTitle} numberOfLines={2}>{top.title}</ThemedText>
      <View style={styles.merchantFeatureMeta}>
        <MoneyText fils={top.spendFils} moneySpec={moneySpec} />
        <ThemedText type="meta" themeColor="textSecondary">{top.count} {w.visits}</ThemedText>
      </View>
    </Animated.View>
    <View style={[styles.merchantList, styles.pushBottom]}>
      {snapshot.topMerchants.slice(1, 3).map((merchant, index) =>
        <Animated.View key={merchant.key} entering={enter(FadeInUp.delay(120 + index * 70).duration(360))}
          style={styles.merchantRow}>
          <ThemedText style={styles.runnerRank} themeColor="textTertiary">0{index + 2}</ThemedText>
          <MerchantAvatar title={merchant.title} category={merchant.category} size={42} />
          <View style={styles.flex}>
            <ThemedText type="smallBold" numberOfLines={1}>{merchant.title}</ThemedText>
            <ThemedText type="meta" themeColor="textSecondary">{merchant.count} {w.visits}</ThemedText>
          </View>
          <MoneyText fils={merchant.spendFils} moneySpec={moneySpec} />
        </Animated.View>)}
    </View>
  </View>;
}

function AccountScene({ snapshot, moneySpec }: { snapshot: RecapSnapshot; moneySpec: LedgerMoneySpec }) {
  const language = useLanguage();
  const w = copy[language === 'ar' ? 'ar' : 'en'];
  const theme = useTheme();
  const row = snapshot.mostUsedAccount;
  const enter = useRecapEntering();
  if (!row) return null;
  const isCard = row.account.kind === 'card' || !!row.account.cardType;
  return <View style={styles.sceneSpread}>
    <View style={styles.sceneHeading}><ThemedText type="micro" themeColor="textTertiary">{isCard ? w.account : w.accountFallback}</ThemedText></View>
    <Animated.View entering={enter(FadeInUp.duration(460))} style={styles.accountFeature}>
      <BankAvatar account={row.account} size={68} />
      <View style={styles.accountIdentity}>
        <ThemedText maxFontSizeMultiplier={STORY_TITLE_SMALL_MAX} style={styles.storyTitleSmall} numberOfLines={2}>{row.label}</ThemedText>
        {row.account.last4 && <ThemedText type="meta" themeColor="textTertiary" tabular>•••• {row.account.last4}</ThemedText>}
      </View>
      <View style={[styles.accountRule, { backgroundColor: theme.cardBorderStrong }]} />
    </Animated.View>
    <View style={[styles.metricRail, styles.pushBottom]}>
      <Metric value={String(row.count)} label={`${w.used} · ${w.visits}`} delay={100} />
      <Metric currency={moneySpec.currency} value={formatMinorUnits(row.spendFils, moneySpec)} label={w.spent.toLowerCase()} delay={160} />
    </View>
  </View>;
}

function RhythmScene({ snapshot, moneySpec }: { snapshot: RecapSnapshot; moneySpec: LedgerMoneySpec }) {
  const language = useLanguage();
  const w = copy[language === 'ar' ? 'ar' : 'en'];
  const theme = useTheme();
  const enter = useRecapEntering();
  return <View style={styles.sceneSpread}>
    <View style={styles.sceneHeading}><ThemedText type="micro" themeColor="textTertiary">{w.rhythm}</ThemedText>
      {snapshot.busiestWeekday && <ThemedText maxFontSizeMultiplier={STORY_TITLE_SMALL_MAX} style={styles.storyTitleSmall}>{weekdayName(snapshot.busiestWeekday.day)} <ThemedText themeColor="textSecondary">{w.busiest}</ThemedText></ThemedText>}
    </View>
    <View style={styles.dayTape}>
        {Array.from({ length: 7 }, (_, i) => {
          const active = snapshot.busiestWeekday?.day === i;
          return <Animated.View key={i} entering={enter(FadeIn.delay(i * 40).duration(260))}
            style={[styles.dayCell, { borderBottomColor: active ? theme.primary : theme.cardBorder }]}>
            <ThemedText type={active ? 'smallBold' : 'meta'} themeColor={active ? 'text' : 'textTertiary'}>
              {weekdayName(i).slice(0, 2)}
            </ThemedText>
          </Animated.View>;
        })}
    </View>
    <View style={[styles.metricGrid, styles.pushBottom]}>
      <View style={styles.metricGridItem}><ThemedText maxFontSizeMultiplier={STORY_TITLE_SMALL_MAX} style={styles.metricValue} tabular>{snapshot.noSpendDays}</ThemedText><ThemedText type="meta" themeColor="textSecondary">{w.noSpend}</ThemedText></View>
      <View style={styles.metricGridItem}><MoneyText fils={snapshot.averagePurchaseFils} moneySpec={moneySpec} /><ThemedText type="meta" themeColor="textSecondary">{w.average}</ThemedText></View>
      {snapshot.favoriteTime && <View style={[styles.metricGridItem, styles.metricWide]}>
        <View style={[styles.timeMarker, { backgroundColor: theme.goldSoft }]}><Icon name="sun" size={18} color={theme.warning} /></View>
        <View><ThemedText type="smallBold">{w[snapshot.favoriteTime.bucket]}</ThemedText><ThemedText type="meta" themeColor="textSecondary">{w.favoriteTime}</ThemedText></View>
      </View>}
    </View>
  </View>;
}

function HighlightScene({ snapshot, moneySpec }: { snapshot: RecapSnapshot; moneySpec: LedgerMoneySpec }) {
  const language = useLanguage();
  const w = copy[language === 'ar' ? 'ar' : 'en'];
  const theme = useTheme();
  const enter = useRecapEntering();
  if (snapshot.descriptor.kind === 'year' && snapshot.monthlySeries.length) {
    const max = Math.max(1, ...snapshot.monthlySeries.map((m) => m.spendFils));
    const high = snapshot.monthlySeries.reduce((a, b) => b.spendFils > a.spendFils ? b : a);
    const nonZero = snapshot.monthlySeries.filter((m) => m.spendFils > 0);
    const low = nonZero.length ? nonZero.reduce((a, b) => b.spendFils < a.spendFils ? b : a) : null;
    return <View style={styles.sceneSpread}>
      <View style={styles.sceneHeading}><ThemedText type="micro" themeColor="textTertiary">{w.monthly}</ThemedText>
        <ThemedText maxFontSizeMultiplier={STORY_TITLE_SMALL_MAX} style={styles.storyTitleSmall}>{snapshot.descriptor.label}</ThemedText></View>
      <View style={styles.yearBars}>
        {snapshot.monthlySeries.map((month, index) => <View key={month.key} style={styles.yearColumn}>
          <View style={styles.yearBarTrack}>
            <Animated.View entering={enter(FadeInUp.delay(index * 34).duration(360))}
              style={[styles.yearBar, { height: Math.max(4, (month.spendFils / max) * 154), backgroundColor: month.key === high.key ? theme.primary : theme.track }]} />
          </View>
          <ThemedText type="nano" themeColor={month.key === high.key ? 'text' : 'textTertiary'}>{month.label.slice(0, 1)}</ThemedText>
        </View>)}
      </View>
      <View style={[styles.metricRail, styles.pushBottom]}>
        <View style={styles.metric}><ThemedText type="smallBold">{high.label}</ThemedText><ThemedText type="meta" themeColor="textSecondary">{w.highest}</ThemedText><MoneyText fils={high.spendFils} moneySpec={moneySpec} /></View>
        {low && <View style={styles.metric}><ThemedText type="smallBold">{low.label}</ThemedText><ThemedText type="meta" themeColor="textSecondary">{w.quietest}</ThemedText><MoneyText fils={low.spendFils} moneySpec={moneySpec} /></View>}
      </View>
    </View>;
  }
  const purchase = snapshot.largestPurchase;
  if (!purchase) return null;
  return <View style={styles.sceneSpread}>
    <View style={styles.sceneHeading}><ThemedText type="micro" themeColor="textTertiary">{w.biggest}</ThemedText></View>
    <Animated.View entering={enter(FadeInUp.duration(430))} style={styles.bigPurchase}>
      <View style={styles.bigPurchaseTop}>
        <MerchantAvatar title={purchase.title} category={purchase.category} size={72} />
        <ThemedText type="meta" themeColor="textTertiary">{shortDate(purchase.date)}</ThemedText>
      </View>
      <ThemedText maxFontSizeMultiplier={STORY_TITLE_MAX} style={styles.storyTitle} numberOfLines={2}>{purchase.title}</ThemedText>
      <HeroMoney fils={purchase.amountFils} moneySpec={moneySpec} />
    </Animated.View>
  </View>;
}

function FinaleScene({ snapshot, moneySpec, onDone }: { snapshot: RecapSnapshot; moneySpec: LedgerMoneySpec; onDone: () => void }) {
  const language = useLanguage();
  const w = copy[language === 'ar' ? 'ar' : 'en'];
  const theme = useTheme();
  const enter = useRecapEntering();
  return <View style={styles.sceneSpread}>
    <View style={styles.sceneHeading}>
      <ThemedText type="micro" themeColor="textTertiary">{w.finale}</ThemedText>
      <ThemedText maxFontSizeMultiplier={STORY_TITLE_MAX} style={styles.storyTitle}>{snapshot.descriptor.label}</ThemedText>
      <ThemedText type="default" themeColor="textSecondary">{w.wrapped}</ThemedText>
    </View>
    <Animated.View entering={enter(FadeInUp.delay(80).duration(420))} style={[styles.finalBoard, styles.pushBottom, { borderColor: theme.cardBorderStrong }]}>
      <FinalFact label={w.spent} value={`${moneySpec.currency} ${formatMinorUnits(snapshot.totalSpendFils, moneySpec)}`} />
      <Rule color={theme.cardBorder} />
      <FinalFact label={w.transactions} value={String(snapshot.spendingCount)} />
      <Rule color={theme.cardBorder} />
      <FinalFact label={w.merchants} value={String(snapshot.merchantCount)} />
      <Rule color={theme.cardBorder} />
      <FinalFact label={w.noSpend} value={String(snapshot.noSpendDays)} />
      {snapshot.topCategories[0] && <><Rule color={theme.cardBorder} /><FinalFact label={w.categories} value={snapshot.topCategories[0].label} /></>}
    </Animated.View>
    <Pressable accessibilityRole="button" onPress={onDone} style={({ pressed }) => [styles.doneButton, { backgroundColor: theme.primary, opacity: pressed ? 0.82 : 1 }]}>
      <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>{w.done}</ThemedText>
    </Pressable>
  </View>;
}

function FinalFact({ label, value }: { label: string; value: string }) {
  return <View style={styles.finalFact}><ThemedText type="meta" themeColor="textSecondary">{label}</ThemedText>
    <ThemedText type="smallBold" tabular style={styles.finalValue}>{value}</ThemedText></View>;
}

export function RecapStory({ snapshot, moneySpec, onClose }: { snapshot: RecapSnapshot; moneySpec: LedgerMoneySpec; onClose: () => void }) {
  const theme = useTheme();
  const language = useLanguage();
  const w = copy[language === 'ar' ? 'ar' : 'en'];
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const progress = useSharedValue(reducedMotion ? 1 : 0);
  const slides = useMemo(() => {
    const story = [
      <IntroScene key="intro" snapshot={snapshot} />,
      <SpendScene key="spend" snapshot={snapshot} moneySpec={moneySpec} />,
    ];
    if (snapshot.topCategories.length > 0) {
      story.push(<CategoryScene key="category" snapshot={snapshot} moneySpec={moneySpec} />);
    }
    if (snapshot.topMerchants.length > 0) {
      story.push(<MerchantScene key="merchant" snapshot={snapshot} moneySpec={moneySpec} />);
    }
    if (snapshot.mostUsedAccount) {
      story.push(<AccountScene key="account" snapshot={snapshot} moneySpec={moneySpec} />);
    }
    if (snapshot.spendingCount > 0) {
      story.push(<RhythmScene key="rhythm" snapshot={snapshot} moneySpec={moneySpec} />);
    }
    if (snapshot.descriptor.kind === 'year' || snapshot.largestPurchase) {
      story.push(<HighlightScene key="highlight" snapshot={snapshot} moneySpec={moneySpec} />);
    }
    story.push(<FinaleScene key="final" snapshot={snapshot} moneySpec={moneySpec} onDone={onClose} />);
    return story;
  }, [moneySpec, onClose, snapshot]);

  const next = useCallback(() => {
    setDirection(1);
    setIndex((current) => current >= slides.length - 1 ? current : current + 1);
  }, [slides.length]);
  const previous = useCallback(() => {
    setDirection(-1);
    setIndex((current) => Math.max(0, current - 1));
  }, []);

  useEffect(() => {
    cancelAnimation(progress);
    progress.value = reducedMotion ? 1 : 0;
    if (reducedMotion || index >= slides.length - 1) return;
    progress.value = withTiming(1, { duration: STORY_MS, easing: Easing.bezier(...EASE) }, (finished) => {
      if (finished) runOnJS(next)();
    });
    return () => cancelAnimation(progress);
  }, [index, next, progress, reducedMotion, slides.length]);

  const activeProgress = useAnimatedStyle(() => ({ transform: [{ scaleX: progress.value }] }));
  const navigate = (event: { nativeEvent: { locationX: number } }) => {
    void tapped();
    if (event.nativeEvent.locationX < width * 0.34) previous();
    else next();
  };
  const compact = height < 740;
  const slideEntering = reducedMotion
    ? undefined
    : (direction > 0 ? FadeInRight : FadeInLeft).duration(260);

  return <View style={[styles.root, { backgroundColor: theme.background, paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 12) }]}>
    <LedgerBackdrop variant={index} />
    <View style={styles.topChrome}>
      <View style={styles.progressRow} accessible={false}>
        {slides.map((_, i) => <View key={i} style={[styles.progressTrack, { backgroundColor: theme.track }]}>
          {i < index && <View style={[StyleSheet.absoluteFillObject, styles.progressFill, { backgroundColor: theme.primary }]} />}
          {i === index && <Animated.View style={[StyleSheet.absoluteFillObject, styles.progressFill, {
            backgroundColor: theme.primary,
            transformOrigin: isRTL() ? 'right center' : 'left center',
          }, activeProgress]} />}
        </View>)}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={w.close} hitSlop={8} onPress={onClose}
        style={({ pressed }) => [styles.close, { borderColor: theme.cardBorderStrong, opacity: pressed ? 0.6 : 1 }]}>
        <Icon name="close" size={20} color={theme.text} />
      </Pressable>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={`${w.recap}, ${index + 1} / ${slides.length}`}
      onPress={navigate} style={styles.touchArea}>
      <Animated.View key={`${snapshot.descriptor.id}:${index}`} entering={slideEntering}
        style={[styles.slide, compact && styles.slideCompact]}>
        {slides[index]}
      </Animated.View>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  topChrome: { paddingHorizontal: Spacing.four, paddingTop: Spacing.two, gap: 12, zIndex: 3 },
  progressRow: { flexDirection: 'row', gap: 4, height: 3 },
  progressTrack: { flex: 1, height: 2, borderRadius: 1, overflow: 'hidden' },
  progressFill: { borderRadius: 1 },
  close: { width: 40, height: 40, borderRadius: Radius.full, borderWidth: 1, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-end' },
  touchArea: { flex: 1 },
  slide: { flex: 1, paddingHorizontal: Spacing.four, paddingBottom: Spacing.three },
  slideCompact: { paddingBottom: Spacing.two },
  sceneIntro: { flex: 1, paddingTop: Spacing.four, paddingBottom: Spacing.four },
  introMark: { alignSelf: 'flex-start', gap: 14 },
  introMarkRule: { width: 64, height: 3, borderRadius: 2 },
  introCopy: { marginTop: 48, gap: 12, maxWidth: 340 },
  introFooter: { marginTop: 'auto', gap: 12 },
  introFooterRule: { width: 42, height: 1, backgroundColor: 'rgba(127,127,127,0.38)' },
  sceneSpread: { flex: 1, paddingTop: 20, paddingBottom: Spacing.two, gap: 28 },
  sceneHeading: { gap: 10 },
  pushBottom: { marginTop: 'auto' },
  storyTitle: { fontFamily: Fonts.sansSemi, fontSize: 40, lineHeight: 45, letterSpacing: -1.25 },
  storyTitleSmall: { fontFamily: Fonts.sansSemi, fontSize: 30, lineHeight: 36, letterSpacing: -0.8 },
  heroMoney: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 },
  heroCurrency: { fontFamily: Fonts.sansMedium, fontSize: 14 },
  heroAmount: { fontFamily: Fonts.monoSemi, fontSize: 52, lineHeight: 58, letterSpacing: -1.45 },
  heroAmountMedium: { fontSize: 47, lineHeight: 53, letterSpacing: -1.15 },
  heroAmountTight: { fontSize: 41, lineHeight: 47, letterSpacing: -0.9 },
  changeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 34, paddingHorizontal: 10, borderRadius: Radius.chip },
  metricRail: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.four },
  metric: { minWidth: 0, flex: 1, gap: 6 },
  metricValue: { fontFamily: Fonts.monoSemi, fontSize: 27, lineHeight: 33, letterSpacing: -0.5 },
  metricValueTight: { fontSize: 23, lineHeight: 29, letterSpacing: -0.35 },
  categoryHeadline: { flexDirection: 'row', alignItems: 'flex-end', gap: 14 },
  categoryHeadlineCopy: { flex: 1, gap: 3, paddingBottom: 4 },
  categoryPercent: { fontFamily: Fonts.monoSemi, fontSize: 60, lineHeight: 62, letterSpacing: -2 },
  categoryStack: { minHeight: 16, flexDirection: 'row', gap: 2, overflow: 'hidden', borderRadius: 3 },
  categorySegment: { minWidth: 2, borderRadius: 2 },
  categoryList: { gap: 0 },
  categoryRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rankDot: { width: 8, height: 8, borderRadius: 4 },
  flex: { flex: 1, minWidth: 0 },
  merchantFeature: { gap: 14, paddingTop: Spacing.two },
  merchantFeatureTop: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  featureRank: { fontFamily: Fonts.monoSemi, fontSize: 46, lineHeight: 50, letterSpacing: -1.6 },
  merchantFeatureMeta: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.three },
  merchantList: { gap: 4 },
  merchantRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 10 },
  runnerRank: { width: 26, fontFamily: Fonts.monoMedium, fontSize: 16, lineHeight: 20 },
  accountFeature: { paddingTop: Spacing.two, gap: Spacing.three },
  accountIdentity: { gap: 5 },
  accountRule: { height: StyleSheet.hairlineWidth, width: '100%', marginTop: Spacing.two },
  dayTape: { flexDirection: 'row', gap: 5, paddingTop: 4 },
  dayCell: { flex: 1, minHeight: 58, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  metricGridItem: { flexGrow: 1, flexBasis: '40%', minHeight: 88, gap: 6, justifyContent: 'center' },
  metricWide: { flexBasis: '100%', flexDirection: 'row', alignItems: 'center', gap: 10 },
  timeMarker: { width: 36, height: 36, borderRadius: Radius.tile, alignItems: 'center', justifyContent: 'center' },
  bigPurchase: { flex: 1, justifyContent: 'center', gap: Spacing.three, paddingBottom: Spacing.four },
  bigPurchaseTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  yearBars: { height: 190, flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  yearColumn: { flex: 1, alignItems: 'center', gap: 6 },
  yearBarTrack: { height: 154, alignSelf: 'stretch', justifyContent: 'flex-end', alignItems: 'center' },
  yearBar: { width: '68%', maxWidth: 18, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  finalBoard: { borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: 4 },
  finalFact: { minHeight: 58, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 8 },
  finalValue: { flexShrink: 1, textAlign: 'right' },
  rule: { height: StyleSheet.hairlineWidth, width: '100%' },
  doneButton: { minHeight: 52, borderRadius: Radius.control, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.three },
  ledgerMargin: { position: 'absolute', top: 0, bottom: 0, left: 9, width: StyleSheet.hairlineWidth, opacity: 0.12 },
  ledgerRule: { position: 'absolute', left: Spacing.four, right: Spacing.four, height: StyleSheet.hairlineWidth, opacity: 0.32 },
  pageIndex: { position: 'absolute', right: 12, bottom: 18, fontFamily: Fonts.monoSemi, fontSize: 88, lineHeight: 92, letterSpacing: -4, opacity: 0.035 },
});
