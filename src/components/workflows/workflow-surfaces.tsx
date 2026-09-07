import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon, type IconName } from '@/components/ui/icon';
import { WafraMark } from '@/components/wafra-logo';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { tapped } from '@/lib/haptics';
import { workflowCopy } from './workflow-copy';

/** Open ledger section. Owners supply real labels/counts; no decorative panel. */
export function WorkflowHero({ title, body, icon = 'lock', facts = [], children, style }: {
  title: string; body: string; icon?: IconName;
  facts?: readonly { label: string; value: string }[];
  children?: React.ReactNode; style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return <View style={[styles.hero, { borderColor: theme.cardBorder }, style]}>
    <View style={styles.heroHeading}>
      <View style={styles.heroIcon}><Icon name={icon} size={22} color={theme.primary} /></View>
      <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <WafraMark size={34} color={theme.textSecondary} />
      </View>
    </View>
    <ThemedText type="heading" accessibilityRole="header" style={[styles.heroTitle, { color: theme.text }]}>{title}</ThemedText>
    <ThemedText type="small" style={[styles.heroBody, { color: theme.textSecondary }]}>{body}</ThemedText>
    {facts.length > 0 && <View style={[styles.facts, { borderTopColor: theme.cardBorder }]}>{facts.map(fact => <View key={fact.label} style={styles.fact}>
      <ThemedText type="title" tabular style={[styles.factValue, { color: theme.text }]}>{fact.value}</ThemedText>
      <ThemedText type="meta" style={[styles.heroBody, { color: theme.textSecondary }]}>{fact.label}</ThemedText>
    </View>)}</View>}
    {children}
  </View>;
}

/** A navigation grid rather than four labels squeezed into a narrow pill. */
export function WorkflowNavigation<T extends string>({ value, items, label, onChange }: {
  value: T; items: readonly { value: T; label: string; icon: IconName }[];
  label: string; onChange: (value: T) => void;
}) {
  const theme = useTheme();
  return <View accessibilityLabel={label} style={styles.navigation}>
    {items.map(item => {
      const selected = value === item.value;
      return <Pressable key={item.value} accessibilityRole="button"
        accessibilityLabel={item.label} accessibilityState={{ selected }}
        onPress={() => { if (!selected) { tapped(); onChange(item.value); } }}
        style={({ pressed }) => [styles.navigationItem, {
          backgroundColor: selected ? theme.primarySoft : 'transparent',
          borderColor: selected ? theme.primary : theme.cardBorder,
          opacity: pressed ? 0.78 : 1,
        }]}>
        <Icon name={item.icon} size={19} color={selected ? theme.primary : theme.textSecondary} />
        <ThemedText type={selected ? 'smallBold' : 'small'} style={styles.navLabel}
          themeColor={selected ? 'primary' : 'textSecondary'}>{item.label}</ThemedText>
      </Pressable>;
    })}
  </View>;
}

/** Progress is a state description, never an invented import percentage. */
export function ImportSteps({ current }: { current: 'source' | 'review' | 'save' }) {
  const theme = useTheme(); const words = workflowCopy(useLanguage());
  const steps = ['source', 'review', 'save'] as const;
  const at = steps.indexOf(current);
  return <View accessibilityLabel={words.importSteps} style={styles.steps}>
    {steps.map((step, index) => <View key={step} style={styles.step}
      accessible accessibilityLabel={`${words[step]}${index === at ? `. ${words.stepCurrent}` : index < at ? `. ${words.stepComplete}` : ''}`}>
      <View style={[styles.stepNumber, { backgroundColor: index <= at ? theme.primary : theme.backgroundSelected }]}>
        {index < at ? <Icon name="check" size={16} color={theme.onPrimary} />
          : <ThemedText type="smallBold" style={{ color: index === at ? theme.onPrimary : theme.textSecondary }}>{index + 1}</ThemedText>}
      </View>
      <ThemedText type="meta" themeColor={index === at ? 'text' : 'textSecondary'} style={styles.stepLabel}>{words[step]}</ThemedText>
    </View>)}
  </View>;
}

/** Original monogram. No mock cards, balances, leaves or implied bank connection. */
export function SetupIllustration() {
  return <View testID="setup-illustration" style={styles.illustration} accessible={false}
    accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <WafraMark size={72} />
  </View>;
}

const styles = StyleSheet.create({
  hero: { paddingVertical: 20, gap: 10, borderBottomWidth: 1 },
  heroHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  heroIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { fontSize: 23, lineHeight: 30 },
  heroBody: {},
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 20, marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 16 },
  fact: { flexGrow: 1, minWidth: 90, gap: 2 }, factValue: {},
  navigation: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  navigationItem: { flexBasis: '45%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, minHeight: 56, borderRadius: 10, borderWidth: 1 },
  navLabel: { flex: 1, flexShrink: 1 },
  steps: { flexDirection: 'row', gap: 10, paddingVertical: 10 },
  step: { flex: 1, alignItems: 'center', gap: 8 },
  stepNumber: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  stepLabel: { textAlign: 'center' },
  illustration: { height: 144, alignItems: 'center', justifyContent: 'center' },
});
