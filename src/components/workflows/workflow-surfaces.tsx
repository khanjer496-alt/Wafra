import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { ThemedText } from '@/components/themed-text';
import { Icon, type IconName } from '@/components/ui/icon';
import { WafraMark } from '@/components/wafra-logo';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { tapped } from '@/lib/haptics';
import { workflowCopy } from './workflow-copy';

/** The reference's forest surface, with real labels/counts supplied by its owner. */
export function WorkflowHero({ title, body, icon = 'lock', facts = [], children, style }: {
  title: string; body: string; icon?: IconName;
  facts?: readonly { label: string; value: string }[];
  children?: React.ReactNode; style?: StyleProp<ViewStyle>;
}) {
  return <LinearGradient colors={['#164A3D', '#052D26']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
    style={[styles.hero, style]}>
    <View style={styles.heroHeading}>
      <View style={styles.heroIcon}><Icon name={icon} size={22} color="#D8F0DF" /></View>
      <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <WafraMark size={34} color="#6EAA8F" />
      </View>
    </View>
    <ThemedText type="heading" accessibilityRole="header" style={styles.heroTitle}>{title}</ThemedText>
    <ThemedText type="small" style={styles.heroBody}>{body}</ThemedText>
    {facts.length > 0 && <View style={styles.facts}>{facts.map(fact => <View key={fact.label} style={styles.fact}>
      <ThemedText type="title" tabular style={styles.factValue}>{fact.value}</ThemedText>
      <ThemedText type="meta" style={styles.heroBody}>{fact.label}</ThemedText>
    </View>)}</View>}
    {children}
  </LinearGradient>;
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
          backgroundColor: selected ? theme.primarySoft : theme.card,
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

/** Decorative account shapes, not sample balances or a claimed bank connection. */
export function SetupIllustration() {
  return <View testID="setup-illustration" style={styles.illustration} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <View style={styles.halo}><WafraMark size={116} color="#326352" /></View>
    <View style={[styles.paperCard, styles.backCard]}><View style={styles.illustrationLine} /><View style={[styles.illustrationLine, { width: 60 }]} /></View>
    <View style={[styles.paperCard, styles.frontCard]}>
      <View style={styles.illustrationCardTop}><Icon name="wallet" size={25} color="#A0D9BA" /><Icon name="check" size={17} color="#D2EDDE" /></View>
      <View style={[styles.illustrationLine, { width: 94 }]} /><View style={[styles.illustrationLine, { width: 55 }]} />
    </View>
    <View style={styles.illustrationLock}><Icon name="lock" size={21} color="#C6E9D3" /></View>
  </View>;
}

const styles = StyleSheet.create({
  hero: { borderRadius: 22, padding: 22, gap: 10, overflow: 'hidden' },
  heroHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  heroIcon: { width: 44, height: 44, borderRadius: 15, backgroundColor: '#2B594A', alignItems: 'center', justifyContent: 'center' },
  heroTitle: { color: '#F6FBF7', fontSize: 23, lineHeight: 30 },
  heroBody: { color: '#C5DED2' },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 20, marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#477061', paddingTop: 16 },
  fact: { flexGrow: 1, minWidth: 90, gap: 2 }, factValue: { color: '#F6FBF7' },
  navigation: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  navigationItem: { flexBasis: '45%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, minHeight: 56, borderRadius: 16, borderWidth: 1 },
  navLabel: { flex: 1, flexShrink: 1 },
  steps: { flexDirection: 'row', gap: 10, paddingVertical: 10 },
  step: { flex: 1, alignItems: 'center', gap: 8 },
  stepNumber: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  stepLabel: { textAlign: 'center' },
  illustration: { height: 210, width: '100%', maxWidth: 320, alignSelf: 'center', justifyContent: 'center', alignItems: 'center' },
  halo: { position: 'absolute', width: 190, height: 190, borderRadius: 95, backgroundColor: '#123D32', alignItems: 'center', justifyContent: 'center' },
  paperCard: { width: 172, height: 108, borderRadius: 20, borderWidth: 1, borderColor: '#648A75', padding: 18, gap: 10, position: 'absolute' },
  backCard: { backgroundColor: '#496B58', transform: [{ rotate: '-12deg' }, { translateX: 14 }, { translateY: -28 }] },
  frontCard: { backgroundColor: '#1D4C3D', transform: [{ rotate: '8deg' }, { translateY: 28 }] },
  illustrationCardTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  illustrationLine: { height: 5, width: 100, borderRadius: 5, backgroundColor: '#719782' },
  illustrationLock: { position: 'absolute', bottom: 24, start: 38, width: 46, height: 46, borderRadius: 15, borderWidth: 1, borderColor: '#5F8A74', backgroundColor: '#224F3F', alignItems: 'center', justifyContent: 'center' },
});
