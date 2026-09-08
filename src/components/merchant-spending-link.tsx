import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { merchantSpendingCopy } from '@/lib/merchant-spending-copy';
import { merchantSpendingHref } from '@/lib/merchant-spending';
import type { Transaction } from '@/lib/types';

/** One labelled target, never a nested pressable inside a transaction row. */
export function MerchantSpendingLink({ merchant, type = 'expense', onClose }: {
  merchant?: string; type?: Transaction['type']; onClose?: () => void;
}) {
  const router = useRouter(); const theme = useTheme(); const language = useLanguage();
  const w = merchantSpendingCopy[language === 'ar' ? 'ar' : 'en'];
  const label = merchant ? (type === 'income' ? w.viewIncome : w.view) : w.browse;
  return <Pressable accessibilityRole="button" accessibilityLabel={merchant ? `${label}: ${merchant}` : label}
    testID={merchant ? 'view-merchant-spending' : 'browse-merchant-spending'}
    onPress={() => { onClose?.(); router.push(merchant ? merchantSpendingHref(merchant, type) : '/merchants'); }}
    style={({ pressed }) => [styles.row, { borderColor: theme.cardBorder, backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
    <View style={styles.words}><ThemedText type="smallBold" style={{ color: theme.primary }}>{label}</ThemedText>
      {!merchant && <ThemedText type="meta" themeColor="textSecondary">{w.browseHint}</ThemedText>}</View>
    <Icon name="arrow-up-right" size={18} color={theme.primary} />
  </Pressable>;
}

const styles = StyleSheet.create({
  row: { minHeight: 52, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 12 },
  words: { flex: 1, minWidth: 0, gap: 4 },
});
