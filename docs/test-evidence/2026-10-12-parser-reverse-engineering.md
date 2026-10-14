# Automatic bank parsing: shipped-app research and THX-01

12 October 2026. SMS and inference stay local. This investigation inspected
actual shipped Android artifacts and ran local candidates; no competitor app
was installed or launched, no financial text was sent to an inference service,
and no competitor implementation or model was incorporated into Wafra.

## Findings before THX-01

**Microsoft SMS Organizer 1.1.273:** the verified APK contains a native
`libsmstee.so` engine and separate transaction, balance, bill, classifier and
OTP models. The transaction model is 37,779 bytes compressed, expanding to
156,960 bytes. Its header specifies `en-IN`. Ghidra analysis of the actual
ARM64 body establishes a pipeline of typed token extraction, primitive and
composite entity detectors, sequence relationships, confidence filtering and
output patterns. This is an architecture to reproduce independently. The
artifact does not establish Arabic or UK/US/Jordan/Europe accuracy.

**FinArt 5.6.2:** signature-verified current and older artifacts show a local
template parser. Current original DEX references establish template text →
regex compilation → capture groups → field-order/type metadata. A separate
API downloads templates, while merchant enrichment has a separate network
path. No remote template library was fetched, and no claim is made that the
whole app keeps all data local. For Wafra, a similar maintained rule catalog
could distribute public rules while all SMS parsing remains on the device.

**Open implementations:** the MIT ExpoTransactionSmsReader was executed against
56 frozen source reports. It parsed nine, matched six scorable amount/currency
pairs, missed all fourteen Arabic cases and returned success for one payment
confirmation request. It supplied no new merchants through Wafra's existing
source checks. MIT Umber implements local category learning, rather than SMS
field extraction. A GLiNER2 financial extractor has real ONNX assets, but its
published graph/weight total is approximately 1.845 GB, with English/India and
synthetic evaluation limits. These do not supply a ready worldwide parser.

A clean-room typed-relationship prototype was also built and evaluated on
60 frozen original bodies. It added no independently correct fields on the
40 claimed-received/phone-collected originals. It remains an experiment; its
generated checks and unlabelled proposals are not market coverage.

## THX-01, supplied by the owner

THX-01 is an Apache-2.0 decision model with public weights. The pinned model
has 321,908,998 parameters and 643,835,524 bytes of FP16 weights, plus a
34,363,188-byte tokenizer. The publisher lists eighteen training languages,
including Arabic. Those language and benchmark claims do not establish banking
accuracy. No published quantized, ONNX or Core ML artifact was found in the
pinned repository inventory.

The SDK audit found a trained choice head. Its number helper generates regex
candidates and defaults to whole-unit rounding; its excerpt helper uses two
rounds of choices without an explicit not-found option. Compatibility adapters
can retain raw documents in a global cache. The controlled probe bypassed those
helpers and used exact source candidates plus `none` through direct choice
inference, with a complete local model directory and network connections blocked.

The actual CPU run completed 60 sources and 174 decisions with no inference
errors or truncation. Median time per source was 397 ms, p95 817 ms, peak RSS
1.182 GB. Cold SDK model construction took 302 seconds. These are Mac host
measurements, not phone measurements or the publisher's GPU latency.

On 40 claimed-received/phone-collected originals, the fixed configuration read
11 of 25 labelled principals and nine of 28 directions, versus the current
generic baseline's 24 and 27. Two principal selections were wrong; abstentions
accounted for much of the lower recall. It added no independently correct
fields in that lane. This does not establish that THX cannot help: the one
baseline-missed principal was absent from its candidate menu; all eight
labelled counterparties were absent from the counterparty menu; dates and
completion status lacked independent gold. This was a bounded configuration
screen with important ceilings, not a universal model evaluation.

## Recommended direction

Use Wafra's existing exact money/date readers and source checks as the base.
The most concrete automatic architecture found is a compact local entity
parser with maintained bank-format packs. Personal teaching can cover gaps.
A trained model such as THX can be evaluated for ambiguous roles or unfamiliar
wording, with an explicit abstention option and independently labelled new
opportunities. It should earn adoption through measured gains over the base
parser, then pass phone latency/memory and monetary checks.

The new automatic catalog/entity architecture and THX phone runtime are not
delivered or qualified by this research. The already implemented personal
teaching flow is documented in
[private bank formats](2026-10-12-private-bank-formats.md). This investigation
does not certify bank-wide launch coverage or change the existing UAE/Saudi
shipping paths.

## Reproducible evidence

All retained artifacts are under
`artifacts/datasets/research/parser-reverse-engineering-20261012/`:

- `microsoft/findings.safe.json`: package identity, verified signature, model
  metadata, native Evidence IDs and original artifact hashes.
- `finance-apps/REPORT.md`: current original DEX instruction references,
  template update flow and a small runnable static DEX reader.
- `opensource/REPORT.md`, `PROTOTYPE.md`: pinned licenses/implementations and
  the executable clean-room experiment.
- `evaluation/README.md`, `RESULTS.safe.json`: independent source gold,
  provenance lanes, span-coordinate repair and benchmark limitations.
- `finance-apps/compact-extractor/thx/REPORT.md`: SDK source audit and pinned
  metadata; `thx-01/model-download.safe.json`: locally verified weights.
- `thx-01/runtime/README.md`: offline CPU reproduction; `evaluation/thx-score.safe.json`:
  independent scoring, candidate ceilings and all input/code/output hashes.

Primary public references: [Microsoft Garage](https://www.microsoft.com/en-us/garage/profiles/sms-organizer/),
[THX model and code](https://huggingface.co/doofz/THX-01),
[THX SDK](https://pypi.org/project/thx01/), and
[THX API documentation](https://api.hal-x.ai/docs/thx-01/).
