# E2E suites (Playwright against the web export)

    npx expo export --platform web --output-dir /tmp/wafra-web
    python3 -m http.server 8126 --directory /tmp/wafra-web &
    node scripts/e2e/e2e-smoke.mjs      # every screen and detail sheet, import
                                        #   page, paywall, trial expiry, founder unlock
    node scripts/e2e/e2e-period.mjs     # period selector correctness across screens
    node scripts/e2e/e2e-navigation.mjs # presses every pressable on every screen

`bash scripts/e2e/run.sh` does the export, the serve and all three.

## Why the navigation suite exists

The smoke suite READS screens. It never operated one, and the app's two most
expensive defects were both taps that led nowhere: a budget warning's "See the
breakdown" pointing at `/budgets`, which was never a route, and then most of
Flow's "Worth knowing" cards pointing at `/stats` and `/budgets`. Neither is
visible to an assertion about what a screen says.

The navigation suite enumerates every `[tabindex]`/`role=button` that is
actually on top of a screen, presses it, and requires that the app is not on
Unmatched Route, not blank, and threw nothing. It then unwinds — browser back
for a pushed route, the sheet's own close control for a sheet — rather than
reloading, because reloading between 40 controls costs two minutes a screen.

Two things it learned the hard way:

- **A sheet is `[role="dialog"]`.** "Can I still see a control I had before"
  is not a usable test for "is the sheet gone", because the sheets are labelled
  from the same small vocabulary as the screens under them — the BottomSheet
  backdrop is labelled "Dismiss" and so is the button on Home's insight.
- **A press can take the next control away.** Bills' "Cards" segment replaces
  every subscription row; "+ Income" on the entry form replaces every expense
  chip. When a control cannot be found, the suite re-enters the screen and
  looks once more, so it covers all of a screen's modes rather than whichever
  one the previous press left it in.

And one thing to keep in mind when adding to it: pressing everything on
Settings leaves every setting wherever the last press put it, so
`resetPreferences()` runs after that sweep and puts them back. It used to
matter far more — Settings carried all 28 bars of the money-month picker, and
without the reset the arithmetic assertions read an empty month and passed
vacuously ("the hero equals In minus Out (0 − 0 = 0)"). That picker is gone,
but the sweep still moves theme and language.

Both expect the app on http://localhost:8126 and chromium at
/opt/pw-browsers/chromium (set executablePath for other machines).
Native-only paths (SMS inbox scan, notification listener) cannot run on
web — cover changes to those with unit tests in scripts/test/.

Two matching notes, both learned the hard way:

- Caps labels are a CSS `text-transform`, so the DOM text is still title case.
  A **string** passed to `getByText` matches case-insensitively; a **regex**
  does not unless you write `/i`.
- Every screen stays mounted behind the current one, so `.last()` on a text or
  label match often lands on a hidden screen. Both suites hit-test with
  `elementFromPoint` and click only what is actually on top; tabs are reached
  by `getByRole('tab')`.

## Known: hydration error on a cold route load (not ours)

Loading any exported route directly (`/settings.html` rather than tabbing to
it) throws React #418, "Hydration failed because the server rendered HTML
didn't match the client". The suites navigate in-app, so they never hit it.

It is not app code. Exporting the stock Expo SDK 55 template — no Wafra
source at all — with the same `web.output: "static"` reproduces a
byte-identical error tree, bailing at the same expo-router Suspense boundary
under `NativeSafeAreaProvider`:

    <SafeAreaProvider initialMetrics={{...}}>
      <NativeSafeAreaProvider style={[...]} onInsetsChange={function}>
        <View style={[...]}>
          <div dir={null} ref={function forwardRef} className="css-view-g...">
    -       <Suspense>

It is independent of `prefers-color-scheme` (both light and dark reproduce),
so it is not the theme hook. React discards the server HTML and re-renders
that tree on the client: the page is correct, just not reusing the SSR
markup. Nothing to fix here — revisit when Expo/expo-router updates. Chase it
again only if it starts appearing on native, where it would mean something
else entirely.
