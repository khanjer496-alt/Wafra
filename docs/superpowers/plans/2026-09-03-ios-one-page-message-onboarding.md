# One-Page iPhone Message Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` or
> `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Replace paragraph-heavy, non-resumable iPhone onboarding with a
one-viewport checklist for past alerts and sender-scoped future alerts.

**Architecture:** Keep the two physically audited Shortcut artifacts unchanged.
Add a source-free AsyncStorage coordinator for UI progress, let native capture
status and native history handoff remain authoritative, and compose both paths
from `ios-setup` without marking onboarding complete early. Detailed
disclosures move into an existing bottom-sheet pattern.

**Tech Stack:** Expo SDK 55.0, React Native 0.83, Expo Router, AsyncStorage,
Apple Shortcuts/App Intents, TypeScript, Node test harnesses, EAS/TestFlight.

**Spec:** `docs/superpowers/specs/2026-09-03-ios-one-page-message-onboarding-design.md`

## Global constraints

- Use only Expo SDK 55 documentation.
- Target 402×874 points at default Dynamic Type with no required scrolling.
- Preserve 44×44-point targets and unclipped Dynamic Type scrolling fallback.
- Card body copy is at most two short lines; details live behind **Learn more**.
- Remove `Any Sender` and all universal future-SMS claims.
- Future automatic capture is limited to bank senders the user selects.
- Keep both published Shortcut action graphs and URLs unchanged.
- Store no Message, sender, bank, account, transaction, or session identifier in
  onboarding progress.
- Do not commit or push without separate human authorization.

---

### Task 1: Durable source-free setup progress

**Files:**

- Create: `src/lib/ios-message-onboarding.ts`
- Modify: `scripts/test/ios-setup-ux.test.js`
- Modify: `src/lib/ios-history-setup.ts`

**Produces:**

```ts
export type IosMessageSetupSection = 'future' | 'history';
export type IosMessageSetupStatus =
  | 'not-started'
  | 'in-progress'
  | 'complete'
  | 'skipped';

export interface IosMessageSetupProgress {
  version: 1;
  activeSection: IosMessageSetupSection;
  futureShortcutConfirmed: boolean;
  futureAutomationConfirmed: boolean;
  futureStatus: IosMessageSetupStatus;
  historyShortcutConfirmed: boolean;
  historyStatus: IosMessageSetupStatus;
  returnToOnboarding: boolean;
}

export function reduceIosMessageSetup(
  current: IosMessageSetupProgress,
  event: IosMessageSetupEvent,
): IosMessageSetupProgress;

export function loadIosMessageSetupProgress(
  storage?: IosMessageSetupStorage,
): Promise<IosMessageSetupProgress>;

export function dispatchIosMessageSetup(
  event: IosMessageSetupEvent,
  storage?: IosMessageSetupStorage,
): Promise<IosMessageSetupProgress>;

export function clearIosMessageSetupProgress(
  storage?: IosMessageSetupStorage,
): Promise<void>;
```

- [ ] Write RED tests for strict defaults, exact key validation, serialized
  concurrent updates, restart recovery, and rejection of source-bearing keys.
- [ ] Run `bash scripts/test/build.sh && node scripts/test/ios-setup-ux.test.js`;
  expect failure because the module does not exist.
- [ ] Implement the module with key
  `wafra/ios-message-setup-progress/v1`, an exact-key JSON parser, a pure
  reducer, and one promise-tail serialized storage adapter.
- [ ] Reconcile the existing history-installed marker without replacing native
  history or capture status.
- [ ] Re-run the focused test and require zero failures.

### Task 2: Compact the first-run choice

**Files:**

- Modify: `src/components/onboarding-gate.tsx`
- Modify: `src/lib/i18n.ts`
- Modify: `scripts/test/onboarding.test.js`
- Modify: `scripts/test/accessibility-layout.test.js`

**Visible English meanings:**

```text
Heading: Keep Wafra up to date
Body: Use bank alerts or start manually.
Automatic title: Use bank alerts
Automatic body: Import past alerts and connect selected banks for future alerts.
Manual title: Start manually
Manual body: No Messages access. Connect later anytime.
Privacy: Processed on this iPhone. Nothing uploaded.
Action: Learn more
```

- [ ] Write RED copy-budget tests: title ≤42 characters, card body ≤92, privacy
  summary ≤64; exactly two choice cards; no inline long privacy paragraph.
- [ ] Run the onboarding and accessibility suites and observe the expected
  paragraph/layout failures.
- [ ] Use the existing `BottomSheet` for full privacy, retention, legacy
  migration, and platform-limit copy.
- [ ] Reduce the normal card height from 92 to 78 points while retaining
  44-point icons and touch targets. Do not use `numberOfLines` to hide text.
- [ ] Re-run focused tests, scoped ESLint, and `git diff --check`.

### Task 3: One resumable Future/Past checklist

**Files:**

- Create: `src/components/ios-message-setup/checklist-row.tsx`
- Create: `src/components/ios-message-setup/details-sheet.tsx`
- Modify: `src/app/ios-setup.tsx`
- Modify: `src/lib/ios-capture-setup.ts`
- Modify: `src/lib/i18n.ts`
- Modify: `scripts/test/ios-capture-setup.test.js`
- Modify: `scripts/test/ios-setup-ux.test.js`

**Checklist component:**

```ts
interface ChecklistRowProps {
  title: string;
  detail: string;
  status: IosMessageSetupStatus;
  expanded: boolean;
  onPress(): void;
  children?: React.ReactNode;
}
```

- [ ] Write RED tests requiring one
  `testID="ios-message-setup-checklist"`, exactly two Future/Past rows, only
  one expanded row, persisted progress before every Shortcuts handoff, and
  restoration after remount.
- [ ] Add a mutation test that rejects `Any Sender`, blank universal triggers,
  space triggers, and currency-keyword triggers.
- [ ] Build `ChecklistRow` as a 44-point target with one-line title, two-line
  detail, status icon, and one expandable action area.
- [ ] Future row actions are exactly:
  `Add Wafra Local Capture` → `Continue after adding` →
  `Create Apple automation` → `I finished in Shortcuts`.
- [ ] Future inline guide is exactly:
  `Message`; `Select your bank sender`; `Run Immediately`;
  `Run Wafra Local Capture with Received Message`.
- [ ] Keep the harmless no-input proof and state
  `Shortcut ready · waiting for a real bank alert`; never claim the trigger is
  verified.
- [ ] Past row reuses the current History install/run operations with only:
  `Checks retained Messages on this iPhone.` and
  `Large histories can take 20–25 minutes.`
- [ ] Only explicit Finish/Finish later marks onboarding complete. Opening
  History cannot call `setOnboarded()`.
- [ ] Re-run both focused iOS suites, typecheck, lint, and diff check.

### Task 4: Return History review to setup and compact history copy

**Files:**

- Modify: `src/app/import-sms.tsx`
- Modify: `src/lib/ios-history-setup.ts`
- Modify: `src/lib/i18n.ts`
- Modify: `scripts/test/ios-setup-ux.test.js`
- Modify: `scripts/test/historical-import.test.js`

**Routing helper:**

```ts
export function iosHistorySuccessRoute(
  progress: IosMessageSetupProgress,
): '/' | '/ios-setup?fromOnboarding=1';
```

- [ ] Write RED tests requiring File, no-op File, and Cancel to return to the
  saved checklist only when `returnToOnboarding` is true.
- [ ] Require native source cleanup before dispatching `history-complete`.
- [ ] Replace normal inline history paragraphs with:
  `Choose Always Allow when Apple asks`,
  `Shortcuts is still working. Keep the iPhone unlocked`, and
  `Nothing is saved until you confirm`.
- [ ] Put coverage bounds, timing evidence, no-live-progress, temporary-source,
  and cleanup detail in Learn More.
- [ ] Render source counts as two compact rows instead of one long sentence.
- [ ] Re-run focused tests, typecheck, lint, and diff check.

### Task 5: Physical and release gate

**Files:**

- Modify evidence and TestFlight copy only after observed results.
- Keep `eas.json` Shortcut URLs unchanged.

- [ ] Run focused suites for onboarding, accessibility, capture setup, history
  setup/import, native contract, and both Shortcut artifacts.
- [ ] Run `npm run typecheck -- --pretty false`, `npm run lint`, and
  `git diff --check`.
- [ ] Run the complete `npm test` gate.
- [ ] On the physical 1206×2622 @3x iPhone, capture default, dark, Arabic, and
  Dynamic Type states. Default actions must be visible without scrolling;
  accessibility text must remain reachable without clipping.
- [ ] Erase only Wafra test data and verify:
  Welcome → Goals → Plan → Use bank alerts → Future/Past checklist →
  sender-scoped automation → harmless proof → one-message History probe →
  checklist → Finish → Home.
- [ ] Do not call future capture verified until one real future message from the
  selected bank sender reaches Wafra.
- [ ] Build the next auto-incremented `history-beta` store IPA, verify its
  signature, store provisioning, App Intent metadata, and unchanged public
  Shortcut URLs.
- [ ] Upload, add to internal/external Beta, verify `VALID` and
  `IN_BETA_TESTING`, and record the build/ASC IDs without Message content.
