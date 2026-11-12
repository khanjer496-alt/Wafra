# Approved screen-copy fixes — WSC-02/03/04/08

Prepared 9 November 2026. WSC-01 import consent wording is owned separately by
Android and was not edited here.

The local free-capture period now shows the saved first-launch deadline, with
local date and time, on Pro, Settings and onboarding. The same copy explains
that after day 3 automatic capture needs Pro, while manual entry, pasted alerts,
statement imports and backup stay free. No subscription starts automatically.
Internal `trial` identifiers still name the existing grant calculation; they
do not describe a store introductory offer in the rendered copy.

Pro and its Settings sheet disable purchase until the store is configured,
the selected offer and legal links exist, and no billing action is in flight.
Plan prices remain the exact store-returned strings and are visually emphasized;
cadence, renewal terms, Restore, Terms and Privacy remain on the purchase surface.
No price was invented or changed.

The Accounts credit-row meaning and figure share a single text run, on their
own line. Compact screens use a smaller bold figure to keep the pair together;
the statement status has its own full-width line. Financial classification and
amounts are unchanged. An unknown credit balance retains its dash placeholder.

Arabic inline, static, hero and rolling ledger figures use number then ISO code,
with bidirectional isolation. Spending legends and rows use that same ordering.
Number conventions and stored currency/minor units are unchanged. Store prices
are not passed through this ledger formatter.

## Checked locally

- Full app TypeScript and targeted ESLint passed (existing effect warnings remain).
- Functional checks cover the fixed deadline on day zero/day two/expiry, invalid
  saved timestamps, unavailable purchase controls, legal/renewal/price rendering,
  English/Arabic owed grouping and inline/hero/rolling money consistency.
- The 119-test copy/presentation gate passed; 43 affected cases also passed
  after the final unknown-balance preservation and onboarding price-emphasis changes.
- The browser money assertions retain exact minor-unit checks while accepting
  the approved Arabic suffix order and bidi isolates. The previous prefix-only
  assertion rejected the correctly displayed Arabic figure in CI.
- The current web export builds. Its validation used a temporary local Metro
  dependency-path override for the shared node_modules directory; it was restored.
- At 320px, the English owed line fit. The final Arabic owed line had equal
  scroll/client widths (192px) and no horizontal page overflow. Arabic Accounts
  hero, rows and Spending legend/rows used number-then-code ordering.
- The Arabic Pro web state displayed the explicit saved deadline and after-day-3
  line, Restore and legal links; unavailable Buy was disabled and untabbable.

These browser checks used synthetic data. Font requests reported ERR_CACHE_MISS,
so they do not establish production font fidelity, native Arabic shaping or
native safe-area behavior. No web capture is a replacement store screenshot.

## Pending native evidence

App QA Lead has the retest/capture handoff. All store screenshot replacements
remain pending a current native Release build: both languages, both requested
sizes, current UI, joined Arabic, hamza spelling and full-resolution inspection.
See `docs/store-assets/appstore-recapture.md` for the 32-capture matrix and
provenance requirements. Native loaded-plan prices, day-zero/day-two/expired
screens, 320/390 widths and light/dark acceptance still need candidate evidence.
No screenshot was fabricated, uploaded or submitted by this change.
