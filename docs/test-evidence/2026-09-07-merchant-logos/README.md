# Merchant logos — 2026-09-07

## Change and evidence

The previously empty merchant catalogue now has 34 locally bundled 128 × 128
PNG identities (264,858 bytes). The transaction detail sheet now uses the same
merchant avatar as lists, bills and top merchants. Unknown/ambiguous names and
image failures retain category icons. Nothing in this change rewrites a ledger
entry or sends merchant names to an external service.

`catalogue.png` is the visual review of every bundled asset. The other PNGs are
actual app screens rendered from the synthetic web demo, not mockups or a user's
financial history. `results.json` contains the 14 passing browser checks.
`source-hashes.json` identifies the feature source and source-manifest bytes.
Asset provenance, hashes and usage caveats are in `assets/merchants/`.

## Passed checks

- Merchant regression suite: all 34 assets; 55 positive identity cases and 32
  negative cases; PNG integrity/dimensions/hash; stable immutable identities;
  accessibility; fallback and failed-image recovery; detail-sheet integration.
- Browser checks: Home, Spending Activity/Trends, transaction detail, payment
  agenda and offline revisits, in both light and dark mode. Every examined logo
  decoded as a bundled 128 × 128 image. Zero external image requests and zero
  JavaScript page errors. A tab-mount timing race in the new test was corrected
  by waiting for a real image to attach, rather than sampling count immediately
  after a press. The rerun passed all 14 checks.
- Application and server TypeScript checks; ESLint.
- Production-mode iOS and Android Hermes bundle exports succeeded. Both platform
  manifests include all 34 merchant PNGs, and every exported PNG's SHA-256 equals
  the reviewed source manifest. `native-bundles.json` records these checks. This
  is a bundle/asset-packaging check, not an installed native application test.
- All 71 app `*.test.js` suites, server suites, repair/workflow suites and 24
  numeric-input regressions passed in the isolated validation checkout.
- The universal regression suites and all 32 parser invariants passed during
  the broader root-run attempt. The native history-store executable also passed
  its 348 assertions after generating the iOS integration sources.

## Scope and remaining release checks

Another session changed tab presentation and Android history import while this
task was running. That work was neither overwritten nor included in this
feature's validation snapshot. The local shared-tree `npm test` attempt stopped
at `build/auto-import.ts`: the in-progress import code references `AppState`,
which its test stub did not yet export.

To validate without editing another session's files, a temporary detached
checkout of committed main `c13fd461073e8139a1dfd79fef5cd039ffbc85d2` received only
the logo patch and assets. TypeScript, ESLint and all application/server/repair
checks above ran against that source. Dependencies were reused from the existing
installation; no dependency or lockfile changes belong to this feature.

The complete macOS `npm test` command did **not** finish green: after the 348
native history-store assertions, its Xcode integration phase required
`ios/Wafra.xcworkspace`, which is absent from the no-install prebuild checkout.
The app/server suites were then run explicitly to completion; the original
test runner was not weakened or edited to skip its native integration phase.
This evidence does not claim a successful CocoaPods/Xcode app build, App Intents
metadata validation, native on-device UI test, APK install or TestFlight release.

The independent worker-review connector returned `WORKER_IDENTITY_LOST`, so no
independent worker approval is claimed. The focused diff and rendered screenshots
were reviewed in this task.

No logo changes were committed, pushed or published by this task. Brand artwork
provenance does not establish unrestricted distribution rights; the source and
usage notes in `assets/merchants/README.md` remain applicable to a public release.
