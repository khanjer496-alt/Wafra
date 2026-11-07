# Google Play launch presentation

The eight English launch artboards use real Android captures with synthetic ledger data. `../native-source/` preserves the original pixels from builds 380/382; these are not claimed as new build 392 captures. `frames.json` defines the final order, captions and clearly framed detail crops. Native UI was not redrawn or changed.

Serve the repository root over localhost, open `index.html?frame=01-home` through `08-privacy-settings` using the IDs in `frames.json`, and capture the rendered page at exactly 1080 × 1920 after fonts and images load. `index.html?frame=feature` uses 1024 × 500. The page exposes `body[data-ready="true"]` when ready. A browser JPEG capture was converted to opaque RGB PNG with `sips`; the conversion does not retouch content. Final output hashes and source hashes are in `PROVENANCE.json`.

The final images are `../global-en/` and `../global-en-feature-graphic.png`. The existing app icon remains unchanged. English is the active launch locale; Arabic source drafts do not establish an uploaded localized listing. The new presentation assets were declared as AI-assisted in Play Console because their marketing copy and layout were produced with assistance; embedded native UI remains actual app UI.

Verify with `npm run check:store`, `npm run check:store-assets`, `npm run check:store-pricing`, and `node --test scripts/test/store-package.test.js scripts/test/store-pricing.test.js`. These checks validate packaging and source facts; they do not establish Google approval, publication, or real purchase behavior.
