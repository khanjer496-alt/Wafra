# Offline parser audit with Clef

`scripts/parser-ai/clef-audit.cjs` compares the deterministic parser with
Cloudflare's [Clef decision models](https://blog.cloudflare.com/clef-decision-models/)
(`@cf/cloudflare/clef-flash`, `@cf/cloudflare/clef`; Apache 2.0, served by
Workers AI) on the labelled parser-ai benchmark. It is a **development tool
only**. Nothing ships in the app. Clef never changes a parser rule or a ledger
row. Each lead it reports is a row a developer reads and, if the parser really
is wrong, fixes with a normal parser change and test.

## Why offline only

- **Size.** Clef-flash has 9B parameters and Clef has 27B. Neither can run on a
  phone. We already removed a 37 MB on-device encoder because of its memory
  cost (`docs/local-semantic-runtime.md`).
- **Privacy.** Calling Workers AI from the app would send bank messages to a
  server. That contradicts the on-device parsing promise in
  `docs/privacy-policy.md`.
- **Scope.** Clef classifies from closed options. It does not extract amounts,
  dates or merchants, and deterministic code owns those.

## What it asks

Every row becomes one request: the message, sender and country as `state`, plus
four closed questions using the `schema.cjs` vocabulary:

| Question | Type | Compared with |
| --- | --- | --- |
| `status` | choice (completed, pending, declined, otp, promo, informational, future, request, unknown) | `inspectUniversalBankEvent` status |
| `family` | choice (purchase … non-posting) | universal reader family |
| `direction` | choice (debit, credit, none) | universal reader direction |
| `shouldPost` | yes/no | `createLaunchAlertSession` posted a row |

## What it reports

For each field it reports parser accuracy and Clef accuracy against the TRUE
label, how often the two agree, a both-right/only-one-right/both-wrong split,
and Clef's calibration: Brier score, expected calibration error and reliability
bins. It also lists two sets of row ids:

- **leads**: the parser is wrong and Clef is right with confidence ≥
  `--threshold` (default 0.9). Start reading here.
- **overconfident**: Clef is wrong with high confidence. These show where Clef
  itself is unreliable on bank alerts.

## Privacy rules

- Only the repository's privacy-safe sets can be selected: `repo` (fixtures),
  `public` (committed public samples only, never `$PARSER_AI_PUBLIC_LOCAL`) and
  `synth` (synthetic held-out test split). The script has no option to read an
  export, an inbox or the private UAE benchmark.
- Reports, console output and the optional cache hold metrics, row ids and Clef
  answers only, never message text. HTTP errors are recorded by status code,
  because an error body can echo the request.

## Running it

Credentials go in `.env.local` (git-ignored) as `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN`. The token needs Workers AI access.

```sh
# No network: runs the parser and builds every request.
node scripts/parser-ai/clef-audit.cjs --dry-run --sets repo,public,synth

# Live run on fixtures + public samples with clef-flash.
node --env-file-if-exists=.env.local scripts/parser-ai/clef-audit.cjs \
  --cache /tmp/clef-cache.jsonl --json /tmp/clef-report.json

# Add a 300-row evenly spaced synthetic sample and use the larger model.
node --env-file-if-exists=.env.local scripts/parser-ai/clef-audit.cjs \
  --sets repo,public,synth --limit 300 --model clef --cache /tmp/clef-cache.jsonl
```

`--cache` stores answers by request hash, so you can re-score after a parser
change without paying for new requests. Keep the cache and report outside the
repository. Cost is input tokens only, at $0.24 per million per the Workers AI
model page. A full run over all three sets is about 3,500 short requests.

Tests: `node --test scripts/test/clef-audit.test.cjs` (no network; also part of
`npm test`).
