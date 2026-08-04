# Corpus fixtures

Repository-supplied redacted bank-alert fixtures, in the format the app's
**Improve accuracy** screen exports. Long digit runs are masked, so these
files must not carry full account/card numbers, customer names, phone numbers,
or other directly identifying customer data. The `····` runs are export
masks, not text a bank sends.

New rows must be public examples with sensitive values replaced, or synthetic
grammar probes that are labelled as synthetic. Never add an original,
unredacted message body. The test harness reads the fixtures in memory and
does not persist their raw bodies.

## Evidence class is part of the fixture

Every row carries its evidence class, and the classes are not
interchangeable: a *public example* is ground truth about what a bank sends,
a *synthetic grammar probe* is our reconstruction of what we believe it
sends. Lose that distinction and the parser gets tuned against its own
assumptions while the corpus still reads as green — so the labels are
asserted, not merely written down here.

`uae-bank-formats.js` is the executable, bank-keyed acceptance corpus for
ENBD, ADCB, FAB, Mashreq, ADIB, RAKBANK, Liv and Wio. Each row labels its
channel and evidence class, and asserts the structured fields the parser must
produce. RAKBANK currently has only an explicitly synthetic grammar probe
because its public alert page names alert families without publishing bodies;
`bank-corpus.test.js` asserts that row stays quarantined, so a reconstruction
can never be counted as evidence that RAKBANK is supported.

`public-sources.md` records the redaction provenance for every row — where it
came from, and what was replaced.

## Nothing in here names its own bank, except HSBC

`From HSBC:` is the only in-body bank marker anywhere in the accuracy-report
corpora. Every other UAE bank identifies itself through the **SMS sender ID**,
which the export does not carry — so a fixture with a bank name written into
its body would be *less* realistic, not more. That is why `parseSms` takes an
optional `{ sender }`, why `bankProfileForSender` exists at all, and why the
per-bank sections in `parser.test.js` label their attribution
(certain / inferred / reconstructed) instead of pretending the text says who
sent it.

## Running one through the parser

Run one through the parser to see what every message currently resolves to:

    bash scripts/test/run.sh          # builds scripts/test/build first
    node scripts/test/corpus.js scripts/test/fixtures/uae-accuracy-report.txt

`uae-accuracy-report.txt` is a representative redacted format slice of a
346-message report from a second user's phone: one message per format family,
plus the merchants that appeared most often. Its formats are asserted
individually in `parser.test.js`; the fixture remains here so the next parser
change can be eyeballed against stable, masked real text rather than invented
text.

`uae-accuracy-report-2.txt` is a second redacted accuracy export, 84 messages
wide. `invariants.test.js` walks this whole directory and asserts the
properties that must hold for *every* message, rather than only the pinned
ones.
