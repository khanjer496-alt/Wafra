# Bundled typefaces

Eight active static faces are embedded by the `expo-font` plugin in `app.json`
and loaded by `src/components/app-root-layout.tsx`. The theme names match each
file's PostScript name; Android receives a separate family for each weight.

| Typeface | Active faces | Purpose | Licence |
| --- | --- | --- | --- |
| IBM Plex Sans | Regular, Medium, SemiBold | Interface and tabular money | SIL OFL 1.1 |
| IBM Plex Sans Arabic | Regular, SemiBold | Arabic interface and mixed Arabic labels | SIL OFL 1.1 |
| Geist Mono | Regular, Medium, SemiBold | Code and compatible editing fields | SIL OFL 1.1 |

Plex files are the original TTFs from the official
[IBM Plex repository](https://github.com/IBM/plex/tree/bf260093582f04622aacc1e9f9ca604d7ccd0c42),
pinned to that revision. `LICENSE-IBM-Plex.txt` accompanies them.

`src/constants/theme.ts` defines the family names. `ThemedText` selects Arabic
faces for Arabic text and allows a 1.5em minimum line height for their glyphs.
Money uses proportional interface faces with tabular numerals and preserves the
ledger currency's exact minor units.

Older Geist Sans/Noto Kufi files remain on disk during the visual migration but
are no longer in the native font plugin or runtime font loader.
