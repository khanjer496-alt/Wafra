# iPhone UI Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish Wafra's single accessible UI foundation—semantic tokens, scalable typography, canonical controls, portable native icons, one screen shell, and one inline-sheet contract—without changing ledger or import behavior.

**Architecture:** Extend the existing warm `src/constants/theme.ts` system rather than introducing another theme. New focused primitives become the only implementation seams while current exports remain thin compatibility adapters until screen-family migration is complete. Route-owned navigation guards and domain actions remain outside the UI layer.

**Tech Stack:** Expo SDK 55, React Native 0.83, Expo Router 55, `expo-symbols` 55, Reanimated 4, Gesture Handler 2, safe-area-context 5, TypeScript, Node source-contract tests, Playwright web E2E.

**Spec:** `docs/superpowers/specs/2026-09-04-ios-release-ui-polish-design.md`

## Global Constraints

- Read the exact Expo SDK 55 documentation under `https://docs.expo.dev/versions/v55.0.0/`; do not use APIs documented only for SDK 56 or `latest`.
- Start only after the active one-page iPhone onboarding task has finished and its owner confirms shared UI files are stable.
- Preserve the dirty worktree. Do not reset, stash, rebase, checkout, or reformat unrelated files.
- Preserve the current warm light/dark palette, bundled Geist/Noto fonts, `ScreenPadding = 22`, four-point spacing ladder, and semantic money colors.
- Do not change amount, period, parser, card-payment, billing, encryption, history-import, or Shortcut state logic.
- `@expo/ui` universal controls require SDK 56+, so this SDK 55 plan does not add or build around the universal `Host`/control layer.
- `expo-symbols` is already present. Do not edit `package.json` or the lockfile for the icon task.
- Every iOS target is at least 44×44 points and every Android target is at least 48dp.
- Tab switches receive no entrance animation. Preserve the Android animation short-circuit in `useScreenEntering()` and Reduce Motion behavior.
- Run focused Node tests before the full suite; `scripts/test/run.sh` serializes a shared build directory and must not run concurrently with another test process.
- Commit commands in this plan are suggestions only. Skip them unless the user separately authorizes commits.

---

### Task 1: Add the UI foundation contract gate

**Files:**
- Create: `scripts/test/ui-foundation-contract.test.js`
- Modify: `scripts/test/run.sh`

**Interfaces:**
- Consumes: current source files as plain text, matching the repository's contract-test style.
- Produces: one source-contract suite named `ui-foundation-contract`; each later task adds and satisfies its own contract in the same change.

- [ ] **Step 1: Create the green foundation baseline test**

Create `scripts/test/ui-foundation-contract.test.js` with this exact structure:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(ROOT, relative));

const theme = read('src/constants/theme.ts');
assert.match(theme, /export const Colors/);
assert.match(theme, /export const Fonts/);
assert.match(theme, /export const Spacing/);

const perf = read('src/hooks/use-screen-entering.ts');
assert.match(perf, /Platform\.OS === 'android' \|\| reducedMotion \? undefined : animation/);

const sheet = read('src/components/ui/bottom-sheet.tsx');
assert.match(sheet, /accessibilityViewIsModal/);
assert.match(sheet, /onAccessibilityEscape/);
assert.match(sheet, /useKeyboardHeight/);

const sourceFiles = (dir = path.join(ROOT, 'src')) => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
const modalOwners = sourceFiles()
  .filter((file) => fs.readFileSync(file, 'utf8').includes('<Modal'))
  .map((file) => path.relative(ROOT, file));
assert.ok(modalOwners.includes('src/components/ui/bottom-sheet.tsx'));
assert.ok(modalOwners.every((relative) =>
  relative === 'src/components/ui/bottom-sheet.tsx' ||
  relative === 'src/components/limit-sheet.tsx'));

console.log('✓ UI foundation baseline contract');
```

- [ ] **Step 2: Register the new suite**

In `scripts/test/run.sh`, change `EXPECTED_SUITES=65` to `EXPECTED_SUITES=66` and append the suite once:

```bash
SUITES+=(ui-foundation-contract)
```

Place it after `accessibility-layout` so the two presentation gates remain adjacent.

- [ ] **Step 3: Run the new test and verify the baseline**

Run:

```bash
node scripts/test/ui-foundation-contract.test.js
```

Expected: pass. This task registers a green baseline; each following task adds
its own failing assertion immediately before the matching implementation, so
the repository never carries a suite that is red for unrelated future work.

- [ ] **Step 4: Commit the baseline test if authorized**

```bash
git add scripts/test/ui-foundation-contract.test.js scripts/test/run.sh
git commit -m "test: define iPhone UI foundation contract"
```

---

### Task 2: Complete semantic tokens and remove global text caps

**Files:**
- Modify: `src/constants/theme.ts`
- Modify: `src/components/themed-text.tsx`
- Create: `src/components/ui/tab-bar-metrics.tsx`
- Modify: `src/components/app-tabs-layout.tsx`
- Modify: `src/components/tab-bar.tsx`
- Modify: `src/hooks/use-tab-bar-clearance.ts`
- Modify: `src/components/storage-recovery.tsx`
- Modify: `scripts/test/accessibility-layout.test.js`
- Modify: `scripts/test/ui-foundation-contract.test.js`

**Interfaces:**
- Consumes: existing `Colors`, `ThemeColor`, `ThemedText`, and large-text layouts.
- Produces: `inverseSurface`, `inverseText`, and `scrim` through `useTheme()`; uncapped body/control text; explicitly reflowing legacy tab labels.

- [ ] **Step 1: Add failing typography assertions**

Insert immediately before the final `console.log` in `ui-foundation-contract.test.js`:

```js
for (const token of ['inverseSurface', 'inverseText', 'scrim']) {
  assert.equal(
    (theme.match(new RegExp(`\\b${token}:`, 'g')) ?? []).length,
    2,
    `${token} must exist in both palettes`,
  );
}
```

Insert immediately before its final summary `console.log` in `scripts/test/accessibility-layout.test.js`:

```js
const themedText = source('src/components/themed-text.tsx');
ok('ThemedText does not impose a global Dynamic Type ceiling',
  !/const MAX_SCALE/.test(themedText) &&
    !/maxFontSizeMultiplier=\{rest\.maxFontSizeMultiplier/.test(themedText));
ok('the compatibility tab bar does not clip or cap localized tab labels',
  !/maxFontSizeMultiplier=\{1\.3\}/.test(tabBar) &&
    !/numberOfLines=\{1\}[\s\S]{0,120}styles\.tabLabel/.test(tabBar));
for (const token of ['text', 'textSecondary', 'textTertiary']) {
  const values = tokenValues(token);
  ok(`${token} meets 4.5:1 normal-text contrast on the page`,
    values.length === 2 && values.every((value, index) =>
      contrast(value, tokenValues('background')[index]) >= 4.5));
}
ok('meaningful control boundaries meet the 3:1 non-text floor',
  controlBorders.length === 2 && elementBackgrounds.length === 2 &&
    controlBorders.every((value, index) => contrast(value, elementBackgrounds[index]) >= 3));
const tabMetrics = source('src/components/ui/tab-bar-metrics.tsx');
const tabClearance = source('src/hooks/use-tab-bar-clearance.ts');
ok('tab clearance follows the measured wrapped label height',
  /onLayout/.test(tabBar) && /setMeasuredHeight/.test(tabBar) &&
    /measuredHeight \?\?/.test(tabClearance) && /TabBarMetricsProvider/.test(tabMetrics));
```

Run both new/changed suites and expect the token assertion plus both typography
assertions to fail:

```bash
node scripts/test/ui-foundation-contract.test.js
node scripts/test/accessibility-layout.test.js
```

- [ ] **Step 2: Add the semantic palette values**

Add these keys to both objects in `src/constants/theme.ts`:

```ts
// light
inverseSurface: '#16130F',
inverseText: '#F2EFE8',
scrim: 'rgba(22, 19, 15, 0.42)',

// dark
inverseSurface: '#F2EFE8',
inverseText: '#16130F',
scrim: 'rgba(22, 19, 15, 0.42)',
```

Do not replace `background`, `backgroundElement`, `text`, `primary`, or financial-state values with system colors.

- [ ] **Step 3: Remove the central multiplier table**

In `src/components/themed-text.tsx`, remove `MAX_SCALE` and remove this prop from the rendered `Text`:

```tsx
maxFontSizeMultiplier={rest.maxFontSizeMultiplier ?? MAX_SCALE[type]}
```

Keep `allowFontScaling`. Explicit caller props in `rest` remain supported for a narrowly justified decorative value.

- [ ] **Step 4: Let compatibility tab labels reflow and measure the bar**

In `src/components/tab-bar.tsx`, remove `numberOfLines={1}` and `maxFontSizeMultiplier={1.3}` from the label. Update the styles to keep the text centered without clipping:

```ts
tab: {
  flex: 1,
  minHeight: 58,
  alignItems: 'center',
  justifyContent: 'center',
  gap: 3,
  paddingVertical: 5,
},
tabLabel: {
  fontSize: 11,
  lineHeight: 14,
  textAlign: 'center',
  flexShrink: 1,
},
```

Create `tab-bar-metrics.tsx` with a provider holding `measuredHeight: number |
null` and `setMeasuredHeight(height)`. Wrap CaptureOwner/Tabs in that provider
inside `app-tabs-layout.tsx`. In `WafraTabBar`, call `setMeasuredHeight` from the
outer `wrap` View's `onLayout` whenever the rounded layout height changes.

```tsx
import { createContext, use, useMemo, useState, type ReactNode } from 'react';

type TabBarMetrics = {
  measuredHeight: number | null;
  setMeasuredHeight: (height: number) => void;
};

const TabBarMetricsContext = createContext<TabBarMetrics>({
  measuredHeight: null,
  setMeasuredHeight: () => undefined,
});

export function TabBarMetricsProvider({ children }: { children: ReactNode }) {
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);
  const value = useMemo(() => ({ measuredHeight, setMeasuredHeight }), [measuredHeight]);
  return <TabBarMetricsContext.Provider value={value}>{children}</TabBarMetricsContext.Provider>;
}

export const useTabBarMetrics = (): TabBarMetrics => use(TabBarMetricsContext);
```

Keep `TAB_BAR_HEIGHT = 58` only as the pre-measurement fallback. Change
`useTabBarClearance()` to:

```ts
const { measuredHeight } = useTabBarMetrics();
const fallbackHeight = TAB_BAR_HEIGHT + Math.max(insets.bottom, Spacing.two);
return (measuredHeight ?? fallbackHeight) + Spacing.three;
```

The measured wrap already includes its bottom safe-area padding, so do not add
`insets.bottom` after measurement.

- [ ] **Step 5: Remove recovery-screen caps**

Remove both `maxFontSizeMultiplier={1.6}` props in `src/components/storage-recovery.tsx`. Preserve the existing ScrollView/recovery actions and do not change keychain behavior.

- [ ] **Step 6: Run focused checks**

```bash
node scripts/test/ui-foundation-contract.test.js
node scripts/test/accessibility-layout.test.js
npm run typecheck
```

Expected: token and typography assertions pass; both registered presentation
suites are green before the next task adds its own contract.

- [ ] **Step 7: Commit if authorized**

```bash
git add src/constants/theme.ts src/components/themed-text.tsx src/components/ui/tab-bar-metrics.tsx src/components/app-tabs-layout.tsx src/components/tab-bar.tsx src/hooks/use-tab-bar-clearance.ts src/components/storage-recovery.tsx scripts/test/accessibility-layout.test.js scripts/test/ui-foundation-contract.test.js
git commit -m "feat: make Wafra typography and semantic colors accessible"
```

---

### Task 3: Consolidate headers, icon actions, and segments behind adapters

**Files:**
- Create: `src/components/ui/section-header.tsx`
- Create: `src/components/ui/action-icon-button.tsx`
- Create: `src/components/ui/segmented-control.tsx`
- Modify: `src/components/ui/layout.tsx`
- Modify: `src/components/ui/period-pill.tsx`
- Modify: `src/components/ui/controls.tsx`
- Modify: `src/app/settings.tsx`
- Modify: `scripts/test/ui-foundation-contract.test.js`
- Test: `scripts/test/accessibility-layout.test.js`

**Interfaces:**
- Consumes: `IconName`, `ThemedText`, `useTheme()`, `tapped()`, existing compatibility prop names.
- Produces: canonical `SectionHeader`, `ActionIconButton`, `SegmentedControl<T>`; deprecated adapters preserve current callers.

- [ ] **Step 1: Add failing canonical-primitive assertions**

Insert immediately before the final `console.log` in `ui-foundation-contract.test.js`:

```js
for (const relative of [
  'src/components/ui/section-header.tsx',
  'src/components/ui/action-icon-button.tsx',
  'src/components/ui/segmented-control.tsx',
]) assert.ok(exists(relative), `missing ${relative}`);

const sectionHeader = read('src/components/ui/section-header.tsx');
assert.match(sectionHeader, /type SectionHeaderTrailing/);
assert.match(sectionHeader, /action\?: never/);
assert.match(sectionHeader, /minWidth: 44, minHeight: 44/);
assert.match(sectionHeader, /minWidth: 48, minHeight: 48/);

const actionIcon = read('src/components/ui/action-icon-button.tsx');
assert.match(actionIcon, /minWidth: 44/);
assert.match(actionIcon, /minHeight: 44/);
assert.match(actionIcon, /androidFrame: \{ minWidth: 48, minHeight: 48 \}/);
assert.doesNotMatch(actionIcon, /size\?: number/);

const segmented = read('src/components/ui/segmented-control.tsx');
assert.match(segmented, /label: string/);
assert.match(segmented, /role="tablist"/);
assert.match(segmented, /accessibilityState=\{\{ selected: active \}\}/);
assert.match(segmented, /androidSegment: \{ minHeight: 48 \}/);

for (const relative of [
  'src/components/ui/section-header.tsx',
  'src/components/ui/action-icon-button.tsx',
  'src/components/ui/segmented-control.tsx',
]) {
  const source = read(relative);
  assert.doesNotMatch(source, /#[0-9a-fA-F]{6}\b/);
  assert.doesNotMatch(source, /fontWeight:/);
  assert.doesNotMatch(source, /<Modal\b/);
}
```

Run `node scripts/test/ui-foundation-contract.test.js` and expect a missing-file
failure.

- [ ] **Step 2: Create the canonical section header**

Create `src/components/ui/section-header.tsx` with the approved mutually exclusive contract:

```tsx
import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { tapped } from '@/lib/haptics';

type SectionHeaderTrailing =
  | { value: string; action?: never; trailing?: never }
  | { value?: never; action: { label: string; onPress: () => void }; trailing?: never }
  | { value?: never; action?: never; trailing: React.ReactNode }
  | { value?: never; action?: never; trailing?: never };

export type SectionHeaderProps = SectionHeaderTrailing & { title: string };

export function SectionHeader({ title, value, action, trailing }: SectionHeaderProps) {
  return (
    <View style={styles.row}>
      <ThemedText type="micro" themeColor="textTertiary" accessibilityRole="header" style={styles.title}>
        {title}
      </ThemedText>
      {value !== undefined ? <ThemedText type="micro" themeColor="textTertiary" tabular>{value}</ThemedText> : null}
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={() => { tapped(); action.onPress(); }}
          style={[styles.action, Platform.OS === 'android' && styles.androidAction]}>
          <ThemedText type="micro" themeColor="primary">{action.label}</ThemedText>
        </Pressable>
      ) : null}
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three, marginBottom: Spacing.two },
  title: { flexShrink: 1 },
  action: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  androidAction: { minWidth: 48, minHeight: 48 },
});
```

- [ ] **Step 3: Create the canonical action icon button**

Create `src/components/ui/action-icon-button.tsx`:

```tsx
import { Platform, Pressable, StyleSheet, type ViewStyle } from 'react-native';

import { Icon, type IconName } from '@/components/ui/icon';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { tapped } from '@/lib/haptics';

export type ActionIconButtonProps = {
  icon: IconName;
  label: string;
  onPress: () => void;
  variant?: 'plain' | 'bordered' | 'filled' | 'danger';
  disabled?: boolean;
};

export function ActionIconButton({ icon, label, onPress, variant = 'bordered', disabled }: ActionIconButtonProps) {
  const theme = useTheme();
  const surface: ViewStyle = variant === 'filled'
    ? { backgroundColor: theme.primary, borderColor: theme.primary }
    : variant === 'danger'
      ? { backgroundColor: theme.expenseSoftBg, borderColor: theme.expenseSoftBorder }
      : variant === 'plain'
        ? { backgroundColor: 'transparent', borderColor: 'transparent' }
        : { backgroundColor: theme.backgroundElement, borderColor: theme.controlBorder };
  const color = variant === 'filled' ? theme.onPrimary : variant === 'danger' ? theme.expense : theme.textSecondary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={() => { tapped(); onPress(); }}
      pressRetentionOffset={16}
      style={({ pressed }) => [
        styles.frame,
        Platform.OS === 'android' && styles.androidFrame,
        surface,
        { opacity: disabled ? 0.4 : pressed ? 0.72 : 1 },
      ]}>
      <Icon name={icon} size={17} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.full, borderWidth: 1 },
  androidFrame: { minWidth: 48, minHeight: 48 },
});
```

- [ ] **Step 4: Create the named segmented control**

Create `src/components/ui/segmented-control.tsx` using the current selected surface and no new dependency:

```tsx
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { tapped } from '@/lib/haptics';

export type Segment<T extends string> = { value: T; label: string; accessibilityHint?: string };
export type SegmentedControlProps<T extends string> = {
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
};

export function SegmentedControl<T extends string>({ segments, value, onChange, label }: SegmentedControlProps<T>) {
  const theme = useTheme();
  return (
    <View role="tablist" accessibilityLabel={label} style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
      {segments.map((segment) => {
        const active = segment.value === value;
        return (
          <Pressable
            key={segment.value}
            accessibilityRole="tab"
            accessibilityLabel={segment.label}
            accessibilityHint={segment.accessibilityHint}
            accessibilityState={{ selected: active }}
            onPress={() => { if (!active) tapped(); onChange(segment.value); }}
            style={[
              styles.segment,
              Platform.OS === 'android' && styles.androidSegment,
              active && { backgroundColor: theme.backgroundElement, borderColor: theme.cardBorder },
            ]}>
            <ThemedText type="nano" style={{ color: active ? theme.text : theme.textTertiary }}>{segment.label}</ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', padding: Spacing.one, borderRadius: Radius.control, gap: Spacing.one },
  segment: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.tile, borderWidth: 1, borderColor: 'transparent', paddingHorizontal: Spacing.two },
  androidSegment: { minHeight: 48 },
});
```

- [ ] **Step 5: Replace duplicate implementations with adapters**

In `layout.tsx`, keep the current export name but delegate:

```tsx
import { SectionHeader as CanonicalSectionHeader } from '@/components/ui/section-header';

/** @deprecated Import SectionHeader from ui/section-header. */
export function SectionHeader({ title, action, onAction, trailing }: {
  title: string; action?: string; onAction?: () => void; trailing?: React.ReactNode;
}) {
  if (action && onAction) {
    return <CanonicalSectionHeader title={title} action={{ label: action, onPress: onAction }} />;
  }
  if (trailing !== undefined) {
    return <CanonicalSectionHeader title={title} trailing={trailing} />;
  }
  return <CanonicalSectionHeader title={title} />;
}
```

In `period-pill.tsx`, delegate both legacy exports to the canonical components. Map `right` without a handler to `value`, and with a handler to `action`. Map `name` to `icon` for the action button.

In `controls.tsx`, remove the 34-point implementation. Re-export deprecated adapters named `Segmented` and `IconButton` that call `SegmentedControl` and `ActionIconButton`; do not accept a `size` prop.

- [ ] **Step 6: Name the Settings segment group**

At the existing appearance selector in `src/app/settings.tsx`, add:

```tsx
label={t('appearanceHeader')}
```

Do not reorder Settings in this task.

- [ ] **Step 7: Run focused checks**

```bash
node scripts/test/ui-foundation-contract.test.js
node scripts/test/accessibility-layout.test.js
npm run typecheck
npm run lint
```

Expected: canonical primitive assertions pass and the registered foundation
suite is green.

- [ ] **Step 8: Commit if authorized**

```bash
git add src/components/ui/section-header.tsx src/components/ui/action-icon-button.tsx src/components/ui/segmented-control.tsx src/components/ui/layout.tsx src/components/ui/period-pill.tsx src/components/ui/controls.tsx src/app/settings.tsx scripts/test/ui-foundation-contract.test.js
git commit -m "refactor: unify Wafra UI control contracts"
```

---

### Task 4: Add the accessible shared text field and prove it on AmountSheet

**Files:**
- Create: `src/components/ui/text-field.tsx`
- Modify: `src/components/ui/amount-sheet.tsx`
- Test: `scripts/test/ui-foundation-contract.test.js`
- Test: `scripts/test/routes.test.js`

**Interfaces:**
- Consumes: native `TextInputProps`, `ThemedText`, theme tokens, caller-owned validation/parsing.
- Produces: forwarded `TextInput` ref, visible label, helper/error association, mutually exclusive numeric/native keyboard contract.

- [ ] **Step 1: Add a failing AmountSheet contract assertion**

Add to the UI foundation test:

```js
assert.ok(exists('src/components/ui/text-field.tsx'));
const field = read('src/components/ui/text-field.tsx');
assert.match(field, /forwardRef<TextInput, TextFieldProps>/);
assert.match(field, /numeric: true; keyboardType\?: never; inputMode\?: never/);
assert.match(field, /errorText/);
assert.match(field, /accessibilityLiveRegion="polite"/);

const amountSheet = read('src/components/ui/amount-sheet.tsx');
assert.match(amountSheet, /<TextField/);
assert.doesNotMatch(amountSheet, /<TextInput/);
assert.match(amountSheet, /parseAmountToFils\(text\)/);
```

Run the test and expect failure because AmountSheet still renders `TextInput`.

- [ ] **Step 2: Create `TextField`**

Create the file with the exact union from the spec, `React.forwardRef<TextInput, TextFieldProps>`, a visible `ThemedText` label, and a native `TextInput`. Use `aria-invalid={invalid || !!errorText}` and include `errorText` in `accessibilityHint`. Render errors as:

```tsx
{errorText ? (
  <ThemedText type="meta" themeColor="expense" accessibilityLiveRegion="polite">
    {errorText}
  </ThemedText>
) : helperText ? (
  <ThemedText type="meta" themeColor="textTertiary">{helperText}</ThemedText>
) : null}
```

Use these field styles:

```ts
field: { gap: Spacing.one },
inputFrame: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: 1, borderRadius: Radius.control, paddingHorizontal: Spacing.three },
input: { flex: 1, minWidth: 0, paddingVertical: Spacing.two },
numeric: { fontFamily: Fonts.mono, fontVariant: ['tabular-nums'] },
```

Apply `{ color: theme.text, textAlign: language === 'ar' ? 'right' : 'left' }`
to the native input at render time. Choose `Fonts.mono` for numeric input,
`Fonts.arabic` for Arabic text input, and `Fonts.sans` for other text. With
`numeric: true`, use
`keyboardType="decimal-pad"`; otherwise pass the caller's explicit
`keyboardType`/`inputMode`.

- [ ] **Step 3: Migrate AmountSheet without moving validation**

Replace its direct `TextInput` with:

```tsx
<TextField
  ref={inputRef}
  label={placeholder}
  value={text}
  onChangeText={setText}
  numeric
  autoFocus
  onSubmitEditing={submit}
  returnKeyType="done"
/>
```

Add `useRef` to the React import and keep `TextInput` as a type-only React
Native import for `const inputRef = useRef<TextInput>(null);`. Keep
`parseAmountToFils`, `valid`, `submit`, `onClose`, and `onSubmit` unchanged, and
remove the obsolete local input style/theme/language imports.

- [ ] **Step 4: Run focused checks**

```bash
node scripts/test/ui-foundation-contract.test.js
node scripts/test/routes.test.js
npm run typecheck
```

Expected: TextField and AmountSheet assertions pass; existing goal/account amount flows retain their parser and confirmation behavior.

- [ ] **Step 5: Commit if authorized**

```bash
git add src/components/ui/text-field.tsx src/components/ui/amount-sheet.tsx scripts/test/ui-foundation-contract.test.js
git commit -m "feat: add an accessible Wafra text field"
```

---

### Task 5: Render SF Symbols on iOS with the existing SVG fallback

**Files:**
- Modify: `src/components/ui/icon.tsx`
- Modify: `scripts/test/contracts.test.js`

**Interfaces:**
- Consumes: existing `IconName`, SVG paths, language-aware directional mirroring, installed `expo-symbols`.
- Produces: total `Record<IconName, SFSymbol>` for iOS; existing SVG renderer for Android/web and any unavailable symbol.

- [ ] **Step 1: Update the icon completeness test to require both renderers**

Replace the first icon block in `scripts/test/contracts.test.js` so it still checks every SVG branch and also reads the mapping keys:

```js
const src = read('src/components/ui/icon.tsx');
const declared = quoted(src.match(/export type IconName =([\s\S]*?);/)[1]);
const drawn = new Set([...src.matchAll(/name === '([^']+)'/g)].map((m) => m[1]));
const mappingBody = src.match(/const SF_SYMBOLS: Record<IconName, SFSymbol> = \{([\s\S]*?)\n\};/)[1];
const mapped = new Set(
  [...mappingBody.matchAll(/(?:^|,)\s*(?:'([^']+)'|([A-Za-z][\w]*))\s*:/gm)]
    .map((m) => m[1] ?? m[2]),
);
ok('every icon name has an SVG fallback', declared.every((name) => drawn.has(name)));
ok('every icon name has an iOS symbol', declared.every((name) => mapped.has(name)),
  declared.filter((name) => !mapped.has(name)).join(' | '));
ok('the native symbol keeps the portable SVG fallback',
  /const fallback = <SvgIcon/.test(src) && /fallback=\{fallback\}/.test(src));
```

Run `node scripts/test/contracts.test.js`; expect failure because the mapping does not exist.

- [ ] **Step 2: Add the total mapping**

Import `SymbolView` and `SFSymbol` from `expo-symbols`. Add this exact map:

```ts
const SF_SYMBOLS: Record<IconName, SFSymbol> = {
  home: 'house', chart: 'chart.bar.xaxis', target: 'target', wallet: 'wallet.pass',
  plus: 'plus', search: 'magnifyingglass', trash: 'trash', close: 'xmark',
  'chevron-right': 'chevron.right', 'chevron-left': 'chevron.left', 'chevron-down': 'chevron.down',
  sliders: 'slider.horizontal.3', filter: 'line.3.horizontal.decrease',
  'arrow-up': 'arrow.up', 'arrow-down': 'arrow.down', 'arrow-up-right': 'arrow.up.right', 'arrow-down-right': 'arrow.down.right',
  spark: 'sparkles', check: 'checkmark', cart: 'cart', dining: 'fork.knife', car: 'car', bolt: 'bolt',
  phone: 'smartphone', bag: 'bag', heart: 'heart', cap: 'graduationcap', plane: 'airplane',
  play: 'play.circle', gift: 'gift', briefcase: 'briefcase', receipt: 'receipt', bank: 'building.columns',
  cash: 'banknote', mail: 'envelope', lock: 'lock', calendar: 'calendar', repeat: 'repeat',
  alert: 'exclamationmark.triangle', diamond: 'diamond', sun: 'sun.max', leaf: 'leaf', scissors: 'scissors',
  tools: 'wrench.and.screwdriver', code: 'chevron.left.forwardslash.chevron.right',
  trend: 'chart.line.uptrend.xyaxis', download: 'arrow.down.to.line', upload: 'arrow.up.to.line', fingerprint: 'touchid',
};
```

- [ ] **Step 3: Preserve the SVG body as `SvgIcon` and wrap it**

Rename `IconInner` to `SvgIcon` and keep its existing language-aware transform,
because `SymbolView` returns the fallback node directly on Android/web. Export a
memoized adapter that applies the same transform only to the native symbol:

```tsx
function IconInner(props: IconProps) {
  const language = useLanguage();
  const flip = language === 'ar' && DIRECTIONAL.has(props.name);
  const fallback = <SvgIcon {...props} />;
  return (
    <SymbolView
      name={{ ios: SF_SYMBOLS[props.name] }}
      fallback={fallback}
      size={props.size ?? 24}
      tintColor={props.color ?? '#fff'}
      weight={props.strokeWidth && props.strokeWidth >= 2 ? 'semibold' : 'regular'}
      style={flip ? { transform: [{ scaleX: -1 }] } : undefined}
    />
  );
}

export const Icon = React.memo(IconInner);
```

Keep every current SVG branch unchanged. This applies one mirror on either
renderer: `IconInner` mirrors a rendered native symbol, while `SvgIcon` mirrors
only when it is the rendered fallback.

- [ ] **Step 4: Run focused and type checks**

```bash
node scripts/test/contracts.test.js
node scripts/test/ui-foundation-contract.test.js
npm run typecheck
```

Expected: all declared names have both a native mapping and SVG fallback. On Android/web, `fallback` renders the existing Wafra shapes.

- [ ] **Step 5: Commit if authorized**

```bash
git add src/components/ui/icon.tsx scripts/test/contracts.test.js
git commit -m "feat: use SF Symbols with portable Wafra fallbacks"
```

---

### Task 6: Add the screen scaffold and header facade

**Files:**
- Create: `src/components/ui/screen-header.tsx`
- Create: `src/components/ui/screen-scaffold.tsx`
- Modify: `src/app/+not-found.tsx`
- Modify: `src/hooks/use-tab-bar-clearance.ts`
- Modify: `scripts/test/accessibility-layout.test.js`
- Modify: `scripts/test/ui-foundation-contract.test.js`

**Interfaces:**
- Consumes: safe-area insets, `MaxContentWidth`, `ScreenPadding`, tab clearance, route-owned back callbacks.
- Produces: one scroll/static/virtualized inset contract; inline and native-stack header renderers; first low-risk route adoption.

- [ ] **Step 1: Add failing scaffold assertions**

Insert immediately before its final summary `console.log` in `accessibility-layout.test.js`:

```js
const scaffold = source('src/components/ui/screen-scaffold.tsx');
const notFound = source('src/app/+not-found.tsx');
ok('screen scaffold owns safe area, width, and tab clearance',
  /useSafeAreaInsets/.test(scaffold) && /MaxContentWidth/.test(scaffold) && /useTabBarClearance/.test(scaffold));
ok('virtualized screens can consume the same insets without nested scrolling',
  /export function useScreenContentInsets/.test(scaffold) && /scrollIndicatorInsets/.test(scaffold) &&
    /virtualized/.test(scaffold));
ok('tabbed footer clearance is not dropped',
  /tabBarClearance \+ footerClearance/.test(scaffold));
ok('Not Found is the first scaffold adoption', /<ScreenScaffold/.test(notFound));
```

Run the test and expect missing-file failure.

- [ ] **Step 2: Create the header facade**

In `screen-header.tsx`, export the spec's `HeaderAction` and `ScreenHeaderProps`. Implement an inline renderer using `ActionIconButton`. Implement native mode with `Stack.Screen options={{ headerShown: true, title }}` and `headerLeft`/`headerRight`; every supplied back action calls `back.onPress` and the module must contain no `router.back()` call. Render only `actions.slice(0, 2)`.

For protected routes, callers pass `mode="inline"`; they retain their own `Stack.Screen options={{ gestureEnabled: false }}` and async leave function.

- [ ] **Step 3: Create the scaffold**

Implement the exact prop types from the approved spec. Derive mode as:

```ts
const resolvedHeaderMode = headerMode === 'auto'
  ? (tabbed ? 'inline' : 'native')
  : headerMode;
```

For `scroll={true}`, render a first-child `ScrollView` with `contentInsetAdjustmentBehavior="automatic"` in native-header mode, `refreshControl`, and a tokenized content container. For `scroll={false}`, render a `View` and expose `useScreenContentInsets()` for `FlatList`/`SectionList` callers. Add `virtualized?: boolean`; when true, the static wrapper must not apply the content insets because the child list owns the hook result. `virtualized` is valid only with `scroll={false}`. Wrap keyboard-aware content in `KeyboardAvoidingView` with iOS `behavior="padding"`; do not install a keyboard library in this plan.

`useScreenContentInsets()` always calls both safe-area and custom-clearance
hooks, then chooses one mutually exclusive bottom formula:

```ts
const insets = useSafeAreaInsets();
const tabBarClearance = useTabBarClearance();
const footerClearance = hasFooter ? 48 + Spacing.four : 0;
const bottom = tabbed
  ? tabBarClearance + footerClearance
  : insets.bottom + footerClearance + Spacing.four;
```

`useTabBarClearance()` already contains the custom tab bar's safe-area inset;
never add `insets.bottom` again in the tabbed branch. The hook must not call a
domain selector or router.

- [ ] **Step 4: Migrate Not Found only**

Replace its local SafeAreaView/width/padding shell with:

```tsx
<ScreenScaffold
  scroll={false}
  contentStyle={styles.body}>
  <View style={[styles.glyph, { borderColor: theme.cardBorderStrong }]}>
    <Icon name="search" size={22} color={theme.textTertiary} />
  </View>
  <ThemedText type="heading">{t('notFoundTitle', language)}</ThemedText>
  <ThemedText type="default" themeColor="textSecondary" style={styles.copy}>
    {t('notFoundBody', language)}
  </ThemedText>
  <View style={styles.actions}>
    <Button inline label={t('goHome', language)} onPress={() => router.replace('/')} />
    {router.canGoBack() ? (
      <Button inline variant="outline" label={t('back', language)} onPress={() => router.back()} />
    ) : null}
  </View>
</ScreenScaffold>
```

Keep `router.replace('/')` and conditional `router.canGoBack()` behavior unchanged. Do not migrate any protected setup/import route in this task.

- [ ] **Step 5: Run focused checks and E2E route recovery**

```bash
node scripts/test/ui-foundation-contract.test.js
node scripts/test/accessibility-layout.test.js
node scripts/test/routes.test.js
npm run typecheck
npm run test:e2e
```

Expected: Not Found still returns Home and all current routes remain reachable.

- [ ] **Step 6: Commit if authorized**

```bash
git add src/components/ui/screen-header.tsx src/components/ui/screen-scaffold.tsx src/app/+not-found.tsx src/hooks/use-tab-bar-clearance.ts scripts/test/accessibility-layout.test.js scripts/test/ui-foundation-contract.test.js
git commit -m "feat: add the shared Wafra screen scaffold"
```

---

### Task 7: Extend the one compatibility bottom sheet

**Files:**
- Modify: `src/components/ui/bottom-sheet.tsx`
- Modify: `src/components/ui/confirm-sheet.tsx`
- Modify: `scripts/test/ui-foundation-contract.test.js`
- Test: `scripts/test/accessibility-layout.test.js`
- Test: `scripts/test/routes.test.js`

**Interfaces:**
- Consumes: current modal/gesture/focus/keyboard implementation and semantic `theme.scrim`.
- Produces: compatibility `BottomSheetProps` with `footer`, `dismissible`, and `testID`; no system-route abstraction or domain records.

- [ ] **Step 1: Add the failing sheet contract**

Insert immediately before the final `console.log` in `ui-foundation-contract.test.js`:

```js
const finalSheet = read('src/components/ui/bottom-sheet.tsx');
assert.match(finalSheet, /dismissible: false; footer: React\.ReactElement/);
assert.match(finalSheet, /onRequestClose=\{requestImplicitDismiss\}/);
assert.match(finalSheet, /enabled\(dismissible && !reducedMotion\)/);
assert.match(finalSheet, /disabled=\{!dismissible\}/);
assert.match(finalSheet, /onAccessibilityEscape=\{dismissible \? requestDismiss : undefined\}/);
assert.match(finalSheet, /backgroundColor: theme\.scrim/);
```

Run the suite and expect failure on the new interface/implicit-dismissal
assertions.

- [ ] **Step 2: Add the approved props without changing defaults**

Use a union that requires a visible domain footer whenever implicit dismissal
is disabled:

```ts
type BottomSheetCommonProps = {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  testID?: string;
};

type BottomSheetProps = BottomSheetCommonProps & (
  | { dismissible?: true; footer?: React.ReactNode }
  | { dismissible: false; footer: React.ReactElement }
);
```

Default `dismissible = true`. Add `requestImplicitDismiss`, which calls
`requestDismiss` only when dismissible. Use it for `Modal.onRequestClose`.
Disable the backdrop Pressable and drag gesture when false, set
`onAccessibilityEscape` to undefined, and hide the shared Close button and
drag grabber. The required footer supplies the explicit localized domain
Cancel/Back action. Keep the Close frame at 44 points on iOS and add a 48-point
Android frame.

- [ ] **Step 3: Move fixed actions into a footer slot**

Render `footer` below the sheet's ScrollView with the same horizontal padding
and bottom safe-area/keyboard clearance. Do not place it inside the scrolling
content. Move that bottom padding from the sheet to the footer wrapper only
when a footer exists so it is never applied twice. Give the ScrollView
`flexShrink: 1` and `minHeight: 0` so the fixed footer remains reachable within
the 88% maximum sheet height. Add `testID` to the sheet container and retain
`accessibilityViewIsModal`.

- [ ] **Step 4: Use the semantic scrim**

Replace the literal `rgba(22, 19, 15, 0.42)` with:

```tsx
style={[styles.scrim, { backgroundColor: theme.scrim }, backdropStyle]}
```

Do not change the current gesture spring in this task; that behavior already has reduced-motion and cancellation recovery.

- [ ] **Step 5: Prove the footer on ConfirmSheet**

Move ConfirmSheet's action row to `footer={<View style={styles.actions}>…</View>}`. Keep its question/body in the scrolling children and preserve destructive/cancel semantics.

- [ ] **Step 6: Run focused checks**

```bash
node scripts/test/ui-foundation-contract.test.js
node scripts/test/accessibility-layout.test.js
node scripts/test/routes.test.js
npm run typecheck
npm run test:e2e
```

Expected: the contract suite is fully green; Bills/Wallet/detail sheets remain closable; confirmations still commit only through their drawn action.

- [ ] **Step 7: Commit if authorized**

```bash
git add src/components/ui/bottom-sheet.tsx src/components/ui/confirm-sheet.tsx scripts/test/ui-foundation-contract.test.js
git commit -m "feat: complete the shared bottom-sheet contract"
```

---

### Task 8: Run foundation verification and record the handoff

**Files:**
- Review only: every file changed in Tasks 1–7
- Reference: `docs/superpowers/specs/2026-09-04-ios-release-ui-polish-design.md`

**Interfaces:**
- Consumes: all foundation outputs.
- Produces: green compatibility baseline for the core-screen plan; no release build or submission.

- [ ] **Step 1: Run formatting/diff safety checks**

```bash
git diff --check -- \
  src/constants/theme.ts src/components/themed-text.tsx src/components/app-tabs-layout.tsx \
  src/components/tab-bar.tsx src/hooks/use-tab-bar-clearance.ts src/components/storage-recovery.tsx \
  src/components/ui/tab-bar-metrics.tsx src/components/ui/section-header.tsx \
  src/components/ui/action-icon-button.tsx src/components/ui/segmented-control.tsx \
  src/components/ui/text-field.tsx src/components/ui/screen-header.tsx \
  src/components/ui/screen-scaffold.tsx src/components/ui/layout.tsx \
  src/components/ui/period-pill.tsx src/components/ui/controls.tsx \
  src/components/ui/amount-sheet.tsx src/components/ui/icon.tsx \
  src/components/ui/bottom-sheet.tsx src/components/ui/confirm-sheet.tsx \
  src/app/+not-found.tsx src/app/settings.tsx \
  scripts/test/ui-foundation-contract.test.js scripts/test/accessibility-layout.test.js \
  scripts/test/contracts.test.js scripts/test/routes.test.js scripts/test/run.sh
```

Expected: no whitespace errors. Inspect the complete listed diff and confirm no domain calculation or active setup state was edited.

- [ ] **Step 2: Run focused suites serially**

```bash
node scripts/test/ui-foundation-contract.test.js
node scripts/test/accessibility-layout.test.js
node scripts/test/contracts.test.js
node scripts/test/perf-config.test.js
node scripts/test/routes.test.js
npm run typecheck
npm run lint
```

Expected: every command exits 0.

- [ ] **Step 3: Run repository and browser gates**

```bash
npm test
npm run test:e2e
```

Expected: `run.sh` reports 66 app suites, all server/native suites appropriate to the machine pass, and Playwright reaches every existing tab/route/sheet.

- [ ] **Step 4: Perform an independent read-only review**

The reviewer checks that adapters contain no duplicated rendering, protected routes were untouched, Wafra's warm tokens remain the source of truth, Android/web still render SVG icons, and no new sheet/modal contract exists.

- [ ] **Step 5: Commit the verified handoff if authorized**

```bash
git add \
  src/constants/theme.ts src/components/themed-text.tsx src/components/app-tabs-layout.tsx \
  src/components/tab-bar.tsx src/hooks/use-tab-bar-clearance.ts src/components/storage-recovery.tsx \
  src/components/ui/tab-bar-metrics.tsx src/components/ui/section-header.tsx \
  src/components/ui/action-icon-button.tsx src/components/ui/segmented-control.tsx \
  src/components/ui/text-field.tsx src/components/ui/screen-header.tsx \
  src/components/ui/screen-scaffold.tsx src/components/ui/layout.tsx \
  src/components/ui/period-pill.tsx src/components/ui/controls.tsx \
  src/components/ui/amount-sheet.tsx src/components/ui/icon.tsx \
  src/components/ui/bottom-sheet.tsx src/components/ui/confirm-sheet.tsx \
  src/app/+not-found.tsx src/app/settings.tsx \
  scripts/test/ui-foundation-contract.test.js scripts/test/accessibility-layout.test.js \
  scripts/test/contracts.test.js scripts/test/routes.test.js scripts/test/run.sh
git commit -m "feat: establish the iPhone release UI foundation"
```

Before staging, inspect every listed path for pre-existing unrelated hunks. If
Settings or another shared path still mixes the onboarding task's uncommitted
work, omit the aggregate commit and request a clean ownership handoff. Do not
build or upload a TestFlight candidate from this plan. The combined Shortcuts
release plan remains the sole release lane.
