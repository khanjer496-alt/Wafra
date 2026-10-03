# Home header pattern — 27 September 2026

The reported Android header matched the legacy profile fallback: five existing
tiles drawn across a fixed twelve-cell board, including a plain nameless square.
The gaps were intentional empty cells, not a failed image download.

Home now packs existing tiles into one row for up to six tiles, or two balanced
rows for larger sets. The complete twelve-tile composition remains unchanged.
A nameless Home anchor shows the original Wafra mark. No profile answers,
categories, budgets, or money are created or changed. Onboarding, recap, and
the privacy-redacted lock pattern retain their fixed-grid behavior.

Validation before installers:

- Pattern and lock suites: 15 tests passed, including legacy layout, bounded
  counts, immutable inputs, full-profile equivalence and existing privacy checks.
- Browser: six synthetic profiles (bare, legacy, full; English and Arabic)
  passed exact artwork bounds, brand/initial rendering, and RTL checks.
- Whole-Home browser regression: five cases, 218 assertions passed, including
  larger text, moving/hiding the greeting and resetting the saved layout.
- Type checking passed; scoped lint has no errors and one existing Home hook
  dependency warning. Independent source/visual review found no blocking issue.
- Review caught a shared alignment rule; centering is now restricted to the
  toolbar so a moved greeting retains its original alignment.

Browser evidence: `/private/tmp/wafra-compact-header/` and
`/private/tmp/wafra-compact-header-home-layout/`. Native installer acceptance and
public TestFlight availability are separate checks recorded with the release
artifacts; APK 352 and TestFlight 170 predate this header correction.
