# iPhone Core Screen Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Wafra's core ledger screens to the approved Ledger Refined/Paper Statement hierarchy and interaction contracts without changing financial projections, grouping, routing, or store commands.

**Architecture:** Each screen family consumes the foundation primitives while retaining its existing selectors and domain actions. Interaction safety lands before visual rearrangement; the migration proceeds family by family so any screen can revert to compatibility primitives without undoing the foundation. Screen-private financial composition stays private.

**Tech Stack:** Expo SDK 55, React Native 0.83, Expo Router 55, shared Wafra UI foundation, Reanimated 4, Node contract/domain tests, Playwright web E2E.

**Spec:** `docs/superpowers/specs/2026-09-04-ios-release-ui-polish-design.md`

## Global Constraints

- Complete `docs/superpowers/plans/2026-09-04-ios-ui-foundation.md` first with its independent review green.
- Start only after the active one-page iPhone onboarding work is stable; do not edit `ios-setup.tsx`, `import-sms.tsx`, onboarding state, native history, or Shortcut artifacts in this plan.
- Preserve Home's `projectDashboard()` inputs and exact `dashboard.hero.netFils`, `incomeFils`, and `expenseFils`; never introduce “safe to spend.”
- Preserve Bills' exact `subscriptions | cards | utilities` values and current selector membership. Do not regroup them as Upcoming/Recurring.
- Preserve card statement balance, due, minimum due, and payment allocation in `src/lib/cards.ts`; presentation code must not recalculate them.
- Preserve transaction URL filters (`source`, `type`, `category`, `merchant`), `/cards?card=`, and `/add-transaction?reviewId=`.
- Preserve RevenueCat/storefront prices; never substitute ledger currency on Pro.
- Keep route filenames and literal deep links stable.
- Keep custom screen fragments private unless they are already reused by two screen families.
- Use only shared tokens/components in migrated surfaces; no new local `Modal`, literal hex color, synthetic custom-font `fontWeight`, or undersized icon action.
- Commits are suggestions and require separate user authorization.

---

### Task 1: Add the core-screen preservation contract

**Files:**
- Create: `scripts/test/ui-polish-contract.test.js`
- Modify: `scripts/test/run.sh`
- Modify: `scripts/test/routes.test.js`

**Interfaces:**
- Consumes: foundation suite count of 66 and current route/screen source.
- Produces: suite `ui-polish-contract`; total app-suite count 67; a green invariant baseline that later tasks extend and satisfy one family at a time.

- [ ] **Step 1: Create the green screen-preservation suite**

Create `scripts/test/ui-polish-contract.test.js`:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const code = (value) => value.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const home = read('src/screens/ledger-home-screen.tsx');
assert.match(home, /projectDashboard\(\{/);
assert.match(home, /netFils=\{dashboard\.hero\.netFils\}/);
assert.match(home, /incomeFils=\{dashboard\.hero\.incomeFils\}/);
assert.match(home, /expenseFils=\{dashboard\.hero\.expenseFils\}/);

const transactions = read('src/app/transactions.tsx');
for (const parameter of ['source', 'type', 'category', 'merchant']) {
  assert.match(transactions, new RegExp(`${parameter}.*useLocalSearchParams|useLocalSearchParams[\\s\\S]*${parameter}`));
}
assert.match(transactions, /<SectionList/);
assert.match(transactions, /clearFilters/);

const add = read('src/app/add-transaction.tsx');
assert.match(add, /reviewId/);
assert.match(add, /promoteReviewAlert/);
assert.match(add, /addTransaction/);

const bills = code(read('src/app/(tabs)/bills.tsx'));
assert.match(bills, /type Segment = 'subscriptions' \| 'cards' \| 'utilities'/);
for (const seam of ['openDues(', 'recentlySettledDues(', 'billsForMonth(', 'billFromSubscription(']) {
  assert.ok(bills.includes(seam), `Bills lost ${seam}`);
}
const cards = read('src/app/cards.tsx');
assert.match(cards, /useLocalSearchParams<\{ card\?: string \}>/);
assert.match(cards, /setDetail\(target\)/);

const flow = read('src/app/(tabs)/flow.tsx');
assert.match(flow, /summarizeMonth\(/);
assert.match(flow, /composition\(/);

const pro = read('src/app/pro.tsx');
for (const seam of ['loadStorePrices(', 'purchasePro(', 'restorePro(', 'priceString']) {
  assert.ok(pro.includes(seam), `Pro lost ${seam}`);
}

console.log('✓ core screen preservation baseline');
```

- [ ] **Step 2: Register the suite**

Change `EXPECTED_SUITES=66` to `EXPECTED_SUITES=67` in `scripts/test/run.sh`, and append:

```bash
SUITES+=(ui-polish-contract)
```

- [ ] **Step 3: Extend query-route coverage**

Add static assertions in `scripts/test/routes.test.js` that the source retains these typed routes:

```js
ok('card and review routes retain their serializable IDs',
  /useLocalSearchParams<\{ card\?: string \}>/.test(
    fs.readFileSync(path.join(SRC, 'app/cards.tsx'), 'utf8'),
  ) &&
  /pathname: '\/add-transaction', params: \{ reviewId: item\.id \}/.test(
    fs.readFileSync(path.join(SRC, 'app/review-alerts.tsx'), 'utf8'),
  ));
```

- [ ] **Step 4: Verify the baseline**

```bash
node scripts/test/ui-polish-contract.test.js
```

Expected: pass. Each following task appends its own failing presentation
assertion immediately before implementing that family, so every completed task
returns the registered suite to green.

- [ ] **Step 5: Commit if authorized**

```bash
git add scripts/test/ui-polish-contract.test.js scripts/test/routes.test.js scripts/test/run.sh
git commit -m "test: pin core screen polish invariants"
```

---

### Task 2: Remove nested and long-press-only interactions

**Files:**
- Modify: `src/app/(tabs)/bills.tsx`
- Modify: `src/app/(tabs)/wallet.tsx`
- Modify: `src/app/cards.tsx`
- Modify: `src/components/card-detail-sheet.tsx`
- Modify: `scripts/test/bills.test.js`
- Modify: `scripts/test/accessibility-layout.test.js`
- Modify: `scripts/test/routes.test.js`
- Modify: `scripts/test/ui-polish-contract.test.js`

**Interfaces:**
- Consumes: existing detail sheets, confirmation state, `billFromSubscription`, `onPayDue`, `/cards?card=`.
- Produces: one primary target per row; secondary actions in detail/footer; normal-tap Wallet discovery; optional long-press shortcuts retained.

- [ ] **Step 1: Add failing interaction assertions**

Insert immediately before the final `console.log` in `ui-polish-contract.test.js`:

```js
const interactionBills = code(read('src/app/(tabs)/bills.tsx'));
const recurringRow = interactionBills.match(
  /const renderRecurringRow[\s\S]*?\n  \};\n\n  return \(/,
)?.[0] ?? '';
assert.ok(recurringRow.length > 0, 'recurring row block was not found');
assert.doesNotMatch(recurringRow, /remindAboutA11y/);
const multiDueRows = interactionBills.match(
  /dues\.length > 1 && dues\.map[\s\S]*?(?=\n\s*\{dues\.length === 0)/,
)?.[0] ?? '';
assert.ok(multiDueRows.length > 0, 'multi-card due rows were not found');
assert.doesNotMatch(multiDueRows, /t\('markPaid'\)/);

const interactionWallet = code(read('src/app/(tabs)/wallet.tsx'));
assert.match(interactionWallet, /onPress=\{\(\) => openAccount\(account\)\}/);
assert.match(interactionWallet, /onLongPress=\{\(\) => setOptionsFor\(account\)\}/);
assert.match(interactionWallet, /accessibilityState=\{\{ expanded: showInactive \}\}/);
```

Insert immediately before its final summary `console.log` in `scripts/test/accessibility-layout.test.js`:

```js
const recurringAccessibilityBlock = bills.match(
  /const renderRecurringRow[\s\S]*?\n  \};\n\n  return \(/,
)?.[0] ?? '';
ok('Bills rows have one primary target and move secondary actions into details',
  recurringAccessibilityBlock.length > 0 &&
    !/remindAboutA11y/.test(recurringAccessibilityBlock) &&
    /<CardDetailSheet[\s\S]{0,500}footer=/.test(bills));
ok('Wallet source rows open on normal tap and keep long press optional',
  /onPress=\{\(\) => openAccount\(account\)\}/.test(wallet) &&
    /onLongPress=\{\(\) => setOptionsFor\(account\)\}/.test(wallet));
```

Run the test and expect failure on both assertions.

- [ ] **Step 2: Remove the nested subscription reminder**

Delete the `remindAboutA11y` child `Pressable` from `renderRecurringRow`. Keep the row's `onPress={() => setDetail(sub)}` and optional long-press shortcut. The existing subscription detail already renders Remind Me and Not a Subscription; move its `detailActions` view into the shared BottomSheet `footer` prop so the actions stay reachable above the keyboard.

Conditionally mount the subscription detail sheet while `detail` is non-null.
When Not a Subscription opens its confirmation, clear `detail` first so the
compatibility sheet unmounts before the confirmation Modal appears.

Update the existing source contract in `bills.test.js`: `addBill(` now has two
call sites (subscription detail and manual adder), exactly one subscription
call goes through `billFromSubscription`, and `remindable(detail)` remains the
single cadence gate. This is the expected consequence of deleting the duplicate
row action, not a weakening of the test.

- [ ] **Step 3: Move Mark Paid into card detail**

Extend `CardDetailSheetProps`:

```ts
interface CardDetailSheetProps {
  account: Account | null;
  onClose: () => void;
  footer?: React.ReactNode;
}
```

Pass `footer` to `BottomSheet`. In Bills, remove the nested Mark Paid `Pressable` from each due row. Track the selected due ID alongside the selected account and pass:

```tsx
footer={selectedDue ? (
  <Button
    label={t('markPaid')}
    onPress={() => onPayDue(
      selectedDue.due.id,
      selectedDue.remainingFils,
      selectedDue.due.accountId,
      cardDetail?.name ?? t('card'),
    )}
  />
) : undefined}
```

The existing confirmation still owns the `payCardDue` command.

Store the selected due by ID, derive it from the live `dues` list, and clear
both the selected due and `cardDetail` in one close helper. Every non-payable
card-detail opener explicitly clears the selected due. The footer captures the
current due/name, closes CardDetail first, then calls `onPayDue`; this prevents
stacked Modals and stale payment actions.

Manual reminder rows follow the same single-target rule. Remove their nested
Mark Paid target and long-press-only delete path. A normal row tap opens a
conditionally mounted Bills-private detail `BottomSheet`; its footer exposes
Mark Paid (when unpaid) and Delete using the existing `onPay` and delete
confirmation functions. Close that detail sheet before opening either
confirmation. Do not reuse subscription-specific `BillDetailSheet` semantics.

- [ ] **Step 4: Add normal-tap Wallet behavior**

Add one screen-private function:

```ts
const openAccount = (account: Account) => {
  if (account.kind === 'card' || account.cardType) {
    router.push(`/cards?card=${account.id}`);
    return;
  }
  setOptionsFor(account);
};
```

Add `onPress={() => openAccount(account)}` to active and inactive account rows. Keep `onLongPress={() => setOptionsFor(account)}`. Add `accessibilityRole="button"` and preserve the complete balance/activity label.

Extend `routes.test.js` in this same step to require the new Wallet caller to
push `/cards?card=${account.id}`; the baseline card route-param assertion from
Task 1 remains unchanged.

Add `accessibilityRole="button"`, a localized label, and `accessibilityState={{ expanded: showInactive }}` to the inactive disclosure header.

Give recurring Bills rows, payable card rows, and manual reminder rows explicit
button roles and complete localized labels while preserving their visible
content and calculations.

- [ ] **Step 5: Make Set Limit a visible card action**

Remove the bare text `onPress` in `cards.tsx`. Pass a visible footer to the
opened `CardDetailSheet`: credit cards receive a Set credit limit `Button` that
closes detail then calls `askCreditLimit(card)` (which also initializes
`limitText`), and every card receives a Manage `Button` that closes detail then
opens the existing `ChoiceSheet` for Hide/Delete. Remove `limit` from
`CardAction`/`cardActions`; long press may retain the same management sheet as
an optional shortcut. Remove the long-press-only hint because management is now
discoverable through normal tap. Keep limit persistence and `editAccount`
commands unchanged.

- [ ] **Step 6: Verify interactions**

```bash
node scripts/test/ui-polish-contract.test.js
node scripts/test/accessibility-layout.test.js
node scripts/test/routes.test.js
npm run typecheck
npm run test:e2e
```

Expected: Bills has no nested secondary action, Wallet normal taps lead somewhere, and every opened detail/confirmation can close.

- [ ] **Step 7: Commit if authorized**

```bash
git add src/app/'(tabs)'/bills.tsx src/app/'(tabs)'/wallet.tsx src/app/cards.tsx src/components/card-detail-sheet.tsx scripts/test/bills.test.js scripts/test/accessibility-layout.test.js scripts/test/routes.test.js scripts/test/ui-polish-contract.test.js
git commit -m "fix: make bill and wallet actions discoverable"
```

---

### Task 3: Polish Home, Transactions, and Add Transaction

**Files:**
- Modify: `src/components/ui/screen-scaffold.tsx`
- Modify: `src/screens/ledger-home-screen.tsx`
- Modify: `src/app/transactions.tsx`
- Modify: `src/app/add-transaction.tsx`
- Modify: `src/components/transaction-row.tsx`
- Modify: `scripts/test/accessibility-layout.test.js`
- Modify: `scripts/e2e/e2e-navigation.mjs`
- Modify: `scripts/test/dashboard-projection.test.js`
- Modify: `scripts/test/ui-polish-contract.test.js`

**Interfaces:**
- Consumes: `ScreenScaffold`, `useScreenContentInsets`, `TextField`, `ActionIconButton`, current dashboard projection and URL filter state.
- Produces: one focal Home net answer; virtualized Transactions with shared insets; keyboard-safe Add form with visible labels.

- [ ] **Step 1: Strengthen the Home projection boundary test**

In `dashboard-projection.test.js`, retain its existing fixtures and add:

```js
eq(
  'hero net remains shown income less shown spending',
  projected.hero.netFils,
  projected.hero.incomeFils - projected.hero.expenseFils,
);
```

Place it in the existing populated-ledger block that defines `projected`. Run
`bash scripts/test/build.sh && node scripts/test/dashboard-projection.test.js`;
it must pass before presentation edits.

- [ ] **Step 2: Add the failing family contract**

Insert immediately before the final `console.log` in `ui-polish-contract.test.js`:

```js
assert.match(read('src/screens/ledger-home-screen.tsx'), /<ScreenScaffold[\s\S]*tabbed/);
const transactionUi = read('src/app/transactions.tsx');
assert.match(transactionUi, /useScreenContentInsets/);
assert.match(transactionUi, /scroll=\{false\}[\s\S]*virtualized/);
assert.match(transactionUi, /<TextField/);
assert.match(transactionUi, /clearSearch/);
const addUi = read('src/app/add-transaction.tsx');
assert.match(addUi, /<ScreenScaffold/);
assert.match(addUi, /keyboardAware/);
assert.match(addUi, /<TextField/);
assert.match(addUi, /focusFirstInvalid/);
assert.match(addUi, /onSavePress/);
```

Run `node scripts/test/ui-polish-contract.test.js` and expect failure on the
new presentation assertions while the projection assertions remain green.

- [ ] **Step 3: Migrate Home's shell, not its calculations**

Before migrating screens, fix two foundation handoff seams in
`screen-scaffold.tsx`: use the already computed safe-area-aware `top` in
`effectiveInsets.contentInset.top`, and when `keyboardAware` on non-iOS add the
existing measured `useKeyboardHeight()` value to the scrolling content bottom.
Keep iOS `KeyboardAvoidingView behavior="padding"`. Add source assertions for
both fixes before implementation.

Define the header object next to `onRefresh` and replace the root
ThemedView/SafeAreaView/ScrollView opening tags with:

```tsx
const homeHeader: ScreenHeaderProps = {
  title: t('tabHome'),
  leading: <PeriodPill onPress={() => setPeriodSheetOpen(true)} />,
  actions: [
    { label: t('searchMerchants'), icon: 'search', onPress: () => router.push('/transactions') },
    { label: t('settingsTitle'), icon: 'sliders', onPress: () => router.push('/settings') },
  ],
};

<ScreenScaffold
  tabbed
  headerMode="inline"
  refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
  header={homeHeader}>
```

Keep the current JSX beginning at
`{!state.hydrated ? (` and ending immediately before the closing current
`ScrollView` tag, and place that unchanged branch directly inside
`ScreenScaffold`, followed by its closing tag. Remove only the duplicated
top-row/safe-area/scroll wrapper.
Keep `projectDashboard`, FX refresh, capture status, routes, and all
`dashboard.*` values byte-for-byte.

- [ ] **Step 4: Keep one factual hierarchy**

Preserve `Hero` as the focal answer and its In/Spent split. Keep Automatic Capture as a quiet action row and recent activity after Leaving Soon. Remove no capability state and add no new total.

- [ ] **Step 5: Migrate Transactions as a virtualized scaffold**

Use `ScreenScaffold scroll={false} virtualized` and:

```ts
const listInsets = useScreenContentInsets({ hasFooter: false });
```

Apply its `contentContainerStyle`, `contentInset`, and `scrollIndicatorInsets` to the existing `SectionList`. Replace the local search `TextInput` with:

```tsx
<TextField
  label={tr('searchMerchants')}
  value={query}
  onChangeText={setQuery}
  inputMode="search"
  returnKeyType="search"
  leading={<Icon name="search" size={17} color={theme.textSecondary} />}
  trailing={query.length > 0 ? (
    <ActionIconButton
      icon="close"
      label={tr('clearSearch')}
      variant="plain"
      onPress={() => setQuery('')}
    />
  ) : undefined}
/>
```

Keep the 140ms applied-query delay, `merchantFilter`, `Filters`, `clearFilters`, section construction, and URL-param initialization unchanged. Keep active filters as removable `Chip`s and retain Clear All.

Use an explicit native `ScreenHeader` contract with route-owned Back and Add
Transaction actions. Move the search, removable active filters, summary, and
visible Filters trigger into `SectionList.ListHeaderComponent`; the
`SectionList` remains the only vertical scroller. Keep the web-specific custom
date-range `TextInput`s inside the filter sheet.

- [ ] **Step 6: Migrate Add Transaction fields and focus**

Wrap the form in `ScreenScaffold keyboardAware headerMode="inline"`. Replace amount, title, and review-date direct inputs with labeled `TextField`s. Keep `parseAmountToFils`, `canSave`, `promoteReviewAlert`, `addTransaction`, duplicate behavior, account requirement, and review route validation unchanged.

Add refs, adjacent errors, and focus in the same order as the visible form:

```ts
const amountRef = useRef<TextInput>(null);
const categoryRef = useRef<View>(null);
const accountRef = useRef<View>(null);
const reviewDateRef = useRef<TextInput>(null);
const [showValidation, setShowValidation] = useState(false);

const focusGroup = (ref: React.RefObject<View | null>) => {
  const node = findNodeHandle(ref.current);
  if (node !== null) AccessibilityInfo.setAccessibilityFocus(node);
};

const focusFirstInvalid = () => {
  if (!reviewItem && !amountFils) {
    amountRef.current?.focus();
    return;
  }
  if (!category) {
    focusGroup(categoryRef);
    return;
  }
  if (!accountId) {
    focusGroup(accountRef);
    return;
  }
  if (reviewItem && !/^\d{4}-\d{2}-\d{2}$/.test(reviewDate)) {
    reviewDateRef.current?.focus();
  }
};

const onSavePress = () => {
  if (!canSave) {
    setShowValidation(true);
    focusFirstInvalid();
    return;
  }
  void save();
};
```

Add `AccessibilityInfo`, `findNodeHandle`, `TextInput`, and `View` to the
React Native imports and `useRef`/`useState` to the React imports used by this
block.

Wire the visible Save button to `onSavePress` and disable it only while
`saving` or when `reviewRouteInvalid` makes the route unusable. The existing
`save()` guard remains the final admission boundary. Do not move money/date
parsing into `TextField`.

Pass `invalid` and localized `errorText` to amount/date TextFields. Put refs on
non-collapsible category/account group containers and set
`accessibilityRole="radiogroup"` plus a localized label/hint. React Native 0.83
does not type direct `aria-invalid`/`aria-describedby` on View, so associate
stable native IDs and pass those two attributes only through a narrowly typed
web-only spread. Render the existing `reviewAlertChooseCategory` /
`reviewAlertChooseAccount` text as a polite live error when invalid. A missing
account with no accounts still opens the existing Wallet creation route.

Keep `useKeyboardHeight()` out of Add Transaction after migration: the shared
`keyboardAware` scaffold now preserves that Android measured-bottom behavior.

- [ ] **Step 7: Make transaction rows large-text safe**

Remove `numberOfLines={1}` from merchant/category text where it can hide meaning. Keep exact full merchant/category/date in `accessibilityLabel`, amounts tabular, and amount aligned to logical end.

- [ ] **Step 8: Add stable E2E labels**

In `e2e-navigation.mjs`, add checks that Search, Clear All, Add Transaction, and Back can be hit through accessibility labels rather than matching incidental copy. Do not replace the existing `elementFromPoint` hit testing.

- [ ] **Step 9: Verify the family**

```bash
bash scripts/test/build.sh
node scripts/test/dashboard-projection.test.js
node scripts/test/ui-polish-contract.test.js
node scripts/test/routes.test.js
node scripts/test/accessibility-layout.test.js
npm run typecheck
npm run test:e2e
```

Expected: Home arithmetic and routes are unchanged; transaction filters and review promotion remain operational; no field is hidden by the keyboard.

- [ ] **Step 10: Commit if authorized**

```bash
git add src/screens/ledger-home-screen.tsx src/app/transactions.tsx src/app/add-transaction.tsx src/components/transaction-row.tsx scripts/test/dashboard-projection.test.js scripts/test/accessibility-layout.test.js scripts/test/ui-polish-contract.test.js scripts/e2e/e2e-navigation.mjs
git commit -m "feat: polish the iPhone ledger and transaction flow"
```

---

### Task 4: Polish Flow and keep Stats as the deeper route

**Files:**
- Modify: `src/constants/theme.ts`
- Create: `src/components/ui/data-viz.ts`
- Modify: `src/components/ui/charts.tsx`
- Modify: `src/app/(tabs)/flow.tsx`
- Modify: `src/app/stats.tsx`
- Modify: `src/lib/categories.ts`
- Modify: `scripts/test/accessibility-layout.test.js`
- Test: `scripts/test/cash-flow.test.js`
- Modify: `scripts/test/ui-polish-contract.test.js`

**Interfaces:**
- Consumes: existing `summarizeMonth`, `composition`, period context, limit `monthKey`, transaction drill-down URLs.
- Produces: one primary Flow chart with semantic data-viz tokens and textual summary; Stats remains `/stats` and contains only deeper analysis.

- [ ] **Step 1: Add the failing Flow/Stats contract**

Insert immediately before the final `console.log` in `ui-polish-contract.test.js`:

```js
assert.match(read('src/app/(tabs)/flow.tsx'), /<ScreenScaffold[\s\S]*tabbed/);
assert.match(read('src/app/stats.tsx'), /<ScreenScaffold[\s\S]*headerMode="native"/);
assert.ok(fs.existsSync(path.join(ROOT, 'src/components/ui/data-viz.ts')));
assert.doesNotMatch(read('src/lib/categories.ts'), /CATEGORY_RAMP|rampColor|onRampColor/);
```

Run the suite and expect failure on the new presentation/token assertions.

- [ ] **Step 2: Move chart literals into data-viz tokens**

Export from `theme.ts`:

```ts
export const DataViz = {
  light: {
    ramp: ['#1F6B52', '#3D8A72', '#63A791', '#8CBFAE', '#B2D4C7'],
    neutral: '#D9D3C6',
    axis: '#9B8C84',
    expenseSoft: '#DCC9C2',
  },
  dark: {
    ramp: ['#57B894', '#48A07F', '#3B826A', '#2F6754', '#264F41'],
    neutral: '#2A2620',
    axis: '#8A7E76',
    expenseSoft: '#4A3A34',
  },
} as const;
```

Replace matching literals in `charts.tsx` and Flow; do not alter chart values or category membership.

Create `src/components/ui/data-viz.ts` as the only category-ramp selector:

```ts
import { DataViz } from '@/constants/theme';

export const rampColor = (index: number, dark: boolean): string => {
  const ramp = DataViz[dark ? 'dark' : 'light'].ramp;
  return ramp[Math.min(index, ramp.length - 1)];
};
```

Move `CATEGORY_RAMP`, `rampColor`, and the unused presentation-only
`onRampColor` out of `src/lib/categories.ts`. Import `rampColor` from
`ui/data-viz` in Flow and import the named DataViz values in `charts.tsx`.
Category IDs, labels, glyphs, type, and fixed-commitment logic remain in
`categories.ts` unchanged.

- [ ] **Step 3: Migrate Flow's shell**

Use `ScreenScaffold tabbed headerMode="inline"`. Put PeriodPill and the `/stats`
action in the inline header. Adopt the approved hierarchy without changing any
figure: comparison rail, six-month primary chart, always-visible selected-month
written summary, category composition/drivers, category limits, then the
existing deeper insight cards. This intentionally moves limits below the chart
and composition drivers; it is a presentation-order change, not a calculation
change.

- [ ] **Step 4: Preserve chart text equivalents**

For every selected month/category mark, retain or add an adjacent `ThemedText`
summary using the existing formatted values. Give the composition bar
`accessibilityRole="image"` and a localized label assembled from existing
`compositionPercent` strings. Each trend month exposes the existing
`monthCashflowA11y`/no-data sentence and
`accessibilityState={{ selected: current }}`; render the selected month's same
sentence visibly below the primary chart even when compact bar values fit.
Keep the large-text all-month detail fallback. Do not animate virtualized rows
or replay tab entrances.

- [ ] **Step 5: Migrate Stats without duplicating Flow**

Use `ScreenScaffold headerMode="native"` with a supplied route-owned back
callback. Keep PeriodPill as the first in-content control. Keep `/stats`,
merchant/category drill-downs, `/wallet`, and `/flow`. Remove only summaries
that duplicate the exact Flow headline; preserve deeper breakdowns, the “Also
worth a look” index, and all selectors.

- [ ] **Step 6: Verify Flow calculations and layout**

```bash
bash scripts/test/build.sh
node scripts/test/cash-flow.test.js
node scripts/test/routes.test.js
node scripts/test/accessibility-layout.test.js
node scripts/test/ui-polish-contract.test.js
npm run typecheck
npm run test:e2e
```

Expected: every figure and drill-down agrees with the pre-migration fixture; English/Arabic large-text summaries remain readable.

- [ ] **Step 7: Commit if authorized**

```bash
git add src/constants/theme.ts src/components/ui/data-viz.ts src/components/ui/charts.tsx src/app/'(tabs)'/flow.tsx src/app/stats.tsx src/lib/categories.ts scripts/test/accessibility-layout.test.js scripts/test/ui-polish-contract.test.js
git commit -m "feat: refine Flow and deeper analysis"
```

---

### Task 5: Polish Bills while preserving all three groups

**Files:**
- Modify: `src/app/(tabs)/bills.tsx`
- Modify: `src/components/bills/bills-segment-control.tsx`
- Modify: `scripts/test/bills.test.js`
- Modify: `scripts/test/accessibility-layout.test.js`
- Modify: `scripts/test/ui-polish-contract.test.js`

**Interfaces:**
- Consumes: exact existing `Segment`, `subs`, dues, utilities/repeat/reminder arrays, bill/card commands.
- Produces: shared shell, labeled segment group, consistent rows/detail footers, shared fields for reminder entry.

- [ ] **Step 1: Pin the group membership before editing UI**

Add these source-contract assertions to the existing `bills.test.js` source
block, alongside its current `billFromSubscription` checks:

```js
ok('Bills keeps the three release groups',
  /type Segment = 'subscriptions' \| 'cards' \| 'utilities'/.test(src));
ok('Subscriptions still come from true active detected subscriptions',
  /detectSubscriptions\(/.test(src) &&
    /activeSubscriptions\(trueSubscriptions\(detected\)\)/.test(src));
ok('Cards still use open and recently settled dues',
  /openDues\(state, now\)/.test(src) && /recentlySettledDues\(state, now\)/.test(src));
ok('Utilities retains reminders, loans, fixed commitments, and other repeats',
  /billsForMonth\(/.test(src) && /const loans =/.test(src) &&
    /const commitments =/.test(src) && /const otherRepeats =/.test(src));
```

Keep the current behavioral `billsForMonth` fixtures and their live-account,
internal-transfer, paid, upcoming, and cadence totals unchanged; those are the
domain proof behind the screen seams. Run:

```bash
bash scripts/test/build.sh && node scripts/test/bills.test.js
```

Expected: pass before UI changes.

- [ ] **Step 2: Add the failing Bills presentation contract**

Insert immediately before the final `console.log` in `ui-polish-contract.test.js`:

```js
assert.match(read('src/app/(tabs)/bills.tsx'), /<ScreenScaffold[\s\S]*tabbed/);
assert.match(read('src/components/bills/bills-segment-control.tsx'), /<SegmentedControl/);
```

Run the suite and expect failure on both new assertions.

- [ ] **Step 3: Adapt the three-option segment control**

Keep `type Segment = 'subscriptions' | 'cards' | 'utilities'`. In `BillsSegmentControl`, use canonical `SegmentedControl` for default text sizes with localized labels/counts. Preserve its existing vertical large-text fallback, but give the group `accessibilityLabel={t('billsTitle')}` and every option selected state.
The vertical fallback keeps a 44-point iOS minimum and a 48dp Android minimum.

Remove the old `theme` prop and local `ScreenPadding` margin; the canonical
control/fallback read theme internally and the scaffold owns page padding.
Place the segment inside the scaffold's single ScrollView so Bills does not
introduce a second/nested screen scroller. Preserve the exact count-bearing
labels used by navigation tests.

- [ ] **Step 4: Migrate the shell and row hierarchy**

Use `ScreenScaffold tabbed headerMode="inline"`. Keep the three group panels mutually exclusive. Standardize row order as name/state, amount, date/cadence, account when known. Keep all selector and action closures in Bills.

The typed inline header owns title, subtitle, and New Reminder. Preserve all
Task 2 ID-backed due/reminder state, conditional detail sheets, and
close-before-confirmation footer actions. Do not infer subscription accounts
in rows; existing transaction evidence remains in the detail sheet.

- [ ] **Step 5: Migrate reminder fields**

Replace reminder name/amount/date direct inputs with `TextField`. Move Add/Save/Delete actions into the BottomSheet footer. Keep `addBill`, `deleteBill`, `markBillPaid`, `billFromSubscription`, and confirmation objects unchanged.

Use numeric TextFields for amount/day and the ledger currency as amount leading
content. Interpret the action sentence as: New Reminder remains the header
action, Save moves to the adder footer, and Delete remains in the manual-detail
footer established by Task 2. Preserve `draftValid`, `saveBill()`, the
large-text stacked input layout, and the bounded subscription-history scroller.

- [ ] **Step 6: Verify the family**

```bash
bash scripts/test/build.sh
node scripts/test/bills.test.js
node scripts/test/ui-polish-contract.test.js
node scripts/test/accessibility-layout.test.js
node scripts/test/routes.test.js
npm run typecheck
npm run test:e2e
```

Expected: memberships/counts/totals are identical, no nested press target remains, and every task is available without long press.

- [ ] **Step 7: Commit if authorized**

```bash
git add src/app/'(tabs)'/bills.tsx src/components/bills/bills-segment-control.tsx scripts/test/bills.test.js scripts/test/accessibility-layout.test.js scripts/test/ui-polish-contract.test.js
git commit -m "feat: polish Bills without changing its groups"
```

---

### Task 6: Polish Wallet and Cards, then converge LimitSheet

**Files:**
- Modify: `src/app/(tabs)/wallet.tsx`
- Modify: `src/components/wallet/balance-overview.tsx`
- Modify: `src/app/cards.tsx`
- Modify: `src/components/card-detail-sheet.tsx`
- Modify: `src/components/limit-sheet.tsx`
- Modify: `scripts/test/contracts.test.js`
- Modify: `scripts/test/accessibility-layout.test.js`
- Modify: `scripts/test/ui-polish-contract.test.js`

**Interfaces:**
- Consumes: `netWorthBreakdown`, `cardFigure`, `openDues`, `cardStatementView`, existing account/goal commands, shared BottomSheet/TextField.
- Produces: normal-tap account/card details, accessible expansion, statement-first hierarchy, and no second Modal implementation.

- [ ] **Step 1: Add the failing Wallet/Cards contract**

Insert immediately before the final `console.log` in `ui-polish-contract.test.js`:

```js
assert.match(read('src/app/(tabs)/wallet.tsx'), /<ScreenScaffold[\s\S]*tabbed/);
assert.match(read('src/app/cards.tsx'), /<ScreenScaffold/);
```

Run the suite and expect failure on both new assertions.

- [ ] **Step 2: Migrate Wallet and Cards shells**

Use `ScreenScaffold tabbed headerMode="inline"` for Wallet with typed Settings
and New Account actions. Use `ScreenScaffold headerMode="native"` for Cards
with a route-owned Back action. Keep BalanceOverview private, but remove its
single-line shrink-to-fit amount ceiling so the existing large-text wrapper can
reflow. CardDetail keeps `cardStatementView` as its sole calculation source:
show outstanding/open statements first, their real per-statement due dates,
then card metadata/payment history; do not invent one due date when several
statements are open. Preserve `/cards?card=` direct opening and all Task 2
detail-footer management.

- [ ] **Step 3: Make collapsed groups explicit**

Every disclosure control gets a localized accessibility label/action plus
`accessibilityState={{ expanded }}`. This includes Wallet Show More/Fewer and
inactive sources plus Cards inactive cards. Cards may use a trailing
44-point/48dp Pressable in the shared SectionHeader. Remove the “long press”
instruction as the only discovery path; retain long press only as an optional
shortcut. Let card identity text wrap at large text sizes while keeping figures
at logical end.

- [ ] **Step 4: Write the failing sheet-convergence assertion**

In `contracts.test.js`, add:

```js
const limitSheet = read('src/components/limit-sheet.tsx');
ok('the limit editor uses the shared sheet and field contracts',
  /<BottomSheet/.test(limitSheet) && /<TextField/.test(limitSheet) &&
    !/<Modal/.test(limitSheet) && !/useKeyboardHeight/.test(limitSheet));
```

Run `node scripts/test/contracts.test.js`; expect failure.

- [ ] **Step 5: Replace only LimitSheet's presentation shell**

Keep all calculations from `liveAccounts` through `suggestions`, `available`, `save`, and `roundToHundred` unchanged. Replace its Modal/backdrop/header/ScrollView/actions with:

```tsx
const removeExisting = () => {
  if (!existing) return;
  deleteBudget(existing.category);
  onClose();
};

<BottomSheet
  visible={open}
  onClose={onClose}
  title={picked ? tf('categoryLimit', { category: categoryLabel(getCategory(picked)) }) : t('newLimitTitle')}
  footer={(
    <View style={styles.actions}>
      {existing ? <Button label={t('remove')} variant="danger" onPress={removeExisting} /> : null}
      <Button label={t('saveLimit')} disabled={!picked || !limitFils} onPress={save} />
    </View>
  )}>
  {/* Keep the current category picker, current-limit summary, suggestions,
      merchant rows, and their exact calculations in this order. */}
</BottomSheet>
```

The comment marks a move, not omitted new behavior: take the current JSX blocks
in order—`!category` picker, `picked && limitFils` current summary,
`amountBlock`, `picked` suggestions, and `merchants.length` breakdown—and place
those exact blocks between the BottomSheet tags. Replace only the amount
`TextInput` with numeric `TextField`. Delete Modal, backdrop, keyboard-height,
elevation, and duplicate close styles/imports.

Use inline shared Buttons in the footer. Preserve the opening reseed effect,
all live/internal exclusions, three-month average, merchant
rounding/remainder pooling, day/period logic, suggestion de-duplication,
available-category rule, `save()`, and delete behavior. Keep the five content
blocks in the exact order listed above and add a positional source assertion.

- [ ] **Step 6: Verify card and limit semantics**

```bash
node scripts/test/contracts.test.js
node scripts/test/ui-polish-contract.test.js
node scripts/test/accessibility-layout.test.js
bash scripts/test/build.sh && node scripts/test/bills.test.js
npm run typecheck
npm run test:e2e
```

Expected: `cardStatementView` remains the only detail calculation; limit averages/internal-transfer exclusions/totals remain unchanged; only shared BottomSheet contains Modal outside platform/native route code.

- [ ] **Step 7: Commit if authorized**

```bash
git add src/app/'(tabs)'/wallet.tsx src/components/wallet/balance-overview.tsx src/app/cards.tsx src/components/card-detail-sheet.tsx src/components/limit-sheet.tsx scripts/test/contracts.test.js scripts/test/accessibility-layout.test.js scripts/test/ui-polish-contract.test.js
git commit -m "feat: refine Wallet cards and limit editing"
```

---

### Task 7: Reorder Settings and polish Pro without changing handlers

**Files:**
- Modify: `src/app/settings.tsx`
- Review only: `src/components/settings/status-facts.tsx`
- Modify: `src/app/pro.tsx`
- Create: `src/lib/public-links.ts`
- Modify: `src/lib/i18n.ts`
- Modify: `scripts/test/routes.test.js`
- Modify: `scripts/test/founder-pro.test.js`
- Modify: `scripts/test/ui-polish-contract.test.js`

**Interfaces:**
- Consumes: every existing Settings closure/platform gate; RevenueCat purchase/restore/price state.
- Produces: stable group order and concise values; storefront-correct Pro hierarchy and accessible status announcements.

- [ ] **Step 1: Pin the Settings inventory**

Add a source assertion in `routes.test.js` requiring the current Pro summary, notification toggles, capture/history recovery, privacy, exports, review alerts, categorise, accuracy, appearance, country/language, feedback/support, founder gate, and erase action to remain present.

- [ ] **Step 2: Add the failing Settings/Pro presentation contract**

Insert immediately before the final `console.log` in `ui-polish-contract.test.js`:

```js
const settingsUi = read('src/app/settings.tsx');
assert.match(settingsUi, /<ScreenScaffold/);
for (const key of [
  'settingsMoneyHeader', 'settingsImportsHeader', 'settingsNotificationsHeader',
  'settingsAppearanceLanguageHeader', 'settingsDangerHeader', 'supportWebsite',
  'publicLinkUnavailable',
]) assert.ok(settingsUi.includes(key), `Settings missing ${key}`);
assert.match(read('src/app/pro.tsx'), /<ScreenScaffold/);
assert.ok(fs.existsSync(path.join(ROOT, 'src/lib/public-links.ts')));
```

Run the suite and expect failure on the new shell/group/public-link assertions.

- [ ] **Step 3: Move existing rows without rewriting callbacks**

Add these exact bilingual section keys to `src/lib/i18n.ts`:

```ts
settingsMoneyHeader: { en: 'Money', ar: 'المال' },
settingsImportsHeader: { en: 'Imports', ar: 'الاستيراد' },
settingsNotificationsHeader: { en: 'Notifications', ar: 'الإشعارات' },
settingsAppearanceLanguageHeader: { en: 'Appearance & language', ar: 'المظهر واللغة' },
settingsDangerHeader: { en: 'Danger zone', ar: 'منطقة الخطر' },
supportWebsite: { en: 'Support', ar: 'الدعم' },
publicLinkUnavailable: { en: 'Unavailable in this build', ar: 'غير متاح في هذا الإصدار' },
```

Order the rendered sections exactly:

1. Pro/subscription status summary;
2. Money;
3. Imports;
4. Notifications;
5. Appearance & language;
6. Privacy;
7. Data;
8. Support;
9. Danger zone.

Remove the rendered StatusFacts section: its daily-summary, capture, and
private-mode values duplicate real controls in the target groups and the
approved order has no Status group. Leave the reusable component file intact.

Move complete existing JSX row blocks with their handlers. Do not copy/paste handler bodies into new closures. Keep erase last and visually isolated.

Map the current rows exactly:

- **Money:** the parser-pack/market row and its displayed ledger currency;
- **Imports:** READ_SMS/local-capture toggle, history progress/retry, iPhone
  capture status/recovery, and bank-app notification import access;
- **Notifications:** daily digest and the platform's one per-charge alert row;
- **Appearance & language:** theme SegmentedControl and current language row;
- **Privacy:** Private Mode, App Lock, retention, and security disclosures;
- **Data:** Review Alerts, Sort Shops, Improve Accuracy, backup/restore, CSV,
  expense PDF, and gated internal launch export;
- **Support:** Feedback, Privacy Policy, Terms of Use, Support, and version/build;
- **Danger zone:** Erase All only.

The country/parser-pack choice sheet remains reachable from Money. Founder
unlock remains attached only to the bottom brand mark and is not promoted into
a normal setting.

Extract Pro's current HTTPS-only `configuredUrl()` into
`src/lib/public-links.ts` as:

```ts
import Constants from 'expo-constants';

export type PublicLinkKey = 'privacyPolicyUrl' | 'termsOfUseUrl' | 'supportUrl';
export const configuredPublicUrl = (key: PublicLinkKey): string | null => {
  const extra = Constants.expoConfig?.extra as Record<string, unknown> | undefined;
  const value = extra?.[key];
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
};
```

Use it from Pro and Settings. Always render Privacy Policy, Terms of Use, and
Support in Settings, and always render Privacy Policy/Terms in Pro. When a URL
is valid HTTPS, the row is pressable and uses the shared open/failure handler.
When absent, render a non-pressable `Row` with
`publicLinkUnavailable`, no chevron, and an alert icon; do not hide it or make
it a dead target. Missing configuration remains a release-readiness failure.

Share URL lookup only. Keep one screen-local async opener per screen so each
can use its existing inline failure presentation; do not introduce Alert-based
web failure handling. The blank app-config values remain blank and must render
the nonpressable unavailable rows.

- [ ] **Step 4: Migrate Settings/Pro shells**

Use `ScreenScaffold headerMode="native"` on both routes with route-owned Back.
Use canonical SectionHeader and SegmentedControl. Settings sheets remain
siblings outside the scaffold; Pro passes its existing fixed purchase region
as scaffold footer. Preserve link-row versus switch-row accessibility: a row
containing a switch stays a non-accessible wrapper so it does not swallow
switch state.

- [ ] **Step 5: Polish the Pro state machine presentation**

Keep `loadStorePrices`, `storePrices[candidate].priceString`, `purchasePro`,
`restorePro`, manage URL, legal readiness, founder behavior, and unavailable
side-load behavior. Present one selected plan and one purchase action. Keep
Restore, Manage/Cancel, Privacy, and Terms visible in their existing applicable
states—do not invent management for founder/web or completion states. Render
completion/failure through the existing polite live region; do not use ledger
money formatting.

- [ ] **Step 6: Verify settings, founder, and purchase contracts**

```bash
node scripts/test/routes.test.js
node scripts/test/founder-pro.test.js
node scripts/test/ui-polish-contract.test.js
node scripts/test/accessibility-layout.test.js
npm run typecheck
npm run test:e2e
```

Expected: every pre-migration control exists once, destructive data erase remains last, and Pro uses store-localized pricing.

- [ ] **Step 7: Commit if authorized**

```bash
git add src/app/settings.tsx src/components/settings/status-facts.tsx src/app/pro.tsx src/lib/public-links.ts src/lib/i18n.ts scripts/test/routes.test.js scripts/test/founder-pro.test.js scripts/test/ui-polish-contract.test.js
git commit -m "feat: organize Settings and clarify Wafra Pro"
```

---

### Task 8: Migrate the remaining user-facing routes

**Files:**
- Modify: `src/app/accuracy.tsx`
- Modify: `src/app/categorise.tsx`
- Modify: `src/app/currency.tsx`
- Modify: `src/app/feedback.tsx`
- Modify: `src/app/review-alerts.tsx`
- Modify: `src/app/trusted-devices.tsx`
- Modify: `scripts/test/routes.test.js`
- Modify: `scripts/test/review-alerts-ui.test.js`
- Modify: `scripts/test/ui-polish-contract.test.js`

**Interfaces:**
- Consumes: existing domain actions/routes; ScreenScaffold/canonical controls.
- Produces: shell/field consistency across every production-reachable non-protected route.

- [ ] **Step 1: Add the failing remaining-route contract**

Insert immediately before the final `console.log` in `ui-polish-contract.test.js`:

```js
for (const route of [
  'accuracy', 'categorise', 'currency', 'feedback', 'review-alerts', 'trusted-devices',
]) {
  assert.match(read(`src/app/${route}.tsx`), /<ScreenScaffold/, `${route} lacks ScreenScaffold`);
}
```

Run the suite and expect failure for every unmigrated route.

- [ ] **Step 2: Migrate Accuracy**

Use `ScreenScaffold headerMode="native"` with route-owned Back; preserve masked
sharing, unread-only external evidence, `/categorise`, and card diagnostic
sharing. Do not change scrub/report builders.

- [ ] **Step 3: Migrate Categorise**

Use `ScreenScaffold headerMode="native"`; preserve one-expanded-merchant
behavior, `setMerchantOverride(merchant, category, true)`, automatic next-item
advance, and displayed counts.

- [ ] **Step 4: Migrate Currency**

Use `ScreenScaffold headerMode="native"`; keep PeriodPill first in content.
Preserve the existing foreign-activity predicate, formatter, period picker,
query/filter behavior, and entry detail sheet. Replace only the search input
with labeled TextField plus search/clear actions.

- [ ] **Step 5: Migrate Feedback**

Use `ScreenScaffold keyboardAware headerMode="native"` and replace only the
multiline message input with TextField. Preserve scrub/build/preview/send,
length/sending state, and drawn confirmation. Keep parser-research gating
unchanged.

- [ ] **Step 6: Migrate Review Alerts**

Use `ScreenScaffold scroll={false} virtualized headerMode="native"` and apply
`useScreenContentInsets()` directly to the existing FlatList. Preserve expiry
filtering, minor-unit display, explicit dismissal confirmation, and the typed
`/add-transaction?reviewId=` correction route.

- [ ] **Step 7: Migrate Trusted Devices and pin Parser Research gating**

Migrate `trusted-devices.tsx` to `ScreenScaffold headerMode="native"` because Settings' last-owner
erase recovery can route there in production. Preserve trusted-device crypto,
invite, removal, and recovery commands unchanged.

Do not migrate Trusted Devices' internal sheet inputs in this task; they span
security-sensitive state machines and already inherit BottomSheet keyboard
handling. Migrate Currency search and Feedback message only.

Keep `parser-research.tsx` behind the existing `isParserResearchBuild()` gate
in Feedback. Add source assertions in `routes.test.js` for both facts: the
trusted recovery push remains production-reachable and Parser Research remains
test/internal-build gated. Do not migrate or expose Parser Research as a normal
release route.

- [ ] **Step 8: Verify all routes**

```bash
node scripts/test/routes.test.js
node scripts/test/review-alerts-ui.test.js
node scripts/test/ui-polish-contract.test.js
npm run typecheck
npm run test:e2e
```

Expected: every production-reachable route uses the scaffold and retains the same command/deep-link behavior.

- [ ] **Step 9: Commit if authorized**

```bash
git add src/app/accuracy.tsx src/app/categorise.tsx src/app/currency.tsx src/app/feedback.tsx src/app/review-alerts.tsx src/app/trusted-devices.tsx scripts/test/routes.test.js scripts/test/review-alerts-ui.test.js scripts/test/ui-polish-contract.test.js
git commit -m "feat: complete the iPhone screen-shell migration"
```

---

### Task 9: Verify the core-screen handoff

**Files:**
- Review only: all files changed by Tasks 1–8

**Interfaces:**
- Consumes: completed foundation and core-screen migrations.
- Produces: reviewed input for setup/import polish and optional native navigation; no release upload.

- [ ] **Step 1: Inspect complete scoped diffs**

```bash
git diff --check -- \
  src/screens/ledger-home-screen.tsx \
  'src/app/(tabs)/flow.tsx' 'src/app/(tabs)/bills.tsx' 'src/app/(tabs)/wallet.tsx' \
  src/app/transactions.tsx src/app/add-transaction.tsx src/app/stats.tsx src/app/cards.tsx \
  src/app/settings.tsx src/app/pro.tsx src/app/accuracy.tsx src/app/categorise.tsx \
  src/app/currency.tsx src/app/feedback.tsx src/app/review-alerts.tsx src/app/trusted-devices.tsx \
  src/components/transaction-row.tsx src/components/ui/charts.tsx src/components/ui/data-viz.ts \
  src/components/bills/bills-segment-control.tsx src/components/wallet/balance-overview.tsx \
  src/components/card-detail-sheet.tsx src/components/limit-sheet.tsx \
  src/components/settings/status-facts.tsx src/constants/theme.ts src/lib/categories.ts \
  src/lib/public-links.ts src/lib/i18n.ts scripts/test/ui-polish-contract.test.js \
  scripts/test/run.sh scripts/test/routes.test.js scripts/test/accessibility-layout.test.js \
  scripts/test/dashboard-projection.test.js scripts/test/bills.test.js scripts/test/contracts.test.js \
  scripts/test/founder-pro.test.js scripts/test/review-alerts-ui.test.js scripts/e2e/e2e-navigation.mjs
git diff --stat -- \
  src/screens/ledger-home-screen.tsx \
  'src/app/(tabs)/flow.tsx' 'src/app/(tabs)/bills.tsx' 'src/app/(tabs)/wallet.tsx' \
  src/app/transactions.tsx src/app/add-transaction.tsx src/app/stats.tsx src/app/cards.tsx \
  src/app/settings.tsx src/app/pro.tsx src/app/accuracy.tsx src/app/categorise.tsx \
  src/app/currency.tsx src/app/feedback.tsx src/app/review-alerts.tsx src/app/trusted-devices.tsx \
  src/components/transaction-row.tsx src/components/ui/charts.tsx src/components/ui/data-viz.ts \
  src/components/bills/bills-segment-control.tsx src/components/wallet/balance-overview.tsx \
  src/components/card-detail-sheet.tsx src/components/limit-sheet.tsx \
  src/components/settings/status-facts.tsx src/constants/theme.ts src/lib/categories.ts \
  src/lib/public-links.ts src/lib/i18n.ts scripts/test/ui-polish-contract.test.js \
  scripts/test/run.sh scripts/test/routes.test.js scripts/test/accessibility-layout.test.js \
  scripts/test/dashboard-projection.test.js scripts/test/bills.test.js scripts/test/contracts.test.js \
  scripts/test/founder-pro.test.js scripts/test/review-alerts-ui.test.js scripts/e2e/e2e-navigation.mjs
```

Verify the diff contains presentation changes only and no parser/card/billing/native-history module edits.

- [ ] **Step 2: Run focused domain and presentation suites**

```bash
bash scripts/test/build.sh
node scripts/test/dashboard-projection.test.js
node scripts/test/cash-flow.test.js
node scripts/test/bills.test.js
node scripts/test/contracts.test.js
node scripts/test/routes.test.js
node scripts/test/review-alerts-ui.test.js
node scripts/test/accessibility-layout.test.js
node scripts/test/ui-foundation-contract.test.js
node scripts/test/ui-polish-contract.test.js
node scripts/test/perf-config.test.js
npm run typecheck
npm run lint
```

Expected: every command exits 0.

- [ ] **Step 3: Run repository and browser gates**

```bash
npm test
npm run test:e2e
```

Expected: `run.sh` reports 67 app suites and Playwright completes all screens/interactions without clipping, overlap, dead controls, or unreachable sheets.

- [ ] **Step 4: Perform simulator visual review**

Capture Home, Flow, Bills, Wallet, Transactions, Settings, and Pro at 402×874 in English/Arabic, light/dark, default/large text. Compare hierarchy to Option C and Option E; this review is not physical Shortcuts or release evidence.

- [ ] **Step 5: Obtain independent read-only code review**

Require specific review of Home arithmetic inputs, Bills group preservation, Wallet/Card command boundaries, Pro storefront prices, nested targets, Dynamic Type, RTL, and Android/web fallbacks.

- [ ] **Step 6: Commit the verified handoff if authorized**

```bash
git add \
  src/screens/ledger-home-screen.tsx \
  'src/app/(tabs)/flow.tsx' 'src/app/(tabs)/bills.tsx' 'src/app/(tabs)/wallet.tsx' \
  src/app/transactions.tsx src/app/add-transaction.tsx src/app/stats.tsx src/app/cards.tsx \
  src/app/settings.tsx src/app/pro.tsx src/app/accuracy.tsx src/app/categorise.tsx \
  src/app/currency.tsx src/app/feedback.tsx src/app/review-alerts.tsx src/app/trusted-devices.tsx \
  src/components/transaction-row.tsx src/components/ui/charts.tsx src/components/ui/data-viz.ts \
  src/components/bills/bills-segment-control.tsx src/components/wallet/balance-overview.tsx \
  src/components/card-detail-sheet.tsx src/components/limit-sheet.tsx \
  src/components/settings/status-facts.tsx src/constants/theme.ts src/lib/categories.ts \
  src/lib/public-links.ts src/lib/i18n.ts scripts/test/ui-polish-contract.test.js \
  scripts/test/run.sh scripts/test/routes.test.js scripts/test/accessibility-layout.test.js \
  scripts/test/dashboard-projection.test.js scripts/test/bills.test.js scripts/test/contracts.test.js \
  scripts/test/founder-pro.test.js scripts/test/review-alerts-ui.test.js scripts/e2e/e2e-navigation.mjs
git commit -m "feat: polish Wafra core screens for iPhone release"
```

Before staging, inspect every listed path for pre-existing unrelated hunks. If a
listed shared path still mixes another task's uncommitted work, omit the commit
and request a clean ownership handoff rather than staging the whole file. Do not
include active setup/import files in this commit. Do not build or submit a
release candidate from this plan.
