# Onboarding "poster energy" design

Date: 2026-09-16. Branch: `feat/onboarding-money-reveal` (worktree `onboarding-real`).
Approved direction: 4 of 4 mockups (`Wafra Poster Energy` artifact).

## Goal

Make the first-run journey feel alive and outcome-first, in the spirit of the
poster-style onboardings the founder shared, without leaving Wafra's identity:
dark green world, Geist and Geist Mono, the real `WafraMark`, real bank
identities per country, no bank login, no ledger writes.

## What changes

All work is presentation. Steps, navigation, persistence, capture, and copy
keys that the journey tests depend on stay as they are.

1. **Atmosphere.** The onboarding root gets a full-bleed gradient (deep green
   at the top fading to the app background) and two soft colour discs (green,
   amber) behind all steps. Built from `expo-linear-gradient` and plain views.
   No blur, no images.
2. **Welcome scene.** Three alert rows for the user's region fly in from
   off-screen, tilted, settle into a stack, and gently bob. Category stickers
   pop onto them. A total rises underneath ("3 alerts, 1 picture", currency
   net). Bank identity comes from `onboardingBankRegion` (device region, then
   market) and renders the Brandfetch logo through `verifiedLogoUrl`; when the
   logo cannot load, a badge in the bank's brand colour with its initials is
   shown instead of an empty tile.
3. **Focus chooser.** Four 2x2 tiles, each tinted and carrying a small object
   (bars, due-date coin, in/out lanes, card stack). Tiles stagger in; the
   chosen tile lifts and shows a check. Radio semantics and option order stay.
4. **Tracking chooser.** Same tile language. The bank-apps tile shows the
   three regional logos; spreadsheet, finance-app and none get objects. A
   one-line outcome under the grid changes with the selection. Order stays
   bank-apps, spreadsheet, finance-app, none.
5. **Preview step.** Becomes a "building your view" beat: breathing mark with
   an orbiting dot, three ticks that appear in sequence, then the chosen view's
   preview card fades in. Runs about 1.8 s; under Reduce Motion everything is
   shown at once.
6. **Capture scene.** Regional logos in a row above the incoming-alert line.

## Constraints

- Only `src/components/onboarding/alive-scenes.tsx`, welcome styles and the
  atmosphere mount in `src/components/onboarding-gate.tsx`, new strings in
  `src/lib/i18n.ts`, and the tests that read those files.
- Honour `reducedMotion`; use `start`/`end` and RTL-aware offsets.
- Keep every animation on the UI thread (reanimated shared values), no timers
  in render, no per-frame JS work, so Android stays smooth.
- Amounts are examples, currency from the region; merchants are generic
  ("Coffee shop", "Utility bill"), never one country's brands for everyone.

## Verification

Onboarding suites (`onboarding.test.js`, `onboarding-actions`, journey
navigation, notifications, workflow-source, redesign-contract-recovery,
screen-section-contract, accessibility-layout), `tsc`, `eslint`, and web
screenshots in English and Arabic.
