import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { SheetSectionTitle } from '@/components/capture/sheet-link-row';
import { BandTitle } from '@/components/settings-band/band-title';
import { ThemedText } from '@/components/themed-text';
import { BandScaffold } from '@/components/ui/band-scaffold';
import { EButton } from '@/components/ui/band/e-button';
import { TodayWidgetPreview, UpcomingWidgetPreview } from '@/components/widgets/widget-previews';
import { WidgetHistory } from '@/components/widgets/widget-history';
import { useBand, useBandScheme } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { BandPalettes } from '@/constants/theme';
import { ledgerMoneySpec } from '@/lib/ledger-money';
import { marketCurrencyCode } from '@/lib/markets';
import { useStore } from '@/lib/store';
import { toISODate } from '@/lib/format';
import { prepareWidgetSnapshot, requestWidgetSnapshotSync } from '@/lib/widget-sync';
import type { WidgetSnapshot } from '@/lib/widget-snapshot';
import { useResumeClock } from '@/hooks/use-today';
import { markWidgetsHintDone } from '@/lib/widgets-hint';
import { widgetsCopy } from '@/lib/widgets-copy';
import { canPinWidgets, pinWidget, type PinnableWidget } from '../../modules/wafra-widgets';

/**
 * Widgets, on Home's ink band: what the two real widgets show right now,
 * drawn from the same snapshot Home hands them (`prepareWidgetSnapshot`),
 * and how to add them.
 *
 * iOS offers no API to add a widget, so iOS gets Apple's own three steps and
 * no button. Android asks the launcher to pin a widget
 * (AppWidgetManager.requestPinAppWidget) where the launcher supports it; a
 * launcher that does not, or that refuses the request, gets the manual steps.
 * Opening this screen retires Home's widgets hint for good.
 */
export default function WidgetsScreen() {
  const router = useRouter();
  const language = useLanguage();
  const band = useBand('home');
  const scheme = useBandScheme();
  const words = widgetsCopy(language);
  const platform: 'ios' | 'android' = Platform.OS === 'ios' ? 'ios' : 'android';
  const { state, getStateSnapshot, getStateGeneration } = useStore();
  const now = useResumeClock();
  const [prepared, setPrepared] = useState<{ value: WidgetSnapshot | null; generation: number } | null>(null);
  const [preparing, setPreparing] = useState(true);
  const [pinFailed, setPinFailed] = useState(false);
  const [pinning, setPinning] = useState<PinnableWidget | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    void markWidgetsHintDone('opened');
    return () => { alive.current = false; };
  }, []);

  const moneySpec = useMemo(() => state.ledgerMoney ?? ledgerMoneySpec(marketCurrencyCode(state.marketId)),
    [state.ledgerMoney, state.marketId]);
  const generation = getStateGeneration();
  const allowed = state.hydrated && state.onboarded && !state.privateMode;
  const snapshot = allowed && prepared?.generation === generation && prepared.value?.todayISO === toISODate(now) ? prepared.value : null;
  useEffect(() => {
    let cancelled = false;
    const current = () => !cancelled && generation === getStateGeneration() && !getStateSnapshot().privateMode;
    if (!allowed || !moneySpec) {
      setPrepared(null); setPreparing(false);
      return () => { cancelled = true; };
    }
    setPreparing(true);
    void prepareWidgetSnapshot({ state, now, moneySpec, language: language === 'ar' ? 'ar' : 'en' }, () => !current())
      .then(value => {
        if (!current()) return;
        // Pending import/detection leaves the last valid summary in place.
        if (value !== undefined) setPrepared({ value, generation });
        setPreparing(value === undefined);
      }).catch(() => { if (current()) setPreparing(false); });
    return () => { cancelled = true; };
  }, [state, now, moneySpec, language, generation, allowed, getStateGeneration, getStateSnapshot]);
  // Asked once: the launcher does not change while this screen is open.
  const pinnable = useMemo(() => canPinWidgets(), []);
  const showSteps = platform === 'ios' || !pinnable || pinFailed;

  const pin = (kind: PinnableWidget) => {
    if (pinning || preparing || !snapshot || !moneySpec) return;
    setPinning(kind);
    const current = () => alive.current && generation === getStateGeneration() && !getStateSnapshot().privateMode;
    // The initial launcher render must receive the full prepared snapshot,
    // even when this screen was entered directly before Home ever mounted.
    const job = requestWidgetSnapshotSync({ state: getStateSnapshot(), now: new Date(), moneySpec,
      language: language === 'ar' ? 'ar' : 'en' }, current);
    void job.done.then(async outcome => {
      if (!current()) return;
      const ok = outcome === 'written' && await pinWidget(kind);
      if (current()) setPinFailed(!ok);
    }).catch(() => { if (current()) setPinFailed(true); })
      .finally(() => { if (alive.current) setPinning(null); });
  };

  const palettes = BandPalettes[scheme];
  const widgets: { kind: PinnableWidget; name: string; about: string; preview: React.ReactNode }[] = [
    {
      kind: 'today', name: words.todayName, about: words.todayAbout,
      preview: <TodayWidgetPreview testID="widgets-preview-today" snapshot={snapshot} palette={palettes.home} words={words} />,
    },
    {
      kind: 'upcoming', name: words.upcomingName, about: words.upcomingAbout,
      preview: <UpcomingWidgetPreview testID="widgets-preview-upcoming" snapshot={snapshot} palette={palettes.bills}
        words={words} platform={platform} />,
    },
  ];

  return (
    <BandScaffold band="home" testID="widgets-screen"
      nav={{ back: () => router.canGoBack() ? router.back() : router.replace('/settings') }}
      bandContent={<View style={styles.bandBlock}>
        <BandTitle testID="widgets-title" title={words.title} body={words.body(platform)} palette={band} />
      </View>}
      scrollProps={{ showsVerticalScrollIndicator: false }}>
      {allowed && preparing ? <ThemedText testID="widgets-preparing" accessibilityLiveRegion="polite"
        type="small" style={{ color: band.textSecondary }}>{state.historyImport && state.historyImport.status !== 'complete' ? words.importPending : words.preparing}</ThemedText> : null}
      {widgets.map((widget) => <View key={widget.kind} testID={`widgets-section-${widget.kind}`} style={styles.section}>
        <View style={styles.heading}>
          <SheetSectionTitle title={widget.name} palette={band} />
          <ThemedText type="meta" style={{ color: band.textSecondary }}>{words.size(platform, widget.kind)}</ThemedText>
        </View>
        <ThemedText type="small" style={{ color: band.textSecondary }}>{widget.about}</ThemedText>
        <View style={styles.preview}>{widget.preview}</View>
        {widget.kind === 'today' ? <WidgetHistory snapshot={snapshot} palette={band} words={words} /> : null}
        {platform === 'android' && pinnable ? <EButton testID={`widgets-pin-${widget.kind}`} palette={band}
          label={words.add} accessibilityHint={words.addNamed(widget.name)}
          busy={pinning === widget.kind} disabled={preparing || !snapshot || (pinning !== null && pinning !== widget.kind)}
          onPress={() => pin(widget.kind)} /> : null}
      </View>)}

      {state.privateMode ? <ThemedText testID="widgets-private-note" type="meta" style={{ color: band.textSecondary }}>
        {words.privateNote}
      </ThemedText> : null}
      {platform === 'ios' ? <ThemedText testID="widgets-lock-note" type="meta" style={{ color: band.textSecondary }}>
        {words.lockNote}
      </ThemedText> : null}

      {showSteps ? <View testID="widgets-how-to" style={styles.section}>
        <SheetSectionTitle title={words.howTitle} palette={band} />
        {pinFailed ? <ThemedText testID="widgets-pin-failed" accessibilityRole="alert" type="small" style={{ color: band.text }}>
          {words.addFailed}
        </ThemedText> : null}
        {words.steps(platform).map((step, index) => <View key={step} style={styles.step} accessible
          accessibilityLabel={`${words.step(index + 1)}. ${step}`}>
          <View style={[styles.stepBadge, { borderColor: band.text }]}>
            <ThemedText type="smallBold" style={{ color: band.text }}>{String(index + 1)}</ThemedText>
          </View>
          <ThemedText type="small" style={[styles.stepText, { color: band.text }]}>{step}</ThemedText>
        </View>)}
      </View> : null}
    </BandScaffold>
  );
}

const styles = StyleSheet.create({
  bandBlock: { paddingTop: 4, paddingBottom: 8 },
  section: { gap: 10, paddingBottom: 22 },
  heading: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  preview: { alignItems: 'flex-start', paddingVertical: 4 },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, minHeight: 44 },
  stepBadge: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  stepText: { flex: 1, minWidth: 0, paddingTop: 5 },
});
