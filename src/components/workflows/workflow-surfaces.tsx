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
  steps: { flexDirection: 'row', gap: 10, paddingVertical: 10 },
  step: { flex: 1, alignItems: 'center', gap: 8 },
  stepNumber: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  stepLabel: { textAlign: 'center' },
});
