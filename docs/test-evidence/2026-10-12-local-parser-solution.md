# Practical route to on-device bank coverage

This document records the research prototype before app integration. The
subsequent production implementation and current checks are documented in
[private bank formats](2026-10-12-private-bank-formats.md). Statements below
about disconnected code and unimplemented UI describe that earlier snapshot.

The useful near-term route is personal format learning: the person confirms a
new bank alert's source fields and meaning, and a strict local matcher reads
later alerts with that same layout. Different purchase, transfer and cash
layouts need separate learning. This avoids waiting for a public corpus of
every bank. It does not certify every bank or justify automatic posting.

## What was established

The earlier model screen was not a suitable test of missing-field accuracy:
there were no independently labelled missing-merchant or missing-date
opportunities. Eighteen of20 missing dates had no full source year. Models
still made semantic mistakes; they remain unqualified. The correction is
documented in the original on-device AI evidence.

The existing `learned-alert-formats.ts` engine is real but disconnected from
the app. Source-free Review items cannot teach it retrospectively; plaintext
must be available in an explicit paste/teach flow or a carefully designed
source-free teaching capsule.

A new research replay used56 frozen source cases. Twenty-six had independent
principal/currency/direction labels suitable for human confirmation;14 could
be learned. Eight Saudi launch-route cases stayed excluded, and four other
cases were conservatively refused. Every accepted source reconstructed the
confirmed fields, and every generated amount-change variant read the new
amount correctly. This is14/26 learning acceptance, not100% bank coverage.
All14 accepted confirmations lacked independent merchant gold. Nine clearly
generated, augmented layouts separately demonstrated changed payee/date/
balance slots. They are not real unseen-bank messages.

The123 generated controls covered pending, decline, OTP, extra body/money,
changed source/direction/currency and invalid/future date variants; none
matched. Of770 comparisons with other original source cases, only17 shared a
sender and passed the route filter. None of those17 were independently
noncompleted controls. Cross-source rejection mostly demonstrates isolation,
not hundreds of same-bank semantic negatives.

The legacy engine stores literal anchor words. The bounded host prototype
instead stores device-keyed digests for anchors and sender binding, typed
slots and public currency metadata; it preserved replay results and retained
no clear literal anchors, sender or legacy IDs. This is an in-memory host
prototype. Secure device-key integration, lifecycle/restore validation and
shipping UI remain unimplemented.

Research artifacts:

- `artifacts/datasets/research/ondevice-solution-round11/diagnosis/`
- `artifacts/datasets/research/ondevice-solution-round11/teaching/`

A separate source-candidate-ID LLM comparison was interrupted at49/112 source
rows, after70 recorded calls. No final private output/summary was saved. Its
checkpoint cannot establish accuracy or improvement. Source/input freezes
remain, and its temporary model weights were released. Production guards and
app code were not changed by these experiments.

## Concrete implementation

1. An optional teach flow keeps one pasted alert ephemeral. The person chooses
   source-grounded amount, currency, payee/date if present, and event meaning.
   Unknown facts remain unresolved; absent dates are never invented.
2. Persist only bounded keyed structure and typed slots in encrypted local
   state. Bind sender/channel/account context; allow forget/block; handle key
   erase and device restore explicitly.
3. Validate with a second distinct received alert. Whole-message matching
   requires the same fixed wording; changed status/direction words and other
   controls invalidate the format.
4. Capture and history run this matcher while source is in hand. Matches
   enrich Review under the original event identity; the existing confirmation
   remains the ledger action. Never use the legacy learner's `post` outcome.
5. A compact trained source-role model can reduce first-time selection later,
   evaluated by held-out bank/template rather than random messages. It is not
   a requirement for the deterministic personal-learning route.

This is a feasible implementation route with a tested core prototype, not a
delivered end-to-end bank-teaching feature. No new app dependencies, native
runtime, commits, publication or cloud inference were added during this
follow-up.
