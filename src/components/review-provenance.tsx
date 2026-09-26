import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/lib/i18n';
import type { UniversalReviewAlert } from '@/lib/alert-review-tray';

/**
 * Who proposed a Review item's fields: one of the person's learned bank
 * formats ("Recognised format — confirm") or an on-device model ("Suggested
 * by on-device AI"). A label only — every field is still the person's to
 * check and edit, and nothing is added until they confirm.
 */
export function ReviewProvenance({ suggestedBy, detailed = false }: {
  suggestedBy: UniversalReviewAlert['suggestedBy'];
  /** The add screen also explains what the label means. */
  detailed?: boolean;
}) {
  const theme = useTheme();
  if (suggestedBy !== 'learned' && suggestedBy !== 'ai') return null;
  const learned = suggestedBy === 'learned';
  const label = t(learned ? 'reviewRecognisedFormat' : 'reviewSuggestedByAi');
  const hint = t(learned ? 'reviewRecognisedFormatHint' : 'reviewSuggestedByAiHint');
  return (
    <View testID={learned ? 'review-recognised-format' : 'review-suggested-by-ai'}
      accessible accessibilityLabel={detailed ? `${label}. ${hint}` : label} style={styles.wrap}>
      <View style={styles.row}>
        <Icon name={learned ? 'check' : 'spark'} size={14} color={theme.primary} />
        <ThemedText type="smallBold" style={{ color: theme.primary, flexShrink: 1 }}>{label}</ThemedText>
      </View>
      {detailed ? <ThemedText type="meta" themeColor="textSecondary">{hint}</ThemedText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.half },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
});
