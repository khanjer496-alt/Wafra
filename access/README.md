# Wafra complimentary access Worker

The Android client connects to https://wafra-access.khanjer496.workers.dev. It is separate from the bank relay, has no D1, storage, queue, auth service or customer-data bindings. Run tooling from this directory with its own configuration. Check that the chosen rate-limit namespace ID is unused by other Workers on the account before release.


The standalone Worker can issue a 15-minute Pro lease on an empty HTTPS `POST /v1/access/complimentary`.
The Android client sends the offline-issued 43-character base64url credential only in
`Authorization: Bearer <code>`. Never put it in a URL, form body, ticket, log, app
binary or source control. This grant has no account, device or ledger access. It
uses the existing `ACCESS_RATE_LIMITER` with separate fixed keys for valid and invalid attempts per Cloudflare location.
An absent, malformed or mismatched digest, or a missing/failing/throttled limiter,
denies the request. Responses include `Cache-Control: no-store`.

**Enable only for an authorized release.** Generate 32 cryptographically random
bytes offline, encode them as unpadded base64url, and keep the resulting code in
owner-controlled private storage. The Worker secret is the lowercase, 64-character
SHA-256 hex digest of the 43 ASCII characters, **not** the credential itself or
its underlying 32 bytes. For example, on an offline owner-controlled computer,
change the destination below to a new private file outside the repository. This
prints only its digest and refuses to overwrite an existing credential:

```sh
python3 - /path/to/private/wafra-access-code <<'PYCODE'
import base64, hashlib, os, secrets, sys
code = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=")
with os.fdopen(os.open(sys.argv[1], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as f:
    f.write(code)
print(hashlib.sha256(code).hexdigest())
PYCODE
```

After separately deploying the reviewed route, set `COMPLIMENTARY_ACCESS_SHA256`
on that same Worker/environment using Wrangler's interactive secret prompt, and
paste only the digest. Share the code itself only with the authorized recipient
through the intended private channel. A reviewer using it sees the same Pro
features as a subscriber.

**Rotate or disable.** Replace the secret with the digest of a fresh code to
rotate, or delete the secret to disable. When that configuration reaches the
active Worker, the old code cannot issue or renew leases. An already issued
lease can provide up to 900 seconds of offline access; it is not recalled
remotely. Verify activation with the actual release and endpoint, without
printing the code or using verbose HTTP tracing. This Worker has its own deployment; its activation does not require a deployment of the bank relay.

Complimentary access uses two constant rate-limit keys, one for valid credentials and one for invalid attempts. Neither key contains an address, device ID, credential or its hash.
