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
import { cardDiagnostics, noFormatsReason, parserCoverage, unreadFormats } from '@/lib/accuracy';
import { shareText } from '@/lib/share-text';
import { categoryLabel } from '@/lib/categories';
import { isRelayPlatform } from '@/lib/relay';
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

  // An empty list is a finding on Android with retention on, and no finding at
  // all on a phone that never keeps the message text. This screen used to show
  // the same green check for both — see noFormatsReason() in lib/accuracy.ts.
  const noFormats = noFormatsReason({
    relayPlatform: isRelayPlatform(),
    privateMode: state.privateMode,
  });

  // What the parser made of THIS ledger, measured on the phone. The list below
  // needs the source text to exist and so cannot speak at all on an iPhone or
  // in private mode; merchant and category ride along on every row, on every
  // platform, so this can. See parserCoverage() for the denominator.
  const coverage = useMemo(
    () => parserCoverage({
      transactions: state.transactions,
      merchantOverrides: state.merchantOverrides,
    }),
    [state.transactions, state.merchantOverrides],
  );
  const misses =
    coverage.measured - coverage.named + (coverage.categoryMeasured - coverage.categorised);

  // Only a format with no merchant leaves the phone from this screen. A named
  // private alias is useful for the local Sort-shops flow, not evidence for a
  // global grammar rule and not something the developer needs to receive.
  const shareUnread = () => {
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
        section(t('accuracyShareUnread'), unread),
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
          {/* Counts, never a percentage. "492 of 505" is something a person can
              check and act on; "97% accurate" is a claim they can only take or
              leave. Every figure names its own denominator, and the last line
              says out loud what was left out of it — a metric that reads
              correct behaviour as failure gets dismissed once and then never
              read again. */}
          <Section index={0} style={styles.coverage}>
            <ThemedText type="meta" themeColor="textTertiary" style={styles.coverageHeading}>
              {t('coverageHeading')}
            </ThemedText>
            {coverage.imported === 0 ? (
              <ThemedText type="default" themeColor="textSecondary">
                {t('coverageNothingYet')}
              </ThemedText>
            ) : (
              <>
                <ThemedText type="default">
                  {coverage.measured === 0
                    ? tf('coverageNoShops', {
                        imported: coverage.imported,
                        s: coverage.imported === 1 ? '' : 's',
                      })
                    : tf('coverageShops', {
                        imported: coverage.imported,
                        s: coverage.imported === 1 ? '' : 's',
                        measured: coverage.measured,
                        named: coverage.named,
                      })}
                </ThemedText>
                {coverage.categoryMeasured > 0 && (
                  <ThemedText type="default">
                    {tf('coverageCategories', {
                      categorised: coverage.categorised,
                      categoryMeasured: coverage.categoryMeasured,
                    })}
                  </ThemedText>
                )}
                {/* `measured === categoryMeasured + decided`. Without this the
                    two sentences above show 100 purchases and then 60, with
                    nothing on screen saying where the other 40 went. */}
                {coverage.decided > 0 && (
                  <ThemedText type="meta" themeColor="textTertiary">
                    {tf('coverageDecided', { decided: coverage.decided })}
                  </ThemedText>
                )}
                {/* Only where there is something for it to be "the other" than.
                    A ledger with no purchases in it has already been told, in
                    the line above, that all of it is transfers. */}
                {coverage.skipped > 0 && coverage.measured > 0 && (
                  <ThemedText type="meta" themeColor="textTertiary">
                    {tf('coverageSkipped', { skipped: coverage.skipped })}
                  </ThemedText>
                )}
                {/* The count of misses is honest on every phone. WHICH messages
                    they were is not: without the source text there is nothing
                    to list below and nothing to share. Saying so here stops the
                    figure from reading as a complete answer. */}
                {misses > 0 && noFormats !== 'none-found' && (
                  <ThemedText type="meta" themeColor="textTertiary">
                    {t('coverageNoText')}
                  </ThemedText>
                )}
              </>
            )}
          </Section>

          <Section index={1} style={styles.intro}>
            <ThemedText type="default" themeColor="textSecondary">
              {t(
                noFormats === 'relay'
                  ? 'formatsNotKeptRelay'
                  : noFormats === 'private'
                    ? 'formatsNotKeptPrivate'
                    : 'improveAccuracyHint',
              )}
            </ThemedText>
            {uncategorized.length > 0 && (
              <Button
                label={t('sortShops')}
                icon="filter"
                onPress={() => router.push('/categorise')}
              />
            )}
            {unread.length > 0 && (
              <Button
                label={`${t('shareUnrecognized')} · ${unread.length}`}
                icon="upload"
                variant="outline"
                onPress={shareUnread}
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

          {/* The green tick is a VERDICT — "the parser read everything you
              have" — and it can only be earned where the source text was kept
              to check against. Where it was not, the explanation above is the
              whole answer and this block would only contradict it. */}
          {rows.length === 0 && noFormats === 'none-found' && (
            <Section index={2} style={styles.empty}>
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
  coverage: {
    gap: Spacing.two,
    paddingBottom: Spacing.four,
  },
  coverageHeading: {
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingBottom: Spacing.two - 4,
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
