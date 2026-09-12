import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { EntryDetailSheet } from '@/components/entry-detail-sheet';
import { ThemedText } from '@/components/themed-text';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/controls';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useTheme } from '@/hooks/use-theme';
import { assistantCopy as copy } from '@/lib/assistant-copy';
import { formatAED as formatLedgerMoney } from '@/lib/format';
import type { AppState } from '@/lib/types';
import type { AssistantEvidence } from '@/lib/wafra-assistant';

const PAGE_SIZE = 20;

/** Exact executor-owned records, kept in local memory rather than route parameters. */
export function AssistantEvidenceSheet({ evidence, state, stale, onClose, onRefresh }: {
  evidence: AssistantEvidence[];
  state: AppState;
  stale: boolean;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const theme = useTheme();
  const largeText = useLargeTextLayout();
  const [groupIndex, setGroupIndex] = useState(0);
  const [page, setPage] = useState(0);
  const [entryId, setEntryId] = useState<string | null>(null);
  const byId = useMemo(() => new Map(state.transactions.map((row) => [row.id, row])), [state.transactions]);
  const accounts = useMemo(() => new Map(state.accounts.map((account) => [account.id, account])), [state.accounts]);
  const group = evidence[groupIndex] ?? evidence[0];
  const rows = useMemo(() => {
    const matched = group.transactionIds.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    });
    return group.ordered ? matched : matched.sort((a, b) =>
      (group.effectiveDates?.[b.id] ?? b.date).localeCompare(group.effectiveDates?.[a.id] ?? a.date) || a.id.localeCompare(b.id));
  }, [byId, group]);
  const invalidated = stale || rows.length !== group.transactionIds.length;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const visibleRows = rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  return <BottomSheet visible onClose={onClose} title={copy.evidenceTitle} testID="assistant-evidence">
    {invalidated ? <View style={styles.section}>
      <ThemedText>{copy.stale}</ThemedText>
      <Button label={copy.refresh} onPress={onRefresh} />
    </View> : <>
      {evidence.length > 1 ? <View style={styles.groups}>
        {evidence.map((item, index) => <Pressable key={`${item.label}-${index}`}
          accessibilityRole="button" accessibilityState={{ selected: index === groupIndex }}
          onPress={() => { setGroupIndex(index); setPage(0); }}
          style={[styles.group, { borderColor: theme.cardBorder,
            backgroundColor: index === groupIndex ? theme.primarySoft : theme.backgroundElement }]}>
          <ThemedText type="smallBold">{item.label}</ThemedText>
        </Pressable>)}
      </View> : null}
      <View style={styles.section}>
        <ThemedText type="smallBold">{group.label}</ThemedText>
        <ThemedText type="heading" tabular selectable testID="assistant-evidence-total">{formatLedgerMoney(group.totalFils)}</ThemedText>
        <ThemedText type="meta" themeColor="textSecondary" selectable>
          {[group.from && group.to ? `${group.from} – ${group.to}` : null,
            `${rows.length} recorded transaction${rows.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
        </ThemedText>
        {group.accountNames.length > 0 ? <ThemedText type="meta" themeColor="textSecondary" selectable>
          {group.accountNames.join(' · ')}
        </ThemedText> : null}
      </View>
      {visibleRows.map((row) => {
        const contribution = group.contributions?.[row.id] ?? row.amountFils;
        const account = accounts.get(row.accountId);
        const date = group.effectiveDates?.[row.id] ?? row.date;
        const accountName = group.effectiveAccountNames?.[row.id] ?? account?.name;
        const attributed = date !== row.date || accountName !== account?.name;
        return <Pressable key={row.id} testID="assistant-evidence-row" accessibilityRole="button"
          accessibilityLabel={`${row.title}, ${date}, ${formatLedgerMoney(contribution)} included. View transaction details`}
          onPress={() => setEntryId(row.id)}
          style={[styles.row, { borderBottomColor: theme.cardBorder }]}>
          <MerchantAvatar title={row.title} category={row.category} size={32} />
          <View style={styles.content}>
            <View style={[styles.headline, largeText && styles.headlineLarge]}>
              <ThemedText type="smallBold" style={styles.name}>{row.title}</ThemedText>
              <ThemedText type="smallBold" tabular testID="assistant-evidence-contribution">{formatLedgerMoney(contribution)}</ThemedText>
            </View>
            <ThemedText type="meta" themeColor="textSecondary">{[date, accountName].filter(Boolean).join(' · ')}</ThemedText>
            {attributed ? <ThemedText type="meta" themeColor="textSecondary">
              {copy.originalCashRecord([row.date, account?.name].filter(Boolean).join(' · '))}
            </ThemedText> : null}
            {contribution !== row.amountFils ? <ThemedText type="meta" themeColor="textSecondary">
              {copy.includedPortion(formatLedgerMoney(row.amountFils))}
            </ThemedText> : null}
          </View>
        </Pressable>;
      })}
      {rows.length === 0 ? <ThemedText themeColor="textSecondary">{copy.noRecords}</ThemedText> : null}
      {pages > 1 ? <View style={styles.section}>
        <ThemedText type="meta" themeColor="textSecondary">{`Page ${currentPage + 1} of ${pages}`}</ThemedText>
        <View style={styles.groups}>
          <Button label={copy.previous} variant="outline" inline disabled={currentPage === 0} onPress={() => setPage(currentPage - 1)} />
          <Button label={copy.next} variant="outline" inline disabled={currentPage + 1 === pages} onPress={() => setPage(currentPage + 1)} />
        </View>
      </View> : null}
      <ThemedText type="meta" themeColor="textSecondary">{copy.recorded}</ThemedText>
      <EntryDetailSheet transaction={entryId ? byId.get(entryId) ?? null : null} onClose={() => setEntryId(null)} showMerchantLink={false} />
    </>}
  </BottomSheet>;
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  groups: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  group: { minHeight: 44, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, justifyContent: 'center' },
  row: { minHeight: 64, paddingVertical: 12, flexDirection: 'row', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  content: { flex: 1, minWidth: 0, gap: 4 },
  headline: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', alignItems: 'baseline' },
  headlineLarge: { flexDirection: 'column', alignItems: 'flex-start' },
  name: { flexGrow: 1, flexShrink: 1, flexBasis: 100 },
});
