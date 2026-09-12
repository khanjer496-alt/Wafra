import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { useTheme } from '@/hooks/use-theme';
import { assistantCopy as copy } from '@/lib/assistant-copy';
import type { AssistantAnswer, AssistantFinding } from '@/lib/wafra-assistant';

/** Findings are descriptions of recorded activity, with explicit local proof. */
export function AssistantFindings({ findings, stale, onReview, onAsk }: {
  findings: AssistantFinding[];
  stale: boolean;
  onReview: (id: string) => void;
  onAsk: (finding: AssistantFinding) => void;
}) {
  const theme = useTheme();
  return <View style={styles.list}>
    {findings.slice(0, 3).map((finding) => <View key={finding.id} testID="assistant-finding"
      style={[styles.finding, { borderColor: theme.primaryBorder }]}>
      <ThemedText type="smallBold" selectable>{finding.title}</ThemedText>
      <ThemedText type="small" selectable>{finding.body}</ThemedText>
      {finding.evidence.length > 0 ? <Button label={copy.reviewFinding} variant="outline"
        disabled={stale} onPress={() => onReview(finding.id)} /> : null}
      {finding.question || finding.request ? <Button label={copy.exploreFinding} variant="ghost" disabled={stale}
        onPress={() => onAsk(finding)} /> : null}
    </View>)}
  </View>;
}

export function AssistantCoverage({ coverage }: { coverage: NonNullable<AssistantAnswer['coverage']> }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  return <View testID="assistant-coverage" style={[styles.coverage, { borderTopColor: theme.primaryBorder }]}>
    <Pressable accessibilityRole="button" accessibilityLabel={copy.dataUsed}
      accessibilityState={{ expanded }} onPress={() => setExpanded((value) => !value)} style={styles.coverageToggle}>
      <View style={styles.grow}>
        <ThemedText type="smallBold">{copy.dataUsed}</ThemedText>
        <ThemedText type="meta" themeColor="textSecondary">{copy.coverageCount(coverage.recordCount, coverage.accountCount, coverage.totalAccounts)}</ThemedText>
      </View>
      <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={16} color={theme.textSecondary} />
    </Pressable>
    {expanded ? <View style={styles.notes}>
      {coverage.firstDate && coverage.lastDate ? <ThemedText type="meta" themeColor="textSecondary" selectable>
        {copy.observedDates(coverage.firstDate, coverage.lastDate)}
      </ThemedText> : null}
      {coverage.notes.map((note, index) => <ThemedText key={index} type="meta" themeColor="textSecondary" selectable>{note}</ThemedText>)}
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  finding: { gap: 8, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12 },
  coverage: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 4 },
  coverageToggle: { minHeight: 48, flexDirection: 'row', gap: 8, alignItems: 'center' },
  grow: { flex: 1, minWidth: 0, gap: 3 },
  notes: { gap: 6, paddingTop: 4 },
});
