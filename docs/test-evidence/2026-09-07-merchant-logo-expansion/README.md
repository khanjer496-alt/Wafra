# Merchant-logo expansion — 2026-09-07

## What changed

78 merchant/service identities were added to the existing 34, for a total of
112 bundled logos. The additions cover regional retail, groceries, restaurants,
travel, home services, pharmacies, utilities, subscriptions and digital services.
The pack contains 59 Simple Icons derivatives and 53 reviewed publisher app
icons. Source URLs, publisher/app identities, transformations and exact PNG hashes
are recorded in `assets/merchants/sources.json`.

The entire pack is 836,276 bytes (about 817 KiB), below the enforced 1 MiB budget.
Lossless PNG recompression saved 145,988 bytes; decoded RGBA bytes were verified
unchanged. Every asset is 128 × 128 pixels. No runtime lookup service was added.

The display matcher retains explicit aliases and bounded suffix removal rather
than searching arbitrary substrings. English and Arabic spellings are covered.
The input-length check now runs before trimming so oversize descriptors are
rejected without scanning them unnecessarily. No parser, money, category,
subscription-detection or transaction-persistence logic was changed.

## Evidence

`catalogue.png` shows every bundled logo. Screen captures and `results.json` come
from the actual synthetic-demo web export, not mockups or private spending data.
`source-hashes.json` records the feature-source bytes. `native-bundles.json`
records production-mode iOS/Android Hermes asset-packaging checks.

Passed focused checks:

- All 112 image files have verified format, dimensions, provenance and SHA-256.
  The merchant suite checks 321 positive title variants, case/whitespace variants,
  53 explicit negative inputs and 642 generated near-brand negative inputs.
  Stable identities, category fallback, failure recovery and accessibility remain
  covered. Expanded aliases also have an independently stored expectation fixture.
- 16 browser checks passed across light/dark Home, Spending Activity/Trends,
  transaction details, Bills, the new Fitness First logo and offline revisits.
  There were zero external image requests and zero JavaScript page errors.
- Production-mode iOS and Android Hermes exports completed. Both manifests
  contain all 112 PNGs, and all exported image hashes match the source manifest.
- TypeScript and ESLint checks passed. UI foundation and polish contracts passed.
- All 71 application suites, server suites, repair/workflow tests and numeric-input
  regressions passed against the isolated snapshot. `regression-summary.json`
  records the completed scope; the tested runtime and asset-manifest hashes were
  compared with the canonical checkout before staging.

The new browser assertion uses Fitness First, a recurring subscription in every
demo month. An initial Salik assertion was removed because a transport merchant
is not guaranteed to appear in the payment agenda; bill classification was not
changed merely to satisfy a logo test. Salik identity/artwork remains covered by
the merchant suite and native packaging checks.

## Validation scope and publication

Application/server regressions were run in a temporary detached checkout of
`67f996b24c28a1fe584e86e9bbe207a3f49c11ef` plus the logo expansion. This kept another
session's in-progress landing-page changes out of the feature's test snapshot.
The temporary checkout reused installed dependencies, generated only the ignored
iOS contract fixture sources and did not change dependencies or lockfiles.

Native exports are packaging checks, not signed application builds, on-device
tests or store releases. The macOS Xcode/CocoaPods integration build is outside
this asset-only change. No APK/TestFlight release or OTA update is dispatched by
this task. The user authorized a focused commit and normal push to `main`.

An independent worker review could not be started because the connector reported
`WORKER_IDENTITY_LOST`; no independent approval is claimed. The source, provenance,
tests and rendered images were reviewed directly in this task.

Artwork provenance is not a blanket redistribution licence or an endorsement.
The public-release usage caveats in `assets/merchants/README.md` still apply.
