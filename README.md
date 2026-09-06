# Wafra — Private Money Manager

## Working copy

Develop from **`main`**, tracking **`origin/main`**, in
`/Users/naserkhanjar/Documents/Wafra`. Android, iOS, the web preview and tests
use this same checked-in source. The old repair/release/validation branches
are not alternative versions to continue developing.

See [repository workflow](docs/repository-workflow.md) for verification,
release entry points and recovery of older work.

**Wafra** (وفرة — “abundance”) is a private personal-finance tracker for users anywhere, built with Expo SDK 55 and React Native. Manual budgeting and expense tracking work independently of country or bank support. Where supported, Android reads bank SMS and bank-app money notifications on-device. On iOS, a user-created Shortcuts automation passes selected bank Messages to a protected local queue; Wafra parses them on the iPhone and deletes its queued message copies after a durable local result. Optional cloud imports and trusted-device delivery use a separate relay.

The normal web export is Wafra's public SEO/GEO landing page. Production builds
require the owned HTTPS origin so canonical, social and sitemap URLs cannot be
published with a placeholder. The finalized public root is static HTML/CSS and
ships no JavaScript; non-root QA routes retain asynchronously split app bundles
and are marked `noindex` but are not access-controlled:

```sh
EXPO_PUBLIC_WAFRA_SITE_URL="$WAFRA_SITE_ORIGIN" npm run web:export
EXPO_PUBLIC_WAFRA_SITE_URL="$WAFRA_SITE_ORIGIN" npm run check:web-seo
```

See [the SEO/GEO audit](docs/seo-geo-audit.md) for verified coverage and the
remaining deployment and legal blockers.

## Features

- **Automatic capture** — native Android SMS/notification readers and an iOS Shortcuts automation feeding the local ledger. iPhone history import is a separate, user-started Shortcut operation.
- **UAE parser corpus** — executable public-example ENBD, ADCB, FAB, Mashreq,
  ADIB, Liv, and Wio formats, plus a clearly labelled synthetic RAKBANK grammar
  probe pending an attributable message body; includes Arabic, cards, transfers,
  statements, foreign currency, and balance snapshots.
- **Home dashboard** — capture health, saved-this-month hero, income/spend, leaving-soon obligations, an actionable insight, and recent activity.
- **Transactions** — searchable/filterable history grouped by day, with manual correction available as a fallback rather than the primary workflow.
- **Smart insights** — an analysis engine that turns the ledger into readable observations: spending pace projections, month-over-month change, budget alerts, savings rate, top categories, and daily averages.
- **Flow analytics** — month-by-month breakdown, trend charts, limits, comparisons, daily average, projected spend, and net saved.
- **Budgets** — monthly limits per category with pace tracking, near-limit warnings, and over-budget alerts.
- **Wallet** — accounts, credit/debit cards, statement dues, goals, derived balances, and net worth.
- **Multi-currency** — original amount, AED conversion, rate source/date, and currency exposure summaries.
- **Supplemental imports** — opt-in forwarding addresses plus conservative text-PDF, CSV, and TSV statement upload; raw email and statement content is discarded after parsing.
- **Trusted devices** — encrypted future-capture fan-out with owner/member roles, expiring invites, device revocation, and no financial data in invite links.
- **Fintech interaction system** — dark-first with full light mode, live English/Arabic RTL, semantic native haptics, reduced-motion support, Reanimated motion, SQLCipher persistence, and biometric lock.

The app ships with a deterministic UAE demo dataset (Carrefour, Careem, DEWA, Etisalat, Talabat…) so every screen can be alive from the first-launch sample-data choice.

## Running

```bash
npm install
npm run android   # or: npm run ios / npm run web
npm run check
npm run release:check  # intentionally fails until production ids, URLs and legal fields exist
```

iOS local capture needs a native build and the published Wafra Local Capture
Shortcut configured through `EXPO_PUBLIC_WAFRA_SHORTCUT_URL`. History import
uses its own artifact and `EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL`. Follow the
in-app setup to install the Shortcuts and create the selected-sender automation.
Local capture does not require a relay or an EAS push project.

For optional cloud imports and trusted-device delivery, see `server/README.md`
for relay, D1, push, Cloudflare Email Routing, retention, and secret configuration.
Use actual published artifacts and deployment values; placeholder configuration
does not establish release readiness.
Platform submission gates are documented in `docs/play-release.md` and
`docs/app-store-release.md`.

## Stack

- Expo SDK 55 / React Native 0.83 / React 19.2
- Expo Router, Reanimated 4, local iOS and Android Expo modules
- SQLCipher on native; AsyncStorage only for the web QA/demo surface
- Cloudflare Worker + D1 relay for optional email/statement imports, trusted-device delivery, and legacy capture compatibility
- TypeScript throughout

## Structure

```
src/
  app/            # Expo Router routes and first-class setup/import surfaces
  components/     # tab bar, rows, sheets, and UI primitives
  constants/      # theme tokens (colors, spacing, radius)
  lib/            # parser, capture, encrypted store, relay, analytics, and seed data
modules/          # Android readers and iOS local capture/history modules
server/           # optional cloud import and trusted-device relay
```
