# Guided iOS setup trial — 7 September 2026

Base: `c94db9eb2bb4bf0ce05845b000bd8eec777fb0f7`, the release-review branch for public beta 52.
Work branch: `work/ios-guided-onboarding`. Main, public TestFlight, iCloud Shortcuts, native protection and monetary/parser rules are unchanged.

## Implemented setup changes

Fresh setup opens History first; saved progress and explicit Future/History route requests remain authoritative. The History row is first visually. An unfinished import does not disable the user action to inspect/set up future alerts, and choosing that section does not reset the existing native handoff.

Bank guidance uses bank identities already present in saved SMS-derived transactions. There is no upfront bank picker or bank connection. It does not guess from account labels, expose raw senders, or pretend bank names are selectable Apple sender IDs. The guide explains multiple selected senders and an empty additional phrase filter.

Native no-input proof no longer skips the user's personal-automation confirmation. The Finish gate requires history completion, a usable native capture action, and the user's automation confirmation. A first real qualifying alert remains a separate milestone, not a requirement to make a purchase before finishing onboarding. Manual-only and consent/retry/recovery paths are preserved.

New guidance is in English and Arabic. This is a source/UI trial, not physical-device acceptance.

## Larger history prototype — not enabled in the app

`src/lib/ios-history-traversal.ts` is a provider-independent coordinator. It has no total-message or recent-only date ceiling. It uses bounded queries, newest-first windows, a one-row overflow sentinel, contiguous coverage checkpoints, and atomic page/checkpoint commits supplied by its adapter. Saturated terminal timestamps, invalid pages, failed persistence and unverified providers block rather than silently skip data. Query budgets pause rather than claim completion. Checkpoints retain counts/dates only.

The coordinator is NOT wired to Apple Messages, the existing native store or the published Shortcut. The existing adaptive Shortcut is explicitly retained as a reproduction of an iOS date-filter defect. It has not been re-enabled. A concrete provider must prove exact date boundaries, complete-page reporting, observed oldest-history bounds, and privacy/consent fencing before integration. Its atomic storage adapter must preserve source identities on replay.

The published Shortcut still has its existing 2,999-retained-message coverage bound. This trial does not claim that larger history is available on an iPhone, does not invent progress from parsed transaction dates, and does not relabel a partial import as complete. Current history coverage disclosures remain visible.

## Local verification

- Existing and revised setup/recovery checks: 229 passed, 0 failed (Node 22.16.0/Linux, explicit native/UI stubs).
- New journey/traversal tests: 16 passed, 0 failed. Includes 12,000 synthetic message references across two years; newest-first commits; pause/resume; dense timestamps; exact date boundaries; snapshot exclusion; failed writes; cancellation; and source-free checkpoint validation.
- These are synthetic/source tests, not real SMS delivery, extraction speed or iPhone measurements.

CI additionally runs the actual app/server typecheck, lint, native fixture generation and existing full regression suite before committing the narrow edits. Inspect its recorded revision and results; a pending/skipped/failed job is not a passing result.

## Before a new phone beta

Test rendered onboarding at small widths, large text and Arabic on the actual native build; replay upgrade/restored progress; test the installed Shortcut and personal Message trigger on a physical iPhone. For larger history, finish the verified Apple extraction and atomic-storage adapters and compare retrieved IDs against the selected source history. No automatic publication is configured for this trial.
