import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useDeferredValue, useMemo, useRef, useState } from 'react';
import { FlatList, Keyboard, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { TextField } from '@/components/ui/text-field';
import { ScreenScaffold, useScreenContentInsets } from '@/components/ui/screen-scaffold';
import { useToast } from '@/components/ui/toast';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { formatAED, fullDateTime, shortDate, toISODate } from '@/lib/format';
import { bankBrandForName } from '@/lib/markets';
import { formatMinorUnits } from '@/lib/ledger-money';
import { useStore } from '@/lib/store';
import { detailsWords } from '@/lib/details-copy';
import { suggestedTransferPairs, type TransferPair } from '@/lib/transfer-pairs';
import { isTransferCandidate, reconcileTransfers, transferFingerprint } from '@/lib/transfer-reconciliation';
import { transferReviewCopy } from '@/lib/transfer-review-copy';
import { indexTransferHistory, projectTransferHistory, transferAccountLabel, transferHistoryItems, TRANSFER_HISTORY_PAGE_SIZE,
  type TransferHistoryScope, type TransferHistoryItem } from '@/lib/transfer-review-presentation';
import type { Transaction } from '@/lib/types';

type Group = ReturnType<typeof reconcileTransfers>['groups'][number];
const unresolvedStatuses = new Set<Group['status']>(['ownership-unknown', 'ambiguous', 'likely-own', 'likely-card-repayment']);
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
type ListItem = TransferHistoryItem<DisplayGroup>;
type Selection = {
  ids: string[];
  expectedFingerprints: Record<string, string>;
  expectedGeneration: number;
  summary: Summary;
  ownership: Ownership | undefined;
  undo: boolean;
  record?: { title: string; reference?: string; source: string };
  counterpart?: { id: string; title: string; account: string; date: string; amount: number; linkable: boolean };
  status?: Group['status'];
  ownershipExplanation?: string;
  readOnly?: boolean;
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
  if (status === 'card-repayment') return words.cardRepayment;
  if (status === 'corroborating-alert') return words.corroborating;
  if (status === 'likely-own') return words.likelyOwn;
  if (status === 'likely-card-repayment') return words.likelyCard;
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

function PairLeg({ label, account, when, amount, direction }: {
  label: string; account: string; when: string; amount: string; direction: 'out' | 'in';
}) {
  const theme = useTheme();
  return <View style={styles.leg}>
    <Icon name={direction === 'out' ? 'arrow-up-right' : 'arrow-down-right'} size={18}
      color={direction === 'out' ? theme.textSecondary : theme.income} />
    <View style={styles.flexText}>
      <ThemedText type="meta" themeColor="textSecondary">{label} · {when}</ThemedText>
      <ThemedText type="smallBold" numberOfLines={2}>{account}</ThemedText>
    </View>
    <ThemedText type="smallBold" tabular style={direction === 'in' ? { color: theme.income } : undefined}>
      {direction === 'out' ? '−' : '+'} {amount}
    </ThemedText>
  </View>;
}

/** Both legs of one suggested own-account transfer, answered with one tap. */
function PairCard({ pair, outAccount, inAccount, busy, onMatch, onSeparate }: {
  pair: TransferPair; outAccount: string; inAccount: string; busy: boolean;
  onMatch: () => void; onSeparate: () => void;
}) {
  const theme = useTheme(); const language = useLanguage();
  const d = detailsWords(language);
  const amount = formatAED(pair.out.amountFils, { decimals: true });
  const incoming = formatAED(pair.in.amountFils, { decimals: true });
  // The two legs are read as one sentence; the buttons stay their own stops
  // (an `accessible` card would swallow them).
  return <View testID="transfer-pair-card" style={[styles.pairCard, { borderColor: theme.cardBorder, backgroundColor: theme.card }]}>
    <View testID="transfer-pair-legs" style={styles.pairLegs} accessible accessibilityRole="text"
      accessibilityLabel={d.transfers.pairA11y(outAccount, inAccount, amount)}>
      <PairLeg label={d.transfers.out} account={outAccount} when={fullDateTime(pair.out)} amount={amount} direction="out" />
      <View style={[styles.legRule, { backgroundColor: theme.cardBorder }]} />
      <PairLeg label={d.transfers.in} account={inAccount} when={fullDateTime(pair.in)} amount={incoming} direction="in" />
    </View>
    <View style={styles.pairActions}>
      <View testID="transfer-pair-match"><Button wrapLabel label={d.transfers.match} disabled={busy} onPress={onMatch} /></View>
      <View testID="transfer-pair-separate"><Button variant="ghost" wrapLabel label={d.transfers.notPair} disabled={busy} onPress={onSeparate} /></View>
    </View>
  </View>;
}

export default function ReviewTransfersScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ transactionId?: string | string[] }>();
  const transactionId = Array.isArray(params.transactionId) ? params.transactionId[0] : params.transactionId;
  const theme = useTheme();
  const language = useLanguage();
  const words = transferReviewCopy(language);
  const d = detailsWords(language);
  // "Not a pair" hides the suggestion for this visit only; both entries stay
  // in the ordinary queue below. Persisting a rejected pairing needs a store
  // decision this screen does not have.
  const [separated, setSeparated] = useState<Set<string>>(() => new Set());
  const toast = useToast();
  const { state, resolveTransfers, getStateGeneration, getStateSnapshot, ensureDurable } = useStore();
  const [filter, setFilter] = useState<'pending' | 'reviewed'>(() => {
    if (!transactionId) return 'pending';
    const current = reconcileTransfers(state.transactions, state.accounts);
    const assessment = current.byId.get(transactionId);
    return current.pendingIds.has(transactionId) || (assessment && unresolvedStatuses.has(assessment.status)) ? 'pending' : 'reviewed';
  });
  const [showAll, setShowAll] = useState(false);
  // This screen is an exception handler, not a second transaction-history
  // browser. Show every unresolved item and keep ordinary/confirmed transfers
  // in the normal activity surfaces.
  const [scope, setScope] = useState<TransferHistoryScope>('all');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [selection, setSelection] = useState<Selection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsDurability, setNeedsDurability] = useState(false);
  const saving = useRef(false);
  const insets = useScreenContentInsets({ hasFooter: false });
  const reconciliation = useMemo(() => reconcileTransfers(state.transactions, state.accounts), [state.transactions, state.accounts]);
  const transactionsById = useMemo(() => new Map(state.transactions.map((row) => [row.id, row])), [state.transactions]);
  const accountLabels = useMemo(() => {
    const labels = new Map(state.accounts.map(account => [account.id, transferAccountLabel(account)]));
    for (const row of state.transactions) if (!labels.has(row.accountId) && row.transferEvidence?.sourceBank) {
      const bank = bankBrandForName(row.transferEvidence.sourceBank)?.name ?? row.transferEvidence.sourceBank;
      labels.set(row.accountId, words.unidentifiedBank(bank));
    }
    return labels;
  }, [state.accounts, state.transactions, words]);
  const focusedId = showAll ? undefined : transactionId;
  const todayISO = toISODate(new Date());
  const pairs = useMemo<TransferPair[]>(() => filter === 'pending' && !focusedId
    ? suggestedTransferPairs(reconciliation, transactionsById).filter(pair => !separated.has(pair.key))
    : [], [filter, focusedId, reconciliation, transactionsById, separated]);
  const pairedIds = useMemo(() => new Set(pairs.flatMap(pair => [pair.out.id, pair.in.id])), [pairs]);
  // A person can explicitly review an uncertain transfer even when it has too
  // little evidence to warrant a mandatory task. This local display group does
  // not add it to the queue or classify it; opening the entry uses the existing
  // fingerprinted preview and confirmation flow below.
  const focusedPendingGroup = useMemo<Group | null>(() => {
    if (!focusedId || reconciliation.pendingIds.has(focusedId)) return null;
    const row = transactionsById.get(focusedId);
    const assessment = reconciliation.byId.get(focusedId);
    if (!row || !assessment || !unresolvedStatuses.has(assessment.status) || !isTransferCandidate(row)) return null;
    return { id: `focused:${row.id}`, transactionIds: [row.id], accountId: row.accountId, direction: row.type,
      status: assessment.status, counterparty: row.transferEvidence?.counterparty,
      counterpartyName: row.transferEvidence?.counterpartyName, bulkEligible: false };
  }, [focusedId, reconciliation, transactionsById]);
  const candidates = useMemo<Group[]>(() => filter === 'pending'
    ? [...reconciliation.groups.flatMap((group) => {
        // A leg shown on a pair card above is not listed a second time.
        const transactionIds = group.transactionIds.filter((id) => reconciliation.pendingIds.has(id) && !pairedIds.has(id));
        return transactionIds.length > 0 ? [{ ...group, transactionIds }] : [];
      }), ...(focusedPendingGroup ? [focusedPendingGroup] : [])]
    : state.transactions
      .filter((row) => {
        if (row.transferDecision) return true;
        const assessment = reconciliation.byId.get(row.id);
        return !!assessment && !reconciliation.pendingIds.has(row.id) &&
          assessment.status !== 'ownership-unknown' && assessment.status !== 'ambiguous' &&
          !assessment.status.startsWith('likely-');
      })
      .sort((a, b) => (b.transferDecision?.decidedAt ?? b.ts ?? 0) - (a.transferDecision?.decidedAt ?? a.ts ?? 0))
      .map((row) => ({
        id: `reviewed:${row.id}`, transactionIds: [row.id], accountId: row.accountId, direction: row.type,
        status: reconciliation.byId.get(row.id)?.status ?? (row.transferDecision?.ownership === 'own' ? 'confirmed-own' : 'confirmed-external'),
        counterparty: row.transferEvidence?.counterparty, bulkEligible: false,
        counterpartyName: row.transferEvidence?.counterpartyName,
      })), [filter, reconciliation, state.transactions, focusedPendingGroup, pairedIds]);
  const candidateTransactionCount = useMemo(
    () => candidates.reduce((count, group) => count + group.transactionIds.length, 0),
    [candidates],
  );
  const searching = deferredQuery.trim().length > 0;
  const searchIndex = useMemo(() => searching
    ? indexTransferHistory(candidates, transactionsById, accountLabels, amount => state.ledgerMoney
      ? `${state.ledgerMoney.currency} ${formatMinorUnits(amount, state.ledgerMoney, { decimals: true })}`
      : formatAED(amount, { decimals: true }))
    : undefined, [searching, candidates, transactionsById, accountLabels, state.ledgerMoney]);
  const projection = useMemo(() => projectTransferHistory({ groups: candidates, rowsById: transactionsById,
      accountLabels, scope, todayISO, query: deferredQuery, focusedId,
      moneyLabel: amount => formatAED(amount, { decimals: true }), searchIndex }),
    [candidates, transactionsById, accountLabels, scope, todayISO, deferredQuery, focusedId, searchIndex]);
  const groups = useMemo<DisplayGroup[]>(() => projection.groups.map(group => ({ ...group,
    summary: summarize(group.rows, accountLabels.get(group.accountId) ?? words.accountUnknown,
      group.counterpartyName ?? counterpartLabel(group.counterparty, words)),
  })), [projection.groups, accountLabels, words]);
  const listItems = useMemo<ListItem[]>(() => transferHistoryItems(groups, expanded, limits, !!focusedId),
    [groups, expanded, limits, focusedId]);
  const browse = (next: TransferHistoryScope) => {
    Keyboard.dismiss();
    setScope(next); setExpanded(new Set()); setLimits({});
  };
  const toggleGroup = (id: string) => {
    Keyboard.dismiss();
    setExpanded(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const stale = !!selection && (
    getStateGeneration() !== selection.expectedGeneration || Object.entries(selection.expectedFingerprints).some(([id, expected]) => {
      const current = transactionsById.get(id);
      return !current || transferFingerprint(current) !== expected;
    })
  );

  const openReview = (group: DisplayGroup, row?: Transaction) => {
    if (saving.current || (!row && !group.bulkEligible)) return;
    Keyboard.dismiss();
    const rows = row ? [row] : group.rows;
    const assessment = row ? reconciliation.byId.get(row.id) : undefined;
    const counterpart = assessment?.counterpartId ? transactionsById.get(assessment.counterpartId) : undefined;
    const linkable = !!counterpart && isTransferCandidate(counterpart) &&
      (assessment?.status === 'likely-own' || assessment?.status === 'confirmed-own') && !row?.transferDecision;
    // Freeze exactly what the person is about to see. Reconciliation may change
    // while the panel is open; the store rechecks these fingerprints at save.
    setSelection({
      ids: rows.map((entry) => entry.id),
      expectedFingerprints: Object.fromEntries([...rows, ...(linkable && counterpart ? [counterpart] : [])].map((entry) => [entry.id, transferFingerprint(entry)])),
      expectedGeneration: getStateGeneration(),
      summary: row ? summarize(rows, group.summary.account, group.summary.counterparty) : group.summary,
      ownership: row?.transferDecision ? null : undefined, undo: !!row?.transferDecision,
      status: assessment?.status,
      readOnly: assessment?.status === 'corroborating-alert' ||
        (assessment?.status === 'card-repayment' && assessment.reason !== 'known-card'),
      ownershipExplanation: assessment?.reason === 'known-account' ? words.knownAccountEvidence :
        assessment?.reason === 'known-card' ? words.knownCardEvidence : undefined,
      ...(counterpart ? { counterpart: { id: counterpart.id, title: counterpart.title,
        account: accountLabels.get(counterpart.accountId) ?? words.accountUnknown,
        date: fullDateTime(counterpart), amount: counterpart.amountFils, linkable } } : {}),
      ...(row ? { record: { title: row.title, reference: row.transferEvidence?.reference,
        source: row.source === 'sms' || row.smsKey ? words.bankRecord : words.manualRecord } } : {}),
    });
    setError(null);
    setNeedsDurability(false);
  };

  const pairSelection = (pair: TransferPair): Selection => {
    const anchor = pair.anchorId === pair.out.id ? pair.out : pair.in;
    const other = anchor.id === pair.out.id ? pair.in : pair.out;
    return {
      ids: [anchor.id],
      expectedFingerprints: { [anchor.id]: transferFingerprint(anchor), [other.id]: transferFingerprint(other) },
      expectedGeneration: getStateGeneration(),
      summary: summarize([anchor], accountLabels.get(anchor.accountId) ?? words.accountUnknown,
        anchor.transferEvidence?.counterpartyName ?? counterpartLabel(anchor.transferEvidence?.counterparty, words)),
      ownership: 'own', undo: false, status: 'likely-own',
      counterpart: { id: other.id, title: other.title, account: accountLabels.get(other.accountId) ?? words.accountUnknown,
        date: fullDateTime(other), amount: other.amountFils, linkable: true },
      record: { title: anchor.title, reference: anchor.transferEvidence?.reference,
        source: anchor.source === 'sms' || anchor.smsKey ? words.bankRecord : words.manualRecord },
    };
  };
  // One tap, the same request and the same change checks as the sheet's
  // "link" path. A failure opens the sheet on this pair with the error.
  const matchPair = (pair: TransferPair) => {
    if (saving.current) return;
    Keyboard.dismiss();
    void save(pairSelection(pair), true);
  };
  const separatePair = (pair: TransferPair) => {
    setSeparated(current => new Set(current).add(pair.key));
    toast.show(d.transfers.notPairDone, { tone: 'info' });
  };

  const closeReview = () => {
    if (saving.current || (needsDurability && !stale)) return;
    setSelection(null);
    setError(null);
    setNeedsDurability(false);
  };

  const save = async (target: Selection | null = selection, oneTap = false) => {
    const selection = target;
    if (!selection || selection.ownership === undefined || saving.current || (!oneTap && stale)) return;
    // A retry does not enter the resolver again. Check its post-decision
    // fingerprints against authoritative state, even before React re-renders.
    const latest = new Map(getStateSnapshot().transactions.map((row) => [row.id, row]));
    if (getStateGeneration() !== selection.expectedGeneration ||
      Object.entries(selection.expectedFingerprints).some(([id, expected]) => {
        const current = latest.get(id);
        return !current || transferFingerprint(current) !== expected;
      })) {
      if (oneTap) toast.show(words.changed, { tone: 'error' });
      else setError(words.changed);
      return;
    }
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      if (needsDurability) await ensureDurable();
      else await resolveTransfers({ ids: selection.ids, ownership: selection.ownership,
        ...(selection.ownership === 'own' && selection.counterpart?.linkable ? { counterpartId: selection.counterpart.id } : {}),
        expectedFingerprints: selection.expectedFingerprints, expectedGeneration: selection.expectedGeneration });
      toast.show(oneTap ? d.transfers.matched : selection.undo ? words.undone : words.saved, { tone: 'success' });
      setSelection(null);
      setNeedsDurability(false);
      // Keep the current browsing position; classifying one row is not a
      // reason to switch the user to a different list of historical entries.
      if (focusedId) setFilter(selection.undo ? 'pending' : 'reviewed');
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
      // A one-tap match that failed continues in the sheet, where retry and
      // cancel already exist.
      if (oneTap && code !== 'transfer-durability') setSelection(selection);
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
        keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
        initialNumToRender={8} maxToRenderPerBatch={8} windowSize={7}
        contentContainerStyle={insets.contentContainerStyle} contentInset={insets.contentInset}
        scrollIndicatorInsets={insets.scrollIndicatorInsets} contentInsetAdjustmentBehavior="automatic"
        ListHeaderComponent={<View style={styles.intro}>
          {!focusedId && candidates.length > 0 ? (
            <ThemedText type="small" themeColor="textSecondary">{words.intro}</ThemedText>
          ) : null}
          {pairs.length > 0 ? <View testID="transfer-pairs" style={styles.pairs}>
            <ThemedText type="smallBold" accessibilityRole="header">{d.transfers.pairsTitle(pairs.length)}</ThemedText>
            <ThemedText type="meta" themeColor="textSecondary">{d.transfers.pairsBody}</ThemedText>
            {pairs.map(pair => <PairCard key={pair.key} pair={pair} busy={busy}
              outAccount={accountLabels.get(pair.out.accountId) ?? words.accountUnknown}
              inAccount={accountLabels.get(pair.in.accountId) ?? words.accountUnknown}
              onMatch={() => matchPair(pair)} onSeparate={() => separatePair(pair)} />)}
          </View> : null}
          {focusedId ? (
            <Button variant="ghost" label={words.showAll} onPress={() => { setShowAll(true); browse('all'); }} />
          ) : candidateTransactionCount > 8 ? (
            <TextField testID="transfer-search" label={words.search} value={query} onChangeText={setQuery}
              autoCapitalize="none" autoCorrect={false} returnKeyType="search" onSubmitEditing={() => Keyboard.dismiss()}
              leading={<Icon name="search" size={16} color={theme.textSecondary} />}
              trailing={query ? <Pressable accessibilityRole="button" accessibilityLabel={words.clearSearch}
                onPress={() => setQuery('')} style={styles.clearSearch}>
                <Icon name="close" size={16} color={theme.textSecondary} />
              </Pressable> : undefined} />
          ) : null}
        </View>}
        ListEmptyComponent={<View style={styles.empty}>
          <ThemedText type="subtitle" accessibilityRole="header">{focusedId ? transactionsById.has(focusedId) ? words.notPending : words.missingRoute : deferredQuery.trim() ? words.searchEmpty : filter === 'pending' ? words.empty : words.reviewedEmpty}</ThemedText>
          {focusedId && reconciliation.byId.get(focusedId) ? <ThemedText type="small" themeColor="textSecondary">{statusLabel(reconciliation.byId.get(focusedId)!.status, words)}</ThemedText> : null}
          {!focusedId && deferredQuery.trim() ? <ThemedText type="small" themeColor="textSecondary">{words.searchEmptyBody}</ThemedText> : null}
        </View>}
        renderItem={({ item }) => item.kind === 'group' ? <View testID="transfer-review-group"
          style={[styles.group, { borderTopColor: theme.cardBorder }]}>
          <Pressable testID="transfer-group-toggle" accessibilityRole="button"
            accessibilityLabel={`${item.group.summary.account}. ${item.group.summary.counterparty}. ${expanded.has(item.group.id) ? words.collapse : words.expand(item.group.rows.length)}`}
            accessibilityState={{ expanded: !!focusedId || expanded.has(item.group.id), disabled: !!focusedId }}
            disabled={!!focusedId} onPress={() => toggleGroup(item.group.id)} style={styles.groupToggle}>
            <View style={styles.groupHeading}>
              <Icon name="bank" size={18} color={theme.textSecondary} />
              <ThemedText type="smallBold" style={styles.flexText}>{item.group.summary.account}</ThemedText>
              {!focusedId && <Icon name={expanded.has(item.group.id) ? 'chevron-down' : language === 'ar' ? 'chevron-left' : 'chevron-right'} size={16} color={theme.textSecondary} />}
            </View>
            <ThemedText type="meta" themeColor="textSecondary">{item.group.summary.counterparty}</ThemedText>
            {(filter === 'reviewed' || item.group.status.startsWith('likely-')) && <ThemedText type="meta" themeColor="textSecondary">{statusLabel(item.group.status, words)}</ThemedText>}
            <View style={styles.groupMeta}>
              <ThemedText type="smallBold" tabular>{formatAED(item.group.summary.total, { decimals: true })} · {item.group.direction === 'income' ? words.received : words.sent}</ThemedText>
              <ThemedText type="meta" themeColor="textSecondary">{words.count(item.group.rows.length)} · {shortDate(item.group.rows[0].date)}</ThemedText>
            </View>
          </Pressable>
          {(expanded.has(item.group.id) || focusedId) && filter === 'pending' && item.group.bulkEligible && item.group.rows.length > 1
            ? <Button variant="outline" wrapLabel label={words.reviewGroup(item.group.rows.length)} onPress={() => openReview(item.group)} />
            : (expanded.has(item.group.id) || focusedId) && filter === 'pending' && item.group.rows.length > 1
              ? <ThemedText type="meta" themeColor="textSecondary">{words.individualOnly}</ThemedText> : null}
        </View> : item.kind === 'more' ? <Button variant="ghost" wrapLabel label={words.more(item.shown, item.group.rows.length)}
          onPress={() => setLimits(current => ({ ...current, [item.group.id]: item.shown + TRANSFER_HISTORY_PAGE_SIZE }))} /> : <Pressable testID="transfer-review-entry" accessibilityRole="button"
          accessibilityLabel={`${item.transaction.transferDecision ? words.undo : words.review}. ${item.transaction.title}. ${fullDateTime(item.transaction)}. ${formatAED(item.transaction.amountFils, { decimals: true })}`}
          onPress={() => openReview(item.group, item.transaction)} style={[styles.entry, { borderColor: theme.cardBorder }]}>
          <ThemedText type="small" selectable>{item.transaction.title}</ThemedText>
          <View style={styles.groupMeta}>
            <ThemedText type="smallBold" tabular>{formatAED(item.transaction.amountFils, { decimals: true })}</ThemedText>
            <ThemedText type="meta" themeColor="textSecondary" selectable>{fullDateTime(item.transaction)}</ThemedText>
          </View>
          {item.transaction.transferEvidence?.reference ? <ThemedText type="meta" themeColor="textSecondary" selectable>{words.reference}: {item.transaction.transferEvidence.reference}</ThemedText> : null}
        </Pressable>}
      />
    </ScreenScaffold>
    {selection ? <BottomSheet visible title={selection.undo ? words.undo : words.title}
      testID="transfer-review-confirmation" onClose={closeReview} dismissible={!busy && (!needsDurability || stale)}
      footer={<View style={styles.actions}>
        {!selection.readOnly && <Button wrapLabel label={busy ? words.saving : needsDurability ? words.retrySave : selection.undo ? words.undo : selection.ownership === 'own' && selection.counterpart?.linkable ? words.linkOwn : words.confirm}
          disabled={busy || stale || selection.ownership === undefined} onPress={() => void save()} />
        }
        <Button variant="ghost" label={selection.readOnly || selection.undo || needsDurability ? words.cancel : words.keepSeparate} disabled={busy || (needsDurability && !stale)} onPress={closeReview} />
      </View>}>
      <ThemedText type="subtitle" accessibilityRole="header">{selection.undo ? words.undoTitle : selection.ids.length > 1 ? words.groupChoose : words.choose}</ThemedText>
      <SummaryFacts summary={selection.summary} words={words} />
      {selection.status && <ThemedText type="smallBold">{statusLabel(selection.status, words)}</ThemedText>}
      {selection.ownershipExplanation && <ThemedText testID="transfer-known-ownership-evidence" type="small" themeColor="textSecondary">{selection.ownershipExplanation}</ThemedText>}
      {selection.status?.startsWith('likely-') && <ThemedText type="small" themeColor="textSecondary">{words.suggestedOnly}</ThemedText>}
      {selection.counterpart && <View style={styles.facts} testID="transfer-counterpart-evidence">
        <ThemedText type="smallBold">{words.linkedEntry}</ThemedText>
        <ThemedText type="small" selectable>{selection.counterpart.account}</ThemedText>
        <ThemedText type="small" selectable>{selection.counterpart.title}</ThemedText>
        <ThemedText type="meta" selectable>{selection.counterpart.date}</ThemedText>
        <ThemedText type="smallBold" tabular>{formatAED(selection.counterpart.amount, { decimals: true })}</ThemedText>
      </View>}
      {selection.record ? <View style={styles.facts}>
        <ThemedText type="small" selectable>{selection.record.title}</ThemedText>
        <ThemedText type="meta" themeColor="textSecondary">{selection.record.source}</ThemedText>
        {selection.record.reference ? <ThemedText type="meta" themeColor="textSecondary" selectable>{words.reference}: {selection.record.reference}</ThemedText> : null}
      </View> : null}
      {selection.ids.length > 1 ? <ThemedText type="small" themeColor="textSecondary">{words.groupHint}</ThemedText> : null}
      {selection.readOnly ? null : selection.undo ? <ThemedText type="small">{words.undoBody}</ThemedText> : <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel={words.choose}>
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
  pairs: { gap: Spacing.two },
  pairCard: { borderWidth: 1, borderRadius: 14, padding: Spacing.three, gap: Spacing.two },
  leg: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  pairLegs: { gap: Spacing.two },
  legRule: { height: StyleSheet.hairlineWidth },
  pairActions: { gap: Spacing.one, paddingTop: Spacing.one },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  filter: { minHeight: 48, justifyContent: 'center', paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderBottomWidth: 2 },
  facts: { gap: Spacing.one },
  group: { borderTopWidth: StyleSheet.hairlineWidth, paddingBottom: Spacing.three, gap: Spacing.two },
  groupToggle: { minHeight: 48, paddingTop: Spacing.three, gap: Spacing.two },
  groupHeading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  flexText: { flex: 1, flexShrink: 1 },
  groupMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: Spacing.one },
  scope: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderWidth: StyleSheet.hairlineWidth },
  clearSearch: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  historyLink: { paddingVertical: Spacing.three },
  entry: { minHeight: 48, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: Spacing.three, paddingStart: Spacing.three, gap: Spacing.one },
  empty: { paddingVertical: Spacing.six, gap: Spacing.two },
  actions: { gap: Spacing.two },
  choices: { gap: Spacing.two },
  choice: { minHeight: 48, padding: Spacing.three, borderWidth: 1, gap: Spacing.one },
});
