import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { formatAED } from '@/lib/format';
import { transferReviewCopy } from '@/lib/transfer-review-copy';

export interface TransferReviewNoticeProps {
  pendingCount: number;
  incomingFils: number;
  outgoingFils: number;
  onPress: () => void;
}

export function TransferReviewNotice({ pendingCount, incomingFils, outgoingFils, onPress }: TransferReviewNoticeProps) {
  const theme = useTheme();
  const words = transferReviewCopy(useLanguage());
  if (pendingCount <= 0) return null;
  const amounts = [
    incomingFils > 0 ? `${words.moneyIn}: ${formatAED(incomingFils, { decimals: true })}` : null,
    outgoingFils > 0 ? `${words.moneyOut}: ${formatAED(outgoingFils, { decimals: true })}` : null,
  ].filter(Boolean).join(' · ');
  return (
    <Pressable testID="transfer-review-notice" accessibilityRole="button"
      accessibilityLabel={[words.noticeTitle(pendingCount), amounts, words.noticeBody].filter(Boolean).join('. ')}
      onPress={onPress} style={[styles.notice, { borderColor: theme.cardBorder }]}>
      <View style={styles.heading}>
        <ThemedText type="smallBold" style={styles.text}>{words.noticeTitle(pendingCount)}</ThemedText>
        <Icon name="chevron-right" size={16} color={theme.textSecondary} />
      </View>
      {amounts ? <ThemedText type="small" tabular>{amounts}</ThemedText> : null}
      <ThemedText type="meta" themeColor="textSecondary">{words.noticeBody}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  notice: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: Spacing.three, gap: Spacing.one, minHeight: 48 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  text: { flex: 1, flexShrink: 1 },
});
