# Wafra skills, product, and code audit — 4 September 2026

## Assessment

Wafra has a recognizable design and substantial safety engineering. Keep its warm paper/charcoal palette, restrained green accent, readable ledger figures, four main destinations, local encryption, explicit review states, and conservative parser refusals.

The most urgent work is to make every import path agree about money, recover gracefully from interrupted iPhone setup, and deliver a useful first result sooner. Adding more generic skills or rewriting the parser would not address the defects found here.

This audit assesses the current dirty working tree on `codex/universal-parser-adversarial-tests`. Existing application changes were preserved. Audit documents and evidence are the only additions from this review; none of the findings below has been fixed by this audit. No commit, publication, or production configuration change was made.

The audit started September 4 and final verification continued into September 5, Dubai time.

## Scope and evidence limits

- Read-only reviews covered parser/routing/import boundaries, money, onboarding, iOS setup and native capture/history interfaces, design primitives and main screens, backup/export, persistence, billing, relay request boundaries, and CI.
- The available skill catalogue was assessed for relevance and duplication. The most relevant Expo, Argent, design, and process skill instructions were read. This was not a line-by-line review of every installed skill.
- Fresh SDK 55 web export and browser suites exercise the current source. Screenshots of Home, Flow, Bills, and Wallet use synthetic demo data.
- Native inspection used the already installed app on the booted WafraClean iOS 26.1 simulator. That binary's exact source revision was not established. Its screenshots are observations of the installed build, not proof that the current tree passes native acceptance.
- No physical iPhone automation, live bank alert, store purchase/restore, production relay load test, full cryptographic audit, or complete VoiceOver/Dynamic Type matrix was performed in this session. Existing physical evidence is identified separately below.
- Broad coverage of subsystems does not mean every line or every runtime state was proven correct.

## Prioritized code and behavior findings

### P1 — Currency validation can be bypassed before ledger insertion

Reproduction uses an existing repository-redacted ENBD purchase fixture: an AED 89.50 card purchase. With a ledger pinned to USD or KWD, both the paste path and a launch-alert session can produce `amountFils: 8950`. The import plan accepts the result and loses the original currency, so the ledger can display **USD 89.50** or **KWD 8.950**.

The launch session initially locks only AED/SAR. In the interpreter, the legacy parse is wrapped in the market/currency guard, but a rejected legacy result can still continue into semantic fallback. The final import boundary does not independently enforce currency equality.

Evidence: [launch-alert-parser.ts](../src/lib/launch-alert-parser.ts), [bank-alert-interpreter.ts](../src/lib/bank-alert-interpreter.ts), [import-plan.ts](../src/lib/import-plan.ts). Reviewed entry points include interpreter lines 223–245, launch session lines 60–61 and 97–99, and import-plan lines 943–955.

**Required fix:** carry currency and minor-unit exponent through the canonical parsed result; reject or explicitly stage mismatches at the common import boundary. Do not silently convert or relabel. Add the real ENBD example to every ingestion-path regression, including an unknown/unpinned ledger and already pinned AED, SAR, USD, JPY, and KWD ledgers.

### P1 — Pasted salary can become spending

The existing synthetic regression message `Payroll credit: AED 7,500.00 was posted to your account 1234.` becomes expense / Account debit / Other through paste, but income / Salary through the shared interpreter. Both outcomes survive import-plan construction. This is a concrete inconsistency, not a hypothetical unrecognized bank template.

The paste screen still calls `parseSmsBatch` directly rather than using the interpreter and review routing used by newer capture paths. Structured acceptance can also remove the original source, making correction harder.

Evidence: [import-sms.tsx](../src/app/import-sms.tsx), line 560; [sms-parser.ts](../src/lib/sms-parser.ts); [bank-alert-interpreter.ts](../src/lib/bank-alert-interpreter.ts).

**Required fix:** use one semantic interpretation and currency-validation interface for paste, Android scanning, iOS capture/history, and relay ingestion. Keep path-specific permissions and transport outside that interface. Test the same fixture through each public import entry point, not only parser helpers.

### P1 — CSV exports use the wrong currency and scale

`exportCsv` hardcodes `amount_aed` and formats every amount as `(amountFils / 100).toFixed(2)`. A KWD 1.000 value stored as 1000 exports as 10.00; JPY 1000 also exports as 10.00. SAR and USD ledgers retain a misleading AED column name. Account names are quoted without escaping embedded quotes.

Evidence: [settings.tsx](../src/app/settings.tsx), lines 654–658.

**Required fix:** export a currency column, an exponent-aware amount, and correctly escaped CSV fields. Test zero-, two-, and three-decimal currencies and names containing commas, quotes, and newlines.

### P1 — Interrupted iPhone onboarding does not reliably resume

The gate initializes its step to Welcome and preferences to defaults. The persisted setup return flag is consumed in setup/import routes, not by a normal cold launch at the root. Source-derived reproduction: choose goals, enter iOS setup, terminate Wafra, then launch normally; the root can restart the questionnaire. This interruption sequence was not executed on the current native candidate during this audit.

Evidence: [onboarding-gate.tsx](../src/components/onboarding-gate.tsx), lines 247–251; [ios-message-onboarding.ts](../src/lib/ios-message-onboarding.ts), line 137; [ios-history-setup.ts](../src/lib/ios-history-setup.ts), line 142.

**Required fix:** hydrate a durable onboarding stage and saved preferences before deciding whether Welcome is appropriate. Test interruption at every external-app handoff, with and without a callback URL.

### P1 — Canceling a Shortcut installation leaves an incomplete recovery path

Opening either iCloud install link immediately records `in-progress`. Canceling in Shortcuts still leaves the app at a confirmation stage, with no clear Add again / I have not added it action. Missing Shortcuts has a controller recovery intent but no rendered App Store action.

Evidence: [ios-setup.tsx](../src/app/ios-setup.tsx), future install lines 298–309 and 521; history install lines 326–345 and 595; [ios-capture-setup.ts](../src/lib/ios-capture-setup.ts), lines 159, 314, and 377.

**Required fix:** distinguish link opened, user-confirmed installation, harmless-check success, and real-alert success. Offer re-add, retry, and install-Shortcuts recovery from every relevant stage. Opening a URL must never prove installation.

### P1 — Backup schema validation is too shallow

`parseBackupForRestore` accepts a Wafra envelope with `transactions: []` and `accounts: {}`. The real restore normalization then throws `state.accounts is not iterable`. It also accepts malformed budgets and a negative manual expense amount.

For the malformed-accounts reproduction, the reducer throws **before** authoritative ledger replacement or persistence. This audit did not demonstrate data loss. It did establish an uncaught failed restore and some preceding settings/global-state side effects.

Evidence: [store.tsx](../src/lib/store.tsx), validator line 583, dispatch line 1408, restore line 2057.

**Required fix:** validate collections, money, dates, IDs, and references; migrate and normalize into a temporary valid state before dispatch. Invalid input should return a clear error and leave ledger and preferences intact. Test malformed nested structures and rollback behavior.

### P2 — Newly discovered old Android alerts expire before review

Android history/rescan admission sets review expiry from the original SMS timestamp. The store compares that expiry with current time, so a valid global alert discovered after 30 days is discarded immediately. An existing synthetic Chase fixture dated July 1 and discovered September 4 produces `expired-review-candidate`. The iOS history path already extends expiry from discovery time.

Evidence: [auto-import.ts](../src/lib/auto-import.ts), lines 385 and 411; [alert-review-tray.ts](../src/lib/alert-review-tray.ts), line 154; [store.tsx](../src/lib/store.tsx), line 1736; [historical-import.ts](../src/lib/historical-import.ts), lines 90–98.

**Required fix:** distinguish transaction time from review discovery time, with consistent retention behavior across platforms. Preserve existing anti-replay/tombstone rules.

### P2 — Setup progress can imply a connection that does not work

Skipped future/history rows count toward `2 of 2`, without a visible Skipped label. A persisted Complete row is upgraded when native readiness succeeds but is not downgraded when readiness becomes disabled/unavailable.

Evidence: [ios-setup.tsx](../src/app/ios-setup.tsx), lines 86, 249, 376, and 441; [checklist-row.tsx](../src/components/ios-message-setup/checklist-row.tsx), lines 52 and 85.

**Required fix:** show live connection status separately from historical setup progress. Use explicit Not connected, Skipped, Needs attention, Ready, and First bank alert captured labels. Reserve verified automation claims for real selected-sender trigger evidence.

### P2 — Essential Apple setup steps are missing or hidden

The future-alert action opens `shortcuts://`, but the short guide begins at Message, omitting Automation → New Automation. For history, keep the phone unlocked / keep Shortcuts open and the 3,000-message boundary are in optional details, although they affect whether starting the task makes sense.

Evidence: [ios-setup.tsx](../src/app/ios-setup.tsx), lines 51, 534, and 571; [details-sheet.tsx](../src/components/ios-message-setup/details-sheet.tsx), line 41; [ios-capture-setup.ts](../src/lib/ios-capture-setup.ts), line 332.

**Required fix:** a short illustrated Apple stepper plus persistent help; show the two action-critical history preflight facts before Start. Keep implementation details in Learn more.

### P2 — Plaintext export files outlive sharing and ledger erasure

Backup/CSV sharing writes plaintext into app cache. The share helpers do not delete those files, and Erase all data clears ledger/keys/capture state without clearing these exports. Canceling the share sheet still leaves an app-created file. This is source-confirmed; device file retention was not inspected.

Evidence: [share-text.ts](../src/lib/share-text.ts), lines 153–171; [settings.tsx](../src/app/settings.tsx), lines 815–838.

**Required fix:** track generated temporary files; clean them at a platform-safe point, on startup, and on explicit erase. Do not delete an externally saved user backup or remove a file while a share extension still needs it.

### P2 — CI omits native live-capture behavior tests

The native job path filter omits live-capture module/test paths and its macOS command runs history tests only. The root suite runs live-capture Swift tests only on Darwin; the main CI test job is Ubuntu. A live-capture-only change can therefore pass CI without its native behavior tests.

Evidence: [ci.yml](../.github/workflows/ci.yml), lines 27 and 128; [run.sh](../scripts/test/run.sh), Darwin condition and both native commands.

**Required fix:** trigger the macOS job for both native modules and execute both Swift test scripts. Compile checks and behavior checks serve different purposes.

### P2 — Relay body limits are enforced after buffering

Requests with a declared oversized Content-Length are rejected early, but unknown-length bodies are read using `req.text()` / `req.arrayBuffer()` before actual size is checked. The text path then allocates another encoded copy.

Evidence: [server index.ts](../server/src/index.ts), lines 184 and 197.

**Required fix:** bounded streaming reads with early cancellation. This is a source-confirmed missing application-level streaming cap, not a claim that the hosting platform has no limits; no production load or abuse test was attempted.

### P3 — Browser runner's port override is inconsistent

Running the fresh export with `E2E_PORT=8136 BASE=http://localhost:8136` passed smoke, period, and persistence, but navigation attempted port 8126 and failed before testing the app. `e2e-navigation.mjs:20` hardcodes that URL. The navigation suite was then rerun against the same export at its expected port.

The E2E README also describes three suites and a Python server, while the actual runner executes four suites using the repository server and a demo-export flag.

## Design language: preserve the identity, improve the priorities

The strongest parts are the paper/charcoal surfaces, green accent, tabular money, hairline transaction rows, restrained charts, and a clear focal amount. Home correctly calls its figure net after spending; do not rename it safe to spend without a separately defined financial model. The current approved September 4 design retains the existing four tabs and financial projections.

The fresh web screenshots show:

| Screen | What works | Next refinement |
| --- | --- | --- |
| Home | Clear net figure, period context, income/spending split | A capture banner and insight card occupy substantial first-screen space before useful activity. Keep only the most relevant next action prominent. |
| Flow | Comparable six-month bars, visible figures, category list | Explain what “With limits” measures; avoid making the jump to Stats feel like a second competing analytics home. |
| Bills | Readable recurring rows, explicit price change, clear sections | Prefer full user-facing labels over “Subs” and “Fixed”; avoid rediscovering the same Cards/Fixed destinations both as tabs and large links unless that redundancy helps testing users. Preserve the domain model. |
| Wallet | Accounts/cards/goals grouped with meaningful labels | Empty state should lead with one useful action rather than a dashboard of zeroes. Distinguish reported balances from inferred totals. |
| iOS setup | One page is easier to understand than scattered setup screens | Clear retry actions and honest working/skipped status matter more than reducing another line of copy. |

The onboarding surface is hardwired to `Colors.dark` while the core app supports appearance choice. Treat that as an intentional brand decision to revisit, not an automatic accessibility failure. Its preview rows have chevrons but are not interactive; either remove the affordance or make the preview an actual demonstration.

Typography includes 14-point body text and 11–12-point supporting labels. Retain hierarchy, but test essential instructions at larger sizes and avoid using the smallest label styles for decisions. New screen, field, segment, and sheet primitives already improve consistency; finish their adoption rather than introducing another design system.

Native observation: Wallet's decorative bank SF Symbol appeared in the accessibility tree as an `AXTextField` named `building.columns`. The current `PlatformSymbol` iOS wrapper does not explicitly hide decorative symbols. Confirm this on the exact candidate build with VoiceOver, then ensure icons inherit the parent control's useful label without becoming separate focus stops. This is a targeted verification finding, not a completed VoiceOver audit.

## Onboarding proposal: first useful result, then personalization

This is a product recommendation for the next iteration, not a silent replacement of the currently approved flow.

1. **Show the benefit.** A clearly labeled sample alert becomes merchant, amount, category, and account. Let the user reveal how Wafra understood it. Use brief motion, with a static equivalent for Reduce Motion.
2. **Get one useful result.** Offer paste an alert, add manually, or import history. Explain relevant coverage and iPhone limitations at that choice. Keep a quick route available when history may take 20–25 minutes.
3. **Review and save.** Show what was recognized, what needs review, and what is a duplicate. Celebrate the actual saved result rather than an opened install link. Never mix sample entries into a personal ledger.
4. **Keep it updated.** Offer future-alert setup after value is visible: install → illustrated Apple automation → harmless check → waiting for first real bank alert. Persist progress and expose retry throughout.
5. **Personalize.** Offer goals, budget style, and money-month choices with skipping allowed. Derive actual amounts only from appropriate income evidence or explicit user input.
6. **Resume from Home.** A compact setup card takes users back to the exact unfinished task.

Measure this with consented usability sessions: time to first saved real entry, canceled install recovery, cold-launch resume, first successful real-alert capture, and task completion without assistance. Do not introduce financial-message analytics to collect these metrics.

## iPhone feasibility and existing evidence

Apple's Message automation documentation describes sender/phrase conditions; it does not justify a claim that an ordinary app can silently read every SMS. Selected-bank automation remains a user-created Shortcuts flow. Keep the platform-specific setup visible and honest. [Apple communication triggers](https://support.apple.com/en-mide/guide/shortcuts/apdd711f9dff/ios)

The repository records a physical build-44 history success: 2,374 retained readable messages, 638 financial alerts, 194 review entries, about 23 minutes, followed by source cleanup. The current history graph stops at 3,000 or more retained messages. Those numbers are one documented device run, not a benchmark for all iPhones.

Build 45 availability is documented, but corrected return/navigation checks and a real future-bank-alert automation check remain outstanding in [the September 1 evidence](test-evidence/ios-history-import-implementation-2026-09-01.md). This session's installed simulator build also showed an unavailable verified install link and a history-setup update error; its native-module freshness is unverified.

## Universal parser: what is actually supported

The architecture already contains semantic interpretation, market/institution evidence, conservative suppression, a private review tray, and rollout gates. The missing work is consistent integration and real evaluation evidence.

| Evidence set | Current evidence | What it establishes |
| --- | --- | --- |
| Named UAE format fixtures | 9 total: 5 repository-redacted, 3 public-redacted, 1 synthetic | Specific known specimens, not every format from each institution |
| Named Saudi format fixtures | 2 public-redacted Bank Albilad purchases | Narrow real Saudi evidence |
| Mixed UAE regression corpus | 799 cases combining retained redacted exports and synthetic test literals: 609 parsed, 190 refused; 91 unresolved among parsed; 112 deliberately Other | Regression behavior only; these are not 799 real inbox messages or a real-world accuracy score |
| Global fixtures | 188 rows over 14 markets: 185 synthetic, 3 standard-derived, 0 consented real | Grammar/safety probes, not validated worldwide automatic import |

The generated public capability matrix correctly excludes synthetic probes. The global rollout gates appropriately remain closed when evidence or duplicate measurements are missing. [Capability matrix](parser-capabilities.md), [rollout contract](universal-parser-rollout.md).

Recommended engineering sequence:

1. Unify interpretation and enforce currency/exponent at ledger admission. Preserve raw-source privacy boundaries and user overrides.
2. Make review useful across paste and history, including discovery-time expiry and deliberate handling of the capped backlog.
3. Collect consented, locally redacted specimens for exact institution/channel/template versions. Split authoring and held-out data by template before tuning.
4. Evaluate posting status, exact money/direction, non-posted rejection, duplicates, and complete import sequences. Report coverage per bank/template/family. A larger synthetic corpus is not more real coverage.
5. Enable narrowly qualified templates behind rollout gates. Unknown or changed templates return to review. An LLM may suggest structured fields under a future threat model, but must not become unverified ledger authority.

Avoid a large regex rewrite. The legacy parser is 5,591 lines; extract policy and interpretation seams gradually after path-parity tests protect behavior.

## Skills assessment

You already have enough general-purpose capability installed. The useful change is a small default toolchain plus task-specific specialists.

| Keep as a primary choice | Why it is useful here |
| --- | --- |
| `expo:expo-overview` → `expo-design-system`, `expo-native-ui`, `expo-router` | Version-aware platform guidance and a single existing design system |
| `design:design-critique`, `design:accessibility-review`, `design:ux-copy` | Hierarchy, task clarity, accessible controls, concise recovery copy |
| Argent device-interact / test-ui-flow / qa-flows | Native evidence and reproducible user journeys |
| Argent optimization / profilers | Measure actual startup/list/rendering problems before changing code |
| Superpowers systematic-debugging / verification-before-completion | Reproduction and evidence, especially for money and persistence |
| `codebase-design` / `software-architecture` | Isolate import policy and state ownership without wholesale restructuring |
| RevenueCat and Cloudflare specialists | Load only when working on billing or the relay |

Keep the existing `sms-parser-smith`, `card-ledger`, and `wafra-tester` agents. They are agents, not skills; their repository knowledge is more valuable than installing another generic parser skill.

**Resolve these overlaps and hazards:**

- Multiple Expo/Komand/general mobile design families compete to decide typography, cards, navigation, and component libraries. Choose the versioned Expo family plus Wafra's existing tokens as the default.
- [Expo iOS Designing](/Users/naserkhanjar/.codex/skills/expo-ios-designing/SKILL.md) says always use NativeTabs for Liquid Glass. Wafra's approved SDK-55 design defers that beta migration to a separate, reversible stage with a custom-tab fallback. A generic skill must not override the approved product scope.
- `mobile-app-ui-design` prescribes an eight-point grid, category colors, and rounded cards, while Wafra uses a four-point scale, semantic color, and ledger rows. Use its hierarchy ideas, not those conflicting styling defaults.
- [Argent's React Native troubleshooting section](../.agents/skills/argent-react-native-app-workflow/SKILL.md) includes deleting `node_modules`, lockfiles, Pods, and broad cache resets. Replace that recipe in a future skill maintenance pass with diagnosis, explicit scope, and preservation of lockfiles/native changes. None of those cleanup commands was run here.
- The Argent test skill has screenshot-derived tap fallback wording that conflicts with the higher-priority no-screenshot-coordinate rule. Keep discovery-based targeting authoritative.
- Superpowers overlaps with native Codex approvals, worktrees, and delegation. Follow the repository's current-tree workflow and existing authorization; avoid redundant ceremony.
- Business/document/research skills can remain installed for other projects. They do not need to be loaded into routine Wafra work. This review did not uninstall or modify anything.

**What is missing:** explicit repository-specific checklists, not another plugin. Add or consolidate guidance for (a) cross-path import parity, currencies/exponents, provenance, and non-posting cases; (b) iOS install/cancel/retry/cold-launch/real-alert verification; (c) Wafra's design rules and screen accessibility matrix; and (d) an evidence map distinguishing code-tested, simulator-tested, physical-tested, configured, and released. Keep these close to the existing specialist agents/tests to avoid duplicating policy.

All implementation guidance must remain pinned to [Expo SDK 55](https://docs.expo.dev/versions/v55.0.0/). The installed stack matches its React Native 0.83 / React 19.2 family; no SDK upgrade is proposed.

## Delivery order and acceptance

1. **Protect money and restore.** Fix currency admission, paste parity, CSV scaling, and backup validation. Pass cross-path tests plus the complete launch corpus and monetary invariants.
2. **Repair setup recovery.** Persist/resume, re-add/install recovery, honest skipped/readiness state, actionable Apple instructions. Preserve distinct probe and real-alert proof. Exercise cancellation and interruption on the candidate iPhone build.
3. **Improve the first result.** Ship the interactive sample and skippable personalization as a separately reviewed product change. Validate with users before claiming onboarding improves conversion.
4. **Finish system consistency and retention.** Reuse existing primitives, verify native icon semantics/large text/RTL, clean temporary exports safely, and close CI/body-limit gaps.
5. **Expand parser evidence.** Qualify individual real bank templates and complete their import/deduplication benchmarks before automatic rollout.

Local release preflight currently reports nine blockers: missing/invalid iOS and Android RevenueCat keys; missing privacy, terms, and support URLs; legal-contact placeholder; unfinished privacy relay entity; terms placeholders; and store-listing placeholders. These are findings in the local checkout, not an inspection of external store consoles. Complete real configuration and physical acceptance before publication.

Passing helper and source-contract tests does not contradict the runtime and integration findings. The highest-value new tests exercise the same alert through each actual ingestion path and interrupted setup through its real state transitions.

## Verification record

Final command results and saved screenshots are recorded in [the audit evidence directory](test-evidence/2026-09-04-full-app-audit/). The environment JSON is the session's project-environment snapshot.

- Expo Doctor: 20/20 checks passed.
- Type checking: app and server passed.
- ESLint: no errors; two duplicate-import warnings in `src/components/ui/charts.tsx`.
- Complete test runner: exit 0; 67 app suites, 3 server suites, and 2 native Swift suites ran. Selected counts: parser 946, bank corpus 1,338, invariants 32, unit 748, Worker 337, all passing.
- Native verification included 348 history-store assertions, 130 live-store assertions, 51 bridge assertions, 78 resource assertions, and a clean current-source iOS Simulator app build with generated App Intents/resource checks.
- Fresh browser smoke: 63 passed; period: 13 passed; persistence: 6 passed; navigation: 65 passed on the rerun at its expected port. All had zero assertion failures. The initial combined runner exited 1 because navigation ignored the custom port; the isolated navigation rerun exited 0.
- Release preflight: failed with the nine configuration/documentation blockers listed above.
- Saved parser probes reproduce all three captured defects; rerunning the portable probe script produced byte-identical structured results.

These passing suites protect existing cases. They do not establish worldwide parser accuracy, resolve the newly reproduced bugs, or replace physical iPhone automation acceptance.
