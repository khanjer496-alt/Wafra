import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Icon } from '@/components/ui/icon';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { unreadFormats } from '@/lib/accuracy';
import { formatAED } from '@/lib/format';
import { t } from '@/lib/i18n';
import { getCategory } from '@/lib/categories';
import { useStore } from '@/lib/store';

/** Long digit runs could be account numbers — keep only the last 4. */
function maskDigits(s: string): string {
  return s.replace(/\d{5,}/g, (m) => `····${m.slice(-4)}`);
}

/**
 * Rows the parser wasn't confident about, with their raw SMS text. Sharing
 * the list is how new bank formats get fixed: every message here is one the
 * grammar couldn't fully read.
 */
export default function AccuracyScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { state } = useStore();

  const rows = useMemo(
    () => unreadFormats(state.transactions, (id) => getCategory(id).label),
    [state.transactions],
  );

  const shareAll = () => {
    const body = rows
      .map((r, i) => `#${i + 1} (seen ${r.count}x, read as "${r.title}" / ${r.category}):\n${maskDigits(r.raw)}`)
      .join('\n\n');
    Share.share({
      message: `Wafra — bank SMS formats the parser could not fully read:\n\n${body}`,
    }).catch(() => {});
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            style={[styles.backBtn, { backgroundColor: theme.backgroundSelected }]}>
            <Icon name="chevron-left" size={18} color={theme.text} />
          </Pressable>
          <ThemedText type="heading">{t('improveAccuracy')}</ThemedText>
          <View style={styles.backBtn} />
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ThemedText type="small" themeColor="textSecondary">
            {t('improveAccuracyHint')}
          </ThemedText>

          {rows.length > 0 && (
            <Pressable onPress={shareAll} style={[styles.shareBtn, { backgroundColor: theme.primary }]}>
              <Icon name="upload" size={16} color={theme.onPrimary} />
              <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>
                {t('shareUnrecognized')} ({rows.length})
              </ThemedText>
            </Pressable>
          )}

          {rows.map((r, i) => (
            <View
              key={i}
              style={[styles.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
              <View style={styles.cardTop}>
                <ThemedText type="smallBold" numberOfLines={1} style={styles.cardTitle}>
                  {r.title}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" tabular>
                  {r.count}x · {formatAED(r.amountFils, { decimals: false })}
                </ThemedText>
              </View>
              <ThemedText type="micro" themeColor="textSecondary">
                {t('readAs')} {r.category}
              </ThemedText>
              <ThemedText type="small" style={styles.rawText}>
                {maskDigits(r.raw)}
              </ThemedText>
            </View>
          ))}

          {rows.length === 0 && (
            <View style={styles.empty}>
              <View style={[styles.emptyIcon, { backgroundColor: theme.backgroundSelected }]}>
                <Icon name="check" size={26} color={theme.income} strokeWidth={2} />
              </View>
              <ThemedText type="smallBold">{t('noUnrecognized')}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
                {t('noUnrecognizedText')}
              </ThemedText>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
  },
  safe: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: Spacing.three,
    paddingBottom: Spacing.six,
    gap: Spacing.three,
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderRadius: Radius.md,
    paddingVertical: Spacing.three,
  },
  card: {
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  cardTitle: {
    flexShrink: 1,
  },
  rawText: {
    opacity: 0.85,
  },
  empty: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.six,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    textAlign: 'center',
    maxWidth: 300,
  },
});
