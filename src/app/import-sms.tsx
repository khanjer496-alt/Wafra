/**
 * Reading bank messages by hand.
 *
 * Runs the SAME pipeline as the automatic import on Home — scanInbox →
 * buildImportPlan → importBatch — and just makes the plan visible before it is
 * applied. Cards are attributed by their last four digits, duplicates are
 * skipped on the message fingerprint, and statements become card dues.
 *
 * TWO THINGS ON THIS SCREEN ARE PLATFORM-DEPENDENT, AND BOTH USED TO BE WRONG.
 *
 * It was called "Read my inbox" everywhere. iOS gives no app access to
 * Messages, so on iPhone that title described something the screen could not
 * do; what it actually offers there is a paste box.
 *
 * And pasting was behind the paywall. On Android that was survivable — the
 * inbox scan is right there — but on iPhone, where pasting is the ONLY
 * ingestion path that works without a Shortcut, it made the free tier of the
 * iPhone app strictly worse than the Android one at the same price. Pasting is
 * the user doing the work; Wafra charges for doing the work itself. See
 * `requiresPro` in lib/purchases.ts. The full inbox scan is still Pro, on the
 * platform that has one.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
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
import { SupplementImports } from '@/components/supplement-imports';
import { Button } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { Block, Row, ScreenHeader, Section, SectionHeader } from '@/components/ui/layout';
import { Money } from '@/components/ui/money';
import { PulseDot } from '@/components/ui/states';
import { CategoryTile } from '@/components/ui/tile';
import { EASE, MaxContentWidth, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { useTheme } from '@/hooks/use-theme';
import {
  buildImportPlan,
  isSmsScanningAvailable,
  requestSmsPermission,
  scanInbox,
  type ImportPlan,
  type ScannedSms,
} from '@/lib/auto-import';
import { categoryLabel } from '@/lib/categories';
import { shortDate } from '@/lib/format';
import { isProActive, requiresPro } from '@/lib/purchases';
import { parseSmsBatch } from '@/lib/sms-parser';
import { useStore } from '@/lib/store';
import { t, tf } from '@/lib/i18n';

const EASING = Easing.bezier(EASE[0], EASE[1], EASE[2], EASE[3]);

const SAMPLE = `Purchase of AED 187.50 with Debit Card ending 1234 at CARREFOUR MALL OF EMIRATES, DUBAI on 17/07/2026. Avl balance AED 12,345.67

AED 55.00 was debited from your account for payment to SALIK RECHARGE on 16/07/2026

Salary of AED 18,500.00 has been credited to your account ending 5678`;

const PREVIEW_LIMIT = 60;
const PANEL_HEIGHT = 186;

/**
 * How many messages the user actually pasted, counted the way `pasteHint`
 * asks them to paste: one per blank-line-separated block. Used only to say
 * how many of them came back unreadable.
 */
function messageBlocks(input: string): number {
  const blocks = input
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean).length;
  // Something was pasted — the parse button is disabled otherwise — so the
  // floor is one. "0 messages in a format we do not know" is not an answer.
  return Math.max(1, blocks);
}

/**
 * What a paste that produced no plan actually was. `filed` means the parser
 * read it and the ledger already had every row; `unreadable` means the parser
 * could make nothing of it at all. Two different answers, and the screen used
 * to give neither.
 */
type PasteVerdict = { kind: 'filed' | 'unreadable'; count: number };

/**
 * Something this screen has to SAY, drawn rather than announced.
 *
 * All four of these were `Alert.alert(title, body)`. On react-native-web that
 * method is `static alert() {}` — no dialog, no console warning, no throw — so
 * a scan refused because the ledger had not hydrated, a denied SMS permission,
 * and an inbox with nothing new all reported themselves into a dialog that is
 * never drawn. The button consumed the tap and said nothing, and the only
 * available reading of that is that it is broken.
 *
 * None of them is a question: there is no second button and nothing to
 * confirm, so none of them wants a ConfirmSheet. They want to be visible,
 * which is what the paste verdict below already does with the same two lines.
 */
type Notice = { title: string; body: string };

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
  const keyboardHeight = useKeyboardHeight();
  const { auto } = useLocalSearchParams<{ auto?: string }>();
  const { state, importBatch, addBill } = useStore();

  const [text, setText] = useState('');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [showManual, setShowManual] = useState(() => !isSmsScanningAvailable());
  const [progress, setProgress] = useState<{ scanned: number; found: number } | null>(null);
  const [trackedBills, setTrackedBills] = useState<Set<number>>(new Set());
  const [skippedCount, setSkippedCount] = useState(0);
  const [pasteVerdict, setPasteVerdict] = useState<PasteVerdict | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const started = useRef(false);

  const runScan = async () => {
    // The plan's duplicate checks read state.transactions, so scanning before
    // the ledger has loaded imports the whole inbox a second time.
    if (!state.hydrated) {
      setNotice({ title: t('importOneMoment'), body: t('dataStillLoading') });
      return;
    }
    // The scan is Wafra reading a whole inbox on its own — the paid half.
    // Asked through requiresPro() rather than inline so the free/paid line
    // lives in one place and stays the same on both platforms.
    if (requiresPro('inboxScan') && !isProActive(state)) {
      router.push('/pro');
      return;
    }
    setScanning(true);
    setProgress(null);
    setPasteVerdict(null);
    setNotice(null);
    try {
      const granted = await requestSmsPermission();
      if (!granted) {
        setNotice({
          title: t('smsPermissionNeeded'),
          body: t('smsPermissionNeededBody'),
        });
        return;
      }
      // Full history: fingerprints make rescans safe (no duplicates).
      const { parsed, newestTs, declined } = await scanInbox(
        0,
        state.merchantOverrides,
        (scanned, found) => setProgress({ scanned, found }),
      );
      // `declined` carried through, exactly as the automatic path does. Without
      // it this screen — the one a user reaches BECAUSE something looks wrong —
      // is the one path that cannot clear a refused transaction the ledger
      // recorded as spending.
      const p = buildImportPlan(parsed, state, newestTs, new Date(), declined);
      const txLike = parsed.filter((x) => x.kind === 'transaction' || x.kind === 'cardPayment');
      setSkippedCount(Math.max(0, txLike.length - p.txCount));
      setPlan(p);
      setTrackedBills(new Set());
      if (p.txCount === 0 && p.dueCount === 0 && p.billDues.length === 0 && p.healedCount === 0) {
        setNotice({ title: t('upToDate'), body: t('inboxAlreadyFiled') });
      }
    } finally {
      setScanning(false);
    }
  };

  /**
   * Free, on every platform. The user is holding the message; all Wafra does
   * is read it better than they would type it.
   */
  const runParse = (input: string) => {
    if (!state.hydrated) {
      setNotice({ title: t('importOneMoment'), body: t('dataStillLoading') });
      return;
    }
    setNotice(null);
    // Deliberately NO isProActive gate here. Pasting is the only ingestion
    // path an iPhone has without a Shortcut, so paywalling it charged an
    // iPhone user for the privilege of doing the work by hand that an Android
    // user gets automatically. Pasting is `manual` capture, and
    // requiresPro('manual') is false on every platform by design.
    const parsed: ScannedSms[] = parseSmsBatch(input, state.merchantOverrides);
    const p = buildImportPlan(parsed, state, state.lastScanTs);
    const txLike = parsed.filter((x) => x.kind === 'transaction' || x.kind === 'cardPayment');
    const skipped = Math.max(0, txLike.length - p.txCount);
    setSkippedCount(skipped);
    setTrackedBills(new Set());
    // A plan with nothing in it is not a plan, and rendering one as if it were
    // is how an unreadable paste dead-ended: a strip reading "0 matched ·
    // 0 cards · 0 unread", no preview, no footer button, no explanation — and
    // <SupplementImports /> gone, because that block is gated on `plan ===
    // null`. The relay, forwarded-email and PDF routes disappeared at the
    // exact moment they were the only thing left to offer. The scan path has
    // said "up to date" on an empty result for a long time; the paste path
    // needs the same courtesy, and one more verdict than the scan has: a
    // message the parser could make nothing of is not a message already filed.
    if (p.txCount === 0 && p.dueCount === 0 && p.billDues.length === 0 && p.healedCount === 0) {
      setPlan(null);
      setPasteVerdict(
        skipped > 0
          ? { kind: 'filed', count: skipped }
          : { kind: 'unreadable', count: messageBlocks(input) },
      );
      return;
    }
    setPasteVerdict(null);
    setPlan(p);
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
    if (/^\d+$/.test(ref)) return plan?.batch.newAccounts[Number(ref)]?.name ?? t('newCard');
    return state.accounts.find((a) => a.id === ref)?.name ?? '';
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.headerWrap}>
          {/* The title has to describe what this screen can actually do on the
              phone it is running on: iOS gives no app access to Messages, so
              "Read my inbox" named something the screen cannot do there. This
              key is deliberately platform-neutral rather than branched on
              Platform.OS — it is true on both, and it has an Arabic value. */}
          <ScreenHeader title={t('importBankActivity')} onBack={() => router.back()} />
        </View>

        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: keyboardHeight + Spacing.six }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {scanning ? (
            <Section index={0} style={styles.scanning}>
              <ScanPanel />
              <View style={styles.progressHead}>
                <View style={styles.progressLabel}>
                  <PulseDot color={theme.primary} />
                  <ThemedText type="micro" themeColor="textTertiary">
                    {t('importProgress')}
                  </ThemedText>
                </View>
                <ThemedText type="small" tabular>
                  {tf('importProgressCounts', {
                    read: progress?.scanned ?? 0,
                    matched: progress?.found ?? 0,
                  })}
                </ThemedText>
              </View>
              <ThemedText type="meta" themeColor="textTertiary">
                {t('importProgressPrivacy')}
              </ThemedText>
            </Section>
          ) : (
            <Section index={0} style={styles.intro}>
              <ThemedText type="default" themeColor="textSecondary">
                {isSmsScanningAvailable()
                  ? t('scanBankAlertsPrivacy')
                  : t('pasteHint')}
              </ThemedText>
              {/* THE PLATFORM-FAIR LINE. Pasting used to sit behind the
                  paywall, which on a phone with no inbox scan meant an iPhone
                  user paid to do by hand exactly what an Android user got for
                  free and automatically. runParse() no longer gates, and the
                  screen has to SAY so on the platform where pasting is the
                  only path — otherwise the wall is gone and nobody knows.
                  Same key as the paywall's own row, so the two can never
                  disagree about what is free. */}
              {!isSmsScanningAvailable() && (
                <ThemedText type="meta" themeColor="textTertiary">
                  {t('featPasteFreeText')}
                </ThemedText>
              )}
              {isSmsScanningAvailable() && (
                <>
                  <Button label={t('findBankAlerts')} icon="search" onPress={runScan} />
                  <Button
                    label={showManual ? t('hideManualPaste') : t('pasteInstead')}
                    variant="ghost"
                    onPress={() => setShowManual((value) => !value)}
                  />
                </>
              )}
              {showManual && (
                <>
                  <TextInput
                    accessibilityLabel={t('pasteBankMessagesA11y')}
                    value={text}
                    // A verdict is about the text that produced it. Editing
                    // the box makes it stale, so it goes when the text does.
                    onChangeText={(value) => {
                      setText(value);
                      setPasteVerdict(null);
                      setNotice(null);
                    }}
                    multiline
                    placeholder={t('bankMessageExample')}
                    placeholderTextColor={theme.textTertiary}
                    style={[
                      styles.textarea,
                      {
                        backgroundColor: theme.backgroundElement,
                        borderColor: theme.cardBorder,
                        color: theme.text,
                        textAlign: state.language === 'ar' ? 'right' : 'left',
                      },
                    ]}
                  />
                  <View style={styles.parseRow}>
                    <Button
                      inline
                      variant="outline"
                      label={t('parsePastedText')}
                      onPress={() => runParse(text)}
                      disabled={!text.trim()}
                    />
                    <Button
                      inline
                      variant="ghost"
                      label={t('trySample')}
                      onPress={() => {
                        setText(SAMPLE);
                        runParse(SAMPLE);
                      }}
                    />
                  </View>
                </>
              )}
              {/* B's screen ended with a "Stop pasting" card linking to the
                  iPhone setup wizard. Deliberately not carried across: the
                  same job is done below by <SupplementImports />, which offers
                  the relay, forwarded email and PDF paths through a translated
                  copy layer, and the card's two sentences exist in no i18n key
                  (contracts.test.js bans an English literal here). If it comes
                  back it needs t() keys with ar: values, and its href is
                  /ios-setup — iphone-setup.tsx was the losing filename and is
                  gone. */}
            </Section>
          )}

          {/* The answer to a tap that could not do what it offered. It sits
              above the plan because it is the reason the plan is empty, or the
              reason there is no plan at all. */}
          {notice !== null && !scanning && (
            <Section index={1}>
              <View accessibilityLiveRegion="polite">
                <Block>
                  <View style={styles.unreadRow}>
                    <Icon name="alert" size={17} color={theme.warning} />
                    <View style={styles.rowText}>
                      <ThemedText type="small">{notice.title}</ThemedText>
                      <ThemedText type="meta" themeColor="textTertiary">
                        {notice.body}
                      </ThemedText>
                    </View>
                  </View>
                </Block>
              </View>
            </Section>
          )}

          {plan !== null && !scanning && (
            <>
              <Section index={1}>
                <View style={[styles.stats, { borderColor: theme.cardBorder }]}>
                  {(
                    [
                      [plan.txCount, t('matchedLabel'), theme.text],
                      [plan.newAccountCount, t('cardsTitle'), theme.text],
                      [unreadCount, t('unreadLabel'), unreadCount > 0 ? theme.warning : theme.textTertiary],
                    ] as const
                  ).map(([value, label, color], i) => (
                    <View
                      key={label}
                      style={[
                        styles.statCell,
                        i > 0 && { borderStartWidth: 1, borderStartColor: theme.cardBorder },
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
                    {skippedCount} {t('alreadyFiledSkipped')}
                  </ThemedText>
                )}
                {plan.healedCount > 0 && (
                  <ThemedText type="meta" style={{ color: theme.income }}>
                    {tf('improvedExistingEntries', {
                      count: plan.healedCount,
                      ending: plan.healedCount === 1 ? 'y' : 'ies',
                    })}
                  </ThemedText>
                )}
              </Section>

              {newBills.length > 0 && (
                <Section index={2}>
                  <SectionHeader title={t('billRemindersDetected')} />
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
                            {categoryLabel(p.categoryGuess)}
                            {p.dueDay ? ` · ${tf('dueDay', { day: p.dueDay })}` : ''}
                          </ThemedText>
                        </View>
                        <Button
                          variant={tracked ? 'ghost' : 'outline'}
                          label={tracked ? t('tracked') : t('track')}
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
                        ? tf('justFiledFirst', { shown: PREVIEW_LIMIT, total: plan.txCount })
                        : t('justFiled')
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
                            {categoryLabel(tx.category)} · {shortDate(tx.date)}
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
                          {tf('unknownMessageFormats', {
                            count: unreadCount,
                            s: unreadCount === 1 ? '' : 's',
                          })}
                        </ThemedText>
                        <ThemedText type="meta" themeColor="textTertiary">
                          {t('shareMaskedFormatsHint')}
                        </ThemedText>
                      </View>
                      <Icon name="chevron-right" size={15} color={theme.textTertiary} />
                    </View>
                  </Block>
                </Section>
              )}
            </>
          )}

          {/* The answer to a paste that filed nothing. It sits ABOVE the
              alternative routes and leaves them on screen, because "we cannot
              read this one" and "here are the other ways in" are one thought. */}
          {pasteVerdict !== null && !scanning && (
            <Section index={1}>
              <Block>
                <View style={styles.unreadRow}>
                  <Icon
                    name="alert"
                    size={17}
                    color={pasteVerdict.kind === 'filed' ? theme.textTertiary : theme.warning}
                  />
                  <View style={styles.rowText}>
                    <ThemedText type="small">
                      {pasteVerdict.kind === 'filed'
                        ? t('upToDate')
                        : tf('unknownMessageFormats', {
                            count: pasteVerdict.count,
                            s: pasteVerdict.count === 1 ? '' : 's',
                          })}
                    </ThemedText>
                    <ThemedText type="meta" themeColor="textTertiary">
                      {pasteVerdict.kind === 'filed'
                        ? `${pasteVerdict.count} ${t('alreadyFiledSkipped')}`
                        : t('pasteHint')}
                    </ThemedText>
                  </View>
                </View>
              </Block>
            </Section>
          )}

          {!scanning && plan === null && (
            <Section index={2}>
              <SupplementImports />
            </Section>
          )}
        </ScrollView>

        {plan !== null && !scanning && (plan.txCount > 0 || plan.dueCount > 0 || plan.healedCount > 0) && (
          <View style={styles.footer}>
            {/* The button appears for dues and healed rows too, so labelling
                it from txCount alone offered to "File 0 entries" after a scan
                that found only statement reminders. Name what is actually
                about to be filed. */}
            <Button
              label={
                plan.txCount > 0
                  ? tf('fileEntries', {
                      count: plan.txCount,
                      ending: plan.txCount === 1 ? 'y' : 'ies',
                    })
                  : plan.dueCount > 0
                    ? tf('fileCardDues', {
                        count: plan.dueCount,
                        s: plan.dueCount === 1 ? '' : 's',
                      })
                    : tf('fixEntries', {
                        count: plan.healedCount,
                        ending: plan.healedCount === 1 ? 'y' : 'ies',
                      })
              }
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
