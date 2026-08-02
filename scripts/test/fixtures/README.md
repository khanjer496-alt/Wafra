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

`uae-bank-formats.js` is the executable, bank-keyed acceptance corpus for
ENBD, ADCB, FAB, Mashreq, ADIB, RAKBANK, Liv and Wio. Each row labels its
channel and evidence class, and asserts the structured fields the parser must
produce. RAKBANK currently has only an explicitly synthetic grammar probe
because its public alert page names alert families without publishing bodies.

Run one through the parser to see what every message currently resolves to:

    bash scripts/test/run.sh          # builds scripts/test/build first
    node scripts/test/corpus.js scripts/test/fixtures/uae-accuracy-report.txt

`uae-accuracy-report.txt` is a representative redacted format slice: one
message per format family, plus recurring merchant descriptors. Its formats
are asserted individually in `parser.test.js`; the fixture remains here so
parser changes can be checked against stable, masked examples.
