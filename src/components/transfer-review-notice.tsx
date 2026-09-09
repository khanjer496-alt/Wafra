import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { transferReviewCopy } from '@/lib/transfer-review-copy';

export interface TransferReviewNoticeProps {
  pendingCount: number;
  incomingFils: number;
  outgoingFils: number;
  onPress: () => void;
}

export function TransferReviewNotice({ pendingCount, onPress }: TransferReviewNoticeProps) {
  const theme = useTheme();
  const words = transferReviewCopy(useLanguage());
  if (pendingCount <= 0) return null;
  return (
    <Pressable testID="transfer-review-notice" accessibilityRole="button"
      accessibilityLabel={[words.noticeTitle(pendingCount), words.noticeCount(pendingCount), words.noticeBody].join('. ')}
      onPress={onPress} style={[styles.notice, { borderColor: theme.cardBorder }]}>
      <View style={styles.heading}>
        <ThemedText type="smallBold" style={styles.text}>{words.noticeTitle(pendingCount)}</ThemedText>
        <Icon name="chevron-right" size={16} color={theme.textSecondary} />
      </View>
      <ThemedText type="meta" themeColor="textSecondary">{words.noticeCount(pendingCount)}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  notice: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: Spacing.three, gap: Spacing.one, minHeight: 48 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  text: { flex: 1, flexShrink: 1 },
});
