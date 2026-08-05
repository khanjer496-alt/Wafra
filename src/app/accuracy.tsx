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
import { cardDiagnostics, unreadFormats } from '@/lib/accuracy';
import { shareText } from '@/lib/share-text';
import { categoryLabel } from '@/lib/categories';
import { useStore } from '@/lib/store';
import { t, tf } from '@/lib/i18n';

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
    () => unreadFormats(state.transactions, (id) => categoryLabel(id, state.language === 'ar' ? 'ar' : 'en')),
    [state.transactions, state.language],
  );

  const unread = useMemo(() => rows.filter((r) => r.reason === 'unread'), [rows]);
  const uncategorized = useMemo(() => rows.filter((r) => r.reason === 'uncategorized'), [rows]);

  // Two headings, not one. The old export called every row "could not read",
  // which was wrong about most of them — the merchant was read fine, it just
  // had no category — and that made a long list look like a broken parser.
  const shareAll = () => {
    const section = (label: string, list: typeof rows) =>
      list.length === 0
        ? ''
        : `\n\n${label} (${list.length}):\n\n` +
          list
            .map(
              (r, i) =>
                tf('accuracyShareRow', {
                  index: i + 1,
                  count: r.count,
                  title: r.title,
                  category: r.category,
                  raw: maskDigits(r.raw),
                }),
            )
            .join('\n\n');
    Share.share({
      message:
        t('accuracyShareTitle') +
        section(t('accuracyShareUnread'), unread) +
        section(t('accuracyShareUncategorized'), uncategorized),
    }).catch(() => {});
  };

  const shareCards = () => {
    // As a FILE. This one prints every card row with its raw bank message, and
    // pushing that through the share sheet as an intent payload crossed
    // Android's Binder limit and killed the app outright — see share-text.ts.
    shareText('wafra-card-diagnostic.txt', cardDiagnostics(state)).catch(() => {});
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
            {/* Always offered, even when nothing is unread: the card bugs this
                answers — a payment counted twice, a statement filed against the
                wrong account — happen to messages the parser read CONFIDENTLY,
                so they never appear in the list above. */}
            <Button
              label={t('shareCardDiagnostic')}
              icon="upload"
              variant="outline"
              onPress={shareCards}
            />
            <ThemedText type="meta" themeColor="textTertiary">
              {t('shareCardDiagnosticHint')}
            </ThemedText>
          </Section>

          {([
            [t('couldNotRead'), unread] as const,
            [t('noCategoryYet'), uncategorized] as const,
          ]).map(([heading, list]) =>
            list.length === 0 ? null : (
              <View key={heading}>
                <ThemedText type="meta" themeColor="textTertiary" style={styles.groupHeading}>
                  {heading} · {list.length}
                </ThemedText>
                {list.map((r, i) => (
                  <Row key={`${heading}-${i}`} last={i === list.length - 1} style={styles.formatRow}>
                    <View style={styles.formatInner}>
                      <View style={styles.formatTop}>
                        <ThemedText type="small" numberOfLines={1} style={styles.formatTitle}>
                          {r.title}
                        </ThemedText>
                        <Money fils={r.amountFils} prefix={false} />
                      </View>
                      <ThemedText type="meta" themeColor="textTertiary">
                        {t('readAs')} {r.category} · {tf('seenCount', { count: r.count })}
                      </ThemedText>
                      <ThemedText type="meta" themeColor="textSecondary" style={styles.raw}>
                        {maskDigits(r.raw)}
                      </ThemedText>
                    </View>
                  </Row>
                ))}
              </View>
            ),
          )}

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
  groupHeading: {
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.two - 2,
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
