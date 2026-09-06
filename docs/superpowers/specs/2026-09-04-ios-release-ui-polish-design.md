# iPhone release UI polish

**Status:** Approved; implementation is governed by the dated UI-polish plan suite.

## Summary

Polish Wafra for an iPhone release by making the existing product feel like one
calm, native financial ledger instead of a collection of individually styled
screens. The approved direction combines:

- [Option C — Ledger, refined](../../design-options/option-c.png) for dark mode;
- [Option E — Paper Statement](../../design-options/option-e.png) for light mode.

This is a UI-system and interaction pass. It does not change transaction
parsing, monetary calculations, dates, encryption, billing, Shortcuts, native
history import, or persisted ledger semantics. The separate
[one-page iPhone message onboarding specification](2026-09-03-ios-one-page-message-onboarding-design.md)
remains authoritative for the iOS setup flow.

This specification supersedes three older proposals in `docs/design-review.md`
for this release: Home keeps its existing net-after-spending projection instead
of inventing “safe to spend”; the one-page iPhone specification owns the
first-run sequence instead of deferring goals; and Bills keeps its existing
Subscriptions/Cards/Utilities domain groups instead of being reclassified into
Upcoming/Recurring. The older document remains authoritative for the overall
Ledger & Light principles and four-tab information architecture.

## Problem

Wafra already has a distinctive warm palette, bundled typefaces, accessible
contrast, reduced-motion support, and strong privacy language. The iPhone
experience nevertheless feels uneven because the same jobs are implemented in
different ways across screens:

- `SectionHeader` and `IconButton` each have two public contracts;
- the shared accessible bottom sheet and the limit editor use different sheet
  behavior;
- many screens recreate safe-area, width, padding, and header shells;
- fields, segments, radii, and spacing are frequently restyled locally;
- Bills contains nested press targets and actions available only through long
  press;
- iPhone setup and import screens repeat installation, progress, and review
  concepts;
- Settings mixes configuration, guidance, privacy, data, and destructive
  actions without a stable hierarchy;
- current release screenshots are not reliable proof of the shipping build;
  the audited simulator development client also lacked the keychain entitlement
  required to open Wafra's encrypted ledger.

The redesign must fix those inconsistencies without hiding product truth or
destabilizing release-critical data paths.

## Goals

1. Establish one coherent light/dark iPhone visual system using the existing
   warm Wafra identity.
2. Make the four main destinations immediately understandable: Home, Flow,
   Bills, and Wallet, while preserving their current financial projections.
3. Give every screen a predictable header, content width, spacing rhythm,
   field style, row behavior, and sheet behavior.
4. Make every primary task usable with VoiceOver, large Dynamic Type, Reduce
   Motion, Reduce Transparency, Arabic RTL, and one hand.
5. Reduce visual noise: fewer cards, less repeated explanatory copy, stronger
   hierarchy, and color reserved for meaning.
6. Produce trustworthy release evidence on a correctly entitled build and a
   physical iPhone.

## Non-goals

- No parser, category, amount, date, recurring-bill, or card-statement logic
  changes.
- No ledger schema, encryption, keychain, retention, or migration changes.
- No RevenueCat offering, entitlement, price, purchase, or restore changes.
- No native Shortcut, App Intent, history bridge, or Messages capability
  changes.
- No claim of worldwide ledger or bank-import coverage.
- No broad Android or web redesign. Shared primitives must preserve their
  current behavior there, and platform-specific iPhone polish must have an
  explicit fallback.
- No simultaneous migration to Expo Router Native Tabs. Native Tabs are beta
  in Expo SDK 55 and must remain a separate, reversible release stage.

## Product principles

### Ledger, not dashboard

The product should read like an authored ledger: a few exact figures, clear
period context, compact facts, and rows separated by hairlines. It should not
become a grid of generic cards or colorful analytics widgets.

### Paper in light mode, warm charcoal in dark mode

Light mode uses limestone paper and ink. Dark mode uses warm charcoal and warm
off-white, never pure black or cool gray. Both modes share hierarchy and
spacing; dark mode is not a separate neon design.

### One focal answer per screen

Each screen begins with the answer that motivated the visit. Supporting facts,
history, controls, and education follow in that order. Do not give every number
equal visual weight.

### Native where behavior matters

Use standard navigation, keyboard, accessibility, focus, and dismissal
behavior. Custom styling may express Wafra's identity, but it must not replace
expected iPhone interactions.

### Truth before persuasion

The UI must distinguish configured, confirmed, ready, verified, unavailable,
and failed states. It must not imply access to Messages, Shortcuts, a bank, a
subscription, or a supported market that Wafra has not actually verified.

## Information architecture

### Primary navigation

Keep four top-level tabs in this order:

1. **Home** — current-period net position, recent activity, and entry/import
   status.
2. **Flow** — period comparison, spending/income visualization, and category
   drivers.
3. **Bills** — subscriptions, card-statement dues, and the existing
   utilities/other recurring commitments group.
4. **Wallet** — accounts, cards, balances, statement amounts, and due dates.

Settings remains a header action, not a fifth tab. Add Transaction remains a
modal/contextual action from Home and Transactions, not a decorative center
tab.

### Secondary routes

- **Transactions** is the complete searchable ledger opened from Home.
- **Stats** remains the detailed continuation of Flow for this release. Preserve
  its route/deep links, label the entry as deeper analysis, and remove or
  relocate any summary that merely repeats the Flow landing screen. A route
  merge is outside this polish scope.
- **Cards** is a Wallet detail surface. Wallet owns discovery; Cards owns
  statement/account detail and actions.
- **Pro** is reachable from relevant locked capabilities and Settings, with the
  same purchase surface in every entry path.
- **iPhone setup** is the configuration hub for future alerts and past alerts.
- **Import** owns source selection when needed, processing, review, correction,
  and save. It does not repeat Shortcut installation instructions.

### Import taxonomy

Use these exact concepts consistently:

- **Future alerts** — selected-bank Apple automation feeding Wafra Local
  Capture.
- **Past alerts** — user-started Wafra History Import over retained Messages.
- **Manual entry** — one transaction entered by the user.
- **Paste or document import** — explicitly supplied content, reviewed before
  save.

Do not interchange “sync,” “scan,” “connect,” “history,” and “automatic” when
they refer to different capabilities.

## Visual system

### Color

Keep `src/constants/theme.ts` as the semantic source of truth:

- `background` is the page/paper layer;
- `backgroundElement` is a raised control or bounded interactive surface;
- `backgroundSelected` is selection/pressed state;
- `text`, `textSecondary`, and `textTertiary` define hierarchy;
- `primary` is the single brand/action accent;
- `income`, `expense`, and `warning` are meaningful text colors;
- `incomeGraphic`, `expenseGraphic`, and `warningGraphic` are data marks;
- `controlBorder` and `controlBorderHigh` make interaction boundaries visible;
- `cardBorder` and `cardBorderStrong` separate content.

Add named semantic tokens before introducing another literal color:

- `inverseSurface` and `inverseText` for intentionally inverted content;
- `scrim` for modal dimming;
- data-series tokens only when a chart genuinely needs more than the three
  existing meanings.

Category identity comes from its localized name and glyph. Do not assign a
rainbow of persistent category colors.

### Surfaces and grouping

- The screen background is the default content surface.
- Use hairline dividers for ledger rows and grouped settings.
- Use a bordered block only when the whole block is interactive, dismissible,
  selected, or represents one stateful object.
- Do not wrap a section in a card merely to create spacing.
- Floating elevation belongs only to the tab bar/navigation overlay and bottom
  sheets.
- A selected segment or chip may use a subtle surface change; it does not need
  a glow or large shadow.

### Typography and numbers

- Use the existing Geist faces for Latin text and Noto Kufi Arabic for Arabic.
- Use Geist Mono for money, counts, dates where tabular alignment matters, and
  chart axes.
- Use the named font-family weights; do not combine a custom font family with a
  synthetic `fontWeight`.
- Screen titles are sentence case. Section labels may use the existing compact
  micro style. Body copy should remain conversational and short.
- Currency, sign, separators, decimal precision, and RTL ordering continue to
  come from the existing formatting layer.
- Text may wrap and screens may scroll at large Dynamic Type. Never clip or
  shrink meaningful text to preserve a screenshot composition.

### Spacing, shape, and width

- Preserve the 4-point spacing ladder and the current `ScreenPadding` of 22.
- New code uses named spacing steps. If a recurring intermediate value is
  necessary, add a named token rather than spreading `Spacing.* +/- number`.
- Use semantic radii: chip, tile, control, sheet, tab bar, bottom sheet, full.
- Avoid literal radii in screens.
- Phone layouts fill the available width inside safe-area padding. Tablet/web
  behavior preserves `MaxContentWidth` without changing this iPhone scope.
- The final row/action must clear both the home indicator and tab bar.

### Icons and materials

- Extend the existing portable `Icon` abstraction with an explicit
  `IconName`-to-SF-Symbol mapping on supported iOS versions. The current
  hand-rolled SVG renderer remains the Android/web implementation and the iOS
  fallback when a mapped symbol is unavailable.
- Every standalone icon button has a localized accessibility label.
- Directional glyphs mirror exactly once in RTL.
- Liquid Glass, when available on iOS 26+, is limited to navigation and overlay
  chrome. Content rows, charts, fields, and ledger surfaces remain opaque.
- Glass is enabled only after the Expo SDK runtime availability check succeeds;
  an OS-version check alone is insufficient. If availability is false or the
  user enables Reduce Transparency, render the opaque warm surface.
- A custom glass surface renders only when both
  `isGlassEffectAPIAvailable()` and `isLiquidGlassAvailable()` return true and
  `AccessibilityInfo.isReduceTransparencyEnabled()` resolves false. Subscribe
  to `reduceTransparencyChanged` so a live setting change replaces glass with
  the opaque fallback. Contract tests cover every false/true combination and
  assert that `GlassView` is never mounted when any guard refuses it.
- Reduce Transparency and unsupported OS versions use the warm opaque surface,
  border, and elevation tokens. No feature depends on glass being present.

### Motion and haptics

- Motion explains hierarchy, selection, or dismissal; it is not decoration.
- Preserve the shared easing curve and transform/opacity-only rule.
- Section entrance runs once on eligible iOS screens and is disabled when
  Reduce Motion is enabled. It must not replay on tab switching.
- Bottom sheets follow the finger and settle without bounce.
- Haptics acknowledge a deliberate selection or completed action, not every
  scroll, focus, or passive state change.

## Component architecture

The UI system should expose one public component for each interaction contract.
Temporary compatibility aliases may exist during migration, but screens must
not gain new one-off variants.

### `ScreenScaffold`

Own safe areas, page background, content width, keyboard avoidance, scroll
behavior, tab clearance, and large-text fallback.

```ts
type ScreenScaffoldProps = {
  children: React.ReactNode;
  header?: ScreenHeaderProps;
  headerMode?: 'auto' | 'native' | 'inline';
  footer?: React.ReactNode;
  scroll?: boolean;
  virtualized?: boolean;
  scrollProps?: Omit<
    ScrollViewProps,
    | 'contentContainerStyle'
    | 'refreshControl'
    | 'contentInset'
    | 'scrollIndicatorInsets'
  >;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  keyboardAware?: boolean;
  tabbed?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
};

type ScreenContentInsets = {
  contentContainerStyle: StyleProp<ViewStyle>;
  contentInset: { top: number; bottom: number };
  scrollIndicatorInsets: { top: number; bottom: number };
};

function useScreenContentInsets(options: {
  tabbed?: boolean;
  hasFooter?: boolean;
}): ScreenContentInsets;
```

Rules:

- `scroll` defaults to `true` for pushed/task screens and `false` only for
  deliberately virtualized or custom-scrolling content.
- `headerMode="auto"` chooses the native stack header for pushed iOS routes and
  the inline renderer for tab roots; an override requires a screen-specific
  behavior or accessibility reason.
- The component, not each screen, applies safe-area and bottom clearance.
- Home/Wallet pull-to-refresh passes through `refreshControl`; the scaffold does
  not swallow refresh gestures or duplicate refresh state.
- A `FlatList`/`SectionList` screen renders with `scroll={false}`, sets
  `virtualized`, and consumes `useScreenContentInsets()`. The scaffold then
  leaves content/indicator insets to that child instead of applying them twice,
  while matching ordinary scroll screens without nesting scroll views.

The scaffold owns layout, not route safety. A protected screen keeps its own
`Stack.Screen` gesture policy, before-remove rule, and async leave/finalize
callback. Neither the scaffold nor the header may replace that callback with a
direct `router.back()`. In particular, history review must continue to disable
the interactive-back gesture while a protected native session exists, retain
the source when durable persistence or cleanup fails, and expose the existing
safe leave/retry path.

### `ScreenHeader`

Own the declarative title, optional subtitle, back affordance, period control,
and at most two trailing actions. This is a facade, not a mandate to render a
custom header inside every screen: pushed iOS screens configure the Expo Router
native stack header when the contract can be represented there. Tab roots and
screens whose content genuinely needs an in-page title use the shared fallback
renderer. Android/web keep their platform renderer.

```ts
type HeaderAction = {
  label: string;
  icon?: IconName;
  onPress: () => void;
  disabled?: boolean;
};

type ScreenHeaderProps = {
  title: string;
  subtitle?: string;
  back?: HeaderAction;
  leading?: React.ReactNode;
  actions?: HeaderAction[];
  largeTitle?: boolean;
};
```

The back action invokes the route-owned callback and uses the router/system
gesture contract; it never assumes that leaving is synchronous or always
allowed. Long titles and Arabic may wrap; trailing actions remain 44-by-44
points or larger.

Iconless actions render as text actions with the same minimum target rather
than receiving a fabricated icon. Native mode uses a custom title only for a
non-large subtitle; subtitle plus large-title content falls back to the inline
renderer so neither line is clipped.

### `SectionHeader`

Replace both current implementations with one contract:

```ts
type SectionHeaderTrailing =
  | { value: string; action?: never; trailing?: never }
  | { value?: never; action: { label: string; onPress: () => void }; trailing?: never }
  | { value?: never; action?: never; trailing: React.ReactNode }
  | { value?: never; action?: never; trailing?: never };

type SectionHeaderProps = SectionHeaderTrailing & {
  title: string;
};
```

The union makes `value`, `action`, and `trailing` mutually exclusive. An action
owns a 44-point target even when its visible label is compact.

### `ActionIconButton`

Replace both `IconButton` implementations with one minimum-target contract:

```ts
type ActionIconButtonProps = {
  icon: IconName;
  label: string;
  onPress: () => void;
  variant?: 'plain' | 'bordered' | 'filled' | 'danger';
  disabled?: boolean;
};
```

The visible glyph may be compact, but the interactive frame is always at least
44-by-44 points. Size is not a public escape hatch.

### `TextField`

Own labels, values, focus/error/disabled states, helper text, keyboard hints,
and font selection.

```ts
type TextFieldEntryMode =
  | { numeric: true; keyboardType?: never; inputMode?: never }
  | {
      numeric?: false;
      keyboardType?: TextInputProps['keyboardType'];
      inputMode?: TextInputProps['inputMode'];
    };

type TextFieldProps = Omit<
  TextInputProps,
  'value' | 'onChangeText' | 'keyboardType' | 'inputMode'
> & TextFieldEntryMode & {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  helperText?: string;
  errorText?: string;
  invalid?: boolean;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
};

const TextField: React.ForwardRefExoticComponent<
  TextFieldProps & React.RefAttributes<TextInput>
>;
```

Rules:

- A visible localized label is required; placeholder-only fields are not
  allowed.
- Error state uses icon/text plus boundary, never color alone.
- The forwarded native ref lets a form focus the first invalid field. Label,
  helper, and error text receive stable native IDs where supported; the spoken
  field description includes the active error, and a newly submitted error is
  announced without reading every field again.
- `numeric: true` selects the correct keyboard and mono/tabular face and cannot
  be combined with caller-supplied `keyboardType`/`inputMode`. Non-numeric
  fields may supply those native hints explicitly. The component does not parse
  or normalize money.
- Existing domain forms remain responsible for validation and submission.

### `SegmentedControl`

Rename the current `Segmented` contract for clarity and preserve generic values:

```ts
type Segment<T extends string> = {
  value: T;
  label: string;
  accessibilityHint?: string;
};

type SegmentedControlProps<T extends string> = {
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
};
```

It exposes a named group to assistive technology and selection state on every
segment. It may wrap or switch to an accessible picker when localized labels
cannot fit; labels are never truncated into ambiguity.

### Rows and blocks

`Row` has one primary press target. Secondary actions are presented in a detail
sheet, contextual menu, or explicit trailing control whose target does not nest
inside another pressable. Long press may provide a shortcut but never the only
way to discover or complete an action.

`Block` remains reserved for a whole tappable/stateful object. Static grouping
uses layout and dividers.

### `BottomSheet`

Treat `BottomSheet` as one presentation contract, not one required renderer.
On iOS, a task/detail surface uses an Expo Router/system sheet presentation when
its routing and detent behavior fit that model. The existing accessible shared
sheet remains the compatibility renderer for inline stateful details and for
Android/web. A screen must not create a third `Modal`/scrim/focus contract.

```ts
// Compatibility renderer only: inline state and Android/web fallback.
type BottomSheetCommonProps = {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  testID?: string;
};

type BottomSheetProps = BottomSheetCommonProps & (
  | { dismissible?: true; footer?: React.ReactNode }
  | { dismissible: false; footer: React.ReactElement }
);

// Native iOS system-sheet navigation: no children, closures, or domain objects
// cross the route boundary. The route resolves data from serializable IDs.
type SystemSheetRouteRequest<P extends Record<string, string>> = {
  pathname: string;
  params: P;
};
```

`BottomSheetProps` never represents a native route. A native sheet is a route
whose file owns `Stack.Screen` form-sheet presentation, detents, title,
dismissal policy, data loading, and guarded exit; callers navigate with a
`SystemSheetRouteRequest` containing only stable IDs/enums encoded as strings.

Whichever renderer is selected owns focus containment, accessibility escape,
close action, keyboard clearance, safe-area padding, reduced motion, and
content scrolling. The compatibility renderer also owns its scrim and drag
dismissal; the system route delegates those behaviors to iOS. A
non-dismissible transactional sheet still provides an explicit cancel/back
action and explains what must be completed. Presentation mechanism cannot
change save, cancel, or protected-cleanup semantics.

When compatibility dismissal is disabled, Android/modal back, backdrop, drag,
accessibility escape, the shared Close button, and the drag grabber are all
disabled or hidden together. A fixed footer stays outside the content scroller
and owns the sheet's safe-area/keyboard bottom clearance exactly once.

### Data visualization tokens

Charts consume semantic data-viz tokens rather than UI control colors. Every
chart provides:

- a localized title and selected period;
- an accessible textual summary of the trend and selected value;
- non-color differentiation for multiple series;
- a legible zero/axis/selection state in both themes;
- exact values through the existing money formatter.

## Screen specifications

### Onboarding

Use the existing Welcome → goals → starting-plan progression, then the approved
one-page iPhone message onboarding flow. At default text size, each decision
screen shows one title, a short explanation, the current choices, and one
primary action. Detailed privacy/platform limits live behind Learn More.

The final capture choice is honest and reversible. Starting manually does not
block later setup. Leaving for Shortcuts saves source-free progress and returns
to the same checklist step. This polish spec may align shell, type, spacing,
controls, and accessibility, but must not redefine the separate setup flow or
its verification semantics.

History import preserves its invocation origin. When setup/onboarding launches
it, successful save or safe cancel returns to the saved setup checklist and
does not mark onboarding complete. A standalone import returns to its invoking
screen, falling back to Home only when no safe origin exists. Protected-session
expiry or cleanup failure remains on the recovery surface until the existing
guard permits leaving. These route tests supersede older unconditional
“return Home” history instructions.

### Home

Order:

1. period control and Settings action;
2. one focal current-period answer from the existing dashboard projection:
   net after spending, expressed as ahead or behind;
3. income, spending, and upcoming commitments as three compact facts;
4. one quiet setup/import status row when action is required;
5. recent activity ledger rows;
6. View All and Add Transaction actions.

Avoid multiple bordered cards repeating the same total. The focal value and its
label must remain understandable when negative or unavailable. Do not introduce
a new “safe to spend” or budget-remaining calculation as part of visual polish;
that would require a separately specified and tested financial model. Empty
state offers Add Transaction, optional sample data when product rules allow it,
and import setup without implying Messages access.

### Flow

Order:

1. period selector and period-over-period comparison;
2. one primary chart;
3. an accessible text summary;
4. category drivers ordered by impact;
5. optional route to deeper Stats content.

Do not repeat the same spending total in multiple cards. Selecting a chart
point updates a visible textual value and accessibility state. Editing a
category limit opens the shared sheet and preserves existing calculations.

### Bills

Keep the current three labeled segments and their existing selectors:

- **Subscriptions** shows the existing `subs` results and their observed
  recurring charges;
- **Cards** shows the existing open/recently settled card-statement dues;
- **Utilities/other** shows the existing loans, commitments, other repeats, and
  reminder rows currently grouped by the `utilities` segment.

The polish may rename a localized display label only if its meaning remains
accurate, but it does not move an item between groups, merge counts, or change
classification. An Upcoming/Recurring reclassification requires a separate
domain specification because card dues and reminders may satisfy both labels.

Each row has one primary tap that opens bill details. Display in this order:

1. bill/merchant name and state;
2. amount;
3. due date or recurrence;
4. source account/card when known.

Mark Paid, Edit, and Delete belong in the detail sheet or a clearly discoverable
menu. No nested pressables and no long-press-only deletion. Destructive actions
require a confirmation that names the affected item. Adding/editing uses shared
fields, keyboard-safe scrolling, and a persistent reachable Save action.

### Wallet

Accounts and cards open on normal tap. Rows prioritize institution/name,
current balance, statement balance, and due date over decorative metadata.
Collapsed groups expose `expanded` state and localized expand/collapse actions
to assistive technology. Long press may mirror an existing menu but is never
required.

The Cards route becomes the detail view for statement history, limits, due
amounts, and payments. The UI must not recalculate or reinterpret card-payment
allocation.

### Transactions and Add Transaction

Transactions uses a stable search field, compact Filter/Sort actions, removable
active-filter chips, and Clear All. Result count and period remain visible
without crowding the title. Rows use the same merchant/category/amount/date
hierarchy as Home.

Add Transaction uses shared labeled fields and a keyboard-safe scaffold. Save
remains reachable at large text and on smaller phones. Validation appears next
to the relevant field and the first invalid field receives focus. Saving keeps
the existing atomic store behavior and duplicate protections.

### iPhone setup and Import

The iPhone setup screen is the single hub for Future Alerts and Past Alerts.
It owns Shortcut installation guidance, progress, capability state, and resume
behavior exactly as defined by the one-page onboarding specification.

Import owns the material the user has explicitly supplied:

1. processing/progress;
2. parsed-item review;
3. correction and duplicate decisions;
4. save result and cleanup/recovery status.

Do not repeat installation steps inside review. A saved transaction is visually
distinct from ready-to-review, ignored, duplicate, failed, and cleanup-pending
states. Failure copy says what remains private, what was saved, and the next
safe action.

The current dirty-tree onboarding implementation lands and is verified before
this separation is migrated. Preserve direct `?history=` handoff/recovery entry
and its protected-session guard; removing duplicate installation UI must not
make an in-progress native history session unreachable.

### Settings

Keep the current Pro/subscription status summary at the top, then use grouped
ledger rows in this order:

1. **Money** — ledger market/currency, report period, and existing financial
   preferences;
2. **Imports** — future-alert capture state, past-alert progress/recovery, and
   supported source settings;
3. **Notifications** — current bill/payment reminders, digest controls, and
   schedules; no notification toggle is absorbed into Privacy;
4. **Appearance & language** — theme, language preference, country/region, and
   parser-pack display without changing parser coverage;
5. **Privacy** — privacy policy, capability disclosures, permissions, and
   local-processing explanations;
6. **Data** — export and sample/demo data where applicable;
7. **Support** — help/feedback, terms, app version/build, and subscription
   management;
8. **Danger zone** — protected destructive reset/erase actions, visually
   separated last.

Rows show concise current state as a value. Detailed instructions open a task
screen or sheet. Privacy and Terms remain available to free and subscribed
users. Language changes refresh direction and navigation behavior reliably;
the UI must not claim the RTL change is complete when a relaunch is still
required by the current router.

### Pro

Show the active RevenueCat Offering and storefront-localized price. Present one
selected plan and one primary Purchase action. Restore, manage/cancel, Privacy,
and Terms remain visible. Loading, unavailable offering, purchasing, success,
cancel, and failure states are explicit. VoiceOver receives a polite status
announcement. Ledger currency is never substituted for storefront currency.

### Empty, loading, error, and recovery states

Every asynchronous/task screen defines:

- initial loading without layout jumps;
- empty state with one best next action;
- recoverable inline error with Retry;
- blocking error with a safe route back;
- partial success that identifies what completed and what did not;
- offline state where relevant;
- protected-data/keychain failure that never offers destructive recovery as
  the first action.

Errors use plain localized language, preserve entered data where safe, and do
not mark a task complete.

## Accessibility and localization contract

- Every interactive target is at least 44 by 44 points on iOS.
- Normal text meets at least 4.5:1 contrast. Large text (18pt regular or 14pt
  bold and above) and meaningful non-text boundaries/graphics meet at least
  3:1. Disabled decoration is not used to communicate required state.
- Every screen has one logical accessibility reading order.
- Icon-only actions have localized labels; ambiguous actions include hints.
- Selected, expanded, checked, disabled, busy, and invalid states are exposed.
- A row never contains an inaccessible nested button hierarchy.
- A long press is optional acceleration only.
- VoiceOver can dismiss sheets with the Close action and accessibility escape.
- Focus moves to a new screen title, validation error, confirmation, or
  meaningful result as appropriate; it does not jump on passive rerenders.
- Dynamic Type supports the largest accessibility sizes by wrapping and
  scrolling. Financial values remain readable and associated with their labels.
- Audit the central `ThemedText` 1.5–2x multipliers during foundation work.
  Body, label, control, and task text may not be globally capped below the
  largest accessibility sizes. A genuinely decorative oversized numeral may
  use a documented visual cap only when the same full value/meaning is exposed
  as nearby scalable text and as its accessibility label; reflow is preferred.
- English and Arabic layouts use logical start/end properties. Directional
  icons mirror once; numbers and currency preserve locale-correct ordering.
- Reduce Motion removes nonessential entrances and replaces animated state
  changes with immediate updates.
- Reduce Transparency uses opaque surfaces with sufficient contrast.
- Charts and color-coded states have text/icon/pattern equivalents.
- Keyboard focus, return keys, dismissal, and sheet clearance are verified with
  numeric and text keyboards.

## Data and behavior preservation

The polished UI reads existing selectors and invokes existing domain actions.
It may reorganize presentation code, but it must not duplicate business logic.

Specifically:

- amounts use current integer/minor-unit and formatter behavior;
- period boundaries and dates use current domain helpers;
- category and recurring classification remain parser/store responsibilities;
- card due, minimum due, statement balance, and payment allocation remain the
  existing card-ledger responsibility;
- import review remains the admission boundary before transactions are saved;
- RevenueCat remains the subscription source of truth;
- native capture/history modules remain the capability source of truth;
- encryption and keychain errors remain security states, not styling states.

Snapshot/selector tests must prove that presentation migration does not alter
the inputs or commands for these paths.

## Migration sequence

Each stage is independently testable and reversible. Do not mix stages with
parser, billing, encryption, or native-import feature work.

### Stage 0 — Active iOS handoff and ownership freeze

- Finish and verify the active one-page iPhone onboarding/Shortcut work before
  editing its setup/import surfaces or any shared primitive it consumes.
- Record its final route-return, protected-session, and ready-versus-verified
  tests as the compatibility baseline for polish.
- Preserve the direct history handoff/recovery route and reconcile older
  unconditional Home-return documentation to the origin-aware behavior in this
  specification.
- The combined Shortcuts release plan remains the sole owner of production
  release files, deployment, EAS build, and TestFlight submission. UI polish
  supplies a reviewed candidate state to that owner and does not create a
  second build/upload lane.

### Stage 1 — Foundation and compatibility

- Add missing semantic color/data-viz tokens with light/dark contract tests.
- Introduce `ScreenScaffold` and the final header/action interfaces.
- Consolidate `SectionHeader` and `IconButton` behind compatibility aliases.
- Rename/consolidate the segmented control without changing callers' values.
- Add shared `TextField` states and accessibility tests.
- Add the iOS symbol mapping while retaining and regression-testing SVG
  fallbacks.
- Define the sheet facade and extend the compatibility `BottomSheet` only after
  Stage 0's consumers are stable.
- Remove unjustified central Dynamic Type caps and document any narrow
  decorative-number exception with an equivalent accessible value.
- Add lint/static checks that discourage new literal radii, synthetic custom
  font weights, and screen-local sheet implementations.

### Stage 2 — Interaction safety

- Remove Bills nested pressables and long-press-only actions.
- Make Wallet rows and collapse controls discoverable on normal tap.
- Verify all standalone controls meet the 44-point target.
- Add shared confirmation and status-announcement behavior.

### Stage 3 — Setup/import information architecture

- Apply the shared shell and controls without changing its state machine.
- Keep installation/progress in iPhone setup and review/save in Import.
- Preserve origin-aware return, `?history=` recovery, gesture guards, durable
  save, and protected cleanup while removing duplicated installation copy.
- Verify resume, failure, and cleanup states on a correctly entitled build.

### Stage 4 — Core screen hierarchy

- Migrate Home, Transactions/Add, Flow/Stats, Bills, Wallet/Cards, Settings,
  and Pro to the shared shell one screen family at a time.
- Migrate or explicitly verify the remaining user-facing routes: Accuracy,
  Categorise, Currency, Feedback, Review Alerts, iPhone Setup, Import, and Not
  Found. `parser-research` and `trusted-devices` must either receive the shared
  shell if production-reachable or remain behind a tested non-production/
  capability gate.
- Replace decorative cards with dividers or blocks according to the surface
  rules.
- Preserve existing routes and deep links during this stage.

### Stage 5 — Limit sheet convergence

- Migrate the limit editor to the shared BottomSheet only after the base sheet,
  keyboard, accessibility, and form contracts are proven.
- Remove the second modal/scrim/dismissal implementation after parity tests.

### Stage 6 — Native navigation evaluation

- Evaluate Expo Router Native Tabs in an isolated change after core screens are
  visually stable.
- Verify tab state, deep links, safe areas, accessibility, RTL, screenshots,
  and Android fallback.
- Keep the current custom tab bar if the SDK 55 beta introduces a release risk.
  The visual polish does not depend on this migration.

### Stage 7 — Release evidence

- Hand the reviewed candidate Git state to the single release owner named in
  Stage 0. Record its exact commit SHA, app version/build, configuration, and
  artifact identifiers; this polish task does not upload an independent build.
- From a clean candidate checkout with Node 22, preserve full output for
  `npm ci`, server install, Expo dependency/doctor checks, `npm run check`,
  `npm run test:e2e`, production-environment `npm run release:check`, public
  config inspection, and native config introspection. Apply the remaining audit
  and server gates from `docs/launch-readiness.md` before the release owner
  invokes the one authorized EAS build/submission lane.
- Use a Release/production-equivalent binary with correct keychain and native
  entitlements; a development client that cannot open the encrypted ledger is
  not visual or device evidence.
- Run the acceptance matrix on simulator and physical iPhone.
- Capture fresh English first, then Arabic, in both appearance modes as needed
  for review/store assets.
- Update store copy, screenshots, support/privacy links, territory claims, and
  launch documentation so they describe the same shipped build.

## Release acceptance matrix

At minimum, verify these scenarios on an iPhone-sized 402-by-874-point viewport
and one smaller supported iPhone size:

| Dimension | Required coverage |
| --- | --- |
| iOS capability level | iOS 15.1 manual fallback; iOS 16–25 future-alert path without iOS 26 history; iOS 26+ history path |
| Appearance | Light and dark |
| Language | English LTR and Arabic RTL |
| Text size | Default and largest accessibility Dynamic Type |
| Assistive tech | VoiceOver reading order, actions, focus, announcements |
| Motion | Standard and Reduce Motion |
| Transparency | Standard and Reduce Transparency |
| Input | Text/numeric keyboard, validation, dismissal, sheet clearance |
| Data state | Loading, empty, populated, negative/over-limit, error, recovery |
| Navigation | All four tabs, pushed routes, modal entry, back gesture, deep link |
| Onboarding | Manual start, finish later, future alerts, past alerts, missing Shortcuts/native action, unrepresentable sender, resume |
| Capture state | User-confirmed install; harmless-proof ready; waiting for alert; real-bank-alert verified; unavailable; failed |
| Import | Processing, review, duplicate, origin-aware save/cancel return, partial failure, protected cleanup |
| Upgrade | Existing-user relay/setup state, controlled dual-run/retirement UI, retry, and legacy automation guidance without data loss |
| Money | AED and SAR launch-tested formatting and date behavior |
| Subscription | Offering, purchase cancel/success/failure, restore, manage |
| Data safety | Encrypted-ledger open, lock/reboot, protected erase confirmation |

The physical-iPhone release run must include fresh install, onboarding, manual
transaction, edit/delete confirmation, bill flow, card detail, future-alert
setup where supported, past-alert import, lock/reboot, language switch, and
protected erase. A separate controlled existing-user fixture covers relay/setup
migration, retry, and legacy-automation cleanup. A simulator screenshot is not
evidence for Shortcuts, Messages, keychain-after-reboot, or physical-device
accessibility behavior.

The iOS 15.1 row proves a usable manual path without claiming future capture.
The iOS 16–25 row proves the available future-alert path and an honest
history-unavailable fallback. The iOS 26+ row proves history only where its
native action is actually present. Runtime capability state wins over the OS
number on every row.

Because the foundation components are shared, every stage also passes this
preservation gate before it can be called iPhone-complete:

| Surface | Required preservation coverage |
| --- | --- |
| Android | 48dp targets, TalkBack order/actions, Arabic RTL, keyboard-safe sheet fallback, four-tab and primary-task smoke tests |
| Web | Typecheck/render smoke, keyboard focus, logical direction, and no nested-scroll or width regression |

These checks preserve existing platforms; they do not expand this project into
an Android/web visual redesign.

## Visual acceptance

- The focal answer on Home is identifiable within one glance.
- Each core screen has one dominant title/value hierarchy and no duplicated
  summary cards.
- Rows align to one amount/date grid and use consistent dividers.
- All field, segment, chip, button, header, and sheet states match across
  screens.
- Light mode reads as warm paper, not white cards on gray.
- Dark mode reads as warm charcoal, not black glass or green neon.
- Color is limited to brand/action and semantic financial states.
- No clipped text, overlapping actions, hidden keyboard controls, unsafe-area
  collisions, or tab-bar-covered final rows appear in the acceptance matrix.
- Arabic is composed intentionally rather than visually mirroring screenshots.

## Documentation and release truth

Before submission, reconcile the UI and launch documents:

- replace placeholder Privacy, Terms, support, billing, and production values;
- make App Store encryption answers match Wafra's actual encrypted local ledger
  and export behavior;
- state launch-tested UAE/Saudi ledger behavior separately from worldwide
  storefront availability;
- remove or recapture screenshots that fail the current store gate;
- describe future alerts and past alerts with the same capability boundaries as
  the app;
- do not use an old public/TestFlight build as evidence for the polished flow.

These are release blockers, not visual copy polish.

## Rollback strategy

- Land shared primitives with compatibility adapters, then migrate one screen
  family at a time.
- Keep route names, store commands, selectors, and domain modules stable.
- Maintain per-stage screenshot and interaction baselines.
- If a migrated screen regresses data behavior or accessibility, revert that
  screen to the compatibility primitive without undoing unrelated stages.
- Native Tabs and Liquid Glass remain optional layers; disabling them restores
  opaque shared chrome without changing content or routing semantics.
- Do not remove legacy component exports until all callers and tests have
  migrated and release QA has passed.

## Verification strategy

1. Component contract tests for tokens, states, labels, target sizes, reduced
   motion, and RTL behavior.
2. Focused screen tests proving existing selectors/actions and navigation
   inputs are unchanged.
3. Screenshot comparison in light/dark English/Arabic at default and large
   text, with human review for hierarchy rather than pixel-only approval.
4. VoiceOver walkthrough of every primary task and error/recovery path.
5. Release-build simulator pass using correct entitlements.
6. Physical-iPhone pass for Shortcuts, Messages handoff, lock/reboot, keyboard,
   gestures, appearance, accessibility, and controlled existing-user upgrade.
7. Repository and release gates from `docs/launch-readiness.md`, including
   `npm run check`, `npm run test:e2e`, and `npm run release:check` inside the
   production environment used for the candidate build.
8. Final store-asset and documentation review against the exact submitted
   build number.

## Authoritative references

- Existing system: `src/constants/theme.ts`, `src/components/ui/layout.tsx`,
  `src/components/ui/controls.tsx`, `src/components/ui/period-pill.tsx`, and
  `src/components/ui/bottom-sheet.tsx`.
- Product direction: `docs/design-review.md` except for the explicit
  supersessions in this specification's Summary, plus the approved Option C/E
  images.
- iPhone setup: the one-page message onboarding specification linked above.
- Release ownership and the single-build lane:
  `docs/superpowers/plans/2026-08-25-ios-shortcuts-release.md`. Its superseded
  Any Sender/empty-message-filter instructions are not authoritative; the
  one-page message onboarding specification owns the corrected selected-sender
  flow.
- Release command/gate contract: `docs/launch-readiness.md`.
- Expo SDK 55 Native Tabs:
  <https://docs.expo.dev/versions/v55.0.0/sdk/router/native-tabs/>.
- Expo SDK 55 Glass Effect:
  <https://docs.expo.dev/versions/v55.0.0/sdk/glass-effect/>.
- Expo SDK 55 safe-area context:
  <https://docs.expo.dev/versions/v55.0.0/sdk/safe-area-context/>.
- Apple materials guidance:
  <https://developer.apple.com/design/human-interface-guidelines/materials>.

## Approval gate

After this specification is reviewed and approved, write a separate executable
implementation plan with exact files, test-first steps, verification commands,
stage boundaries, and rollback points. Do not begin the visual rewrite from
this document alone.
