# Transfers Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make transfers one simple question ("whose money was it?") answered the same way everywhere, rebuild the Transfers page as Mix 2 (summary tiles, one-tap question card, compact route list), and fix the squeezed Transactions summary.

**Architecture:** One additive data change (`TransferDecision.ownership` gains `'none'`) through the existing `resolveTransfers` path. New pure modules (`transfer-list.ts`, `transfer-answer.ts`) carry all logic so screens stay thin and testable. Three small components (`TransferRouteRow`, `TransferQuestionCard`, `TransferAnswerChoices`) are shared by the Transfers page and the entry detail sheet.

**Tech Stack:** Expo SDK 55 / React Native, TypeScript, node:test suites under `scripts/test` (loaded through `scripts/test/repair/load-typescript.cjs` and `scripts/test/workflows/workflow-harness.cjs`), Playwright e2e under `scripts/e2e`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-04-transfers-redesign-design.md`.
- Answers, out: **Moved to my own account** / **Paid someone else** / **Not a transfer**. Answers, in: **Came from my own account** / **Received from someone** / **Not a transfer**. Each states its effect: "Not counted as spending/income" or "Counted as spending/income".
- Users never see "pair", "match", "ownership", "transfer records", "separated".
- No English or Arabic copy in `src/app` or `src/components`; copy lives in `src/lib/*-copy.ts` with matching `en` and `ar` objects (`const ar: typeof en`).
- Design language E: Transfers wears the `accounts` band; every row/tile layout stacks under `useLargeTextLayout()`; touch targets ≥ 44pt; RTL mirrors the route arrow.
- Money/parsing/privacy changes are conservative: never change which rows count in totals except a `'none'` decision, which must count exactly like an ordinary row.
- Existing testIDs kept: `transfers-screen`, `transfers-band`, `transfer-history`, `transactions-summary`, `transactions-net-total`, `transactions-separated-transfers`, `transactions-transfers-link`, `transactions-exclusions`.
- Commit each task with explicit pathspecs; message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push.

## How to run tests

Build the shared test bundle once per session (and after editing `src/lib` files that other suites import through `scripts/test/build`):

```bash
(cd scripts/test && bash build.sh)
```

Run one suite: `node --test scripts/test/repair/<name>.test.cjs`. Lint changed files: `npx eslint <files>`. Typecheck: `npx tsc --noEmit -p .`.

## File map

| File | Responsibility | Task |
|---|---|---|
| `src/lib/transfer-reconciliation-types.ts` | `'none'` in decision types | 1 |
| `src/lib/transfer-reconciliation.ts` | validation, `transferDeclined`, ownership, matching exclusion | 1 |
| `src/lib/ledger.ts` | `isTransfer` respects `'none'` | 1 |
| `scripts/test/repair/transfer-none-decision.test.cjs` | new: data-layer tests | 1 |
| `src/lib/transaction-filter.ts` | `excluded.movementKind` | 2 |
| `src/lib/i18n.ts` | movement-kind exclusion strings | 2 |
| `src/lib/transfer-activity-copy.ts` | strip, tiles, tags, card, answers copy | 2, 3, 4 |
| `src/app/transactions.tsx` | stacked summary, transfer strip, swipe action | 2, 7 |
| `src/lib/transfer-list.ts` | new: list items, routes, totals, filters | 3 |
| `src/lib/transfer-answer.ts` | new: answer → request, labels, picker candidates | 4 |
| `src/hooks/use-transfer-answer.ts` | new: save + Undo toast | 4 |
| `src/components/transfers/transfer-route-row.tsx` | new: one route row | 5 |
| `src/components/transfers/transfer-answer-choices.tsx` | new: three-answer control | 5 |
| `src/components/transfers/transfer-question-card.tsx` | new: gold question card | 5 |
| `src/app/transfers.tsx` | Mix 2 page | 6 |
| `src/components/entry-detail-sheet.tsx` | "What is this?" | 7 |
| `src/lib/reference-copy.ts`, `src/app/add-transaction.tsx` copy | renamed own-account action and checkbox | 7 |
| `docs/design/transfers.md`, e2e scripts | docs + browser checks | 8 |

---

### Task 1: "Not a transfer" decision in the data layer

**Files:**
- Modify: `src/lib/transfer-reconciliation-types.ts:37-42, 92-98`
- Modify: `src/lib/transfer-reconciliation.ts:68-72, 139-147, 478-483, 836-847, 1273-1279`
- Modify: `src/lib/ledger.ts:50-53`
- Test: `scripts/test/repair/transfer-none-decision.test.cjs` (create)

**Interfaces:**
- Produces: `TransferDecision['ownership']` = `'own' | 'external' | 'none'`; `TransferDecisionRequest['ownership']` = `'own' | 'external' | 'none' | null`; `export function transferDeclined(tx: Transaction): boolean` from `@/lib/transfer-reconciliation`.

- [ ] **Step 1: Write the failing tests**

Create `scripts/test/repair/transfer-none-decision.test.cjs`:

```js
'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const core = load(path.join(root, 'src/lib/transfer-reconciliation.ts'), {
  '@/lib/markets': load(path.join(root, 'src/lib/markets.ts')),
  '@/lib/currency-metadata': load(path.join(root, 'src/lib/currency-metadata.ts')),
  '@noble/hashes/sha2.js': require('@noble/hashes/sha2.js'),
  '@noble/hashes/utils.js': require('@noble/hashes/utils.js'),
});
const activity = load(path.join(root, 'src/lib/transfer-activity.ts'), { '@/lib/transfer-reconciliation': core });
const ledger = load(path.join(root, 'src/lib/ledger.ts'), { '@/lib/transfer-reconciliation': core });

const NOW = Date.parse('2026-10-02T10:00:00Z');
const accounts = ['1111', '2222'].map((last4, i) => ({ id: `bank-${i}`, name: `Bank ${i}`, kind: 'bank',
  bankName: 'ADCB', last4, openingFils: 0, color: '#111111' }));
const row = (id, extra = {}) => ({ id, type: 'expense', amountFils: 500000, category: 'other',
  accountId: accounts[0].id, title: 'Outgoing transfer', date: '2026-10-02', ts: NOW,
  source: 'sms', smsKey: `s-${id}`, captureInstrument: { last4: '1111', kind: 'account', bankIdentity: 'adcb' },
  transferEvidence: { version: 1, currency: 'AED', attribution: 'source' }, ...extra });
const decide = (rows, ids, ownership) => core.applyTransferDecision(rows, accounts, {
  ids, ownership, now: NOW + 1,
  expectedFingerprints: Object.fromEntries(ids.map(id => [id, core.transferFingerprint(rows.find(r => r.id === id))])),
});

test('a none decision validates, round-trips and is reported as declined', () => {
  assert.equal(core.isTransferDecision({ version: 1, ownership: 'none', decidedAt: NOW }), true);
  assert.equal(core.isTransferDecision({ version: 1, ownership: 'none', decidedAt: NOW, counterpartId: 'x' }), false,
    'only an own-account answer may name a counterpart');
  const [saved] = decide([row('t1')], ['t1'], 'none');
  assert.equal(saved.transferDecision.ownership, 'none');
  assert.equal(core.transferDeclined(saved), true);
  assert.equal(core.isTransferCandidate(saved), true, 'stays reachable for Undo');
  assert.equal(core.transferOwnership(saved), null);
});

test('a declined row leaves Transfers and the review queue and counts like an ordinary row', () => {
  const rows = decide([row('t1')], ['t1'], 'none');
  const result = core.reconcileTransfers(rows, accounts);
  assert.equal(result.byId.has('t1'), false);
  assert.equal(result.pendingIds.has('t1'), false);
  assert.equal(result.internalIds.has('t1'), false);
  assert.deepEqual(activity.getTransferActivity(rows, accounts, result), []);
  assert.equal(ledger.countsInTotals(rows[0], new Set(accounts.map(a => a.id)), result.internalIds), true);
});

test('legacy isTransfer does not keep a declined manual row out of totals', () => {
  const manual = { id: 'm1', type: 'expense', amountFils: 2000, category: 'other', accountId: accounts[0].id,
    title: 'Move to savings', date: '2026-10-02', source: 'manual', isTransfer: true };
  assert.equal(ledger.isTransfer(manual), true);
  const [declined] = decide([manual], ['m1'], 'none');
  assert.equal(ledger.isTransfer(declined), false);
  assert.equal(ledger.countsInTotals(declined, new Set([accounts[0].id]), new Set()), true);
});

test('a declined row is never proposed as the other side of someone else\'s transfer', () => {
  const out = row('out', { transferEvidence: { version: 1, currency: 'AED', attribution: 'source', reference: 'TRANSFER-777777' } });
  const inn = row('in', { type: 'income', accountId: accounts[1].id, title: 'Incoming transfer',
    captureInstrument: { last4: '2222', kind: 'account', bankIdentity: 'adcb' },
    transferEvidence: { version: 1, currency: 'AED', attribution: 'source', reference: 'TRANSFER-777777' } });
  const rows = decide([out, inn], ['in'], 'none');
  const result = core.reconcileTransfers(rows, accounts);
  assert.notEqual(result.byId.get('out')?.counterpartId, 'in');
  assert.ok(!(result.byId.get('out')?.candidateIds ?? []).includes('in'));
});

test('Undo (null) removes a none decision and the batch path accepts none', () => {
  const declined = decide([row('t1')], ['t1'], 'none');
  const undone = decide(declined, ['t1'], null);
  assert.equal(undone[0].transferDecision, undefined);
  const batch = core.applyTransferDecisionBatch([row('a'), row('b')], accounts, {
    decisions: [{ ids: ['a'], ownership: 'none' }, { ids: ['b'], ownership: 'external' }], now: NOW + 1,
    expectedFingerprints: { a: core.transferFingerprint(row('a')), b: core.transferFingerprint(row('b')) },
  });
  assert.deepEqual(batch.map(r => r.transferDecision.ownership), ['none', 'external']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/test/repair/transfer-none-decision.test.cjs`
Expected: FAIL. `isTransferDecision` returns false for `'none'`, `transferDeclined` is not a function, and `applyTransferDecision` throws "Invalid transfer decision".

- [ ] **Step 3: Widen the types**

In `src/lib/transfer-reconciliation-types.ts`:

```ts
/** A user's ownership decision survives reparsing and a missing counterpart.
 * `'none'` is "not a transfer": the row counts like an ordinary purchase or income. */
export interface TransferDecision {
  version: 1;
  ownership: 'own' | 'external' | 'none';
  decidedAt: number;
  counterpartId?: string;
}
```

and in `TransferDecisionRequest`: `ownership: 'own' | 'external' | 'none' | null;`

- [ ] **Step 4: Validation, `transferDeclined`, ownership**

In `src/lib/transfer-reconciliation.ts` replace `isTransferDecision`:

```ts
export function isTransferDecision(value: unknown): value is TransferDecision {
  return record(value) && value.version === 1 &&
    (value.ownership === 'own' || value.ownership === 'external' || value.ownership === 'none') &&
    clock(value.decidedAt) && optional(value, 'counterpartId', id) &&
    (value.ownership === 'own' || value.counterpartId === undefined);
}
```

Add directly above `transferOwnership`:

```ts
/** The person said this row is not a transfer. It stays a candidate only so Undo is reachable. */
export function transferDeclined(tx: Transaction): boolean {
  return decisionOf(tx as TransferRow)?.ownership === 'none';
}
```

In `transferOwnership` change `if (decision) return decision.ownership;` to:

```ts
  if (decision) return decision.ownership === 'none' ? null : decision.ownership;
```

- [ ] **Step 5: Keep declined rows out of matching, keep corroboration**

At line ~482 (after `complementaryPostingPairs`):

```ts
  for (const [id, entry] of entries) {
    if (transferOwnership(entry.tx) === 'external' || transferDeclined(entry.tx)) entries.delete(id);
  }
```

In the assessment loop (~line 837) replace the first two statements with:

```ts
    const ownership = transferOwnership(tx);
    const declined = transferDeclined(tx);
    if ((ownership === null && !declined) || !id(tx.id)) continue;
    if (corroboratingIds.has(tx.id)) {
      byId.set(tx.id, { id: tx.id, status: 'corroborating-alert', reason: 'bank-confirmation',
        counterpartId: corroboratingOf.get(tx.id), candidateIds: [] });
      continue;
    }
    // "Not a transfer": no assessment, no queue, no link; it counts like any row.
    if (declined) continue;
```

In `applyTransferDecisionBatch` change the allowed list to `!['own', 'external', 'none', null].includes(decision.ownership)`.

- [ ] **Step 6: `ledger.isTransfer` respects the answer**

In `src/lib/ledger.ts` (import `transferDeclined` alongside `transferOwnership`):

```ts
export function isTransfer(transaction: Transaction): boolean {
  if (transferDeclined(transaction)) return false;
  const ownership = transferOwnership(transaction);
  return ownership === 'own' || (ownership === null && transaction.isTransfer === true);
}
```

- [ ] **Step 7: Run the new suite and the transfer regressions**

Run: `(cd scripts/test && bash build.sh) && node --test scripts/test/repair/transfer-none-decision.test.cjs scripts/test/repair/transfer-activity.test.cjs scripts/test/repair/transfer-batch.test.cjs scripts/test/repair/transaction-filter-transfers.test.cjs scripts/test/repair/dashboard-cost.test.cjs`
Expected: all PASS. If `transfer-none-decision` fails on the "never proposed" case, inspect how `candidateIds` are built from `entries` and confirm the deletion runs before `knownTransferCounterparties`.

- [ ] **Step 8: Typecheck, lint, commit**

```bash
npx tsc --noEmit -p . && npx eslint src/lib/transfer-reconciliation.ts src/lib/transfer-reconciliation-types.ts src/lib/ledger.ts
git add src/lib/transfer-reconciliation.ts src/lib/transfer-reconciliation-types.ts src/lib/ledger.ts scripts/test/repair/transfer-none-decision.test.cjs
git commit -m "feat(transfers): record 'not a transfer' as a reversible decision

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Transactions summary — stacked header and one-line transfer strip

**Files:**
- Modify: `src/lib/transaction-filter.ts:85, 206, 261, 270`
- Modify: `src/lib/i18n.ts` (after `movementsExcluded`, ~2649)
- Modify: `src/lib/transfer-activity-copy.ts` (en + ar)
- Modify: `src/app/transactions.tsx:681-779` (JSX), `865-930` (styles)
- Test: `scripts/test/repair/transaction-ui-regression.test.cjs` (update), `scripts/test/repair/transaction-filter-transfers.test.cjs` (add case)

**Interfaces:**
- Produces: `excluded.movementKind?: 'cash-withdrawal' | 'investing' | 'cash-deposit'` (set only when every excluded movement is that kind); copy keys `strip.kept(count)`, `strip.sentInNet(amount)`, `strip.receivedInNet(amount)`, `strip.needsAnswer(count)`, `strip.open`, `net`.

- [ ] **Step 1: Failing tests**

In `transaction-filter-transfers.test.cjs` add (reuse that file's existing `project`/fixture helpers; copy their call shape exactly):

```js
test('a single kind of excluded money movement is named', () => {
  const rows = [
    { id: 'w1', type: 'expense', amountFils: 50000, category: 'cash-withdrawal', accountId: 'bank-0', title: 'ATM', date: '2026-10-02' },
    { id: 'w2', type: 'expense', amountFils: 20000, category: 'cash-withdrawal', accountId: 'bank-0', title: 'ATM', date: '2026-10-03' },
  ];
  assert.equal(project(rows).excluded.movementKind, 'cash-withdrawal');
  rows.push({ id: 'i1', type: 'expense', amountFils: 10000, category: 'investing', accountId: 'bank-0', title: 'Broker', date: '2026-10-03' });
  assert.equal(project(rows).excluded.movementKind, undefined);
});
```

In `transaction-ui-regression.test.cjs`, replace assertions that read `/1 transfer record/` or `netIncluding` with:

```js
const words = h.deps['@/lib/transfer-activity-copy'].transferActivityCopy('en');
const strip = byId(tree, 'transactions-separated-transfers');
assert.ok(text(strip).includes(words.strip.kept(1)));
assert.ok(text(byId(tree, 'transactions-net-total')).includes(words.net));
// The count line and the net are separate stacked children, never siblings in one row.
const stack = walk(byId(tree, 'transactions-summary')).find(n => n.props?.style && [].concat(n.props.style).some(s => s && s.gap === 2 && !s.flexDirection));
assert.ok(stack, 'summary children stack vertically');
assert.ok(byId(tree, 'transactions-summary-line') && byId(tree, 'transactions-net-total'));
```

- [ ] **Step 2: Run, expect FAIL** — `node --test scripts/test/repair/transaction-filter-transfers.test.cjs scripts/test/repair/transaction-ui-regression.test.cjs` (no `movementKind`, no `strip` copy).

- [ ] **Step 3: Movement kind in the projection**

In `transaction-filter.ts`:

```ts
type MovementKind = 'cash-withdrawal' | 'investing' | 'cash-deposit';
const movementKindOf = (row: Transaction): MovementKind =>
  row.category === 'cash-withdrawal' ? 'cash-withdrawal' : row.category === 'investing' ? 'investing' : 'cash-deposit';
```

Type: `excluded: { transfers: number; movements: number; hidden: number; movementKind?: MovementKind };`. Next to `let movements = 0;` add `let movementKind: MovementKind | 'mixed' | undefined;`. Where `movements++` happens:

```ts
      else if (isMoneyMovementOnly(row)) {
        movements++;
        const kind = movementKindOf(row);
        movementKind = movementKind === undefined || movementKind === kind ? kind : 'mixed';
      }
```

Result: `excluded: { transfers, movements, hidden, ...(movementKind && movementKind !== 'mixed' ? { movementKind } : {}) }`.

- [ ] **Step 4: Copy**

`src/lib/i18n.ts`, after `movementsExcluded`:

```ts
  cashWithdrawalsExcluded: { en: '{count} cash withdrawal{s} not counted', ar: '{count} سحب نقدي مستبعد من الإجمالي' },
  investingExcluded: { en: '{count} investment{s} not counted', ar: '{count} استثمار مستبعد من الإجمالي' },
  cashDepositsExcluded: { en: '{count} cash deposit{s} not counted', ar: '{count} إيداع نقدي مستبعد من الإجمالي' },
```

`src/lib/transfer-activity-copy.ts` — add to `en`:

```ts
  net: 'Net',
  strip: {
    kept: (count: number) => `${count} transfer${count === 1 ? '' : 's'} kept apart`,
    sentInNet: (amount: string) => `${amount} sent to others is in the net`,
    receivedInNet: (amount: string) => `${amount} received from others is in the net`,
    needsAnswer: (count: number) => `${count} need${count === 1 ? 's' : ''} an answer`,
    open: 'Open',
  },
```

and to `ar`:

```ts
  net: 'الصافي',
  strip: {
    kept: (count) => `${count} من التحويلات معروضة على حدة`,
    sentInNet: (amount) => `${amount} أُرسلت لآخرين ضمن الصافي`,
    receivedInNet: (amount) => `${amount} استُلمت من آخرين ضمن الصافي`,
    needsAnswer: (count) => `${count} بانتظار إجابتك`,
    open: 'فتح',
  },
```

- [ ] **Step 5: Stacked summary JSX**

In `transactions.tsx` replace the `summaryTop` block (the `<View style={[styles.summaryTop, ...]}>` through its closing `</View>`) with two stacked lines. Keep the exact count/period/filter/exclusion string building already there; only the containers and the movement wording change:

```tsx
            <View style={styles.summaryStack}>
            <ThemedText testID="transactions-summary-line" type="small" themeColor="textSecondary">
              {/* existing transactionsCount + period + activeFiltersCount pieces, unchanged */}
              {(excluded.transfers > 0 || excluded.movements > 0 || excluded.hidden > 0) && (
                <ThemedText testID="transactions-exclusions" type="small" themeColor="textSecondary">
                  {/* existing transfersExcluded piece, unchanged */}
                  {excluded.movements > 0
                    ? `${excluded.transfers > 0 ? ' · ' : ''}${trf(
                        excluded.movementKind === 'cash-withdrawal' ? 'cashWithdrawalsExcluded'
                          : excluded.movementKind === 'investing' ? 'investingExcluded'
                            : excluded.movementKind === 'cash-deposit' ? 'cashDepositsExcluded' : 'movementsExcluded',
                        { count: excluded.movements, s: excluded.movements === 1 ? '' : 's' })}`
                    : ''}
                  {/* existing hiddenAccountsExcluded piece, unchanged */}
                </ThemedText>
              )}
            </ThemedText>
            {(showResultTotal || activeFilterCount > 0) && <View style={styles.netLine}>
              {showResultTotal && <View testID="transactions-net-total" style={styles.netValue}>
                <ThemedText type="small" themeColor="textSecondary">{transferWords.net}</ThemedText>
                <ThemedText type="smallBold" tabular style={{ color: totalShown >= 0 ? theme.income : theme.text }}>
                  {totalShown >= 0 ? '+' : '−'}{formatAED(Math.abs(totalShown), { decimals: false })}
                </ThemedText>
              </View>}
              {/* existing Clear filters Pressable, unchanged */}
            </View>}
            </View>
```

- [ ] **Step 6: Transfer strip JSX**

Replace the whole `transferRow` block (separated-transfers notice + link) with:

```tsx
              {separatedTransfers.count > 0 && <Pressable testID="transactions-separated-transfers"
                accessibilityRole="button"
                accessibilityLabel={[transferWords.strip.kept(separatedTransfers.count), stripDetail, transferWords.viewAll].filter(Boolean).join('. ')}
                onPress={() => routerRef.current.push('/transfers')}
                style={({ pressed }) => [styles.strip, { backgroundColor: band.card, borderColor: band.rule, opacity: pressed ? 0.8 : 1 }]}>
                <View style={[styles.stripIcon, { backgroundColor: band.tile }]}>
                  <Icon name="repeat" size={16} color={band.text} />
                </View>
                <View style={styles.stripText}>
                  <View style={styles.stripTitle}>
                    <ThemedText type="smallBold">{transferWords.strip.kept(separatedTransfers.count)}</ThemedText>
                    {separatedTransfers.reviewCount > 0 && <View style={[styles.stripDot, { backgroundColor: band.statusNear }]} />}
                  </View>
                  {stripDetail ? <ThemedText type="meta" themeColor="textSecondary">{stripDetail}</ThemedText> : null}
                </View>
                <View testID="transactions-transfers-link" style={styles.stripOpen}>
                  <ThemedText type="small" style={{ color: band.tint, fontFamily: Fonts.sansSemi }}>{transferWords.strip.open}</ThemedText>
                  <Icon name="chevron-right" size={14} color={band.tint} />
                </View>
              </Pressable>}
```

and above the `return`, next to `transferContributes`:

```ts
  const stripDetail = [
    separatedTransfers.expenseFils > 0 ? transferWords.strip.sentInNet(formatAED(separatedTransfers.expenseFils, { decimals: true })) : null,
    separatedTransfers.incomeFils > 0 ? transferWords.strip.receivedInNet(formatAED(separatedTransfers.incomeFils, { decimals: true })) : null,
    separatedTransfers.reviewCount > 0 ? transferWords.strip.needsAnswer(separatedTransfers.reviewCount) : null,
  ].filter(Boolean).join(' · ');
```

Remove the empty-state reuse of `transferWords.separated` at ~line 815 by using `transferWords.strip.kept(count)` there.

- [ ] **Step 7: Styles**

Delete `transferNotice`, `transferLink`, `transferRow`, `transferRowLarge`, `summaryTop`, `summaryTopLarge`, `summaryText`, `summaryTextLarge`, `summaryRight`, `summaryValueLarge` (check with `grep -n` that nothing else uses each one first). Add:

```ts
  summaryStack: { gap: 2 },
  netLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  netValue: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: Spacing.two },
  strip: { marginTop: Spacing.two, minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: Spacing.two,
    padding: Spacing.two, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  stripIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  stripText: { flex: 1, minWidth: 0, gap: 2 },
  stripTitle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stripDot: { width: 7, height: 7, borderRadius: 4 },
  stripOpen: { flexDirection: 'row', alignItems: 'center', gap: 2 },
```

- [ ] **Step 8: Run tests, lint, commit**

```bash
(cd scripts/test && bash build.sh) && node --test scripts/test/repair/transaction-filter-transfers.test.cjs scripts/test/repair/transaction-ui-regression.test.cjs
npx eslint src/app/transactions.tsx src/lib/transaction-filter.ts src/lib/transfer-activity-copy.ts src/lib/i18n.ts
git add src/app/transactions.tsx src/lib/transaction-filter.ts src/lib/transfer-activity-copy.ts src/lib/i18n.ts scripts/test/repair/transaction-filter-transfers.test.cjs scripts/test/repair/transaction-ui-regression.test.cjs
git commit -m "fix(transactions): stack the summary and explain transfers in one line

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Transfer list model (routes, tags, tiles, filters)

**Files:**
- Create: `src/lib/transfer-list.ts`
- Modify: `src/lib/transfer-activity-copy.ts` (tiles, tags, route words)
- Test: `scripts/test/repair/transfer-list.test.cjs` (create)

**Interfaces:**
- Consumes: `TransferActivityRecord` from `@/lib/transfer-activity`; `TransferPair` from `@/lib/transfer-pairs`.
- Produces:

```ts
export type TransferTag = 'own' | 'external' | 'needs-answer' | 'unconfirmed';
export type RouteEnd = { kind: 'account'; accountId: string } | { kind: 'party'; name: string } | { kind: 'unknown' };
export interface TransferListItem {
  key: string; transactionId: string; date: string; ts: number;
  from: RouteEnd; to: RouteEnd; amountFils: number; direction: 'out' | 'in' | 'between';
  tag: TransferTag; linked: boolean;
}
export type TransferTile = 'own' | 'sent' | 'received';
export function transferListItems(records: readonly TransferActivityRecord[], pairs: readonly TransferPair[]): TransferListItem[];
export function transferTotals(items: readonly TransferListItem[]): { ownFils: number; sentFils: number; receivedFils: number };
export function filterTransferItems(items: readonly TransferListItem[], tile: TransferTile | null): TransferListItem[];
```

- [ ] **Step 1: Failing tests** — create `scripts/test/repair/transfer-list.test.cjs`:

```js
'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const { transferListItems, transferTotals, filterTransferItems } = load(path.resolve(__dirname, '../../../src/lib/transfer-list.ts'));

const tx = (id, type, accountId, amountFils, extra = {}) => ({ id, type, accountId, amountFils, date: '2026-10-01', ts: 1,
  title: 'Transfer', category: 'other', ...extra });
const rec = (transaction, ownership, confirmed = true, needsReview = false) =>
  ({ transaction, ownership, confirmed, needsReview, assessment: { id: transaction.id, status: 'confirmed-own', reason: 'user', candidateIds: [] } });

test('a linked pair is one row reading from → to, counted once', () => {
  const out = tx('o', 'expense', 'fab', 700000); const inn = tx('i', 'income', 'enbd', 700000);
  const items = transferListItems([rec(out, 'own'), rec(inn, 'own')], [{ key: 'o|i', out, in: inn, anchorId: 'o', counterpartId: 'i' }]);
  assert.equal(items.length, 1);
  assert.deepEqual([items[0].from, items[0].to], [{ kind: 'account', accountId: 'fab' }, { kind: 'account', accountId: 'enbd' }]);
  assert.equal(items[0].direction, 'between');
  assert.equal(items[0].linked, true);
  assert.equal(transferTotals(items).ownFils, 700000);
});

test('single rows: names the person, else a dashed unknown; tags follow the answer', () => {
  const paid = tx('p', 'expense', 'adcb', 85000, { transferEvidence: { counterpartyName: 'Ahmed K.' } });
  const got = tx('r', 'income', 'adcb', 12000);
  const open = tx('q', 'expense', 'fab', 500000);
  const items = transferListItems([rec(paid, 'external'), rec(got, 'external'), rec(open, 'unknown', false, true)], []);
  const byId = Object.fromEntries(items.map(i => [i.transactionId, i]));
  assert.deepEqual(byId.p.to, { kind: 'party', name: 'Ahmed K.' });
  assert.deepEqual(byId.r.from, { kind: 'unknown' });
  assert.deepEqual(byId.r.to, { kind: 'account', accountId: 'adcb' });
  assert.equal(byId.p.tag, 'external');
  assert.equal(byId.q.tag, 'needs-answer');
  assert.deepEqual(transferTotals(items), { ownFils: 0, sentFils: 85000, receivedFils: 12000 });
});

test('tile filters and newest-first order', () => {
  const a = tx('a', 'expense', 'x', 1, { date: '2026-10-01' });
  const b = tx('b', 'expense', 'x', 1, { date: '2026-10-03' });
  const items = transferListItems([rec(a, 'own'), rec(b, 'external')], []);
  assert.deepEqual(items.map(i => i.transactionId), ['b', 'a']);
  assert.deepEqual(filterTransferItems(items, 'own').map(i => i.transactionId), ['a']);
  assert.deepEqual(filterTransferItems(items, 'sent').map(i => i.transactionId), ['b']);
  assert.equal(filterTransferItems(items, null).length, 2);
});
```

- [ ] **Step 2: Run, expect FAIL** (module missing): `node --test scripts/test/repair/transfer-list.test.cjs`

- [ ] **Step 3: Implement `src/lib/transfer-list.ts`**

```ts
import type { TransferActivityRecord } from '@/lib/transfer-activity';
import type { TransferPair } from '@/lib/transfer-pairs';
import type { Transaction } from '@/lib/types';

export type TransferTag = 'own' | 'external' | 'needs-answer' | 'unconfirmed';
export type RouteEnd = { kind: 'account'; accountId: string } | { kind: 'party'; name: string } | { kind: 'unknown' };
export interface TransferListItem {
  key: string; transactionId: string; date: string; ts: number;
  from: RouteEnd; to: RouteEnd; amountFils: number; direction: 'out' | 'in' | 'between';
  tag: TransferTag; linked: boolean;
}
export type TransferTile = 'own' | 'sent' | 'received';

const account = (tx: Transaction): RouteEnd => ({ kind: 'account', accountId: tx.accountId });
const other = (tx: Transaction): RouteEnd => {
  const name = tx.transferEvidence?.counterpartyName;
  return name ? { kind: 'party', name } : { kind: 'unknown' };
};
const tagOf = (record: TransferActivityRecord): TransferTag => record.confirmed
  ? record.ownership === 'own' ? 'own' : 'external'
  : record.needsReview ? 'needs-answer' : 'unconfirmed';

/** One row per transfer: a linked pair collapses to its outgoing leg's route. */
export function transferListItems(
  records: readonly TransferActivityRecord[], pairs: readonly TransferPair[],
): TransferListItem[] {
  const byId = new Map(records.map(record => [record.transaction.id, record]));
  const used = new Set<string>();
  const items: TransferListItem[] = [];
  for (const pair of pairs) {
    const outRecord = byId.get(pair.out.id);
    if (!outRecord || !byId.has(pair.in.id)) continue;
    used.add(pair.out.id); used.add(pair.in.id);
    items.push({ key: pair.key, transactionId: pair.out.id, date: pair.out.date, ts: pair.out.ts ?? 0,
      from: account(pair.out), to: account(pair.in), amountFils: pair.out.amountFils,
      direction: 'between', tag: tagOf(outRecord), linked: true });
  }
  for (const record of records) {
    const tx = record.transaction;
    if (used.has(tx.id)) continue;
    const incoming = tx.type === 'income';
    items.push({ key: tx.id, transactionId: tx.id, date: tx.date, ts: tx.ts ?? 0,
      from: incoming ? other(tx) : account(tx), to: incoming ? account(tx) : other(tx),
      amountFils: tx.amountFils, direction: incoming ? 'in' : 'out', tag: tagOf(record), linked: false });
  }
  return items.sort((a, b) => b.date.localeCompare(a.date) || b.ts - a.ts);
}

export function transferTotals(items: readonly TransferListItem[]) {
  let ownFils = 0; let sentFils = 0; let receivedFils = 0;
  for (const item of items) {
    // An own transfer seen only from its incoming side still moved that money once.
    if (item.tag === 'own') ownFils += item.amountFils;
    else if (item.tag === 'external' && item.direction === 'out') sentFils += item.amountFils;
    else if (item.tag === 'external' && item.direction === 'in') receivedFils += item.amountFils;
  }
  return { ownFils, sentFils, receivedFils };
}

export function filterTransferItems(items: readonly TransferListItem[], tile: TransferTile | null): TransferListItem[] {
  if (!tile) return [...items];
  return items.filter(item => tile === 'own' ? item.tag === 'own'
    : item.tag === 'external' && item.direction === (tile === 'sent' ? 'out' : 'in'));
}
```

Note for the implementer: an own transfer recorded on both sides but not yet linked appears twice (one `out`, one `in`), and `transferTotals` adds both. That matches today's "both legs listed" rule. Do not try to pair rows here; pairing belongs to the reconciler.

- [ ] **Step 4: Copy for tiles, tags and routes** — add to `en` in `transfer-activity-copy.ts`:

```ts
  headline: (period: string) => `${period} · moved between your accounts`,
  notCounted: 'Not counted as spending or income',
  tiles: { own: 'Your accounts', sent: 'Sent to others', received: 'Received', counted: 'counted',
    count: (n: number) => `${n} transfer${n === 1 ? '' : 's'}` },
  tags: { own: 'Your accounts', external: 'Someone else · counted', needsAnswer: 'Needs an answer', unconfirmed: 'Not answered yet' },
  route: { unknown: 'Unknown', linked: (account: string) => `Linked to ${account}`, to: 'to' },
  listTitle: 'This month',
```

and `ar`:

```ts
  headline: (period) => `${period} · نُقلت بين حساباتك`,
  notCounted: 'لا تُحتسب ضمن المصروفات أو الدخل',
  tiles: { own: 'حساباتك', sent: 'أُرسلت لآخرين', received: 'مستلمة', counted: 'محتسبة',
    count: (n) => `${n} من التحويلات` },
  tags: { own: 'حساباتك', external: 'شخص آخر · محتسبة', needsAnswer: 'بانتظار إجابتك', unconfirmed: 'لم تتم الإجابة بعد' },
  route: { unknown: 'غير معروف', linked: (account) => `مرتبط بـ ${account}`, to: 'إلى' },
  listTitle: 'هذا الشهر',
```

- [ ] **Step 5: Run, PASS; commit**

```bash
node --test scripts/test/repair/transfer-list.test.cjs && npx eslint src/lib/transfer-list.ts src/lib/transfer-activity-copy.ts
git add src/lib/transfer-list.ts src/lib/transfer-activity-copy.ts scripts/test/repair/transfer-list.test.cjs
git commit -m "feat(transfers): one route row per transfer with tile totals

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Answering a transfer (request builder + hook)

**Files:**
- Create: `src/lib/transfer-answer.ts`
- Create: `src/hooks/use-transfer-answer.ts`
- Modify: `src/lib/transfer-activity-copy.ts` (answers, toasts, card)
- Test: `scripts/test/repair/transfer-answer.test.cjs` (create)

**Interfaces:**
- Consumes: `transferFingerprint`, `isTransferCandidate`, `transferDeclined`, `transferOwnership` (Task 1); `TransferAssessment`.
- Produces:

```ts
export type TransferAnswer = 'own' | 'external' | 'none';
export function currentAnswer(tx: Transaction, assessment?: TransferAssessment): TransferAnswer | null;
export function ownCandidates(tx: Transaction, assessment: TransferAssessment | undefined, rowsById: ReadonlyMap<string, Transaction>): Transaction[];
export function buildTransferAnswer(input: {
  transaction: Transaction; answer: TransferAnswer; counterpart?: Transaction; generation: number;
}): { ids: string[]; ownership: TransferAnswer; counterpartId?: string; expectedFingerprints: Record<string, string>; expectedGeneration: number };
// hook
export function useTransferAnswer(): {
  answer: (input: { transaction: Transaction; answer: TransferAnswer; counterpart?: Transaction; label: string }) => Promise<boolean>;
  busy: boolean;
};
```

- [ ] **Step 1: Failing tests** — `scripts/test/repair/transfer-answer.test.cjs` (load `transfer-reconciliation.ts` exactly as in Task 1's test, then):

```js
const answer = load(path.join(root, 'src/lib/transfer-answer.ts'), { '@/lib/transfer-reconciliation': core });

test('builds an own answer linked to the one likely counterpart', () => {
  const tx = row('o'); const other = row('i', { type: 'income', accountId: accounts[1].id });
  const request = answer.buildTransferAnswer({ transaction: tx, answer: 'own', counterpart: other, generation: 7 });
  assert.deepEqual(request.ids, ['o']);
  assert.equal(request.counterpartId, 'i');
  assert.deepEqual(Object.keys(request.expectedFingerprints).sort(), ['i', 'o']);
  assert.equal(request.expectedGeneration, 7);
});

test('external and none never link, and only freeze the selected row', () => {
  for (const choice of ['external', 'none']) {
    const request = answer.buildTransferAnswer({ transaction: row('o'), answer: choice, counterpart: row('i'), generation: 1 });
    assert.equal(request.counterpartId, undefined);
    assert.deepEqual(Object.keys(request.expectedFingerprints), ['o']);
  }
});

test('current answer and own candidates', () => {
  assert.equal(answer.currentAnswer(row('a', { transferDecision: { version: 1, ownership: 'none', decidedAt: 1 } })), 'none');
  assert.equal(answer.currentAnswer(row('b', { transferDecision: { version: 1, ownership: 'external', decidedAt: 1 } })), 'external');
  assert.equal(answer.currentAnswer(row('c')), null);
  const b = row('b', { type: 'income', accountId: accounts[1].id });
  const c = row('c', { type: 'income', accountId: accounts[1].id });
  const rowsById = new Map([[b.id, b], [c.id, c]]);
  assert.deepEqual(answer.ownCandidates(row('a'), { id: 'a', status: 'ambiguous', reason: 'multiple-candidates', candidateIds: ['b', 'c'] }, rowsById).map(r => r.id), ['b', 'c']);
  assert.deepEqual(answer.ownCandidates(row('a'), { id: 'a', status: 'likely-own', reason: 'reference', counterpartId: 'b', candidateIds: [] }, rowsById).map(r => r.id), ['b']);
});
```

- [ ] **Step 2: Run, expect FAIL** (module missing).

- [ ] **Step 3: Implement `src/lib/transfer-answer.ts`**

```ts
import { isTransferCandidate, transferDeclined, transferFingerprint, transferOwnership } from '@/lib/transfer-reconciliation';
import type { TransferAssessment } from '@/lib/transfer-reconciliation-types';
import type { Transaction } from '@/lib/types';

export type TransferAnswer = 'own' | 'external' | 'none';

/** What the person (or the evidence) has already settled; null means "not answered". */
export function currentAnswer(tx: Transaction, assessment?: TransferAssessment): TransferAnswer | null {
  if (transferDeclined(tx)) return 'none';
  if (assessment?.status === 'confirmed-own') return 'own';
  if (assessment?.status === 'confirmed-external') return 'external';
  const ownership = transferOwnership(tx);
  return ownership === 'own' || ownership === 'external' ? ownership : null;
}

/** Rows that could be the other side of an own-account answer, most likely first. */
export function ownCandidates(
  tx: Transaction, assessment: TransferAssessment | undefined, rowsById: ReadonlyMap<string, Transaction>,
): Transaction[] {
  const ids = assessment?.counterpartId ? [assessment.counterpartId] : assessment?.candidateIds ?? [];
  return ids.map(id => rowsById.get(id))
    .filter((row): row is Transaction => !!row && row.id !== tx.id && isTransferCandidate(row) && !transferDeclined(row));
}

/** Freeze exactly what the person saw; the store rechecks these fingerprints when it saves. */
export function buildTransferAnswer({ transaction, answer, counterpart, generation }: {
  transaction: Transaction; answer: TransferAnswer; counterpart?: Transaction; generation: number;
}) {
  const link = answer === 'own' && counterpart ? counterpart : undefined;
  return {
    ids: [transaction.id],
    ownership: answer,
    ...(link ? { counterpartId: link.id } : {}),
    expectedFingerprints: Object.fromEntries([transaction, ...(link ? [link] : [])]
      .map(row => [row.id, transferFingerprint(row)])),
    expectedGeneration: generation,
  };
}
```

- [ ] **Step 4: Copy** — add to `en` in `transfer-activity-copy.ts`:

```ts
  answers: {
    question: 'What is this?',
    out: { own: 'Moved to my own account', external: 'Paid someone else', none: 'Not a transfer' },
    in: { own: 'Came from my own account', external: 'Received from someone', none: 'Not a transfer' },
    effect: { own: (incoming: boolean) => `Not counted as ${incoming ? 'income' : 'spending'}`,
      external: (incoming: boolean) => `Counted as ${incoming ? 'income' : 'spending'}`,
      none: 'A normal purchase, bill or income' },
    whichAccount: 'Which account?',
    noLink: 'None of these',
    saved: 'Saved',
    undo: 'Undo',
    undone: 'Answer removed',
    changed: 'This transfer changed. Open it again.',
    failed: 'Couldn’t save. Try again.',
    done: 'Done',
  },
  card: {
    title: (n: number) => `${n} transfer${n === 1 ? ' needs' : 's need'} an answer`,
    step: (i: number, n: number) => `${i} of ${n}`,
    whereOut: 'Where did this go?',
    whereIn: 'Where did this come from?',
    looksLike: (account: string) => `looks like your ${account}`,
    seeAll: (n: number) => `See all ${n}`,
  },
```

and `ar`:

```ts
  answers: {
    question: 'ما هذه المعاملة؟',
    out: { own: 'نُقلت إلى حسابي', external: 'دفعت لشخص آخر', none: 'ليست تحويلاً' },
    in: { own: 'جاءت من حسابي', external: 'استلمتها من شخص', none: 'ليست تحويلاً' },
    effect: { own: (incoming) => `لا تُحتسب ضمن ${incoming ? 'الدخل' : 'المصروفات'}`,
      external: (incoming) => `تُحتسب ضمن ${incoming ? 'الدخل' : 'المصروفات'}`,
      none: 'شراء أو فاتورة أو دخل عادي' },
    whichAccount: 'أي حساب؟',
    noLink: 'لا شيء مما سبق',
    saved: 'تم الحفظ',
    undo: 'تراجع',
    undone: 'تمت إزالة الإجابة',
    changed: 'تغيّر هذا التحويل. افتحه مرة أخرى.',
    failed: 'تعذّر الحفظ. حاول مرة أخرى.',
    done: 'تم',
  },
  card: {
    title: (n) => `${n} من التحويلات بانتظار إجابتك`,
    step: (i, n) => `${i} من ${n}`,
    whereOut: 'إلى أين ذهبت؟',
    whereIn: 'من أين جاءت؟',
    looksLike: (account) => `يبدو أنها حسابك ${account}`,
    seeAll: (n) => `عرض الكل (${n})`,
  },
```

- [ ] **Step 5: Hook `src/hooks/use-transfer-answer.ts`**

```ts
import { useCallback, useRef, useState } from 'react';

import { useToast } from '@/components/ui/toast';
import { useLanguage } from '@/hooks/use-language';
import { useStoreActions } from '@/lib/store';
import { buildTransferAnswer, type TransferAnswer } from '@/lib/transfer-answer';
import { transferActivityCopy } from '@/lib/transfer-activity-copy';
import { transferFingerprint } from '@/lib/transfer-reconciliation';
import type { Transaction } from '@/lib/types';

/** Save one answer through the reviewed resolver, then offer Undo in the toast. */
export function useTransferAnswer() {
  const words = transferActivityCopy(useLanguage()).answers;
  const toast = useToast();
  const { resolveTransfers, getStateGeneration, getStateSnapshot, ensureDurable } = useStoreActions();
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);

  const undo = useCallback(async (id: string) => {
    const row = getStateSnapshot().transactions.find(entry => entry.id === id);
    if (!row) return;
    try {
      await resolveTransfers({ ids: [id], ownership: null, expectedGeneration: getStateGeneration(),
        expectedFingerprints: { [id]: transferFingerprint(row) } });
      toast.show(words.undone, { tone: 'success' });
    } catch {
      toast.show(words.failed, { tone: 'error' });
    }
  }, [getStateGeneration, getStateSnapshot, resolveTransfers, toast, words]);

  const answer = useCallback(async ({ transaction, answer: choice, counterpart, label }: {
    transaction: Transaction; answer: TransferAnswer; counterpart?: Transaction; label: string;
  }): Promise<boolean> => {
    if (saving.current) return false;
    const request = buildTransferAnswer({ transaction, answer: choice, counterpart, generation: getStateGeneration() });
    // The row on screen may be older than the store; refuse rather than overwrite.
    const latest = new Map(getStateSnapshot().transactions.map(row => [row.id, row]));
    if (Object.entries(request.expectedFingerprints).some(([id, print]) => {
      const row = latest.get(id);
      return !row || transferFingerprint(row) !== print;
    })) {
      toast.show(words.changed, { tone: 'error' });
      return false;
    }
    saving.current = true; setBusy(true);
    try {
      await resolveTransfers(request);
      toast.show(`${words.saved} · ${label}`, { tone: 'success',
        actions: [{ label: words.undo, onPress: () => { void undo(transaction.id); } }] });
      return true;
    } catch (failure) {
      const code = typeof failure === 'object' && failure && 'code' in failure ? failure.code : undefined;
      if (code === 'transfer-durability') {
        try { await ensureDurable(); toast.show(words.saved, { tone: 'success' }); return true; } catch { /* fall through */ }
      }
      toast.show(words.failed, { tone: 'error' });
      return false;
    } finally {
      saving.current = false; setBusy(false);
    }
  }, [ensureDurable, getStateGeneration, getStateSnapshot, resolveTransfers, toast, undo, words]);

  return { answer, busy };
}
```

- [ ] **Step 6: Run, PASS; typecheck; commit**

```bash
node --test scripts/test/repair/transfer-answer.test.cjs && npx tsc --noEmit -p . && npx eslint src/lib/transfer-answer.ts src/hooks/use-transfer-answer.ts src/lib/transfer-activity-copy.ts
git add src/lib/transfer-answer.ts src/hooks/use-transfer-answer.ts src/lib/transfer-activity-copy.ts scripts/test/repair/transfer-answer.test.cjs
git commit -m "feat(transfers): answer a transfer in one tap with Undo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Shared transfer components

**Files:**
- Create: `src/components/transfers/transfer-route-row.tsx`
- Create: `src/components/transfers/transfer-answer-choices.tsx`
- Create: `src/components/transfers/transfer-question-card.tsx`
- Test: `scripts/test/repair/transfer-components.test.cjs` (create)

**Interfaces:**
- Consumes: `TransferListItem`, `RouteEnd` (Task 3); `TransferAnswer`, copy `answers`/`card` (Task 4); `BandPalette` from `@/constants/theme`.
- Produces:

```tsx
export function TransferRouteRow(props: { item: TransferListItem; accountLabel: (id: string) => string;
  palette: BandPalette; onPress: () => void; first: boolean }): JSX.Element;
export function TransferAnswerChoices(props: { incoming: boolean; value: TransferAnswer | null;
  onChange: (answer: TransferAnswer) => void; palette: BandPalette; layout: 'buttons' | 'radios';
  linkedLabel?: string; disabled?: boolean }): JSX.Element;
export function TransferQuestionCard(props: { transaction: Transaction; index: number; total: number;
  accountLabel: string; hint?: string; palette: BandPalette; busy: boolean;
  onAnswer: (answer: TransferAnswer) => void; onSeeAll: () => void }): JSX.Element;
```

testIDs: `transfer-row-<key>`, `transfer-answer-own|external|none`, `transfer-question-card`, `transfer-question-see-all`.

- [ ] **Step 1: Failing tests** — `scripts/test/repair/transfer-components.test.cjs`, using the workflow harness the way `transfers-band.test.cjs` does:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkflowHarness, walk, text } = require('../workflows/workflow-harness.cjs');
const byId = (tree, id) => walk(tree).find(n => n.props?.testID === id);

// The harness's jsx renders function components eagerly, so calling a component
// returns a tree that walk/text can read (the same way renderScreen works).
function harness(language) {
  const h = createWorkflowHarness({ language });
  h.local('@/lib/transfer-activity-copy', 'src/lib/transfer-activity-copy.ts');
  h.local('@/components/transfers/transfer-answer-choices');
  h.local('@/components/transfers/transfer-route-row');
  h.local('@/components/transfers/transfer-question-card');
  return h;
}
const palette = h => h.deps['@/hooks/use-band'].useBand('accounts');

for (const language of ['en', 'ar']) {
  test(`${language}: answer choices word the question by direction and report the choice`, () => {
    const h = harness(language);
    const { TransferAnswerChoices } = h.deps['@/components/transfers/transfer-answer-choices'];
    const words = h.deps['@/lib/transfer-activity-copy'].transferActivityCopy(language).answers;
    let picked = null;
    const tree = TransferAnswerChoices({ incoming: true, value: null, layout: 'radios',
      onChange: v => { picked = v; }, palette: palette(h) });
    assert.ok(text(tree).includes(words.in.own));
    assert.ok(text(tree).includes(words.effect.own(true)));
    byId(tree, 'transfer-answer-external').props.onPress();
    assert.equal(picked, 'external');
    assert.equal(byId(tree, 'transfer-answer-own').props.accessibilityState.checked, false);
  });
}

test('route row reads From → To with the tag', () => {
  const h = harness('en');
  const { TransferRouteRow } = h.deps['@/components/transfers/transfer-route-row'];
  const item = { key: 'p', transactionId: 'p', date: '2026-10-03', ts: 1, amountFils: 85000, direction: 'out',
    from: { kind: 'account', accountId: 'adcb' }, to: { kind: 'party', name: 'Ahmed K.' }, tag: 'external', linked: false };
  const tree = TransferRouteRow({ item, accountLabel: () => 'ADCB', palette: palette(h), onPress() {}, first: true });
  assert.match(byId(tree, 'transfer-row-p').props.accessibilityLabel, /ADCB.*Ahmed K\./);
  assert.ok(text(tree).includes('Someone else · counted'));
});

test('question card asks by direction, shows its step and hides See all for one item', () => {
  const h = harness('en');
  const { TransferQuestionCard } = h.deps['@/components/transfers/transfer-question-card'];
  const words = h.deps['@/lib/transfer-activity-copy'].transferActivityCopy('en');
  const transaction = { id: 'q', type: 'expense', amountFils: 500000, date: '2026-10-02', accountId: 'fab', title: 'Transfer', category: 'other' };
  const answers = [];
  const one = TransferQuestionCard({ transaction, index: 0, total: 1, accountLabel: 'FAB', palette: palette(h), busy: false,
    onAnswer: a => answers.push(a), onSeeAll() {} });
  assert.ok(text(one).includes(words.card.whereOut));
  assert.equal(byId(one, 'transfer-question-see-all'), undefined);
  byId(one, 'transfer-answer-none').props.onPress();
  assert.deepEqual(answers, ['none']);
  const two = TransferQuestionCard({ transaction, index: 0, total: 2, accountLabel: 'FAB', palette: palette(h), busy: false,
    onAnswer() {}, onSeeAll() {} });
  assert.ok(text(two).includes(words.card.step(1, 2)));
  assert.ok(byId(two, 'transfer-question-see-all'));
});
```

If a dependency these components import is not provided by the harness (the run fails with "Cannot find module"), register it with `h.local('<alias>', '<file>')`, or give it a minimal stub in `harness()` the way `transfers-band.test.cjs` does for `@/lib/transfer-pairs`.

- [ ] **Step 2: Run, expect FAIL** (files missing).

- [ ] **Step 3: `transfer-answer-choices.tsx`**

```tsx
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing, type BandPalette } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import type { TransferAnswer } from '@/lib/transfer-answer';
import { transferActivityCopy } from '@/lib/transfer-activity-copy';

const ORDER: TransferAnswer[] = ['own', 'external', 'none'];

/** The one transfer question. Buttons on the question card, radio rows in the detail sheet. */
export function TransferAnswerChoices({ incoming, value, onChange, palette, layout, linkedLabel, disabled }: {
  incoming: boolean; value: TransferAnswer | null; onChange: (answer: TransferAnswer) => void;
  palette: BandPalette; layout: 'buttons' | 'radios'; linkedLabel?: string; disabled?: boolean;
}) {
  const words = transferActivityCopy(useLanguage()).answers;
  const large = useLargeTextLayout();
  const labels = incoming ? words.in : words.out;
  const effect = (answer: TransferAnswer) => answer === 'none' ? words.effect.none : words.effect[answer](incoming);
  if (layout === 'buttons') {
    return <View accessibilityRole="radiogroup" style={[styles.buttons, large && styles.stack]}>
      {ORDER.map((answer, i) => <Pressable key={answer} testID={`transfer-answer-${answer}`} disabled={disabled}
        accessibilityRole="radio" accessibilityState={{ checked: value === answer, disabled: !!disabled }}
        accessibilityLabel={`${labels[answer]}. ${effect(answer)}`}
        onPress={() => onChange(answer)}
        style={({ pressed }) => [styles.button, large && styles.buttonLarge,
          { backgroundColor: i === 0 ? palette.fill : palette.card, opacity: pressed || disabled ? 0.7 : 1 }]}>
        <ThemedText type="smallBold" style={{ color: i === 0 ? palette.onFill : palette.text, textAlign: 'center' }}>{labels[answer]}</ThemedText>
      </Pressable>)}
    </View>;
  }
  return <View accessibilityRole="radiogroup" style={styles.radios}>
    {ORDER.map(answer => {
      const on = value === answer;
      return <View key={answer}>
        <Pressable testID={`transfer-answer-${answer}`} disabled={disabled}
          accessibilityRole="radio" accessibilityState={{ checked: on, disabled: !!disabled }}
          accessibilityLabel={`${labels[answer]}. ${effect(answer)}`}
          onPress={() => onChange(answer)}
          style={({ pressed }) => [styles.radioRow, { backgroundColor: palette.card,
            borderColor: on ? palette.tint : palette.rule, opacity: pressed || disabled ? 0.75 : 1 }]}>
          <View style={[styles.radio, { borderColor: on ? palette.tint : palette.textSecondary }]}>
            {on ? <View style={[styles.radioDot, { backgroundColor: palette.tint }]} /> : null}
          </View>
          <View style={styles.radioText}>
            <ThemedText type="smallBold">{labels[answer]}</ThemedText>
            <ThemedText type="meta" themeColor="textSecondary">{effect(answer)}</ThemedText>
          </View>
        </Pressable>
        {answer === 'own' && on && linkedLabel
          ? <ThemedText type="meta" themeColor="textSecondary" style={styles.linked}>{linkedLabel}</ThemedText> : null}
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  buttons: { flexDirection: 'row', gap: Spacing.two },
  stack: { flexDirection: 'column' },
  button: { flex: 1, minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.two, paddingVertical: Spacing.two },
  buttonLarge: { flex: 0, alignSelf: 'stretch' },
  radios: { gap: Spacing.two },
  radioRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three, borderRadius: 14, borderWidth: 1.5 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  radioText: { flex: 1, minWidth: 0, gap: 2 },
  linked: { paddingStart: Spacing.three, paddingTop: Spacing.one },
});
```

- [ ] **Step 4: `transfer-route-row.tsx`**

```tsx
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { Spacing, type BandPalette } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { shortDate } from '@/lib/format';
import { transferActivityCopy } from '@/lib/transfer-activity-copy';
import type { RouteEnd, TransferListItem } from '@/lib/transfer-list';

function Chip({ end, label, palette }: { end: RouteEnd; label: string; palette: BandPalette }) {
  const initials = label.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();
  return <View style={[styles.chip, end.kind === 'unknown'
    ? { borderStyle: 'dashed', borderWidth: 1, borderColor: palette.textSecondary }
    : { backgroundColor: palette.tile }]}>
    {end.kind !== 'unknown' ? <View style={[styles.initials, { backgroundColor: palette.fill }]}>
      <ThemedText type="micro" style={{ color: palette.onFill }}>{initials}</ThemedText>
    </View> : null}
    <ThemedText type="smallBold" numberOfLines={1} style={styles.chipText}>{label}</ThemedText>
  </View>;
}

export function TransferRouteRow({ item, accountLabel, palette, onPress, first }: {
  item: TransferListItem; accountLabel: (id: string) => string; palette: BandPalette; onPress: () => void; first: boolean;
}) {
  const language = useLanguage();
  const words = transferActivityCopy(language);
  const large = useLargeTextLayout();
  const label = (end: RouteEnd) => end.kind === 'account' ? accountLabel(end.accountId)
    : end.kind === 'party' ? end.name : words.route.unknown;
  const tag = item.tag === 'own' ? words.tags.own : item.tag === 'external' ? words.tags.external
    : item.tag === 'needs-answer' ? words.tags.needsAnswer : words.tags.unconfirmed;
  const tagColor = item.tag === 'needs-answer' ? palette.statusNear : palette.textSecondary;
  const sign = item.direction === 'out' && item.tag === 'external' ? 'minus' : item.direction === 'in' && item.tag === 'external' ? 'plus' : 'none';
  return <Pressable testID={`transfer-row-${item.key}`} accessibilityRole="button"
    accessibilityLabel={`${label(item.from)} ${words.route.to} ${label(item.to)}. ${shortDate(item.date)}. ${tag}`}
    onPress={onPress}
    style={({ pressed }) => [styles.row, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.rule },
      { opacity: pressed ? 0.7 : 1 }]}>
    <View style={[styles.route, large && styles.routeStack]}>
      <Chip end={item.from} label={label(item.from)} palette={palette} />
      <Icon name={language === 'ar' ? 'arrow-left' : 'arrow-right'} size={14} color={palette.textSecondary} />
      <Chip end={item.to} label={label(item.to)} palette={palette} />
      <View style={styles.amount}><Money fils={item.amountFils} sign={sign} type="smallBold" decimals /></View>
    </View>
    <ThemedText type="meta" style={{ color: palette.textSecondary }}>
      {shortDate(item.date)} · <ThemedText type="meta" style={{ color: tagColor }}>{tag}</ThemedText>
    </ThemedText>
  </Pressable>;
}

const styles = StyleSheet.create({
  row: { minHeight: 64, paddingVertical: Spacing.three, gap: Spacing.one },
  route: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, flexWrap: 'wrap' },
  routeStack: { alignItems: 'flex-start' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 10, paddingVertical: 3, paddingStart: 3, paddingEnd: 8, maxWidth: '42%' },
  initials: { width: 22, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  chipText: { flexShrink: 1 },
  amount: { marginStart: 'auto' },
});
```

Confirm `arrow-left`/`arrow-right` exist in `src/components/ui/icon.tsx` (`grep -n "'arrow-" src/components/ui/icon.tsx`); if not, use the names it has.

- [ ] **Step 5: `transfer-question-card.tsx`**

```tsx
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { TransferAnswerChoices } from '@/components/transfers/transfer-answer-choices';
import { Money } from '@/components/ui/money';
import { Spacing, type BandPalette } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { shortDate } from '@/lib/format';
import type { TransferAnswer } from '@/lib/transfer-answer';
import { transferActivityCopy } from '@/lib/transfer-activity-copy';
import type { Transaction } from '@/lib/types';

export function TransferQuestionCard({ transaction, index, total, accountLabel, hint, palette, busy, onAnswer, onSeeAll }: {
  transaction: Transaction; index: number; total: number; accountLabel: string; hint?: string;
  palette: BandPalette; busy: boolean; onAnswer: (answer: TransferAnswer) => void; onSeeAll: () => void;
}) {
  const words = transferActivityCopy(useLanguage());
  const incoming = transaction.type === 'income';
  return <View testID="transfer-question-card" accessibilityLiveRegion="polite"
    style={[styles.card, { backgroundColor: palette.card, borderColor: palette.statusNear }]}>
    <View style={styles.head}>
      <ThemedText type="smallBold" accessibilityRole="header" style={{ color: palette.statusNear }}>{words.card.title(total)}</ThemedText>
      <ThemedText type="meta" style={{ color: palette.statusNear }}>{words.card.step(index + 1, total)}</ThemedText>
    </View>
    <View style={styles.what}>
      <View style={styles.grow}>
        <ThemedText type="smallBold">{incoming ? words.card.whereIn : words.card.whereOut}</ThemedText>
        <ThemedText type="meta" themeColor="textSecondary">
          {[accountLabel, shortDate(transaction.date), hint].filter(Boolean).join(' · ')}
        </ThemedText>
      </View>
      <Money fils={transaction.amountFils} sign={incoming ? 'plus' : 'minus'} type="smallBold" decimals />
    </View>
    <TransferAnswerChoices incoming={incoming} value={null} onChange={onAnswer} palette={palette} layout="buttons" disabled={busy} />
    {total > 1 ? <Pressable testID="transfer-question-see-all" accessibilityRole="button" onPress={onSeeAll} style={styles.seeAll}>
      <ThemedText type="small" style={{ color: palette.tint }}>{words.card.seeAll(total)}</ThemedText>
    </Pressable> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 18, padding: Spacing.three, gap: Spacing.two },
  head: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: Spacing.two },
  what: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  seeAll: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
});
```

- [ ] **Step 6: Run, PASS; lint; commit**

```bash
node --test scripts/test/repair/transfer-components.test.cjs && npx eslint src/components/transfers
git add src/components/transfers scripts/test/repair/transfer-components.test.cjs
git commit -m "feat(transfers): route row, answer choices and question card

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Transfers page (Mix 2)

**Files:**
- Modify: `src/app/transfers.tsx` (rewrite body; keep imports that remain used)
- Test: `scripts/test/repair/transfers-band.test.cjs`, `scripts/test/repair/transfer-history-ui.test.cjs` (update)

**Interfaces:**
- Consumes: Tasks 3, 4, 5. `matchedTransferPairs`, `getTransferActivity`, `reconcileTransfers`, `transferReconciliationForState`, `usePeriod`, `PeriodSheet`, `EntryDetailSheet`, `BandFigure`.

- [ ] **Step 1: Update tests first**

In `transfers-band.test.cjs`, extend `harness()` so it loads the new modules and stubs the answer hook:

```js
  h.local('@/lib/transfer-list', 'src/lib/transfer-list.ts');
  h.local('@/lib/transfer-answer', 'src/lib/transfer-answer.ts');
  for (const name of ['transfer-answer-choices', 'transfer-route-row', 'transfer-question-card']) h.local(`@/components/transfers/${name}`);
  h.answers = [];
  h.deps['@/hooks/use-transfer-answer'] = { useTransferAnswer: () => ({ busy: false,
    answer: async input => { h.answers.push(input); return true; } }) };
```

Add a helper that installs a reconciliation stub, as the existing pair test does inline:

```js
function withReconciliation(h, byId, pendingIds = []) {
  const reconciliation = { groups: [], pendingIds: new Set(pendingIds), internalIds: new Set(), byId: new Map(byId) };
  h.deps['@/lib/transfer-reconciliation'] = { ...h.deps['@/lib/transfer-reconciliation'], reconcileTransfers: () => reconciliation };
  h.deps['@/lib/ledger'] = { ...h.deps['@/lib/ledger'], transferReconciliationForState: () => reconciliation };
}
const leg = (id, type, accountId, extra = {}) => ({ id, type, accountId, amountFils: 50000, date: '2026-09-10', ts: Date.now(),
  title: 'Transfer', category: 'transfer', source: 'sms', ...extra });
const accountsFixture = [{ id: 'current', name: 'Current account', type: 'bank' }, { id: 'savings', name: 'Savings', type: 'bank' }];
```

Replace the old pair test's assertions (after `const tree = h.renderScreen('transfers');`) with:

```js
    const row = byId(tree, 'transfer-row-out|in');
    assert.ok(row, 'a linked pair is one route row');
    assert.match(row.props.accessibilityLabel, /Current account.*Savings/);
    row.props.onPress();
    assert.ok(h.events.some(event => event[0] === 'state' && event[2] === 'out'), 'the row opens the outgoing entry');
```

Add:

```js
test('tiles show totals and filter the list; tapping again clears', () => {
  const rows = [leg('out', 'expense', 'current'), leg('in', 'income', 'savings'), leg('pay', 'expense', 'current', { amountFils: 8500 })];
  const h = harness({ language: 'en', state: { transactions: rows, accounts: accountsFixture } });
  withReconciliation(h, [
    ['out', { id: 'out', status: 'confirmed-own', reason: 'user', counterpartId: 'in', candidateIds: [] }],
    ['in', { id: 'in', status: 'confirmed-own', reason: 'user', counterpartId: 'out', candidateIds: [] }],
    ['pay', { id: 'pay', status: 'confirmed-external', reason: 'user', candidateIds: [] }],
  ]);
  let tree = h.renderScreen('transfers');
  assert.ok(text(byId(tree, 'transfers-tile-own')).includes('500'));
  assert.ok(text(byId(tree, 'transfers-tile-sent')).includes('85'));
  byId(tree, 'transfers-tile-sent').props.onPress();
  tree = h.renderScreen('transfers');
  const rowIds = walk(tree).map(n => n.props?.testID).filter(id => id?.startsWith('transfer-row-'));
  assert.deepEqual(rowIds, ['transfer-row-pay']);
});

test('question card answers the first queued transfer', async () => {
  const rows = [leg('q1', 'expense', 'current', { date: '2026-09-12' }), leg('q2', 'expense', 'current', { date: '2026-09-11' })];
  const h = harness({ language: 'en', state: { transactions: rows, accounts: accountsFixture } });
  withReconciliation(h, rows.map(r => [r.id, { id: r.id, status: 'ownership-unknown', reason: 'missing-evidence', candidateIds: [] }]), ['q1', 'q2']);
  const tree = h.renderScreen('transfers');
  const card = byId(tree, 'transfer-question-card');
  const words = h.deps['@/lib/transfer-activity-copy'].transferActivityCopy('en');
  assert.ok(text(card).includes(words.card.step(1, 2)));
  await byId(card, 'transfer-answer-external').props.onPress();
  assert.equal(h.answers.length, 1);
  assert.equal(h.answers[0].transaction.id, 'q1');
  assert.equal(h.answers[0].answer, 'external');
});
```

Note: the harness's `useState` may not re-render on `setTile`. If the tile test's second `renderScreen` doesn't reflect the press, check how other tests in `scripts/test/repair` assert state changes (look for `rerender` or `h.events` with `'state'`). Assert through the same mechanism: the `state` event carries the new tile value. Keep the intent: pressing Sent leaves only `pay`.

Remove assertions about `transfer-matched-pair`, the All/Confirmed/Not confirmed segmented control, `recordsNote` and `transfer-pairs-link`. In `transfer-history-ui.test.cjs`, replace status-word assertions (`own`, `external`, `unconfirmed`, `needsReview`, `review`) with the new `tags.*` words, and the "Review ownership button only on queued rows" rule with "the question card lists exactly the queued rows".

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Rewrite the screen body**

Keep the reconciliation/activity memos and `sections` period/search filtering. Replace state and render with:

```tsx
  const [tile, setTile] = useState<TransferTile | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const { answer, busy } = useTransferAnswer();
  const pairs = useMemo(() => matchedTransferPairs(reconciliation, rowsById, pair => inPeriod(pair.out.date, period)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reconciliation, rowsById, period, state.monthStartDay]);
  const inView = useMemo(() => activity.filter(item => inPeriod(item.transaction.date, period) && matchesSearch(item)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activity, period, search, accounts]);
  const items = useMemo(() => transferListItems(inView, pairs), [inView, pairs]);
  const totals = useMemo(() => transferTotals(items), [items]);
  const shown = useMemo(() => filterTransferItems(items, tile), [items, tile]);
  // Questions are the reconciler's queue, newest first, regardless of period.
  const queue = useMemo(() => activity.filter(item => item.needsReview)
    .sort((a, b) => b.transaction.date.localeCompare(a.transaction.date)), [activity]);
  const current = queue[Math.min(questionIndex, Math.max(queue.length - 1, 0))];
  const hint = current ? (() => {
    const [candidate] = ownCandidates(current.transaction, current.assessment, rowsById);
    return candidate ? words.card.looksLike(accountName(candidate.accountId)) : undefined;
  })() : undefined;
  const answerCurrent = async (choice: TransferAnswer) => {
    if (!current) return;
    const candidates = ownCandidates(current.transaction, current.assessment, rowsById);
    if (choice === 'own' && candidates.length > 1) { setSelectedId(current.transaction.id); return; }
    const labels = current.transaction.type === 'income' ? words.answers.in : words.answers.out;
    await answer({ transaction: current.transaction, answer: choice, counterpart: candidates[0], label: labels[choice] });
  };
```

where `matchesSearch(item)` is the existing search predicate lifted out of `sections` unchanged. When the person picks "own" and more than one account could be the other side, the detail sheet (Task 7) opens and shows the account picker.

`bandContent`:

```tsx
      bandContent={<View testID="transfers-band" style={styles.bandIntro}>
        <BandFigure label={words.headline(periodLabel(period))} fils={totals.ownFils} decimals palette={band} qualifier={words.notCounted} />
        <View style={[styles.tiles, large && styles.tilesStack]}>
          {([['own', totals.ownFils], ['sent', totals.sentFils], ['received', totals.receivedFils]] as const).map(([key, fils]) => {
            const on = tile === key;
            return <Pressable key={key} testID={`transfers-tile-${key}`} accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${words.tiles[key]}. ${moneyLabel(fils)}`}
              onPress={() => setTile(on ? null : key)}
              style={[styles.tile, { backgroundColor: on ? band.onBand : band.tile }]}>
              <Icon name={key === 'own' ? 'repeat' : key === 'sent' ? 'arrow-up-right' : 'arrow-down-right'} size={15}
                color={on ? band.band : band.onBand} />
              <ThemedText type="meta" style={{ color: on ? band.band : band.onBandSecondary }}>{words.tiles[key]}</ThemedText>
              <Money fils={fils} type="smallBold" color={on ? band.band : band.onBand} />
            </Pressable>;
          })}
        </View>
      </View>}
```

Use the real palette keys from `src/constants/theme.ts` (`grep -n "BandPalette" -A30 src/constants/theme.ts`). If `band.band` is not the band background key, use the one that is. Check that `Money` accepts `color`; if it doesn't, wrap it in a `ThemedText` colour context the way `BandFigure` does. Use the same `periodLabel` helper `transactions.tsx` imports.

Sheet content: replace the `SectionList` with a `FlatList` (`testID="transfer-history"`):
- `ListHeaderComponent`: the search field (kept), the `PeriodPill` row, the `TransferQuestionCard` when `current` exists (`onAnswer={answerCurrent}`, `onSeeAll={() => router.push('/review-transfers')}`, `accountLabel={accountName(current.transaction.accountId)}`, `hint`), then a `listTitle` header.
- `data={shown}`, `renderItem={({ item, index }) => <TransferRouteRow item={item} first={index === 0} accountLabel={accountName} palette={band} onPress={() => setSelectedId(item.transactionId)} />}`, all inside a card container style (`backgroundColor: band.card`, radius 18, horizontal padding `Spacing.three`). Apply it through `contentContainerStyle` plus `CellRendererComponent`, or wrap each row's background, whichever the existing list screens use. Look at how `review-transfers.tsx` draws carded lists.
- Keep `ListEmptyComponent` with `words.empty` / `words.emptyBody`.
- Keep `PeriodSheet` and `EntryDetailSheet` as they are.

Delete: `Scope`, `SegmentedControl`, `recordsNote`, the matched-pairs block, `transfer-pairs-link`, the per-row Review button, and every import that is now unused.

Add styles:

```ts
  tiles: { flexDirection: 'row', gap: Spacing.two },
  tilesStack: { flexDirection: 'column' },
  tile: { flex: 1, minHeight: 72, borderRadius: 14, padding: Spacing.two, gap: 2 },
```

- [ ] **Step 4: Run, PASS; lint; commit**

```bash
(cd scripts/test && bash build.sh) && node --test scripts/test/repair/transfers-band.test.cjs scripts/test/repair/transfer-history-ui.test.cjs scripts/test/repair/transfer-list.test.cjs
npx eslint src/app/transfers.tsx && npx tsc --noEmit -p .
git add src/app/transfers.tsx scripts/test/repair/transfers-band.test.cjs scripts/test/repair/transfer-history-ui.test.cjs
git commit -m "feat(transfers): summary tiles, one-tap question card and route list

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Entry detail sheet asks "What is this?"; swipe and alert-review alignment

**Files:**
- Modify: `src/components/entry-detail-sheet.tsx` (~186-200 ownership; 300-307 `markAsTransfer`; 405-470 chips/buttons; 578-590 edit toggle; 657-666 confirm sheet)
- Modify: `src/lib/reference-copy.ts:176-177` (chip label → "Moved to my own account")
- Modify: `src/app/add-transaction.tsx:1075-1088` copy key only (checkbox label → `answers.out.own`)
- Modify: `src/app/transactions.tsx:408-427` (swipe "Transfer" opens the sheet, never `/review-transfers`)
- Test: `scripts/test/repair/everyday-band-screens.test.cjs:67` (update), `scripts/test/repair/transfer-review-ui.test.cjs` (keep passing), new cases in `transfer-components.test.cjs`

**Interfaces:**
- Consumes: `TransferAnswerChoices`, `useTransferAnswer`, `currentAnswer`, `ownCandidates`, copy `answers`.

- [ ] **Step 1: Failing tests** — in `everyday-band-screens.test.cjs` replace the `entry-mark-transfer` assertion with:

```js
// A transfer candidate shows the three answers; an ordinary row shows only the own-account action.
assert.ok(byId(candidateTree, 'transfer-answer-own') && byId(candidateTree, 'transfer-answer-none'));
assert.equal(byId(candidateTree, 'entry-mark-transfer'), undefined);
assert.ok(byId(ordinaryTree, 'entry-mark-transfer'));
assert.equal(text(byId(ordinaryTree, 'entry-mark-transfer')), words.answers.out.own);
```

(`candidateTree` renders `EntryDetailSheet` with an SMS row titled "Outgoing transfer" carrying `transferEvidence`; `ordinaryTree` renders a manual Carrefour expense; copy both fixtures from the existing test's row builders.)

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Sheet changes**

- Remove the edit-mode Toggle "Transfer between my accounts" (578-590), the `isTransfer` state and the `...(!transferReview ? { isTransfer: ... } : {})` field in `save`.
- Remove the `entry-transfer-review` "Check a transfer" button (463-469).
- Remove the ConfirmSheet for marking (657-666). The chip `entry-mark-transfer` stays only when `!isTransferCandidate(transaction)`, now labelled `words.answers.out.own` (income: `answers.in.own`), and calls `markAsTransfer` directly. That makes it one tap, matching the spec's "same behaviour".
- For `isTransferCandidate(transaction)` render, in place of the removed transfer chip/button area:

```tsx
        {isTransferCandidate(transaction) && <View testID="entry-transfer-question" style={styles.transferQuestion}>
          <ThemedText type="smallBold" accessibilityRole="header">{answerWords.question}</ThemedText>
          {picking ? <View style={styles.picker}>
            <ThemedText type="small" themeColor="textSecondary">{answerWords.whichAccount}</ThemedText>
            {candidates.map(candidate => <Pressable key={candidate.id} testID={`entry-transfer-candidate-${candidate.id}`}
              accessibilityRole="button" onPress={() => void choose('own', candidate)}
              style={[styles.pickRow, { borderColor: band.rule }]}>
              <ThemedText type="smallBold">{accountLabelFor(candidate.accountId)}</ThemedText>
              <ThemedText type="meta" themeColor="textSecondary">{shortDate(candidate.date)}</ThemedText>
            </Pressable>)}
            <Pressable accessibilityRole="button" onPress={() => void choose('own')} style={[styles.pickRow, { borderColor: band.rule }]}>
              <ThemedText type="small">{answerWords.noLink}</ThemedText>
            </Pressable>
          </View> : <TransferAnswerChoices incoming={transaction.type === 'income'} value={answered} layout="radios"
            palette={band} disabled={busy}
            linkedLabel={linkedTo ? activityWords.route.linked(accountLabelFor(linkedTo.accountId)) : undefined}
            onChange={next => {
              if (next === 'own' && candidates.length > 1) { setPicking(true); return; }
              void choose(next, next === 'own' ? candidates[0] : undefined);
            }} />}
        </View>}
```

with, near the other derived values:

```tsx
  const { answer, busy } = useTransferAnswer();
  const answerWords = transferActivityCopy(language).answers;
  const activityWords = transferActivityCopy(language);
  const rowsById = useMemo(() => new Map(state.transactions.map(row => [row.id, row] as const)), [state.transactions]);
  const answered = currentAnswer(transaction, transferAssessment);
  const candidates = ownCandidates(transaction, transferAssessment, rowsById);
  const linkedTo = transferAssessment?.counterpartId ? rowsById.get(transferAssessment.counterpartId) : undefined;
  const [picking, setPicking] = useState(false);
  const accountLabelFor = (id: string) => {
    const found = state.accounts.find(a => a.id === id);
    return found ? accountDisplayName(found) : activityWords.accountUnknown;
  };
  const choose = async (next: TransferAnswer, counterpart?: Transaction) => {
    const labels = transaction.type === 'income' ? answerWords.in : answerWords.out;
    const saved = await answer({ transaction, answer: next, counterpart, label: labels[next] });
    if (saved) { setPicking(false); onClose(); }
  };
```

Hooks must run before the `if (!transaction) return null;` early return. Move `useTransferAnswer`, `useState(picking)` and the `rowsById` memo above it, and guard their inputs (`state.transactions` is always defined). Where the sheet is opened from Transfers without an assessment, `transferAssessment` is undefined, so `ownCandidates` returns `[]` and "own" saves without a link. That matches the spec. Reset `picking` with `useEffect(() => setPicking(false), [transaction?.id])`.

Styles: `transferQuestion: { gap: Spacing.two }`, `picker: { gap: Spacing.two }`, `pickRow: { minHeight: 48, borderWidth: 1, borderRadius: 12, padding: Spacing.three, gap: 2 }`.

- [ ] **Step 4: Swipe action** — in `transactions.tsx` `rowActions`, replace the transfer `onPress` with:

```ts
        onPress: () => { Keyboard.dismiss(); setEntryMode('read'); setEditing(tx); } });
```

(The sheet now shows the question for candidates and the one-tap own action for others.)

- [ ] **Step 5: Copy alignment** — `reference-copy.ts:176-177`: the mark chip label becomes "Moved to my own account" / "نُقلت إلى حسابي", and delete the confirm question/body keys if nothing else uses them (`grep -rn` them first). In `add-transaction.tsx` make the checkbox label read from `transferActivityCopy(language).answers.out.own` (income review: `answers.in.own`) in place of its current literal or key. Leave its behaviour untouched.

- [ ] **Step 6: Run, PASS; lint; commit**

```bash
(cd scripts/test && bash build.sh) && node --test scripts/test/repair/everyday-band-screens.test.cjs scripts/test/repair/transfer-components.test.cjs scripts/test/repair/transfer-review-ui.test.cjs scripts/test/repair/transaction-ui-regression.test.cjs
npx eslint src/components/entry-detail-sheet.tsx src/app/transactions.tsx src/app/add-transaction.tsx src/lib/reference-copy.ts && npx tsc --noEmit -p .
git add src/components/entry-detail-sheet.tsx src/app/transactions.tsx src/app/add-transaction.tsx src/lib/reference-copy.ts scripts/test/repair/everyday-band-screens.test.cjs scripts/test/repair/transfer-components.test.cjs
git commit -m "feat(transfers): one 'What is this?' answer in every detail sheet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Browser checks, docs, full suite, device pass

**Files:**
- Modify: `scripts/e2e/e2e-transfer-review.mjs`, `scripts/e2e/e2e-card-activity.mjs:126`, `scripts/e2e/e2e-transfer-batch.mjs` (copy/testIDs only)
- Create: `scripts/e2e/e2e-transfers-page.mjs`; add it to `scripts/e2e/run.sh` after `e2e-transfer-batch.mjs`
- Modify: `docs/design/transfers.md`

- [ ] **Step 1: Update e2e copy.** `e2e-card-activity.mjs:126` matches `/kept apart/` instead of `shown separately`. In `e2e-transfer-review.mjs`, replace `entry-transfer-review` navigation with opening the row and using `transfer-answer-own|external`. Keep `transfer-choice-*` assertions only where the flow still goes through `/review-transfers` ("See all").

- [ ] **Step 2: New `e2e-transfers-page.mjs`.** Follow the structure of `e2e-transfer-batch.mjs` (isolated synthetic ledger, `BASE` env, Playwright). At 320 and 390px, light and dark, `en` and `ar`, check:
  1. `transfers-tile-own` shows the expected total; tapping `transfers-tile-sent` leaves only external rows; tapping again restores them.
  2. `transfer-question-card` shows "1 of 2". Tapping `transfer-answer-external` saves, the toast shows Undo, and the card shows "1 of 1". Tapping Undo brings back "1 of 2".
  3. Open a row and choose `transfer-answer-none`. The row leaves Transfers and appears in `/transactions` with its amount counted in Net.
  4. `/transactions`: `transactions-summary-line` and `transactions-net-total` have different `boundingBox().y` values, and the summary line is wider than 200px.

- [ ] **Step 3: Docs.** Rewrite `docs/design/transfers.md` "Browsing and accounting" to describe the one question, the three answers including `'none'`, tiles, the question card, the route rows and the strip. Keep the "Implementation boundaries" section and add `transfer-list.ts`/`transfer-answer.ts`. Replace the Verification section with this round's results only after running them.

- [ ] **Step 4: Full suite**

```bash
npm test
bash scripts/e2e/run.sh
```

Expected: all pass. Fix any copy assertion that still references removed words (`grep -rn "transfer record\|Ownership needs review\|Not confirmed\|Matched pairs" scripts src`).

- [ ] **Step 5: Device pass.** On an Android phone at the default font size, open Transactions with at least one excluded movement and check that the summary line reads normally. On the iOS simulator, check the Transfers page in light/dark, the question card, and the detail sheet's three answers and Undo. Record what was checked, and on which device, in `docs/design/transfers.md` Verification.

- [ ] **Step 6: Commit**

```bash
git add scripts/e2e/e2e-transfers-page.mjs scripts/e2e/run.sh scripts/e2e/e2e-transfer-review.mjs scripts/e2e/e2e-card-activity.mjs scripts/e2e/e2e-transfer-batch.mjs docs/design/transfers.md
git commit -m "test(transfers): browser checks and docs for the redesigned flow

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Independent review.** Dispatch a read-only reviewer on the full branch diff, paying particular attention to Task 1 (money totals, decision validation, corroboration) and Task 4 (stale-fingerprint and durability handling). Fix what it confirms before asking to push.
