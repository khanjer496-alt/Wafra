import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing, type BandPalette } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import type { TransferAnswer } from '@/lib/transfer-answer';
import { transferActivityCopy } from '@/lib/transfer-activity-copy';

const ORDER: TransferAnswer[] = ['own', 'external', 'none'];

/** The one transfer question. Buttons on the question card, radio rows in the detail sheet. */
export function TransferAnswerChoices({ incoming, value, onChange, palette, layout, linkedLabel, disabled }: {
  incoming: boolean; value: TransferAnswer | null; onChange: (answer: TransferAnswer) => void;
  palette: BandPalette; layout: 'buttons' | 'radios'; linkedLabel?: string; disabled?: boolean;
}) {
  const words = transferActivityCopy(useLanguage()).answers;
  const large = useLargeTextLayout();
  const labels = incoming ? words.in : words.out;
  const effect = (answer: TransferAnswer) => answer === 'none' ? words.effect.none : words.effect[answer](incoming);
  if (layout === 'buttons') {
    return <View accessibilityRole="radiogroup" style={[styles.buttons, large && styles.stack]}>
      {ORDER.map((answer, i) => <Pressable key={answer} testID={`transfer-answer-${answer}`} disabled={disabled}
        accessibilityRole="radio" accessibilityState={{ checked: value === answer, disabled: !!disabled }}
        accessibilityLabel={`${labels[answer]}. ${effect(answer)}`}
        onPress={() => onChange(answer)}
        style={({ pressed }) => [styles.button, large && styles.buttonLarge,
          { backgroundColor: i === 0 ? palette.fill : palette.card, opacity: pressed || disabled ? 0.7 : 1 }]}>
        <ThemedText type="smallBold" style={{ color: i === 0 ? palette.onFill : palette.text, textAlign: 'center' }}>{labels[answer]}</ThemedText>
      </Pressable>)}
    </View>;
  }
  return <View accessibilityRole="radiogroup" style={styles.radios}>
    {ORDER.map(answer => {
      const on = value === answer;
      return <View key={answer}>
        <Pressable testID={`transfer-answer-${answer}`} disabled={disabled}
          accessibilityRole="radio" accessibilityState={{ checked: on, disabled: !!disabled }}
          accessibilityLabel={`${labels[answer]}. ${effect(answer)}`}
          onPress={() => onChange(answer)}
          style={({ pressed }) => [styles.radioRow, { backgroundColor: palette.card,
            borderColor: on ? palette.tint : palette.rule, opacity: pressed || disabled ? 0.75 : 1 }]}>
          <View style={[styles.radio, { borderColor: on ? palette.tint : palette.textSecondary }]}>
            {on ? <View style={[styles.radioDot, { backgroundColor: palette.tint }]} /> : null}
          </View>
          <View style={styles.radioText}>
            <ThemedText type="smallBold">{labels[answer]}</ThemedText>
            <ThemedText type="meta" themeColor="textSecondary">{effect(answer)}</ThemedText>
          </View>
        </Pressable>
        {answer === 'own' && on && linkedLabel
          ? <ThemedText type="meta" themeColor="textSecondary" style={styles.linked}>{linkedLabel}</ThemedText> : null}
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  buttons: { flexDirection: 'row', gap: Spacing.two },
  stack: { flexDirection: 'column' },
  button: { flex: 1, minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.two, paddingVertical: Spacing.two },
  buttonLarge: { flex: 0, alignSelf: 'stretch' },
  radios: { gap: Spacing.two },
  radioRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three, borderRadius: 14, borderWidth: 1.5 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  radioText: { flex: 1, minWidth: 0, gap: 2 },
  linked: { paddingStart: Spacing.three, paddingTop: Spacing.one },
});
