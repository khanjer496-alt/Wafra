# E2E suites (Playwright against the web export)

    npx expo export --platform web --output-dir /tmp/wafra-web
    python3 -m http.server 8126 --directory /tmp/wafra-web &
    node scripts/e2e/e2e-smoke.mjs    # every screen: import page, paywall, trial expiry, founder unlock
    node scripts/e2e/e2e-period.mjs   # period selector correctness across screens

Both expect the app on http://localhost:8126 and chromium at
/opt/pw-browsers/chromium (set executablePath for other machines).
Native-only paths (SMS inbox scan, notification listener) cannot run on
web — cover changes to those with unit tests in scripts/test/.

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
