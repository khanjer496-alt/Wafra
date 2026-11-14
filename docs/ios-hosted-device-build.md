# Hosted inputs and local development signing for device QA

CEO decision `2b895064-0dd8-44a9-aa67-5f579f75087e` replaces runner-created
certificates with local signing using existing DEVELOPMENT certificate
`2DY4K5NUMM`, SHA-1 `8E7181E5C2CB4F0C6967BA5B9CCEB437E8158161`.
Never revoke this certificate. No new GitHub secret or key upload.

## Hosted inputs

After Reviewer and Security Reviewer approve the exact PR head and CEO merges,
dispatch `ios-device-build.yml` on the release branch with a full merged app
`source_commit` (initially `7d93ea4237a88a13583c69e0533e762180b21ec5`) and
`signing_approval=BUILD_ONLY_NO_QA_SIGNING`. Input names remain unchanged for
the registration-only main stub. Old CREATE_QA_SIGNING dispatches refuse.

The ios-device-qa environment still requires owner approval, protected branches
and no admin bypass. iOS Release approves only after CEO go, using the owner
UI and quoting the go message ID. Shared owner identity proves the account
approved, not an independent person; do not bypass or change settings.

The runner builds a re-signable IPA with existing EAS distribution signing,
freeze-credentials and the recorded no-autoIncrement override. It creates no
QA signing resources and receives no ASC signing API secrets. EAS temporarily
downloads existing distribution material; raw build logs stay private and are
deleted. No store submission. App/widget bundle set and versions are verified.
Pinned upstream WDA16.12.5 is built with CODE_SIGNING_ALLOWED=NO, preserving
complete Products including the runner, test plug-in, frameworks and xctestrun.

The one-day wafra-ios-device-sealed-<run>-<attempt> artifact contains only
Wafra-resignable.tar.gz.enc, WDA-Products-unsigned.tar.gz.enc and verification.json.
The manifest schema is wafra-ios-local-signing-inputs-v1 and records run/source/
workflow provenance, plaintext/encrypted SHA256, build provenance, WDA source
hash and complete product-file hashes; qaSigningPerformed=false. Tar packaging
dereferences links; local extraction refuses links and special files.

CMS uses the existing #239 recipient; its private key stays on this Mac.
Download only the exact dispatched run, verify GitHub artifact archive digests,
compare encrypted hashes, decrypt locally with OpenSSL3, then compare plaintext
hashes. CMS does not authenticate its sender; the exact GitHub run is the
provenance boundary. Never upload plaintext products, keys, profiles or logs.

## Local profiles

Using local asc automation, first save an account inventory and read reference
profile7996Y2NL26 and both ENABLED device records. Verify the existing certificate
ID, DEVELOPMENT type, fingerprint and expiry. Do not create/revoke certificates,
change devices or modify existing profiles.

Create exactly three IOS_APP_DEVELOPMENT profiles for app.wafra.qa.wda.xctrunner,
app.wafra.ios and app.wafra.ios.widget, bound to2DY4K5NUMM and both iPhones.
Names end in ` QA YYYY-MM-DD`. Persist each returned ID immediately; a POST
timeout needs an inventory comparison, not a blind retry. Read back exact
ID/type/name/UUID/certificate/device relationships. Log IDs and paths in
Shared/launch-review/ios-account-status.md.

Save <bundle>.mobileprovision and receipt.json locally, files0600/directory0700.
The receipt contains team, certificateId, identitySha1, certificateReused=true,
date and exact two deviceUdids. Its profiles map bundles to {id,uuid,name,sha256}.
Device identifiers and profiles stay local; no key material enters receipts.

## Local signing

Security Reviewer must approve scripts/ci/ios-device-local-sign.py before its
first execution. It is offline: no ASC calls or resource mutations. Pass
--inputs-dir, --profiles-dir, fresh --output-dir, --source-commit,
--workflow-commit, --run-id, the public DER --certificate-file and the ORIGINAL
--key-file path, plus --reference-profile for the unchanged7996Y2NL26 profile
(UUIDa57e79a7-02f7-49b5-808c-9e88b1e81cd8). New profiles must match its exact
two devices, not just a device count. Never place private-key bytes in tool arguments, browser forms,
scripts, reports, artifacts, new files or GitHub secrets.

It validates archive/product hashes and exact provenance, refusing traversal,
links, special files and unexpected files; checks bundle set/versions and all
profiles against the pinned identity, team, UUID/name, both devices, entitlements
and expiry. The public certificate is matched to the original file key in memory.

A fresh temporary keychain uses a random password generated in-process; all
command output is captured. The original key is imported directly as
non-extractable, together with the public certificate; the partition list is
set only on the temporary keychain. Every private codesign call uses its exact
--keychain path. No login/default keychain, existing ACL or search-list command
is used. No p12 or private-key copy is created.

Nested frameworks/dylibs/test bundles are signed first, then widget/app and WDA
with their matching profiles. Entitlements intersect profile grants; store-only
beta-reports-active is removed and development APNs is required. Signatures,
leaf certificate fingerprints, UUIDs and versions are verified. The fresh
keychain is deleted in finally, including import/signing/SIGTERM failures.
A cleanup failure fails the run. SIGKILL/power loss cannot run finally; inspect
only this script's fresh temporary keychain after that kind of interruption.

Only after verification AND keychain deletion are signed Payload, Products,
Wafra-dev.ipa, WDA-Products.tar.gz and verification.json published to the fresh
output directory. The report records source/workflow/run, existing identity,
profile IDs/UUIDs, package SHA256 and signed WDA file hashes. No key is copied.

## QA and profile-only cleanup

Hand App QA Lead the signed paths, full commit, identity, UUIDs and hashes.
App QA installs via devicectl; report device lock/trust gates, never bypass them.
Label dev-signed rebuild of <commit>, not the original TestFlight binary or
purchase proof. Required QA: icon, Erase with rows, first History import including
balance, App Lock/Face ID, language, app-switcher/widget privacy and lag.

After App QA is done, get a separate CEO cleanup go. Delete ONLY those three
recorded new profile IDs, re-reading exact ID/UUID/name/development type/cert link
and proving absence from the before-inventory immediately before deletion.
Log each deletion. Keep2DY4K5NUMM active. Do NOT use ios-device-cleanup.yml for
this route: that legacy workflow handles disposable runner-created certificates;
its guards remain unchanged and do not authorize revoking reused certificates.
