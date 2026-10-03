# September 30 release follow-up

## Backend deployed

The merged audit revision `420b73e502c3c4559c0d3c2ff4745ecd8f16f673`
was deployed from an exact clean source archive using existing local Cloudflare
OAuth. GitHub dispatch `36737262809` stopped before mutation because repository
Cloudflare credentials were absent; it did not apply a migration or deploy code.

The existing remote D1 database applied
`2026-09-30-statement-import-bindings.sql` through `npm run deploy`'s predeploy
migration step. The migration receipt and table were verified remotely.
Worker version: `7445705c-b7ac-4495-9ac0-6fc6c62980b3`.
Endpoint: `https://wafra-relay.khanjer496.workers.dev`.

A temporary synthetic device exercised the live service: health, pairing,
two-row CSV import, decryption through shipping cryptography, stable row
ordinals `[0, 1]`, idempotent retry, rejection of changed interpretation with
HTTP 409 `statement_options_conflict`, acknowledgement and device deletion.
No real user records were inspected and no secrets were changed.

## App changes

See [custom categories](custom-categories.md) and
[tester Pro policy](tester-pro-builds.md). APK dispatch must request
`auto_pro=true`, `founder_unlock=true`, `bundle=false`. The TestFlight build
uses `history-beta`. Public production settings remain explicitly separate.

Signed artifacts and Apple processing are separate verification steps from
source tests. Physical-phone Shortcut capture must be tested on the installed
release; a successful setup test is not proof of receiving a real bank alert.
