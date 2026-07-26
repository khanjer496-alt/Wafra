import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { ScrollView, Share, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { Row, ScreenHeader, Section } from '@/components/ui/layout';
import { Money } from '@/components/ui/money';
import { MaxContentWidth, ScreenPadding, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { unreadFormats } from '@/lib/accuracy';
import { getCategory } from '@/lib/categories';
import { t } from '@/lib/i18n';
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
        <View style={styles.headerWrap}>
          <ScreenHeader title={t('improveAccuracy')} onBack={() => router.back()} />
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Section index={0} style={styles.intro}>
            <ThemedText type="default" themeColor="textSecondary">
              {t('improveAccuracyHint')}
            </ThemedText>
            {rows.length > 0 && (
              <Button
                label={`${t('shareUnrecognized')} · ${rows.length}`}
                icon="upload"
                onPress={shareAll}
              />
            )}
          </Section>

          {rows.map((r, i) => (
            <Row key={i} last={i === rows.length - 1} style={styles.formatRow}>
              <View style={styles.formatInner}>
                <View style={styles.formatTop}>
                  <ThemedText type="small" numberOfLines={1} style={styles.formatTitle}>
                    {r.title}
                  </ThemedText>
                  <Money fils={r.amountFils} prefix={false} />
                </View>
                <ThemedText type="meta" themeColor="textTertiary">
                  {t('readAs')} {r.category} · seen {r.count}×
                </ThemedText>
                <ThemedText type="meta" themeColor="textSecondary" style={styles.raw}>
                  {maskDigits(r.raw)}
                </ThemedText>
              </View>
            </Row>
          ))}

          {rows.length === 0 && (
            <Section index={1} style={styles.empty}>
              <Icon name="check" size={26} color={theme.income} strokeWidth={2.1} />
              <ThemedText type="small">{t('noUnrecognized')}</ThemedText>
              <ThemedText type="default" themeColor="textSecondary">
                {t('noUnrecognizedText')}
              </ThemedText>
            </Section>
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
  headerWrap: {
    paddingHorizontal: ScreenPadding,
  },
  content: {
    paddingHorizontal: ScreenPadding,
    paddingBottom: Spacing.six,
  },
  intro: {
    gap: Spacing.three - 2,
    paddingBottom: Spacing.four,
  },
  formatRow: {
    paddingVertical: Spacing.three - 2,
  },
  formatInner: {
    flex: 1,
    gap: Spacing.two - 2,
  },
  formatTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  formatTitle: {
    flexShrink: 1,
  },
  raw: {
    fontSize: 12.5,
    lineHeight: 18,
  },
  empty: {
    alignItems: 'flex-start',
    gap: Spacing.two,
    paddingVertical: Spacing.five,
  },
});
