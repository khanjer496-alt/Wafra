# Known banks for iOS accounts (design, 2026-09-20)

## Problem

iOS 26's Find Messages entity exposes no sender, so accounts minted from an
iOS history import get a bank name only when the alert body claims one
("your ADIB … card"). Emirates NBD, Liv, ADCB, FAB and some HSBC and Mashreq
formats never name the bank, so their accounts show as "Account •1234" with no
logo, and the user has no way to fix that. Transactions are unaffected.

## Design

1. **State.** `knownBanks: string[]` on `AppState` (bank names from
   `MARKETS[].banks`), default `[]`, persisted with the rest of the meta state,
   validated on restore as an array of non-empty strings; unknown names are
   dropped on read. Empty means not asked or skipped.
2. **Setup step.** In `src/app/ios-setup.tsx`, a "Which banks text you?" step
   (existing keys `iosBanksTitle`, `iosBanksBody`, `iosBanksSelected`,
   `iosBanksNext`, `iosBanksSkip`) shown before the capture and history
   sections can be started, multi-select over the active market's banks, with
   Skip. Saving calls `setKnownBanks(names)`.
3. **Store action `setKnownBanks(names)`.** Stores the list. When exactly one
   bank is chosen, every existing account with no `bankName` is labelled with
   that bank's name and colour (account name prefix unchanged). With several
   banks, accounts are left for the picker.
4. **Planner.** In `buildImportPlan`, when a card account would be minted with
   no bank and `state.knownBanks` holds exactly one name, that bank supplies
   `bankName`, the "<Bank> Card •1234" name and the colour. Body rule and
   sender still win when they resolve. Several known banks: no change.
5. **Account picker.** The long-press sheet on an account (cards and wallet)
   gains "Set bank", opening a single-choice list: the user's known banks
   first, then the rest of the active market, then "No bank". The choice
   calls `editAccount(id, { bankName, color })`.

Out of scope: Android, settings re-ask, statement import.

## Tests

- backup validation accepts `knownBanks: ['ADIB']`, rejects non-arrays and
  non-string entries; unknown names are dropped on hydrate.
- `setKnownBanks(['ADIB'])` labels only bank-less accounts;
  `setKnownBanks(['ADIB','FAB'])` labels none.
- planner: bank-less card minted as "ADIB Card •4417" with one known bank; no
  bank with two; body/sender resolution unchanged.
- source-text checks that the setup screen renders the step and that the
  account sheets offer "Set bank".
