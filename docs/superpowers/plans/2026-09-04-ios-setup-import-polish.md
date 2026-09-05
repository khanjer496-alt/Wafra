# iPhone Setup and Import Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved iPhone shell, hierarchy, and accessibility system to onboarding, bank-alert setup, and import review while preserving the verified Shortcut/history state machine and protected-source guarantees.

**Architecture:** The active one-page onboarding implementation remains the sole owner of readiness, OS capability, history handoff, recovery, and source-free progress. This plan consumes those state modules as read-only boundaries, removes duplicated installation UI from Import, and changes only presentation/composition. Protected routes keep their screen-owned gesture and async leave guards.

**Tech Stack:** Expo SDK 55, React Native 0.83, Expo Router 55, Wafra UI foundation, AsyncStorage source-free progress, native iOS capture/history modules, Node contract tests, Swift store tests, physical iPhone verification.

**Spec:** `docs/superpowers/specs/2026-09-04-ios-release-ui-polish-design.md` and `docs/superpowers/specs/2026-09-03-ios-one-page-message-onboarding-design.md`

## Global Constraints

- Complete the foundation and core-screen plans first; this plan assumes `scripts/test/run.sh` has 67 registered app suites.
- Do not start until the active one-page/native-history task reports complete with a clean P0/P1 review and an origin-aware history-return contract.
- Treat these modules as read-only compatibility boundaries: `src/lib/ios-message-onboarding.ts`, `src/lib/ios-capture-setup.ts`, `src/lib/ios-history-setup.ts`, `src/lib/ios-history-import.ts`, both native modules, `eas.json`, and both Shortcut artifacts.
- The closed source-free history origin must cover Home, onboarding, iOS Setup, Wallet, Settings, and Import. The state module maps it to routes; UI code must not assemble return URLs.
- Preserve confirmed, ready, waiting-for-alert, real-alert verified, unavailable-sender, failed, and migration/recovery as distinct states.
- Preserve iOS 15.1 manual fallback, iOS 16–25 future-alert capability without iOS 26 history, and iOS 26+ history only when its native action exists.
- Preserve save-before-discard, cleanup retry, source retention on persistence failure, direct `?history=` recovery, and protected leave behavior.
- Do not call `setOnboarded()` when opening or returning from optional History. Onboarding completes only through its explicit finish/skip action.
- No new Shortcut graph, native action, parser, billing, encryption, or retention change belongs in this plan.
- Do not create a TestFlight/EAS build. The combined Shortcuts release plan owns the sole release lane.
- Commit commands require separate user authorization.

---

### Task 1: Freeze the verified handoff and add the presentation contract

**Files:**
- Create: `scripts/test/ui-setup-polish-contract.test.js`
- Modify: `scripts/test/run.sh`
- Reference only: `src/lib/ios-message-onboarding.ts`
- Reference only: `src/lib/ios-capture-setup.ts`
- Reference only: `src/lib/ios-history-setup.ts`
- Reference only: `src/lib/ios-history-import.ts`

**Interfaces:**
- Consumes: final active-task exports, including a closed history-return origin and one authoritative success-route function.
- Produces: suite `ui-setup-polish-contract`; total app-suite count 68; hard gate against UI-owned state or lost protected-session behavior.

- [ ] **Step 1: Verify the feature handoff before editing presentation**

Run serially:

```bash
bash scripts/test/build.sh
node scripts/test/onboarding.test.js
node scripts/test/ios-setup-ux.test.js
node scripts/test/ios-capture-setup.test.js
node scripts/test/historical-import.test.js
node scripts/test/ios-history-native-contract.test.js
node scripts/test/ios-history-shortcut-artifact.test.js
node scripts/test/ios-local-capture-shortcut-artifact.test.js
```

Expected: every command exits 0. Confirm the final history-origin type contains exactly source-free enum/string values and `iosHistorySuccessRoute()` is the only UI-facing route mapper. Stop if either condition is absent.

- [ ] **Step 2: Create the green privacy/state presentation baseline**

Create `scripts/test/ui-setup-polish-contract.test.js`:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const code = (value) => value.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const progress = read('src/lib/ios-message-onboarding.ts');
const historySetup = read('src/lib/ios-history-setup.ts');
for (const origin of ['home', 'onboarding', 'ios-setup', 'wallet', 'settings', 'import']) {
  assert.ok(historySetup.includes(`'${origin}'`), `missing history origin ${origin}`);
}

const capture = read('src/lib/ios-capture-setup.ts');
assert.match(capture, /'shortcut-proven'/);
assert.match(capture, /'first-alert-captured'/);
assert.match(capture, /Platform\.Version|majorIosVersion/);

const setupSource = read('src/app/ios-setup.tsx');
assert.match(setupSource, /setup\.readiness === 'first-alert-captured'/);
assert.match(setupSource, /t\('iosLocalWaitingTitle'\)/);

assert.match(historySetup, /iosHistorySuccessRoute/);
assert.match(historySetup, /26/);
assert.match(historySetup, /save|persist/i);
assert.match(historySetup, /discard|cleanup/i);

const onboarding = read('src/components/onboarding-gate.tsx');
assert.match(onboarding, /ios-message-onboarding/);

const importer = code(read('src/app/import-sms.tsx'));
assert.match(importer, /gestureEnabled: !validIosHistorySessionId\(history\)/);
assert.match(importer, /leaveProtectedSessionForExpiry/);
assert.match(importer, /retrySecureSave/);
assert.match(importer, /cancelHistoryHandoff/);
assert.match(importer, /iosHistorySuccessRoute\(/);

for (const relative of [
  'src/components/onboarding-gate.tsx',
  'src/app/ios-setup.tsx',
  'src/app/import-sms.tsx',
  'src/components/ios-message-setup/checklist-row.tsx',
  'src/components/ios-message-setup/details-sheet.tsx',
  'src/components/ios-message-setup/history-details-sheet.tsx',
]) {
  const source = code(read(relative));
  assert.doesNotMatch(source, /<Modal\b/, `${relative} creates a local modal`);
}

console.log('✓ iPhone setup/import presentation contract');
```

- [ ] **Step 3: Register the suite**

Change `EXPECTED_SUITES=67` to `EXPECTED_SUITES=68` and append:

```bash
SUITES+=(ui-setup-polish-contract)
```

- [ ] **Step 4: Verify the registered baseline**

Run `node scripts/test/ui-setup-polish-contract.test.js`.

Expected: pass. This is the green privacy/state baseline; Tasks 2 and 3 append
and satisfy their presentation assertions independently.

- [ ] **Step 5: Commit if authorized**

```bash
git add scripts/test/ui-setup-polish-contract.test.js scripts/test/run.sh
git commit -m "test: pin iPhone setup and import presentation boundaries"
```

---

### Task 2: Polish onboarding and the two-row setup checklist

**Files:**
- Modify: `src/components/onboarding-gate.tsx`
- Modify: `src/app/ios-setup.tsx`
- Modify: `src/components/ios-message-setup/checklist-row.tsx`
- Modify: `src/components/ios-message-setup/details-sheet.tsx`
- Modify: `src/components/ios-message-setup/history-details-sheet.tsx`
- Modify: `src/lib/i18n.ts`
- Modify: `scripts/test/accessibility-layout.test.js`
- Test: `scripts/test/onboarding.test.js`
- Test: `scripts/test/ios-setup-ux.test.js`
- Modify: `scripts/test/ui-setup-polish-contract.test.js`

**Interfaces:**
- Consumes: final `IosMessageSetupProgress`/event APIs and capability selectors without modifying them.
- Produces: short onboarding choice, one setup shell, two tappable stateful checklist rows, details sheets.

- [ ] **Step 1: Add failing layout/copy assertions**

Insert immediately before the final `console.log` in `ui-setup-polish-contract.test.js`:

```js
assert.doesNotMatch(read('src/components/onboarding-gate.tsx'), /maxFontSizeMultiplier=\{1\.6\}/);
const polishedSetup = code(read('src/app/ios-setup.tsx'));
assert.match(polishedSetup, /<ScreenScaffold/);
assert.equal((polishedSetup.match(/<ChecklistRow/g) ?? []).length, 2);
assert.match(polishedSetup, /onPress: leave/);
assert.match(polishedSetup, /finishLater/);
```

Extend `accessibility-layout.test.js`:

```js
const iosSetup = source('src/app/ios-setup.tsx');
const checklistRow = source('src/components/ios-message-setup/checklist-row.tsx');
ok('iPhone setup uses the shared shell and two checklist rows',
  /<ScreenScaffold/.test(iosSetup) &&
    (iosSetup.match(/<ChecklistRow/g) ?? []).length === 2);
ok('setup rows expose expansion and a full touch target',
  /accessibilityState=\{\{ expanded \}\}/.test(checklistRow) &&
    /minHeight: 44/.test(checklistRow));
```

Run the test and expect the scaffold assertion to fail.

- [ ] **Step 2: Keep onboarding to one decision surface**

Use the foundation Button/SectionHeader/BottomSheet and remove remaining explicit `maxFontSizeMultiplier={1.6}` caps. Keep the existing Welcome → Goals → Starting plan → capture choice sequence and the exact two choices Use Bank Alerts / Start Manually. Keep Learn More as the owner of long privacy/platform copy.

Do not add setup progress to the onboarding component; it navigates to iOS Setup and the state module restores progress there.

- [ ] **Step 3: Migrate iOS Setup to the protected inline shell**

Replace its local SafeAreaView/ScrollView/header wrapper with:

```tsx
<ScreenScaffold
  headerMode="inline"
  keyboardAware
  header={{
    title: t('iosSetupTitle'),
    back: { label: t('back'), icon: 'chevron-left', onPress: leave },
  }}>
```

Move the current JSX blocks beginning with the progress count and ending with
Finish Later/Learn More directly between that opening tag and its closing
`ScreenScaffold` tag. Keep their order: count, Future Alerts ChecklistRow, Past
Alerts ChecklistRow, Finish Later, Learn More. Keep the existing foreground
reconciliation and event dispatch calls unchanged.

- [ ] **Step 4: Polish ChecklistRow without changing status meaning**

Keep the card because the whole bounded object is tappable/stateful. Preserve `not-started`, `in-progress`, `complete`, and `skipped`. Use canonical icons/tokens, 44-point header, `accessibilityState={{ expanded }}`, and an accessibility value containing the localized status. Do not derive complete from visual confirmation alone.

- [ ] **Step 5: Keep detail copy out of the task path**

Use the shared BottomSheet footer/scroll contract for `DetailsSheet` and `HistoryDetailsSheet`. Keep local-processing, sender-unavailable, migration, retention, duration, and cleanup explanations there. No body paragraph in the collapsed checklist exceeds two normal-text lines.

- [ ] **Step 6: Add or adjust translations as complete pairs**

Any changed title/status/action key gets both `en` and `ar` entries in `src/lib/i18n.ts`. Reuse the existing capability/state keys; do not create a synonym for ready, verified, future alerts, or past alerts.

- [ ] **Step 7: Verify onboarding/setup**

```bash
node scripts/test/onboarding.test.js
node scripts/test/ios-setup-ux.test.js
node scripts/test/ios-capture-setup.test.js
node scripts/test/accessibility-layout.test.js
node scripts/test/ui-setup-polish-contract.test.js
node scripts/test/contracts.test.js
npm run typecheck
```

Expected: state-machine and setup-presentation assertions are green before
Task 3 adds the Import-ownership contract.

- [ ] **Step 8: Commit if authorized**

```bash
git add src/components/onboarding-gate.tsx src/app/ios-setup.tsx src/components/ios-message-setup src/lib/i18n.ts scripts/test/accessibility-layout.test.js scripts/test/ui-setup-polish-contract.test.js
git commit -m "feat: polish the iPhone bank-alert checklist"
```

---

### Task 3: Make Import a processing/review surface only

**Files:**
- Modify: `src/app/import-sms.tsx`
- Modify: `src/app/ios-setup.tsx`
- Modify: `src/screens/ledger-home-screen.tsx`
- Modify: `src/app/(tabs)/wallet.tsx`
- Modify: `src/app/settings.tsx`
- Modify: `src/app/pro.tsx`
- Modify: `src/components/supplement-imports.tsx`
- Modify: `src/lib/i18n.ts`
- Modify: `scripts/test/ios-setup-ux.test.js`
- Modify: `scripts/test/routes.test.js`
- Test: `scripts/test/historical-import.test.js`
- Modify: `scripts/test/ui-setup-polish-contract.test.js`

**Interfaces:**
- Consumes: final origin-aware Setup route contract, direct `history` session param, processing plan/review/commit/cleanup state.
- Produces: Setup owns installation; Import owns explicit content, processing, review, correction, durable save, and cleanup/recovery.

- [ ] **Step 1: Pin protected behavior before removing setup UI**

Add assertions to `ios-setup-ux.test.js` that `import-sms.tsx` still contains:

```js
assert.match(importSms, /gestureEnabled: !validIosHistorySessionId\(history\)/);
assert.match(importSms, /leaveScreen/);
assert.match(importSms, /leaveProtectedSessionForExpiry/);
assert.match(importSms, /retrySecureSave/);
assert.match(importSms, /iosHistorySuccessRoute\(setupProgress, returnOrigin\)/);
```

Run the suite and require it green before presentation edits.

- [ ] **Step 2: Add the failing Import-ownership contract**

Insert immediately before the final `console.log` in `ui-setup-polish-contract.test.js`:

```js
const polishedImport = code(read('src/app/import-sms.tsx'));
assert.match(polishedImport, /<ScreenScaffold/);
assert.doesNotMatch(polishedImport, /historyShortcutInstallUrl/);
assert.doesNotMatch(polishedImport, /openHistoryInstall/);
assert.match(polishedImport, /cancelHistoryHandoff/);
```

Run the suite and expect failure on scaffold/setup-install ownership while the
protected-session assertions remain green.

- [ ] **Step 3: Replace the shell without replacing leave semantics**

Keep this route-owned guard exactly:

```tsx
<Stack.Screen options={{ gestureEnabled: !validIosHistorySessionId(history) }} />
```

Replace the local safe-area/header/ScrollView shell with `ScreenScaffold headerMode="inline" keyboardAware`. Its back action is `leaveScreen`, never `router.back()`.

- [ ] **Step 4: Remove installation/run ownership from Import**

When there is no valid `history` session, replace the iOS history install/run card with one bounded Past Alerts row:

```tsx
<Block onPress={openPastAlertsSetup}>
  <View style={styles.unreadRow}>
    <Icon name="calendar" size={18} color={theme.primary} />
    <View style={styles.rowText}>
      <ThemedText type="smallBold">{t('iosMessagePastTitle')}</ThemedText>
      <ThemedText type="meta" themeColor="textSecondary">{t('historyReadyCompact')}</ThemedText>
    </View>
    <Icon name="chevron-right" size={15} color={theme.textTertiary} />
  </View>
</Block>
```

Read the optional closed origin through the authoritative state helper:

```ts
const { auto, history, origin } = useLocalSearchParams<{
  auto?: string;
  history?: string;
  origin?: string;
}>();
const requestedOrigin = iosHistoryReturnOriginFromParam(origin) ?? 'import';

const openPastAlertsSetup = () => {
  router.push({
    pathname: '/ios-setup',
    params: { section: 'history', returnOrigin: requestedOrigin },
  });
};
```

On iOS Setup, read the optional `section` parameter and dispatch the existing
`active-section-changed` event when its value is `history`; ignore every other
value. Validate `returnOrigin` with `iosHistoryReturnOriginFromParam()` and use
it in preference to the default `ios-setup` origin when beginning the handoff.
Remove UI-owned imports/state/handlers used only to install, reinstall,
confirm, or run the history Shortcut. Keep direct-session
load/reconcile/cancel/cleanup functions.

Retain a compact pending/callback surface whenever the source-free handoff
marker exists but no valid `history` session has loaded:

```tsx
{historySetup.handoffStartedAt !== null && !validIosHistorySessionId(history) ? (
  <Block>
    <ThemedText type="smallBold">{t('historyRunningCompact')}</ThemedText>
    <ThemedText type="meta" themeColor="textSecondary">
      {t('historyNoLiveProgressDetails')}
    </ThemedText>
    <Button
      label={t('historyContinueAction')}
      variant="outline"
      onPress={openPastAlertsSetup}
    />
    <Button
      label={t('cancel')}
      variant="ghost"
      disabled={historyActionBusy}
      onPress={() => void cancelHistoryHandoff()}
    />
  </Block>
) : null}
```

This is recovery/cancel UI, not Shortcut installation UI. Continue returns to
Setup, where `historySetup.handoffStartedAt !== null` exposes the authoritative
`openHistoryRun(false)` action; it does not overwrite the already persisted
origin. Keep the bare x-cancel/x-error callback, handoff marker cleanup, origin
marker cleanup, and TTL behavior authoritative in the frozen state module.

Update entry routes so the invoking surface is explicit and source-free:

```ts
// Home setup actions
router.push('/ios-setup?returnOrigin=home');

// Settings setup actions
router.push('/ios-setup?returnOrigin=settings');

// Wallet import action
router.push('/import-sms?origin=wallet');

// Pro's free manual-import exit returns to the ledger
router.push('/import-sms?origin=home');
```

- [ ] **Step 5: Preserve manual sources and review states**

Keep Android scanning, manual paste, document/supplement imports, and sample parse. Replace the multiline paste `TextInput` with multiline `TextField` using visible label `t('pasteBankMessagesA11y')`. Preserve verdict invalidation on every edit.

Order the active history surface as processing/progress, source counts, review summary, parsed items/corrections, Save, then cleanup/recovery status. Use separate visual and accessibility states for ready-to-review, duplicate, ignored, saved, failed, source-retained, storage-failed, and cleanup-failed.

- [ ] **Step 6: Preserve origin-aware terminal routes**

Successful save and safe cancel first consume the one-time origin marker and
call only `iosHistorySuccessRoute(setupProgress, returnOrigin)`. A
setup/onboarding origin returns to its saved checklist; Wallet, Settings,
Import, and Home return to their corresponding closed origin. Cleanup/storage
failure remains on the recovery surface until the existing guarded callback
permits leaving.

- [ ] **Step 7: Update route and duplication tests**

In `routes.test.js`, assert Import contains no `historyShortcutInstallUrl` or `openHistoryInstall`, and that iOS Setup remains the only source file containing those setup actions. Keep the direct `?history=` route in the available route table.

- [ ] **Step 8: Verify processing, save, and cleanup**

```bash
bash scripts/test/build.sh
node scripts/test/ios-setup-ux.test.js
node scripts/test/historical-import.test.js
node scripts/test/ios-history-native-contract.test.js
node scripts/test/routes.test.js
node scripts/test/ui-setup-polish-contract.test.js
node scripts/test/accessibility-layout.test.js
npm run typecheck
npm run test:e2e
```

Expected: the UI contract is fully green; history save/discard/cleanup and origin-return tests remain green; Import has no installation state.

- [ ] **Step 9: Commit if authorized**

```bash
git add src/app/import-sms.tsx src/app/ios-setup.tsx src/screens/ledger-home-screen.tsx src/app/'(tabs)'/wallet.tsx src/app/settings.tsx src/app/pro.tsx src/components/supplement-imports.tsx src/lib/i18n.ts scripts/test/ios-setup-ux.test.js scripts/test/routes.test.js scripts/test/ui-setup-polish-contract.test.js
git commit -m "feat: separate iPhone setup from import review"
```

---

### Task 4: Verify capability tiers and protected-device behavior

**Files:**
- Review only: Task 2–3 presentation files and read-only state boundaries

**Interfaces:**
- Consumes: completed setup/import presentation.
- Produces: reviewed input for optional native navigation and sole-owner release QA; no production mutation.

- [ ] **Step 1: Run the full focused gate serially**

```bash
bash scripts/test/build.sh
node scripts/test/onboarding.test.js
node scripts/test/ios-setup-ux.test.js
node scripts/test/ios-capture-setup.test.js
node scripts/test/historical-import.test.js
node scripts/test/ios-history-native-contract.test.js
node scripts/test/routes.test.js
node scripts/test/accessibility-layout.test.js
node scripts/test/ui-setup-polish-contract.test.js
bash scripts/test/native-history-store.sh
node scripts/test/ios-history-shortcut-artifact.test.js
node scripts/test/ios-local-capture-shortcut-artifact.test.js
npm run typecheck
npm run lint
git diff --check
```

Expected: every command exits 0. Do not run native Swift scripts off macOS.

- [ ] **Step 2: Run repository/browser gates**

```bash
npm test
npm run test:e2e
```

Expected: `run.sh` reports 68 app suites and browser fallback/manual flows remain usable.

- [ ] **Step 3: Exercise simulator capability fallbacks**

On available signed simulator runtimes, verify:

- iOS 15.1: manual entry/paste remains usable; UI makes no future/history claim;
- iOS 16–25: selected-sender future setup is available; Past Alerts explains iOS 26 requirement;
- iOS 26+: Past Alerts appears only when the native action is actually available.

Runtime capability result wins over OS number. Record unavailable runtime rows as blocked rather than simulated success.

- [ ] **Step 4: Exercise the physical iPhone once unlocked**

Verify fresh setup, finish later/resume, selected sender, harmless setup proof, waiting-for-alert, real future bank alert verified, unrepresentable sender fallback, past-history import, save, lock/reboot, cleanup retry, and origin-aware return. Never include private message content in evidence.

- [ ] **Step 5: Obtain independent read-only privacy/UI review**

The reviewer checks that no Message content entered setup progress, ready is not called verified, no source is discarded before durable save, protected back gestures remain disabled, Import owns no installation state, and all English/Arabic copy describes the same capability.

- [ ] **Step 6: Commit the verified handoff if authorized**

```bash
git add src/components/onboarding-gate.tsx src/app/ios-setup.tsx src/app/import-sms.tsx src/screens/ledger-home-screen.tsx src/app/'(tabs)'/wallet.tsx src/app/settings.tsx src/app/pro.tsx src/components/ios-message-setup src/components/supplement-imports.tsx src/lib/i18n.ts scripts/test/ui-setup-polish-contract.test.js scripts/test/ios-setup-ux.test.js scripts/test/routes.test.js scripts/test/accessibility-layout.test.js scripts/test/run.sh
git commit -m "feat: complete iPhone setup and import polish"
```

Do not include read-only state/native/Shortcut files unless a separate active-feature review explicitly returned them to scope.
