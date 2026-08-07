# Wafra — UAE Money Manager 🇦🇪

**Wafra** (وفرة — “abundance”) is an automatic personal-finance tracker for the UAE, built with Expo SDK 55 and React Native. Android reads supported bank SMS and bank-app money notifications on-device. iOS uses a user-created Shortcuts automation to send selected bank alerts to a privacy-minimizing relay that parses in memory, discards the source body, and seals only structured rows to the user's devices.

## Features

- **Automatic capture** — native Android SMS/notification readers and an iOS Shortcuts relay with wake-only background notifications containing no financial data.
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
- **Supplemental imports** — opt-in forwarding addresses for bank email and text-based PDF statement upload; raw email/PDF content is discarded after parsing.
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

iOS automatic capture additionally needs a deployed relay and EAS push project:

```bash
EXPO_PUBLIC_WAFRA_RELAY_URL=https://relay.example.com
EXPO_PUBLIC_WAFRA_SHORTCUT_URL=https://www.icloud.com/shortcuts/...
EXPO_PUBLIC_WAFRA_PROJECT_ID=00000000-0000-0000-0000-000000000000
```

See `server/README.md` for D1, Cloudflare Email Routing, retention, and secret configuration. These values are intentionally not given fake production defaults.
Platform submission gates are documented in `docs/play-release.md` and
`docs/app-store-release.md`.

## Stack

- Expo SDK 55 / React Native 0.83 / React 19.2
- Expo Router, Reanimated 4, native Expo modules, local Android Expo modules
- SQLCipher on native; AsyncStorage only for the web QA/demo surface
- Cloudflare Worker + D1 relay for iOS/email/PDF and trusted-device delivery
- TypeScript throughout

## Structure

```
src/
  app/            # Expo Router routes and first-class setup/import surfaces
  components/     # tab bar, rows, sheets, and UI primitives
  constants/      # theme tokens (colors, spacing, radius)
  lib/            # parser, capture, encrypted store, relay, analytics, and seed data
modules/          # Android SMS and bank-notification native modules
server/           # privacy-minimizing iOS/email/PDF relay
```
