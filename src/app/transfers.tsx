import { useLocalSearchParams } from 'expo-router';
import { useRouter } from '@/hooks/use-app-router';
import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Keyboard, Platform, Pressable, StyleSheet, View } from 'react-native';

import { EntryDetailSheet } from '@/components/entry-detail-sheet';
import { PeriodSheet } from '@/components/period-sheet';
import { ThemedText } from '@/components/themed-text';
import { introCues, legTags, newlyAnsweredRoutes, routeLegIds, type CoinCue } from '@/components/transfer-coins/coin-cues';
import { TransferAnswerChoices } from '@/components/transfers/transfer-answer-choices';
import { TransferAnswerSheet } from '@/components/transfers/transfer-answer-sheet';
import { TransferGroupRow, type TransferGroupView } from '@/components/transfers/transfer-group-row';
import { TransferPeopleToggle, TransferPersonRow, type TransferPersonView } from '@/components/transfers/transfer-person-row';
import { TransferQuestionCard } from '@/components/transfers/transfer-question-card';
import { TransferRouteRow } from '@/components/transfers/transfer-route-row';
import { ActionIconButton } from '@/components/ui/action-icon-button';
import { BandFigure } from '@/components/ui/band/band-figure';
import { BandScaffold, useBandBottomInset } from '@/components/ui/band-scaffold';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { TextField } from '@/components/ui/text-field';
import { Spacing, type BandPalette } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useLedgerMoney } from '@/hooks/use-ledger-money';
import { useTransferAnswer } from '@/hooks/use-transfer-answer';
import { useTransferBatch } from '@/hooks/use-transfer-batch';
import { clockTime, formatAED, shortDateWithYear } from '@/lib/format';
import { t, tf } from '@/lib/i18n';
import { accountDisplayName, transferReconciliationForState } from '@/lib/ledger';
import { formatMinorUnits } from '@/lib/ledger-money';
import { bankBrandForName } from '@/lib/markets';
import { inPeriod, isCurrentMonth, periodLabel } from '@/lib/period';
import { usePeriod } from '@/lib/period-context';
import { useStore } from '@/lib/store';
import { duplicateTransactionIds, getTransferActivity, unaskedPendingIds,
  type TransferActivityRecord } from '@/lib/transfer-activity';
import { transferActivityCopy, transferMetaLine, unbroken } from '@/lib/transfer-activity-copy';
import { ownCandidates, type TransferAnswer } from '@/lib/transfer-answer';
import { freezeTransferRows, transferAnswerGroups, transferBatchChangedIds, transferBatchIncoming,
  type TransferBatchItem } from '@/lib/transfer-batch';
import { absorbedOwnIncoming, filterTransferItems, transferListItems, transferTotals,
  type RouteEnd, type TransferListItem, type TransferTag, type TransferTile } from '@/lib/transfer-list';
import { matchedTransferPairs, suggestedTransferPairs } from '@/lib/transfer-pairs';
import { personGroup, transferPeople, transferQuestions, transferUnnamedWaiting, transferWaitingSummary } from '@/lib/transfer-people';
import { isTransferCandidate, reconcileTransfers } from '@/lib/transfer-reconciliation';
import type { TransferEvidence } from '@/lib/transfer-reconciliation-types';
import { projectTransferHistory } from '@/lib/transfer-review-presentation';
import { rowsByIdFor } from '@/lib/rows-by-id';
import type { Transaction } from '@/lib/types';

const TILES = [['own', 'repeat'], ['sent', 'arrow-up-right'], ['received', 'arrow-down-right']] as const;
/** Assessments whose named other side is a suggestion worth showing under "my own account". */
const SUGGESTED = new Set(['likely-own', 'likely-card-repayment']);

type GroupRow = { kind: 'group'; key: string; group: TransferGroupView };
/** Every waiting transfer with one person: one answer for all of them. */
type PersonRow = { kind: 'person'; key: string; person: TransferPersonView };
/** "Show all N people" under the first few. */
type ToggleRow = { kind: 'people-toggle'; key: string };
type HeaderRow = { kind: 'header'; key: string; title: string };
type ListRow = TransferListItem | GroupRow | PersonRow | ToggleRow | HeaderRow;
/** Pickable rows: a group, a person or one route. */
type PickRow = GroupRow | PersonRow | TransferListItem;
/** People listed before "Show all N people" (select mode lists everyone). */
const PEOPLE_SHOWN = 5;

/** A masked other account the bank named ("ADCB ••4999"); never a claim that it is the person's. */
function counterpartName(counterparty: NonNullable<TransferEvidence['counterparty']>): string {
  const bank = counterparty.bankIdentity ? bankBrandForName(counterparty.bankIdentity)?.name ?? counterparty.bankIdentity : undefined;
  return [bank, `••${counterparty.last4}`].filter(Boolean).join(' ');
}

/**
 * A select-mode control in the question card's button style (48pt, 14pt
 * radius). Disabled is drawn, not faded: a ruled outline with the secondary
 * ink, which keeps its label above 3:1.
 */
function SelectControl({ label, disabled, onPress, palette, testID, stacked }: {
  label: string; disabled: boolean; onPress: () => void; palette: BandPalette; testID: string; stacked: boolean;
}) {
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} disabled={disabled}
    accessibilityState={{ disabled }} onPress={onPress}
    style={({ pressed }) => [styles.control, stacked && styles.controlStacked,
      { backgroundColor: palette.sheet, borderWidth: 1, borderColor: disabled ? palette.rule : palette.textSecondary,
        opacity: !disabled && pressed ? 0.7 : 1 }]}>
    <ThemedText type="smallBold" style={[styles.controlLabel, { color: disabled ? palette.textSecondary : palette.text }]}>{label}</ThemedText>
  </Pressable>;
}

export default function TransfersScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ transactionId?: string | string[] }>();
  const linkedId = Array.isArray(params.transactionId) ? params.transactionId[0] : params.transactionId;
  const band = useBand('accounts');
  const language = useLanguage();
  const words = transferActivityCopy(language);
  const large = useLargeTextLayout();
  const moneySpec = useLedgerMoney();
  const { state, getStateGeneration } = useStore();
  const { period } = usePeriod();
  const listBottom = useBandBottomInset();
  // One answer hook for the page, its group and selection saves' Undo and the entry sheet: while any of
  // them writes, every control here waits.
  const answers = useTransferAnswer();
  const { answer, busy: answering } = answers;
  const [tile, setTile] = useState<TransferTile | null>(null);
  const [query, setQuery] = useState('');
  const search = useDeferredValue(query.trim().toLocaleLowerCase());
  const [periodOpen, setPeriodOpen] = useState(false);
  // A link to one entry (an old Review transfers link) opens that entry's "What is this?" here.
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const row = linkedId ? state.transactions.find(entry => entry.id === linkedId) : undefined;
    return row && isTransferCandidate(row) ? row.id : null;
  });
  // Set with selectedId when the sheet opens for the several-accounts question: it starts on the picker.
  const [pickFor, setPickFor] = useState<string | null>(null);
  // Reuse the reconciliation keyed on the stored transfer receipt. Only while a
  // history import holds a provisional receipt does this dedicated screen
  // build the graph itself (array-identity memoized in the reconciler).
  const storedReconciliation = transferReconciliationForState(state);
  const reconciliation = useMemo(() => storedReconciliation ?? reconcileTransfers(state.transactions, state.accounts),
    [storedReconciliation, state.transactions, state.accounts]);
  const activity = useMemo(() => getTransferActivity(state.transactions, state.accounts, reconciliation),
    [state.transactions, state.accounts, reconciliation]);
  const accounts = useMemo(() => new Map(state.accounts.map(account => [account.id, account])), [state.accounts]);
  const rowsById = rowsByIdFor(state.transactions);
  const selectedRecord = selectedId ? activity.find(item => item.transaction.id === selectedId) : undefined;
  // Grouped, suggested-pair and linked entries are not all in the activity list; the sheet still opens on them.
  const selectedTransaction = selectedRecord?.transaction ?? (selectedId ? rowsById.get(selectedId) : undefined);
  const selectedAssessment = selectedRecord?.assessment ?? (selectedId ? reconciliation.byId.get(selectedId) : undefined);
  // A confirmed pair belongs to the period of its outgoing leg and is always listed whole:
  // both legs come in with it, and the incoming leg of a pair that left in another period stays out.
  const allPairs = useMemo(() => matchedTransferPairs(reconciliation, rowsById), [reconciliation, rowsById]);
  const pairs = useMemo(() => allPairs.filter(pair => inPeriod(pair.out.date, period)),
    // monthKey reads the StoreProvider's active salary-day setting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allPairs, period, state.monthStartDay]);
  const accountName = (id: string) => {
    const account = accounts.get(id);
    return account ? accountDisplayName(account) : words.accountUnknown;
  };
  const moneyLabel = (fils: number) => moneySpec
    ? `${moneySpec.currency} ${formatMinorUnits(fils, moneySpec, { decimals: true })}`
    : formatAED(fils, { decimals: true });
  const matchesSearch = (tx: Transaction) => {
    const account = accounts.get(tx.accountId);
    return [tx.title, account?.name, account?.bankName, account?.last4,
      tx.transferEvidence?.counterpartyName,
      tx.transferEvidence?.counterparty?.last4].filter(Boolean).join(' ').toLocaleLowerCase().includes(search);
  };
  const periodItems = useMemo(() => {
    const inPair = new Set(pairs.flatMap(pair => [pair.out.id, pair.in.id]));
    const outOfPeriod = new Set(allPairs.flatMap(pair => inPair.has(pair.out.id) ? [] : [pair.out.id, pair.in.id]));
    return transferListItems(activity.filter(item => !outOfPeriod.has(item.transaction.id)
      && (inPair.has(item.transaction.id) || inPeriod(item.transaction.date, period))), pairs);
  // monthKey reads the StoreProvider's active salary-day setting.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity, allPairs, pairs, period, state.monthStartDay]);
  const pairsByKey = useMemo(() => new Map(pairs.map(pair => [pair.key, pair])), [pairs]);
  // Search is applied to whole routes: a pair matches when either leg does.
  const items = useMemo(() => !search ? periodItems : periodItems.filter(item => {
    const pair = pairsByKey.get(item.key);
    const legs = pair ? [pair.out, pair.in] : [rowsById.get(item.transactionId)];
    return legs.some(tx => !!tx && matchesSearch(tx));
  // matchesSearch closes over search and accounts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [periodItems, pairsByKey, rowsById, search, accounts]);
  // Unlinked own legs are paired across the whole history before any period or
  // search filter, so a transfer that left on 30 Sep and arrived on 1 Oct
  // counts once, in September.
  const absorbed = useMemo(() => absorbedOwnIncoming(transferListItems(activity, allPairs)), [activity, allPairs]);
  const totals = useMemo(() => transferTotals(items, absorbed), [items, absorbed]);

  // ---- Waiting for an answer: groups, suggested pairs, and every queued entry ----
  // Suggested own-account pairs (amount and time match on two of the person's accounts) are asked
  // about as one route; neither leg joins a group.
  const listedIds = useMemo(() => new Set(activity.map(item => item.transaction.id)), [activity]);
  const suggested = useMemo(() => suggestedTransferPairs(reconciliation, rowsById)
    .filter(pair => listedIds.has(pair.out.id) && listedIds.has(pair.in.id)), [reconciliation, rowsById, listedIds]);
  const suggestedByKey = useMemo(() => new Map(suggested.map(pair => [pair.key, pair])), [suggested]);
  const answerGroups = useMemo(() => transferAnswerGroups({ groups: reconciliation.groups, pendingIds: reconciliation.pendingIds,
    rowsById, excludeIds: new Set(suggested.flatMap(pair => [pair.out.id, pair.in.id])), listedIds,
    assessments: reconciliation.byId, duplicateIds: duplicateTransactionIds(state.transactions) }),
  [reconciliation, rowsById, suggested, listedIds, state.transactions]);
  const answerGroupById = useMemo(() => new Map(answerGroups.map(group => [group.id, group])), [answerGroups]);
  // Every other waiting transfer that names who the money went to or came from, one group per person
  // (built once per activity list, so once per stored transfer receipt).
  const people = useMemo(() => transferPeople(activity), [activity]);
  const groupedIds = useMemo(() => new Set([...answerGroups.flatMap(group => group.transactionIds), ...people.flatMap(group => group.ids)]),
    [answerGroups, people]);
  // Search narrows a person to the entries it matches; the counts, totals and dates then describe exactly
  // the entries one answer would change.
  const personViews = useMemo<TransferPersonView[]>(() => !search ? people : people.flatMap(group => {
    const rows = group.ids.map(id => rowsById.get(id)).filter((row): row is Transaction => !!row && matchesSearch(row));
    return rows.length ? [personGroup(group.key, group.name, rows)] : [];
  }),
  // matchesSearch closes over search and accounts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [people, rowsById, search, accounts]);
  const [allPeople, setAllPeople] = useState(false);
  // Groups are not a period's history but a to-do: every date, bounded (collapsed) however many
  // entries they hold. Search narrows each group to its matching entries, as the bulk review did.
  const groupLabels = useMemo(() => new Map(state.accounts.map(account => [account.id, accountDisplayName(account)])), [state.accounts]);
  const projected = useMemo(() => projectTransferHistory({ groups: answerGroups, rowsById, accountLabels: groupLabels, scope: 'all',
    todayISO: new Date().toISOString().slice(0, 10), query: search, moneyLabel: amount => formatAED(amount, { decimals: true }) }).groups,
  [answerGroups, rowsById, groupLabels, search]);
  /** The other accounts the reconciler suggests these entries moved to or from. */
  const suggestedAccounts = (ids: readonly string[]) => {
    const names = new Set<string>();
    for (const id of ids) {
      const other = matchedEntry(id);
      if (other && other.accountId !== rowsById.get(id)?.accountId) names.add(accountName(other.accountId));
    }
    return [...names];
  };
  /** The entry the reconciler matched to this one (what, when, how much): the old review sheet's "matching bank entry". */
  const matchedEntry = (id: string) => {
    const assessment = reconciliation.byId.get(id);
    return assessment?.counterpartId && SUGGESTED.has(assessment.status) ? rowsById.get(assessment.counterpartId) : undefined;
  };
  // What, when (the app's short date and its clock, as every Transfers line) and how much, each part isolated.
  const matchParts = (other: Transaction) => [other.title, words.dateTime(shortDateWithYear(other.date), clockTime(other)),
    unbroken(moneyLabel(other.amountFils))];
  const matchDetail = (other: Transaction) => transferMetaLine(matchParts(other));
  const groupViews = useMemo<TransferGroupView[]>(() => projected.map(group => {
    const account = accountName(group.accountId);
    const otherName = group.counterpartyName ?? (group.counterparty ? counterpartName(group.counterparty) : undefined);
    const other: RouteEnd = otherName ? { kind: 'party', name: otherName } : { kind: 'unknown' };
    const mine: RouteEnd = { kind: 'account', accountId: group.accountId };
    const incoming = group.direction === 'income';
    const otherLabel = otherName ?? '?', otherSpoken = otherName ?? words.route.unknown;
    const likely = suggestedAccounts(group.transactionIds);
    const source = answerGroupById.get(group.id);
    return { key: group.id, ids: group.transactionIds, direction: group.direction,
      whole: !!source?.whole && !source.duplicate, ...(source?.duplicate ? { blocked: words.group.duplicate } : {}),
      from: incoming ? other : mine, to: incoming ? mine : other,
      fromLabel: incoming ? otherLabel : account, toLabel: incoming ? account : otherLabel,
      fromSpoken: incoming ? otherSpoken : account, toSpoken: incoming ? account : otherSpoken,
      totalFils: group.rows.reduce((sum, row) => sum + row.amountFils, 0), count: group.rows.length,
      newest: group.rows[0].date, oldest: group.rows[group.rows.length - 1].date,
      ...(likely.length === 1 ? { hint: words.answers.looksLike(likely[0]) } : {}) };
  // accountName and suggestedAccounts read accounts, reconciliation and the language's copy.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [projected, answerGroupById, accounts, reconciliation, rowsById, words]);

  // ---- Select several ----
  const [coins, setCoins] = useState<ReadonlyMap<string, CoinCue>>(() => new Map());
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlyMap<string, TransferBatchItem>>(() => new Map());
  // Select mode: the catch-all groups opened to show their entries, each ticked on its own.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [linkNotice, setLinkNotice] = useState<string | null>(() => {
    if (!linkedId) return null;
    const row = state.transactions.find(entry => entry.id === linkedId);
    return !row ? words.link.missing : isTransferCandidate(row) ? null : words.link.notTransfer;
  });
  // Rows a group or selection answer just changed: their coins travel when they reach the list.
  const justAnswered = useRef<ReadonlySet<string>>(new Set());
  const batch = useTransferBatch({ rowsById, answers, onSaved: changedIds => {
    justAnswered.current = new Set(changedIds);
    setPicked(new Map());
    setExpanded(new Set());
    setSelecting(false);
  } });
  const busy = answering || batch.busy;
  // Select mode lists everything still waiting, whatever the period: people, then groups, then each waiting
  // entry, a suggested pair as one route.
  const selectRows = useMemo(() => {
    // Every transfer still waiting for an answer, queued by the reconciler or not, that no group or person holds.
    const waiting = activity.filter(item => !item.confirmed && !item.transaction.transferDecision && !groupedIds.has(item.transaction.id));
    const ids = new Set(waiting.map(item => item.transaction.id));
    const routes = transferListItems(waiting, suggested.filter(pair => ids.has(pair.out.id) && ids.has(pair.in.id)));
    return !search ? routes : routes.filter(item => (suggestedByKey.get(item.key) ? [suggestedByKey.get(item.key)!.out, suggestedByKey.get(item.key)!.in]
      : [rowsById.get(item.transactionId)]).some(tx => !!tx && matchesSearch(tx)));
  // matchesSearch closes over search and accounts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity, groupedIds, suggested, suggestedByKey, rowsById, search, accounts]);
  const periodTitle = isCurrentMonth(period) ? words.listTitle : periodLabel(period);
  // A tile filters the period's answered transfers; groups wait for an answer, so they step aside.
  const groupRows = useMemo<GroupRow[]>(() => tile ? []
    : groupViews.map(group => ({ kind: 'group', key: `group:${group.key}`, group })), [tile, groupViews]);
  const personRows = useMemo<PersonRow[]>(() => tile ? []
    : personViews.map(person => ({ kind: 'person', key: person.key, person })), [tile, personViews]);
  // The first few people, most transfers first, then "Show all N people"; select mode lists everyone.
  const peopleFolded = !allPeople && personRows.length > PEOPLE_SHOWN + 1;
  const shownPeople = useMemo<(PersonRow | ToggleRow)[]>(() => personRows.length > PEOPLE_SHOWN + 1
    ? [...(allPeople ? personRows : personRows.slice(0, PEOPLE_SHOWN)), { kind: 'people-toggle', key: 'people-toggle' }]
    : personRows, [personRows, allPeople]);
  const waitingRows = personRows.length + groupRows.length;
  // A grouped entry is answered with its group, so it is not listed a second time on its own.
  const periodRows = useMemo(() => filterTransferItems(items, tile).filter(item => !routeLegIds(item).some(id => groupedIds.has(id))),
    [items, tile, groupedIds]);
  const activityById = useMemo(() => new Map(activity.map(record => [record.transaction.id, record] as const)), [activity]);
  /** A catch-all group's entries as their own rows (select mode, opened): each is ticked on its own. */
  const groupEntryRows = (view: TransferGroupView): TransferListItem[] => transferListItems(view.ids.flatMap(id => {
    const listed = activityById.get(id);
    if (listed) return [listed];
    // An entry listed nowhere else on the page (an archived account) is drawn from the ledger row as it waits.
    const transaction = rowsById.get(id), assessment = reconciliation.byId.get(id);
    return transaction && assessment ? [{ transaction, assessment, ownership: 'unknown', confirmed: false, needsReview: true } satisfies TransferActivityRecord] : [];
  }), []);
  const selectGroupRows = useMemo<ListRow[]>(() => groupRows.flatMap(row => row.group.whole || row.group.blocked || !expanded.has(row.key)
    ? [row] : [row, ...groupEntryRows(row.group)]),
  // groupEntryRows reads activity, the ledger rows and the reconciliation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [groupRows, expanded, activityById, rowsById, reconciliation]);
  const data = useMemo<ListRow[]>(() => selecting ? [...personRows, ...selectGroupRows, ...selectRows]
    : waitingRows ? [...shownPeople, ...groupRows, ...(periodRows.length ? [{ kind: 'header' as const, key: 'header:period', title: periodTitle }] : []), ...periodRows]
      : periodRows, [selecting, personRows, selectGroupRows, groupRows, shownPeople, waitingRows, selectRows, periodRows, periodTitle]);
  // An opened catch-all group's entries: each is ticked on its own, by hand, never by Select all.
  const openedEntryKeys = useMemo(() => new Set(selectGroupRows.flatMap(row => 'kind' in row ? [] : [row.key])), [selectGroupRows]);
  // What Select all ticks: a whole group (one answer for all its entries) or one waiting route. A catch-all
  // group is never ticked whole, its opened entries only one by one, and a blocked row never at all.
  const selectable = useMemo(() => data.filter((row): row is PickRow => 'kind' in row
    ? row.kind === 'person' || (row.kind === 'group' && row.group.whole && !row.group.blocked) : !openedEntryKeys.has(row.key)), [data, openedEntryKeys]);
  // What is ticked is only ever what the list shows now. A ticked row that search, a closed group or the
  // ledger has taken off the list is unticked, and a ticked group must still be one answer for exactly
  // the entries it showed when it was ticked (a catch-all group that became whole drops its ticked entries,
  // which are no longer rows). So nothing hidden is saved, and no entry is ever answered twice.
  const livePicked = useMemo(() => {
    const shown = new Map(data.map(row => [row.key, row] as const));
    const kept = [...picked].filter(([key, item]) => {
      const row = shown.get(key);
      if (!row || ('kind' in row && (row.kind === 'header' || row.kind === 'people-toggle'))) return false;
      if (item.kind !== 'group') return !('kind' in row);
      if (!('kind' in row)) return false;
      const ids = row.kind === 'person' ? row.person.ids
        : row.kind === 'group' && row.group.whole && !row.group.blocked ? row.group.ids : null;
      if (!ids) return false;
      const frozen = new Set(item.ids);
      return ids.length === frozen.size && ids.every(id => frozen.has(id));
    });
    return kept.length === picked.size ? picked : new Map(kept);
  }, [data, picked]);
  // Make the untick stick: a row that comes back into view is not ticked again by itself.
  useEffect(() => {
    if (livePicked !== picked) setPicked(livePicked);
  }, [livePicked, picked]);

  /** Freeze one list row as the person sees it now: its rows' fingerprints, the generation, the route. */
  const batchItem = (row: PickRow): TransferBatchItem | null => {
    const generation = getStateGeneration();
    if ('kind' in row && row.kind === 'person') {
      // Every waiting transfer with this person, answered as the person: one decision per entry,
      // never linked (no entry here has another side to link to).
      const person = row.person;
      const rows = person.ids.map(id => rowsById.get(id)).filter((entry): entry is Transaction => !!entry && !entry.transferDecision);
      if (!rows.length || rows.length !== person.ids.length) return null;
      const count = person.incoming + person.outgoing;
      return { key: row.key, kind: 'group', ids: person.ids,
        direction: person.incoming && person.outgoing ? 'between' : person.incoming ? 'income' : 'expense',
        expectedFingerprints: freezeTransferRows(rows), expectedGeneration: generation,
        preview: { from: { kind: 'party', name: person.name }, to: { kind: 'party', name: person.name }, fromLabel: person.name,
          toLabel: person.name, amountFils: person.inFils + person.outFils, sign: 'none', count,
          dates: person.oldest !== person.newest ? words.dateRange(shortDateWithYear(person.oldest), shortDateWithYear(person.newest))
            : shortDateWithYear(person.newest),
          spoken: `${person.name}. ${words.person.transfers(count)}`,
          person: { name: person.name, initial: person.initial, incoming: person.incoming, outgoing: person.outgoing,
            inFils: person.inFils, outFils: person.outFils } } };
    }
    if ('kind' in row) {
      const view = row.group;
      // Entries stored twice under one id are never answered.
      if (view.blocked) return null;
      const rows = view.ids.map(id => rowsById.get(id)).filter((entry): entry is Transaction => !!entry);
      if (rows.length !== view.ids.length) return null;
      return { key: row.key, kind: 'group', ids: view.ids, direction: view.direction,
        expectedFingerprints: freezeTransferRows(rows), expectedGeneration: generation,
        // A catch-all group's sheet only lists its entries; each is answered on its own.
        ...(view.whole ? {} : { listOnly: true as const }),
        preview: { from: view.from, to: view.to, fromLabel: view.fromLabel, toLabel: view.toLabel, amountFils: view.totalFils,
          sign: view.direction === 'income' ? 'plus' : 'minus', count: view.count,
          dates: view.oldest !== view.newest ? words.dateRange(shortDateWithYear(view.oldest), shortDateWithYear(view.newest)) : shortDateWithYear(view.newest),
          spoken: `${view.fromSpoken} ${words.route.to} ${view.toSpoken}`, ...(view.hint ? { hint: view.hint } : {}) } };
    }
    const pair = suggestedByKey.get(row.key);
    const named = (end: RouteEnd) => end.kind === 'account' ? accountName(end.accountId) : end.kind === 'party' ? end.name : words.route.unknown;
    const preview = { from: row.from, to: row.to, fromLabel: row.from.kind === 'unknown' ? '?' : named(row.from),
      toLabel: row.to.kind === 'unknown' ? '?' : named(row.to), amountFils: row.amountFils, dates: shortDateWithYear(row.date),
      spoken: `${named(row.from)} ${words.route.to} ${named(row.to)}` };
    if (pair) {
      const anchor = pair.anchorId === pair.out.id ? pair.out : pair.in;
      const other = anchor.id === pair.out.id ? pair.in : pair.out;
      return { key: row.key, kind: 'pair', ids: [anchor.id], counterpartId: other.id, direction: 'between',
        expectedFingerprints: freezeTransferRows([anchor, other]), expectedGeneration: generation,
        preview: { ...preview, sign: 'none', count: 2,
          ...(pair.in.amountFils !== pair.out.amountFils ? { note: `${words.incoming}: ${moneyLabel(pair.in.amountFils)}` } : {}) } };
    }
    const entry = rowsById.get(row.transactionId);
    if (!entry || entry.transferDecision) return null;
    const other = matchedEntry(entry.id);
    return { key: row.key, kind: 'entry', ids: [entry.id], direction: entry.type === 'income' ? 'income' : 'expense',
      expectedFingerprints: freezeTransferRows([entry]), expectedGeneration: generation,
      preview: { ...preview, sign: entry.type === 'income' ? 'plus' : 'minus', count: 1,
        ...(other && other.accountId !== entry.accountId ? { hint: words.answers.looksLike(accountName(other.accountId)) } : {}) } };
  };
  /** Select mode, a catch-all group: show or hide its entries. Hiding them unticks them, so nothing hidden is saved. */
  const toggleExpanded = (row: GroupRow) => {
    if (busy) return;
    Keyboard.dismiss();
    const open = expanded.has(row.key);
    setExpanded(current => {
      const next = new Set(current);
      if (open) next.delete(row.key); else next.add(row.key);
      return next;
    });
    if (open) {
      const keys = new Set(groupEntryRows(row.group).map(item => item.key));
      setPicked(current => [...current.keys()].some(key => keys.has(key))
        ? new Map([...current].filter(([key]) => !keys.has(key))) : current);
    }
  };
  const togglePicked = (row: PickRow) => {
    if (busy) return;
    if ('kind' in row && row.kind === 'group' && (row.group.blocked || !row.group.whole)) {
      if (!row.group.blocked) toggleExpanded(row);
      return;
    }
    Keyboard.dismiss();
    const item = livePicked.has(row.key) ? null : batchItem(row);
    setPicked(current => {
      const next = new Map([...current].filter(([key]) => livePicked.has(key)));
      if (next.has(row.key)) next.delete(row.key); else if (item) next.set(row.key, item);
      return next;
    });
  };
  const selectAll = () => {
    if (busy) return;
    Keyboard.dismiss();
    const additions = selectable.filter(row => !livePicked.has(row.key)).map(batchItem)
      .filter((item): item is TransferBatchItem => !!item);
    setPicked(new Map([...livePicked, ...additions.map(item => [item.key, item] as const)]));
  };
  const startSelecting = () => {
    if (busy) return;
    Keyboard.dismiss();
    if (tile) setTile(null);
    setSelecting(true);
  };
  const stopSelecting = () => {
    if (busy || batch.needsDurability) return;
    setSelecting(false);
    setPicked(new Map());
    setExpanded(new Set());
  };
  const openGroup = (row: GroupRow | PersonRow, answer: TransferAnswer | null = null) => {
    if (busy || (row.kind === 'group' && row.group.blocked)) return;
    Keyboard.dismiss();
    const item = batchItem(row);
    if (item) batch.open([item], answer);
  };
  const pickedItems = [...livePicked.values()];
  const pickedIncoming = transferBatchIncoming(pickedItems);
  const sheetEntries = batch.batch?.items.length === 1 && batch.batch.items[0].kind === 'group'
    ? batch.batch.items[0].ids.map(id => rowsById.get(id)).filter((row): row is Transaction => !!row) : undefined;
  // Each listed entry names its own likely other side; one entry's sheet names it under the own answer.
  const entryMatch = (id: string) => {
    const other = matchedEntry(id);
    return other ? transferMetaLine([words.answers.looksLike(accountName(other.accountId)), ...matchParts(other)]) : undefined;
  };
  const sheetIds = batch.batch?.items.flatMap(item => [...item.ids, ...(item.counterpartId ? [item.counterpartId] : [])]) ?? [];
  const sheetMatch = batch.batch && transferBatchChangedIds(batch.batch.items).length === 1 ? matchedEntry(sheetIds[0]) : undefined;
  // Under the own answer: the one account these look like, or (when they look like different
  // accounts) a line pointing at each entry's own hint. A suggestion is never "Linked to".
  const sheetSuggestion = useMemo(() => {
    if (!batch.batch || batch.batch.items.some(item => item.listOnly)) return undefined;
    const names = suggestedAccounts(batch.batch.items.flatMap(item => item.ids));
    return names.length === 1 ? words.answers.looksLike(names[0]) : names.length > 1 ? words.answers.looksLikeEach : undefined;
  // suggestedAccounts reads accounts and reconciliation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch.batch, accounts, reconciliation, rowsById, words]);

  // A coin travels a route when the list first appears (the first few rows only) and again
  // the moment its question is answered, own account or someone else, however it was
  // answered (the card, the detail sheet, a group or a selection): the "?" it travels to becomes the answer.
  const introduced = useRef(false);
  const lastTags = useRef<ReadonlyMap<string, TransferTag> | null>(null);
  useEffect(() => {
    if (introduced.current || !periodRows.length) return;
    introduced.current = true;
    const intro = introCues(periodRows.map(item => item.key), Date.now());
    setCoins(previous => new Map([...previous, ...intro]));
  }, [periodRows]);
  useEffect(() => {
    const previous = lastTags.current;
    lastTags.current = legTags(periodItems);
    if (!previous) return;
    // A group's entries may not have been listed before they were answered: they were waiting all the same.
    const before = new Map(previous);
    for (const id of justAnswered.current) if (!before.has(id)) before.set(id, 'needs-answer');
    const arrived = newlyAnsweredRoutes(before, periodItems);
    if (arrived.length) justAnswered.current = new Set();
    if (!arrived.length) return;
    const at = Date.now();
    setCoins(cues => new Map([...cues, ...arrived.map(key => [key, { at, delay: 0 }] as const)]));
  }, [periodItems]);
  // The questions are the reconciler's queue, newest first, whatever the period or search.
  // Saving an answer takes the row out of the queue, so the card always shows the first one.
  // A pair with both legs queued is one movement: one question, asked about its outgoing leg.
  // Home and the Transactions summary count the same transfers (transferWaitingSummary), so the numbers agree.
  // Before them come the people, most transfers first (one answer settles each person) (transferQuestions).
  // Waiting transfers that name nobody are not walked one by one: they stay listed as "Needs an answer"
  // rows and the card's footer opens select mode for them.
  const questions = useMemo(() => transferQuestions(activity), [activity]);
  const unnamedCount = useMemo(() => transferUnnamedWaiting(activity).length, [activity]);
  // How many transfers wait (a pair once): the same count as Home's Needs you and the Transactions summary.
  const waitingCount = useMemo(() => transferWaitingSummary(activity).transfers, [activity]);
  // Queued entries the card cannot ask about (duplicate observations, archived accounts,
  // likely card repayments) are listed as groups above the period's transfers and reached
  // together through select mode: keep "See all" open.
  const unasked = useMemo(() => unaskedPendingIds(activity, reconciliation.pendingIds).size, [activity, reconciliation]);
  const question = questions[0];
  const current = question?.kind === 'entry' ? question.record : undefined;
  const hint = useMemo(() => {
    if (!current) return undefined;
    const [candidate] = ownCandidates(current.transaction, current.assessment, rowsById);
    return candidate ? words.card.looksLike(accountName(candidate.accountId)) : undefined;
  // accountName reads accounts and the language's copy.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, rowsById, accounts, words]);
  const answerCurrent = async (choice: TransferAnswer) => {
    // A person: the confirmation sheet opens on that answer with every entry listed and counted; nothing is
    // saved until Save. The whole person, whatever the search: the card is not narrowed by it.
    if (question?.kind === 'person') { openGroup({ kind: 'person', key: question.key, person: question.person }, choice); return; }
    if (!current) return;
    const candidates = ownCandidates(current.transaction, current.assessment, rowsById);
    // Several accounts could be the other side: the detail sheet asks which.
    if (choice === 'own' && candidates.length > 1) { setSelectedId(current.transaction.id); setPickFor(current.transaction.id); return; }
    const labels = current.transaction.type === 'income' ? words.answers.in : words.answers.out;
    await answer({ transaction: current.transaction, answer: choice, counterpart: candidates[0], label: labels[choice] });
  };

  // At the default sizes the tiles sit on the band; at accessibility text sizes they would crowd the
  // list out of the screen, so they move onto the sheet and scroll away with it.
  const tilesOnBand = !large;
  const tiles = <View testID="transfers-tiles" style={[styles.tiles, large && styles.tilesStack]}>
    {TILES.map(([key, icon]) => {
      const on = tile === key;
      const fils = key === 'own' ? totals.ownFils : key === 'sent' ? totals.sentFils : totals.receivedFils;
      const counted = key !== 'own';
      const ground = tilesOnBand ? (on ? band.onBand : band.tile) : (on ? band.fill : band.card);
      const ink = tilesOnBand ? (on ? band.band : band.onBand) : (on ? band.onFill : band.text);
      const quiet = tilesOnBand ? (on ? band.band : band.onBandSecondary) : (on ? band.onFill : band.textSecondary);
      return <Pressable key={key} testID={`transfers-tile-${key}`} accessibilityRole="button"
        accessibilityState={{ selected: on }}
        accessibilityLabel={`${words.tiles[key]}. ${moneyLabel(fils)}${counted ? `. ${words.tiles.counted}` : ''}`}
        onPress={() => setTile(on ? null : key)}
        style={[styles.tile, { backgroundColor: ground }, !tilesOnBand && { borderWidth: 1, borderColor: on ? band.fill : band.rule }]}>
        <Icon name={icon} size={15} color={ink} />
        <ThemedText type="meta" style={{ color: quiet }}>{words.tiles[key]}</ThemedText>
        <Money fils={fils} type="smallBold" decimals color={ink} currencyColor={quiet} />
        {counted ? <ThemedText type="meta" style={{ color: quiet }}>{words.tiles.counted}</ThemedText> : null}
      </Pressable>;
    })}
  </View>;
  // The period sits in the nav row (the Spending pattern); the picker sheet is unchanged.
  const periodChip = <Pressable testID="transfers-period" accessibilityRole="button"
    accessibilityLabel={tf('reportingPeriod', { period: periodLabel(period) }, language)}
    onPress={() => setPeriodOpen(true)} style={[styles.periodChip, { backgroundColor: band.tile }]}>
    <ThemedText type="smallBold" style={[styles.periodLabel, { color: band.onBand }]}>{periodLabel(period)}</ThemedText>
    <Icon name="chevron-down" size={16} color={band.onBand} />
  </Pressable>;
  // Something Select can act on: a group that is not blocked, or a waiting route.
  const waiting = groupRows.filter(row => !row.group.blocked).length + personRows.length + selectRows.length;
  // The same, whatever tile is on (select mode clears it): what See all would have to offer.
  const answerable = groupViews.filter(view => !view.blocked).length + personViews.length + selectRows.length;
  // What a row draws besides its data: its travelling coin, its tick and whether it can be pressed.
  const listState = useMemo(() => ({ coins, livePicked, selecting, busy, expanded, peopleFolded }),
    [coins, livePicked, selecting, busy, expanded, peopleFolded]);
  // The list's first heading, with Select at its end: the waiting groups' section when there are
  // any (the period's heading then sits in the list above its rows), else the period.
  const listHead = <View testID="transfers-list-head" style={styles.listHead}>
    <ThemedText type="smallBold" accessibilityRole="header" style={styles.grow}>
      {/* Select mode lists everything waiting; the count is said once, in the footer above the answers. */}
      {selecting || waitingRows ? words.group.section : periodTitle}
    </ThemedText>
    {!selecting && waiting > 0 ? <Pressable testID="transfers-select" accessibilityRole="button"
      accessibilityLabel={words.select.action} accessibilityHint={words.select.actionHint} disabled={busy}
      onPress={startSelecting} style={({ pressed }) => [styles.headAction, { opacity: pressed ? 0.7 : 1 }]}>
      <Icon name="check" size={16} color={band.tint} />
      <ThemedText type="smallBold" style={{ color: band.tint }}>{words.select.action}</ThemedText>
    </Pressable> : null}
  </View>;
  const selectControls = <View testID="transfer-select-controls" style={styles.selectControls}>
    <ThemedText type="meta" themeColor="textSecondary">{words.select.hint}</ThemedText>
    <View style={[styles.controlRow, large && styles.controlRowStacked]}>
      <SelectControl testID="transfer-select-shown" label={words.select.all(selectable.length)} palette={band} stacked={large}
        disabled={busy || selectable.length === 0} onPress={selectAll} />
      {livePicked.size > 0 ? <SelectControl testID="transfer-clear-selection" label={words.select.clear} palette={band} stacked={large}
        disabled={busy} onPress={() => { if (!busy) setPicked(new Map()); }} /> : null}
      <SelectControl testID="transfer-cancel-selection" label={words.select.cancel} palette={band} stacked={large}
        disabled={busy || batch.needsDurability} onPress={stopSelecting} />
    </View>
  </View>;

  return <>
    <BandScaffold band="accounts" scroll={false} testID="transfers-screen" contentStyle={styles.sheet}
      nav={{ back: () => { if (router.canGoBack()) router.back(); else router.replace('/wallet'); }, title: words.title, trailing: periodChip,
        backDisabled: busy || (batch.needsDurability && !batch.stale) }}
      footer={selecting ? <View testID="transfer-selection-footer" style={styles.footer}>
        <ThemedText type="smallBold" accessibilityLiveRegion="polite">
          {livePicked.size ? words.select.selected(livePicked.size) : words.select.none}
        </ThemedText>
        {/* The same three answers, for everything ticked; each opens the confirmation. */}
        {livePicked.size ? <TransferAnswerChoices incoming={pickedIncoming} value={null} palette={band} layout="buttons" disabled={busy}
          onChange={choice => { Keyboard.dismiss(); batch.open(pickedItems, choice); }} /> : null}
      </View> : undefined}
      bandContent={<View testID="transfers-band" style={styles.bandIntro}>
        <BandFigure label={words.headline(periodLabel(period))} fils={totals.ownFils} decimals palette={band}
          qualifier={words.notCounted} />
        {tilesOnBand ? tiles : null}
      </View>}>
      <FlatList<ListRow>
        testID="transfer-history"
        data={data}
        extraData={listState}
        keyExtractor={item => item.key}
        contentContainerStyle={[styles.content, { paddingBottom: listBottom }]}
        scrollIndicatorInsets={{ top: 0, bottom: listBottom }}
        contentInsetAdjustmentBehavior="never"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        initialNumToRender={14} maxToRenderPerBatch={10} windowSize={9}
        ListHeaderComponent={<View style={styles.controls}>
          {tilesOnBand ? null : tiles}
          {linkNotice ? <Pressable testID="transfers-link-notice" accessibilityRole="button" accessibilityLabel={`${linkNotice}. ${t('close', language)}`}
            onPress={() => setLinkNotice(null)} style={[styles.notice, { backgroundColor: band.card, borderColor: band.rule }]}>
            <ThemedText type="small" style={styles.grow}>{linkNotice}</ThemedText>
            <Icon name="close" size={16} color={band.textSecondary} />
          </Pressable> : null}
          <TextField label={words.search} value={query} onChangeText={setQuery}
            inputMode="search" returnKeyType="search" placeholder={words.searchPlaceholder}
            onSubmitEditing={() => Keyboard.dismiss()}
            leading={<Icon name="search" size={17} color={band.textSecondary} />}
            trailing={query ? <ActionIconButton icon="close" label={t('clearSearch', language)}
              variant="plain" onPress={() => setQuery('')} /> : undefined} />
          {selecting ? selectControls : question ? <TransferQuestionCard transaction={current?.transaction}
            person={question.kind === 'person' ? question.person : undefined} index={0} total={questions.length} waiting={waitingCount}
            accountLabel={current ? accountName(current.transaction.accountId) : undefined} hint={hint} palette={band} busy={busy}
            more={unasked} unnamed={unnamedCount} onAnswer={answerCurrent} onSeeAll={startSelecting} onSelectUnnamed={startSelecting} />
            // No question left, but entries still wait (unnamed one-offs, queued rows the card cannot ask): select mode
            // answers them. Only when it has something to answer: duplicate-id rows alone are shown read-only in the list.
            : unasked + unnamedCount > 0 && answerable > 0 ? <Pressable testID="transfers-review-link" accessibilityRole="button"
              accessibilityLabel={`${words.card.title(waitingCount + unasked)}. ${words.card.seeAllPlain}`}
              onPress={startSelecting}
              style={({ pressed }) => [styles.reviewLink, { backgroundColor: band.card, borderColor: band.statusNear, opacity: pressed ? 0.7 : 1 }]}>
              <ThemedText type="smallBold" style={[styles.grow, { color: band.statusNear }]}>{words.card.title(waitingCount + unasked)}</ThemedText>
              <ThemedText type="small" style={{ color: band.tint }}>{words.card.seeAllPlain}</ThemedText>
            </Pressable> : null}
          {listHead}
        </View>}
        renderItem={({ item, index }) => {
          if ('kind' in item && item.kind === 'header') {
            return <View style={styles.sectionHead}><ThemedText type="smallBold" accessibilityRole="header">{item.title}</ThemedText></View>;
          }
          // Each section is one card: rounded where it starts and ends.
          const previous = data[index - 1], next = data[index + 1];
          const first = !previous || ('kind' in previous && previous.kind === 'header');
          const last = !next || ('kind' in next && next.kind === 'header');
          const card = [styles.rowCard, { backgroundColor: band.card }, first && styles.rowCardFirst, last && styles.rowCardLast];
          const select = selecting ? { checked: livePicked.has(item.key), disabled: busy } : undefined;
          if ('kind' in item && item.kind === 'people-toggle') {
            return <View style={card}>
              <TransferPeopleToggle palette={band} expanded={!peopleFolded}
                label={peopleFolded ? words.person.showAll(personRows.length) : words.person.showFewer}
                onPress={() => setAllPeople(value => !value)} />
            </View>;
          }
          if ('kind' in item && item.kind === 'person') {
            // A person is one answer for every transfer with them: one tick in select mode.
            return <View style={card}>
              <TransferPersonRow person={item.person} palette={band} first={first} select={select}
                onPress={() => selecting ? togglePicked(item) : openGroup(item)} />
            </View>;
          }
          if ('kind' in item) {
            // In select mode a whole group is one tick; a catch-all group opens to show its entries; a blocked one is read-only.
            const tickable = item.group.whole && !item.group.blocked;
            return <View style={card}>
              <TransferGroupRow group={item.group} palette={band} first={first} select={tickable ? select : undefined}
                expand={selecting && !tickable && !item.group.blocked ? { expanded: expanded.has(item.key), disabled: busy } : undefined}
                onPress={() => selecting ? togglePicked(item) : openGroup(item)} />
            </View>;
          }
          return <View style={card}>
            <TransferRouteRow item={item} first={first} accountLabel={accountName} palette={band} coin={coins.get(item.key)}
              select={select}
              onPress={() => { if (selecting) { togglePicked(item); return; } Keyboard.dismiss(); setSelectedId(item.transactionId); }} />
          </View>;
        }}
        ListEmptyComponent={<View style={styles.empty}><Icon name="repeat" size={30} color={band.textSecondary} />
          {selecting ? <>
            <ThemedText type="heading" style={styles.emptyCopy}>{words.empty}</ThemedText>
          </> : tile && items.length > 0 ? <>
            <ThemedText type="heading" style={styles.emptyCopy}>{words.emptyTile}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.emptyCopy}>{words.emptyTileBody}</ThemedText>
            <Pressable testID="transfers-clear-tile" accessibilityRole="button" onPress={() => setTile(null)} style={styles.clearTile}>
              <ThemedText type="linkPrimary" style={{ color: band.tint }}>{words.clearTile}</ThemedText>
            </Pressable>
          </> : <>
            <ThemedText type="heading" style={styles.emptyCopy}>{words.empty}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.emptyCopy}>{words.emptyBody}</ThemedText>
          </>}</View>}
      />
    </BandScaffold>
    <PeriodSheet visible={periodOpen} onClose={() => setPeriodOpen(false)} />
    <EntryDetailSheet transaction={selectedTransaction ?? null} transferAssessment={selectedAssessment} transferAnswers={answers}
      showMerchantLink={false} startWithAccountPicker={!!selectedId && pickFor === selectedId}
      onClose={() => { setSelectedId(null); setPickFor(null); }} />
    {batch.batch ? <TransferAnswerSheet batch={batch.batch} palette={band} busy={batch.busy} stale={batch.stale} error={batch.error}
      needsDurability={batch.needsDurability} suggestion={sheetSuggestion} entries={sheetEntries}
      suggestionDetail={sheetMatch ? matchDetail(sheetMatch) : undefined} entryMatch={entryMatch}
      onChoose={batch.choose} onSave={() => void batch.save(batch.batch)} onClose={batch.close}
      onOpenEntry={id => { if (batch.close()) setSelectedId(id); }} /> : null}
  </>;
}

const styles = StyleSheet.create({
  bandIntro: { gap: Spacing.three },
  tiles: { flexDirection: 'row', gap: Spacing.two },
  tilesStack: { flexDirection: 'column' },
  tile: { flex: 1, minHeight: 72, borderRadius: 14, padding: Spacing.two, gap: 2 },
  sheet: { paddingTop: Spacing.two },
  content: { gap: 0 }, controls: { gap: Spacing.three, paddingBottom: Spacing.two },
  periodChip: { minHeight: 44, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 22, flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '100%', flexShrink: 1 },
  periodLabel: { flexShrink: 1 },
  clearTile: { minHeight: 44, justifyContent: 'center' },
  reviewLink: { minHeight: 56, borderWidth: 1, borderRadius: 18, padding: Spacing.three, flexDirection: 'row', flexWrap: 'wrap',
    alignItems: 'center', gap: Spacing.two },
  notice: { minHeight: 48, borderWidth: 1, borderRadius: 14, padding: Spacing.three, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flexGrow: 1, flexShrink: 1 },
  listHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two, minHeight: 44 },
  headAction: { minHeight: 44, minWidth: 44, paddingHorizontal: Spacing.two, flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionHead: { paddingTop: Spacing.four, paddingBottom: Spacing.two },
  selectControls: { gap: Spacing.two },
  controlRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  controlRowStacked: { flexDirection: 'column' },
  control: { flexGrow: 1, flexShrink: 1, maxWidth: '100%', minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  controlStacked: { flexGrow: 0, alignSelf: 'stretch' },
  controlLabel: { textAlign: 'center' },
  footer: { gap: Spacing.two },
  rowCard: { paddingHorizontal: Spacing.three },
  rowCardFirst: { borderTopStartRadius: 18, borderTopEndRadius: 18 },
  rowCardLast: { borderBottomStartRadius: 18, borderBottomEndRadius: 18 },
  empty: { alignItems: 'center', paddingVertical: Spacing.five, gap: Spacing.three },
  emptyCopy: { textAlign: 'center' },
});
