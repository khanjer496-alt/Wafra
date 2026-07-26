import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
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
import { formatAED, shortDate } from '@/lib/format';
import { isProActive } from '@/lib/purchases';
import { parseSmsBatch } from '@/lib/sms-parser';
import { useStore } from '@/lib/store';

const SAMPLE = `Purchase of AED 187.50 with Debit Card ending 1234 at CARREFOUR MALL OF EMIRATES, DUBAI on 17/07/2026. Avl balance AED 12,345.67

AED 55.00 was debited from your account for payment to SALIK RECHARGE on 16/07/2026

Salary of AED 18,500.00 has been credited to your account ending 5678`;

const PREVIEW_LIMIT = 60;

/**
 * Manual import runs the SAME pipeline as the automatic one on Home:
 * scanInbox → buildImportPlan → importBatch. Cards are attributed by their
 * last4, duplicates are skipped by message fingerprint, statements become
 * dues. This screen just makes the plan visible before applying it.
 */
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
          'Wafra needs SMS access to scan bank alerts. You can also paste messages manually below.',
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
        Alert.alert('Up to date', 'Everything in your inbox is already imported.');
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
    if (auto === '1' && isSmsScanningAvailable()) {
      runScan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Preview account name: index refs point into the plan's new accounts.
  const accountName = (ref: string): string => {
    if (/^\d+$/.test(ref)) return plan?.batch.newAccounts[Number(ref)]?.name ?? 'New card';
    return state.accounts.find((a) => a.id === ref)?.name ?? '';
  };

  const previewRows = useMemo(
    () => (plan?.batch.transactions ?? []).slice(0, PREVIEW_LIMIT),
    [plan],
  );
  const newBills = useMemo(() => {
    const existing = new Set(state.bills.map((b) => b.title.toLowerCase()));
    return (plan?.billDues ?? []).filter((p) => !existing.has(p.merchant.toLowerCase()));
  }, [plan, state.bills]);

  const header = (
    <View style={styles.headerContent}>
      <ThemedText type="small" themeColor="textSecondary">
        {isSmsScanningAvailable()
          ? 'Rescans your whole inbox and shows what would be added. Cards are matched automatically and nothing imports twice. You can also paste messages below.'
          : 'Paste one or more bank alert messages below (separate messages with a blank line). Everything is processed on this device.'}
      </ThemedText>

      {isSmsScanningAvailable() && (
        <Pressable
          onPress={runScan}
          disabled={scanning}
          style={[styles.scanBtn, { backgroundColor: theme.primary, opacity: scanning ? 0.6 : 1 }]}>
          <Icon name="search" size={19} color={theme.onPrimary} strokeWidth={2.4} />
          <ThemedText type="smallBold" style={{ color: theme.onPrimary, fontSize: 15 }}>
            {scanning
              ? progress
                ? `Scanning… ${progress.scanned} messages · ${progress.found} found`
                : 'Scanning inbox…'
              : 'Scan full inbox'}
          </ThemedText>
        </Pressable>
      )}

      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        placeholder={'Purchase of AED 187.50 with Debit Card ending 1234 at CARREFOUR…'}
        placeholderTextColor={theme.textSecondary}
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
        <Pressable
          onPress={() => runParse(text)}
          disabled={!text.trim()}
          style={[
            styles.parseBtn,
            { backgroundColor: theme.backgroundSelected, opacity: text.trim() ? 1 : 0.5 },
          ]}>
          <ThemedText type="smallBold">Parse pasted text</ThemedText>
        </Pressable>
        <Pressable
          onPress={() => {
            setText(SAMPLE);
            runParse(SAMPLE);
          }}
          style={[styles.sampleBtn, { borderColor: theme.cardBorder }]}>
          <ThemedText type="small" themeColor="textSecondary">
            Try sample
          </ThemedText>
        </Pressable>
      </View>

      {plan !== null && (
        <Card style={styles.summaryCard}>
          <View style={styles.summaryLine}>
            <ThemedText type="smallBold" tabular>
              {plan.txCount}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              new transaction{plan.txCount === 1 ? '' : 's'}
            </ThemedText>
          </View>
          {plan.newAccountCount > 0 && (
            <View style={styles.summaryLine}>
              <ThemedText type="smallBold" tabular>
                {plan.newAccountCount}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                new card{plan.newAccountCount === 1 ? '' : 's'} discovered
              </ThemedText>
            </View>
          )}
          {plan.dueCount > 0 && (
            <View style={styles.summaryLine}>
              <ThemedText type="smallBold" tabular>
                {plan.dueCount}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                credit-card due{plan.dueCount === 1 ? '' : 's'}
              </ThemedText>
            </View>
          )}
          {plan.healedCount > 0 && (
            <View style={styles.summaryLine}>
              <ThemedText type="smallBold" tabular style={{ color: theme.income }}>
                {plan.healedCount}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                existing row{plan.healedCount === 1 ? '' : 's'} re-read better (renamed / recategorized)
              </ThemedText>
            </View>
          )}
          {skippedCount > 0 && (
            <View style={styles.summaryLine}>
              <ThemedText type="smallBold" tabular>
                {skippedCount}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                already imported · skipped
              </ThemedText>
            </View>
          )}
          {plan.txCount === 0 && plan.dueCount === 0 && plan.healedCount === 0 && (
            <ThemedText type="small" themeColor="textSecondary">
              Nothing new to add.
            </ThemedText>
          )}
        </Card>
      )}

      {newBills.length > 0 && (
        <View style={styles.fieldBlock}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <Icon name="calendar" size={15} color={theme.gold} />
            <ThemedText type="smallBold">Bill reminders detected</ThemedText>
          </View>
          {newBills.map((p, i) => {
            const meta = getCategory(p.categoryGuess);
            const tracked = trackedBills.has(i);
            return (
              <Card key={`bill-${i}`} style={styles.previewCard}>
                <MerchantAvatar title={p.merchant} category={p.categoryGuess} size={40} />
                <View style={styles.previewInfo}>
                  <ThemedText type="smallBold" numberOfLines={1}>
                    {p.merchant}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {meta.label} · {formatAED(p.amountFils, { decimals: false })}
                    {p.dueDay ? ` · due day ${p.dueDay}` : ''}
                  </ThemedText>
                </View>
                <Pressable
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
                  style={[
                    styles.trackBtn,
                    { backgroundColor: tracked ? `${theme.income}22` : `${theme.gold}22` },
                  ]}>
                  <ThemedText
                    type="small"
                    style={{ color: tracked ? theme.income : theme.gold, fontWeight: '700' }}>
                    {tracked ? '✓ Tracked' : 'Track'}
                  </ThemedText>
                </Pressable>
              </Card>
            );
          })}
        </View>
      )}

      {previewRows.length > 0 && (
        <ThemedText type="micro" themeColor="textSecondary">
          {plan && plan.txCount > PREVIEW_LIMIT
            ? `Preview of the first ${PREVIEW_LIMIT} of ${plan.txCount}`
            : 'What will be added'}
        </ThemedText>
      )}
    </View>
  );

  const renderRow = ({
    item: t,
    index: i,
  }: {
    item: NonNullable<typeof plan>['batch']['transactions'][number];
    index: number;
  }) => {
    const meta = getCategory(t.category);
    return (
      <View style={styles.rowWrap}>
        <Card style={styles.previewCard}>
          <MerchantAvatar title={t.title} category={t.category} size={40} />
          <View style={styles.previewInfo}>
            <ThemedText type="smallBold" numberOfLines={1}>
              {t.title}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {meta.label} · {shortDate(t.date)}
              {accountName(t.accountId) ? ` · ${accountName(t.accountId)}` : ''}
            </ThemedText>
          </View>
          <ThemedText
            type="smallBold"
            tabular
            style={{ color: t.type === 'income' ? theme.income : theme.text }}>
            {t.type === 'income' ? '+' : '−'}
            {formatAED(t.amountFils, { decimals: false })}
          </ThemedText>
        </Card>
      </View>
    );
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.header}>
            <Pressable
              onPress={() => router.back()}
              style={[styles.backBtn, { backgroundColor: theme.backgroundSelected }]}>
              <Icon name="chevron-left" size={18} color={theme.text} />
            </Pressable>
            <ThemedText type="smallBold" style={styles.headerTitle}>
              Import from SMS
            </ThemedText>
            <View style={styles.backBtn} />
          </View>

          <FlatList
            data={previewRows}
            keyExtractor={(_, i) => String(i)}
            renderItem={renderRow}
            ListHeaderComponent={header}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            initialNumToRender={12}
            maxToRenderPerBatch={16}
            windowSize={7}
          />

          {plan !== null && (plan.txCount > 0 || plan.dueCount > 0 || plan.healedCount > 0) && (
            <View style={styles.footer}>
              <Pressable
                onPress={applyPlan}
                style={[styles.importBtn, { backgroundColor: theme.primary }]}>
                <Icon name="check" size={20} color={theme.onPrimary} strokeWidth={2.6} />
                <ThemedText type="smallBold" style={{ color: theme.onPrimary, fontSize: 16 }}>
                  {plan.txCount > 0 || plan.dueCount > 0
                    ? `Import ${plan.txCount} transaction${plan.txCount === 1 ? '' : 's'}` +
                      (plan.dueCount > 0 ? ` + ${plan.dueCount} due${plan.dueCount === 1 ? '' : 's'}` : '') +
                      (plan.healedCount > 0 ? ` · fix ${plan.healedCount}` : '')
                    : `Fix ${plan.healedCount} existing row${plan.healedCount === 1 ? '' : 's'}`}
                </ThemedText>
              </Pressable>
            </View>
          )}
        </KeyboardAvoidingView>
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
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  headerTitle: {
    fontSize: 16,
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
    paddingTop: 0,
  },
  headerContent: {
    gap: Spacing.three,
    paddingBottom: Spacing.two,
  },
  scanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderRadius: Radius.md,
    paddingVertical: Spacing.three,
  },
  textarea: {
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    minHeight: 110,
    fontSize: 14,
    lineHeight: 20,
    textAlignVertical: 'top',
  },
  parseRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'center',
  },
  parseBtn: {
    borderRadius: Radius.md,
    paddingVertical: Spacing.two + 4,
    paddingHorizontal: Spacing.three,
  },
  sampleBtn: {
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingVertical: Spacing.two + 4,
    paddingHorizontal: Spacing.three,
  },
  summaryCard: {
    gap: Spacing.one,
  },
  summaryLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.two,
  },
  fieldBlock: {
    gap: Spacing.two,
  },
  rowWrap: {
    marginBottom: Spacing.two,
  },
  previewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    paddingVertical: Spacing.two + 4,
  },
  previewInfo: {
    flex: 1,
    gap: 1,
  },
  trackBtn: {
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.one + 1,
    borderRadius: Radius.full,
  },
  footer: {
    padding: Spacing.three,
  },
  importBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderRadius: Radius.md + 2,
    paddingVertical: Spacing.three + 2,
  },
});
