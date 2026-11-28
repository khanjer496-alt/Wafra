# Wafra merchant and bank artwork policy (1.0.2)

No third-party merchant or bank artwork ships inside Wafra, on iOS, Android,
web or widgets. This keeps the 1.0 trademark position: Wafra does not
redistribute brand marks it has no documented right to bundle.

From 1.0.2, merchant and bank logos load online from Brandfetch's Logo API,
on by default on iPhone and Android, with no switch and no consent step:

- Only a cleaned merchant or bank name goes to Brandfetch Search
  (`brandfetchSearchUrl`, `src/lib/verified-logo-identities.ts`), never an
  amount, account or card number, or bank message text. The image comes from
  `cdn.brandfetch.io`, rebuilt from a validated brand domain.
- Lookups wait for the store to hydrate and run in an idle callback, so rows
  never wait on the network. A saved local-only preference turns them off.
- Following Brandfetch's terms, search results are never stored: they live in
  session memory only, and erase clears them. The first launch deletes any
  `wafra:merchant-logo:` / `wafra:bank-logo:` records older builds stored.
  Images are hotlinked from the CDN with Wafra's site as `Referer` on native;
  only expo-image's normal HTTP cache keeps them.
- A miss, an error or no network shows the merchant's letter
  (`MonogramAvatar`). Widgets always draw letters.

Removed in 1.0 and not restored: the 112 bundled PNGs, the Metro require map
and the widget copies. `sources.json` remains as historical provenance only;
it is not imported into the shipped app and does not establish
redistribution rights.

Retained app artwork: Wafra's own logo/mark in `src/components/wafra-logo.tsx`,
`assets/wafra.icon/`, `assets/images/icon.png` and the splash/adaptive app icon
assets. Generic UI/category/calendar symbols remain; these are not merchant marks.

Regression checks: `node scripts/test/merchant-logos.test.js`,
`node --test scripts/test/repair/store-artwork.test.cjs
scripts/test/repair/logo-avatar-privacy.test.cjs
scripts/test/repair/logo-erase.test.cjs`, the resolver suites
(`merchant-logo-resolver`, `bank-logo-resolver`) and
`scripts/e2e/e2e-merchant-logos.mjs` (production web export, Brandfetch stubbed).
