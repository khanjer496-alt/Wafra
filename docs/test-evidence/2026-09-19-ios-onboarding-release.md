# iOS onboarding release checks

The first-run bank-message setup, history setup and import review now reuse the
current dark onboarding atmosphere and heading treatment. A scoped theme supplies
the same palette to nested text, controls, checklists and sheets without changing
the saved theme preference. Settings and Android retain their previous headers
and ordinary app theme. Onboarding origin is restored across Shortcut callbacks.

The history installer opens its approved HTTPS asset directly; inability to probe
the Shortcuts URL scheme does not block that download. Running a Shortcut still
checks availability. The working history v4 URL and installed name are unchanged.

Production now offers the current `Wafra Capture v2` future-message Shortcut and
its matching setup-check marker. Both old and new public shares were read: the
new share is Apple-approved, has 35 actions exactly matching the current
generator, and SHA-256
`c945c455b99703c99e87c1055594562f4798c4dc0d61c3bd950198d242116199`.
Existing legacy automation support remains in the protocol; no user setup
confirmation is reset.

## Source and rendered checks

- TypeScript and targeted ESLint passed.
- Setup UX (274), onboarding (117), accessibility (58), navigation (34), workflow
  source (7), render-cost (10), scoped-theme (3) and relevant interaction tests
  passed. The HTTPS install regression uses the current signed v4 URL with a
  failed scheme probe and separately verifies that running remains guarded.
- Independent review passed 42 theme, history-interaction, onboarding-recovery
  and Shortcut-name tests with no blocking findings.
- Public artifact validation passed for the signed history v4 asset and current
  future-message Shortcut. The production profile regression and all four
  legacy/current installed-name tests passed.
- An actual Expo web export was visually checked at 390px in light/dark system
  themes, at 320px in Arabic, and in ordinary light Settings presentation. The
  first render exposed a decorative gradient extending document width by 40px;
  clipping only its background layer fixed that without clipping scroll content.
  All four final captures had zero page errors and no horizontal overflow.

Local screenshots and the browser report are under
`artifacts/ios-onboarding-release-20260919/`. They are browser render evidence;
native availability was not simulated, so the browser displays the unsupported
platform message. They do not establish iPhone Shortcut execution or physical
Dynamic Type behavior. TestFlight processing, public-group access and a physical
device run remain separate release checks.
