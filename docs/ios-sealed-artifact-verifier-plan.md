# Independent sealed-artifact verifier — preparation only

CEO25a516aa authorizes local preparation/review only. No publication/job/build,
local tests/helper invocation/download/range read, dependencies, resource poll,
CMS/key/decrypt/install/signing/Apple/account/device action. No new full checkout.

## Exact future input and accepted claim

Repository khanjer496-alt/Wafra/id1312657453; original successful manual run
43689629732/attempt1/workflow418243062/pathios-device-build.yml/source+workflow
f8addb95341dd7f661e47c18ec85da5eb019c1fe/release ref/job132737324650. Exact artifact
14152642203/namewafra-ios-device-sealed-43689629732-1/32607613bytes/API+ZIP SHA256
748b4a1367477e155e4c4a7a824d6d91537522ab737c3c07b6c09053c551f22d.

Future host validates successful one-job identity/required steps, sole artifact,
repo ids and source pins BEFORE download. Only this exact encrypted ZIP may be
streamed to a private owned temporary file, bounded to its pinned byte size and
hashed before ZIP parsing. Redirects are HTTPS/specified storage domains only,
bounded, and repository bearer headers never leave api.github.com. No artifact
code execution or app/tar extraction. Strict three fixed regular root files:
Wafra-resignable.tar.gz.enc, WDA-Products-unsigned.tar.gz.enc, verification.json.

The reviewed sealer produces two envelope files and one manifest. The upload
patterns sealed/*.enc +sealed/verification.json share root sealed, so the v4
uploader strips that root. See reviewed ios-device-seal.py and source workflow;
primary uploader behavior: https://github.com/actions/upload-artifact/blob/v4/src/shared/search.ts
and https://github.com/actions/toolkit/blob/main/packages/artifact/src/internal/upload/zip.ts .
Those sources support layout/deflate intent, not previously inspected actual ZIP
bytes: unsupported actual layout/compression stays a failure, no fallback.

EOCD single-disk/no-comment/exact3 count and format-derived central budget are
checked before ZipFile objects are built. Then exact unique names, regular kinds,
flags, compression(STORED/DEFLATED), local/central consistency, contiguous local
records/data descriptors and no trailing/prefixed/extra member data are required.
Duplicate/extra/link/traversal/encryption/unknown compression/oversize is refused.

## Explicit resource budgets and declaration limits

Producer code has NO finite plaintext archive, manifest/map count or path-size
ceiling. Do not invent one. This verifier uses a deliberate fail-closed budget
anchored to the exact pinned32607613-byte object: each expanded member and input
JSON <=that many bytes; total <=3times; central directory bounded by3 entries of
46-byte fixed headers +fixed names +two uint16 variable-length fields. JSON
nesting <=3 follows producer schema (top/provenance/override or top/files/entry).
Duplicate keys/NaN/noncanonical producer JSON/unknown fields are refused. Each
map pair needs >=70 bytes (one-character key and64hex value plus JSON syntax),
so map count <=floor(JSON budget/70); source file sizes are signed64-bit stat
DECLARATIONS. These budgets may reject a legitimate but unexpectedly large
manifest: fail/report; never resize/skip automatically. APIs have a separate1MiB
transport cap. No guessed input plaintext or ciphertext equality is imposed.

Strict schema wafra-ios-local-signing-inputs-v1; exactsource/workflow/run/label,
qaSigningPerformed=false; exact independently derived build provenance (version,
number194, frozen auto-increment override, original and rewritten EAS JSON SHA,
preflight flag). Both ciphertext streams are hashed/read-bounded and compared to
sealedSha256. Output distinguishes ciphertextBytesMeasured from
plaintextBytesDeclared /plaintextSha256Declared. Map hashes/counts are bounded
DECLARATIONS, never a verification of hidden plaintext or actual file trees.

Manifest has NO recipient field. The fixed source public-recipient SHA and
producer workflow/sealer/helper source pins are checked; no envelope/CMS
recipient is inspected. WDA package/version are pinned16.12.5 and its source
sha256 shape is checked as a declaration. Its input bytes are NOT available to
this verifier and are not independently hashed. The source workflow already
pins download SHA512, but that is source-record consistency, not this job's WDA
byte proof. No compiler/EAS/plaintext/CMS/signing/device/runtime/release proof.

## One output and provider acceptance gate

Only sealed-verifier-report/result.json may be uploaded. Output schema is
scripts/ci/ios-sealed-artifact-check.schema.json with matching explicit runtime
allowlist validation. Encoded output <=32768bytes, regular fixed report, no raw
paths/member maps/provenance/error/argv/response/secret text. Only fixed phases,
refusal enums, immutable ids, digests, counts, check booleans and explicit false
verification flags. Unexpected errors do not format exception prose.

Private owned input temp cleanup +absence check must succeed BEFORE candidate
publication; failure leaves candidateVerified=false/nonzero. Report publication
has an actual encoded-byte cap. Candidate=true is NOT accepted job success:
AFTER upload the final provider gate independently checks actual artifact id,
current run/repo/head/digest and provider size <=65536bytes. The immutable report
explicitly requires that successful gate; it cannot self-certify future upload
size. If verifier fails, later always-upload/gate cannot turn the failed job green.
Root must combine source/run/job conclusions, API metadata and independently
hashed tiny output ZIP before accepting this ciphertext-only evidence. No report
claims installer/plaintext authentication or authorizes the local phase.

## Finite tiny fake-case plan — 10 definitions, NOT RUN

1. Valid three-file opaque fake, measured/declaration distinction; extract APIs
   patched to refuse, yet parser must succeed without them.
2. Duplicate/extra/link/encrypted/unknown-compression ZIP mutations refuse.
3. Duplicate JSON keys/depth/NaN/unknown manifest fields refuse.
4. Source/run/QA/provenance/WDA package-version mismatch refuses.
5. Wrong ciphertext hash refuses.
6. Traversal/map count/digest declarations are checked without plaintext proof.
7. Exact download byte/digest failure occurs before any ZIP parser.
8. Private-temp cleanup refusal keeps candidate false; no accepted success.
9. Original identity failure prevents source/download calls.
10. Provider actual-size cap and output allowlist reject excess/unknown data.

Tests use tiny stored fake ZIP bytes/opaque strings, no generated keys/CMS,
network or native process. Quiet runner emits no raw unittest prose and passes
only if all10 execute/zero errors/failures/skips. Proposed future wrapper runs
these first; failure prevents the actual one-object download. No test ran locally.

## Future wrapper proposal, not execution grant

Existing registeredCI320673030/ci.yml on a distinct unmerged test wrapper,
manual-only, Ubuntu24.04 <=10min, contents/actions READ, same-repo ephemeral
GitHub token only, checkout immutable verifier source with credentials not
persisted; no dependency install/protected environment/EAS/WDA/macOS/secrets.
Fixed original object only. Run10fake cases then verifier, always upload only the
fixed JSON for1day, then actual provider-size gate. No retry/fallback/rerun.
Wrapper NEVER PR/merge. Publication/all inherited trigger audit and ONE-job GO
remain separate CEO decisions after exact Reviewer/Security/Grok code+plan
review. Real app/key/device/QA/Parser/Restore/build195/store holds remain.
