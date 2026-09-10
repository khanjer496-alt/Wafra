# Launch monitoring and rollback

For the first public release, use staged/phased rollout where the store supports
it. Record the exact source commit, store build/version code, EAS/GitHub build ID,
artifact hash and relay deployment ID before increasing rollout.

Monitor: store crash/ANR signals, purchase/restore failures, support reports,
parser-review volume, duplicate/missing transaction reports, relay health and
queue errors, and permission-policy/store-review messages. Do not log SMS bodies,
authorization headers, account numbers or ledger contents for observability.

Rollback order: stop rollout/pause release first; disable a faulty optional relay
feature server-side only when doing so cannot lose queued user data; ship a store
hotfix for native/config changes; use EAS Update only when the runtime fingerprint
is compatible and the change is JavaScript/assets-only. Never use OTA to change a
native permission, native module, SQLCipher configuration or store billing SDK.

Any parser incident should prefer “review/manual” over guessing. If a bank format
starts producing wrong entries, disable/route that format to review and preserve
the user's existing ledger rather than rewriting history automatically.
