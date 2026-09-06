# Android redesign preview 2 — download provenance

This is a distribution record for the existing signed preview APK, not a new application build or a production release.

- Original build run: https://github.com/khanjer496-alt/Wafra/actions/runs/34059274731
- Original build workflow commit: a96b233c9f63981e0f3eab93ab3feff0da73db56
- Artifact ID: 9997212895 (wafra-redesign-preview-apk)
- Original artifact ZIP SHA-256: ec2c2f1a83c87839df9b7096226ac1cbd281447833850b78900a3d511c670984
- App identity: app.wafra.android.preview
- Display name: Wafra Preview
- Version: 1.0.0, preview versionCode 2
- ARM64 phone and x86_64 emulator release binary; embedded application bundle.
- Includes Arabic amount-entry repair. No demo data preloaded. OTA updates disabled.

The delivery process extracts the original artifact, verifies SHA256SUMS and the APK signature, and uploads the APK unchanged. It never rebuilds or re-signs the APK.

Install the .apk release asset directly. Keep the original Wafra installed; preview data is separate and does not migrate automatically.

This tag is a delivery/provenance anchor. GitHub's automatic source archives at this tag are NOT the reconstructed redesign source. The original build workflow and the source-manifest.json release asset specify how to reproduce the candidate. Later cross-platform validation fixes are not silently included in this already-built binary.

Build and initial emulator-launch checks passed for the original run. Extended interaction checks, physical-phone SMS accuracy/performance, and upgrade/data-retention acceptance are not implied. This preview must not be described as production-ready.
