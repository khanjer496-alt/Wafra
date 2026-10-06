import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { TransferAnswerChoices } from '@/components/transfers/transfer-answer-choices';
import { TransferRoute } from '@/components/transfers/transfer-route-row';
import { EButton } from '@/components/ui/band/e-button';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Money } from '@/components/ui/money';
import { Spacing, type BandPalette } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import type { TransferBatch } from '@/hooks/use-transfer-batch';
import { clockTime, shortDateWithYear } from '@/lib/format';
import type { TransferAnswer } from '@/lib/transfer-answer';
import { transferActivityCopy } from '@/lib/transfer-activity-copy';
import { transferBatchChangedIds, transferBatchIncoming, type TransferBatchItem } from '@/lib/transfer-batch';
import { TRANSFER_HISTORY_PAGE_SIZE } from '@/lib/transfer-review-presentation';
import type { Transaction } from '@/lib/types';

function PreviewRoute({ item, palette, testID }: { item: TransferBatchItem; palette: BandPalette; testID: string }) {
  const words = transferActivityCopy(useLanguage());
  const { preview } = item;
  return <View testID={testID} accessible accessibilityRole="text"
    accessibilityLabel={[preview.spoken, preview.count > 1 ? words.group.entries(preview.count) : null, preview.dates, preview.note, preview.hint]
      .filter(Boolean).join('. ')}
    style={styles.preview}>
    <TransferRoute from={preview.from} to={preview.to} fromLabel={preview.fromLabel} toLabel={preview.toLabel}
      amountFils={preview.amountFils} sign={preview.sign} palette={palette} full />
    <View style={styles.meta}>
      {preview.count > 1 ? <View style={[styles.count, { backgroundColor: palette.glyphGround }]}>
        <ThemedText type="meta" style={{ color: palette.text }}>{words.group.entries(preview.count)}</ThemedText>
      </View> : null}
      <ThemedText type="meta" style={{ color: palette.textSecondary }}>{preview.dates}</ThemedText>
    </View>
    {preview.note ? <ThemedText type="meta" style={{ color: palette.textSecondary }}>{preview.note}</ThemedText> : null}
    {preview.hint ? <ThemedText testID="transfer-batch-preview-hint" type="meta" style={{ color: palette.tint }}>{preview.hint}</ThemedText> : null}
  </View>;
}

/**
 * "What is this?" for a group of entries or for the transfers ticked in
 * select mode: the same question and the same three answers as one entry's
 * detail sheet, with the likely other side under the own answer. Nothing is
 * written until Save; the save itself is `useTransferBatch`'s. A group whose
 * entries cannot be answered as a whole (ambiguous, "Account → ?") only lists
 * them: each opens its own "What is this?".
 */
export function TransferAnswerSheet({ batch, palette, busy, stale, error, needsDurability, suggestion, suggestionDetail, entries,
  entryMatch, onChoose, onSave, onClose, onOpenEntry }: {
  batch: TransferBatch; palette: BandPalette; busy: boolean; stale: boolean; error: string | null;
  needsDurability: boolean; suggestion?: string;
  /** One entry's matching entry on the other side (what, when, how much). */
  suggestionDetail?: string;
  /** A listed entry's own likely other side ("Looks like your … · what · when · how much"). */
  entryMatch?: (id: string) => string | undefined;
  /** A single group's entries, newest first, each of which can be opened on its own. */
  entries?: readonly Transaction[];
  onChoose: (answer: TransferAnswer) => void; onSave: () => void; onClose: () => void;
  onOpenEntry?: (id: string) => void;
}) {
  const words = transferActivityCopy(useLanguage());
  const [limit, setLimit] = useState(TRANSFER_HISTORY_PAGE_SIZE);
  const { items } = batch;
  const changed = transferBatchChangedIds(items).length;
  const single = items.length === 1 ? items[0] : undefined;
  // While a save or its retry is pending, nothing else on the sheet can be pressed.
  const locked = busy || (needsDurability && !stale);
  const listOnly = !!single?.listOnly;
  const list = single ? entries ?? [] : items;
  return <BottomSheet visible palette={palette} title={words.answers.question} testID="transfer-answer-sheet"
    onClose={onClose} dismissible={!locked}
    footer={<View style={styles.actions}>
      {listOnly ? null : <EButton testID="transfer-answer-sheet-save" palette={palette}
        label={busy ? words.batch.saving : needsDurability ? words.batch.retry : words.batch.save(changed)}
        disabled={busy || stale || batch.answer === null} onPress={onSave} />}
      <EButton testID="transfer-answer-sheet-cancel" palette={palette} variant="quiet" label={listOnly ? words.answers.done : words.batch.cancel}
        disabled={locked} onPress={onClose} />
    </View>}>
    <View style={styles.body}>
      {single ? <PreviewRoute item={single} palette={palette} testID="transfer-answer-sheet-route" />
        : <ThemedText type="subtitle" accessibilityRole="header">{words.batch.selected(items.length)}</ThemedText>}
      {listOnly ? <ThemedText testID="transfer-answer-sheet-one-by-one" type="small" themeColor="textSecondary">{words.group.oneByOne}</ThemedText>
        : items.length > 1 || batch.answer === null
          ? <ThemedText type="small" themeColor="textSecondary">{words.batch.choose}</ThemedText> : null}
      {listOnly ? null : <TransferAnswerChoices incoming={transferBatchIncoming(items)} value={batch.answer} onChange={onChoose} palette={palette}
        layout="radios" suggestion={suggestion} suggestionDetail={suggestionDetail} disabled={busy || needsDurability} />}
      {list.length > 0 ? <View testID="transfer-batch-preview" style={styles.list}>
        {single ? <ThemedText type="smallBold" accessibilityRole="header">{words.group.entriesTitle}</ThemedText> : null}
        {single ? (entries ?? []).slice(0, limit).map(entry => <Pressable key={entry.id} testID="transfer-group-entry"
          accessibilityRole="button" disabled={locked || !onOpenEntry}
          accessibilityLabel={[words.group.openEntry, entry.title, shortDateWithYear(entry.date), entryMatch?.(entry.id)].filter(Boolean).join('. ')}
          onPress={() => { if (!locked) onOpenEntry?.(entry.id); }}
          style={({ pressed }) => [styles.entry, { borderColor: palette.rule, backgroundColor: palette.card, opacity: pressed ? 0.7 : 1 }]}>
          <View style={styles.entryText}>
            <ThemedText type="small">{entry.title}</ThemedText>
            {/* The same date style as its match line below: the short date and the clock. */}
            <ThemedText type="meta" themeColor="textSecondary">{words.dateTime(shortDateWithYear(entry.date), clockTime(entry))}</ThemedText>
            {entryMatch?.(entry.id) ? <ThemedText testID="transfer-group-entry-match" type="meta" selectable style={{ color: palette.tint }}>
              {entryMatch(entry.id)}</ThemedText> : null}
          </View>
          <Money fils={entry.amountFils} sign={entry.type === 'income' ? 'plus' : 'minus'} type="smallBold" decimals />
        </Pressable>)
          : items.slice(0, limit).map(item => <View key={item.key}
            style={[styles.previewItem, { borderColor: palette.rule, backgroundColor: palette.card }]}>
            <PreviewRoute item={item} palette={palette} testID="transfer-batch-preview-item" />
          </View>)}
        {list.length > limit ? <EButton palette={palette} variant="quiet" label={words.group.more(limit, list.length)}
          onPress={() => setLimit(value => value + TRANSFER_HISTORY_PAGE_SIZE)} /> : null}
      </View> : null}
      {stale || error ? <ThemedText testID="transfer-answer-sheet-error" type="small" themeColor="expense" accessibilityRole="alert"
        accessibilityLiveRegion="polite" selectable>{stale ? words.batch.changed : error}</ThemedText> : null}
    </View>
  </BottomSheet>;
}

const styles = StyleSheet.create({
  body: { gap: Spacing.three },
  actions: { gap: Spacing.two },
  list: { gap: Spacing.two },
  preview: { gap: Spacing.one },
  previewItem: { borderWidth: 1, borderRadius: 14, padding: Spacing.three },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  count: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  entry: { minHeight: 56, borderWidth: 1, borderRadius: 14, padding: Spacing.three, flexDirection: 'row', alignItems: 'center',
    gap: Spacing.two, flexWrap: 'wrap' },
  entryText: { flex: 1, minWidth: 120, gap: 2 },
});
