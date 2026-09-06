# iPhone Native Navigation Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evaluate Expo Router SDK 55 native iOS tabs, stack headers, and one read-only system form sheet as a reversible polish layer without making release depend on beta navigation.

**Architecture:** iOS receives a platform-specific NativeTabs layout while Android and web keep the verified custom navigator. A navigation-chrome context makes safe-area ownership explicit, so native automatic insets never stack with custom tab clearance. Native headers migrate only ordinary pushed routes; protected setup/import routes retain inline guarded headers. One read-only card-detail route proves form-sheet behavior while the existing BottomSheet remains the transactional and cross-platform fallback.

**Tech Stack:** Expo SDK 55.0.30, Expo Router 55.0.18 NativeTabs beta, React Native Screens 4.23, React Native 0.83, Wafra UI foundation, Node navigation contracts, Playwright web E2E, signed iOS simulator/device review.

**Spec:** `docs/superpowers/specs/2026-09-04-ios-release-ui-polish-design.md`

## Global Constraints

- Complete foundation, core-screen, and setup/import plans first; this plan assumes 68 registered app suites.
- NativeTabs is beta in SDK 55. Its rejection must not block release. Tasks 1–5
  form one provisional navigation series; rejection reverts that entire series,
  including context/header/form-sheet/test changes, to the reviewed 68-suite
  custom-navigation baseline.
- Add no dependency and edit no parser, ledger, billing, encryption, Shortcut, history, or native-module code.
- Keep Android on `app-tabs-layout.tsx` unless it passes a separately documented acceptance run; keep web on `_layout.web.tsx` and the current E2E custom tab bar.
- Preserve the exact tab order and URLs: Home `/`, Flow `/flow`, Bills `/bills`, Wallet `/wallet`.
- `CaptureOwner` mounts exactly once outside either navigator.
- Do not guess native tab-bar height. Native mode relies on Router automatic insets; custom mode uses `useTabBarClearance()`.
- Preserve protected `/ios-setup` and `/import-sms?history=` inline headers, gesture policy, and async leave callbacks.
- A system-sheet route receives only string IDs/enums; no callback, React node, amount, transaction, account record, or protected source crosses route params.
- Do not add manual `GlassView`. Native tab/form-sheet chrome owns its material. NativeTabs/formSheet must remain usable when glass is unavailable or Reduce Transparency is enabled.
- Make the acceptance/rejection decision in one isolated commit. Do not intermingle screen hierarchy or state changes.
- Commit commands require separate user authorization.

---

### Task 1: Add the native-navigation contract gate

**Files:**
- Create: `scripts/test/ios-native-navigation.test.js`
- Modify: `scripts/test/run.sh`

**Interfaces:**
- Consumes: current route tree and final ScreenScaffold.
- Produces: suite `ios-native-navigation`; total app-suite count 69; green fallback baseline extended one optional layer at a time.

- [ ] **Step 1: Record a clean plan-owned navigation baseline**

Before any edit, run this exact scoped check:

```bash
NAV_BASE_SHA=$(git rev-parse HEAD)
NAV_OWNED_PATHS=(
  'src/app/(tabs)/_layout.tsx' 'src/app/(tabs)/_layout.ios.tsx' 'src/app/(tabs)/_layout.web.tsx'
  src/components/app-tabs-layout.tsx src/components/native-tabs-layout.tsx
  src/components/capture-owner.tsx src/components/ui/tab-chrome-context.tsx
  src/components/ui/screen-scaffold.tsx src/components/ui/screen-header.tsx
  src/hooks/use-tab-bar-clearance.ts src/components/app-root-layout.tsx
  src/app/accuracy.tsx src/app/cards.tsx src/app/categorise.tsx src/app/currency.tsx
  src/app/feedback.tsx src/app/pro.tsx src/app/review-alerts.tsx src/app/settings.tsx
  src/app/stats.tsx src/app/transactions.tsx src/app/ios-setup.tsx
  src/app/import-sms.tsx src/app/add-transaction.tsx src/app/card-detail.tsx
  src/components/card-detail-content.tsx src/components/card-detail-sheet.tsx
  scripts/test/ios-native-navigation.test.js scripts/test/routes.test.js
  scripts/test/accessibility-layout.test.js scripts/test/system-language.test.js
  scripts/test/perf-config.test.js scripts/test/run.sh
)
test -z "$(git status --short -- "${NAV_OWNED_PATHS[@]}")"
git diff --binary -- "${NAV_OWNED_PATHS[@]}" > /tmp/wafra-native-navigation-preexisting.patch
test ! -s /tmp/wafra-native-navigation-preexisting.patch
```

Record `NAV_BASE_SHA` and the exact array in the execution log. If any owned
path is dirty, stop and obtain a reviewed handoff; do not restore/stash it.
Unrelated dirty paths remain untouched.

- [ ] **Step 2: Create the green fallback contract test**

Create `scripts/test/ios-native-navigation.test.js`:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(ROOT, relative));

const classic = read('src/components/app-tabs-layout.tsx');
assert.match(classic, /function CaptureOwner/);
assert.match(classic, /<WafraTabBar/);

const androidLayout = read('src/app/(tabs)/_layout.tsx');
const webLayout = read('src/app/(tabs)/_layout.web.tsx');
assert.match(androidLayout, /app-tabs-layout/);
assert.match(webLayout, /app-tabs-layout/);

const rootLayout = read('src/components/app-root-layout.tsx');
assert.match(rootLayout, /name="\(tabs\)"/);
assert.match(rootLayout, /name="import-sms"/);
assert.match(rootLayout, /name="ios-setup"/);

const importScreen = read('src/app/import-sms.tsx');
assert.match(importScreen, /headerMode="inline"/);
assert.match(importScreen, /gestureEnabled: !validIosHistorySessionId\(history\)/);

console.log('✓ iOS navigation fallback baseline');
```

- [ ] **Step 3: Register the suite**

Change `EXPECTED_SUITES=68` to `EXPECTED_SUITES=69` and append:

```bash
SUITES+=(ios-native-navigation)
```

- [ ] **Step 4: Verify the registered baseline**

Run `node scripts/test/ios-native-navigation.test.js`.

Expected: pass. Each later task appends and satisfies its own optional
navigation assertion before the suite is committed green.

- [ ] **Step 5: Commit if authorized**

```bash
git add scripts/test/ios-native-navigation.test.js scripts/test/run.sh
git commit -m "test: define reversible iOS navigation gates"
```

---

### Task 2: Split CaptureOwner and tab-chrome inset ownership

**Files:**
- Create: `src/components/capture-owner.tsx`
- Create: `src/components/ui/tab-chrome-context.tsx`
- Modify: `src/components/app-tabs-layout.tsx`
- Modify: `src/components/ui/screen-scaffold.tsx`
- Modify: `src/hooks/use-tab-bar-clearance.ts`
- Modify: `scripts/test/accessibility-layout.test.js`
- Modify: `scripts/test/ios-native-navigation.test.js`

**Interfaces:**
- Consumes: `useHistoryImport()`, `useAutoImport(true, false)`, custom tab clearance.
- Produces: `CaptureOwner`; `TabChromeProvider({mode})`; `useTabChrome()`; native/custom inset branches.

- [ ] **Step 1: Add the failing ownership/inset contract**

Insert immediately before the final `console.log` in `ios-native-navigation.test.js`:

```js
assert.ok(exists('src/components/capture-owner.tsx'));
assert.ok(exists('src/components/ui/tab-chrome-context.tsx'));
const extractedClassic = read('src/components/app-tabs-layout.tsx');
assert.match(extractedClassic, /<CaptureOwner \/>/);
assert.equal((extractedClassic.match(/function CaptureOwner/g) ?? []).length, 0);
const chrome = read('src/components/ui/tab-chrome-context.tsx');
assert.match(chrome, /'custom' \| 'native'/);
const scaffold = read('src/components/ui/screen-scaffold.tsx');
assert.match(scaffold, /useTabChrome/);
assert.match(scaffold, /tabChrome === 'native'/);
```

Run the suite and expect failure on the missing extraction/context.

- [ ] **Step 2: Extract CaptureOwner without changing hook calls**

Create:

```tsx
import { useAutoImport } from '@/hooks/use-auto-import';
import { useHistoryImport } from '@/hooks/use-history-import';

export function CaptureOwner() {
  useHistoryImport();
  useAutoImport(true, false);
  return null;
}
```

Delete the local function from `app-tabs-layout.tsx`, import it, and render it once before `<Tabs>`.

- [ ] **Step 3: Add explicit chrome context**

Create `tab-chrome-context.tsx`:

```tsx
import { createContext, use } from 'react';

export type TabChrome = 'custom' | 'native';
const TabChromeContext = createContext<TabChrome>('custom');

export const TabChromeProvider = TabChromeContext.Provider;
export const useTabChrome = (): TabChrome => use(TabChromeContext);
```

Keep the foundation's measured-height provider and wrap the custom tree as:

```tsx
<TabChromeProvider value="custom">
  <TabBarMetricsProvider>
    <CaptureOwner />
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <WafraTabBar {...props} />}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="flow" />
      <Tabs.Screen name="bills" />
      <Tabs.Screen name="wallet" />
    </Tabs>
  </TabBarMetricsProvider>
</TabChromeProvider>
```

- [ ] **Step 4: Remove double-inset risk**

In `ScreenScaffold`/`useScreenContentInsets`, read `useTabChrome()`. Call
`useTabBarClearance()` unconditionally to preserve React's hook order, but when
`tabbed && tabChrome === 'native'`, ignore that custom value, use
`contentInsetAdjustmentBehavior="automatic"`, and add only `Spacing.three`
content breathing room. In custom mode, preserve the verified current clearance
calculation.

For a native-tab scroll screen, the scaffold's `ScrollView`/virtualized list is
the route's first native scroll child and the inline tab-root header renders
inside its content container. Do not place a wrapper/header sibling before the
scroll view, because NativeTabs' SDK 55 automatic inset discovery depends on
that scroll surface.

Do not change `TAB_BAR_HEIGHT` or guess a NativeTabs height.

- [ ] **Step 5: Add inset assertions**

Extend `accessibility-layout.test.js` so it requires the native branch to exclude custom clearance and the custom branch to retain it.

- [ ] **Step 6: Verify the extraction**

```bash
node scripts/test/ios-native-navigation.test.js
node scripts/test/accessibility-layout.test.js
node scripts/test/perf-config.test.js
npm run typecheck
```

Expected: CaptureOwner/inset assertions pass; NativeTabs/form-sheet assertions remain red.

- [ ] **Step 7: Commit if authorized**

```bash
git add src/components/capture-owner.tsx src/components/ui/tab-chrome-context.tsx src/components/app-tabs-layout.tsx src/components/ui/screen-scaffold.tsx src/hooks/use-tab-bar-clearance.ts scripts/test/accessibility-layout.test.js scripts/test/ios-native-navigation.test.js
git commit -m "refactor: make tab ownership explicit"
```

---

### Task 3: Add the iOS-only NativeTabs layout

**Files:**
- Create: `src/components/native-tabs-layout.tsx`
- Create: `src/app/(tabs)/_layout.ios.tsx`
- Keep: `src/app/(tabs)/_layout.tsx`
- Keep: `src/app/(tabs)/_layout.web.tsx`
- Modify: `scripts/test/system-language.test.js`
- Modify: `scripts/test/perf-config.test.js`
- Modify: `scripts/test/ios-native-navigation.test.js`

**Interfaces:**
- Consumes: `CaptureOwner`, `TabChromeProvider`, store language, Wafra theme.
- Produces: four static iOS NativeTabs triggers; Android/web custom fallback untouched.

- [ ] **Step 1: Add the failing iOS NativeTabs contract**

Insert immediately before the final `console.log` in `ios-native-navigation.test.js`:

```js
assert.ok(exists('src/app/(tabs)/_layout.ios.tsx'));
assert.ok(exists('src/components/native-tabs-layout.tsx'));
const nativeTabs = read('src/components/native-tabs-layout.tsx');
assert.match(nativeTabs, /expo-router\/unstable-native-tabs/);
assert.equal((nativeTabs.match(/<NativeTabs\.Trigger\b/g) ?? []).length, 4);
for (const name of ['index', 'flow', 'bills', 'wallet']) {
  assert.match(nativeTabs, new RegExp(`name="${name}"`));
}
assert.match(nativeTabs, /<CaptureOwner \/>/);
assert.match(read('src/app/(tabs)/_layout.ios.tsx'), /native-tabs-layout/);
assert.match(read('src/app/(tabs)/_layout.tsx'), /app-tabs-layout/);
assert.match(read('src/app/(tabs)/_layout.web.tsx'), /app-tabs-layout/);
```

Run the suite and expect failure on the missing iOS layout.

- [ ] **Step 2: Create the native layout**

Create:

```tsx
import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { CaptureOwner } from '@/components/capture-owner';
import { TabChromeProvider } from '@/components/ui/tab-chrome-context';
import { useTheme } from '@/hooks/use-theme';
import { t, type Lang } from '@/lib/i18n';
import { useStore } from '@/lib/store';

export default function NativeTabsLayout() {
  const theme = useTheme();
  const { state } = useStore();
  const language: Lang = state.language === 'ar' ? 'ar' : 'en';
  return (
    <TabChromeProvider value="native">
      <CaptureOwner />
      <NativeTabs tintColor={theme.primary} backgroundColor={theme.backgroundElement}>
        <NativeTabs.Trigger name="index">
          <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
          <NativeTabs.Trigger.Label>{t('tabHome', language)}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="flow">
          <NativeTabs.Trigger.Icon sf="chart.bar.xaxis" md="bar_chart" />
          <NativeTabs.Trigger.Label>{t('tabFlow', language)}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="bills">
          <NativeTabs.Trigger.Icon sf="repeat" md="autorenew" />
          <NativeTabs.Trigger.Label>{t('tabBills', language)}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="wallet">
          <NativeTabs.Trigger.Icon sf="wallet.pass" md="account_balance_wallet" />
          <NativeTabs.Trigger.Label>{t('tabWallet', language)}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>
    </TabChromeProvider>
  );
}
```

- [ ] **Step 3: Add the platform split**

Create `src/app/(tabs)/_layout.ios.tsx`:

```ts
export { default } from '@/components/native-tabs-layout';
```

Leave generic `_layout.tsx` exporting `app-tabs-layout` for Android. Leave `_layout.web.tsx` unchanged so the E2E demo keeps the custom web tab list.

- [ ] **Step 4: Pin language and motion behavior**

Extend `system-language.test.js` to require NativeTabs labels to call `t(key, language)` from store-observed language. Extend `perf-config.test.js` to reject `entering`, `exiting`, and `layout` animations in `native-tabs-layout.tsx`.

- [ ] **Step 5: Verify source and fallback layouts**

```bash
node scripts/test/ios-native-navigation.test.js
node scripts/test/system-language.test.js
node scripts/test/perf-config.test.js
npm run typecheck
npm run test:e2e
```

Expected: NativeTabs gates pass; web E2E still sees the custom tablist.

- [ ] **Step 6: Commit the provisional beta evaluation if authorized**

```bash
git add src/components/native-tabs-layout.tsx src/app/'(tabs)'/_layout.ios.tsx scripts/test/system-language.test.js scripts/test/perf-config.test.js scripts/test/ios-native-navigation.test.js
git commit -m "feat: evaluate native iOS tabs"
```

This commit remains provisional until Task 6 accepts or rejects the complete
navigation series.

---

### Task 4: Migrate ordinary pushed routes to native headers

**Files:**
- Modify: `src/components/app-root-layout.tsx`
- Modify: `src/components/ui/screen-header.tsx`
- Modify: `src/app/accuracy.tsx`
- Modify: `src/app/cards.tsx`
- Modify: `src/app/categorise.tsx`
- Modify: `src/app/currency.tsx`
- Modify: `src/app/feedback.tsx`
- Modify: `src/app/pro.tsx`
- Modify: `src/app/review-alerts.tsx`
- Modify: `src/app/settings.tsx`
- Modify: `src/app/stats.tsx`
- Modify: `src/app/transactions.tsx`
- Modify: `scripts/test/ios-native-navigation.test.js`

**Interfaces:**
- Consumes: final ScreenHeader native facade and each screen's existing back/actions.
- Produces: native stack titles/back gestures for ordinary routes; protected routes explicitly remain inline.

- [ ] **Step 1: Add the failing native-header contract**

Insert immediately before the final `console.log` in `ios-native-navigation.test.js`:

```js
for (const route of [
  'accuracy', 'cards', 'categorise', 'currency', 'feedback', 'pro',
  'review-alerts', 'settings', 'stats', 'transactions',
]) assert.match(read(`src/app/${route}.tsx`), /headerMode="native"/, `${route} is not native-header mode`);
assert.match(read('src/app/ios-setup.tsx'), /headerMode="inline"/);
assert.match(read('src/app/import-sms.tsx'), /headerMode="inline"/);
assert.match(read('src/app/add-transaction.tsx'), /headerMode="inline"/);
```

Run the suite and expect ordinary-route failures while protected inline checks
remain green.

- [ ] **Step 2: Pilot Stats**

Set Stats' scaffold header mode to native and supply title `t('statsTitle')`. The facade configures `Stack.Screen` with `headerShown: true`, native title, minimal back display, and no custom animation. Keep the current content/period/actions inside the screen.

Verify push, interactive back, Arabic title, large text, and Reduce Motion before migrating another route.

- [ ] **Step 3: Migrate remaining ordinary routes one at a time**

Use this exact title/action map, running the focused navigation test after each
file:

| Route | Title key | Header action |
| --- | --- | --- |
| Accuracy | `improveAccuracy` | none; masked share stays in content |
| Cards | `cardsTitle` | none; Set Limit stays in content |
| Categorise | `categoriseMerchants` | none |
| Currency | `foreignSpending` | none; Period stays in content |
| Feedback | `sendFeedback` | none |
| Pro | `wafraPro` | none |
| Review Alerts | `reviewAlertsTitle` | none |
| Settings | `settingsTitle` | none |
| Stats | `statsTitle` | none |
| Transactions | `transactionsTitle` | Add Transaction (`plus`, `addCashEntry`) |

Apply `headerMode="native"`, remove only the inline header JSX, and leave each
screen's content/selectors/actions unchanged. Keep at most two route-owned
actions through the facade. Use the system back action unless a screen already
has a guarded callback.

- [ ] **Step 4: Keep task/protected routes inline**

Explicitly preserve inline header mode for iOS Setup, protected Import, and Add Transaction modal. Their cancel/back callbacks and gesture policies remain screen-owned.

- [ ] **Step 5: Stop globally hiding every header**

In `app-root-layout.tsx`, keep a default hidden header for routes not migrated, but let per-screen facade options override it. Do not set `headerShown: true` globally and do not remove existing presentations/route names.

- [ ] **Step 6: Verify headers and protection**

```bash
node scripts/test/ios-native-navigation.test.js
node scripts/test/routes.test.js
node scripts/test/system-language.test.js
node scripts/test/ios-setup-ux.test.js
npm run typecheck
npm run test:e2e
```

Expected: ordinary routes use native titles/back; protected routes retain inline guarded exits; all deep links remain.

- [ ] **Step 7: Commit if authorized**

```bash
git add src/components/app-root-layout.tsx src/components/ui/screen-header.tsx src/app/accuracy.tsx src/app/cards.tsx src/app/categorise.tsx src/app/currency.tsx src/app/feedback.tsx src/app/pro.tsx src/app/review-alerts.tsx src/app/settings.tsx src/app/stats.tsx src/app/transactions.tsx scripts/test/ios-native-navigation.test.js
git commit -m "feat: use native iPhone stack headers"
```

---

### Task 5: Pilot a read-only card-detail form sheet

**Files:**
- Create: `src/components/card-detail-content.tsx`
- Create: `src/app/card-detail.tsx`
- Modify: `src/components/card-detail-sheet.tsx`
- Modify: `src/components/app-root-layout.tsx`
- Modify: `src/app/cards.tsx`
- Modify: `scripts/test/ios-native-navigation.test.js`
- Modify: `scripts/test/routes.test.js`

**Interfaces:**
- Consumes: `accountId` string, `cardStatementView(state, accountId)`, existing CardDetailSheet fallback.
- Produces: native iOS read-only form sheet; Android/web and Bills transactional footer continue using BottomSheet.

- [ ] **Step 1: Add the failing system-sheet contract**

Insert immediately before the final `console.log` in `ios-native-navigation.test.js`:

```js
const sheetRoot = read('src/components/app-root-layout.tsx');
assert.match(sheetRoot, /name="card-detail"/);
assert.match(sheetRoot, /Platform\.OS === 'ios' \? 'formSheet' : 'card'/);
assert.match(sheetRoot, /sheetAllowedDetents: \[0\.5, 1\]/);
const cardRoute = read('src/app/card-detail.tsx');
assert.match(cardRoute, /useLocalSearchParams<\{ accountId\?: string \}>/);
assert.match(cardRoute, /Platform\.OS !== 'ios'/);
assert.match(cardRoute, /<Redirect/);
assert.doesNotMatch(cardRoute, /JSON\.parse|amountFils|onPress:/);
```

Run the suite and expect failure because route/content files do not exist.

In this same red step, add `/card-detail` to `routes.test.js` and require every
new caller to pass exactly the string `accountId` parameter. Do not add this
route requirement in Tasks 1–4.

- [ ] **Step 2: Extract pure card-detail content**

Move the current head, outstanding summary, statements, and payment-history JSX from `CardDetailSheet` into:

```ts
type CardDetailContentProps = {
  account: Account;
  data: NonNullable<ReturnType<typeof cardStatementView>>;
};
```

The content component performs no navigation and calls no store command. `CardDetailSheet` keeps resolving `cardStatementView` and renders the content inside BottomSheet with its optional footer.

- [ ] **Step 3: Create the string-param route**

Create `card-detail.tsx` that reads:

```ts
const { accountId } = useLocalSearchParams<{ accountId?: string }>();
const account = state.accounts.find((candidate) => candidate.id === accountId);
const data = account ? cardStatementView(state, account.id) : null;
```

Render a scrollable `CardDetailContent` when both exist. Otherwise render a localized unavailable state and one Close action. Do not parse JSON or accept a numeric amount/callback.

Before resolving native content, handle a direct non-iOS link explicitly:

```tsx
if (Platform.OS !== 'ios') {
  return accountId
    ? <Redirect href={{ pathname: '/cards', params: { card: accountId } }} />
    : <Redirect href="/cards" />;
}
```

This routes Android/web into the existing Cards screen and compatibility
BottomSheet instead of exposing a second form-sheet behavior.
Import `Redirect`, `Stack`, and `useLocalSearchParams` from Expo Router and
`Platform` from React Native in this route.

- [ ] **Step 4: Register the form sheet**

Add to root Stack:

```tsx
<Stack.Screen
  name="card-detail"
  options={{
    presentation: Platform.OS === 'ios' ? 'formSheet' : 'card',
    sheetAllowedDetents: [0.5, 1],
    sheetGrabberVisible: true,
    headerShown: true,
    contentStyle: { backgroundColor: palette.background },
  }}
/>
```

Set the localized title from `card-detail.tsx` with its screen-level
`Stack.Screen` options, where the active language context is available. Use the
opaque Wafra background. Do not force transparent glass or assume iOS 26.

- [ ] **Step 5: Use the route only for read-only iOS entry**

In Cards, normal card tap on iOS pushes:

```ts
router.push({ pathname: '/card-detail', params: { accountId: card.id } });
```

Android/web continue `setDetail(card)` and render CardDetailSheet. Bills continues the compatibility CardDetailSheet because its Mark Paid footer is transactional and cannot cross route params.

- [ ] **Step 6: Verify route privacy and fallback**

```bash
node scripts/test/ios-native-navigation.test.js
node scripts/test/routes.test.js
node scripts/test/contracts.test.js
npm run typecheck
npm run test:e2e
```

Expected: the route accepts only accountId; card figures still come from `cardStatementView`; web/Android/Bills fallback behavior remains.

- [ ] **Step 7: Commit if authorized**

```bash
git add src/components/card-detail-content.tsx src/app/card-detail.tsx src/components/card-detail-sheet.tsx src/components/app-root-layout.tsx src/app/cards.tsx scripts/test/ios-native-navigation.test.js scripts/test/routes.test.js
git commit -m "feat: pilot a native card-detail sheet"
```

---

### Task 6: Accept or reject the navigation layer on device

**Files:**
- Review only: all Task 1–5 changes

**Interfaces:**
- Consumes: complete optional navigation layer.
- Produces: one explicit accepted commit set or a clean rollback to custom tabs/headers/sheets.

- [ ] **Step 1: Run source and browser gates**

```bash
node scripts/test/ios-native-navigation.test.js
node scripts/test/routes.test.js
node scripts/test/perf-config.test.js
node scripts/test/accessibility-layout.test.js
node scripts/test/system-language.test.js
node scripts/test/ios-setup-ux.test.js
npm run typecheck
npm run lint
npm run test:e2e
git diff --check
```

Expected: every command exits 0; web remains custom navigation.

- [ ] **Step 2: Build the signed simulator candidate**

Select Xcode, generate the ignored native project when absent, install Pods,
resolve and boot the exact simulator, then run the repository's
signing/keychain-preserving build:

```bash
xcode-select -p
test -d ios/Wafra.xcworkspace || npx expo prebuild --platform ios --no-install
test -d ios/Pods || npx pod-install
NAV_DEVICE_NAME='iPhone 16 Pro Max'
NAV_DEVICE_ID=$(xcrun simctl list devices available -j | jq -r --arg name "$NAV_DEVICE_NAME" '.devices[][] | select(.name == $name) | .udid' | head -1)
test -n "$NAV_DEVICE_ID"
xcrun simctl boot "$NAV_DEVICE_ID" 2>/dev/null || true
xcrun simctl bootstatus "$NAV_DEVICE_ID" -b
NAV_DERIVED_DATA='/tmp/wafra-native-navigation'
DEVICE_ID="$NAV_DEVICE_ID" CONFIGURATION=Release DERIVED_DATA="$NAV_DERIVED_DATA" bash scripts/e2e/adversarial/build-ios-simulator.sh
NAV_APP_PATH="$NAV_DERIVED_DATA/Build/Products/Release-iphonesimulator/Wafra.app"
xcrun simctl install "$NAV_DEVICE_ID" "$NAV_APP_PATH"
xcrun simctl launch "$NAV_DEVICE_ID" app.wafra.ios
```

If the named simulator/runtime is unavailable, stop and install/select the
required Xcode runtime rather than falling back to another screen size. The
script's returned `.app` path must pass its strict `codesign` check before
installation. Do not use the unsigned `CODE_SIGNING_ALLOWED=NO` screenshot
build as ledger evidence.

- [ ] **Step 3: Exercise the iOS matrix**

Verify four tab URLs/order, active-tab reselect, scroll-to-top/pop behavior, deep links, cold/warm state, native header push/back gesture, card form-sheet detents/dismissal, App Lock hiding all sheet content, safe areas, keyboard, light/dark, largest Dynamic Type, VoiceOver, Reduce Motion, Reduce Transparency, and Arabic cold launch/live language change.

- [ ] **Step 4: Exercise Android fallback**

Run a Release or production-equivalent Android smoke covering four custom tabs, 48dp targets, TalkBack order, Arabic RTL, back behavior, and compatibility card sheet. NativeTabs must not load on Android.

- [ ] **Step 5: Make the accept/reject decision**

Use `NAV_BASE_SHA` and `NAV_OWNED_PATHS` recorded by Task 1; after Task 5, run
`NAV_HEAD_SHA=$(git rev-parse HEAD)`. Accept the entire
`NAV_BASE_SHA..NAV_HEAD_SHA`
series only if every safe-area, route, App Lock, protected exit, RTL,
accessibility, form-sheet, and beta API gate passes. If any remains unresolved,
revert only the reviewed Task 1–5 commits/path hunks enumerated in
`NAV_OWNED_PATHS` back to their recorded baseline (or apply an explicit inverse
patch over those exact paths when commits were not authorized). Never use broad
checkout/restore and never touch a pre-existing user hunk. Retain the custom
navigator and record the whole optional series as rejected. Do not keep
orphaned context/header/form-sheet/test pieces. The release UI polish remains
complete either way.

- [ ] **Step 6: Run full gates on the accepted state**

```bash
npm test
npm run test:e2e
```

Expected: `run.sh` reports 69 app suites if accepted. If rejected, revert the
complete isolated navigation commit series, including deletion of
`scripts/test/ios-native-navigation.test.js`, removal of its `SUITES` entry,
and restoration of the expected count to 68; then require the custom-navigation
state green.

- [ ] **Step 7: Obtain independent read-only navigation review**

Review CaptureOwner lifetime, automatic/manual insets, platform file resolution, route params, App Lock containment, protected screens, RTL gesture direction, and rollback completeness.

No EAS/TestFlight build or store mutation is authorized by this evaluation plan.
