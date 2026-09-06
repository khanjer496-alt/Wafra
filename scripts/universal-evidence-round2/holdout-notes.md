# Round 2 synthetic holdout freeze

Frozen on 2026-09-05 before delivery to the implementation team.

- Parser cases: 24, two each in en, fr, de, es, pt, it, nl, tr, hi, ar, ja, zh.
- Categorization cases: 8, each explicitly marked synthetic.
- File SHA-256 (holdout.json): `8ea029e618d67596370076a89c677300a587ec8b259df6d2867a3e0988b82539`
- No production parser source, earlier evaluation corpus, existing parser tests, earlier evidence, or parser execution was used in authoring.
- Native-speaker validation was unavailable. These are independently authored synthetic examples, not bank-provided templates or evidence of real-world bank coverage.
- All notification bodies carry an explicit SYNTHETIC label. Merchant names are invented for this fixture; incidental overlap with a real name would be coincidental.
- Money expectations use decimal strings for integer minor units, explicit exponents, and no inferred currency from an ambiguous dollar symbol.
- Only explicitly completed postings receive a direction. Authorization or requested transfer alone does not imply posting.
- Statement totals, minimum payments, balances, and transaction amounts remain separate facts. Missing years are not invented.
- The safety flag means the message must not be promoted to one posting: it covers nonposting notices and a two-transaction summary. It is deliberately absent for an explicit completed posting with missing amount or ambiguous currency.
- This file was frozen without running the parser. Any later implementation-team inspection must occur after the implementation freeze. No edits to frozen cases should be made to match implementation output.
