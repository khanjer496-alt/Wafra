# Corpus fixtures

Real bank messages, in the format the app's **Improve accuracy** screen
exports. Digit runs are masked by that export, so these carry no account
numbers — the `····` runs are the mask, not something a bank sends.

Run one through the parser to see what every message currently resolves to:

    bash scripts/test/run.sh          # builds scripts/test/build first
    node scripts/test/corpus.js scripts/test/fixtures/uae-accuracy-report.txt

`uae-accuracy-report.txt` is a representative slice of a 346-message report
from a second user's phone: one message per format family, plus the merchants
that appeared most often. Its formats are asserted individually in
`parser.test.js`; the file itself is here so the next parser change can be
eyeballed against real text rather than invented text.
