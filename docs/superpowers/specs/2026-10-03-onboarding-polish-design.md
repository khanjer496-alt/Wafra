# Onboarding polish — design (2026-10-03)

## Problem

The design-language-E onboarding read as confusing in two places the owner
called out, and in a few smaller ones:

- **Goals** did not say it was multi-select until a hint under the list; `+`
  icons looked like "add", and picked pills inverted to solid fills, so a list
  with several picked read as a stack of buttons.
- **Watch (budgets)** was a two-layer flow (pick tiles, then pick which tile
  the dial edits). Tapping an already-picked tile **unpicked it and dropped
  its limit**; editing needed a separate summary chip. The dial appeared under
  the grid, usually below the fold. A picked category left at 0 was silently
  not saved. The dial was 0–5,000 per turn and could not be typed into.
- **Name** showed currency "Not set", which only became a dead end two steps
  later on Watch.
- **Reminders** drew bills and card payments as filled cards like the one real
  switch (daily summary), although neither has a setting.
- Footers said "Continue" whether or not anything would be saved.

## Decisions (owner-approved)

- Scope: all onboarding steps, UI only. No new settings or stored fields.
- Budget step: rows + quick amounts (not a sheet, not one overall budget).
- Reminders: make "included" obvious; real per-type toggles are a follow-up
  (they would need new preferences, scheduler gating and Settings switches).

## Design

1. **Shared row** (`e-choice-row.tsx`): outline at rest; tinted with a solid
   outline when picked/active; a 26pt check circle; `checkbox` role.
2. **Copy rules**: "Not now" only declines a permission; "Skip for now" leaves
   a step empty. Buttons name their outcome.
3. **Goals**: "Pick as many as you like…" directly under the headline, which
   becomes the live "goes to the top of your Home" line once one is picked.
   The button reads "Skip for now" with nothing picked.
4. **Watch**: six category rows. Tapping a row only opens/closes it (one open
   at a time; all closed when the step is entered). An open row has four
   quick amounts (`WATCH_QUICK_REFERENCES` 250/500/1,000/2,000 AED-sized,
   scaled with `typicalMinorAmount`), a typed field read with
   `parseLocalizedMajorToMinor`, and ± steps of 50 AED-sized. A row with a
   limit shows it and has Remove. A category is in the draft exactly when it
   has a limit (`withWatchLimit`). The one button is `watchFooterAction`:
   "Save N limits", "Continue" when only a removal is pending, else "Skip for
   now". Saving is unchanged: `watchBudgetChanges` upserts/removes, the
   currency is pinned before the first budget, the preview writes nothing.
   Without a currency, a "Choose currency" action sits above the rows. The
   dial stays in the Limit sheet.
5. **Name**: a missing currency is an outlined "Choose currency ›" row. No
   guessed country→currency table (only UAE/Saudi carry verified currency
   data).
6. **Reminders**: bills and card payments as a plain checked list under
   "Included when notifications are on"; daily summary is the only filled
   card, marked "Optional", with the switch.
7. Unchanged: bands, colours, headline type, progress dots, step order, the
   manual path's content and everything saved.

## Testing

- `scripts/test/repair/onboarding-e.test.cjs`: `withWatchLimit`,
  `watchFooterAction`, EN/AR `watchSave` plurals, currency-scaled amounts.
- Journey harness (`onboarding-extreme-*`): quick amount → ± → typed figure,
  tap-to-close never removes, resumed rows closed, Skip/Save labels.
- `scripts/e2e/e2e-onboarding.mjs`: expanded state, one deliberate step.
- Web screenshots EN/AR, light/dark, 320px largest text; iOS simulator.
