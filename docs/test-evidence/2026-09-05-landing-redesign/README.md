# Finalized landing redesign · 5 September 2026

Prepared for the existing Cloudflare Pages project `wafra-app`, public origin
https://wafra-app-azg.pages.dev. This is local pre-deployment evidence; the release
thread owns commit, deployment and replacement of the APK URL after upload.

## Final source

- `src/marketing/home.module.css`, `home.web.tsx`, and `content.ts` (first feature
  card only beyond the earlier privacy correction).
- `public/wafra-app-home.png`: real iOS simulator Home, dark theme, synthetic
  demo ledger. `public/wafra-app-bills.png`: real Bills, light theme, same ledger.
  Both are 1206×2622. No merchant artwork, refresh overlay or Settings breadcrumb.
- `public/wafra-social.svg` and `.png`: new 1200×630 card, original Wafra W,
  outlined local IBM Plex type; no external imagery. PNG is rendered from SVG.
- Four original OFL-licensed Plex TTFs and their licence in `public/fonts`.
  Root-relative static font URLs work after JavaScript is removed.

The design adopts clear hierarchy and product-led presentation from official
Things, Flighty and Copilot pages without copying claims, assets or awards:
https://culturedcode.com/things/, https://flighty.com/, https://www.copilot.money/.

## Verified finalized output

Stable source snapshot: `/tmp/wafra-ui-polish-runtime`.
Finalized export: `/tmp/wafra-new-brand-web`, served locally on port8172.
Clean transform cache, `EXPO_PUBLIC_WAFRA_SITE_URL` set to the production origin,
then `scripts/finalize-web-seo.mjs` run on the export.

- `scripts/check-web-seo.mjs` passes against this finalized export: canonical,
  sitemap, social image, metadata, two product images, three FAQs and existing
  beta destinations are present. Root contains exactly two JSON-LD scripts and
  no executable JavaScript.
- In-app browser verified four font faces registered and loaded with that static
  HTML; no runtime font loader is required. Earlier relative CSS URLs and the
  intermediate runtime-font-loader approach were superseded before final proof.
- No horizontal overflow across94rendered descendants at320,390,1280and1440px widths.
- At320px, Questions navigation and the first native FAQ disclosure work with no
  JavaScript. The question remains below the sticky navigation (384.59px versus
  nav bottom113px).
- Real screenshots loaded at their expected intrinsic dimensions. New previews
  contain category icons rather than restricted merchant artwork.
- Focused marketing ESLint, diff checks and all5web-SEO unit checks pass.
- Independent read-only review covered layout, copy, privacy, links and asset
  dimensions. Font loading and intrinsic-size findings were corrected; root
  additionally verified the actual finalized static font behavior in-browser.

`mobile-320.png`, `mobile-390.png`, `desktop-1280.png` and `desktop-1440.png` show the finalized static page. Viewport
was reset after responsive testing. Source hashes accompany this report.

## Publication handoff

The APK button still targets the existing public APK at this checkpoint. The
release task will replace it only after the new verified artifact exists, update
its corresponding checker expectation, export/finalize again and deploy. Do not
present the proposed new APK URL as downloadable before that upload succeeds.
This page does not claim the outstanding iOS larger-history/locked-capture fixes
are complete, nor does UI evidence establish physical-device capture reliability.
