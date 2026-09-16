import { Image } from 'expo-image';
import React, { useEffect, useMemo, useState } from 'react';
import { getLocales } from 'expo-localization';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
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

function FlowSketch({ compact = false }: { compact?: boolean }) {
  const width = 340;
  const height = compact ? 120 : 180;
  return <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} style={StyleSheet.absoluteFillObject} pointerEvents="none">
    <Path d={compact ? 'M18 36 C92 28 118 74 170 62 C222 50 250 20 324 30' : 'M12 40 C82 18 112 86 170 72 C228 58 254 18 328 34'}
      stroke={night.primaryBorder} strokeWidth={1.2} fill="none" strokeDasharray="4 6" />
    <Path d={compact ? 'M26 92 C88 106 124 78 170 82 C220 86 268 112 322 88' : 'M18 138 C86 162 126 108 172 116 C226 124 268 160 326 130'}
      stroke={night.cardBorderStrong} strokeWidth={1} fill="none" />
    <Circle cx="170" cy={compact ? 62 : 92} r="3.5" fill={night.primary} />
    <Circle cx="46" cy={compact ? 38 : 42} r="2" fill={night.textTertiary} />
    <Circle cx="298" cy={compact ? 32 : 36} r="2" fill={night.textTertiary} />
  </Svg>;
}

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
      <FlowSketch />
      <View style={styles.bankConstellation} pointerEvents="none">
        <View style={[styles.constellationBank, styles.constellationBankLeft]}><BankLogo bank={banks[0] ?? null} size={44} /></View>
        <View style={[styles.constellationBank, styles.constellationBankTop]}><BankLogo bank={banks[1] ?? null} size={38} /></View>
        <View style={[styles.constellationBank, styles.constellationBankRight]}><BankLogo bank={banks[2] ?? null} size={44} /></View>
      </View>
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
  const heights = [26, 46, 34, 68, 42, 84, 56];
  return <View style={styles.editorialVisual}>
    <View style={styles.metricHero}>
      <ThemedText style={styles.metricEyebrow}>{t('onboardSceneSpent')}</ThemedText>
      <ThemedText tabular style={styles.metricBig}>3,240</ThemedText>
      <ThemedText style={styles.metricCaption}>{t('onboardScenePreviewLabel')}</ThemedText>
    </View>
    <View style={styles.spendingVisual}>
      {heights.map((height, index) => <View key={index} style={[styles.miniBar, { height, opacity: 0.35 + index * 0.08 }]} />)}
    </View>
    <View style={styles.visualFooter}>
      <Icon name="dining" size={16} color={night.primary} />
      <ThemedText style={styles.visualFooterLabel}>{t('onboardFocusSpendingDetail')}</ThemedText>
    </View>
  </View>;
}
function BillsVisual() {
  return <View style={styles.editorialVisual}>
    <View style={styles.billHeroLine}>
      <View style={styles.dueDisc}><ThemedText style={styles.dueDiscDay}>12</ThemedText><ThemedText style={styles.dueDiscMonth}>SEP</ThemedText></View>
      <View style={styles.grow}><ThemedText style={styles.metricEyebrow}>{t('onboardSceneBills')}</ThemedText><ThemedText style={styles.billHeroTitle}>{t('onboardFocusBills')}</ThemedText></View>
      <Icon name="receipt" size={22} color={night.primary} />
    </View>
    <View style={styles.billsVisual}>
      {[
        ['7', t('onboardSceneElectricity')],
        ['12', t('onboardSceneCardDue')],
        ['18', t('onboardSceneInternet')],
      ].map(([day, title], index) => <View key={title} style={styles.billMiniRow}>
        <View style={[styles.timelineDot, index === 1 && styles.timelineDotActive]} />
        <ThemedText style={styles.billDay}>{day}</ThemedText><ThemedText style={styles.billText}>{title}</ThemedText>
        <Icon name="chevron-right" size={14} color={night.textTertiary} />
      </View>)}
    </View>
  </View>;
}
function CashflowVisual() {
  return <View style={styles.editorialVisual}>
    <View style={styles.metricHero}>
      <ThemedText style={styles.metricEyebrow}>{t('onboardSceneNet')}</ThemedText>
      <ThemedText tabular style={[styles.metricBig, { color: night.income }]}>+2,340</ThemedText>
      <ThemedText style={styles.metricCaption}>{t('onboardScenePreviewLabel')}</ThemedText>
    </View>
    <View style={styles.cashSplit}>
      <View style={styles.cashLane}><Icon name="arrow-up" size={15} color={night.income} /><ThemedText style={styles.cashLaneLabel}>IN</ThemedText><ThemedText tabular style={styles.cashLaneValue}>7,500</ThemedText></View>
      <View style={styles.cashLane}><Icon name="arrow-down" size={15} color={night.expense} /><ThemedText style={styles.cashLaneLabel}>OUT</ThemedText><ThemedText tabular style={styles.cashLaneValue}>5,160</ThemedText></View>
    </View>
  </View>;
}
function OverviewVisual() {
  return <View style={styles.editorialVisual}>
    <View style={styles.overviewHero}>
      <ThemedText style={styles.metricEyebrow}>{t('onboardFocusOverview')}</ThemedText>
      <WafraMark size={34} color={night.primary} />
    </View>
    <View style={styles.overviewVisual}>
      <View style={[styles.overviewNumber, styles.overviewNumberWide]}><ThemedText style={styles.overviewLabel}>{t('onboardSceneSpent')}</ThemedText><ThemedText style={styles.overviewValueBig}>3,240</ThemedText></View>
      <View style={styles.overviewNumber}><ThemedText style={styles.overviewLabel}>{t('onboardSceneBills')}</ThemedText><ThemedText style={styles.overviewValue}>6</ThemedText></View>
      <View style={styles.overviewNumber}><ThemedText style={styles.overviewLabel}>{t('onboardSceneAccounts')}</ThemedText><ThemedText style={styles.overviewValue}>3</ThemedText></View>
    </View>
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
          <FlowSketch compact />
          {[0, 1, 2].map((index) => <View key={index} style={[styles.bankClusterItem, { transform: [{ translateY: index === 1 ? 12 : index === 2 ? -5 : 0 }] }]}>
            <BankLogo bank={banks[index] ?? null} size={48} />
            <ThemedText numberOfLines={1} style={styles.bankClusterName}>{banks[index]?.name ?? t('onboardRegionalBankGeneric')}</ThemedText>
          </View>)}
        </View>
        <View style={styles.sceneFlowRail}><View style={styles.sceneFlowLine} /><View style={styles.flowMark}><WafraMark size={30} color={night.primary} /></View><View style={styles.sceneFlowLine} /></View>
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
    <FlowSketch compact />
    <View style={styles.captureBankLine}>
      {[0, 1, 2].map(index => <View key={index} style={styles.captureBankItem}>
        <BankLogo bank={banks[index] ?? null} size={44} />
        <ThemedText numberOfLines={1} style={styles.captureBankName}>{banks[index]?.name ?? t('onboardRegionalBankGeneric')}</ThemedText>
      </View>)}
    </View>
    <View style={styles.captureCenterMark}><WafraMark size={34} color={night.primary} /></View>
    <View style={styles.captureLedgerLine}>
      <View style={styles.capturePulse}><Icon name="mail" size={18} color={night.primary} /></View>
      <View style={styles.grow}><ThemedText style={styles.captureLedgerTitle}>{t('onboardCaptureSceneIncoming')}</ThemedText><ThemedText style={styles.captureLedgerBody}>{t('onboardCaptureSceneOrganized')}</ThemedText></View>
      <Icon name="chevron-right" size={18} color={night.primary} />
    </View>
  </View>;
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  kicker: { color: night.textTertiary, fontFamily: Fonts.monoMedium, letterSpacing: 0.9, fontSize: 10 },
  welcomeScene: { gap: 12, paddingVertical: 6 },
  sceneKickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  revealStage: { minHeight: 290, gap: 10, overflow: 'hidden', borderRadius: 28, padding: 14, backgroundColor: '#171612', borderWidth: 1, borderColor: night.cardBorder },
  bankConstellation: { ...StyleSheet.absoluteFillObject },
  constellationBank: { position: 'absolute', opacity: 0.26 },
  constellationBankLeft: { top: 48, start: 22, transform: [{ rotate: '-9deg' }] },
  constellationBankTop: { top: 18, start: '45%', transform: [{ rotate: '5deg' }] },
  constellationBankRight: { top: 58, end: 20, transform: [{ rotate: '10deg' }] },
  revealMarkLine: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, zIndex: 2 },
  scatteredStack: { gap: 5, paddingTop: 20, zIndex: 3 },
  bankLogo: { borderRadius: Radius.tile, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  alertBank: { color: night.text, fontFamily: Fonts.sansSemi, fontSize: 12, lineHeight: 16 },
  alertLabel: { color: night.textTertiary, fontSize: 11, lineHeight: 15 },
  alertAmount: { color: night.text, fontFamily: Fonts.monoSemi, fontSize: 13, writingDirection: 'ltr' },
  revealRow: { minHeight: 62, maxWidth: '96%', flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 17, borderWidth: StyleSheet.hairlineWidth },
  revealRowDivider: { marginTop: 1 },
  revealLedgerIcon: { position: 'absolute', start: 20, width: 18, alignItems: 'center', justifyContent: 'center' },
  realMark: { width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#11110E', borderWidth: 1, borderColor: night.primaryBorder },
  organizedLedger: { marginTop: -2, paddingVertical: 10, paddingHorizontal: 2, borderBottomWidth: 1, borderColor: night.cardBorderStrong },
  ledgerHeader: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ledgerTitle: { color: night.text, fontFamily: Fonts.sansSemi, fontSize: 14 },
  ledgerFootnote: { color: night.textTertiary, fontSize: 11, lineHeight: 16 },

  focusChooser: { gap: 16 },
  focusStage: { minHeight: 290, justifyContent: 'space-between', padding: 16, borderRadius: 28, backgroundColor: '#171612', borderWidth: 1, borderColor: night.cardBorder, overflow: 'hidden' },
  focusStageTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  focusStageIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: night.primaryBorder },
  focusStageTitle: { flex: 1, color: night.text, fontFamily: Fonts.sansSemi, fontSize: 18, letterSpacing: -0.4 },
  focusPreviewLabel: { color: night.textTertiary, fontFamily: Fonts.monoMedium, letterSpacing: 0.7 },
  focusVisualBody: { minHeight: 205, justifyContent: 'center' },
  focusTabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  focusTab: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 13, borderRadius: 20, borderWidth: 1, borderColor: night.cardBorderStrong, backgroundColor: 'transparent' },
  focusTabSelected: { borderColor: night.primary, backgroundColor: night.primarySoft },
  focusTabText: { color: night.textTertiary, fontFamily: Fonts.sansMedium, fontSize: 12 },
  focusTabTextSelected: { color: night.primary },

  editorialVisual: { gap: 14 },
  metricHero: { alignItems: 'flex-start', gap: 1, paddingTop: 6 },
  metricEyebrow: { color: night.textTertiary, fontFamily: Fonts.monoMedium, fontSize: 10, letterSpacing: 0.9, textTransform: 'uppercase' },
  metricBig: { color: night.text, fontFamily: Fonts.monoSemi, fontSize: 48, lineHeight: 55, letterSpacing: -2 },
  metricCaption: { color: night.textTertiary, fontSize: 10 },
  spendingVisual: { height: 92, flexDirection: 'row', alignItems: 'flex-end', gap: 7, paddingHorizontal: 2 },
  miniBar: { flex: 1, maxWidth: 36, borderTopLeftRadius: 7, borderTopRightRadius: 7, backgroundColor: night.primary },
  visualFooter: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 9, borderTopWidth: StyleSheet.hairlineWidth, borderColor: night.cardBorderStrong, paddingTop: 8 },
  visualFooterLabel: { flex: 1, color: night.textSecondary, fontSize: 11, lineHeight: 15 },
  billHeroLine: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dueDisc: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: night.primaryBorder, backgroundColor: night.primarySoft },
  dueDiscDay: { color: night.text, fontFamily: Fonts.monoSemi, fontSize: 21, lineHeight: 23 },
  dueDiscMonth: { color: night.primary, fontFamily: Fonts.monoMedium, fontSize: 9, letterSpacing: 1 },
  billHeroTitle: { color: night.text, fontFamily: Fonts.sansSemi, fontSize: 20, lineHeight: 25 },
  billsVisual: { gap: 0, paddingStart: 8 },
  billMiniRow: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: night.cardBorder },
  timelineDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: night.cardBorderStrong },
  timelineDotActive: { width: 10, height: 10, borderRadius: 5, backgroundColor: night.primary },
  billDay: { width: 24, color: night.primary, fontFamily: Fonts.monoSemi, fontSize: 13 },
  billText: { flex: 1, color: night.textSecondary, fontSize: 12 },
  cashSplit: { flexDirection: 'row', gap: 12 },
  cashLane: { flex: 1, minHeight: 70, justifyContent: 'center', gap: 4, paddingTop: 10, borderTopWidth: 1, borderColor: night.cardBorderStrong },
  cashLaneLabel: { color: night.textTertiary, fontFamily: Fonts.monoMedium, fontSize: 9, letterSpacing: 1 },
  cashLaneValue: { color: night.text, fontFamily: Fonts.monoSemi, fontSize: 20 },
  overviewHero: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  overviewVisual: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  overviewNumber: { width: '31%', gap: 5, paddingVertical: 12, borderTopWidth: 1, borderColor: night.cardBorderStrong },
  overviewNumberWide: { width: '100%' },
  overviewLabel: { color: night.textTertiary, fontSize: 10 },
  overviewValue: { color: night.text, fontFamily: Fonts.monoSemi, fontSize: 22 },
  overviewValueBig: { color: night.text, fontFamily: Fonts.monoSemi, fontSize: 44, lineHeight: 50, letterSpacing: -1.5 },

  trackingScene: { gap: 16 },
  trackingStage: { minHeight: 285, justifyContent: 'center', gap: 14, borderRadius: 28, backgroundColor: '#171612', borderWidth: 1, borderColor: night.cardBorder, padding: 16, overflow: 'hidden' },
  bankCluster: { minHeight: 105, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: -3, position: 'relative' },
  bankClusterItem: { width: 92, alignItems: 'center', gap: 7, zIndex: 2 },
  bankClusterName: { maxWidth: 86, color: night.textTertiary, fontSize: 9, lineHeight: 12, textAlign: 'center' },
  sceneFlowRail: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sceneFlowLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: night.primaryBorder },
  flowMark: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: night.primaryBorder, backgroundColor: '#11110E' },
  trackingLedger: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: night.cardBorder },
  trackingLedgerRow: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: night.cardBorder },
  trackingLedgerLabel: { flex: 1, color: night.textSecondary, fontSize: 12 },
  trackingLedgerAmount: { color: night.text, fontFamily: Fonts.monoMedium, fontSize: 12 },
  sheetScene: { borderWidth: 1, borderColor: night.cardBorderStrong, borderRadius: 18, overflow: 'hidden', transform: [{ rotate: '-1.5deg' }], backgroundColor: '#1B1915' },
  sheetHeader: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, backgroundColor: night.backgroundElement },
  sheetCellStrong: { color: night.text, fontFamily: Fonts.sansSemi, fontSize: 12 },
  sheetTiny: { color: night.textTertiary, fontFamily: Fonts.monoMedium, fontSize: 10 },
  sheetRow: { minHeight: 39, flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderColor: night.cardBorder, paddingHorizontal: 10 },
  sheetCell: { flex: 1, color: night.textSecondary, fontSize: 10 },
  sheetCellAmount: { textAlign: 'right', color: night.text, fontFamily: Fonts.monoMedium },
  productStrip: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  productStripText: { color: night.textSecondary, fontFamily: Fonts.sansMedium, fontSize: 12 },
  financeScene: { gap: 14, paddingVertical: 4 },
  financeSceneTop: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  financeSceneTitle: { color: night.text, fontFamily: Fonts.sansSemi, fontSize: 14 },
  financeBars: { height: 112, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 10 },
  financeBar: { width: 27, borderTopLeftRadius: 8, borderTopRightRadius: 8, backgroundColor: night.primary, opacity: 0.55 },
  financeSceneBody: { color: night.textTertiary, fontSize: 11, lineHeight: 16, textAlign: 'center' },
  freshScene: { minHeight: 220, alignItems: 'center', justifyContent: 'center', gap: 13, paddingHorizontal: 26 },
  freshOrbit: { width: 94, height: 94, borderRadius: 47, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: night.primaryBorder, backgroundColor: '#11110E' },
  freshTitle: { color: night.text, fontFamily: Fonts.sansSemi, fontSize: 26, lineHeight: 32, letterSpacing: -0.7, textAlign: 'center' },
  freshBody: { color: night.textSecondary, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  trackingOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  trackingOption: { minHeight: 42, flexGrow: 1, minWidth: '46%', flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: night.cardBorderStrong, borderRadius: 21, paddingHorizontal: 12, paddingVertical: 8 },
  trackingOptionSelected: { borderColor: night.primary, backgroundColor: night.primarySoft },
  trackingOptionText: { flex: 1, color: night.textSecondary, fontFamily: Fonts.sansMedium, fontSize: 11 },

  productPreview: { gap: 16, padding: 18, borderRadius: 28, backgroundColor: '#171612', borderWidth: 1, borderColor: night.cardBorder, overflow: 'hidden' },
  productPreviewHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  productEyebrow: { color: night.primary, fontSize: 10, fontFamily: Fonts.monoMedium, letterSpacing: 0.8 },
  productTitle: { color: night.text, fontFamily: Fonts.sansSemi, fontSize: 25, lineHeight: 31, letterSpacing: -0.6 },
  previewActivity: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: night.cardBorderStrong },
  previewActivityRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 9 },
  previewActivityLabel: { flex: 1, color: night.textSecondary, fontSize: 12 },
  previewActivityAmount: { color: night.expense, fontFamily: Fonts.monoMedium, fontSize: 12 },

  captureMarketScene: { minHeight: 220, gap: 14, marginTop: Spacing.three, padding: 16, borderRadius: 28, backgroundColor: '#171612', borderWidth: 1, borderColor: night.cardBorder, overflow: 'hidden', position: 'relative' },
  captureBankLine: { flexDirection: 'row', gap: 4, justifyContent: 'center', zIndex: 2 },
  captureBankItem: { width: 92, minWidth: 0, alignItems: 'center', gap: 7 },
  captureBankName: { color: night.textSecondary, fontSize: 9, lineHeight: 12, textAlign: 'center', maxWidth: '100%' },
  captureCenterMark: { alignSelf: 'center', width: 58, height: 58, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#11110E', borderWidth: 1, borderColor: night.primaryBorder, zIndex: 3 },
  captureLedgerLine: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderColor: night.cardBorderStrong, paddingTop: 10, zIndex: 2 },
  capturePulse: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: night.primarySoft },
  captureLedgerTitle: { color: night.text, fontFamily: Fonts.sansSemi, fontSize: 13 },
  captureLedgerBody: { color: night.textTertiary, fontSize: 11, lineHeight: 15 },
});
