import { Image } from 'expo-image';
import React, { useEffect, useMemo, useState } from 'react';
import { getLocales } from 'expo-localization';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Icon, type IconName } from '@/components/ui/icon';
import { WafraMark } from '@/components/wafra-logo';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { tapped } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { onboardingBankRegion, type OnboardingBankExample } from '@/lib/onboarding-bank-examples';
import { verifiedLogoUrl } from '@/lib/verified-logo-identities';
import type { OnboardingFocus, OnboardingTracking } from '@/lib/types';

const night = Colors.dark;
const deviceRegion = (): string | null => {
  try { return getLocales()[0]?.regionCode ?? null; } catch { return null; }
};

type FocusVisual = { id: OnboardingFocus; title: string; icon: IconName };

function BankLogo({ bank, size = 34 }: { bank: OnboardingBankExample | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const uri = bank ? verifiedLogoUrl(bank.domain) : null;
  if (!uri || failed) {
    return <View style={[styles.bankLogo, { width: size, height: size }]}>
      <Icon name="bank" size={Math.round(size * 0.48)} color={night.primary} />
    </View>;
  }
  return <View style={[styles.bankLogo, { width: size, height: size }]}>
    <Image source={{ uri }} contentFit="contain" cachePolicy="memory-disk" transition={0}
      onError={() => setFailed(true)} style={{ width: size - 8, height: size - 8 }} accessible={false} />
  </View>;
}

const sampleAmount = (currency: string, value: string): string => currency ? `${currency} ${value}` : value;

function RevealRow({ bank, label, amount, icon, offset, index, reducedMotion, income = false }: {
  bank: OnboardingBankExample | null;
  label: string;
  amount: string;
  icon: IconName;
  offset: number;
  index: number;
  reducedMotion: boolean;
  income?: boolean;
}) {
  const reveal = useSharedValue(reducedMotion ? 1 : 0);
  useEffect(() => {
    reveal.value = reducedMotion
      ? 1
      : withDelay(520 + index * 110, withTiming(1, {
        duration: 620,
        easing: Easing.out(Easing.cubic),
      }));
  }, [index, reducedMotion, reveal]);
  const motionStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(reveal.value, [0, 1], [offset, 0]) },
      { scale: interpolate(reveal.value, [0, 0.55, 1], [0.985, 1.006, 1]) },
    ],
    backgroundColor: interpolateColor(reveal.value, [0, 1], ['#1C1A16', 'rgba(28,26,22,0)']),
    borderColor: interpolateColor(reveal.value, [0, 1], [night.cardBorder, night.cardBorderStrong]),
  }));
  const bankStyle = useAnimatedStyle(() => ({ opacity: interpolate(reveal.value, [0.45, 0.92], [1, 0]) }));
  const ledgerIconStyle = useAnimatedStyle(() => ({ opacity: interpolate(reveal.value, [0.55, 0.98], [0, 1]) }));
  return <Animated.View style={[styles.revealRow, index > 0 && styles.revealRowDivider, motionStyle]}>
    <Animated.View style={bankStyle}><BankLogo bank={bank} size={34} /></Animated.View>
    <Animated.View style={[styles.revealLedgerIcon, ledgerIconStyle]}>
      <Icon name={icon} size={17} color={income ? night.income : night.textSecondary} />
    </Animated.View>
    <View style={styles.grow}>
      <ThemedText style={styles.alertBank}>{bank?.name ?? t('onboardRegionalBankGeneric')}</ThemedText>
      <ThemedText style={styles.alertLabel}>{label}</ThemedText>
    </View>
    <ThemedText style={[styles.alertAmount, income && { color: night.income }]} tabular>{amount}</ThemedText>
  </Animated.View>;
}

/** Real bank identities + the real Wafra mark. No invented apps or fake partner logos. */
export function WelcomeMoneyScene({ marketId, reducedMotion }: { marketId: string; reducedMotion: boolean }) {
  const region = useMemo(() => onboardingBankRegion(marketId, deviceRegion()), [marketId]);
  const banks = region?.banks ?? [];
  const currency = region?.currency ?? '';
  return <View style={styles.welcomeScene} testID="onboarding-market-money-scene">
    <View style={styles.sceneKickerRow}>
      <ThemedText type="micro" style={styles.kicker}>{t('onboardRegionalExample')}</ThemedText>
    </View>
    <View style={styles.revealStage}>
      <View style={styles.revealMarkLine}>
        <ThemedText type="micro" style={styles.kicker}>{t('onboardSceneFromAlerts')}</ThemedText>
        <View style={styles.realMark}><WafraMark size={28} color={night.primary} /></View>
        <ThemedText type="micro" style={styles.kicker}>{t('onboardSceneToLedger')}</ThemedText>
      </View>
      <View style={styles.scatteredStack}>
        <RevealRow bank={banks[0] ?? null} label={t('onboardScenePurchase')}
          amount={sampleAmount(currency, '24.50')} offset={0} reducedMotion={reducedMotion}
          index={0} icon="dining" />
        <RevealRow bank={banks[1] ?? null} label={t('onboardSceneBill')}
          amount={sampleAmount(currency, '120.00')} offset={22} reducedMotion={reducedMotion}
          index={1} icon="receipt" />
        <RevealRow bank={banks[2] ?? null} label={t('onboardSceneIncome')}
          amount={`+ ${sampleAmount(currency, '7,500')}`} offset={7} reducedMotion={reducedMotion}
          index={2} icon="arrow-up" income />
      </View>
    </View>
    <Animated.View entering={reducedMotion ? undefined : FadeIn.delay(980).duration(280)} style={styles.organizedLedger}>
      <View style={styles.ledgerHeader}>
        <ThemedText style={styles.ledgerTitle}>{t('onboardSceneOrganized')}</ThemedText>
        <Icon name="check" size={16} color={night.primary} />
      </View>
      <ThemedText style={styles.ledgerFootnote}>{t('onboardSceneRevealFootnote')}</ThemedText>
    </Animated.View>
  </View>;
}

function SpendingVisual() {
  const heights = [18, 34, 25, 48, 30, 58, 38];
  return <View style={styles.spendingVisual}>
    {heights.map((height, index) => <View key={index} style={[styles.miniBar, { height, opacity: 0.42 + index * 0.07 }]} />)}
  </View>;
}
function BillsVisual() {
  return <View style={styles.billsVisual}>
    {[
      ['7', t('onboardSceneElectricity')],
      ['12', t('onboardSceneCardDue')],
      ['18', t('onboardSceneInternet')],
    ].map(([day, title]) => <View key={title} style={styles.billMiniRow}>
      <ThemedText style={styles.billDay}>{day}</ThemedText><ThemedText style={styles.billText}>{title}</ThemedText>
      <View style={styles.billDot} />
    </View>)}
  </View>;
}
function CashflowVisual() {
  return <View style={styles.cashVisual}>
    <View style={styles.cashMetric}><Icon name="arrow-up" size={16} color={night.income} /><ThemedText style={styles.cashValue}>+ 7,500</ThemedText></View>
    <View style={styles.cashRule} />
    <View style={styles.cashMetric}><Icon name="trend" size={16} color={night.primary} /><ThemedText style={styles.cashValue}>+ 2,340 {t('onboardSceneNet')}</ThemedText></View>
  </View>;
}
function OverviewVisual() {
  return <View style={styles.overviewVisual}>
    <View style={styles.overviewNumber}><ThemedText style={styles.overviewLabel}>{t('onboardSceneSpent')}</ThemedText><ThemedText style={styles.overviewValue}>3,240</ThemedText></View>
    <View style={styles.overviewNumber}><ThemedText style={styles.overviewLabel}>{t('onboardSceneBills')}</ThemedText><ThemedText style={styles.overviewValue}>6</ThemedText></View>
    <View style={styles.overviewNumber}><ThemedText style={styles.overviewLabel}>{t('onboardSceneAccounts')}</ThemedText><ThemedText style={styles.overviewValue}>3</ThemedText></View>
  </View>;
}

/** One changing product preview with quiet choices below it, not four illustrated cards. */
export function FocusChooser({ value, onChange }: { value: OnboardingFocus | null; onChange(value: OnboardingFocus): void }) {
  const current: OnboardingFocus = value ?? 'spending';
  const options: FocusVisual[] = [
    { id: 'spending', title: t('onboardFocusSpending'), icon: 'chart' },
    { id: 'bills', title: t('onboardFocusBills'), icon: 'receipt' },
    { id: 'cashflow', title: t('onboardFocusCashflow'), icon: 'trend' },
    { id: 'overview', title: t('onboardFocusOverview'), icon: 'wallet' },
  ];
  return <View style={styles.focusChooser} testID="onboarding-focus-options">
    <View style={styles.focusStage} accessibilityLiveRegion="polite">
      <View style={styles.focusStageTop}>
        <View style={styles.focusStageIcon}><Icon name={options.find(item => item.id === current)!.icon} size={18} color={night.primary} /></View>
        <ThemedText style={styles.focusStageTitle}>{options.find(item => item.id === current)!.title}</ThemedText>
        <ThemedText type="micro" style={styles.focusPreviewLabel}>{t('onboardScenePreviewLabel')}</ThemedText>
      </View>
      <Animated.View key={current} entering={FadeIn.duration(180)} style={styles.focusVisualBody}>
        {current === 'spending' ? <SpendingVisual /> : current === 'bills' ? <BillsVisual /> : current === 'cashflow' ? <CashflowVisual /> : <OverviewVisual />}
      </Animated.View>
    </View>
    <View style={styles.focusTabs}>
      {options.map(option => {
        const selected = current === option.id && value !== null;
        return <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ checked: selected }}
          onPress={() => { tapped(); onChange(option.id); }} style={({ pressed }) => [styles.focusTab, selected && styles.focusTabSelected, { opacity: pressed ? 0.65 : 1 }]}>
          <ThemedText style={[styles.focusTabText, selected && styles.focusTabTextSelected]}>{option.title}</ThemedText>
        </Pressable>;
      })}
    </View>
  </View>;
}

export function TrackingChooser({ value, onChange, marketId }: {
  value: OnboardingTracking | null; onChange(value: OnboardingTracking): void; marketId: string;
}) {
  const region = useMemo(() => onboardingBankRegion(marketId, deviceRegion()), [marketId]);
  const banks = region?.banks ?? [];
  const options: { id: OnboardingTracking; label: string; icon: IconName }[] = [
    { id: 'bank-apps', label: t('onboardTrackingBankApps'), icon: 'bank' },
    { id: 'spreadsheet', label: t('onboardTrackingSpreadsheet'), icon: 'chart' },
    { id: 'finance-app', label: t('onboardTrackingFinanceApp'), icon: 'phone' },
    { id: 'none', label: t('onboardTrackingNone'), icon: 'spark' },
  ];
  const current = value ?? 'bank-apps';
  return <View style={styles.trackingScene} testID="onboarding-tracking-options">
    <Animated.View key={current} entering={FadeIn.duration(180)} style={styles.trackingStage} accessibilityLiveRegion="polite">
      {current === 'bank-apps' ? <>
        <View style={styles.bankCluster}>
          {[0, 1, 2].map((index) => <View key={index} style={[styles.bankClusterItem, { transform: [{ translateY: index === 1 ? 12 : index === 2 ? -5 : 0 }] }]}>
            <BankLogo bank={banks[index] ?? null} size={48} />
            <ThemedText numberOfLines={1} style={styles.bankClusterName}>{banks[index]?.name ?? t('onboardRegionalBankGeneric')}</ThemedText>
          </View>)}
        </View>
        <View style={styles.sceneFlowRail}><View style={styles.sceneFlowLine} /><WafraMark size={28} color={night.primary} /><View style={styles.sceneFlowLine} /></View>
        <View style={styles.trackingLedger}>
          <ThemedText type="micro" style={styles.kicker}>{t('onboardTrackingBankApps')}</ThemedText>
          <View style={styles.trackingLedgerRow}><Icon name="dining" size={16} color={night.textSecondary} /><ThemedText style={styles.trackingLedgerLabel}>{t('onboardScenePurchase')}</ThemedText><ThemedText style={styles.trackingLedgerAmount}>-24.50</ThemedText></View>
          <View style={styles.trackingLedgerRow}><Icon name="receipt" size={16} color={night.textSecondary} /><ThemedText style={styles.trackingLedgerLabel}>{t('onboardSceneBill')}</ThemedText><ThemedText style={styles.trackingLedgerAmount}>-120.00</ThemedText></View>
        </View>
      </> : current === 'spreadsheet' ? <>
        <View style={styles.sheetScene}>
          <View style={styles.sheetHeader}><ThemedText style={styles.sheetCellStrong}>{t('onboardTrackingSpreadsheet')}</ThemedText><ThemedText style={styles.sheetTiny}>A · B · C</ThemedText></View>
          {[['Sep 16', 'Talabat', '86.50'], ['Sep 15', 'DEWA', '318.00'], ['Sep 14', 'Salary', '+7,500']].map((row, index) => <View key={index} style={styles.sheetRow}>{row.map((cell, cellIndex) => <ThemedText key={cellIndex} style={[styles.sheetCell, cellIndex === 2 && styles.sheetCellAmount]}>{cell}</ThemedText>)}</View>)}
        </View>
        <View style={styles.sceneFlowRail}><View style={styles.sceneFlowLine} /><Icon name="chevron-down" size={18} color={night.primary} /><View style={styles.sceneFlowLine} /></View>
        <View style={styles.productStrip}><Icon name="check" size={17} color={night.primary} /><ThemedText style={styles.productStripText}>{t('onboardTrackingSpreadsheetScene')}</ThemedText></View>
      </> : current === 'finance-app' ? <>
        <View style={styles.financeScene}>
          <View style={styles.financeSceneTop}><Icon name="phone" size={18} color={night.textSecondary} /><ThemedText style={styles.financeSceneTitle}>{t('onboardTrackingFinanceApp')}</ThemedText></View>
          <View style={styles.financeBars}>{[36, 58, 28, 70, 44, 62].map((height, index) => <View key={index} style={[styles.financeBar, { height }]} />)}</View>
          <ThemedText style={styles.financeSceneBody}>{t('onboardTrackingFinanceScene')}</ThemedText>
        </View>
        <View style={styles.sceneFlowRail}><View style={styles.sceneFlowLine} /><WafraMark size={28} color={night.primary} /><View style={styles.sceneFlowLine} /></View>
        <View style={styles.productStrip}><Icon name="spark" size={17} color={night.primary} /><ThemedText style={styles.productStripText}>{t('onboardTrackingOneView')}</ThemedText></View>
      </> : <>
        <View style={styles.freshScene}>
          <View style={styles.freshOrbit}><WafraMark size={42} color={night.primary} /></View>
          <ThemedText style={styles.freshTitle}>{t('onboardTrackingFreshSceneTitle')}</ThemedText>
          <ThemedText style={styles.freshBody}>{t('onboardTrackingFreshSceneBody')}</ThemedText>
        </View>
      </>}
    </Animated.View>
    <View style={styles.trackingOptions}>
      {options.map(option => {
        const selected = value === option.id;
        return <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ checked: selected }}
          onPress={() => { tapped(); onChange(option.id); }} style={({ pressed }) => [styles.trackingOption, selected && styles.trackingOptionSelected, { opacity: pressed ? 0.65 : 1 }]}>
          <Icon name={option.icon} size={17} color={selected ? night.primary : night.textTertiary} />
          <ThemedText style={[styles.trackingOptionText, selected && { color: night.text }]}>{option.label}</ThemedText>
          {selected && <Icon name="check" size={15} color={night.primary} />}
        </Pressable>;
      })}
    </View>
  </View>;
}

export function PersonalizedProductPreview({ focus }: { focus: OnboardingFocus | null }) {
  const current = focus ?? 'overview';
  return <View style={styles.productPreview} testID="onboarding-product-preview">
    <View style={styles.productPreviewHead}>
      <View><ThemedText style={styles.productEyebrow}>{t('onboardSceneYourView')}</ThemedText>
        <ThemedText style={styles.productTitle}>{t(current === 'bills' ? 'onboardFocusBills' : current === 'cashflow' ? 'onboardFocusCashflow' : current === 'spending' ? 'onboardFocusSpending' : 'onboardFocusOverview')}</ThemedText></View>
      <WafraMark size={28} color={night.primary} />
    </View>
    <Animated.View key={current} entering={FadeIn.duration(180)}>
      {current === 'spending' ? <SpendingVisual /> : current === 'bills' ? <BillsVisual /> : current === 'cashflow' ? <CashflowVisual /> : <OverviewVisual />}
    </Animated.View>
    <View style={styles.previewActivity}>
      <View style={styles.previewActivityRow}><Icon name="dining" size={16} color={night.textSecondary} /><ThemedText style={styles.previewActivityLabel}>{t('onboardScenePurchase')}</ThemedText><ThemedText style={styles.previewActivityAmount}>-24.50</ThemedText></View>
      <View style={styles.previewActivityRow}><Icon name="arrow-up" size={16} color={night.income} /><ThemedText style={styles.previewActivityLabel}>{t('onboardSceneIncome')}</ThemedText><ThemedText style={[styles.previewActivityAmount, { color: night.income }]}>+7,500</ThemedText></View>
    </View>
  </View>;
}

export function CaptureMarketScene({ marketId }: { marketId: string }) {
  const region = useMemo(() => onboardingBankRegion(marketId, deviceRegion()), [marketId]);
  const banks = region?.banks ?? [];
  return <View style={styles.captureMarketScene} testID="onboarding-capture-market-scene">
    <View style={styles.captureBankLine}>
      {[0, 1, 2].map(index => <View key={index} style={styles.captureBankItem}>
        <BankLogo bank={banks[index] ?? null} size={44} />
        <ThemedText numberOfLines={1} style={styles.captureBankName}>{banks[index]?.name ?? t('onboardRegionalBankGeneric')}</ThemedText>
      </View>)}
    </View>
    <View style={styles.captureLedgerLine}>
      <Icon name="mail" size={18} color={night.textSecondary} />
      <View style={styles.grow}><ThemedText style={styles.captureLedgerTitle}>{t('onboardCaptureSceneIncoming')}</ThemedText><ThemedText style={styles.captureLedgerBody}>{t('onboardCaptureSceneOrganized')}</ThemedText></View>
      <Icon name="chevron-right" size={18} color={night.primary} />
    </View>
  </View>;
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  kicker: { color: night.textTertiary, fontFamily: Fonts.monoMedium, letterSpacing: 0.7 },
  welcomeScene: { gap: 12, paddingVertical: 10 },
  sceneKickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  revealStage: { gap: 10 },
  revealMarkLine: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  scatteredStack: { gap: 6, paddingVertical: 2 },
  bankLogo: { borderRadius: Radius.tile, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', overflow: 'hidden' },
  alertBank: { color: night.text, fontFamily: Fonts.sansSemi, fontSize: 12, lineHeight: 16 },
  alertLabel: { color: night.textTertiary, fontSize: 11, lineHeight: 15 },
  alertAmount: { color: night.text, fontFamily: Fonts.monoMedium, fontSize: 12, writingDirection: 'ltr' },
  revealRow: { minHeight: 58, maxWidth: '94%', flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 11, paddingVertical: 9, borderRadius: Radius.control, borderWidth: StyleSheet.hairlineWidth },
  revealRowDivider: { borderTopWidth: StyleSheet.hairlineWidth },
  revealLedgerIcon: { position: 'absolute', start: 18, width: 18, alignItems: 'center', justifyContent: 'center' },
  realMark: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: night.primarySoft },
  organizedLedger: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: night.cardBorderStrong, paddingVertical: 8 },
  ledgerHeader: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ledgerTitle: { color: night.text, fontFamily: Fonts.sansSemi, fontSize: 13 },
  ledgerFootnote: { color: night.textTertiary, fontSize: 11, lineHeight: 16, paddingTop: 4 },
  focusChooser: { gap: 14 }, focusStage: { minHeight: 176, justifyContent: 'space-between', paddingVertical: 16, borderTopWidth: 1, borderBottomWidth: 1, borderColor: night.cardBorderStrong },
  focusStageTop: { flexDirection: 'row', alignItems: 'center', gap: 10 }, focusStageIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: night.primarySoft },
  focusStageTitle: { flex: 1, color: night.text, fontFamily: Fonts.sansSemi, fontSize: 18 },
  focusPreviewLabel: { color: night.textTertiary, fontFamily: Fonts.monoMedium, letterSpacing: 0.6 },
  focusVisualBody: { minHeight: 92, justifyContent: 'flex-end' },
  focusTabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, focusTab: { minHeight: 42, justifyContent: 'center', paddingHorizontal: 12, borderBottomWidth: 1, borderColor: night.cardBorderStrong },
  focusTabSelected: { borderColor: night.primary }, focusTabText: { color: night.textTertiary, fontFamily: Fonts.sansMedium, fontSize: 13 }, focusTabTextSelected: { color: night.primary },
  spendingVisual: { height: 78, flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 8 }, miniBar: { flex: 1, maxWidth: 32, borderRadius: 3, backgroundColor: night.primary },
  billsVisual: { gap: 2 }, billMiniRow: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderColor: night.cardBorder },
  billDay: { width: 28, color: night.primary, fontFamily: Fonts.monoSemi, fontSize: 15 }, billText: { flex: 1, color: night.textSecondary, fontSize: 13 }, billDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: night.warning },
  cashVisual: { gap: 12, paddingVertical: 8 }, cashMetric: { flexDirection: 'row', alignItems: 'center', gap: 9 }, cashValue: { color: night.text, fontFamily: Fonts.monoSemi, fontSize: 22 }, cashRule: { height: 1, backgroundColor: night.cardBorder },
  overviewVisual: { flexDirection: 'row', gap: 8 }, overviewNumber: { flex: 1, gap: 5, paddingVertical: 10, borderTopWidth: 1, borderColor: night.cardBorderStrong }, overviewLabel: { color: night.textTertiary, fontSize: 11 }, overviewValue: { color: night.text, fontFamily: Fonts.monoSemi, fontSize: 18 },
  trackingScene: { gap: 18 },
  trackingStage: { minHeight: 240, justifyContent: 'center', gap: 14, borderTopWidth: 1, borderBottomWidth: 1, borderColor: night.cardBorderStrong, paddingVertical: 14 },
  bankCluster: { minHeight: 88, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12 },
  bankClusterItem: { width: 84, alignItems: 'center', gap: 7 },
  bankClusterName: { maxWidth: 82, color: night.textTertiary, fontSize: 9, lineHeight: 12, textAlign: 'center' },
  sceneFlowRail: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sceneFlowLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: night.cardBorderStrong },
  trackingLedger: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: night.cardBorder },
  trackingLedgerRow: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: night.cardBorder },
  trackingLedgerLabel: { flex: 1, color: night.textSecondary, fontSize: 12 },
  trackingLedgerAmount: { color: night.text, fontFamily: Fonts.monoMedium, fontSize: 12 },
  sheetScene: { borderWidth: StyleSheet.hairlineWidth, borderColor: night.cardBorderStrong, borderRadius: Radius.control, overflow: 'hidden' },
  sheetHeader: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, backgroundColor: night.backgroundElement },
  sheetCellStrong: { color: night.text, fontFamily: Fonts.sansSemi, fontSize: 12 },
  sheetTiny: { color: night.textTertiary, fontFamily: Fonts.monoMedium, fontSize: 10 },
  sheetRow: { minHeight: 36, flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderColor: night.cardBorder, paddingHorizontal: 10 },
  sheetCell: { flex: 1, color: night.textSecondary, fontSize: 10 },
  sheetCellAmount: { textAlign: 'right', color: night.text, fontFamily: Fonts.monoMedium },
  productStrip: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  productStripText: { color: night.textSecondary, fontFamily: Fonts.sansMedium, fontSize: 12 },
  financeScene: { gap: 12, paddingVertical: 6 },
  financeSceneTop: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  financeSceneTitle: { color: night.text, fontFamily: Fonts.sansSemi, fontSize: 13 },
  financeBars: { height: 78, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 9 },
  financeBar: { width: 24, borderRadius: 3, backgroundColor: night.primary, opacity: 0.55 },
  financeSceneBody: { color: night.textTertiary, fontSize: 11, lineHeight: 16, textAlign: 'center' },
  freshScene: { minHeight: 190, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 26 },
  freshOrbit: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: night.primaryBorder, backgroundColor: night.primarySoft },
  freshTitle: { color: night.text, fontFamily: Fonts.sansSemi, fontSize: 18, textAlign: 'center' },
  freshBody: { color: night.textSecondary, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  trackingOptions: { gap: 0 }, trackingOption: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: night.cardBorder, paddingVertical: 8 },
  trackingOptionSelected: { borderColor: night.primary }, trackingOptionText: { flex: 1, color: night.textSecondary, fontFamily: Fonts.sansMedium, fontSize: 13 },
  productPreview: { gap: 16, paddingVertical: 16, borderTopWidth: 1, borderBottomWidth: 1, borderColor: night.cardBorderStrong }, productPreviewHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  productEyebrow: { color: night.textTertiary, fontSize: 11, fontFamily: Fonts.sansMedium }, productTitle: { color: night.text, fontFamily: Fonts.sansSemi, fontSize: 21, lineHeight: 28 }, previewActivity: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: night.cardBorder },
  previewActivityRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 9 }, previewActivityLabel: { flex: 1, color: night.textSecondary, fontSize: 12 }, previewActivityAmount: { color: night.expense, fontFamily: Fonts.monoMedium, fontSize: 12 },
  captureMarketScene: { gap: 14, marginTop: Spacing.three, paddingVertical: 12, borderTopWidth: 1, borderBottomWidth: 1, borderColor: night.cardBorderStrong },
  captureBankLine: { flexDirection: 'row', gap: 12 }, captureBankItem: { flex: 1, minWidth: 0, alignItems: 'center', gap: 7 }, captureBankName: { color: night.textSecondary, fontSize: 10, textAlign: 'center', maxWidth: '100%' },
  captureLedgerLine: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10 }, captureLedgerTitle: { color: night.text, fontFamily: Fonts.sansSemi, fontSize: 13 }, captureLedgerBody: { color: night.textTertiary, fontSize: 11, lineHeight: 15 },
});
