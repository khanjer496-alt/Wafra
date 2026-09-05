import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { t } from '@/lib/i18n';
import { tapped } from '@/lib/haptics';

const night = Colors.dark;

/** An explicit sandbox demonstration: never calls a store/import command. */
export function MoneyPreview({ reducedMotion }: { reducedMotion: boolean }) {
  const language = useLanguage();
  const [revealed, setRevealed] = useState(false);
  return (
    <View style={styles.preview}>
      <View style={styles.heading}>
        <ThemedText type="micro" style={styles.muted}>{t('onboardSampleLabel', language)}</ThemedText>
        <View style={styles.stepDots} accessible={false}>
          <View style={[styles.dot, !revealed && styles.activeDot]} />
          <View style={[styles.dot, revealed && styles.activeDot]} />
        </View>
      </View>
      <View style={styles.message}>
        <Icon name="mail" color={night.textTertiary} size={19} />
        <ThemedText style={styles.messageText}>{t('onboardSampleMessage', language)}</ThemedText>
      </View>
      {revealed && (
        <Animated.View entering={reducedMotion ? undefined : FadeInDown.duration(260)}
          style={styles.entry} accessibilityLiveRegion="polite">
          <View style={styles.entryTop}>
            <View style={styles.entryIcon}><Icon name="dining" size={20} color={night.primary} /></View>
            <View style={styles.entryCopy}>
              <ThemedText type="smallBold" style={styles.ink}>{t('onboardSampleMerchant', language)}</ThemedText>
              <ThemedText type="meta" style={styles.muted}>{t('onboardSampleCategory', language)}</ThemedText>
            </View>
            <Icon name="check" size={19} color={night.primary} />
          </View>
          <ThemedText tabular style={styles.amount}>AED 24.50</ThemedText>
        </Animated.View>
      )}
      <Pressable accessibilityRole="button"
        accessibilityLabel={t(revealed ? 'onboardSampleReset' : 'onboardSampleAction', language)}
        accessibilityState={{ expanded: revealed }}
        onPress={() => { tapped(); setRevealed((value) => !value); }}
        style={({ pressed }) => [styles.action, { opacity: pressed ? 0.65 : 1 }]}>
        <ThemedText type="smallBold" style={styles.accent}>
          {t(revealed ? 'onboardSampleReset' : 'onboardSampleAction', language)}
        </ThemedText>
        <Icon name={revealed ? 'repeat' : 'arrow-down'} size={16} color={night.primary} />
      </Pressable>
      <ThemedText type="meta" style={styles.note}>{t('onboardSampleNote', language)}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  preview: { gap: Spacing.three, paddingVertical: Spacing.three, borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: night.cardBorderStrong },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepDots: { flexDirection: 'row', gap: Spacing.one },
  dot: { width: 6, height: 6, borderRadius: Radius.full, backgroundColor: night.cardBorderStrong },
  activeDot: { backgroundColor: night.primary },
  message: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  messageText: { color: night.textSecondary, flex: 1, fontSize: 15, lineHeight: 23 },
  entry: { backgroundColor: night.backgroundElement, borderRadius: Radius.sheet, padding: Spacing.three, gap: Spacing.three },
  entryTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  entryIcon: { width: 40, height: 40, borderRadius: Radius.tile, backgroundColor: night.primarySoft,
    alignItems: 'center', justifyContent: 'center' },
  entryCopy: { flex: 1, gap: Spacing.one },
  amount: { color: night.text, fontFamily: Fonts.monoSemi, fontSize: 29, lineHeight: 38 },
  action: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: night.cardBorder },
  ink: { color: night.text },
  muted: { color: night.textTertiary },
  accent: { color: night.primary, flexShrink: 1 },
  note: { color: night.textTertiary, lineHeight: 18 },
});
