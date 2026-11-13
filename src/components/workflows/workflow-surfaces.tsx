import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { workflowCopy } from './workflow-copy';

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

const styles = StyleSheet.create({
  hero: { paddingVertical: 12, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  heroHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heroIcon: { width: 28, minHeight: 32, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { flex: 1, minWidth: 0, fontSize: 20, lineHeight: 30 },
  heroBody: {},
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 20, marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 16 },
  fact: { flexGrow: 1, minWidth: 90, gap: 2 }, factValue: {},
  navigation: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  navigationItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 8, minHeight: 48, maxWidth: '100%', borderRadius: 4, borderBottomWidth: 2 },
  navLabel: { flexShrink: 1 },
  steps: { flexDirection: 'row', gap: 10, paddingVertical: 10 },
  step: { flex: 1, alignItems: 'center', gap: 8 },
  stepNumber: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  stepLabel: { textAlign: 'center' },
  illustration: { height: 144, alignItems: 'center', justifyContent: 'center' },
});
