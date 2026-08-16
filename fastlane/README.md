# Store listing automation

Fastlane uploads the localized listing package generated from
`docs/store-metadata.json`. EAS Submit remains responsible for application
binaries. Neither lane submits an app for review or promotes an Android build.

The Apple lane is a transition fallback. The preferred Apple workflow is the
pinned and guarded `asc` integration in `docs/app-store-connect-cli.md`.
Fastlane remains the Google Play listing uploader.

Run `npm run store:plan` first. Live writes additionally require the exact
one-command confirmation value documented in `docs/aso-automation.md`.

Secrets must stay outside the repository. Use an App Store Connect Team API
key for Apple and a least-privilege Google Play service account for Google.
