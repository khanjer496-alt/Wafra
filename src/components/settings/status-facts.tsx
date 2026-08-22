import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Block } from '@/components/ui/layout';
import { Colors, Spacing } from '@/constants/theme';

export type StatusFact = { key: string; label: string; value: string; active: boolean };

type StatusFactsProps = {
  facts: readonly StatusFact[];
  largeText: boolean;
  theme: (typeof Colors)[keyof typeof Colors];
};

export function StatusFacts({ facts, largeText, theme }: StatusFactsProps) {
  return (
    <Block style={[styles.grid, largeText && styles.gridLarge]}>
      {facts.map((fact) => (
        <View
          key={fact.key}
          accessible
          accessibilityLabel={`${fact.label}: ${fact.value}`}
          style={[styles.fact, largeText && styles.factLarge, { backgroundColor: theme.backgroundSelected }]}>
          <ThemedText type="meta" themeColor="textSecondary" numberOfLines={2}>
            {fact.label}
          </ThemedText>
          <View style={[styles.pill, { backgroundColor: fact.active ? theme.primarySoft : theme.backgroundElement }]}>
            <View style={[styles.dot, { backgroundColor: fact.active ? theme.primary : theme.textTertiary }]} />
            <ThemedText type="micro" style={{ color: fact.active ? theme.primary : theme.textSecondary }}>
              {fact.value}
            </ThemedText>
          </View>
        </View>
      ))}
    </Block>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  gridLarge: { flexDirection: 'column', flexWrap: 'nowrap' },
  fact: { flexBasis: 92, flexGrow: 1, minHeight: 82, justifyContent: 'space-between', gap: Spacing.two, borderRadius: 12, padding: Spacing.two },
  factLarge: { flexBasis: 'auto', minHeight: 0, width: '100%' },
  pill: { minHeight: 26, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: Spacing.one, borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
