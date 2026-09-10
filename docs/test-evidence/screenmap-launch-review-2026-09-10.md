# Screenmap launch-review baseline

## Purpose

Use Screenmap as Wafra's visual launch checklist: capture the real iOS app,
review each route/state against Ledger & Light, make a small approved change,
then compare the next capture rather than redesigning from memory.

Screenmap is supplemental evidence. Its interactive capture is currently iOS
only, so Android still uses the physical-phone and browser acceptance checks.

## Privacy boundary

The Screenmap workflow builds a local iOS simulator `.app` with
`EXPO_PUBLIC_WAFRA_SCREENMAP_DEMO=1`. The app admits that flag only on iOS while
the development-only founder flag is also enabled, then loads the same generated
demo ledger used by QA. No phone backup, SMS corpus, diagnostic export, real
account, credential or customer data belongs in a Screenmap run.

Bundles are configured with `publish: false`. They remain workflow artifacts and
are opened manually in the Screenmap viewer. The simulator app is built directly
on the GitHub macOS runner and passed through Screenmap's `app_path`, so this
workflow does not consume the project's monthly EAS iOS-build allowance. The
initial baseline does not need an agent/API key: route parsing, deep links and
committed flows are deterministic.

## Cost boundary

The baseline workflow is manual rather than running on every push or on a daily
schedule. This avoids spending macOS runner minutes while Wafra is still being
iterated rapidly. PR review is available when UI work is done through a PR.

## Review board

| Area | First baseline | Launch decision |
| --- | --- | --- |
| Home | pending capture | user review |
| Spending · Categories | pending capture | user review |
| Spending · Activity | pending state/flow | user review |
| Spending · Trends | pending state/flow | user review |
| Bills | pending capture | user review |
| Activity / Transactions | pending capture | user review |
| Merchant detail | pending data-dependent flow | user review |
| Accounts | pending capture | user review |
| Payment cards | pending capture | user review |
| Transfer review | pending data-dependent flow | user review |
| Settings | pending capture | user review |
| Import / iOS setup | pending capture | user review |
| Add/edit transaction | pending capture/flow | user review |
| Alerts / categorisation / accuracy | pending capture | user review |
| First-run onboarding | existing isolated browser suite; native flow later | user review |
| Loading / empty / permission / error states | pending flows | user review |

## Decision rule

Objective defects (clipping, inaccessible controls, dead links, duplicated copy,
incorrect spacing/component use) can be fixed directly with regression coverage.
Subjective changes to information architecture, content or visual hierarchy are
shown to the user first. Parser/accounting behavior is outside this pass.
