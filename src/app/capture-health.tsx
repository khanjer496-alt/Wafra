import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';

import { BandCount } from '@/components/capture/band-count';
import { SheetLinkRow, SheetSectionTitle } from '@/components/capture/sheet-link-row';
import { ThemedText } from '@/components/themed-text';
import { BandScaffold } from '@/components/ui/band-scaffold';
import { EButton } from '@/components/ui/band/e-button';
import { GlyphTile } from '@/components/ui/band/glyph-tile';
import { StatTile, statTileColors } from '@/components/ui/band/stat-tile';
import { BankAvatar } from '@/components/ui/bank-avatar';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { getIosCaptureNativeModule, subscribeIosCaptureStatusRefresh } from '@/lib/capture';
import { handledTimeParts } from '@/lib/capture-band';
import { captureBandCopy } from '@/lib/capture-band-copy';
import { banksSeenInAlerts, captureHealthStatus, capturedThisMonth } from '@/lib/capture-health-summary';
import { detailsWords } from '@/lib/details-copy';
import { iosCaptureHealthCopy, readIosCaptureHealth, type IosCaptureHealth } from '@/lib/ios-capture-health';
import { useStore } from '@/lib/store';
import type { Account } from '@/lib/types';

type Load = { state: 'loading' } | { state: 'ready'; health: IosCaptureHealth | null };

/**
 * Automatic capture, on the green band: whether the queue is being
 * processed and when it last was (the band's figure), what is waiting and
 * what was added (stat tiles), then on the sheet the banks already read and
 * where to go when something is missing. Every figure comes from the native
 * queue receipt or the ledger; nothing here is estimated, and there is no
 * per-sender switch because the automation has none (it hands Wafra every
 * message). "Working" is decided only from the recency of the last handled
 * receipt (`captureHealthStatus`).
 */
export default function CaptureHealthScreen() {
  const router = useRouter();
  const language = useLanguage();
  const band = useBand('flow');
  const largeText = useLargeTextLayout();
  const d = detailsWords(language);
  const words = captureBandCopy(language);
  const healthCopy = iosCaptureHealthCopy(language);
  const { state } = useStore();
  const ios = Platform.OS === 'ios';
  const [load, setLoad] = useState<Load>(ios ? { state: 'loading' } : { state: 'ready', health: null });
  const alive = useRef(true);
  const sequence = useRef(0);

  const refresh = useCallback(async () => {
    if (!ios) return;
    const run = ++sequence.current;
    try {
      const native = getIosCaptureNativeModule();
      const health = native ? readIosCaptureHealth(await native.getCaptureStatus()) : null;
      if (alive.current && run === sequence.current) setLoad({ state: 'ready', health });
    } catch {
      if (alive.current && run === sequence.current) setLoad({ state: 'ready', health: null });
    }
  }, [ios]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const listener = AppState.addEventListener('change', (value) => { if (value === 'active') void refresh(); });
    const unsubscribe = subscribeIosCaptureStatusRefresh(() => { void refresh(); });
    return () => { alive.current = false; listener.remove(); unsubscribe(); };
  }, [refresh]);

  const now = Date.now();
  const health = load.state === 'ready' ? load.health : null;
  const status = captureHealthStatus(health, now);
  const reviewWaiting = useMemo(() => state.reviewTray.pending.filter((item) => item.expiresAt > now).length,
    // `now` moves every render; the count only needs the tray.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.reviewTray.pending]);
  const added = useMemo(() => capturedThisMonth(state.transactions),
    // monthKey reads the StoreProvider's active salary-day setting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.transactions, state.monthStartDay]);
  const banks = useMemo(() => banksSeenInAlerts(state.accounts, state.transactions), [state.accounts, state.transactions]);
  // The logo tile needs the account the name came from (first live match).
  const bankAccounts = useMemo(() => banks.map((name): Account | null => state.accounts.find((account) => !account.archived
    && account.bankName?.trim().toLowerCase() === name.toLowerCase()) ?? null),
  [banks, state.accounts]);

  const headline = !ios ? d.capture.notIphone
    : load.state === 'loading' ? healthCopy.unknown
    : status.kind === 'working' ? d.capture.working
    : status.kind === 'quiet' ? d.capture.quiet
    : status.kind === 'never' ? d.capture.never
    : healthCopy[status.kind];
  const handledAt = status.kind === 'working' || status.kind === 'quiet' ? status.lastHandledAt : null;
  const handled = handledTimeParts(handledAt, now, language, words);
  const detail = status.kind === 'never' ? d.capture.neverBody : null;
  // Mint only for the good news; amber when something needs a look.
  const dot = status.kind === 'working' ? band.accent
    : status.kind === 'attention' || status.kind === 'paused' ? band.statusNear
    : band.onBandSecondary;
  const tile = statTileColors(band, 'band');
  const queue = health ? String(health.pending) : '—';

  const bandContent = <View style={styles.bandBlock}>
    <View testID="capture-health-status" style={styles.status} accessible accessibilityRole="text" accessibilityLiveRegion="polite"
      accessibilityLabel={[headline, handled ? `${words.lastHandledLabel}, ${handled.day} ${handled.time}` : null, detail]
        .filter(Boolean).join('. ')}>
      <View style={styles.statusLine}>
        <View style={[styles.dot, { backgroundColor: dot }]} />
        <ThemedText type="smallBold" style={[styles.statusText, { color: band.onBand }]}>{headline}</ThemedText>
      </View>
      {handled ? <View testID="capture-health-last-handled" style={styles.figure}>
        <ThemedText type="small" style={{ color: band.onBandSecondary }}>{words.lastHandledLabel}</ThemedText>
        <BandCount value={handled.time} size="hero" color={band.onBand} />
        <ThemedText type="meta" style={{ color: band.onBandSecondary }}>{handled.day}</ThemedText>
      </View> : null}
      {detail ? <ThemedText type="small" style={{ color: band.onBandSecondary }}>{detail}</ThemedText> : null}
      {status.kind === 'quiet' ? <ThemedText type="meta" style={{ color: band.onBandSecondary }}>{d.capture.quietBody}</ThemedText> : null}
    </View>
    <View testID="capture-health-counters" style={[styles.tiles, largeText && styles.tilesStacked]}>
      <StatTile testID="capture-health-queue" palette={band} label={d.capture.queue} style={styles.tile}
        accessibilityLabel={`${queue} ${d.capture.queue}`}>
        <BandCount value={queue} color={tile.fg} />
      </StatTile>
      <StatTile testID="capture-health-review" palette={band} label={words.inReview} style={styles.tile}
        accessibilityLabel={`${reviewWaiting} ${d.capture.review}. ${d.capture.openReview}`}
        onPress={() => router.push('/review-alerts')}>
        <BandCount value={String(reviewWaiting)} color={tile.fg} />
      </StatTile>
      <StatTile testID="capture-health-added" palette={band} label={words.addedThisMonth} style={styles.tile}
        accessibilityLabel={`${added} ${d.capture.added}`}>
        <BandCount value={String(added)} color={tile.fg} />
      </StatTile>
    </View>
  </View>;

  return (
    <BandScaffold band="flow" testID="capture-health"
      nav={{ back: () => router.canGoBack() ? router.back() : router.replace('/settings'), title: d.capture.title }}
      bandContent={bandContent}
      scrollProps={{ showsVerticalScrollIndicator: false }}>
      <View testID="capture-health-banks" style={styles.section}>
        <SheetSectionTitle title={d.capture.banksTitle} palette={band} />
        {banks.length > 0 ? <View style={styles.bankList}>
          {bankAccounts.map((account, index) => <View key={banks[index]} style={styles.bankRow} accessible accessibilityRole="text"
            accessibilityLabel={banks[index]}>
            {account ? <BankAvatar account={account} size={44} /> : <GlyphTile icon="bank" palette={band} size={44} />}
            <ThemedText type="small" style={[styles.grow, { color: band.text }]}>{banks[index]}</ThemedText>
          </View>)}
        </View> : <ThemedText type="small" style={{ color: band.textSecondary }}>{d.capture.banksEmpty}</ThemedText>}
        {ios ? <ThemedText type="meta" style={{ color: band.textSecondary }}>{d.capture.banksNote}</ThemedText> : null}
      </View>

      <View style={styles.section}>
        <SheetSectionTitle title={d.capture.alsoTitle} palette={band} />
        {ios ? <SheetLinkRow testID="capture-health-apple-pay" icon="phone" palette={band} title={d.capture.applePay}
          body={d.capture.applePayBody} onPress={() => router.push('/ios-apple-pay-setup')} /> : null}
        <SheetLinkRow testID="capture-health-statements" icon="upload" palette={band} title={d.capture.statements}
          body={d.capture.statementsBody} onPress={() => router.push('/statement-import')} last />
      </View>

      {ios ? <View style={styles.section}>
        <SheetSectionTitle title={d.capture.troubleTitle} palette={band} />
        <SheetLinkRow testID="capture-health-setup" icon="sliders" palette={band} title={d.capture.trouble}
          onPress={() => router.push('/ios-setup')} last />
        <ThemedText type="meta" style={{ color: band.textSecondary }}>{healthCopy.explanation}</ThemedText>
        <EButton testID="capture-health-refresh" palette={band} variant="quiet" label={d.capture.refresh} onPress={() => void refresh()} />
      </View> : null}
    </BandScaffold>
  );
}

const styles = StyleSheet.create({
  bandBlock: { gap: 18, paddingTop: 8 },
  status: { gap: 12 },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statusText: { fontSize: 16, lineHeight: 22, flexShrink: 1 },
  dot: { width: 14, height: 14, borderRadius: 7 },
  figure: { gap: 2, alignItems: 'flex-start' },
  tiles: { flexDirection: 'row', gap: 8 },
  tilesStacked: { flexDirection: 'column' },
  tile: { minHeight: 96 },
  section: { gap: 10, paddingBottom: 20 },
  bankList: { gap: 4 },
  bankRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12 },
  grow: { flex: 1, minWidth: 0 },
});
