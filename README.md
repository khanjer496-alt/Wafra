# Wafra — UAE Money Manager 🇦🇪

**Wafra** (وفرة — "abundance") is a personal finance app for the UAE, built with Expo SDK 55 and React Native. Track spending in AED, set monthly budgets, and get plain-language analysis of where your money goes. All data stays on the device.

## Features

- **Home dashboard** — total balance hero card, monthly income vs spend, smart-insight carousel, budget snapshot, and recent activity.
- **Transactions** — add income/expenses with UAE-flavored categories (DEWA-style utilities, Salik/RTA transport, telecom, charity/zakat, and more), searchable and filterable history grouped by day.
- **Smart insights** — an analysis engine that turns the ledger into readable observations: spending pace projections, month-over-month change, budget alerts, savings rate, top categories, and daily averages.
- **Analytics** — month-by-month donut breakdown, 6-month income/expense trend chart, and key stats (daily average, projected spend, net saved).
- **Budgets** — monthly limits per category with pace tracking, near-limit warnings, and over-budget alerts.
- **Wallet** — multiple accounts (bank / card / cash) with derived balances and net worth.
- **Beautiful UI** — dark-first fintech design with light-mode support, a floating pill tab bar with a raised action button, SVG charts, and Reanimated micro-animations.

The app ships with a deterministic UAE demo dataset (Carrefour, Careem, DEWA, Etisalat, Talabat…) so every screen is alive on first launch. Erase it or load it again from **Wallet → Data**.

## Running

```bash
npm install
npm run android   # or: npm run ios / npm run web
```

## Stack

- Expo SDK 55 (expo-router, Reanimated 4, react-native-svg)
- AsyncStorage persistence — no backend required
- TypeScript throughout (`npx tsc --noEmit` to typecheck)

## Structure

```
src/
  app/            # expo-router routes: (tabs)/, add-transaction modal, transactions list
  components/     # tab bar, transaction row, insight card, ui/ primitives (charts, icons…)
  constants/      # theme tokens (colors, spacing, radius)
  lib/            # store (context + AsyncStorage), insights engine, categories, seed data
```
