# Private native-sim access-key delivery

Workflow dispatch inputs and run metadata are public on this repository. Never
pass a session key, private key or authenticated URL as an input. Log masking
alone does not make an input private.

This workflow accepts only `recipient_public_key`: the base64 encoding of an
RSA SPKI **public PEM**, with a 3072-4096-bit modulus. Generate a fresh recipient
pair locally for the session and keep its PKCS8 private PEM in an owner-only
directory and `0600` file. The private key never goes to GitHub.

The runner creates a random 256-bit access key immediately before starting the
auth gate. It registers that value for log masking, keeps it in a runner-only
`0600` file and encrypts a context-bound handoff with RSA-OAEP-SHA256. Only the
file path enters the broad job environment, so build/cache steps do not inherit
the plaintext value. The gate reads the private file; the proxy receives it only
at runtime.
Session creation refuses runner/step debug logging before generating a key.
Artifact `native-sim-key-<run-id>-<attempt>` contains ciphertext only and expires
after one day. The stream/control key remains usable only while its runner
session is alive. Normal statuses, summaries and outputs contain the bare
tunnel URL, never its key.

## Operator sequence

1. Use the reviewed, committed workflow revision. Generate a fresh local RSA
   pair; encode only the public SPKI PEM into `recipient_public_key`. Dispatch
   with ordinary public session/device/mode options. The upstream `native-sim`
   CLI's old `gate_token` dispatch contract is intentionally unsupported.
2. Read the run ID, attempt and source SHA from authenticated GitHub run
   metadata. Download the encrypted artifact for that exact run/attempt. Do not
   trust artifact filenames alone and do not take expected context from the
   ciphertext itself.
3. Run the local helper with **paths and public metadata only**:

   ```sh
   node .github/native-sim/decrypt-session-key.cjs \
     /private/session/private.pem /downloads/native-sim-session-key.enc.json \
     /private/session/access.key SESSION RUN_ID ATTEMPT SOURCE_SHA
   ```

   These are example paths/placeholders. The private key must be an owner-only
   regular file. The output directory must be owner-only and belong to the
   operator; the output must not exist. The helper verifies recipient and all
   context fields, writes `0600`, and never displays the value.
4. Hand App QA only the resulting file reference and public run/session/tunnel
   metadata. Never paste the plaintext key, private PEM or a key-bearing URL in
   chat, a PR, a status, logs or workflow inputs. Validate actual app installation
   and proxy readiness before calling the session ready.
5. After QA ends, stop the owned cloud session and remove the locally generated
   private material. Never reuse a key from an old or exposed session.

The artifact is confidential to the recipient, not a new trust source. Obtain
it through authenticated GitHub for the approved workflow and exact run. A
repository writer can alter a workflow; review the committed code before use.

This changes session access only. It does not turn the founder-unlocked simulator
into a production StoreKit build, supply sample data, or produce the store image
matrix. Those remain separate QA/capture requirements. Do not overwrite this
workflow with the upstream template without preserving the private handoff.
