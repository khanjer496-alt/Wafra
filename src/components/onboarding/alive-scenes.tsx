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
import { ALERT_DELIVERY_PRESETS, onboardingHistoryGap, onboardingNoAutomaticCapture } from '@/lib/onboarding';
import type {
  OnboardingAlertDelivery,
  OnboardingFocus,
  OnboardingIntention,
  OnboardingTracking,
} from '@/lib/types';

const night = Colors.dark;
/**
 * The phone's own Region. One reader, shared with the gate's country control,
 * so the guess a scene draws and the guess the control offers to correct can
 * never come from two different sources and disagree on screen.
 */
export const onboardingDeviceRegion = (): string | null => {
  try { return getLocales()[0]?.regionCode ?? null; } catch { return null; }
};
const deviceRegion = onboardingDeviceRegion;
/**
 * A country the user confirmed outranks the device Region, which is only ever
 * a guess — and for an expatriate routinely the wrong one. Every scene below
 * resolves its examples through here so one correction on the first screen
 * carries through the whole of setup.
 */
const previewRegion = (country?: string | null): string | null => country ?? deviceRegion();

/** Quiet, full-screen ground shared by every onboarding step. */
export function OnboardingAtmosphere() {
  return <View style={StyleSheet.absoluteFillObject} pointerEvents="none" accessible={false}>
    <LinearGradient
      colors={['#17352C', '#10251F', '#0E1714', night.background]}
      locations={[0, 0.28, 0.62, 1]}
      style={StyleSheet.absoluteFillObject}
    />
    <LinearGradient
      colors={['rgba(83,196,151,0.07)', 'rgba(83,196,151,0)']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.atmosphereWash}
    />
  </View>;
}

/** The real Wafra mark, kept deliberately flatter than the surrounding UI. */
export function WafraTile({ size = 40 }: { size?: number }) {
  return <LinearGradient
    colors={['#67CBA4', '#43A77F']}
    locations={[0, 1]}
    start={{ x: 0.1, y: 0 }}
    end={{ x: 0.9, y: 1 }}
    style={[styles.wafraTile, { width: size, height: size, borderRadius: Math.round(size * 0.31) }]}>
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
  const ground = color ?? night.backgroundSelected;
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

function posterKindLabel(example: OnboardingAlertExample): string {
  return example.kind === 'purchase'
    ? t('onboardScenePurchase')
    : example.kind === 'bill'
      ? t('onboardSceneBill')
      : t('onboardSceneIncome');
}

/** One real-looking alert row. Motion explains arrival; styling stays product-like. */
function PosterAlertCard({ example, index, reducedMotion }: {
  example: OnboardingAlertExample;
  index: number;
  reducedMotion: boolean;
}) {
  const card = useSharedValue(reducedMotion ? 1 : 0);
  useEffect(() => {
    if (reducedMotion) {
      card.value = 1;
      return;
    }
    card.value = 0;
    card.value = withDelay(100 + index * 150, withTiming(1, {
      duration: 360,
      easing: Easing.out(Easing.cubic),
    }));
  }, [card, index, reducedMotion]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: card.value,
    transform: [
      { translateY: interpolate(card.value, [0, 1], [18, 0]) },
      { scale: interpolate(card.value, [0, 1], [0.985, 1]) },
    ],
  }));
  const merchant = example.kind === 'salary' ? t('onboardSceneIncomeCategory') : example.merchant.name;
  const bankName = example.bank?.name ?? t('onboardRegionalBankGeneric');

  return <Animated.View style={[styles.posterAlert, cardStyle]}
    accessible accessibilityLabel={`${bankName}. ${posterKindLabel(example)}. ${merchant}. ${example.amount}`}>
    <View>
      <BankLogo bank={example.bank} size={40} />
    </View>
    <View style={styles.posterAlertCopy}>
      <ThemedText style={styles.posterBank}>{bankName}</ThemedText>
      <ThemedText style={styles.posterMerchant}>{merchant}</ThemedText>
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

/** Three regional alerts resolve into one Wafra summary. Display-only. */
export function WelcomeMoneyScene({ marketId, country, reducedMotion }: { marketId: string; country?: string | null; reducedMotion: boolean }) {
  const region = useMemo(() => onboardingBankRegion(marketId, previewRegion(country)), [marketId, country]);
  const examples = useMemo(() => onboardingAlertExamples(region, {
    grocery: t('onboardSceneGroceryStore'),
    electricity: t('onboardSceneElectricity'),
    salary: t('onboardSceneIncomeCategory'),
  }), [region]);
  const net = region?.currency ? `+${region.currency} 7,062.00` : '+7,062.00';

  return <View style={styles.welcomeScene} testID="onboarding-market-money-scene">
    <View style={styles.posterStage}>
      {examples.map((example, index) => <PosterAlertCard
        key={example.kind}
        example={example}
        index={index}
        reducedMotion={reducedMotion}
      />)}
    </View>
    <Rise delay={720} reducedMotion={reducedMotion} style={styles.posterResult}>
      <View style={styles.grow}>
        <ThemedText type="micro" style={styles.posterResultKicker}>{t('onboardSceneAlertsToPicture')}</ThemedText>
        <View style={styles.posterNetLine}>
          <ThemedText style={styles.posterNet} tabular>{net}</ThemedText>
          <ThemedText style={styles.posterNetNote}>{t('onboardSceneNetWeek')}</ThemedText>
        </View>
      </View>
    </Rise>
    <View style={styles.posterFootnoteRow}>
      <Icon name="check" size={12} color={night.primary} />
      <ThemedText style={styles.posterFootnote}>{t('onboardRegionalExample')}</ThemedText>
    </View>
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
    <ThemedText style={styles.miniLabel}>{label}</ThemedText>
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
  return <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} aria-checked={selected} accessibilityLabel={label}
    onPress={() => { tapped(); onPress(); }}
    style={({ pressed }) => [styles.optionTab, selected && styles.optionTabSelected, { opacity: pressed ? 0.7 : 1 }]}>
    <ThemedText style={[styles.optionText, selected && styles.optionTextSelected]}>{label}</ThemedText>
    {selected && <Icon name="check" size={13} color={night.primary} />}
  </Pressable>;
}

/** The chosen view drawn small, with the four choices as quiet tabs underneath. */
export function FocusChooser({ value, onChange, marketId, country, reducedMotion = false }: {
  value: OnboardingFocus | null; onChange(value: OnboardingFocus): void; marketId?: string | null; country?: string | null; reducedMotion?: boolean;
}) {
  const region = useMemo(() => onboardingBankRegion(marketId ?? null, previewRegion(country)), [marketId, country]);
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

export function TrackingChooser({ value, onChange, marketId, country, reducedMotion = false }: {
  value: OnboardingTracking | null; onChange(value: OnboardingTracking): void; marketId: string; country?: string | null; reducedMotion?: boolean;
}) {
  const region = useMemo(() => onboardingBankRegion(marketId, previewRegion(country)), [marketId, country]);
  const banks = region?.banks ?? [];
  const options: { id: OnboardingTracking; label: string; icon: IconName; outcome: string }[] = [
    { id: 'bank-apps', label: t('onboardTrackingBankApps'), icon: 'bank', outcome: t('onboardTrackingOneView') },
    { id: 'spreadsheet', label: t('onboardTrackingSpreadsheet'), icon: 'chart', outcome: t('onboardTrackingSpreadsheetScene') },
    { id: 'finance-app', label: t('onboardTrackingFinanceApp'), icon: 'phone', outcome: t('onboardTrackingFinanceScene') },
    { id: 'none', label: t('onboardTrackingNone'), icon: 'spark', outcome: t('onboardTrackingFreshSceneBody') },
  ];
  const current = options.find(option => option.id === value) ?? null;
  return <View style={styles.chooser} testID="onboarding-tracking-options">
    {current && <Animated.View key={current.id} entering={reducedMotion ? undefined : FadeIn.duration(180)}
      style={styles.trackingScene} accessibilityLiveRegion="polite">
      {current.id === 'bank-apps' ? <View style={styles.bankRow}>
        {[0, 1, 2].map(i => <View key={i} style={styles.bankItem}>
          <BankLogo bank={banks[i] ?? null} size={40} />
          <ThemedText style={styles.bankName}>{banks[i]?.name ?? t('onboardRegionalBankGeneric')}</ThemedText>
        </View>)}
      </View> : current.id === 'spreadsheet' ? <View style={styles.trackingSheet}>
        <View style={styles.trackingSheetRow}>
          <ThemedText style={styles.trackingSheetKey}>{t('onboardSceneGroceries')}</ThemedText>
          <ThemedText style={styles.trackingSheetValue} tabular>1,120</ThemedText>
        </View>
        <View style={styles.trackingSheetRow}>
          <ThemedText style={styles.trackingSheetKey}>{t('onboardSceneElectricity')}</ThemedText>
          <ThemedText style={styles.trackingSheetValue} tabular>318</ThemedText>
        </View>
        <View style={styles.trackingSheetRow}>
          <ThemedText style={styles.trackingSheetKey}>{t('onboardSceneIncome')}</ThemedText>
          <ThemedText style={[styles.trackingSheetValue, { color: night.income }]} tabular>+7,500</ThemedText>
        </View>
      </View> : current.id === 'finance-app' ? <View style={styles.trackingPhone}>
        <View style={styles.trackingPhoneTop}>
          <Icon name="phone" size={15} color={night.primary} />
          <ThemedText style={styles.trackingPhoneTitle}>{t('onboardTrackingFinanceApp')}</ThemedText>
        </View>
        <MiniRow label={t('onboardSceneGroceries')} amount="1,120" />
        <MiniRow label={t('onboardSceneInternet')} amount="389" />
      </View> : <View style={styles.trackingFresh}>
        <WafraTile size={44} />
        <View style={styles.grow}>
          <ThemedText style={styles.trackingFreshTitle}>{t('onboardTrackingFreshSceneTitle')}</ThemedText>
          <ThemedText style={styles.trackingFreshBody}>{t('onboardTrackingFreshSceneBody')}</ThemedText>
        </View>
      </View>}
      <View style={styles.outcome}>
        <Icon name="check" size={14} color={night.primary} />
        <ThemedText style={styles.outcomeText}>{current.outcome}</ThemedText>
      </View>
    </Animated.View>}
    <View style={styles.optionList}>
      {options.map(option => {
        const selected = value === option.id;
        return <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ checked: selected }} aria-checked={selected} accessibilityLabel={option.label}
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

/**
 * The answer's consequence, drawn as reach rather than as a promise.
 *
 * Every other onboarding question is about taste, so its scene can be
 * aspirational. This one is about what Wafra can and cannot retrieve, and the
 * honest answer for a notification-only bank is that the past is missing. The
 * two rows say so plainly, which is also what makes the statement offer at the
 * end of setup read as a fix rather than an upsell.
 */
function AlertReach({ alerts }: { alerts: OnboardingAlertDelivery }) {
  const pastCovered = alerts === 'sms';
  const pastUnknown = alerts === 'unsure';
  // A bank that sends nothing is not covered "from now on" either. Drawing a
  // tick there would promise a capture that cannot happen, which is the exact
  // false reassurance this whole question exists to remove.
  const futureCovered = !onboardingNoAutomaticCapture(alerts);
  const rows: { key: string; label: string; detail: string; covered: boolean }[] = [
    {
      key: 'past',
      label: t('onboardAlertsReachPast'),
      detail: pastCovered
        ? t('onboardAlertsReachCovered')
        : pastUnknown ? t('onboardAlertsReachUnknown') : t('onboardAlertsReachStatement'),
      covered: pastCovered,
    },
    {
      key: 'future',
      label: t('onboardAlertsReachFuture'),
      detail: futureCovered ? t('onboardAlertsReachCovered') : t('onboardAlertsReachManual'),
      covered: futureCovered,
    },
  ];
  return <View style={styles.alertReach}>
    {rows.map(row => <View key={row.key} style={styles.alertReachRow}>
      <Icon
        name={row.covered ? 'check' : 'upload'}
        size={15}
        color={row.covered ? night.primary : night.textTertiary}
      />
      <ThemedText style={styles.alertReachLabel}>{row.label}</ThemedText>
      <ThemedText style={[styles.alertReachDetail, row.covered && styles.alertReachDetailCovered]}>
        {row.detail}
      </ThemedText>
    </View>)}
  </View>;
}

export function AlertDeliveryChooser({ value, onChange, reducedMotion = false }: {
  value: OnboardingAlertDelivery | null;
  onChange(value: OnboardingAlertDelivery): void;
  reducedMotion?: boolean;
}) {
  const current = value ?? 'sms';
  return <View style={styles.chooser} testID="onboarding-alerts-options">
    <Animated.View key={current} entering={reducedMotion ? undefined : FadeIn.duration(180)}
      style={styles.trackingScene} accessibilityLiveRegion="polite">
      <AlertReach alerts={current} />
      <View style={styles.outcome}>
        <Icon name={onboardingHistoryGap(value) ? 'upload' : 'check'} size={14} color={night.primary} />
        <ThemedText style={styles.outcomeText}>
          {t(ALERT_DELIVERY_PRESETS.find(preset => preset.id === current)!.detailKey)}
        </ThemedText>
      </View>
    </Animated.View>
    <View style={styles.optionList}>
      {ALERT_DELIVERY_PRESETS.map(preset => {
        const label = t(preset.titleKey);
        const selected = value === preset.id;
        return <Pressable key={preset.id} accessibilityRole="radio" accessibilityState={{ checked: selected }}
          aria-checked={selected} accessibilityLabel={label}
          onPress={() => { tapped(); onChange(preset.id); }}
          style={({ pressed }) => [styles.optionRow, selected && styles.optionRowSelected, { opacity: pressed ? 0.7 : 1 }]}>
          <Icon name={preset.icon} size={17} color={selected ? night.primary : night.textTertiary} />
          <ThemedText style={[styles.optionText, selected && styles.optionTextSelected]}>{label}</ThemedText>
          {selected && <Icon name="check" size={14} color={night.primary} />}
        </Pressable>;
      })}
    </View>
  </View>;
}

function IntentionVisual({ intention, currency }: { intention: OnboardingIntention; currency: string }) {
  const focus: OnboardingFocus = intention === 'spend-intentionally' ? 'spending'
    : intention === 'stay-ahead' ? 'bills'
      : intention === 'build-buffer' ? 'cashflow' : 'overview';
  const copy = intention === 'spend-intentionally' ? t('onboardIntentionSpendScene')
    : intention === 'stay-ahead' ? t('onboardIntentionAheadScene')
      : intention === 'build-buffer' ? t('onboardIntentionBufferScene')
        : t('onboardIntentionControlScene');
  return <View style={styles.intentionScene}>
    <FocusPreviewCard focus={focus} currency={currency} />
    <View style={styles.intentionSceneLine}>
      <Icon name="check" size={14} color={night.primary} />
      <ThemedText style={styles.intentionSceneCopy}>{copy}</ThemedText>
    </View>
  </View>;
}

export function IntentionChooser({ value, onChange, marketId, country, reducedMotion = false }: {
  value: OnboardingIntention | null;
  onChange(value: OnboardingIntention): void;
  marketId?: string | null;
  country?: string | null;
  reducedMotion?: boolean;
}) {
  const region = useMemo(() => onboardingBankRegion(marketId ?? null, previewRegion(country)), [marketId, country]);
  const options: { id: OnboardingIntention; label: string; icon: IconName }[] = [
    { id: 'control', label: t('onboardIntentionControl'), icon: 'spark' },
    { id: 'spend-intentionally', label: t('onboardIntentionSpend'), icon: 'chart' },
    { id: 'stay-ahead', label: t('onboardIntentionAhead'), icon: 'receipt' },
    { id: 'build-buffer', label: t('onboardIntentionBuffer'), icon: 'wallet' },
  ];
  const current = value ?? 'control';
  return <View style={styles.chooser} testID="onboarding-intention-options">
    <Animated.View key={current} entering={reducedMotion ? undefined : FadeIn.duration(180)} accessibilityLiveRegion="polite">
      <IntentionVisual intention={current} currency={region?.currency ?? ''} />
    </Animated.View>
    <View style={styles.optionList}>
      {options.map(option => {
        const selected = value === option.id;
        return <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ checked: selected }} aria-checked={selected} accessibilityLabel={option.label}
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
export function PersonalizedProductPreview({ focus, tracking, intention, marketId, country, reducedMotion = false }: {
  focus: OnboardingFocus | null;
  tracking: OnboardingTracking | null;
  intention: OnboardingIntention | null;
  marketId?: string | null;
  country?: string | null;
  reducedMotion?: boolean;
}) {
  const region = useMemo(() => onboardingBankRegion(marketId ?? null, previewRegion(country)), [marketId, country]);
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
    <View style={styles.previewContext}>
      <View style={styles.previewContextIcon}><Icon name={sourceIcon} size={18} color={night.primary} /></View>
      <View style={styles.grow}>
        <ThemedText type="micro" style={styles.kicker}>{t('onboardPreviewFrom')}</ThemedText>
        <ThemedText style={styles.previewContextTitle}>{trackingTitle(tracking)}</ThemedText>
        <ThemedText numberOfLines={2} style={styles.previewContextDetail}>{sourceDetail}</ThemedText>
      </View>
    </View>
    <Rise delay={120} reducedMotion={reducedMotion}>
      <FocusPreviewCard focus={current} currency={region?.currency ?? ''} />
    </Rise>
    <Rise delay={220} reducedMotion={reducedMotion} style={styles.previewOutcome}>
      <Icon name="check" size={14} color={night.primary} />
      <ThemedText style={styles.previewOutcomeText}>{intentionResult(intention)}</ThemedText>
    </Rise>
  </View>;
}

/* ------------------------------------------------------------------ */
/* Capture: which banks this phone will read                           */
/* ------------------------------------------------------------------ */

export function CaptureMarketScene({ marketId, country }: { marketId: string; country?: string | null }) {
  const region = useMemo(() => onboardingBankRegion(marketId, previewRegion(country)), [marketId, country]);
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
  atmosphereWash: { position: 'absolute', top: -80, start: -40, end: -40, height: 330 },
  wafraTile: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 9, shadowOffset: { width: 0, height: 5 }, elevation: 4 },
  logo: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  logoInitials: { color: '#FFFFFF', fontFamily: Fonts.sansSemi, letterSpacing: 0.3 },

  welcomeScene: { gap: 8 },
  posterStage: { minHeight: 204, justifyContent: 'center', gap: 6 },
  posterAlert: { minHeight: 64, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', backgroundColor: 'rgba(15,23,20,0.88)' },
  // Keep identity readable at large text sizes; the amount can use the next
  // line instead of squeezing bank and merchant names down to one character.
  posterAlertCopy: { flexGrow: 1, flexShrink: 1, flexBasis: 104, minWidth: 104, gap: 1 },
  posterBank: { color: night.text, fontFamily: Fonts.sansSemi, fontSize: 13, lineHeight: 17 },
  posterMerchant: { color: night.textSecondary, fontFamily: Fonts.sansMedium, fontSize: 12, lineHeight: 16 },
  posterKindLine: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: 3 },
  posterKindDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: night.expense },
  posterKindDotIncome: { backgroundColor: night.income },
  posterKind: { color: night.textTertiary, fontSize: 10, lineHeight: 14, flexShrink: 1 },
  posterAmount: { color: night.text, fontFamily: Fonts.monoSemi, fontSize: 14, writingDirection: 'ltr', maxWidth: '100%' },
  posterAmountIncome: { color: night.income },
  posterResult: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderColor: night.cardBorderStrong },
  posterResultKicker: { color: night.textTertiary, fontFamily: Fonts.monoMedium, letterSpacing: 0.9 },
  posterNetLine: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
  posterNet: { color: night.text, fontFamily: Fonts.monoSemi, fontSize: 26, lineHeight: 32, letterSpacing: -0.6, writingDirection: 'ltr', flexShrink: 1, maxWidth: '100%' },
  posterNetNote: { color: night.textSecondary, fontSize: 12 },
  posterFootnoteRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  posterFootnote: { color: night.textTertiary, fontSize: 11, lineHeight: 15 },
  miniCard: { borderWidth: 1, borderColor: night.cardBorderStrong, borderRadius: 18, padding: 12, backgroundColor: night.backgroundElement, gap: 6 },
  miniHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  miniTitle: { color: night.text, fontFamily: Fonts.sansSemi, fontSize: 15 },
  miniBigLine: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', paddingBottom: 2 },
  miniBig: { color: night.text, fontFamily: Fonts.monoSemi, fontSize: 28, letterSpacing: -0.5, writingDirection: 'ltr' },
  miniBigNote: { color: night.textSecondary, fontSize: 12 },
  miniRow: { minHeight: 36, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderColor: night.cardBorder },
  miniLead: { minWidth: 22, flexShrink: 0, color: night.warning, fontFamily: Fonts.monoMedium, fontSize: 13 },
  miniLabel: { flexGrow: 1, flexShrink: 1, flexBasis: 80, minWidth: 80, color: night.textSecondary, fontSize: 13 },
  miniPill: { maxWidth: '100%', paddingHorizontal: 7, paddingVertical: 2, borderRadius: Radius.full, borderWidth: 1, borderColor: night.cardBorderStrong },
  miniPillText: { color: night.textTertiary, fontSize: 10 },
  miniAmount: { marginStart: 'auto', maxWidth: '100%', color: night.text, fontFamily: Fonts.monoMedium, fontSize: 13, writingDirection: 'ltr' },
  miniTrio: { flexDirection: 'row', gap: 8 },
  miniStat: { flex: 1, gap: 4, paddingVertical: 8, borderTopWidth: 1, borderColor: night.cardBorderStrong },
  miniStatValue: { color: night.text, fontFamily: Fonts.monoSemi, fontSize: 18, writingDirection: 'ltr' },

  chooser: { gap: 10 },
  optionGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
  optionCell: { width: '50%', paddingHorizontal: 6 },
  optionTab: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 2, borderBottomWidth: 1, borderColor: night.cardBorderStrong },
  optionTabSelected: { borderBottomWidth: 2, borderColor: night.primary },
  optionText: { flex: 1, minWidth: 0, color: night.textTertiary, fontFamily: Fonts.sansMedium, fontSize: 14, lineHeight: 19 },
  optionTextSelected: { color: night.text },
  optionList: { gap: 0 },
  optionRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: night.cardBorder },
  optionRowSelected: { borderBottomWidth: 1, borderColor: night.primary },
  trackingScene: { gap: 8, paddingVertical: 9, borderTopWidth: 1, borderBottomWidth: 1, borderColor: night.cardBorderStrong },
  trackingSheet: { borderWidth: 1, borderColor: night.cardBorderStrong, borderRadius: 14, overflow: 'hidden', backgroundColor: night.backgroundElement },
  trackingSheetRow: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: night.cardBorder },
  trackingSheetKey: { flex: 1, color: night.textSecondary, fontSize: 12 },
  trackingSheetValue: { color: night.text, fontFamily: Fonts.monoMedium, fontSize: 12, writingDirection: 'ltr' },
  trackingPhone: { borderWidth: 1, borderColor: night.cardBorderStrong, borderRadius: 16, paddingHorizontal: 12, backgroundColor: night.backgroundElement },
  trackingPhoneTop: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 8 },
  trackingPhoneTitle: { color: night.text, fontFamily: Fonts.sansSemi, fontSize: 13 },
  trackingFresh: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 12 },
  trackingFreshTitle: { color: night.text, fontFamily: Fonts.sansSemi, fontSize: 14, lineHeight: 19 },
  trackingFreshBody: { color: night.textTertiary, fontSize: 12, lineHeight: 17, paddingTop: 2 },
  alertReach: { minHeight: 70, justifyContent: 'center', gap: 4 },
  alertReachRow: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 9 },
  alertReachLabel: { flexShrink: 1, color: night.text, fontFamily: Fonts.sansMedium, fontSize: 13, lineHeight: 18 },
  alertReachDetail: { marginStart: 'auto', flexShrink: 1, color: night.textTertiary, fontSize: 12, lineHeight: 17 },
  alertReachDetailCovered: { color: night.textSecondary },
  intentionScene: { gap: 7 },
  intentionSceneLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, paddingHorizontal: 2 },
  intentionSceneCopy: { flex: 1, color: night.textSecondary, fontFamily: Fonts.sansMedium, fontSize: 12, lineHeight: 18 },
  bankRow: { flexDirection: 'row', gap: 12 },
  bankItem: { flex: 1, minWidth: 0, alignItems: 'center', gap: 7 },
  bankName: { color: night.textSecondary, fontSize: 10, textAlign: 'center', maxWidth: '100%' },
  outcome: { minHeight: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  outcomeText: { flexShrink: 1, color: night.textSecondary, fontFamily: Fonts.sansMedium, fontSize: 12, lineHeight: 18, textAlign: 'center' },

  previewStep: { gap: 10 },
  previewContext: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  previewContextIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: night.primarySoft },
  previewContextTitle: { color: night.text, fontFamily: Fonts.sansSemi, fontSize: 14, lineHeight: 19 },
  previewContextDetail: { color: night.textTertiary, fontSize: 11, lineHeight: 15, paddingTop: 1 },
  previewOutcome: { minHeight: 34, flexDirection: 'row', alignItems: 'flex-start', gap: 7, paddingHorizontal: 2 },
  previewOutcomeText: { flex: 1, color: night.textSecondary, fontFamily: Fonts.sansMedium, fontSize: 12, lineHeight: 18 },
  nextList: { gap: 2 },
  nextItem: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: night.cardBorder },
  nextItemText: { flex: 1, color: night.textSecondary, fontSize: 13, lineHeight: 18 },

  captureScene: { gap: 8, marginTop: 6, paddingVertical: 8, borderTopWidth: 1, borderBottomWidth: 1, borderColor: night.cardBorderStrong },
  captureLedgerLine: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 },
  captureLedgerTitle: { color: night.text, fontFamily: Fonts.sansSemi, fontSize: 13 },
  captureLedgerBody: { color: night.textTertiary, fontSize: 11, lineHeight: 15 },
});
