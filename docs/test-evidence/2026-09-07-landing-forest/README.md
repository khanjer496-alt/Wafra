# Wafra landing page — forest / cream alignment

> **Superseded by the user's correction on 7 September 2026.** The user rejected
> this visual direction and its rewritten copy. The intended reference is
> Claude's original **Ledger & Light**, not the later native app's forest/leaf
> implementation. See `../2026-09-07-landing-ledger/README.md`. This file records
> the historical deployment only; it is not design approval.

## Scope and source

Landing-page-only update requested for the existing Cloudflare Pages project
`wafra-app`, at https://wafra-app-azg.pages.dev. Baseline is the consolidated
`main` checkout at `3d390633a72d665f74e6b27e6f13f2176087431a`.

The source of design truth is `src/constants/theme.ts`,
`src/components/reference-home-summary.tsx`, and `src/components/wafra-logo.tsx`:
forest `#072E28`, primary `#106B50`, cream `#FAFAF7`, Geist interface type,
Plex Arabic, and the current two-leaf mark. Historical blue/ledger redesign
proposals are not substituted for the current app implementation.

## Changed surface

- Rebuilt marketing hierarchy: product-led hero, four app destinations,
  getting-started steps, dark privacy panel, native FAQ disclosures and a final
  beta-download section. No separate Stats destination.
- Updated site typography, layout, spacing, controls, responsive styles, favicon,
  social preview and leaf branding. No external font service.
- Replaced old product images with captures of the current app's Home (light)
  and Bills (dark). These are **web-rendered app previews**, at 390×844 logical
  pixels / 780×1688 output, using only the existing synthetic E2E demo ledger.
  They are not signed-native-device evidence or App Store submission assets.
- Preserved the production TestFlight and APK destinations. No new app release,
  SMS capability, universal automatic bank coverage or native reliability claim.
- App, parser, local encryption, relay and native build files are unchanged.

## Validation

- `node scripts/test/web-seo.test.js`: eight checks, including brand, current
  destinations, sample-data disclosure, existing capture/privacy constraints
  and deployment-origin validation.
- Focused marketing / browser-test ESLint and project `tsc --noEmit`.
- Finalized static export through `scripts/finalize-web-seo.mjs`, with production
  origin configured and `EXPO_PUBLIC_WAFRA_E2E_DEMO=0`.
- `scripts/check-web-seo.mjs`: all 27 checks, including root metadata, canonical,
  sitemap, social preview, non-root noindex and zero executable root JavaScript.
- `scripts/e2e/e2e-marketing.mjs`: 320, 390, 768, 1280 and 1440px layouts;
  loaded Geist and both previews; no horizontal overflow; anchor offsets,
  keyboard-operated FAQs and both download destinations with JavaScript off.
- Product capture browser error log: empty. Visual review includes desktop,
  mobile, both app captures and the 1200×630 social card.

Local reproducibility and screenshots are under ignored `builds/landing-evidence`.
The tested static bundle is `builds/landing-production`; the isolated demo used
only to capture images is `builds/landing-app-demo` and must never be deployed.

The optional worker tool did not have conversation identity, so an independent
agent review was unavailable. No independent review is claimed.

## Publication

The user's request authorizes updating the existing Cloudflare site. Deployment
is separate from Git publication: these changes remain in the canonical `main`
working tree unless a commit/push is explicitly authorized. Wrangler's dirty
source metadata is used rather than describing this as a committed release.

Previous production deployment: `22a5add1-ee03-4323-8b78-19aca5d4628f`.
Preview deployment: `f268a5fc`, at
https://f268a5fc.wafra-app-azg.pages.dev. All five browser viewport checks passed
on this Cloudflare preview before production publication.

Production deployment: `734f91e1`, at
https://734f91e1.wafra-app-azg.pages.dev, published to the existing `main`
production branch. The canonical https://wafra-app-azg.pages.dev origin was
then checked directly, not just the deployment-specific URL.

Final production verification:

- All five responsive browser checks passed at 320, 390, 768, 1280 and 1440px,
  with JavaScript disabled, including real font loading, both app previews,
  anchor navigation, keyboard-operated FAQs and existing download destinations.
- The live root HTML, robots.txt, sitemap.xml, social PNG, favicon SVG and both
  app-preview PNGs returned HTTP 200. Their SHA-256 hashes exactly matched the
  tested files in `builds/landing-production`.
- Wrangler reused the same 81 uploaded files for production after preview
  validation. No source or asset changes were made between those deployments.
- Production screenshots, browser metrics and timestamped live artifact hashes
  are under `builds/landing-evidence/production`.

No Git commit or push was performed.
