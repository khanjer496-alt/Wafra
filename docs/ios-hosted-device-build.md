# Hosted development signing for device QA

`ios-device-build.yml` is manual only. CEO authorizes signing account changes,
then dispatches on the merged workflow ref with a full merged release SHA and
`signing_approval=CREATE_QA_SIGNING`. The SHA must contain TestFlight 194's
`a51d0be2` source. No App Store submission occurs.

Both jobs use the `ios-device-qa` protected environment. It requires the
repository owner `khanjer496-alt` (the GitHub identity used for CEO approvals),
disallows administrator bypass, and permits only protected branches. CEO must
approve each build or separate cleanup deployment. Existing repository-scoped
EAS/ASC secrets are retained because the other release workflows use them;
this PR does not migrate or remove them. The environment gate protects these
two jobs, not access from every existing workflow in the repository.

The hosted macOS runner rebuilds `production-candidate` using the existing
`EXPO_TOKEN` EAS signing, which temporarily downloads EAS's distribution signing
material to the ephemeral runner. Its raw build logs stay private. The workflow
explicitly overrides both candidate autoIncrement settings to false in the
runner's `eas.json`, records original/overridden hashes, and requires both app
and widget versions to equal `app.json` at the pinned source commit. This does
not reserve or consume the next real TestFlight build number.

It then replaces the distribution signatures with development signatures.
Entitlements are intersected with the development profile; store-only
`beta-reports-active` is removed explicitly. Verification rejects every signed
key/value not granted by that profile, including unauthorized app/keychain
groups. There is no dev client, Metro dependency, founder grant or app-source
edit. Record results as **dev-signed build of <commit>**: a fresh rebuild of
that source, not the original TestFlight IPA, with different signing and
development push environment. This does not prove TestFlight distribution or
real sandbox purchasing.

The old development identity cannot leave the local keychain. With the existing
`EXPO_ASC_API_KEY_P8`, `EXPO_ASC_KEY_ID` and `EXPO_ASC_ISSUER_ID` secrets, the
runner therefore creates one new Apple Development certificate and three new
development profiles for the existing runner, app and widget bundle IDs. It
reads the two enabled devices from the existing Wafra QA UI Tests 2026-11
reference profile (`7996Y2NL26`, UUID `a57e79a7-02f7-49b5-808c-9e88b1e81cd8`).
Before creation it reads a paginated account inventory. IDs/types are recorded
in the cleanup receipt; full names are logged only to the encrypted
`signing-inventory.enc` audit for this Mac. Public logs contain counts and new
IDs only. It changes no existing profile, certificate, App ID or capability. New profiles
must match the new certificate, both reference devices, team, app group and
development APNs entitlement before use. A certificate-limit failure stops;
never revoke an existing identity to make room.

WebDriverAgent is App QA's exact upstream package version, 16.12.5, fetched
from npm with a pinned SHA-512 integrity check. Only runner signing settings
and its bundle identifier are set. The complete build-for-testing Products
folder is sealed, including the runner app, test plug-in, frameworks and
generated xctestrun. Its source tar SHA-256 and every regular product-file
SHA-256 are recorded. This is the upstream package route, rather than App QA's
locally patched tarball; both use the same version.

Before creating signing resources, the workflow fetches and verifies WDA,
builds its complete Products unsigned, validates the store IPA's signature,
and checks the exact app/widget bundle set and versions. After creation it
binds the new WDA profile and performs the incremental signed build, then
re-signs Wafra. A later signing failure can still leave new account resources;
each attempt creates a new set, recorded in the receipt. Inspect that receipt
before any approved retry, and use separate cleanup only with CEO go.

The #239 public recipient certificate `.github/android-artifact-recipient.pem`
is reused for CMS AES-256-CBC envelopes. Its private key stays on this Mac at
`~/.config/wafra-android-artifacts/recipient-key.pem`. Artifacts last one day and
contain only `*.enc` and `verification.json`; signed installers, profiles,
private keys, EAS logs and WDA logs never upload in plaintext. A separate
metadata-only `signing-receipt.json` is preserved for 7 days, including on
failure. Its pre-build inventory contains only IDs/types; the created
certificate's Apple-assigned name is recorded as SHA-256 for exact comparison,
never plaintext. Newly created generic CI-profile names and fingerprints are
retained. The public verification manifest excludes the pre-build inventory.
The full-name audit is encrypted and kept for one day, including on failure.
No keys, profile contents or device identifiers appear in plaintext artifacts.

Download only the exact dispatched run. Check encrypted SHA-256 against
`verification.json`, decrypt each file with OpenSSL 3, then check its plaintext
SHA-256 before extracting/installing. CMS does not authenticate its sender;
the verified GitHub run is the provenance boundary. Example (substitute the
download directory):

```sh
openssl cms -decrypt -binary -inform DER \
  -in Wafra-dev.ipa.enc \
  -inkey ~/.config/wafra-android-artifacts/recipient-key.pem \
  -out Wafra-dev.ipa
shasum -a 256 Wafra-dev.ipa
```

App QA installs using `xcrun devicectl device install app`, with no Apple ID or
TestFlight. A locked phone is reported and never unlocked by the agent. QA
covers icon, Erase with rows, first History import including balance message,
App Lock/Face ID and language switch, app-switcher/widget privacy, and lag.

The runner keychain/private key are removed at job end. The new Apple
certificate and profiles **remain active through the device pass**; revoking
early invalidates the installers. They are listed in `verification.json` or
the receipt. After App QA reports the iPhone pass complete, CEO separately
approves `ios-device-cleanup.yml`. Supply the original build run/attempt,
certificate ID, comma-separated profile IDs, App QA message UUID and
`cleanup_approval=DELETE_COMPLETED_QA_SIGNING`. The operator checks the actual
QA message; the workflow records its UUID but cannot verify OpenBot chat.

Cleanup requires the source run to be from main or the release branch, and
downloads that run's immutable receipt. It refuses IDs present
in the pre-build inventory. The certificate must match the receipt's ID,
SHA-1, serial, DEVELOPMENT type and Apple-assigned name SHA-256, and be linked only to
the recorded CI-named profiles. Before each profile deletion it re-reads the
exact ID, UUID, development type, certificate link and exact name ending in
`CI <run>-<attempt>`. Before certificate revocation it checks the identity again
and proves no remaining profile references it. Distribution certificates and
App Store/TestFlight profiles cannot pass these gates. Deleted/revoked IDs are
preserved even if a later cleanup step fails.

iOS Release downloads each build/cleanup receipt and encrypted audit within
the retention windows, keeps a local copy, and appends its created or
deleted IDs and run URL to `Shared/launch-review/ios-account-status.md` on this
Mac. The hosted runner cannot write that local file. A failed or cancelled run
is not a passing build; inspect its receipt before any approved retry to avoid
consuming signing-certificate slots. Never delete an existing identity to free
capacity. Complete normal cleanup within seven days of creation. If QA slips
beyond retention, the normal dispatch refuses; the local receipt/audit must
be reviewed with CEO before a separate recovery procedure, never used to
bypass the workflow guards. A stale receipt or partially completed cleanup
fails closed and needs review before another dispatch. An Apple POST can
succeed while its response times out; unrecorded resources then make the
linked-set check fail closed. Investigate the encrypted inventory, exact CI
names and Apple state with CEO before any manual recovery; never guess IDs.
