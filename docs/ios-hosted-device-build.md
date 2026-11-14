# Hosted development signing for device QA

`ios-device-build.yml` is manual only. CEO authorizes signing account changes,
then dispatches on the merged workflow ref with a full merged release SHA and
`signing_approval=CREATE_QA_SIGNING`. The SHA must contain TestFlight 194's
`a51d0be2` source. No App Store submission occurs.

The hosted macOS runner builds `production-candidate` using the existing
`EXPO_TOKEN` EAS signing. It then replaces the distribution signatures on that
same app with development signatures. There is no dev client, Metro dependency,
founder grant or source edit. Record results as **dev-signed build of <commit>**:
same app code, different signing and development push environment. This does
not prove TestFlight distribution or real sandbox purchasing.

The old development identity cannot leave the local keychain. With the existing
`EXPO_ASC_API_KEY_P8`, `EXPO_ASC_KEY_ID` and `EXPO_ASC_ISSUER_ID` secrets, the
runner therefore creates one new Apple Development certificate and three new
development profiles for the existing runner, app and widget bundle IDs. It
reads the two enabled devices from the existing Wafra QA UI Tests 2026-11
reference profile (`7996Y2NL26`, UUID `a57e79a7-02f7-49b5-808c-9e88b1e81cd8`).
It changes no existing profile, certificate, App ID or capability. New profiles
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

The #239 public recipient certificate `.github/android-artifact-recipient.pem`
is reused for CMS AES-256-CBC envelopes. Its private key stays on this Mac at
`~/.config/wafra-android-artifacts/recipient-key.pem`. Artifacts last one day and
contain only `*.enc` and `verification.json`; signed installers, profiles,
private keys, EAS logs and WDA logs never upload in plaintext. A failure can
upload `signing-receipt.json`, containing only IDs needed for later cleanup.

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
the failure receipt. After QA, CEO approves deletion/revocation of only those
new IDs. A failed or cancelled run is not a passing build; inspect its receipt
before any approved retry to avoid consuming signing-certificate slots.
