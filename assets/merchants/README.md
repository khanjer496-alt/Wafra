# Wafra 1.0 artwork policy

No third-party merchant or bank artwork ships in Wafra 1.0, on iOS, Android,
web, or widgets. Avatars use local letters or generic category/calendar glyphs.
Remote search, CDN URL builders and logo resolvers are removed, as is the
112-image Metro require map. Online-logo Settings controls are absent.
Existing saved opt-in values cannot enable artwork; cache erasure remains for upgrades.

Removed: 112 PNGs (836,276 bytes) from this folder and 33 copies each from
iOS widget asset catalogs and Android widget drawables. `sources.json` remains
as historical provenance only; it is not imported into the shipped app and does
not establish redistribution rights. No third-party brand category is retained.

Retained app artwork: Wafra's own logo/mark in `src/components/wafra-logo.tsx`,
`assets/wafra.icon/`, `assets/images/icon.png` and the splash/adaptive app icon
assets. Generic UI/category/calendar symbols remain; these are not merchant marks.
The existing font and dependency licences remain applicable.

Reintroducing brand artwork requires a documented rights basis and a separate
review. The historical source URLs and Simple Icons project licence are not a
blanket permission to ship underlying brand marks.

Regression checks: `node scripts/test/merchant-logos.test.js`,
`node --test scripts/test/repair/store-artwork.test.cjs`, and
`scripts/e2e/e2e-merchant-logos.mjs` (production export, upgraded saved opt-in).
