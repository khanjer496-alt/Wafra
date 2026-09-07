# Bundled merchant artwork

The catalogue contains 112 merchant/service identities as 128 × 128 PNGs
(836,276 bytes total; about 817 KiB). `sources.json` records each source URL, acquisition date,
transformation, final dimensions, byte count and SHA-256. Publisher app artwork
also records the reviewed app ID and publisher. These records describe provenance,
not a licence or an endorsement of Wafra.

## Runtime and matching

`src/components/ui/merchant-logo-assets.ts` imports only static bundled assets.
No logo service, website, Apple catalogue or CDN is contacted by this feature at
runtime. In native builds the images travel with the application/update, so a
first launch does not need to fetch merchant identities. The web build serves
the same assets from its own origin.

Matching is display-only: it never changes the ledger title, financial totals,
merchant grouping, categories, parser output or saved transaction. The lookup
uses explicit English and Arabic aliases, normalises case/spacing/Arabic
diacritics, and removes only listed city/country/terminal-number suffixes.
It deliberately does not search for brand substrings or remove arbitrary payment
gateway prefixes. Unknown or ambiguous titles retain their category icon:
`LuLu Exchange`, `Apple Cafe`, `Emirates NBD`, `PayPal Talabat` and
`Talabat Starbucks` are negative regression cases.

`MerchantAvatar` is shared by transaction rows, transaction details, the payment
agenda, bill/subscription details and top merchants in Spending. Category totals
continue to use category icons. Artwork is contained without recolouring on a
neutral plate. Failed images fall back immediately; changing merchant identity
resets the failed-image state. The existing row label supplies accessible text,
so the decorative logo is hidden from screen readers.

## Source and usage notes

59 assets were rasterised from Simple Icons' supplied SVGs, preserving their
supplied colour. 53 came from the reviewed publishers' publicly listed app icons,
resized proportionally. No third-party logo was redrawn or invented.

The 78 additions retain the upstream byte hash as well as the final PNG hash.
Where it reduced file size, PNGs were losslessly recompressed; decoded RGBA bytes
were compared before and after. This saved 145,988 bytes without changing pixels.
Publisher identities were matched by explicit app ID, name and publisher, not
the first search result. Unverified or unsuitable results were not added: for
example, a Decathlon fitness-coaching app is not a Decathlon retail logo, and
Microsoft Copilot is not the generic Microsoft merchant identity. Such names
continue to use category icons until suitable artwork is reviewed.

Simple Icons' project licence is not a blanket licence to all underlying brand
artwork or trademarks. Its disclaimer expressly requires considering individual
brand permissions and usage guidance. Public availability of publisher app
artwork likewise does not establish unrestricted redistribution rights.

References checked on 2026-09-07:

- Simple Icons: https://github.com/simple-icons/simple-icons
- Source disclaimer: https://github.com/simple-icons/simple-icons/blob/develop/DISCLAIMER.md
- Apple catalogue API: https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/Searching.html
- Each asset's acquisition source and publisher: `sources.json`.

This implementation does not claim brand-specific permission, sponsorship or
legal clearance. Review applicable brand-artwork and source terms before public
distribution; replace or remove any asset that is not suitable for that release.
Do not call a source manifest entry a permission record. Committing this catalogue
does not publish a mobile build or certify public-distribution permission.

## Maintaining the catalogue

For an addition or replacement, review the merchant identity and source first.
Use an unmodified-colour, proportional 128 × 128 PNG and update `sources.json`
with the exact final hash and source evidence. Add a literal Metro require and
explicit aliases in `merchant-logo-assets.ts`, not an interpolated path or URL.
Add positive and similarly named negative cases to `merchant-logos.test.js`;
update its deliberate catalogue count when adding/removing an identity. Expanded
aliases also have independent expected identities in
`scripts/test/fixtures/merchant-logo-identities.json`. Keep
the pack under the test's 1 MiB budget. Do not introduce network acquisition
into a render path, parser or user-data service.

Run:

```sh
node scripts/test/merchant-logos.test.js
npm run typecheck
npm run lint
# The complete browser runner also runs the merchant-logo suite:
npm run test:e2e
```

The focused browser suite is `scripts/e2e/e2e-merchant-logos.mjs`. It uses synthetic
demo data, tests light/dark rendering and identity consistency, checks bundled
image decoding, records external image requests, and exercises retained images
after going offline. It is not a substitute for a native-device release smoke
test or a public-distribution permission review.
