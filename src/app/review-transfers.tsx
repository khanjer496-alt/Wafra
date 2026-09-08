import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/controls';
import { ScreenScaffold, useScreenContentInsets } from '@/components/ui/screen-scaffold';
import { useToast } from '@/components/ui/toast';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { formatAED, fullDateTime } from '@/lib/format';
import { bankBrandForName } from '@/lib/markets';
import { useStore } from '@/lib/store';
import { reconcileTransfers, transferFingerprint } from '@/lib/transfer-reconciliation';
import { transferReviewCopy } from '@/lib/transfer-review-copy';
import type { Transaction } from '@/lib/types';

type Group = ReturnType<typeof reconcileTransfers>['groups'][number];
type Words = ReturnType<typeof transferReviewCopy>;
type Ownership = 'own' | 'external' | null;
type Summary = {
  account: string;
  counterparty: string;
  direction: 'income' | 'expense';
  total: number;
  count: number;
  dates: string;
};
type DisplayGroup = Group & { rows: Transaction[]; summary: Summary };
type ListItem =
  | { kind: 'group'; key: string; group: DisplayGroup }
  | { kind: 'entry'; key: string; group: DisplayGroup; transaction: Transaction };
type Selection = {
  ids: string[];
  expectedFingerprints: Record<string, string>;
  expectedGeneration: number;
  summary: Summary;
  ownership: Ownership | undefined;
  undo: boolean;
};

function counterpartLabel(counterparty: Group['counterparty'], words: Words): string {
  if (!counterparty) return words.counterpartyUnknown;
  const instrument = counterparty.kind === 'credit' || counterparty.kind === 'debit'
    ? words.cardEnding(counterparty.last4)
    : words.accountEnding(counterparty.last4);
  const bank = counterparty.bankIdentity ? bankBrandForName(counterparty.bankIdentity)?.name ?? counterparty.bankIdentity : undefined;
  return [bank, instrument].filter(Boolean).join(' · ');
}

function statusLabel(status: Group['status'], words: Words): string {
  if (status === 'confirmed-own') return words.confirmedOwn;
  if (status === 'confirmed-external') return words.confirmedExternal;
  if (status === 'counterpart-missing') return words.counterpartMissing;
  if (status === 'ambiguous') return words.ambiguous;
  return words.ownershipUnknown;
}

function summarize(rows: Transaction[], account: string, counterparty: string): Summary {
  const ordered = [...rows].sort((a, b) => a.date.localeCompare(b.date) || (a.ts ?? 0) - (b.ts ?? 0));
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  return {
    account, counterparty, direction: first.type,
    total: rows.reduce((sum, row) => sum + row.amountFils, 0), count: rows.length,
    dates: first.id === last.id ? fullDateTime(first) : `${fullDateTime(first)} – ${fullDateTime(last)}`,
  };
}

function SummaryFacts({ summary, words }: { summary: Summary; words: Words }) {
  return <View style={styles.facts}>
    <ThemedText type="smallBold" selectable>{summary.account}</ThemedText>
    <ThemedText type="small" selectable>{summary.counterparty}</ThemedText>
    <ThemedText type="meta" themeColor="textSecondary" selectable>{words.count(summary.count)} · {summary.dates}</ThemedText>
    <ThemedText type="smallBold" tabular selectable>
      {summary.direction === 'income' ? words.moneyIn : words.moneyOut}: {formatAED(summary.total, { decimals: true })}
    </ThemedText>
  </View>;
}

export default function ReviewTransfersScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ transactionId?: string | string[] }>();
  const transactionId = Array.isArray(params.transactionId) ? params.transactionId[0] : params.transactionId;
  const theme = useTheme();
  const words = transferReviewCopy(useLanguage());
  const toast = useToast();
  const { state, resolveTransfers, getStateGeneration, getStateSnapshot, ensureDurable } = useStore();
  const [filter, setFilter] = useState<'pending' | 'reviewed'>(() =>
    transactionId && !reconcileTransfers(state.transactions, state.accounts).pendingIds.has(transactionId) ? 'reviewed' : 'pending');
  const [showAll, setShowAll] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsDurability, setNeedsDurability] = useState(false);
  const saving = useRef(false);
  const insets = useScreenContentInsets({ hasFooter: false });
  const reconciliation = useMemo(() => reconcileTransfers(state.transactions, state.accounts), [state.transactions, state.accounts]);
  const transactionsById = useMemo(() => new Map(state.transactions.map((row) => [row.id, row])), [state.transactions]);
  const accountsById = useMemo(() => new Map(state.accounts.map((account) => [account.id, account])), [state.accounts]);
  const focusedId = showAll ? undefined : transactionId;
  const groups = useMemo(() => {
    const candidates: Group[] = filter === 'pending' ? reconciliation.groups : state.transactions
      .filter((row) => row.transferDecision || (reconciliation.byId.has(row.id) && !reconciliation.pendingIds.has(row.id)))
      .sort((a, b) => (b.transferDecision?.decidedAt ?? b.ts ?? 0) - (a.transferDecision?.decidedAt ?? a.ts ?? 0))
      .map((row) => ({
        id: `reviewed:${row.id}`, transactionIds: [row.id], accountId: row.accountId, direction: row.type,
        status: reconciliation.byId.get(row.id)?.status ?? (row.transferDecision?.ownership === 'own' ? 'confirmed-own' : 'confirmed-external'),
        counterparty: row.transferEvidence?.counterparty, bulkEligible: false,
      }));
    return candidates.filter((group) => !focusedId || group.transactionIds.includes(focusedId)).flatMap((group) => {
      const rows = group.transactionIds.flatMap((id) => {
        const row = transactionsById.get(id);
        return row ? [row] : [];
      });
      if (!rows.length) return [];
      const account = accountsById.get(group.accountId);
      const accountName = account ? [account.name, account.last4 ? `••${account.last4}` : null].filter(Boolean).join(' · ') : words.accountUnknown;
      return [{ ...group, rows, summary: summarize(rows, accountName, counterpartLabel(group.counterparty, words)) }];
    });
  }, [filter, reconciliation, state.transactions, focusedId, transactionsById, accountsById, words]);
  const listItems = useMemo<ListItem[]>(() => groups.flatMap((group) => [
    { kind: 'group' as const, key: `group:${group.id}`, group },
    ...group.rows.map((transaction) => ({ kind: 'entry' as const, key: `entry:${group.id}:${transaction.id}`, group, transaction })),
  ]), [groups]);
  const stale = !!selection && (
    getStateGeneration() !== selection.expectedGeneration || Object.entries(selection.expectedFingerprints).some(([id, expected]) => {
      const current = transactionsById.get(id);
      return !current || transferFingerprint(current) !== expected;
    })
  );

  const openReview = (group: DisplayGroup, row?: Transaction) => {
    if (saving.current || (!row && !group.bulkEligible)) return;
    const rows = row ? [row] : group.rows;
    // Freeze exactly what the person is about to see. Reconciliation may change
    // while the panel is open; the store rechecks these fingerprints at save.
    setSelection({
      ids: rows.map((entry) => entry.id),
      expectedFingerprints: Object.fromEntries(rows.map((entry) => [entry.id, transferFingerprint(entry)])),
      expectedGeneration: getStateGeneration(),
      summary: row ? summarize(rows, group.summary.account, group.summary.counterparty) : group.summary,
      ownership: row?.transferDecision ? null : undefined, undo: !!row?.transferDecision,
    });
    setError(null);
    setNeedsDurability(false);
  };

  const closeReview = () => {
    if (saving.current || (needsDurability && !stale)) return;
    setSelection(null);
    setError(null);
    setNeedsDurability(false);
  };

  const save = async () => {
    if (!selection || selection.ownership === undefined || saving.current || stale) return;
    // A retry does not enter the resolver again. Check its post-decision
    // fingerprints against authoritative state, even before React re-renders.
    const latest = new Map(getStateSnapshot().transactions.map((row) => [row.id, row]));
    if (getStateGeneration() !== selection.expectedGeneration ||
      Object.entries(selection.expectedFingerprints).some(([id, expected]) => {
        const current = latest.get(id);
        return !current || transferFingerprint(current) !== expected;
      })) {
      setError(words.changed);
      return;
    }
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      if (needsDurability) await ensureDurable();
      else await resolveTransfers({ ids: selection.ids, ownership: selection.ownership,
        expectedFingerprints: selection.expectedFingerprints, expectedGeneration: selection.expectedGeneration });
      toast.show(selection.undo ? words.undone : words.saved, { tone: 'success' });
      setSelection(null);
      setNeedsDurability(false);
      setFilter(selection.undo ? 'pending' : 'reviewed');
    } catch (failure) {
      const details = typeof failure === 'object' && failure !== null ? failure : {};
      const code = 'code' in details ? details.code : undefined;
      if (code === 'transfer-durability') {
        const fingerprints = 'expectedFingerprints' in details ? details.expectedFingerprints : undefined;
        if (fingerprints && typeof fingerprints === 'object' && !Array.isArray(fingerprints) &&
          Object.values(fingerprints).every((value) => typeof value === 'string') &&
          selection.ids.every((id) => id in fingerprints)) {
          setSelection({ ...selection, expectedFingerprints: fingerprints as Record<string, string> });
        }
        setNeedsDurability(true);
      }
      setError(code === 'transfer-durability' || needsDurability ? words.durabilityFailed : words.saveFailed);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  return <>
    <ScreenScaffold scroll={false} virtualized headerMode="native"
      header={{ title: words.title, back: { label: words.back, onPress: () => router.back() } }}>
      <FlatList data={listItems} keyExtractor={(item) => item.key}
        contentContainerStyle={insets.contentContainerStyle} contentInset={insets.contentInset}
        scrollIndicatorInsets={insets.scrollIndicatorInsets} contentInsetAdjustmentBehavior="automatic"
        ListHeaderComponent={<View style={styles.intro}>
          <View style={styles.filters} accessibilityRole="tablist">
            {(['pending', 'reviewed'] as const).map((value) => <Pressable key={value}
              testID={`transfer-filter-${value}`} accessibilityRole="tab" accessibilityState={{ selected: filter === value }}
              accessibilityLabel={words[value]} onPress={() => setFilter(value)}
              style={[styles.filter, { borderColor: filter === value ? theme.primary : theme.cardBorder }]}>
              <ThemedText type="smallBold">{words[value]}</ThemedText>
            </Pressable>)}
          </View>
          <ThemedText type="small" themeColor="textSecondary">{filter === 'pending' ? words.intro : words.reviewedIntro}</ThemedText>
          {focusedId ? <Button variant="ghost" label={words.showAll} onPress={() => setShowAll(true)} /> : null}
        </View>}
        ListEmptyComponent={<View style={styles.empty}>
          <ThemedText type="subtitle" accessibilityRole="header">{focusedId ? transactionsById.has(focusedId) ? words.notPending : words.missingRoute : filter === 'pending' ? words.empty : words.reviewedEmpty}</ThemedText>
          {focusedId && reconciliation.byId.get(focusedId) ? <ThemedText type="small" themeColor="textSecondary">{statusLabel(reconciliation.byId.get(focusedId)!.status, words)}</ThemedText> : null}
          {!focusedId ? <ThemedText type="small" themeColor="textSecondary">{filter === 'pending' ? words.emptyBody : words.reviewedEmptyBody}</ThemedText> : null}
        </View>}
        renderItem={({ item }) => item.kind === 'group' ? <View testID="transfer-review-group"
          style={[styles.group, { borderTopColor: theme.cardBorder }]}>
          <SummaryFacts summary={item.group.summary} words={words} />
          <ThemedText type="meta" themeColor="textSecondary">{statusLabel(item.group.status, words)}</ThemedText>
          {filter === 'pending' && item.group.bulkEligible && item.group.rows.length > 1
            ? <Button variant="outline" wrapLabel label={words.reviewGroup(item.group.rows.length)} onPress={() => openReview(item.group)} />
            : filter === 'pending' && item.group.rows.length > 1
              ? <ThemedText type="meta" themeColor="textSecondary">{words.individualOnly}</ThemedText> : null}
        </View> : <Pressable testID="transfer-review-entry" accessibilityRole="button"
          accessibilityLabel={`${item.transaction.transferDecision ? words.undo : words.review}. ${item.transaction.title}. ${fullDateTime(item.transaction)}. ${formatAED(item.transaction.amountFils, { decimals: true })}`}
          onPress={() => openReview(item.group, item.transaction)} style={[styles.entry, { borderColor: theme.cardBorder }]}>
          <ThemedText type="small" selectable>{item.transaction.title}</ThemedText>
          <ThemedText type="meta" themeColor="textSecondary" selectable>{fullDateTime(item.transaction)}</ThemedText>
          <ThemedText type="smallBold" tabular>{formatAED(item.transaction.amountFils, { decimals: true })}</ThemedText>
          <ThemedText type="smallBold" style={{ color: theme.primary }}>{item.transaction.transferDecision ? words.undo : words.review}</ThemedText>
        </Pressable>}
      />
    </ScreenScaffold>
    {selection ? <BottomSheet visible title={selection.undo ? words.undo : words.title}
      testID="transfer-review-confirmation" onClose={closeReview} dismissible={!busy && (!needsDurability || stale)}
      footer={<View style={styles.actions}>
        <Button wrapLabel label={busy ? words.saving : needsDurability ? words.retrySave : selection.undo ? words.undo : words.confirm}
          disabled={busy || stale || selection.ownership === undefined} onPress={() => void save()} />
        <Button variant="ghost" label={words.cancel} disabled={busy || (needsDurability && !stale)} onPress={closeReview} />
      </View>}>
      <ThemedText type="subtitle" accessibilityRole="header">{selection.undo ? words.undoTitle : selection.ids.length > 1 ? words.groupChoose : words.choose}</ThemedText>
      <SummaryFacts summary={selection.summary} words={words} />
      {selection.ids.length > 1 ? <ThemedText type="small" themeColor="textSecondary">{words.groupHint}</ThemedText> : null}
      {selection.undo ? <ThemedText type="small">{words.undoBody}</ThemedText> : <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel={words.choose}>
        {(['own', 'external'] as const).map((ownership) => {
          const incoming = selection.summary.direction === 'income';
          const label = ownership === 'own' ? words.own : incoming ? words.externalIn : words.externalOut;
          const detail = ownership === 'own' ? words.ownBody : incoming ? words.externalInBody : words.externalOutBody;
          return <Pressable key={ownership} testID={`transfer-choice-${ownership}`} accessibilityRole="radio"
            accessibilityLabel={label} accessibilityHint={detail}
            accessibilityState={{ checked: selection.ownership === ownership, disabled: busy || needsDurability }}
            disabled={busy || needsDurability}
            onPress={() => setSelection({ ...selection, ownership })}
            style={[styles.choice, { borderColor: selection.ownership === ownership ? theme.primary : theme.cardBorder }]}>
            <ThemedText type="smallBold">{label}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{detail}</ThemedText>
          </Pressable>;
        })}
      </View>}
      {stale || error ? <ThemedText testID="transfer-review-error" type="small" themeColor="expense" accessibilityRole="alert" accessibilityLiveRegion="polite" selectable>{stale ? words.changed : error}</ThemedText> : null}
    </BottomSheet> : null}
  </>;
}

const styles = StyleSheet.create({
  intro: { gap: Spacing.three, paddingBottom: Spacing.three },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  filter: { minHeight: 48, justifyContent: 'center', paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderBottomWidth: 2 },
  facts: { gap: Spacing.one },
  group: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.four, paddingBottom: Spacing.two, gap: Spacing.two },
  entry: { minHeight: 48, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: Spacing.three, gap: Spacing.one },
  empty: { paddingVertical: Spacing.six, gap: Spacing.two },
  actions: { gap: Spacing.two },
  choices: { gap: Spacing.two },
  choice: { minHeight: 48, padding: Spacing.three, borderWidth: 1, gap: Spacing.one },
});
