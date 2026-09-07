# Wafra landing correction — original Claude Ledger & Light

## User direction and source of truth

The user rejected the forest/leaf landing redesign: it was not the original
Claude Wafra design, and the previous copy was better. This correction restores
that copy rather than inventing another tagline or feature narrative.

- Original design: `934e5cb14bfaf8dedd1b6adb0a7bcbd87d10267f`, specifically
  `src/constants/theme.ts` and `src/components/wafra-logo.tsx`.
- Prior landing copy: `3d390633a72d665f74e6b27e6f13f2176087431a`,
  `src/marketing/home.web.tsx` and `src/marketing/content.ts`.
- Headline: **Know your spending. Plan what comes next.**
- Supporting line: **Spending, budgets and bills in one private ledger.
  No bank login needed.**
- Previous three feature stories, privacy explanation and FAQ copy are retained.
- Limestone `#F4F1EA`, light ink `#16130F`, charcoal `#14120F`, restrained
  green `#1F6B52`; Geist, Geist Mono and Noto Kufi Arabic. Sections are grouped
  with thin rules, not decorative rounded cards or a forest-green privacy block.

Do not replace this reference with the later native app's forest/leaf tokens.
The website's exact two-stroke W-arrow is isolated in
`src/marketing/wafra-mark.web.tsx` so this landing-only correction does not
change native app code or inherit a competing native redesign.

## Product imagery and assets

The Home light and Bills dark images are unmodified restored-app browser
captures from GitHub run `34064897324`, artifact `9998664929`,
`wafra-ledger-light-restoration-evidence`. Its `committed-sha.txt` records
`fa3c47f711297c06d229f8ac0da6b6089b87a845`. They are 390×844 previews with
synthetic sample data, not native release verification or App Store assets.

The favicon and social card use the actual original W-arrow paths. The social
card repeats the earlier headline. Fonts are served locally; their accompanying
licences are retained. TestFlight and APK destinations are unchanged.

## Scope and reproducibility

Only marketing components/styles/tests, public assets and these evidence notes
change. Native screens, app theme/logo, parser, money calculations, encryption,
dependencies, build configuration and server code are not changed. No Git
commit/push, native release or production OTA is authorized by this work.

The rejected page is backed up under the ignored
`builds/landing-ledger-evidence/before-correction/`. Source backups carry a
`.snapshot` suffix so TypeScript does not compile obsolete copies.

Build: `builds/landing-ledger-production`, with
`EXPO_PUBLIC_WAFRA_SITE_URL=https://wafra-app-azg.pages.dev` and
`EXPO_PUBLIC_WAFRA_E2E_DEMO=0`. Finalize using `scripts/finalize-web-seo.mjs`.
Browser checks: `scripts/e2e/e2e-marketing.mjs`. The ignored
`builds/check-ledger-local.mjs` starts and cleans up its own static server.
`builds/verify-ledger-live.mjs` compares live artifact SHA-256 hashes with the
tested output.

The optional independent worker tool returned `WORKER_IDENTITY_LOST`;
independent agent review was unavailable and is not claimed.

## Validation and publication

Local validation completed:

- Nine marketing/SEO unit checks passed, including original copy, original W
  paths and the existing platform/privacy wording safeguards.
- Focused ESLint and application TypeScript checks passed.
- Real Expo static export completed with the demo flag disabled, followed by
  the production SEO finalizer and all 27 export/SEO checks.
- Chromium checked 320, 390, 768, 1280 and 1440px with JavaScript disabled:
  original headline, three original feature stories, loaded Geist/Geist Mono/
  Noto Kufi Arabic, limestone background, both actual 390×844 previews,
  zero horizontal overflow, sticky-nav anchor clearance, keyboard-operated
  FAQs and unchanged exact beta-download destinations all passed.
- Desktop/mobile hero, feature and mobile privacy screenshots were visually
  inspected. The 1200×630 social card and both source app previews were also
  visually inspected. Evidence is in `builds/landing-ledger-evidence/local`.

Cloudflare publication completed on the existing `wafra-app` project:

- Preview: `bb0d4f2f`, https://bb0d4f2f.wafra-app-azg.pages.dev, branch
  `landing-ledger-correction`. All five browser checks and exact live-file
  SHA-256 comparisons passed before production publication.
- Production: `091ab43c`, https://091ab43c.wafra-app-azg.pages.dev, branch
  `main`. Wrangler reused all 84 uploaded files; the bundle was not changed
  between preview validation and production deployment.
- Canonical production origin https://wafra-app-azg.pages.dev was then checked
  directly at all five viewport widths with JavaScript disabled. Every browser
  assertion passed. Its root HTML, both stylesheets, two app previews, favicon,
  social PNG/SVG, robots and sitemap returned HTTP 200 and SHA-256 hashes exactly
  matching the tested local output. Evidence is in
  `builds/landing-ledger-evidence/production`.

Final protected-path comparison against HEAD was clean for `src/app`,
`src/components`, `src/constants`, `src/lib`, `modules`, `server`, package files
and `app.json`. Final `git diff --check` passed. HEAD remains
`3d390633a72d665f74e6b27e6f13f2176087431a` on `main`; no Git commit or push was
performed, and the separate native restoration branch was not merged.
