import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { getLocales } from 'expo-localization';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Icon, type IconName } from '@/components/ui/icon';
import { WafraMark } from '@/components/wafra-logo';
import { Colors, Fonts, Radius } from '@/constants/theme';
import { tapped } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { onboardingAlertExamples, type OnboardingAlertExample } from '@/lib/onboarding-alert-examples';
import { onboardingBankRegion, type OnboardingBankExample } from '@/lib/onboarding-bank-examples';
import { verifiedLogoUrl } from '@/lib/verified-logo-identities';
import type { OnboardingFocus, OnboardingIntention, OnboardingTracking } from '@/lib/types';

const night = Colors.dark;
const deviceRegion = (): string | null => {
  try { return getLocales()[0]?.regionCode ?? null; } catch { return null; }
};

/** Full-screen cinematic ground used by every onboarding step. */
export function OnboardingAtmosphere() {
  return <View style={StyleSheet.absoluteFillObject} pointerEvents="none" accessible={false}>
    <LinearGradient
      colors={['#173D31', '#10261F', night.background]}
      locations={[0, 0.34, 0.74]}
      style={StyleSheet.absoluteFillObject}
    />
    <View style={[styles.atmosphereDisc, styles.atmosphereDiscGreen]} />
    <View style={[styles.atmosphereDisc, styles.atmosphereDiscAmber]} />
  </View>;
}

/** The real Wafra mark on the dimensional tile used throughout the journey. */
export function WafraTile({ size = 40 }: { size?: number }) {
  return <LinearGradient
    colors={['#83D9B5', '#49AA83', '#286F57']}
    locations={[0, 0.56, 1]}
    start={{ x: 0.1, y: 0 }}
    end={{ x: 0.9, y: 1 }}
    style={[styles.wafraTile, { width: size, height: size, borderRadius: Math.round(size * 0.31) }]}>
    <View style={styles.wafraTileSheen} />
    <WafraMark size={Math.round(size * 0.62)} color={night.onPrimary} />
  </LinearGradient>;
}

/* ------------------------------------------------------------------ */
/* Logos: the real brand when the CDN answers, an honest fallback otherwise */
/* ------------------------------------------------------------------ */

const initials = (name: string): string => name.split(/\s+/).filter(Boolean).slice(0, 3).map(word => word[0]!.toUpperCase()).join('');

function BrandLogo({ name, domain, color, fallbackIcon, size = 36 }: {
  name: string; domain?: string | null; color?: string; fallbackIcon?: IconName; size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const uri = domain ? verifiedLogoUrl(domain) : null;
  const showImage = !!uri && !failed;
  const radius = Math.round(size * 0.32);
  const ground = showImage && loaded ? '#FFFFFF' : color ?? night.backgroundSelected;
  return <View style={[styles.logo, { width: size, height: size, borderRadius: radius, backgroundColor: ground }]} accessible={false}>
    {!(showImage && loaded) && (fallbackIcon
      ? <Icon name={fallbackIcon} size={Math.round(size * 0.46)} color={color ? '#FFFFFF' : night.primary} />
      : <ThemedText style={[styles.logoInitials, { fontSize: Math.max(9, Math.round(size * 0.28)) }]}>{initials(name)}</ThemedText>)}
    {showImage && <Image source={{ uri }} contentFit="contain" cachePolicy="memory-disk" transition={0}
      onLoad={() => setLoaded(true)} onError={() => setFailed(true)}
      style={[StyleSheet.absoluteFillObject, { margin: Math.round(size * 0.14) }]} accessible={false} />}
  </View>;
}

function BankLogo({ bank, size = 36 }: { bank: OnboardingBankExample | null; size?: number }) {
  return <BrandLogo name={bank?.name ?? t('onboardRegionalBankGeneric')} domain={bank?.domain} color={bank?.color}
    fallbackIcon={bank ? undefined : 'bank'} size={size} />;
}

function Rise({ delay, reducedMotion, children, style }: { delay: number; reducedMotion: boolean; children: React.ReactNode; style?: object }) {
  const rise = useSharedValue(reducedMotion ? 1 : 0);
  useEffect(() => {
    if (reducedMotion) { rise.value = 1; return; }
    rise.value = 0;
    rise.value = withDelay(delay, withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) }));
  }, [delay, reducedMotion, rise]);
  const riseStyle = useAnimatedStyle(() => ({ opacity: rise.value, transform: [{ translateY: interpolate(rise.value, [0, 1], [6, 0]) }] }));
  return <Animated.View style={[style, riseStyle]}>{children}</Animated.View>;
}

const POSTER_ROTATIONS = [-4, 3, -2] as const;

function posterKindLabel(example: OnboardingAlertExample): string {
  return example.kind === 'purchase'
    ? t('onboardScenePurchase')
    : example.kind === 'bill'
      ? t('onboardSceneBill')
      : t('onboardSceneIncome');
}

/**
 * One cinematic alert card. The card itself drops first, then the bank logo
 * lands independently with a small spring. This mirrors the approved mockup:
 * money objects feel physical, while all motion stays on Reanimated's UI thread.
 */
function PosterAlertCard({ example, index, reducedMotion }: {
  example: OnboardingAlertExample;
  index: number;
  reducedMotion: boolean;
}) {
  const card = useSharedValue(reducedMotion ? 1 : 0);
  const logo = useSharedValue(reducedMotion ? 1 : 0);
  useEffect(() => {
    if (reducedMotion) {
      card.value = 1;
      logo.value = 1;
      return;
    }
    card.value = 0;
    logo.value = 0;
    card.value = withDelay(120 + index * 220, withSpring(1, {
      damping: 13,
      stiffness: 115,
      mass: 0.9,
    }));
    logo.value = withDelay(520 + index * 220, withSpring(1, {
      damping: 10,
      stiffness: 190,
      mass: 0.72,
    }));
  }, [card, index, logo, reducedMotion]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: interpolate(card.value, [0, 0.14, 1], [0, 1, 1]),
    transform: [
      { translateY: interpolate(card.value, [0, 1], [-155 - index * 18, 0]) },
      { rotate: `${interpolate(card.value, [0, 1], [0, POSTER_ROTATIONS[index] ?? 0])}deg` },
      { scale: interpolate(card.value, [0, 0.72, 1], [0.94, 1.025, 1]) },
    ],
  }));
  const logoStyle = useAnimatedStyle(() => ({
    opacity: interpolate(logo.value, [0, 0.18, 1], [0, 1, 1]),
    transform: [
      { translateY: interpolate(logo.value, [0, 1], [-72, 0]) },
      { scale: interpolate(logo.value, [0, 0.72, 1], [0.65, 1.12, 1]) },
      { rotate: `${interpolate(logo.value, [0, 1], [-16, 0])}deg` },
    ],
  }));
  const merchant = example.kind === 'salary' ? t('onboardSceneIncomeCategory') : example.merchant.name;
  const bankName = example.bank?.name ?? t('onboardRegionalBankGeneric');

  return <Animated.View style={[styles.posterAlert, cardStyle]}
    accessible accessibilityLabel={`${bankName}. ${posterKindLabel(example)}. ${merchant}. ${example.amount}`}>
    <Animated.View style={logoStyle}>
      <BankLogo bank={example.bank} size={40} />
    </Animated.View>
    <View style={styles.posterAlertCopy}>
      <ThemedText numberOfLines={1} style={styles.posterBank}>{bankName}</ThemedText>
      <ThemedText numberOfLines={1} style={styles.posterMerchant}>{merchant}</ThemedText>
      <View style={styles.posterKindLine}>
        <View style={[styles.posterKindDot, example.income && styles.posterKindDotIncome]} />
        <ThemedText style={styles.posterKind}>{posterKindLabel(example)}</ThemedText>
      </View>
    </View>
    <ThemedText style={[styles.posterAmount, example.income && styles.posterAmountIncome]} tabular>
      {example.amount}
    </ThemedText>
  </Animated.View>;
}

/**
 * Poster-style welcome scene: three real regional alerts fall into one Wafra
 * picture. Nothing is written to the ledger; the examples are display-only.
 */
export function WelcomeMoneyScene({ marketId, reducedMotion }: { marketId: string; reducedMotion: boolean }) {
  const region = useMemo(() => onboardingBankRegion(marketId, deviceRegion()), [marketId]);
  const examples = useMemo(() => onboardingAlertExamples(region, {
    grocery: t('onboardSceneGroceryStore'),
    electricity: t('onboardSceneElectricity'),
    salary: t('onboardSceneIncomeCategory'),
  }), [region]);
  const net = region?.currency ? `+${region.currency} 7,062.00` : '+7,062.00';

  return <View style={styles.welcomeScene} testID="onboarding-market-money-scene">
    <View style={styles.posterStage}>
      <View style={styles.posterGlow} pointerEvents="none" />
      {examples.map((example, index) => <PosterAlertCard
        key={example.kind}
        example={example}
        index={index}
        reducedMotion={reducedMotion}
      />)}
    </View>
    <Rise delay={2150} reducedMotion={reducedMotion} style={styles.posterResult}>
      <View style={styles.grow}>
        <ThemedText type="micro" style={styles.posterResultKicker}>{t('onboardSceneAlertsToPicture')}</ThemedText>
        <View style={styles.posterNetLine}>
          <ThemedText style={styles.posterNet} tabular>{net}</ThemedText>
          <ThemedText style={styles.posterNetNote}>{t('onboardSceneNetWeek')}</ThemedText>
        </View>
      </View>
      <View style={styles.posterReady}>
        <Icon name="check" size={13} color={night.primary} />
        <ThemedText style={styles.posterReadyText}>{t('onboardSceneOrganized')}</ThemedText>
      </View>
    </Rise>
    <ThemedText style={styles.posterFootnote}>{t('onboardRegionalExample')} · {t('onboardSceneRevealFootnote')}</ThemedText>
  </View>;
}

/* ------------------------------------------------------------------ */
/* The real screens, small                                             */
/* ------------------------------------------------------------------ */

function focusTitle(focus: OnboardingFocus): string {
  return focus === 'bills' ? t('onboardFocusBills') : focus === 'cashflow' ? t('onboardFocusCashflow') : focus === 'spending' ? t('onboardFocusSpending') : t('onboardFocusOverview');
}

function MiniRow({ lead, label, pill, amount, tone }: { lead?: string; label: string; pill?: string; amount: string; tone?: 'income' | 'expense' }) {
  return <View style={styles.miniRow}>
    {lead ? <ThemedText style={styles.miniLead} tabular>{lead}</ThemedText> : null}
    <ThemedText numberOfLines={1} style={styles.miniLabel}>{label}</ThemedText>
    {pill ? <View style={styles.miniPill}><ThemedText style={styles.miniPillText}>{pill}</ThemedText></View> : null}
    <ThemedText style={[styles.miniAmount, tone === 'income' && { color: night.income }, tone === 'expense' && { color: night.expense }]} tabular>{amount}</ThemedText>
  </View>;
}

/** A faithful miniature of the view the user is choosing, drawn from the same vocabulary as the real screen. */
export function FocusPreviewCard({ focus, currency }: { focus: OnboardingFocus; currency: string }) {
  const money = (value: string): string => (currency ? `${currency} ${value}` : value);
  return <View style={styles.miniCard} testID="onboarding-product-preview">
    <View style={styles.miniHead}>
      <ThemedText style={styles.miniTitle}>{focusTitle(focus)}</ThemedText>
      <ThemedText type="micro" style={styles.kicker}>{t('onboardSceneThisMonth')}</ThemedText>
    </View>
    {focus === 'bills' ? <>
      <View style={styles.miniBigLine}><ThemedText style={styles.miniBig} tabular>{money('3,507')}</ThemedText><ThemedText style={styles.miniBigNote}>{t('onboardSceneDueBills')}</ThemedText></View>
      <MiniRow lead="7" label={t('onboardSceneElectricity')} pill={t('onboardSceneUtilities')} amount="318.00" />
      <MiniRow lead="12" label={t('onboardSceneCardDue')} pill={t('onboardSceneStatement')} amount="2,800.00" />
      <MiniRow lead="18" label={t('onboardSceneInternet')} pill={t('onboardSceneTelecom')} amount="389.00" />
    </> : focus === 'spending' ? <>
      <View style={styles.miniBigLine}><ThemedText style={styles.miniBig} tabular>{money('3,240')}</ThemedText><ThemedText style={styles.miniBigNote}>{t('onboardSceneSpent')}</ThemedText></View>
      <MiniRow label={t('onboardSceneGroceries')} amount="1,120.00" />
      <MiniRow label={t('onboardSceneDining')} amount="860.50" />
      <MiniRow label={t('onboardSceneTransport')} amount="410.00" />
    </> : focus === 'cashflow' ? <>
      <View style={styles.miniBigLine}><ThemedText style={[styles.miniBig, { color: night.income }]} tabular>+{money('2,340')}</ThemedText><ThemedText style={styles.miniBigNote}>{t('onboardSceneNet')}</ThemedText></View>
      <MiniRow label={t('onboardSceneIncome')} amount="+7,500.00" tone="income" />
      <MiniRow label={t('onboardSceneSpent')} amount="−5,160.00" tone="expense" />
    </> : <>
      <View style={styles.miniTrio}>
        {[[t('onboardSceneSpent'), money('3,240')], [t('onboardSceneBills'), '6'], [t('onboardSceneAccounts'), '3']].map(([label, value]) => <View key={label} style={styles.miniStat}>
          <ThemedText type="micro" style={styles.kicker}>{label}</ThemedText><ThemedText style={styles.miniStatValue} tabular>{value}</ThemedText>
        </View>)}
      </View>
    </>}
  </View>;
}

/* ------------------------------------------------------------------ */
/* Choosers                                                            */
/* ------------------------------------------------------------------ */

function OptionTab({ label, selected, onPress }: { label: string; selected: boolean; onPress(): void }) {
  return <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={label}
    onPress={() => { tapped(); onPress(); }}
    style={({ pressed }) => [styles.optionTab, selected && styles.optionTabSelected, { opacity: pressed ? 0.7 : 1 }]}>
    <ThemedText style={[styles.optionText, selected && styles.optionTextSelected]}>{label}</ThemedText>
    {selected && <Icon name="check" size={13} color={night.primary} />}
  </Pressable>;
}

/** The chosen view drawn small, with the four choices as quiet tabs underneath. */
export function FocusChooser({ value, onChange, marketId, reducedMotion = false }: {
  value: OnboardingFocus | null; onChange(value: OnboardingFocus): void; marketId?: string | null; reducedMotion?: boolean;
}) {
  const region = useMemo(() => onboardingBankRegion(marketId ?? null, deviceRegion()), [marketId]);
  const current: OnboardingFocus = value ?? 'spending';
  const options: { id: OnboardingFocus; title: string }[] = [
    { id: 'spending', title: t('onboardFocusSpending') },
    { id: 'bills', title: t('onboardFocusBills') },
    { id: 'cashflow', title: t('onboardFocusCashflow') },
    { id: 'overview', title: t('onboardFocusOverview') },
  ];
  return <View style={styles.chooser} testID="onboarding-focus-options">
    <Animated.View key={current} entering={reducedMotion ? undefined : FadeIn.duration(180)} accessibilityLiveRegion="polite">
      <FocusPreviewCard focus={current} currency={region?.currency ?? ''} />
    </Animated.View>
    <View style={styles.optionGrid}>
      {options.map(option => <View key={option.id} style={styles.optionCell}>
        <OptionTab label={option.title} selected={value === option.id} onPress={() => onChange(option.id)} />
      </View>)}
    </View>
  </View>;
}

export function TrackingChooser({ value, onChange, marketId, reducedMotion = false }: {
  value: OnboardingTracking | null; onChange(value: OnboardingTracking): void; marketId: string; reducedMotion?: boolean;
}) {
  const region = useMemo(() => onboardingBankRegion(marketId, deviceRegion()), [marketId]);
  const banks = region?.banks ?? [];
  const options: { id: OnboardingTracking; label: string; icon: IconName; outcome: string }[] = [
    { id: 'bank-apps', label: t('onboardTrackingBankApps'), icon: 'bank', outcome: t('onboardTrackingOneView') },
    { id: 'spreadsheet', label: t('onboardTrackingSpreadsheet'), icon: 'chart', outcome: t('onboardTrackingSpreadsheetScene') },
    { id: 'finance-app', label: t('onboardTrackingFinanceApp'), icon: 'phone', outcome: t('onboardTrackingFinanceScene') },
    { id: 'none', label: t('onboardTrackingNone'), icon: 'spark', outcome: t('onboardTrackingFreshSceneBody') },
  ];
  const current = options.find(option => option.id === value) ?? null;
  return <View style={styles.chooser} testID="onboarding-tracking-options">
    <View style={styles.trackingScene}>
      <View style={styles.bankRow}>
        {[0, 1, 2].map(i => <View key={i} style={styles.bankItem}>
          <BankLogo bank={banks[i] ?? null} size={44} />
          <ThemedText numberOfLines={1} style={styles.bankName}>{banks[i]?.name ?? t('onboardRegionalBankGeneric')}</ThemedText>
        </View>)}
      </View>
      <Animated.View key={current?.id ?? 'none-yet'} entering={reducedMotion ? undefined : FadeIn.duration(180)} style={styles.outcome} accessibilityLiveRegion="polite">
        <ThemedText style={styles.outcomeText}>{current ? current.outcome : t('onboardTrackingScattered')}</ThemedText>
      </Animated.View>
    </View>
    <View style={styles.optionList}>
      {options.map(option => {
        const selected = value === option.id;
        return <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={option.label}
          onPress={() => { tapped(); onChange(option.id); }}
          style={({ pressed }) => [styles.optionRow, selected && styles.optionRowSelected, { opacity: pressed ? 0.7 : 1 }]}>
          <Icon name={option.icon} size={17} color={selected ? night.primary : night.textTertiary} />
          <ThemedText style={[styles.optionText, selected && styles.optionTextSelected]}>{option.label}</ThemedText>
          {selected && <Icon name="check" size={14} color={night.primary} />}
        </Pressable>;
      })}
    </View>
  </View>;
}

function IntentionVisual({ intention }: { intention: OnboardingIntention }) {
  if (intention === 'stay-ahead') {
    return <View style={styles.intentionPoster}>
      <View style={styles.intentionPosterHead}>
        <ThemedText type="micro" style={styles.kicker}>{t('onboardIntentionAhead')}</ThemedText>
        <Icon name="receipt" size={20} color={night.primary} />
      </View>
      <View style={styles.intentionTimeline}>
        {[[7, t('onboardSceneElectricity')], [12, t('onboardSceneCardDue')], [18, t('onboardSceneInternet')]].map(([day, label], index) => <View key={String(label)} style={styles.intentionTimelineRow}>
          <View style={[styles.intentionTimelineDot, index === 0 && styles.intentionTimelineDotActive]} />
          <ThemedText style={styles.intentionDay} tabular>{day}</ThemedText>
          <ThemedText style={styles.intentionTimelineLabel}>{label}</ThemedText>
          <Icon name={index === 0 ? 'check' : 'chevron-right'} size={15} color={index === 0 ? night.primary : night.textTertiary} />
        </View>)}
      </View>
      <ThemedText style={styles.intentionSceneCopy}>{t('onboardIntentionAheadScene')}</ThemedText>
    </View>;
  }
  if (intention === 'build-buffer') {
    return <View style={styles.intentionPoster}>
      <View style={styles.intentionPosterHead}>
        <ThemedText type="micro" style={styles.kicker}>{t('onboardIntentionBuffer')}</ThemedText>
        <Icon name="wallet" size={20} color={night.primary} />
      </View>
      <View style={styles.bufferStage}>
        <View style={[styles.bufferLayer, styles.bufferLayerBack]} />
        <View style={[styles.bufferLayer, styles.bufferLayerMid]} />
        <View style={[styles.bufferLayer, styles.bufferLayerFront]}>
          <ThemedText style={styles.bufferValue} tabular>+ 2,340</ThemedText>
          <ThemedText style={styles.bufferLabel}>{t('onboardSceneNet')}</ThemedText>
        </View>
      </View>
      <ThemedText style={styles.intentionSceneCopy}>{t('onboardIntentionBufferScene')}</ThemedText>
    </View>;
  }
  if (intention === 'spend-intentionally') {
    const bars = [0.85, 0.58, 0.72, 0.45, 0.62, 0.38, 0.5];
    return <View style={styles.intentionPoster}>
      <View style={styles.intentionPosterHead}>
        <ThemedText type="micro" style={styles.kicker}>{t('onboardIntentionSpend')}</ThemedText>
        <Icon name="chart" size={20} color={night.warning} />
      </View>
      <View style={styles.intentionSpendStage}>
        <View style={styles.intentionSpendGuide} />
        {bars.map((height, index) => <View key={index} style={[styles.intentionSpendBar, { height: 82 * height, opacity: 0.42 + index * 0.065 }]} />)}
      </View>
      <ThemedText style={styles.intentionSceneCopy}>{t('onboardIntentionSpendScene')}</ThemedText>
    </View>;
  }
  return <View style={styles.intentionPoster}>
    <View style={styles.intentionPosterHead}>
      <ThemedText type="micro" style={styles.kicker}>{t('onboardIntentionControl')}</ThemedText>
      <Icon name="spark" size={20} color={night.primary} />
    </View>
    <View style={styles.controlStage}>
      <View style={[styles.controlOrbit, styles.controlOrbitOuter]} />
      <View style={[styles.controlOrbit, styles.controlOrbitInner]} />
      <View style={styles.controlCenter}><Icon name="wallet" size={30} color={night.primary} /></View>
      <View style={[styles.controlChip, styles.controlChipOne]}><Icon name="receipt" size={16} color={night.warning} /></View>
      <View style={[styles.controlChip, styles.controlChipTwo]}><Icon name="chart" size={16} color={night.primary} /></View>
      <View style={[styles.controlChip, styles.controlChipThree]}><Icon name="bank" size={16} color={night.textSecondary} /></View>
    </View>
    <ThemedText style={styles.intentionSceneCopy}>{t('onboardIntentionControlScene')}</ThemedText>
  </View>;
}

export function IntentionChooser({ value, onChange, reducedMotion = false }: {
  value: OnboardingIntention | null;
  onChange(value: OnboardingIntention): void;
  reducedMotion?: boolean;
}) {
  const options: { id: OnboardingIntention; label: string; icon: IconName }[] = [
    { id: 'control', label: t('onboardIntentionControl'), icon: 'spark' },
    { id: 'spend-intentionally', label: t('onboardIntentionSpend'), icon: 'chart' },
    { id: 'stay-ahead', label: t('onboardIntentionAhead'), icon: 'receipt' },
    { id: 'build-buffer', label: t('onboardIntentionBuffer'), icon: 'wallet' },
  ];
  const current = value ?? 'control';
  return <View style={styles.chooser} testID="onboarding-intention-options">
    <Animated.View key={current} entering={reducedMotion ? undefined : FadeIn.duration(180)} accessibilityLiveRegion="polite">
      <IntentionVisual intention={current} />
    </Animated.View>
    <View style={styles.optionList}>
      {options.map(option => {
        const selected = value === option.id;
        return <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={option.label}
          onPress={() => { tapped(); onChange(option.id); }}
          style={({ pressed }) => [styles.optionRow, selected && styles.optionRowSelected, { opacity: pressed ? 0.7 : 1 }]}>
          <Icon name={option.icon} size={17} color={selected ? night.primary : night.textTertiary} />
          <ThemedText style={[styles.optionText, selected && styles.optionTextSelected]}>{option.label}</ThemedText>
          {selected && <Icon name="check" size={14} color={night.primary} />}
        </Pressable>;
      })}
    </View>
  </View>;
}

function trackingTitle(tracking: OnboardingTracking | null): string {
  if (tracking === 'spreadsheet') return t('onboardTrackingSpreadsheet');
  if (tracking === 'finance-app') return t('onboardTrackingFinanceApp');
  if (tracking === 'none') return t('onboardTrackingNone');
  return t('onboardTrackingBankApps');
}

function intentionResult(intention: OnboardingIntention | null): string {
  if (intention === 'spend-intentionally') return t('onboardIntentionSpendScene');
  if (intention === 'stay-ahead') return t('onboardIntentionAheadScene');
  if (intention === 'build-buffer') return t('onboardIntentionBufferScene');
  return t('onboardIntentionControlScene');
}

/** The preview step: the user's old money habit visibly resolves into the Wafra view they chose. */
export function PersonalizedProductPreview({ focus, tracking, intention, marketId, reducedMotion = false }: {
  focus: OnboardingFocus | null;
  tracking: OnboardingTracking | null;
  intention: OnboardingIntention | null;
  marketId?: string | null;
  reducedMotion?: boolean;
}) {
  const region = useMemo(() => onboardingBankRegion(marketId ?? null, deviceRegion()), [marketId]);
  const current = focus ?? 'overview';
  const sourceIcon: IconName = tracking === 'spreadsheet' ? 'chart'
    : tracking === 'finance-app' ? 'phone'
      : tracking === 'none' ? 'spark' : 'bank';
  const sourceDetail = tracking === 'bank-apps' && region?.banks?.length
    ? region.banks.slice(0, 3).map(bank => bank.name).join(' · ')
    : tracking === 'spreadsheet' ? t('onboardTrackingSpreadsheetScene')
      : tracking === 'finance-app' ? t('onboardTrackingFinanceScene')
        : t('onboardTrackingFreshSceneBody');

  return <View style={styles.previewStep} testID="onboarding-product-preview">
    <View style={styles.morphSource}>
      <View style={styles.morphSourceIcon}><Icon name={sourceIcon} size={22} color={night.primary} /></View>
      <View style={styles.grow}>
        <ThemedText type="micro" style={styles.kicker}>{t('onboardPreviewFrom')}</ThemedText>
        <ThemedText style={styles.morphSourceTitle}>{trackingTitle(tracking)}</ThemedText>
        <ThemedText numberOfLines={2} style={styles.morphSourceDetail}>{sourceDetail}</ThemedText>
      </View>
    </View>
    <View style={styles.morphRail} accessible={false}>
      <View style={styles.morphLine} />
      <Rise delay={160} reducedMotion={reducedMotion} style={styles.morphBadge}>
        <Icon name="chevron-down" size={18} color={night.primary} />
      </Rise>
      <View style={styles.morphLine} />
    </View>
    <Rise delay={260} reducedMotion={reducedMotion}>
      <FocusPreviewCard focus={current} currency={region?.currency ?? ''} />
    </Rise>
    <Rise delay={420} reducedMotion={reducedMotion} style={styles.intentionOutcome}>
      <View style={styles.intentionOutcomeIcon}><Icon name="spark" size={17} color={night.primary} /></View>
      <View style={styles.grow}>
        <ThemedText type="micro" style={styles.kicker}>{t('onboardPreviewForYou')}</ThemedText>
        <ThemedText style={styles.intentionOutcomeText}>{intentionResult(intention)}</ThemedText>
      </View>
    </Rise>
  </View>;
}

/* ------------------------------------------------------------------ */
/* Capture: which banks this phone will read                           */
/* ------------------------------------------------------------------ */

export function CaptureMarketScene({ marketId }: { marketId: string }) {
  const region = useMemo(() => onboardingBankRegion(marketId, deviceRegion()), [marketId]);
  const banks = region?.banks ?? [];
  return <View style={styles.captureScene} testID="onboarding-capture-market-scene">
    <View style={styles.bankRow}>
      {[0, 1, 2].map(index => <View key={index} style={styles.bankItem}>
        <BankLogo bank={banks[index] ?? null} size={40} />
        <ThemedText numberOfLines={1} style={styles.bankName}>{banks[index]?.name ?? t('onboardRegionalBankGeneric')}</ThemedText>
      </View>)}
    </View>
    <View style={styles.captureLedgerLine}>
      <Icon name="mail" size={18} color={night.textSecondary} />
      <View style={styles.grow}>
        <ThemedText style={styles.captureLedgerTitle}>{t('onboardCaptureSceneIncoming')}</ThemedText>
        <ThemedText style={styles.captureLedgerBody}>{t('onboardCaptureSceneOrganized')}</ThemedText>
      </View>
      <Icon name="chevron-right" size={18} color={night.primary} />
    </View>
  </View>;
}

/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  kicker: { color: night.textTertiary, fontFamily: Fonts.monoMedium, letterSpacing: 0.9 },
  atmosphereDisc: { position: 'absolute', borderRadius: 999 },
  atmosphereDiscGreen: { width: 360, height: 360, top: 80, start: -170, backgroundColor: 'rgba(76,176,137,0.16)' },
  atmosphereDiscAmber: { width: 320, height: 320, top: 430, end: -180, backgroundColor: 'rgba(151,101,34,0.11)' },
  wafraTile: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 16, shadowOffset: { width: 0, height: 9 }, elevation: 8 },
  wafraTileSheen: { position: 'absolute', top: 0, start: 0, end: 0, height: '42%', backgroundColor: 'rgba(255,255,255,0.15)' },
  logo: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  logoInitials: { color: '#FFFFFF', fontFamily: Fonts.sansSemi, letterSpacing: 0.3 },

  welcomeScene: { gap: 8 },
  posterStage: { minHeight: 220, justifyContent: 'center', gap: 7, paddingHorizontal: 6, position: 'relative' },
  posterGlow: { position: 'absolute', alignSelf: 'center', top: 22, width: 280, height: 186, borderRadius: 140, backgroundColor: 'rgba(67,170,129,0.15)' },
  posterAlert: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', backgroundColor: '#25221C' },
  posterAlertCopy: { flex: 1, minWidth: 0, gap: 1 },
  posterBank: { color: night.text, fontFamily: Fonts.sansSemi, fontSize: 13, lineHeight: 17 },
  posterMerchant: { color: night.textSecondary, fontFamily: Fonts.sansMedium, fontSize: 12, lineHeight: 16 },
  posterKindLine: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: 3 },
  posterKindDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: night.expense },
  posterKindDotIncome: { backgroundColor: night.income },
  posterKind: { color: night.textTertiary, fontSize: 10, lineHeight: 14 },
  posterAmount: { color: night.text, fontFamily: Fonts.monoSemi, fontSize: 14, writingDirection: 'ltr' },
  posterAmountIncome: { color: night.income },
  posterResult: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, paddingTop: 2 },
  posterResultKicker: { color: night.income, fontFamily: Fonts.monoMedium, letterSpacing: 1.1 },
  posterNetLine: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
  posterNet: { color: night.text, fontFamily: Fonts.monoSemi, fontSize: 24, lineHeight: 30, letterSpacing: -0.5, writingDirection: 'ltr' },
  posterNetNote: { color: night.textSecondary, fontSize: 12 },
  posterReady: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: Radius.full, borderWidth: 1, borderColor: night.primaryBorder, backgroundColor: night.primarySoft },
  posterReadyText: { color: night.income, fontFamily: Fonts.sansSemi, fontSize: 11 },
  posterFootnote: { color: night.textTertiary, fontSize: 11, lineHeight: 15 },
  miniCard: { borderWidth: 1, borderColor: night.cardBorderStrong, borderRadius: 18, padding: 12, backgroundColor: night.backgroundElement, gap: 6 },
  miniHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  miniTitle: { color: night.text, fontFamily: Fonts.sansSemi, fontSize: 15 },
  miniBigLine: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', paddingBottom: 2 },
  miniBig: { color: night.text, fontFamily: Fonts.monoSemi, fontSize: 28, letterSpacing: -0.5, writingDirection: 'ltr' },
  miniBigNote: { color: night.textSecondary, fontSize: 12 },
  miniRow: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderColor: night.cardBorder },
  miniLead: { width: 22, color: night.warning, fontFamily: Fonts.monoMedium, fontSize: 13 },
  miniLabel: { flexShrink: 1, color: night.textSecondary, fontSize: 13 },
  miniPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: Radius.full, borderWidth: 1, borderColor: night.cardBorderStrong },
  miniPillText: { color: night.textTertiary, fontSize: 10 },
  miniAmount: { marginStart: 'auto', color: night.text, fontFamily: Fonts.monoMedium, fontSize: 13, writingDirection: 'ltr' },
  miniTrio: { flexDirection: 'row', gap: 8 },
  miniStat: { flex: 1, gap: 4, paddingVertical: 8, borderTopWidth: 1, borderColor: night.cardBorderStrong },
  miniStatValue: { color: night.text, fontFamily: Fonts.monoSemi, fontSize: 18, writingDirection: 'ltr' },

  chooser: { gap: 10 },
  optionGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
  optionCell: { width: '50%', paddingHorizontal: 6 },
  optionTab: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 2, borderBottomWidth: 1, borderColor: night.cardBorderStrong },
  optionTabSelected: { borderBottomWidth: 2, borderColor: night.primary },
  optionText: { flex: 1, color: night.textTertiary, fontFamily: Fonts.sansMedium, fontSize: 14, lineHeight: 19 },
  optionTextSelected: { color: night.text },
  optionList: { gap: 0 },
  optionRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: night.cardBorder },
  optionRowSelected: { borderBottomWidth: 1, borderColor: night.primary },
  trackingScene: { gap: 8, paddingVertical: 8, borderTopWidth: 1, borderBottomWidth: 1, borderColor: night.cardBorderStrong },
  intentionPoster: { minHeight: 190, gap: 10, padding: 14, borderRadius: 22, backgroundColor: '#1C1A16', borderWidth: 1, borderColor: night.cardBorderStrong, overflow: 'hidden' },
  intentionPosterHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  intentionSceneCopy: { color: night.textSecondary, fontFamily: Fonts.sansMedium, fontSize: 13, lineHeight: 19 },
  intentionTimeline: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: night.cardBorderStrong },
  intentionTimelineRow: { minHeight: 35, flexDirection: 'row', alignItems: 'center', gap: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: night.cardBorder },
  intentionTimelineDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: night.cardBorderStrong },
  intentionTimelineDotActive: { width: 10, height: 10, borderRadius: 5, backgroundColor: night.primary },
  intentionDay: { width: 24, color: night.primary, fontFamily: Fonts.monoSemi, fontSize: 13 },
  intentionTimelineLabel: { flex: 1, color: night.textSecondary, fontSize: 12 },
  bufferStage: { minHeight: 88, justifyContent: 'flex-end', alignItems: 'center', position: 'relative', marginHorizontal: 18 },
  bufferLayer: { position: 'absolute', width: '100%', height: 64, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  bufferLayerBack: { bottom: 30, backgroundColor: '#24221D', transform: [{ scale: 0.9 }] },
  bufferLayerMid: { bottom: 15, backgroundColor: '#20382F', transform: [{ scale: 0.95 }] },
  bufferLayerFront: { bottom: 0, backgroundColor: '#1E4B3B', alignItems: 'center', justifyContent: 'center', gap: 2 },
  bufferValue: { color: night.income, fontFamily: Fonts.monoSemi, fontSize: 26, lineHeight: 31, writingDirection: 'ltr' },
  bufferLabel: { color: night.textSecondary, fontSize: 11 },
  intentionSpendStage: { height: 90, flexDirection: 'row', alignItems: 'flex-end', gap: 7, position: 'relative', paddingHorizontal: 4 },
  intentionSpendGuide: { position: 'absolute', start: 0, end: 0, top: 44, height: 1, backgroundColor: night.primaryBorder },
  intentionSpendBar: { flex: 1, borderTopLeftRadius: 6, borderTopRightRadius: 6, backgroundColor: night.warning },
  controlStage: { height: 90, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  controlOrbit: { position: 'absolute', borderRadius: 999, borderWidth: 1, borderColor: night.primaryBorder },
  controlOrbitOuter: { width: 118, height: 118 },
  controlOrbitInner: { width: 76, height: 76, opacity: 0.75 },
  controlCenter: { width: 58, height: 58, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: night.primarySoft, borderWidth: 1, borderColor: night.primaryBorder },
  controlChip: { position: 'absolute', width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: night.backgroundElement, borderWidth: 1, borderColor: night.cardBorderStrong },
  controlChipOne: { top: 4, start: 34 },
  controlChipTwo: { bottom: 2, end: 38 },
  controlChipThree: { top: 38, end: 24 },
  bankRow: { flexDirection: 'row', gap: 12 },
  bankItem: { flex: 1, minWidth: 0, alignItems: 'center', gap: 7 },
  bankName: { color: night.textSecondary, fontSize: 10, textAlign: 'center', maxWidth: '100%' },
  outcome: { minHeight: 24, justifyContent: 'center' },
  outcomeText: { color: night.textSecondary, fontFamily: Fonts.sansMedium, fontSize: 13, lineHeight: 18, textAlign: 'center' },

  previewStep: { gap: 10 },
  morphSource: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderTopWidth: 1, borderBottomWidth: 1, borderColor: night.cardBorderStrong },
  morphSourceIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: night.primarySoft, borderWidth: 1, borderColor: night.primaryBorder },
  morphSourceTitle: { color: night.text, fontFamily: Fonts.sansSemi, fontSize: 15, lineHeight: 20 },
  morphSourceDetail: { color: night.textTertiary, fontSize: 11, lineHeight: 15, paddingTop: 2 },
  morphRail: { height: 26, flexDirection: 'row', alignItems: 'center', gap: 10 },
  morphLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: night.primaryBorder },
  morphBadge: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: night.primarySoft, borderWidth: 1, borderColor: night.primaryBorder },
  intentionOutcome: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 7, borderTopWidth: 1, borderColor: night.cardBorderStrong },
  intentionOutcomeIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: night.primarySoft },
  intentionOutcomeText: { color: night.textSecondary, fontFamily: Fonts.sansMedium, fontSize: 13, lineHeight: 18, paddingTop: 2 },
  nextList: { gap: 2 },
  nextItem: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: night.cardBorder },
  nextItemText: { flex: 1, color: night.textSecondary, fontSize: 13, lineHeight: 18 },

  captureScene: { gap: 8, marginTop: 6, paddingVertical: 8, borderTopWidth: 1, borderBottomWidth: 1, borderColor: night.cardBorderStrong },
  captureLedgerLine: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 },
  captureLedgerTitle: { color: night.text, fontFamily: Fonts.sansSemi, fontSize: 13 },
  captureLedgerBody: { color: night.textTertiary, fontSize: 11, lineHeight: 15 },
});
