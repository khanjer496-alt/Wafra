# Android layout QA — 5 September 2026

## Device and scope

- Target: `emulator-5554`, `Wafra_Pixel`, Android API 36, native 1080×2400 resolution.
- Installed package verified as `app.wafra.android`, version 1.0.0, versionCode 23.
- Parent task identified the installed signed release artifact as `/tmp/Wafra-1.0.0-23-parser32.apk`; local artifact SHA-256: `685293e2521f36b62721e8925a620ab1bc17afc5427298a4957624e63e5495ff`.
- This is evidence for that installed build, not source changes made afterward.
- Used Argent discovery before every tap, automatic action screenshots, and idle waits after appearance/language/configuration changes. No screenshot coordinates were used. Screenshots below are unedited, full-scale Argent captures.
- Existing synthetic financial data was viewed only. No transaction, account, goal, review item, permission, or capture setting was added, edited, or deleted. No iPhone or simulator was touched.

## Results

| Surface | Coverage | Result |
| --- | --- | --- |
| Flow | English/dark; Arabic/light and dark; Arabic/light at font scale 1.3 | Amounts, category bars, period control, and mirrored navigation remain readable. At 1.3, August's Arabic chart label wraps within the word; see minor finding below. |
| Bills | English/dark; Arabic/light and dark; Arabic/light at 1.3 | Empty state, header, and three segments remain readable. Subscriptions, Cards, and Fixed segments all navigate successfully at 1.3 without altering data. |
| Wallet | English/dark; Arabic/light and dark; Arabic/light at 1.3 | Balance hierarchy and mirrored controls work. At 1.3, monthly-spending amounts in account subtitles are ellipsized; see finding below. Scrolling exposes the complete goal prompt and import-status footer above the tab bar. |
| Settings | English/light; Arabic/light and dark | Appearance/language switches work. App Light on a dark device leaves white system status-bar content on a pale background. |

### Findings

1. **P2 — Status-bar contrast ignores app Light appearance.** With device dark mode unchanged, select Settings → Light. After the screen settles, the time and system icons remain white against the pale app background. Reproduced on Settings and the other light screens. Evidence: [settings-light-en-statusbar.png](android-layout-shots/settings-light-en-statusbar.png).
2. **P2 — Arabic Wallet hides monthly-spending amounts at 130% text size.** The account subtitles visibly truncate the `AED 120` / `AED 12` spending information with ellipses. Primary balances remain visible, and accessibility discovery retains the complete subtitle, but sighted larger-text users lose that amount. Evidence: [wallet-light-ar-font130.png](android-layout-shots/wallet-light-ar-font130.png). Prefer an additional line or a separate amount field rather than truncating a financial value.
3. **P3 — Arabic month label breaks within a word at 130%.** On Flow, `أغسطس` wraps across two lines in its narrow chart column. It does not overlap the caption, but disrupts scanning. Evidence: [flow-light-ar-font130.png](android-layout-shots/flow-light-ar-font130.png).

No crash, blocked navigation, or unrecoverable content clipping was observed in this bounded pass. This is not a TalkBack spoken-output audit, every font-size/locale combination, populated Bills validation, or a new financial-correctness test.

## Representative screenshots

| Screen | English dark | Arabic light |
| --- | --- | --- |
| Flow | [flow-dark-en.png](android-layout-shots/flow-dark-en.png) | [flow-light-ar.png](android-layout-shots/flow-light-ar.png) |
| Bills | [bills-dark-en.png](android-layout-shots/bills-dark-en.png) | [bills-light-ar.png](android-layout-shots/bills-light-ar.png) |
| Wallet | [wallet-dark-en.png](android-layout-shots/wallet-dark-en.png) | [wallet-light-ar.png](android-layout-shots/wallet-light-ar.png) |

## Restored state and handoff

- Original appearance: **System**, following the dark device. Restored and verified in Settings.
- Original language: **System · English**. Restored and verified in Settings.
- Original `font_scale`: **1.0**. Temporarily tested 1.3, restored to 1.0 and verified through Android settings.
- Device remains at native **1080×2400**; no resolution changes were made by this QA task.
- Returned to **Home**. Capture still shows **ON**, one review remains, and the same four current-period activity rows remain visible. Settled Home still shows AED 132 spent: [home-restored-en.png](android-layout-shots/home-restored-en.png).
- No servers were stopped; device ownership returns to the main task for its scoped cleanup.
