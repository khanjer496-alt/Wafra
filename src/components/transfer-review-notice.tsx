import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { homeSummaryCopy } from '@/lib/reference-copy';
import { transferReviewCopy } from '@/lib/transfer-review-copy';

export interface TransferReviewNoticeProps {
  /** Rows in the transfer review queue (reconcileTransfers().pendingIds). */
  pendingCount: number;
  incomingFils: number;
  outgoingFils: number;
  onPress: () => void;
}

/**
 * "2 transfers to confirm" on Home: a compact disclosure, not a monetary
 * backlog. It opens the existing transfer review and never classifies
 * anything itself; until the person confirms, those rows count as neither
 * spending nor income, which the second line says.
 */
export function TransferReviewNotice({ pendingCount, onPress }: TransferReviewNoticeProps) {
  const theme = useTheme();
  const language = useLanguage();
  const words = homeSummaryCopy[language === 'ar' ? 'ar' : 'en'];
  const review = transferReviewCopy(language);
  if (pendingCount <= 0) return null;
  return (
    <Pressable testID="transfer-review-notice" accessibilityRole="button"
      accessibilityLabel={[words.transfersToConfirm(pendingCount), review.noticeBody].join('. ')}
      onPress={onPress}
      style={({ pressed }) => [styles.notice, { borderColor: theme.cardBorder, backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
      <Icon name="repeat" size={18} color={theme.primary} />
      <View style={styles.text}>
        <ThemedText type="smallBold">{words.transfersToConfirm(pendingCount)}</ThemedText>
        <ThemedText type="meta" themeColor="textSecondary">{words.transfersNotCounted}</ThemedText>
      </View>
      <Icon name="chevron-right" size={16} color={theme.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  notice: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2, borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: Spacing.two + 2, minHeight: 56 },
  text: { flex: 1, minWidth: 0, gap: 2 },
});
