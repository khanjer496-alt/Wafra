# Build 197 candidate frames (PR #292), for approval

Made from source `c75d4ba9` (PR #292): the currency and amount stay on one
line, and iPhone App Lock wording is now "Face ID, Touch ID, or your passcode".
**Not uploaded.** The owner approves first.

- `appstore-6.3-en-08.png`: replacement for `../appstore-6.3-en-08.png`. It
  uses the same caption, theme and crop as the approved frame. Only the App Lock
  subtitle in the native screen changed.
- `alt-appstore-6.3-en-05-accounts.png`: optional alternate for frame 5,
  showing the Accounts tab now that its amounts no longer wrap.
- `alt-appstore-6.3-en-07-budgets.png`: optional alternate for frame 7,
  showing category limits.
- `before-after.png`: build 195 frames next to these.
- `raw/`: unmodified simulator screenshots from capture run 45850150051. These
  are the three sources plus the verification passes: default size, two Larger
  Text sizes and Arabic. Each has a pass/fail result in `MANIFEST.json`.

The binary is a Release simulator build with the `production` profile
environment and OTA checks off (run 45841868014). Captures were taken on an
iPhone 16 Pro simulator, iOS 26.5, en-US, light, with the synthetic USD ledger
from `../capture-195/sample-ledger/`. It is not a signed App Store IPA, and no
phone was used.

Known and accepted for 1.0: at Larger Text sizes, the Accounts hero figure
(`BandFigure`) stacks the `$` above the amount by design.

To use the new frame 8, copy it over `../appstore-6.3-en-08.png`. To use an
alternate, copy it over the matching `../appstore-6.3-en-0N.png`. Then run
`npm run check:store-assets`. With the new frame 8 swapped in, that check
passes.
