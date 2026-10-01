import { useCategoryCatalog } from '@/hooks/use-category-catalog';
import { useRouter } from '@/hooks/use-app-router';
import React, { useMemo, useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';

import { BandCount } from '@/components/capture/band-count';
import { SheetSectionTitle } from '@/components/capture/sheet-link-row';
import { EntryDetailSheet } from '@/components/entry-detail-sheet';
import { BandTitle } from '@/components/settings-band/band-title';
import { ThemedText } from '@/components/themed-text';
import { BandScaffold, type BandNav } from '@/components/ui/band-scaffold';
import { EButton } from '@/components/ui/band/e-button';
import { StatTile, statTileColors } from '@/components/ui/band/stat-tile';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { Spacing } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { cardDiagnostics, formatKey, newestRowOfFormat, noFormatsReason, parserCoverage, unreadFormats } from '@/lib/accuracy';
import { accuracyBandCopy } from '@/lib/accuracy-band-copy';
import { isCaptureAvailable } from '@/lib/capture';
import { shareText } from '@/lib/share-text';

import { detailsWords } from '@/lib/details-copy';
import { isRelayPlatform } from '@/lib/relay';
import { useStore } from '@/lib/store';
import { t, tf } from '@/lib/i18n';
import type { Transaction } from '@/lib/types';

/** Long digit runs could be account numbers — keep only the last 4. */
function maskDigits(s: string): string {
  return s.replace(/\d{5,}/g, (m) => `····${m.slice(-4)}`);
}

/**
 * Rows the parser wasn't confident about, with their raw SMS text. Sharing
 * the list is how new bank formats get fixed: every message here is one the
 * grammar couldn't fully read.
 */
/**
 * Rows mounted per group before "Show more". Each row carries the masked raw
 * message, so a new market's first import (hundreds of unread formats) would
 * otherwise lay out every one of them inside the scroll view at once.
 */
const FORMAT_PAGE = 30;

export default function AccuracyScreen() {
  const { categoryLabel } = useCategoryCatalog();
  const band = useBand('settings');
  const router = useRouter();
  const { state } = useStore();
  const [groupLimits, setGroupLimits] = useState<Record<string, number>>({});
  const [entry, setEntry] = useState<Transaction | null>(null);
  const d = detailsWords(state.language);

  const rows = useMemo(
    () => unreadFormats(state.transactions, (id) => categoryLabel(id, state.language === 'ar' ? 'ar' : 'en')),
    [state.transactions, state.language, categoryLabel],
  );

  // The newest recorded row of each listed format. These rows are already in
  // the ledger, so the fix is to open that entry — never to add it again.
  // Same rows and format key as unreadFormats().
  const newestOfFormat = useMemo(() => newestRowOfFormat(state.transactions), [state.transactions]);

  const unread = useMemo(() => rows.filter((r) => r.reason === 'unread'), [rows]);
  const uncategorized = useMemo(() => rows.filter((r) => r.reason === 'uncategorized'), [rows]);

  // An empty list is a finding on Android with retention on, and no finding at
  // all on a phone that never keeps the message text. This screen used to show
  // the same green check for both — see noFormatsReason() in lib/accuracy.ts.
  const noFormats = noFormatsReason({
    relayPlatform: isRelayPlatform(),
    localCaptureAvailable: isCaptureAvailable(),
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

  const accuracyNav: BandNav = { back: true };
  const words = accuracyBandCopy(state.language);
  const largeText = useLargeTextLayout();
  const tile = statTileColors(band, 'band');
  // The title's count is the list below; where the text was never kept there
  // is no list, and a zero would read as "nothing to check".
  const countLine = noFormats === 'none-found' || rows.length > 0 ? words.toCheck(rows.length) : null;
  // Counts, never a percentage: each tile names its own denominator.
  const tiles = coverage.imported === 0 ? [] : [
    { id: 'read', label: words.messagesRead, count: coverage.imported, total: null },
    ...(coverage.measured > 0 ? [{ id: 'named', label: words.shopsNamed, count: coverage.named, total: coverage.measured }] : []),
    ...(coverage.categoryMeasured > 0
      ? [{ id: 'categorised', label: words.categorised, count: coverage.categorised, total: coverage.categoryMeasured }] : []),
  ];
  const muted = { color: band.textSecondary };

  return (
    <>
      <BandScaffold
        band="settings"
        testID="accuracy-screen"
        nav={accuracyNav}
        scrollProps={{ showsVerticalScrollIndicator: false }}
        bandContent={<View style={styles.bandBlock}>
          <BandTitle testID="accuracy-title" title={t('improveAccuracy')} body={countLine} palette={band} />
          {tiles.length > 0 ? (
            <View testID="accuracy-coverage-tiles" style={[styles.tiles, largeText && styles.tilesStacked]}>
              {tiles.map((item) => (
                <StatTile key={item.id} testID={`accuracy-tile-${item.id}`} palette={band} label={item.label}
                  meta={item.total === null ? undefined : words.of(item.total)} style={styles.tile}
                  accessibilityLabel={words.tileSpoken(item.label, item.count, item.total)}>
                  <BandCount value={item.count.toLocaleString('en-US')} color={tile.fg} />
                </StatTile>
              ))}
            </View>
          ) : null}
        </View>}>
          {/* Counts, never a percentage. "492 of 505" is something a person can
              check and act on; "97% accurate" is a claim they can only take or
              leave. Every figure names its own denominator, and the last line
              says out loud what was left out of it — a metric that reads
              correct behaviour as failure gets dismissed once and then never
              read again. */}
          <View testID="accuracy-coverage" style={styles.section}>
            <SheetSectionTitle title={t('coverageHeading')} palette={band} />
            {coverage.imported === 0 ? (
              <ThemedText type="default" style={muted}>
                {t('coverageNothingYet')}
              </ThemedText>
            ) : (
              <>
                <ThemedText type="default" style={{ color: band.text }}>
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
                  <ThemedText type="default" style={{ color: band.text }}>
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
                  <ThemedText type="meta" style={muted}>
                    {tf('coverageDecided', { decided: coverage.decided })}
                  </ThemedText>
                )}
                {/* Only where there is something for it to be "the other" than.
                    A ledger with no purchases in it has already been told, in
                    the line above, that all of it is transfers. */}
                {coverage.skipped > 0 && coverage.measured > 0 && (
                  <ThemedText type="meta" style={muted}>
                    {tf('coverageSkipped', { skipped: coverage.skipped })}
                  </ThemedText>
                )}
                {/* The count of misses is honest on every phone. WHICH messages
                    they were is not: without the source text there is nothing
                    to list below and nothing to share. Saying so here stops the
                    figure from reading as a complete answer. */}
                {misses > 0 && noFormats !== 'none-found' && (
                  <ThemedText type="meta" style={muted}>
                    {t('coverageNoText')}
                  </ThemedText>
                )}
              </>
            )}
          </View>

          <View testID="accuracy-actions" style={styles.section}>
            <ThemedText type="default" style={muted}>
              {t(
                noFormats === 'relay'
                  ? 'formatsNotKeptRelay'
                  : noFormats === 'ios-local'
                    ? 'formatsNotKeptIosLocal'
                  : noFormats === 'private'
                    ? 'formatsNotKeptPrivate'
                    : 'improveAccuracyHint',
              )}
            </ThemedText>
            {uncategorized.length > 0 && (
              <EButton
                testID="accuracy-sort-shops"
                palette={band}
                label={t('sortShops')}
                icon="filter"
                onPress={() => router.push('/categorise')}
              />
            )}
            {unread.length > 0 && (
              <EButton
                testID="accuracy-share-unread"
                palette={band}
                variant="secondary"
                label={`${t('shareUnrecognized')} · ${unread.length}`}
                icon="upload"
                onPress={shareUnread}
              />
            )}
            {/* Always offered, even when nothing is unread: the card bugs this
                answers — a payment counted twice, a statement filed against the
                wrong account — happen to messages the parser read CONFIDENTLY,
                so they never appear in the list above. */}
            <EButton
              testID="accuracy-share-cards"
              palette={band}
              variant="secondary"
              label={t('shareCardDiagnostic')}
              icon="upload"
              onPress={shareCards}
            />
            <ThemedText type="meta" style={muted}>
              {t('shareCardDiagnosticHint')}
            </ThemedText>
          </View>

          {([
            [t('couldNotRead'), unread] as const,
            [t('noCategoryYet'), uncategorized] as const,
          ]).map(([heading, list]) =>
            list.length === 0 ? null : (() => {
              const limit = groupLimits[heading] ?? FORMAT_PAGE;
              const shown = list.slice(0, limit);
              const hidden = list.length - shown.length;
              return (
              <View key={heading} style={styles.section}>
                <SheetSectionTitle title={`${heading} · ${list.length}`} palette={band} />
                {shown.map((r, i) => (
                  <View key={`${heading}-${i}`} style={[styles.formatRow,
                    i < shown.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: band.rule }]}>
                    <View style={styles.formatTop}>
                      <ThemedText type="smallBold" numberOfLines={1} style={[styles.formatTitle, { color: band.text }]}>
                        {r.title}
                      </ThemedText>
                      <Money fils={r.amountFils} prefix={false} color={band.text} />
                    </View>
                    <ThemedText type="meta" style={muted}>
                      {t('readAs')} {r.category} · {tf('seenCount', { count: r.count })}
                    </ThemedText>
                    <ThemedText type="meta" style={[styles.raw, muted]}>
                      {maskDigits(r.raw)}
                    </ThemedText>
                    {newestOfFormat.has(formatKey(r.raw)) ? (
                      <View testID="accuracy-open-entry" style={styles.openEntry}>
                        <EButton palette={band} variant="secondary" label={d.accuracy.openEntry} icon="arrow-up-right"
                          onPress={() => setEntry(newestOfFormat.get(formatKey(r.raw)) ?? null)} />
                        <ThemedText type="meta" style={muted}>{d.accuracy.openEntryHint}</ThemedText>
                      </View>
                    ) : null}
                  </View>
                ))}
                {hidden > 0 && (
                  <EButton
                    palette={band}
                    variant="quiet"
                    label={tf('showMoreRows', { count: Math.min(FORMAT_PAGE, hidden) })}
                    onPress={() => setGroupLimits((current) => ({ ...current, [heading]: limit + FORMAT_PAGE }))}
                  />
                )}
              </View>
              );
            })(),
          )}

          {/* The green tick is a VERDICT — "the parser read everything you
              have" — and it can only be earned where the source text was kept
              to check against. Where it was not, the explanation above is the
              whole answer and this block would only contradict it. */}
          {rows.length === 0 && noFormats === 'none-found' && (
            <View testID="accuracy-clean" style={styles.empty}>
              <Icon name="check" size={26} color={band.statusOk} strokeWidth={2.1} />
              <ThemedText type="smallBold" style={{ color: band.text }}>{t('noUnrecognized')}</ThemedText>
              <ThemedText type="default" style={muted}>
                {t('noUnrecognizedText')}
              </ThemedText>
            </View>
          )}
      </BandScaffold>
      <EntryDetailSheet transaction={entry} onClose={() => setEntry(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  bandBlock: { gap: 16, paddingTop: 4, paddingBottom: 8 },
  tiles: { flexDirection: 'row', gap: 8 },
  tilesStacked: { flexDirection: 'column' },
  tile: { minHeight: 96 },
  section: { gap: 10, paddingBottom: 22 },
  formatRow: { gap: Spacing.two - 2, paddingVertical: Spacing.three - 2 },
  formatTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  formatTitle: {
    flexShrink: 1,
  },
  openEntry: { gap: Spacing.one, paddingTop: Spacing.one },
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
