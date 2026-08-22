# Wafra full-app audit — 22 August 2026

## Outcome

Wafra's accounting, privacy, encrypted persistence, parser safety, and normal-size
core UI are in substantially better shape than the first-run experience suggests.
The highest-value work is not a broad visual redesign or more speculative parser
regular expressions. It is:

1. let people enter Home before Android's first history scan finishes;
2. make that scan resumable and honest about foreground/background behavior;
3. repair layouts at accessibility text sizes across every main tab;
4. give Bills and Wallet modals the same accessibility contract as the shared
   bottom-sheet components; and
5. make the starter plan real for every supported ledger currency, not only AED
   and SAR.

There is no evidence-backed P0 data-loss or security defect in the current tree.
The complete automated suite passes.

## Evidence reviewed

- Current source and repository diff on `codex/universal-parser-adversarial-tests`.
- Native iOS walkthrough in English, Arabic/RTL, light/dark mode, normal text,
  and `accessibility-extra-extra-extra-large` text.
- Browser keyboard and accessibility-tree walkthrough of primary and QA routes.
- Web smoke, navigation, period, and persistence suites.
- Existing Android Release tab-switch measurements documented beside the tab
  navigator.
- Parser, corpus, storage, relay, privacy, release, web SEO, and native Swift
  tests.
- Ordinary feedback delivery and the parser-sample local-file export on native
  iOS, including a live synthetic transport receipt containing no user ledger.

Latest complete automated result:

```text
58 app suites + 3 server suites + 1 native Swift suite
all passed
```

The bank-alert semantic mutation matrix alone passed 3,487 checks over 1,144
mutated alerts. Green tests are evidence of the protected behaviors they cover;
they do not prove the UX findings below are absent.

## Prioritized findings

### P1 — onboarding blocks on the entire Android inbox

`OnboardingGate.startScan` awaits permission, the complete `scanInbox(0)` result,
review persistence, full import persistence, and cursor commit before it reaches
the completion screen. `scanInbox` pages the provider but accumulates parsed rows
in memory and returns only at the end. A large inbox therefore turns onboarding
into a long progress screen with no usable Home underneath it.

The current foreground hook correctly rescans when the app becomes active, but
it cannot make JavaScript continue reliably after the user leaves or force-quits
the app. Expo BackgroundTask is deferrable and system-scheduled; it is not a
continuous first-import engine.

Recommended design:

- permission success completes onboarding immediately and opens Home;
- a dedicated import coordinator owns `idle`, `running`, `paused`, `failed`, and
  `complete` states outside the onboarding component;
- process history in bounded pages;
- durably stage/import each page before advancing its history cursor;
- show progress and retry controls in a compact Home status card and Settings;
- checkpoint when the app backgrounds and say “Paused — continues when you
  return”; and
- keep the live-alert watermark separate from the historical-import cursor.

Acceptance evidence:

- Home becomes interactive immediately after permission;
- killing/relaunching during page N resumes without duplicate or missing rows;
- backgrounding never claims work is still running when it is paused;
- raw SMS is never persisted by the coordinator;
- parser-version reread is marked complete only after the real end of history;
- focused native tests cover interruption after provider read, review staging,
  ledger persistence, and cursor commit.

### P1 — largest Dynamic Type makes every primary tab unusable

At `accessibility-extra-extra-extra-large`, Home, Flow, Bills, Wallet, and
Settings have clipped or overlapping amounts, headings, cards, controls, and tab
labels. The text components scale, but fixed horizontal rails, fixed-height
cards, one-line labels, and dense hero layouts do not adapt.

Recommended design:

- use `fontScale`/available width to switch summary rails from columns to a
  vertical list;
- allow cards and primary buttons to grow instead of assuming one line;
- reduce nonessential hero density at high text sizes while keeping every value
  available;
- give charts a textual summary before the visual plot;
- adapt or cap bottom-tab labels while preserving an accessible full label; and
- add native screenshot/layout assertions at normal and every accessibility text
  category.

Screen-specific consequences:

- **Home:** stack the monthly figures and let recent rows wrap.
- **Flow:** replace the compressed summary rail and prevent figures from being
  broken into character fragments.
- **Bills:** allow the header/add control and segmented counts to reflow.
- **Wallet:** collapse the oversized hero into a compact list before cards crop.
- **Settings:** replace dense two-column status tiles with one-column rows.

### P1 — Bills and Wallet custom modals expose broken screen-reader controls

The shared `BottomSheet` already hides its backdrop/sheet wrappers from the
accessibility tree, supports escape, labels Close, and treats the sheet as modal.
Several Bills and Wallet dialogs reimplement this using nested `Pressable`
wrappers. On web, those wrappers become giant duplicate controls containing all
child text. Bills also has an unnamed Close control and placeholder-only inputs.
Wallet's kind, color, and icon choices do not consistently expose role and
selected state.

Recommended design:

- migrate these dialogs to the shared `BottomSheet` and shared controls;
- add persistent visible labels for every input;
- label Close, color, icon, and add controls;
- expose radio/tab role and selected state for all choice groups; and
- restore focus to the opener after dismissing.

### P1 — worldwide users can choose a starter plan that never activates

The visible onboarding example is now generic (“Income received”, “Upcoming
bill”, “Card repayment”), which resolves the earlier country-brand problem.
However, the deferred starter budgets and goals activate only when the confirmed
ledger currency is AED or SAR. Wafra supports many ISO currencies for manual
ledgers, so a USD, EUR, GBP, INR, or other supported user can finish the goal and
budget questions and receive no actual starter plan.

Recommended design:

- keep examples generic and currency-free;
- create starter budgets as editable proportions of the user's stated monthly
  income, or ask for explicit amounts after currency is known;
- create goal templates without inventing a target amount, then let the user
  set it in their real currency; and
- never present a choice as saved if it will remain pending indefinitely.

### P2 — tab semantics do not survive consistently to web/native output

The tab buttons correctly request `accessibilityRole="tab"` and selected state
in React Native source. In rendered web DOM, the buttons had no `aria-selected`;
the tab container also has no tab-list semantic. Native inspection likewise did
not expose a useful selected value in the sampled tree.

Recommended design:

- add a tab-list semantic to the container;
- provide explicit platform-selected semantics where the adapter drops the
  React Native state;
- assert selected state in web DOM and native accessibility-tree tests; and
- preserve the existing 48-point targets and haptic behavior.

### P2 — launch performance is not instrumented

The native splash hides when fonts are ready, before encrypted hydration
finishes. `OnboardingGate` then owns a second branded “Loading your ledger”
surface. This is safe and avoids rendering fake zero balances, but the app has no
release-build timing around native launch, font readiness, database open,
snapshot parse/migration, first usable Home, or first import page.

Recommended design:

- add privacy-safe local timing marks with no amounts, merchants, message text,
  or device identifier;
- benchmark empty, 1k, 5k, and 10k-row encrypted ledgers on iOS and Android
  Release builds;
- decide from evidence whether to hold the native splash through fast hydration
  or keep the current two-stage surface for slower/failure cases; and
- track p50/p90 “tap to usable Home”, not only bundle load.

Do not optimize by disabling inactive-screen detachment. Existing Android
Release A/B evidence shows that change made tab switching 3–7× slower and added
about 22.7 MB PSS.

### P2 — Settings mixes too many jobs in one long screen

Settings combines capture, permissions, notifications, appearance, language,
security, imports, trusted devices, feedback, diagnostics, Pro, and destructive
data operations in one component. The screen is functional but hard to scan and
its large file size makes changes risky.

Recommended information architecture:

- Capture & permissions
- Privacy & security
- Data, imports & exports
- Appearance & language
- Help, feedback & diagnostics
- About & subscription

Keep destructive actions in a visually separate final section.

### P2 — parser improvement should remain corpus-driven

The parser has deep positive, negative, mutation, accounting, and privacy
coverage. The remaining valuable input is real, redacted format evidence from
unsupported alerts. Broad speculative regular expressions would increase
false-positive financial entries.

Recommended loop:

- keep the parser-sample flow file-only and user-initiated;
- make the export destination explicit in UI: Wafra uploads nothing, the user
  chooses Save/Share and attaches the JSON to a Codex task;
- prioritize repeated unknown templates by frequency and money-bearing evidence;
- add every accepted format with a matching non-posting/decoy test; and
- report coverage by country, bank, language, and event family rather than one
  misleading global percentage.

### P2 — shared visual/semantic primitives are not used consistently

The main tabs look cohesive at normal text size, but large screen components
still contain many raw font sizes, radii, spacings, one-line assumptions, and
custom shadows. This increases theme drift and makes accessibility fixes repeat
across screens.

Recommended direction:

- split large screens into domain sections without redesigning their normal
  appearance;
- move new work through shared `ScreenHeader`, `SectionHeader`, `BottomSheet`,
  controls, and theme tokens;
- give screen and section titles heading semantics without creating excessive
  rotor noise;
- add dedicated control/input border tokens that reach 3:1 against their
  background while keeping decorative dividers subtle; and
- support increased-contrast preference in addition to reduced motion.

### P2 — public product screenshots still imply one-country usage

The in-app onboarding preview is now correctly generic, but the public product
screenshots still visibly use AED and UAE-specific merchant/service examples.
That conflicts with the landing page's truthful worldwide manual-tracking
positioning even though the surrounding copy carefully limits automatic-import
claims. The Stats screenshot is also stored as `wafra-app-bills.png`, which makes
the asset contract misleading even though its landing-page alt text is accurate.

Recommended direction: generate a dedicated neutral demo ledger for public and
onboarding imagery, using generic merchants such as “Groceries”, “Monthly bill”,
and “Salary”, while letting the UI format amounts from a clearly labelled sample
currency. Do not reuse a founder or country-specific test ledger as marketing
evidence.

### P3 — navigation E2E has one animation-sensitive helper

One full navigation run failed a Back assertion and a tab-stability wait; an
unchanged rerun passed all 61 navigation checks. The product bug did not
reproduce. The helper waits for Playwright's “stable” locator state on an
animated tab while other interactions use hit-tested coordinates.

Recommended action: make the helper use the same hit-tested activation path and
assert the final route/selected tab. This is test-harness hardening, not a reason
to change tab animation.

## Areas that are currently healthy

- Encrypted persistence distinguishes an empty store from a failed read, blocks
  writes after hydration failure, serializes SQLCipher writes, and has explicit
  recovery/erase states.
- Parser output uses integer minor units and has strong accounting/deduplication
  invariants.
- Android raw SMS stays on-device; iOS relay raw text is discarded before
  structured rows are sealed.
- Ordinary feedback is confirmation-gated, digit-masked, contains no ledger,
  and has bounded retention. Parser research is a separate local JSON export.
- Normal-size Home, Flow, Bills, and Wallet have a coherent hierarchy and should
  be evolved, not broadly replaced.
- Text and icon color pairs audited at normal contrast pass AA; the weakness is
  low-contrast interactive boundaries, not primary copy.

## Recommended implementation sequence

### Phase 1 — first-run trust and accessibility

1. Resumable paged initial import that opens Home immediately.
2. Worldwide starter-plan behavior that always produces an honest result.
3. Dynamic Type responsive layouts across the four tabs and Settings.
4. Bills/Wallet modal migration and tab/heading semantics.
5. Native interruption, Dynamic Type, and accessibility-tree tests.

### Phase 2 — maintainability and measured speed

1. Split onboarding, Settings, Bills, and Wallet into focused sections.
2. Add release-build launch instrumentation and benchmark fixtures.
3. Strengthen control-border/high-contrast theme tokens.
4. Harden the animation-sensitive navigation helper.

### Phase 3 — evidence-led parser expansion

1. Collect local redacted reports from unsupported real formats.
2. Add conservative parser rules and paired adversarial negatives.
3. Publish capability coverage by format family without claiming worldwide bank
   support.

## Implementation status

Phases 1 and 2 are implemented. Android onboarding opens Home after durable
setup, a paged coordinator resumes from encrypted cursor boundaries, starter
plans use credible income in any ledger currency, and the primary UI adapts at
accessibility text sizes with shared modal and explicit navigation semantics.
The largest onboarding, Settings, Bills, and Wallet sections have been extracted
without changing their behavior. JS launch timing uses a closed, privacy-safe
event vocabulary; guarded internal Release builds can export those fixed timings
as a local JSON file, and reviewed 0/1k/5k/10k generic backup fixtures exercise
the real restore path. The export is explicitly JS-instrumentation-to-Home and
does not claim to include native startup before JS evaluation. Interactive
control borders meet the 3:1 non-text contrast
floor and respond to increased-contrast preferences. The browser navigation
helper now waits for hit-tested target-screen content after animated tab changes.

Phase 3's evidence workflow and reporting are implemented: the parser-sample
screen creates a local redacted file, and `docs/parser-capabilities.md` reports
only reviewed acceptance fixtures by market, institution, alert language, and
event family. Parser expansion itself remains evidence-led; no speculative rule
was added without a new real redacted unsupported format and its adversarial
negative. Real-device p50/p90 launch figures and neutral worldwide marketing
screenshots remain external launch evidence to collect, not values fabricated by
the repository.
