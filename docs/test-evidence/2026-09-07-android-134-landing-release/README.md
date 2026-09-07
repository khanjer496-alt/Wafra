# Android beta 134 and refreshed landing page

## Published artifacts

Android package `app.wafra.android`, version 1.0.0 (134), ARM64, Android API 24+.

- Source: `67f996b24c28a1fe584e86e9bbe207a3f49c11ef`.
- Successful APK workflow: https://github.com/khanjer496-alt/Wafra/actions/runs/34144403697.
- Public beta release: https://github.com/khanjer496-alt/Wafra/releases/tag/android-clarity-67f996b.
- APK: https://github.com/khanjer496-alt/Wafra/releases/download/android-clarity-67f996b/Wafra-android-67f996b.apk.
- Size: 56,514,565 bytes.
- SHA-256: `cef7539d45ee25770d85996212212c8754356b5cf8ecb9d97aceb6d31634058f`.

`apksigner verify --verbose --print-certs` passed. The signing certificate matches the previously published `android-redesign-preview-2` certificate (`782b21c38c20f60425b171255718df54629c2909f3273c53e81d31fdbe3b446b`). `aapt` verified version, package, ARM64 architecture, API levels, non-debuggable release and the private dataSync history service. SQLCipher and release signing passed in the build workflow. No Play Store or iOS release was initiated by this task.

The APK is pinned to the reviewed redesign/history revision. A concurrent session's later 112-brand merchant catalogue on main is not included in this APK.

## Landing page

Marketing source commit: `36c6d56` (pushed to main).

- Canonical production: https://wafra-app-azg.pages.dev.
- Design gallery: https://wafra-app-azg.pages.dev/#inside-wafra.
- Tested preview deployment: https://c8f06dcc.wafra-app-azg.pages.dev.
- Production deployment: https://f79228da.wafra-app-azg.pages.dev.

Preserved the approved Claude Ledger & Light brand, existing headline, feature stories and privacy copy. Updated the Home/Bills hero screenshots, added the Home/Spending/Bills gallery and changed the Android download to the verified beta above. TestFlight's existing public link is unchanged.

App images are screenshots of the actual app at the APK's exact commit with synthetic demo data, not generated concept images or personal financial records. The static output was assembled from that isolated source archive plus the explicit reviewed marketing files, avoiding concurrently edited working-tree code. The same frozen output was uploaded to preview and production.

## Verification

- App/Worker type checks and scoped marketing lint passed.
- 161 regression/workflow tests passed.
- 41 focused app browser checks passed against the pinned source.
- 10 marketing unit checks and 27 static-export SEO checks passed.
- Both preview and canonical production passed all five browser widths: 320, 390, 768, 1280 and 1440 pixels, with JavaScript disabled. Checks included loaded screenshots/fonts, no horizontal overflow, sticky-navigation clearance, keyboard FAQs, the new gallery and exact download links.
- The canonical production HTML, two stylesheets, four product screenshot files, social assets, favicon, robots and sitemap were compared byte-for-byte with the tested output and matched. The public APK returned HTTP 200 and the expected content length.
- The APK revision's GitHub CI `check` job passed. The overall CI run is not claimed green: its older broad browser suite still has outdated assertions. A local follow-up passed 14 reporting-period checks and six persistence checks; the broad smoke suite reached completion with 56 passes and two failures (selected-month accessibility output and the old Wallet balance caption).

No physical Android device was connected. Background SMS history behavior, screen-lock continuation and real-device throughput still require installation testing. A signature match establishes update-key compatibility; it is not device execution evidence. Force-stop/process death is not the same as ordinary app backgrounding, and checkpoint recovery should be tested separately.
