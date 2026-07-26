/**
 * SMS import.
 *
 * Runs the SAME pipeline as the automatic import on Home — scanInbox →
 * buildImportPlan → importBatch — and just makes the plan visible before it is
 * applied. Cards are attributed by their last four digits, duplicates are
 * skipped on the message fingerprint, and statements become card dues.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { Block, Row, ScreenHeader, Section, SectionHeader } from '@/components/ui/layout';
import { Money } from '@/components/ui/money';
import { PulseDot } from '@/components/ui/states';
import { CategoryTile } from '@/components/ui/tile';
import { EASE, MaxContentWidth, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  buildImportPlan,
  isSmsScanningAvailable,
  requestSmsPermission,
  scanInbox,
  type ImportPlan,
  type ScannedSms,
} from '@/lib/auto-import';
import { getCategory } from '@/lib/categories';
import { shortDate } from '@/lib/format';
import { isProActive } from '@/lib/purchases';
import { parseSmsBatch } from '@/lib/sms-parser';
import { useStore } from '@/lib/store';

const EASING = Easing.bezier(EASE[0], EASE[1], EASE[2], EASE[3]);

const SAMPLE = `Purchase of AED 187.50 with Debit Card ending 1234 at CARREFOUR MALL OF EMIRATES, DUBAI on 17/07/2026. Avl balance AED 12,345.67

AED 55.00 was debited from your account for payment to SALIK RECHARGE on 16/07/2026

Salary of AED 18,500.00 has been credited to your account ending 5678`;

const PREVIEW_LIMIT = 60;
const PANEL_HEIGHT = 186;

/**
 * The loading state: skeleton lines under a scan line sweeping down them.
 * No spinner — a spinner says "wait", this says what is being read.
 */
function ScanPanel() {
  const theme = useTheme();
  const y = useSharedValue(0);

  useEffect(() => {
    y.value = withRepeat(withTiming(1, { duration: 2400, easing: EASING }), -1, false);
  }, [y]);

  const line = useAnimatedStyle(() => ({ transform: [{ translateY: y.value * PANEL_HEIGHT }] }));

  return (
    <View style={[styles.panel, { borderColor: theme.cardBorder, backgroundColor: theme.backgroundElement }]}>
      {[0.82, 0.55, 0.7, 0.4, 0.88, 0.6, 0.35].map((w, i) => (
        <View
          key={i}
          style={[styles.panelLine, { width: `${w * 100}%`, backgroundColor: theme.backgroundSelected }]}
        />
      ))}
      <Animated.View style={[styles.scanLine, { backgroundColor: theme.primary }, line]} />
    </View>
  );
}

export default function ImportSmsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { auto } = useLocalSearchParams<{ auto?: string }>();
  const { state, importBatch, addBill } = useStore();

  const [text, setText] = useState('');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{ scanned: number; found: number } | null>(null);
  const [trackedBills, setTrackedBills] = useState<Set<number>>(new Set());
  const [skippedCount, setSkippedCount] = useState(0);
  const started = useRef(false);

  const runScan = async () => {
    if (!isProActive(state)) {
      router.push('/pro');
      return;
    }
    setScanning(true);
    setProgress(null);
    try {
      const granted = await requestSmsPermission();
      if (!granted) {
        Alert.alert(
          'Permission needed',
          'Wafra needs SMS access to read bank alerts. You can also paste messages manually below.',
        );
        return;
      }
      // Full history: fingerprints make rescans safe (no duplicates).
      const { parsed, newestTs } = await scanInbox(0, state.merchantOverrides, (scanned, found) =>
        setProgress({ scanned, found }),
      );
      const p = buildImportPlan(parsed, state, newestTs);
      const txLike = parsed.filter((x) => x.kind === 'transaction' || x.kind === 'cardPayment');
      setSkippedCount(Math.max(0, txLike.length - p.txCount));
      setPlan(p);
      setTrackedBills(new Set());
      if (p.txCount === 0 && p.dueCount === 0 && p.billDues.length === 0 && p.healedCount === 0) {
        Alert.alert('Up to date', 'Everything in your inbox is already filed.');
      }
    } finally {
      setScanning(false);
    }
  };

  const runParse = (input: string) => {
    if (!isProActive(state)) {
      router.push('/pro');
      return;
    }
    const parsed: ScannedSms[] = parseSmsBatch(input, state.merchantOverrides);
    const p = buildImportPlan(parsed, state, state.lastScanTs);
    const txLike = parsed.filter((x) => x.kind === 'transaction' || x.kind === 'cardPayment');
    setSkippedCount(Math.max(0, txLike.length - p.txCount));
    setPlan(p);
    setTrackedBills(new Set());
  };

  const applyPlan = () => {
    if (!plan) return;
    importBatch(plan.batch);
    router.back();
  };

  useEffect(() => {
    if (auto === '1' && isSmsScanningAvailable() && !started.current) {
      started.current = true;
      runScan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const previewRows = useMemo(
    () => (plan?.batch.transactions ?? []).slice(0, PREVIEW_LIMIT),
    [plan],
  );

  /** Rows the parser had to guess at — the ones worth reporting. */
  const unreadCount = useMemo(
    () => (plan?.batch.transactions ?? []).filter((tx) => tx.raw).length,
    [plan],
  );

  const newBills = useMemo(() => {
    const existing = new Set(state.bills.map((b) => b.title.toLowerCase()));
    return (plan?.billDues ?? []).filter((p) => !existing.has(p.merchant.toLowerCase()));
  }, [plan, state.bills]);

  // Preview account name: index refs point into the plan's new accounts.
  const accountName = (ref: string): string => {
    if (/^\d+$/.test(ref)) return plan?.batch.newAccounts[Number(ref)]?.name ?? 'New card';
    return state.accounts.find((a) => a.id === ref)?.name ?? '';
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.headerWrap}>
          <ScreenHeader title="Read my inbox" onBack={() => router.back()} />
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {scanning ? (
            <Section index={0} style={styles.scanning}>
              <ScanPanel />
              <View style={styles.progressHead}>
                <View style={styles.progressLabel}>
                  <PulseDot color={theme.primary} />
                  <ThemedText type="micro" themeColor="textTertiary">
                    Progress
                  </ThemedText>
                </View>
                <ThemedText type="small" tabular>
                  {progress?.scanned ?? 0} read · {progress?.found ?? 0} matched
                </ThemedText>
              </View>
              <ThemedText type="meta" themeColor="textTertiary">
                Reading backwards from today. Nothing leaves the phone.
              </ThemedText>
            </Section>
          ) : (
            <Section index={0} style={styles.intro}>
              <ThemedText type="default" themeColor="textSecondary">
                {isSmsScanningAvailable()
                  ? 'Rescans your whole inbox and shows what would be filed. Cards are matched automatically and nothing imports twice. You can also paste messages below.'
                  : 'Paste one or more bank alerts below, separated by a blank line. Everything is read on this device.'}
              </ThemedText>
              {isSmsScanningAvailable() && (
                <Button label="Scan full inbox" icon="search" onPress={runScan} />
              )}
              <TextInput
                accessibilityLabel="Paste bank messages"
                value={text}
                onChangeText={setText}
                multiline
                placeholder="Purchase of AED 187.50 with Debit Card ending 1234 at CARREFOUR…"
                placeholderTextColor={theme.textTertiary}
                style={[
                  styles.textarea,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.cardBorder,
                    color: theme.text,
                  },
                ]}
              />
              <View style={styles.parseRow}>
                <Button
                  inline
                  variant="outline"
                  label="Parse pasted text"
                  onPress={() => runParse(text)}
                  disabled={!text.trim()}
                />
                <Button
                  inline
                  variant="ghost"
                  label="Try sample"
                  onPress={() => {
                    setText(SAMPLE);
                    runParse(SAMPLE);
                  }}
                />
              </View>
            </Section>
          )}

          {plan !== null && !scanning && (
            <>
              <Section index={1}>
                <View style={[styles.stats, { borderColor: theme.cardBorder }]}>
                  {(
                    [
                      [plan.txCount, 'Matched', theme.text],
                      [plan.newAccountCount, plan.newAccountCount === 1 ? 'Card' : 'Cards', theme.text],
                      [unreadCount, 'Unread', unreadCount > 0 ? theme.warning : theme.textTertiary],
                    ] as const
                  ).map(([value, label, color], i) => (
                    <View
                      key={label}
                      style={[
                        styles.statCell,
                        i > 0 && { borderLeftWidth: 1, borderLeftColor: theme.cardBorder },
                      ]}>
                      <ThemedText type="small" tabular style={[styles.statFigure, { color }]}>
                        {value}
                      </ThemedText>
                      <ThemedText type="nano" style={{ color }}>
                        {label}
                      </ThemedText>
                    </View>
                  ))}
                </View>
                {skippedCount > 0 && (
                  <ThemedText type="meta" themeColor="textTertiary" style={styles.skipped}>
                    {skippedCount} already filed · skipped
                  </ThemedText>
                )}
                {plan.healedCount > 0 && (
                  <ThemedText type="meta" style={{ color: theme.income }}>
                    {plan.healedCount} existing entr{plan.healedCount === 1 ? 'y' : 'ies'} re-read
                    better — renamed or recategorised in place.
                  </ThemedText>
                )}
              </Section>

              {newBills.length > 0 && (
                <Section index={2}>
                  <SectionHeader title="Bill reminders detected" />
                  {newBills.map((p, i) => {
                    const tracked = trackedBills.has(i);
                    return (
                      <Row key={`bill-${i}`} last={i === newBills.length - 1}>
                        <CategoryTile category={p.categoryGuess} />
                        <View style={styles.rowText}>
                          <ThemedText type="small" numberOfLines={1}>
                            {p.merchant}
                          </ThemedText>
                          <ThemedText type="meta" themeColor="textTertiary">
                            {getCategory(p.categoryGuess).label}
                            {p.dueDay ? ` · due day ${p.dueDay}` : ''}
                          </ThemedText>
                        </View>
                        <Button
                          variant={tracked ? 'ghost' : 'outline'}
                          label={tracked ? 'Tracked' : 'Track'}
                          disabled={tracked}
                          onPress={() => {
                            addBill({
                              title: p.merchant,
                              category: p.categoryGuess,
                              amountFils: p.amountFils,
                              dueDay: p.dueDay ?? (p.date ? Number(p.date.slice(8)) : 1),
                              autoDetected: true,
                            });
                            setTrackedBills(new Set(trackedBills).add(i));
                          }}
                          style={styles.trackButton}
                        />
                      </Row>
                    );
                  })}
                </Section>
              )}

              {previewRows.length > 0 && (
                <Section index={3}>
                  <SectionHeader
                    title={
                      plan.txCount > PREVIEW_LIMIT
                        ? `Just filed · first ${PREVIEW_LIMIT} of ${plan.txCount}`
                        : 'Just filed'
                    }
                  />
                  {previewRows.map((tx, i) => (
                    <Animated.View key={`${tx.date}-${tx.title}-${i}`} entering={FadeInDown.delay(i * 100)}>
                      <Row last={i === previewRows.length - 1}>
                        <CategoryTile category={tx.category} />
                        <View style={styles.rowText}>
                          <ThemedText type="small" numberOfLines={1}>
                            {tx.title}
                          </ThemedText>
                          <ThemedText type="meta" themeColor="textTertiary" numberOfLines={1}>
                            {getCategory(tx.category).label} · {shortDate(tx.date)}
                            {accountName(tx.accountId) ? ` · ${accountName(tx.accountId)}` : ''}
                          </ThemedText>
                        </View>
                        <Money
                          fils={tx.amountFils}
                          prefix={false}
                          sign={tx.type === 'income' ? 'plus' : 'minus'}
                          color={tx.type === 'income' ? theme.income : theme.text}
                        />
                      </Row>
                    </Animated.View>
                  ))}
                </Section>
              )}

              {unreadCount > 0 && (
                <Section index={4}>
                  <Block onPress={() => router.push('/accuracy')}>
                    <View style={styles.unreadRow}>
                      <Icon name="alert" size={17} color={theme.warning} />
                      <View style={styles.rowText}>
                        <ThemedText type="small">
                          {unreadCount} message{unreadCount === 1 ? '' : 's'} in a format we don&apos;t
                          know
                        </ThemedText>
                        <ThemedText type="meta" themeColor="textTertiary">
                          Send the shapes — digits masked — and they parse next release
                        </ThemedText>
                      </View>
                      <Icon name="chevron-right" size={15} color={theme.textTertiary} />
                    </View>
                  </Block>
                </Section>
              )}
            </>
          )}
        </ScrollView>

        {plan !== null && !scanning && (plan.txCount > 0 || plan.dueCount > 0 || plan.healedCount > 0) && (
          <View style={styles.footer}>
            <Button
              label={`File ${plan.txCount} entr${plan.txCount === 1 ? 'y' : 'ies'}`}
              onPress={applyPlan}
            />
          </View>
        )}
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
    paddingBottom: Spacing.five,
    gap: Spacing.four,
  },
  intro: {
    gap: Spacing.three - 2,
  },
  scanning: {
    gap: Spacing.three - 2,
  },
  panel: {
    height: PANEL_HEIGHT,
    borderWidth: 1,
    borderRadius: Radius.sheet,
    padding: Spacing.three + 2,
    gap: Spacing.three - 2,
    overflow: 'hidden',
  },
  panelLine: {
    height: 10,
    borderRadius: 5,
  },
  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 2,
  },
  progressLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  progressHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  textarea: {
    minHeight: 110,
    borderWidth: 1,
    borderRadius: Radius.control,
    padding: Spacing.three - 4,
    fontSize: 13,
    textAlignVertical: 'top',
  },
  parseRow: {
    flexDirection: 'row',
    gap: Spacing.two + 2,
  },
  stats: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.half,
    paddingVertical: Spacing.three - 2,
  },
  statFigure: {
    fontSize: 20,
    lineHeight: 24,
  },
  skipped: {
    paddingTop: Spacing.two,
  },
  rowText: {
    flex: 1,
    gap: Spacing.half,
  },
  trackButton: {
    minHeight: 36,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three - 2,
  },
  unreadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
  },
  footer: {
    paddingHorizontal: ScreenPadding,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
});
