# Bundled typefaces

Eight static instances, embedded at build time by the `expo-font` config plugin
in `app.json` and loaded at runtime by `useFonts` in `src/app/_layout.tsx`.

React Native applies no synthetic weight to a custom family on Android, so each
weight ships as its own file and its own family name — see `Fonts` in
`src/constants/theme.ts`.

| Family | Files | Source | Licence |
| --- | --- | --- | --- |
| Geist | Regular, Medium, SemiBold | Vercel, via Google Fonts | SIL Open Font License 1.1 |
| Geist Mono | Regular, Medium, SemiBold | Vercel, via Google Fonts | SIL Open Font License 1.1 |
| Noto Kufi Arabic | Regular, Bold | Google | SIL Open Font License 1.1 |

The OFL permits bundling these in the APK. Geist carries the interface text;
Geist Mono carries every figure in the app; Noto Kufi Arabic carries Arabic
copy — figures stay in Geist Mono there too, because money never reads
right-to-left.
