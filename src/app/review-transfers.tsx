import { useLocalSearchParams } from 'expo-router';
import { useRouter } from '@/hooks/use-app-router';
import React, { useDeferredValue, useMemo, useRef, useState } from 'react';
import { FlatList, Keyboard, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { RouteTag, TransferRoute } from '@/components/transfers/transfer-route-row';
import { EButton } from '@/components/ui/band/e-button';
import { BandScaffold, useBandBottomInset } from '@/components/ui/band-scaffold';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { TextField } from '@/components/ui/text-field';
import { useToast } from '@/components/ui/toast';
import { Fonts, Spacing, type BandPalette } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { formatAED, fullDateTime, shortDateWithYear, toISODate } from '@/lib/format';
import { bankBrandForName } from '@/lib/markets';
import { formatMinorUnits } from '@/lib/ledger-money';
import { currentMonthPeriod, inPeriod } from '@/lib/period';
import { useStoreActions, useStoreSelector } from '@/lib/store';
import { detailsWords } from '@/lib/details-copy';
import { reviewBandCopy } from '@/lib/review-band-copy';
import { transferActivityCopy } from '@/lib/transfer-activity-copy';
import type { RouteEnd } from '@/lib/transfer-list';
import { matchedTransferPairs, suggestedTransferPairs, type TransferPair } from '@/lib/transfer-pairs';
import { isTransferCandidate, reconcileTransfers, transferDeclined, transferFingerprint } from '@/lib/transfer-reconciliation';
import { transferReviewCopy } from '@/lib/transfer-review-copy';
import { indexTransferHistory, projectTransferHistory, transferAccountLabel, transferHistoryItems, transferSearchText, TRANSFER_HISTORY_PAGE_SIZE,
  type TransferHistoryScope, type TransferHistoryItem } from '@/lib/transfer-review-presentation';
import type { Transaction } from '@/lib/types';

type Group = ReturnType<typeof reconcileTransfers>['groups'][number];
/** Matched pairs shown here before "View all transfers". */
const MATCHED_PREVIEW = 3;
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
type ListItem = TransferHistoryItem<DisplayGroup> | { kind: 'pair'; key: string; pair: TransferPair };
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
  batch?: Selection[];
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

/**
 * An answer button in the Transfers page's style (the question card's buttons):
 * 48pt, 14pt radius, the band fill for the first answer and a bordered sheet
 * tone for the rest. A row of them wraps, and stacks at large text.
 */
function ChoiceButton({ label, primary, disabled, onPress, palette, testID, stacked }: {
  label: string; primary: boolean; disabled: boolean; onPress: () => void; palette: BandPalette; testID: string; stacked: boolean;
}) {
  // Disabled is drawn, not faded: a ruled outline with the secondary ink, which keeps its label
  // above 3:1 (a 45% fade of the band fill did not).
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} disabled={disabled}
    accessibilityState={{ disabled }} onPress={onPress}
    style={({ pressed }) => [styles.choiceButton, stacked && styles.choiceButtonStacked, disabled
      ? { backgroundColor: palette.sheet, borderWidth: 1, borderColor: palette.rule }
      : primary ? { backgroundColor: palette.fill }
        : { backgroundColor: palette.sheet, borderWidth: 1, borderColor: palette.textSecondary },
    { opacity: !disabled && pressed ? 0.7 : 1 }]}>
    <ThemedText type="smallBold" style={[styles.choiceLabel,
      { color: disabled ? palette.textSecondary : primary ? palette.onFill : palette.text }]}>{label}</ThemedText>
  </Pressable>;
}

/** An account on a route chip. The chip draws only the label; the kind marks an unknown side. */
const accountEnd = (accountId: string): RouteEnd => ({ kind: 'account', accountId });

/** Both legs of one suggested own-account transfer, answered with one tap. */
function PairCard({ pair, outAccount, inAccount, busy, onMatch, onSeparate, palette, stacked, checked, onSelect }: {
  pair: TransferPair; outAccount: string; inAccount: string; busy: boolean;
  onMatch: () => void; onSeparate: () => void; palette: BandPalette; stacked: boolean;
  checked?: boolean; onSelect?: () => void;
}) {
  const language = useLanguage();
  const d = detailsWords(language);
  const words = transferReviewCopy(language);
  const activityWords = transferActivityCopy(language);
  const amount = formatAED(pair.out.amountFils, { decimals: true });
  const incoming = formatAED(pair.in.amountFils, { decimals: true });
  // The two legs are read as one sentence; the buttons stay their own stops
  // (an `accessible` card would swallow them).
  return <View testID="transfer-pair-card" style={[styles.pairCard, { borderColor: palette.rule, backgroundColor: palette.card }]}>
    <View testID="transfer-pair-legs" style={styles.pairLegs} accessible accessibilityRole="text"
      accessibilityLabel={[d.transfers.pairA11y(outAccount, inAccount, amount), fullDateTime(pair.out),
        pair.in.amountFils !== pair.out.amountFils ? `${d.transfers.in}: ${incoming}` : null].filter(Boolean).join('. ')}>
      {/* The Transfers page's route: the account it left → the account it reached, and the amount. */}
      <TransferRoute from={accountEnd(pair.out.accountId)} to={accountEnd(pair.in.accountId)} fromLabel={outAccount} toLabel={inAccount}
        amountFils={pair.out.amountFils} sign="none" palette={palette} testID="transfer-pair-route" />
      <View style={styles.routeMeta}>
        <ThemedText type="meta" style={{ color: palette.textSecondary }}>{fullDateTime(pair.out)}</ThemedText>
        <RouteTag tag="needs-answer" label={activityWords.tags.needsAnswer} palette={palette} slate={palette.tint} />
      </View>
      {/* A pair whose legs differ in amount says so; the two are never merged. */}
      {pair.in.amountFils !== pair.out.amountFils ? (
        <ThemedText type="meta" style={{ color: palette.textSecondary }}>{d.transfers.in}: {incoming} · {fullDateTime(pair.in)}</ThemedText>
      ) : null}
    </View>
    {onSelect ? <Pressable testID="transfer-pair-select" accessibilityRole="checkbox"
      accessibilityLabel={`${words.selectItem}. ${d.transfers.pairA11y(outAccount, inAccount, amount)}. ${fullDateTime(pair.out)}`}
      accessibilityState={{ checked: !!checked, disabled: busy }} aria-checked={!!checked}
      disabled={busy} onPress={onSelect} style={styles.selectControl}>
      <SelectionMark checked={!!checked} palette={palette} />
      <ThemedText type="smallBold" style={styles.flexText}>{checked ? words.selectedCount(1) : words.selectItem}</ThemedText>
    </Pressable> : <View style={[styles.choiceRow, stacked && styles.choiceRowStacked]}>
      <ChoiceButton testID="transfer-pair-match" primary label={d.transfers.match} disabled={busy} onPress={onMatch} palette={palette} stacked={stacked} />
      <ChoiceButton testID="transfer-pair-separate" primary={false} label={d.transfers.notPair} disabled={busy} onPress={onSeparate} palette={palette} stacked={stacked} />
    </View>}
  </View>;
}

function SelectionMark({ checked, palette }: { checked: boolean; palette: BandPalette }) {
  return <View importantForAccessibility="no" style={[styles.checkbox,
    { borderColor: checked ? palette.tint : palette.textSecondary, backgroundColor: checked ? palette.fill : 'transparent' }]}>
    {checked ? <Icon name="check" size={17} color={palette.onFill} /> : null}
  </View>;
}

export default function ReviewTransfersScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ transactionId?: string | string[] }>();
  const transactionId = Array.isArray(params.transactionId) ? params.transactionId[0] : params.transactionId;
  const band = useBand('accounts');
  const largeText = useLargeTextLayout();
  const language = useLanguage();
  const bandWords = reviewBandCopy(language);
  const activityWords = transferActivityCopy(language);
  const words = transferReviewCopy(language);
  const d = detailsWords(language);
  // "Not a pair" hides the suggestion for this visit only; both entries stay
  // in the ordinary queue below. Persisting a rejected pairing needs a store
  // decision this screen does not have.
  const [separated, setSeparated] = useState<Set<string>>(() => new Set());
  const toast = useToast();
  const state = useStoreSelector(store => ({ transactions: store.state.transactions, accounts: store.state.accounts,
    ledgerMoney: store.state.ledgerMoney, monthStartDay: store.state.monthStartDay, generation: store.getStateGeneration() }));
  const { resolveTransfers, resolveTransferBatch, getStateGeneration, getStateSnapshot, ensureDurable } = useStoreActions();
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
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Map<string, Selection>>(() => new Map());
  const [previewLimit, setPreviewLimit] = useState(TRANSFER_HISTORY_PAGE_SIZE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsDurability, setNeedsDurability] = useState(false);
  const saving = useRef(false);
  const listBottom = useBandBottomInset();
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
        // "Not a transfer" is not an answer this screen lists (it would read as "with someone else").
        if (transferDeclined(row)) return false;
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
  // Only real matches: pairs the reconciler has confirmed, both legs naming
  // each other, in the current money month. Never a suggestion.
  const matched = useMemo(() => filter === 'pending' && !focusedId
    ? matchedTransferPairs(reconciliation, transactionsById, pair => inPeriod(pair.out.date, currentMonthPeriod()))
    : [],
    // monthKey reads the StoreProvider's active salary-day setting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filter, focusedId, reconciliation, transactionsById, state.monthStartDay]);
  // The band's figure: suggested pairs plus the single entries still unanswered.
  const toCheck = filter === 'pending' && !focusedId ? pairs.length + candidateTransactionCount : 0;
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
  const visiblePairs = useMemo(() => {
    const terms = transferSearchText(deferredQuery).split(/\s+/).filter(Boolean);
    if (!terms.length) return pairs;
    return pairs.filter(pair => {
      const label = transferSearchText([pair.out, pair.in].map(row => [row.title, row.date,
        accountLabels.get(row.accountId), row.transferEvidence?.counterpartyName, row.transferEvidence?.reference,
        formatAED(row.amountFils, { decimals: true })].filter(Boolean).join(' ')).join(' '));
      return terms.every(term => label.includes(term));
    });
  }, [pairs, deferredQuery, accountLabels]);
  const listItems = useMemo<ListItem[]>(() => [
    ...visiblePairs.map(pair => ({ kind: 'pair' as const, key: `pair:${pair.key}`, pair })),
    ...transferHistoryItems(groups, expanded, limits, !!focusedId),
  ], [visiblePairs, groups, expanded, limits, focusedId]);
  // A collapsed one-entry group is that entry: in select mode its card carries the entry's own
  // checkbox (the same key and preview as the expanded row), so "Select all shown" counts what
  // has a checkbox on screen. Collapsed groups of several entries are still never selected whole.
  const singleEntry = (item: ListItem): ListItem | null => item.kind === 'group' && item.group.rows.length === 1
    && !expanded.has(item.group.id) && !item.group.rows[0].transferDecision
    ? { kind: 'entry', key: `entry:${item.group.id}:${item.group.rows[0].id}`, group: item.group, transaction: item.group.rows[0] } : null;
  const selectableItems = useMemo(() => filter === 'pending' && !focusedId
    ? listItems.flatMap(item => item.kind === 'pair' || (item.kind === 'entry' && !item.transaction.transferDecision) ? [item]
      : singleEntry(item) ? [singleEntry(item)!] : [])
    // singleEntry reads expanded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    : [], [listItems, filter, focusedId, expanded]);
  const browse = (next: TransferHistoryScope) => {
    Keyboard.dismiss();
    setScope(next); setExpanded(new Set()); setLimits({});
  };
  const toggleGroup = (id: string) => {
    Keyboard.dismiss();
    setExpanded(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const stale = useMemo(() => !!selection && (
    state.generation !== selection.expectedGeneration || Object.entries(selection.expectedFingerprints).some(([id, expected]) => {
      const current = transactionsById.get(id);
      return !current || transferFingerprint(current) !== expected;
    })
  ), [selection, state.generation, transactionsById]);

  const entrySelection = (group: DisplayGroup, row?: Transaction): Selection => {
    const rows = row ? [row] : group.rows;
    const assessment = row ? reconciliation.byId.get(row.id) : undefined;
    const counterpart = assessment?.counterpartId ? transactionsById.get(assessment.counterpartId) : undefined;
    const linkable = !!counterpart && isTransferCandidate(counterpart) &&
      (assessment?.status === 'likely-own' || assessment?.status === 'confirmed-own') && !row?.transferDecision;
    // Freeze exactly what the person is about to see. Reconciliation may change
    // while the panel is open; the store rechecks these fingerprints at save.
    return {
      ids: rows.map((entry) => entry.id),
      expectedFingerprints: Object.fromEntries([...rows, ...(linkable && counterpart ? [counterpart] : [])].map((entry) => [entry.id, transferFingerprint(entry)])),
      expectedGeneration: state.generation,
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
    };
  };
  const openReview = (group: DisplayGroup, row?: Transaction) => {
    if (saving.current || (!row && !group.bulkEligible)) return;
    Keyboard.dismiss();
    setSelection(entrySelection(group, row));
    setError(null);
    setNeedsDurability(false);
  };

  const pairSelection = (pair: TransferPair): Selection => {
    const anchor = pair.anchorId === pair.out.id ? pair.out : pair.in;
    const other = anchor.id === pair.out.id ? pair.in : pair.out;
    return {
      ids: [anchor.id],
      expectedFingerprints: { [anchor.id]: transferFingerprint(anchor), [other.id]: transferFingerprint(other) },
      expectedGeneration: state.generation,
      summary: summarize([anchor], accountLabels.get(anchor.accountId) ?? words.accountUnknown,
        anchor.transferEvidence?.counterpartyName ?? counterpartLabel(anchor.transferEvidence?.counterparty, words)),
      ownership: 'own', undo: false, status: 'likely-own',
      counterpart: { id: other.id, title: other.title, account: accountLabels.get(other.accountId) ?? words.accountUnknown,
        date: fullDateTime(other), amount: other.amountFils, linkable: true },
      record: { title: anchor.title, reference: anchor.transferEvidence?.reference,
        source: anchor.source === 'sms' || anchor.smsKey ? words.bankRecord : words.manualRecord },
    };
  };
  const pickItem = (item: ListItem): Selection | null => item.kind === 'pair' ? pairSelection(item.pair)
    : item.kind === 'entry' ? { ...entrySelection(item.group, item.transaction), counterpart: undefined, ownership: 'own',
      expectedFingerprints: { [item.transaction.id]: transferFingerprint(item.transaction) } } : null;
  const togglePicked = (item: ListItem) => {
    if (saving.current) return;
    Keyboard.dismiss();
    const preview = pickItem(item);
    if (!preview || preview.readOnly) return;
    setPicked(current => {
      const next = new Map(current);
      if (next.has(item.key)) next.delete(item.key); else next.set(item.key, preview);
      return next;
    });
  };
  const selectShown = () => {
    if (saving.current) return;
    Keyboard.dismiss();
    setPicked(current => {
      const next = new Map(current);
      for (const item of selectableItems) if (!next.has(item.key)) {
        const preview = pickItem(item);
        if (preview && !preview.readOnly) next.set(item.key, preview);
      }
      return next;
    });
  };
  const openBatch = () => {
    if (saving.current || picked.size === 0) return;
    Keyboard.dismiss();
    const batch = [...picked.values()];
    // Keep the details and fingerprints captured at selection time. Never
    // replace a checked item with a newer import while opening confirmation.
    if (batch.some(item => item.expectedGeneration !== getStateGeneration())) {
      toast.show(words.changed, { tone: 'error' });
      return;
    }
    setSelection({ ids: batch.flatMap(item => item.ids),
      expectedFingerprints: Object.fromEntries(batch.flatMap(item => Object.entries(item.expectedFingerprints))),
      expectedGeneration: batch[0].expectedGeneration, summary: batch[0].summary, ownership: 'own', undo: false, batch });
    setPreviewLimit(TRANSFER_HISTORY_PAGE_SIZE);
    setError(null); setNeedsDurability(false);
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

  // Pass the current preview explicitly. A default named `selection` plus the
  // body-local binding below was misbound by the production web transform.
  const save = async (target: Selection | null, oneTap = false) => {
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
      else if (selection.batch) await resolveTransferBatch({
        decisions: selection.batch.map(item => ({ ids: item.ids, ownership: 'own',
          ...(item.counterpart?.linkable ? { counterpartId: item.counterpart.id } : {}) })),
        expectedFingerprints: selection.expectedFingerprints, expectedGeneration: selection.expectedGeneration,
      });
      else await resolveTransfers({ ids: selection.ids, ownership: selection.ownership,
        ...(selection.ownership === 'own' && selection.counterpart?.linkable ? { counterpartId: selection.counterpart.id } : {}),
        expectedFingerprints: selection.expectedFingerprints, expectedGeneration: selection.expectedGeneration });
      toast.show(selection.batch ? words.batchSaved(selection.batch.length) : oneTap ? d.transfers.matched : selection.undo ? words.undone : words.saved, { tone: 'success' });
      if (selection.batch) { setPicked(new Map()); setSelecting(false); }
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
        const changedIds = selection.batch
          ? selection.batch.flatMap(item => [...item.ids, ...(item.counterpart?.linkable ? [item.counterpart.id] : [])])
          : [...selection.ids, ...(selection.ownership === 'own' && selection.counterpart?.linkable ? [selection.counterpart.id] : [])];
        if (fingerprints && typeof fingerprints === 'object' && !Array.isArray(fingerprints) &&
          Object.values(fingerprints).every((value) => typeof value === 'string') &&
          changedIds.every((id) => id in fingerprints)) {
          // An external decision changes only its selected row, even when the
          // preview also showed a possible counterpart. Retain that unchanged
          // counterpart's guard while advancing the rows the store did change.
          setSelection({ ...selection, expectedFingerprints: {
            ...selection.expectedFingerprints, ...fingerprints as Record<string, string>,
          } });
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

  // Rows are drawn as the Transfers page draws them: a route from one end to
  // the other. A group's other end is the counterparty when the bank named one,
  // otherwise the dashed "?" of an unknown side.
  const otherEnd = (group: DisplayGroup): RouteEnd => group.counterpartyName ? { kind: 'party', name: group.counterpartyName }
    : group.counterparty ? { kind: 'party', name: group.summary.counterparty } : { kind: 'unknown' };
  const shownName = (end: RouteEnd, name: string) => end.kind === 'unknown' ? '?' : name;
  // Money out leaves the group's account for the other end; money in arrives from it.
  const groupRoute = (group: DisplayGroup) => {
    const account = accountEnd(group.accountId);
    const other = otherEnd(group);
    const incoming = group.direction === 'income';
    return <TransferRoute from={incoming ? other : account} to={incoming ? account : other}
      fromLabel={incoming ? shownName(other, group.summary.counterparty) : group.summary.account}
      toLabel={incoming ? group.summary.account : shownName(other, group.summary.counterparty)}
      amountFils={group.summary.total} sign={incoming ? 'plus' : 'minus'} palette={band} testID={`transfer-group-route-${group.id}`} />;
  };
  // Each group is one card: its route on top, then (expanded) its entries and "Show more".
  const groupEnds = useMemo(() => new Set(listItems.filter((item, index) => item.kind !== 'pair' &&
    (listItems[index + 1] === undefined || listItems[index + 1].kind === 'group')).map(item => item.key)), [listItems]);
  const segment = (item: ListItem) => [styles.segment, { backgroundColor: band.card, borderColor: band.rule },
    item.kind === 'group' ? styles.segmentFirst : { borderTopWidth: StyleSheet.hairlineWidth },
    groupEnds.has(item.key) && styles.segmentLast];

  // A one-entry group is selected as its entry, right on its card (as a pair card is).
  const groupSelect = (item: ListItem) => {
    const single = selecting && filter === 'pending' && !focusedId ? singleEntry(item) : null;
    if (!single || single.kind !== 'entry') return null;
    const checked = picked.has(single.key);
    return <Pressable testID="transfer-group-select" accessibilityRole="checkbox"
      accessibilityLabel={`${words.selectItem}. ${single.transaction.title}. ${fullDateTime(single.transaction)}. ${formatAED(single.transaction.amountFils, { decimals: true })}`}
      accessibilityState={{ checked, disabled: busy }} aria-checked={checked} disabled={busy}
      onPress={() => togglePicked(single)} style={styles.selectControl}>
      <SelectionMark checked={checked} palette={band} />
      <ThemedText type="smallBold" style={styles.flexText}>{checked ? words.selectedCount(1) : words.selectItem}</ThemedText>
    </Pressable>;
  };
  const matchedSection = matched.length > 0 ? <View testID="transfer-matched-pairs" style={styles.matched}>
    <View style={styles.matchedHead} accessible accessibilityRole="header" accessibilityLabel={`${bandWords.matchedThisMonth}, ${matched.length}`}>
      <ThemedText type="smallBold" style={[styles.flexText, { color: band.text }]}>{bandWords.matchedThisMonth}</ThemedText>
      <ThemedText type="smallBold" style={{ color: band.textSecondary }}>{matched.length}</ThemedText>
    </View>
    <View style={[styles.matchedCard, { backgroundColor: band.card }]}>
      {matched.slice(0, MATCHED_PREVIEW).map((pair, index) => {
        const outAccount = accountLabels.get(pair.out.accountId) ?? words.accountUnknown;
        const inAccount = accountLabels.get(pair.in.accountId) ?? words.accountUnknown;
        const amount = formatAED(pair.out.amountFils, { decimals: true });
        return <View key={pair.key} testID="transfer-matched-pair" accessible accessibilityRole="text"
          accessibilityLabel={`${d.transfers.pairA11y(outAccount, inAccount, amount)}. ${shortDateWithYear(pair.out.date)}`}
          style={[styles.matchedRow, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: band.rule }]}>
          <TransferRoute from={accountEnd(pair.out.accountId)} to={accountEnd(pair.in.accountId)} fromLabel={outAccount} toLabel={inAccount}
            amountFils={pair.out.amountFils} sign="none" palette={band} />
          <View style={styles.routeMeta}>
            <ThemedText type="meta" style={{ color: band.textSecondary }}>{shortDateWithYear(pair.out.date)}</ThemedText>
            <RouteTag tag="own" label={activityWords.tags.own} palette={band} slate={band.tint} />
          </View>
        </View>;
      })}
    </View>
    <Pressable testID="transfer-matched-all" accessibilityRole="button" accessibilityLabel={activityWords.viewAll}
      onPress={() => router.push('/transfers')} style={styles.matchedLink}>
      <ThemedText type="smallBold" style={{ color: band.tint }}>{activityWords.viewAll}</ThemedText>
    </Pressable>
  </View> : null;

  return <>
    <BandScaffold band="accounts" scroll={false} testID="review-transfers-screen" contentStyle={styles.sheet}
      nav={{ back: true, backDisabled: busy || (needsDurability && !stale), title: activityWords.title }}
      footer={selecting ? <View testID="transfer-selection-footer" accessibilityLiveRegion="polite">
        {/* Nothing picked yet: an outlined button at full ink (a faded fill fell under 3:1), still disabled. */}
        <EButton palette={band} variant={picked.size === 0 ? 'secondary' : 'primary'} style={picked.size === 0 ? styles.solid : undefined}
          label={words.reviewSelected(picked.size)} disabled={busy || picked.size === 0} onPress={openBatch} />
      </View> : undefined}
      bandContent={<View testID="transfer-review-band" style={styles.bandIntro}>
        {/* The Transfers band's shape: the figure in Geist SemiBold, then what it means. The count is
            the question card's words ("N transfers need an answer"). At large text the headline is
            capped and stays whole words, and everything else moves onto the sheet, as on Transfers,
            so the band never crowds out the list. */}
        <View style={styles.bandFigure}>
          <ThemedText accessibilityRole="header" accessibilityLiveRegion="polite" maxFontSizeMultiplier={largeText ? 1.3 : 1.6}
            style={[styles.headline, largeText && styles.headlineLarge, { color: band.onBand }]}>
            {toCheck > 0 ? activityWords.card.title(toCheck) : words.title}
          </ThemedText>
          {toCheck > 0 && !largeText ? <ThemedText type="meta" style={{ color: band.onBandSecondary }}>{activityWords.notCounted}</ThemedText> : null}
        </View>
        {/* The band stays put over the list, so at large text the explanation moves onto the sheet. */}
        {!focusedId && toCheck > 0 && !largeText ? (
          <ThemedText type="small" style={{ color: band.onBandSecondary }}>{words.intro}</ThemedText>
        ) : null}
      </View>}>
      <FlatList data={listItems} keyExtractor={(item) => item.key}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
        initialNumToRender={8} maxToRenderPerBatch={8} windowSize={7}
        contentContainerStyle={[styles.listContent, { paddingBottom: listBottom }]}
        scrollIndicatorInsets={{ top: 0, bottom: listBottom }} contentInsetAdjustmentBehavior="never"
        ListFooterComponent={matchedSection}
        ListHeaderComponent={<View style={styles.intro}>
          {!focusedId && filter === 'pending' && (toCheck > 0 || selecting) ? <View style={styles.actions}>
            {selecting ? <>
              <ThemedText type="meta" themeColor="textSecondary">{words.selectionHint}</ThemedText>
              <View style={[styles.choiceRow, largeText && styles.choiceRowStacked]}>
                <ChoiceButton testID="transfer-select-shown" primary={false} label={words.selectShown(selectableItems.length)}
                  disabled={busy || selectableItems.length === 0} onPress={selectShown} palette={band} stacked={largeText} />
                {picked.size > 0 ? <ChoiceButton testID="transfer-clear-selection" primary={false} label={words.clearSelection}
                  disabled={busy} onPress={() => { if (!saving.current) setPicked(new Map()); }} palette={band} stacked={largeText} /> : null}
                <ChoiceButton testID="transfer-cancel-selection" primary={false} label={words.cancel} disabled={busy || needsDurability}
                  onPress={() => { if (!saving.current) { setSelecting(false); setPicked(new Map()); } }} palette={band} stacked={largeText} />
              </View>
            </> : <EButton palette={band} variant="secondary" label={words.selectTransfers} disabled={busy}
              onPress={() => { Keyboard.dismiss(); setSelecting(true); }} />}
          </View> : null}
          {toCheck > 0 && largeText ? <ThemedText type="meta" style={{ color: band.textSecondary }}>{activityWords.notCounted}</ThemedText> : null}
          {!focusedId && toCheck > 0 && largeText ? (
            <ThemedText type="small" style={{ color: band.textSecondary }}>{words.intro}</ThemedText>
          ) : null}
          {visiblePairs.length > 0 ? <View testID="transfer-pairs" style={styles.pairs}>
            <ThemedText type="smallBold" accessibilityRole="header" style={{ color: band.text }}>{d.transfers.pairsTitle(visiblePairs.length)}</ThemedText>
            <ThemedText type="meta" style={{ color: band.textSecondary }}>{d.transfers.pairsBody}</ThemedText>
          </View> : null}
          {focusedId ? (
            <EButton palette={band} variant="quiet" label={words.showAll} onPress={() => { setShowAll(true); browse('all'); }} />
          ) : toCheck > 8 || query.length > 0 ? (
            <TextField testID="transfer-search" label={words.search} value={query} onChangeText={setQuery}
              autoCapitalize="none" autoCorrect={false} returnKeyType="search" onSubmitEditing={() => Keyboard.dismiss()}
              leading={<Icon name="search" size={16} color={band.textSecondary} />}
              trailing={query ? <Pressable accessibilityRole="button" accessibilityLabel={words.clearSearch}
                onPress={() => setQuery('')} style={styles.clearSearch}>
                <Icon name="close" size={16} color={band.textSecondary} />
              </Pressable> : undefined} />
          ) : null}
        </View>}
        ListEmptyComponent={<View style={styles.empty}>
          <ThemedText type="subtitle" accessibilityRole="header">{focusedId ? transactionsById.has(focusedId) ? words.notPending : words.missingRoute : deferredQuery.trim() ? words.searchEmpty : filter === 'pending' ? words.empty : words.reviewedEmpty}</ThemedText>
          {focusedId && reconciliation.byId.get(focusedId) ? <ThemedText type="small" themeColor="textSecondary">{statusLabel(reconciliation.byId.get(focusedId)!.status, words)}</ThemedText> : null}
          {!focusedId && deferredQuery.trim() ? <ThemedText type="small" themeColor="textSecondary">{words.searchEmptyBody}</ThemedText> : null}
        </View>}
        renderItem={({ item }) => item.kind === 'pair' ? <PairCard pair={item.pair} busy={busy} palette={band} stacked={largeText}
          outAccount={accountLabels.get(item.pair.out.accountId) ?? words.accountUnknown}
          inAccount={accountLabels.get(item.pair.in.accountId) ?? words.accountUnknown}
          onMatch={() => matchPair(item.pair)} onSeparate={() => separatePair(item.pair)}
          checked={picked.has(item.key)} onSelect={selecting ? () => togglePicked(item) : undefined} />
          : item.kind === 'group' ? <View testID="transfer-review-group" style={segment(item)}>
          <Pressable testID="transfer-group-toggle" accessibilityRole="button"
            accessibilityLabel={`${item.group.summary.account}. ${item.group.summary.counterparty}. ${expanded.has(item.group.id) ? words.collapse : words.expand(item.group.rows.length)}`}
            accessibilityState={{ expanded: !!focusedId || expanded.has(item.group.id), disabled: !!focusedId }}
            disabled={!!focusedId} onPress={() => toggleGroup(item.group.id)} style={styles.groupToggle}>
            {groupRoute(item.group)}
            <View style={styles.routeMeta}>
              {/* How many bank entries this one route stands for, then when, then whether it is answered. */}
              {item.group.rows.length > 1 ? <View testID="transfer-group-count" style={[styles.countPill, { backgroundColor: band.glyphGround }]}>
                <ThemedText type="meta" style={{ color: band.text }}>{words.count(item.group.rows.length)}</ThemedText>
              </View> : null}
              <ThemedText type="meta" style={{ color: band.textSecondary }}>{shortDateWithYear(item.group.rows[0].date)}</ThemedText>
              {filter === 'pending' ? <RouteTag tag="needs-answer" label={activityWords.tags.needsAnswer} palette={band} slate={band.tint} /> : null}
              {!focusedId && <View style={styles.chevron}>
                <Icon name={expanded.has(item.group.id) ? 'chevron-down' : 'chevron-right'} size={16} color={band.textSecondary} />
              </View>}
            </View>
            {(filter === 'reviewed' || item.group.status.startsWith('likely-')) && <ThemedText type="meta" themeColor="textSecondary">{statusLabel(item.group.status, words)}</ThemedText>}
          </Pressable>
          {groupSelect(item)}
          {!selecting && (expanded.has(item.group.id) || focusedId) && filter === 'pending' && item.group.bulkEligible && item.group.rows.length > 1
            ? <EButton palette={band} variant="secondary" label={words.reviewGroup(item.group.rows.length)} onPress={() => openReview(item.group)} />
            : (expanded.has(item.group.id) || focusedId) && filter === 'pending' && item.group.rows.length > 1
              ? <ThemedText type="meta" themeColor="textSecondary">{words.individualOnly}</ThemedText> : null}
        </View> : item.kind === 'more' ? <View style={segment(item)}>
          <EButton palette={band} variant="quiet" label={words.more(item.shown, item.group.rows.length)}
            onPress={() => setLimits(current => ({ ...current, [item.group.id]: item.shown + TRANSFER_HISTORY_PAGE_SIZE }))} />
        </View> : <Pressable testID="transfer-review-entry" accessibilityRole={selecting ? 'checkbox' : 'button'}
          accessibilityState={selecting ? { checked: picked.has(item.key), disabled: busy } : { disabled: busy }}
          aria-checked={selecting ? picked.has(item.key) : undefined} disabled={busy}
          accessibilityLabel={`${selecting ? words.selectItem : item.transaction.transferDecision ? words.undo : words.review}. ${item.transaction.title}. ${fullDateTime(item.transaction)}. ${formatAED(item.transaction.amountFils, { decimals: true })}`}
          onPress={() => selecting ? togglePicked(item) : openReview(item.group, item.transaction)} style={segment(item)}>
          {/* One bank entry of the group above, set in under its route. */}
          <View style={[styles.entry, largeText && styles.entryStacked]}>
            {selecting ? <SelectionMark checked={picked.has(item.key)} palette={band} /> : null}
            <View style={styles.entryText}>
              <ThemedText type="small">{item.transaction.title}</ThemedText>
              <ThemedText type="meta" themeColor="textSecondary" selectable>{fullDateTime(item.transaction)}</ThemedText>
              {item.transaction.transferEvidence?.reference ? <ThemedText type="meta" themeColor="textSecondary" selectable>{words.reference}: {item.transaction.transferEvidence.reference}</ThemedText> : null}
            </View>
            <Money fils={item.transaction.amountFils} sign={item.transaction.type === 'income' ? 'plus' : 'minus'} type="smallBold" decimals />
          </View>
        </Pressable>}
      />
    </BandScaffold>
    {selection ? <BottomSheet visible palette={band} title={selection.batch ? words.batchTitle : selection.undo ? words.undo : words.title}
      testID="transfer-review-confirmation" onClose={closeReview} dismissible={!busy && (!needsDurability || stale)}
      footer={<View style={styles.actions}>
        {!selection.readOnly && <EButton palette={band} label={busy ? words.saving : needsDurability ? words.retrySave : selection.batch ? words.confirmSelected(selection.batch.length) : selection.undo ? words.undo : selection.ownership === 'own' && selection.counterpart?.linkable ? words.linkOwn : words.confirm}
          disabled={busy || stale || selection.ownership === undefined} onPress={() => void save(selection)} />
        }
        <EButton palette={band} variant="quiet" label={selection.batch || selection.readOnly || selection.undo || needsDurability ? words.cancel : words.keepSeparate} disabled={busy || (needsDurability && !stale)} onPress={closeReview} />
      </View>}>
      {selection.batch ? <View testID="transfer-batch-preview" style={styles.choices}>
        <ThemedText type="subtitle" accessibilityRole="header">{words.selectedCount(selection.batch.length)}</ThemedText>
        <ThemedText type="small">{words.batchBody}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{words.ownBody}</ThemedText>
        {selection.batch.slice(0, previewLimit).map((item, index) => {
          // The route this confirmation would save: the recorded account and the other side.
          const incoming = item.summary.direction === 'income';
          const otherName = item.counterpart?.account ?? item.summary.counterparty;
          const other: RouteEnd = !item.counterpart && otherName === words.counterpartyUnknown ? { kind: 'unknown' } : { kind: 'party', name: otherName };
          const account: RouteEnd = { kind: 'party', name: item.summary.account };
          return <View key={index} testID="transfer-batch-preview-item"
            style={[styles.previewItem, { borderColor: band.rule, backgroundColor: band.card }]}>
            <TransferRoute from={incoming ? other : account} to={incoming ? account : other}
              fromLabel={incoming ? shownName(other, otherName) : item.summary.account}
              toLabel={incoming ? item.summary.account : shownName(other, otherName)}
              amountFils={item.summary.total} sign={item.counterpart ? 'none' : incoming ? 'plus' : 'minus'} palette={band} />
            {/* Signed as in the list (a pair unsigned, a single entry by direction); the amount is on
                the route once, and the other leg's amount appears only when it differs. */}
            <ThemedText type="meta" style={{ color: band.textSecondary }}>
              {item.summary.account} · {incoming ? words.received : words.sent} · {item.summary.dates}
            </ThemedText>
            {item.counterpart ? <ThemedText type="meta" style={{ color: band.textSecondary }}>
              {[item.counterpart.account, incoming ? words.sent : words.received,
                item.counterpart.amount !== item.summary.total ? formatAED(item.counterpart.amount, { decimals: true }) : null,
                item.counterpart.date].filter(Boolean).join(' · ')}
            </ThemedText> : <ThemedText type="meta" style={{ color: band.textSecondary }}>{item.record?.title}</ThemedText>}
          </View>;
        })}
        {selection.batch.length > previewLimit ? <EButton palette={band} variant="quiet"
          label={words.more(previewLimit, selection.batch.length)} onPress={() => setPreviewLimit(value => value + TRANSFER_HISTORY_PAGE_SIZE)} /> : null}
      </View> : <>
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
            style={[styles.choice, { backgroundColor: band.card, borderColor: selection.ownership === ownership ? band.tint : band.rule }]}>
            <ThemedText type="smallBold">{label}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{detail}</ThemedText>
          </Pressable>;
        })}
      </View>}
      </>}
      {stale || error ? <ThemedText testID="transfer-review-error" type="small" themeColor="expense" accessibilityRole="alert" accessibilityLiveRegion="polite" selectable>{stale ? words.changed : error}</ThemedText> : null}
    </BottomSheet> : null}
  </>;
}

const styles = StyleSheet.create({
  bandIntro: { gap: Spacing.three },
  bandFigure: { gap: 4, alignItems: 'flex-start' },
  // The band's figure as BandFigure sets it (the large size): Geist SemiBold, tabular digits, never Geist Mono.
  headline: { fontFamily: Fonts.sansSemi, fontSize: 32, lineHeight: 38, letterSpacing: -1, fontVariant: ['tabular-nums'],
    maxWidth: '100%', flexShrink: 1 },
  headlineLarge: { fontSize: 24, lineHeight: 30, letterSpacing: -0.5 },
  solid: { opacity: 1 },
  sheet: { paddingTop: Spacing.two },
  listContent: { gap: 0 },
  intro: { gap: Spacing.three, paddingBottom: Spacing.three },
  pairs: { gap: 10 },
  pairCard: { borderWidth: 1, borderRadius: 18, padding: Spacing.three, gap: Spacing.three, marginBottom: Spacing.three },
  selectControl: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  checkbox: { width: 24, height: 24, borderWidth: 2, borderRadius: 6, justifyContent: 'center', alignItems: 'center' },
  pairLegs: { gap: Spacing.one },
  routeMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  choiceRowStacked: { flexDirection: 'column' },
  choiceButton: { flexGrow: 1, flexShrink: 1, maxWidth: '100%', minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  choiceButtonStacked: { flexGrow: 0, alignSelf: 'stretch' },
  choiceLabel: { textAlign: 'center' },
  // One card per group: its route, then its entries and "Show more" set in below it.
  segment: { paddingHorizontal: Spacing.three },
  segmentFirst: { borderTopStartRadius: 18, borderTopEndRadius: 18, paddingBottom: Spacing.three, gap: Spacing.two },
  segmentLast: { borderBottomStartRadius: 18, borderBottomEndRadius: 18, marginBottom: Spacing.two },
  groupToggle: { minHeight: 48, paddingTop: Spacing.three, gap: Spacing.one },
  countPill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  chevron: { marginStart: 'auto' },
  entry: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.three, paddingStart: Spacing.three },
  entryStacked: { flexDirection: 'column', alignItems: 'flex-start' },
  entryText: { flex: 1, minWidth: 0, gap: 2 },
  matched: { paddingTop: Spacing.four },
  matchedHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingBottom: Spacing.two },
  matchedCard: { borderRadius: 18, paddingHorizontal: Spacing.three },
  matchedRow: { minHeight: 60, paddingVertical: Spacing.three, gap: Spacing.one },
  matchedLink: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  facts: { gap: Spacing.one },
  flexText: { flex: 1, flexShrink: 1 },
  clearSearch: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  empty: { paddingVertical: Spacing.six, gap: Spacing.two },
  actions: { gap: Spacing.two },
  choices: { gap: Spacing.two },
  previewItem: { borderWidth: 1, borderRadius: 14, padding: Spacing.three, gap: Spacing.one },
  choice: { minHeight: 48, padding: Spacing.three, borderWidth: 1.5, borderRadius: 14, gap: Spacing.one },
});
