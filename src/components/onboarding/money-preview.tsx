import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { t } from '@/lib/i18n';
import { tapped } from '@/lib/haptics';

const night = Colors.dark;

/** A local demonstration. Its sample never enters the ledger or setup state. */
export function MoneyPreview({ reducedMotion }: { reducedMotion: boolean }) {
  const language = useLanguage();
  const [revealed, setRevealed] = useState(false);
  return (
    <View style={styles.preview} testID="onboarding-example">
      <View style={styles.heading}>
        <ThemedText type="micro" style={styles.muted}>{t('onboardSampleLabel', language)}</ThemedText>
        <ThemedText type="meta" style={styles.muted}>
          {t(revealed ? 'onboardSampleAfter' : 'onboardSampleBefore', language)}
        </ThemedText>
      </View>
      <Animated.View key={String(revealed)} entering={reducedMotion ? undefined : FadeIn.duration(220)}
        style={styles.story} accessibilityLiveRegion="polite">
        <View style={styles.source}>
          <Icon name={revealed ? 'dining' : 'mail'} color={night.primary} size={22} />
          <ThemedText type="smallBold" style={styles.ink}>
            {t(revealed ? 'onboardSampleMerchant' : 'onboardSampleBankAlert', language)}
          </ThemedText>
        </View>
        <ThemedText tabular style={styles.amount} accessibilityLabel="AED 24.50">AED 24.50</ThemedText>
        <ThemedText style={styles.detail}>
          {t(revealed ? 'onboardSampleCategory' : 'onboardSampleMessage', language)}
        </ThemedText>
        {revealed && <View style={styles.insight}>
          <Icon name="check" size={16} color={night.primary} />
          <ThemedText type="meta" style={styles.insightText}>{t('onboardSampleInsight', language)}</ThemedText>
        </View>}
      </Animated.View>
      <Pressable accessibilityRole="button"
        accessibilityLabel={t(revealed ? 'onboardSampleReset' : 'onboardSampleAction', language)}
        accessibilityHint={t('onboardSampleNote', language)}
        onPress={() => { tapped(); setRevealed((value) => !value); }}
        style={({ pressed }) => [styles.action, { opacity: pressed ? 0.65 : 1 }]}>
        <ThemedText type="smallBold" style={styles.accent}>
          {t(revealed ? 'onboardSampleReset' : 'onboardSampleAction', language)}
        </ThemedText>
        <Icon name={revealed ? 'repeat' : 'chevron-right'} size={18} color={night.primary} />
      </Pressable>
      <ThemedText type="meta" style={styles.note}>{t('onboardSampleNote', language)}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  preview: { gap: Spacing.three, paddingVertical: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: night.cardBorderStrong },
  heading: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, alignItems: 'center', justifyContent: 'space-between' },
  story: { gap: Spacing.two, paddingVertical: Spacing.two },
  source: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  amount: { color: night.text, fontFamily: Fonts.monoSemi, fontSize: 36, lineHeight: 46, writingDirection: 'ltr', textAlign: 'left' },
  detail: { color: night.textSecondary, fontSize: 15, lineHeight: 23 },
  insight: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, paddingTop: Spacing.one },
  insightText: { color: night.primary, flex: 1 },
  action: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  ink: { color: night.text, flexShrink: 1 },
  muted: { color: night.textTertiary },
  accent: { color: night.primary, flexShrink: 1 },
  note: { color: night.textTertiary, lineHeight: 20 },
});
