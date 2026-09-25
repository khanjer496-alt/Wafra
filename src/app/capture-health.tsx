import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/controls';
import { Icon, type IconName } from '@/components/ui/icon';
import { ScreenScaffold } from '@/components/ui/screen-scaffold';
import type { ScreenHeaderProps } from '@/components/ui/screen-header';
import { Radius, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { getIosCaptureNativeModule, subscribeIosCaptureStatusRefresh } from '@/lib/capture';
import { banksSeenInAlerts, captureHealthStatus, capturedThisMonth } from '@/lib/capture-health-summary';
import { detailsWords } from '@/lib/details-copy';
import { t } from '@/lib/i18n';
import { formatCaptureReceipt, iosCaptureHealthCopy, readIosCaptureHealth, type IosCaptureHealth } from '@/lib/ios-capture-health';
import { useStore } from '@/lib/store';

type Load = { state: 'loading' } | { state: 'ready'; health: IosCaptureHealth | null };

function Counter({ value, label, testID }: { value: string; label: string; testID: string }) {
  const theme = useTheme();
  return <View testID={testID} accessible accessibilityLabel={`${value} ${label}`}
    style={[styles.counter, { borderColor: theme.cardBorder }]}>
    <ThemedText type="title" tabular>{value}</ThemedText>
    <ThemedText type="meta" themeColor="textSecondary">{label}</ThemedText>
  </View>;
}

function LinkRow({ title, body, icon, onPress, testID }: {
  title: string; body?: string; icon: IconName; onPress: () => void; testID: string;
}) {
  const theme = useTheme();
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={body ? `${title}. ${body}` : title}
    onPress={onPress}
    style={({ pressed }) => [styles.linkRow, { borderTopColor: theme.cardBorder, backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
    <Icon name={icon} size={18} color={theme.textSecondary} />
    <View style={styles.grow}>
      <ThemedText type="smallBold">{title}</ThemedText>
      {body ? <ThemedText type="meta" themeColor="textSecondary">{body}</ThemedText> : null}
    </View>
    <Icon name="chevron-right" size={16} color={theme.textTertiary} />
  </Pressable>;
}

/**
 * Automatic capture, on one page: whether the queue is being processed, what
 * is waiting, what was added, and where to go when something is missing.
 * Every figure comes from the native queue receipt or the ledger; nothing here
 * is estimated, and there is no per-sender switch because the automation has
 * none (it hands Wafra every message).
 */
export default function CaptureHealthScreen() {
  const router = useRouter();
  const theme = useTheme();
  const language = useLanguage();
  const d = detailsWords(language);
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

  const headline = !ios ? d.capture.notIphone
    : load.state === 'loading' ? healthCopy.unknown
    : status.kind === 'working' ? d.capture.working
    : status.kind === 'quiet' ? d.capture.quiet
    : status.kind === 'never' ? d.capture.never
    : healthCopy[status.kind];
  const detail = status.kind === 'working' || status.kind === 'quiet'
    ? d.capture.lastHandled(formatCaptureReceipt(status.lastHandledAt, language))
    : status.kind === 'never' ? d.capture.neverBody : null;
  const tone = status.kind === 'working' ? theme.income
    : status.kind === 'attention' || status.kind === 'paused' ? theme.warning
    : theme.textTertiary;

  const header: ScreenHeaderProps = {
    title: d.capture.title,
    back: { label: t('back'), onPress: () => router.canGoBack() ? router.back() : router.replace('/settings') },
  };

  return (
    <ScreenScaffold headerMode="native" header={header} testID="capture-health"
      scrollProps={{ showsVerticalScrollIndicator: false }}>
      <View testID="capture-health-status" style={styles.hero} accessibilityLiveRegion="polite">
        <View style={styles.statusLine}>
          <View style={[styles.dot, { backgroundColor: tone }]} />
          <ThemedText type="subtitle">{headline}</ThemedText>
        </View>
        {detail ? <ThemedText type="small" themeColor="textSecondary">{detail}</ThemedText> : null}
        {status.kind === 'quiet' ? <ThemedText type="meta" themeColor="textSecondary">{d.capture.quietBody}</ThemedText> : null}
      </View>

      <View style={styles.counters}>
        <Counter testID="capture-health-added" value={String(added)} label={d.capture.added} />
        <Pressable accessibilityRole="button" accessibilityLabel={`${reviewWaiting} ${d.capture.review}. ${d.capture.openReview}`}
          onPress={() => router.push('/review-alerts')} style={styles.counterPress}>
          <Counter testID="capture-health-review" value={String(reviewWaiting)} label={d.capture.review} />
        </Pressable>
        <Counter testID="capture-health-queue" value={health ? String(health.pending) : '—'} label={d.capture.queue} />
      </View>

      <View testID="capture-health-banks" style={styles.section}>
        <ThemedText type="smallBold" accessibilityRole="header">{d.capture.banksTitle}</ThemedText>
        {banks.length > 0 ? banks.map((name) => (
          <View key={name} style={[styles.bankRow, { borderTopColor: theme.cardBorder }]}>
            <Icon name="bank" size={18} color={theme.textSecondary} />
            <ThemedText type="small" style={styles.grow}>{name}</ThemedText>
          </View>
        )) : <ThemedText type="small" themeColor="textSecondary">{d.capture.banksEmpty}</ThemedText>}
        {ios ? <ThemedText type="meta" themeColor="textTertiary">{d.capture.banksNote}</ThemedText> : null}
      </View>

      <View style={styles.section}>
        <ThemedText type="smallBold" accessibilityRole="header">{d.capture.alsoTitle}</ThemedText>
        {ios ? <LinkRow testID="capture-health-apple-pay" icon="phone" title={d.capture.applePay} body={d.capture.applePayBody}
          onPress={() => router.push('/ios-apple-pay-setup')} /> : null}
        <LinkRow testID="capture-health-statements" icon="upload" title={d.capture.statements} body={d.capture.statementsBody}
          onPress={() => router.push('/statement-import')} />
      </View>

      {ios ? <View style={styles.section}>
        <ThemedText type="smallBold" accessibilityRole="header">{d.capture.troubleTitle}</ThemedText>
        <LinkRow testID="capture-health-setup" icon="sliders" title={d.capture.trouble}
          onPress={() => router.push('/ios-setup')} />
        <ThemedText type="meta" themeColor="textTertiary">{healthCopy.explanation}</ThemedText>
        <Button label={d.capture.refresh} variant="ghost" onPress={() => void refresh()} />
      </View> : null}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  hero: { gap: Spacing.two, paddingBottom: Spacing.four },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  dot: { width: 10, height: 10, borderRadius: Radius.full },
  counters: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, paddingBottom: Spacing.four },
  counter: { flexGrow: 1, flexBasis: 96, minHeight: 88, gap: Spacing.one, padding: Spacing.three, borderWidth: 1, borderRadius: Radius.control },
  counterPress: { flexGrow: 1, flexBasis: 96 },
  section: { gap: Spacing.two, paddingBottom: Spacing.four },
  bankRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth },
  linkRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth },
  grow: { flex: 1, minWidth: 0, gap: 2 },
});
