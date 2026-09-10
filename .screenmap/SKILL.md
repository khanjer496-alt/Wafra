# Wafra Screenmap guidance

Screenmap is used here for launch UI review, not for financial-data testing.

## Safety and data

- Capture only the synthetic demo ledger provided by `EXPO_PUBLIC_WAFRA_SCREENMAP_DEMO=1`.
- Never import a phone backup, SMS corpus, diagnostic export, real bank alert, contact, account number, credential, or personal file.
- Never tap destructive controls such as erase/delete-account/delete-card while exploring.
- Never make purchases, subscription changes, external requests, relay pairings, or Shortcut installations.
- Do not change parser, reconciliation, money, persistence, billing, privacy, or capture behavior for a screenshot.

## Product baseline

- The approved visual language is **Ledger & Light**: limestone/charcoal surfaces, restrained hierarchy, Geist-family typography and Wafra's existing mark.
- Review the product as a global personal-finance app. Arabic is supported, but do not frame the product as MENA-only.
- Prefer fewer, clearer decisions over adding dashboard cards or explanatory copy.
- Preserve the four primary tabs: Home, Spending, Bills, Accounts.
- Treat Activity, merchant drill-downs, transaction detail/editing, cards, transfer review, imports and Settings as secondary routes.

## Launch review order

1. Home
2. Spending: Categories, Activity, Trends and category detail
3. Bills: upcoming, subscriptions, utilities/telecom and cards
4. Activity / Transactions: default, searched, filtered and empty
5. Merchant detail
6. Accounts and payment cards
7. Transfer review
8. Settings: Preferences, Imports, Privacy & data, Help
9. Import / iOS setup
10. Add/edit transaction, review alerts, categorisation, accuracy and Pro
11. Loading, empty, permission, error and confirmation states

## What to evaluate

For every captured state, check:

- Is the first thing the person sees the thing they came here for?
- Is there one obvious primary action rather than competing actions?
- Are totals, labels and time periods unambiguous?
- Can secondary explanation be removed, shortened or moved behind details?
- Are touch targets, safe-area spacing and bottom-sheet actions comfortable on a real phone?
- Does the screen still make sense with long numbers and Arabic text?
- Does the screen use existing Wafra primitives instead of inventing a new card/button style?

## State notes

- The Screenmap simulator starts with synthetic demo money and is already onboarded so deep links can reach the real screens.
- First-run onboarding is intentionally verified by `scripts/e2e/e2e-onboarding.mjs` with isolated empty storage; do not use real data to reach it.
- `/merchant` and transaction drill-downs are query/data dependent. If a deterministic deep link cannot land on a meaningful state, leave it for a committed flow rather than inventing identifiers.
- iOS-only capture/setup screens may show platform-specific availability. Record the visible state; do not pair a relay or install Shortcuts.

## Feedback format

When an agent lane is enabled later, keep notes short and decision-oriented:

- **Keep** — already launch-ready.
- **Fix** — objective issue such as clipping, hierarchy, dead space, duplicate copy or inconsistent component use.
- **Ask** — subjective product decision that should be shown to the user before changing.

Do not redesign a screen merely to make it look different.
