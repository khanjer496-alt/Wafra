import { View, StyleSheet } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { t } from '@/lib/i18n';

const night = Colors.dark;

export function MoneyPreview({ reducedMotion }: { reducedMotion: boolean }) {
  const items = [
    { icon: 'briefcase' as const, label: t('onboardPreviewIncome'), detail: t('onboardPreviewIncomeDetail'), tone: night.income },
    { icon: 'bolt' as const, label: t('onboardPreviewBill'), detail: t('onboardPreviewBillDetail'), tone: night.warning },
    { icon: 'check' as const, label: t('onboardPreviewCard'), detail: t('onboardPreviewCardDetail'), tone: night.primary },
  ];

  return (
    <View style={styles.moneyPreview} accessible accessibilityLabel={t('onboardPreviewAccessibility')}>
      <View style={styles.previewHeader}>
        <ThemedText style={styles.previewOverline}>{t('onboardPreviewOverline')}</ThemedText>
        <View style={styles.livePill}>
          <ThemedText style={styles.liveLabel}>{t('onboardPreviewLive')}</ThemedText>
        </View>
      </View>
      <View style={styles.previewRows}>
        {items.map((item, index) => (
          <Animated.View
            key={item.label}
            entering={reducedMotion ? undefined : FadeInDown.delay(160 + index * 70).duration(360)}
            style={[styles.previewRow, index > 0 && styles.previewRowBorder]}>
            <View style={[styles.previewIcon, { backgroundColor: `${item.tone}1A` }]}>
              <Icon name={item.icon} size={17} color={item.tone} />
            </View>
            <View style={styles.previewCopy}>
              <ThemedText style={styles.previewLabel}>{item.label}</ThemedText>
              <ThemedText style={styles.previewDetail}>{item.detail}</ThemedText>
            </View>
            <Icon name="chevron-right" size={16} color={night.textTertiary} />
          </Animated.View>
        ))}
      </View>
      <View style={styles.previewFooter}>
        <Icon name="spark" size={15} color={night.primary} />
        <ThemedText style={styles.previewFooterText}>{t('onboardPreviewFooter')}</ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  moneyPreview: {
    overflow: 'hidden', borderRadius: Radius.bottomSheet, borderCurve: 'continuous', borderWidth: 1,
    borderColor: night.cardBorder, backgroundColor: night.backgroundElement,
  },
  previewHeader: { alignItems: 'flex-start', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingTop: Spacing.three, paddingBottom: Spacing.two },
  previewOverline: { color: night.textTertiary, fontFamily: Fonts.sansSemi, fontSize: 11, lineHeight: 15, letterSpacing: 0.7 },
  livePill: { alignSelf: 'stretch', minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', paddingHorizontal: 9, borderRadius: Radius.full, backgroundColor: night.primarySoft },
  liveLabel: { flexShrink: 1, color: night.primary, fontFamily: Fonts.sansSemi, fontSize: 11, lineHeight: 15, letterSpacing: 0.5 },
  previewRows: { paddingHorizontal: Spacing.three },
  previewRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  previewRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: night.cardBorder },
  previewIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  previewCopy: { flex: 1, gap: 2 },
  previewLabel: { color: night.text, fontFamily: Fonts.sansMedium, fontSize: 14, lineHeight: 19 },
  previewDetail: { color: night.textTertiary, fontFamily: Fonts.sans, fontSize: 11.5, lineHeight: 16 },
  previewFooter: { minHeight: 43, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: night.primaryBorder, backgroundColor: night.primarySoft },
  previewFooterText: { flex: 1, color: night.primary, fontFamily: Fonts.sansMedium, fontSize: 11.5 },
});
