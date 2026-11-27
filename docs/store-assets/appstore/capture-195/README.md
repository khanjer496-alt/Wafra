# App Store 1.0 screenshots (build 195), for approval

Eight en-US 1206 × 2622 portrait frames, `../appstore-6.3-en-01.png` to
`../appstore-6.3-en-08.png`. They are **not uploaded**. The CEO approves them
first (see `../../appstore-recapture.md`).

## What the pixels are

- **Binary:** the Release configuration of source `a2ee7ce0` (the commit App
  Store build 1.0.0 (195) was archived from), built for the iOS Simulator with
  the `production` EAS profile environment by
  `.github/workflows/appstore-shots-sim-build.yml` on branch
  `capture/appstore-sim-build-195` (run 45806130728). It is ad-hoc signed for
  the simulator and is not the signed App Store IPA; over-the-air update checks
  were turned off so only this commit's embedded bundle runs.
- **Device:** iPhone 16 Pro simulator (402 × 874 pt @3x = 1206 × 2622), en-US,
  Region United States. Runtime and run ID are in `MANIFEST.json`.
- **Data:** `sample-ledger/wafra-sample-backup-usd.json`, a synthetic USD
  ledger from `sample-ledger/generate-sample-backup.mjs`. Every merchant, bank
  and card name is fictional. It is loaded through the app's own Welcome →
  Restore from a backup flow; no app code or capture hook was added. Build 195
  shows letter monograms, never merchant or bank logos.
- **Navigation:** the Maestro tour in `.maestro/appstore-195/` on the capture
  branch, run by `.github/workflows/appstore-shots-sim-capture.yml`.
  Manual-entry fields in frame 2 were typed by the tour; nothing else was
  changed in the app.
- **Raw captures:** `raw/` holds the unmodified simulator screenshots from
  capture run 45830840036 (`capture-environment.txt`), including two
  alternates that are not in the final set: `alt-05-accounts-light.png`
  (Accounts tab) and `alt-07-budgets-light.png` (category limits). Both show
  a build 195 layout defect: the `$` sign wraps onto its own line above the
  amount in account and budget rows (seen on iOS 26.5 and 27.0 simulators).
  Frame 5 therefore uses Bills → Card payments and frame 7 a savings goal.

## Presentation

`presentation/index.html` with `frames.json` follows the Google Play
presentation in `../../play/presentation/`: same palette, Geist type, brand row,
two-line headline, one supporting line and the "Actual app screens · Sample
data" footer. The status bar is cropped (`cropTop` pixels) and the caption band
replaces it; the rest of each native screen is scaled uniformly, never redrawn.

Serve the repository root on localhost, open
`docs/store-assets/appstore/capture-195/presentation/index.html?frame=<id>` at
exactly 1206 × 2622, capture it once fonts and images load
(`body[data-ready="true"]`), and re-encode as opaque RGB PNG
(`scripts/e2e/png-rgb.mjs` `stripAlpha`). `contact-sheet.html` renders
`contact-sheet.png` at 1404 × 1560 for review only; it is not a store asset.

Verify with `npm run check:store-assets` (it also needs the Google Play set).
