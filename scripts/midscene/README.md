# Midscene AI acceptance suite

An AI-driven pass over the exported web build, using
[Midscene](https://github.com/web-infra-dev/midscene) on top of Playwright.

It does not replace `scripts/e2e`. Those suites assert what the DOM contains
and are deterministic, free, and the right place for a regression you can name.
This suite asks a vision-language model what a person reading the screen would
conclude, which is the only way to check the defect class that has actually
reached users here:

- a headline total that does not equal the rows printed beneath it
- a figure ellipsised to `1…`
- a heading whose window (`Leaving in 9 days`) does not match what it counts
- a card marked settled next to an amount still owing
- an Arabic label that overlaps the figure beside it
- a price that failed to load and rendered as a product identifier

## Running it

```bash
export MIDSCENE_MODEL_NAME='<a vision-language model>'
export MIDSCENE_MODEL_API_KEY='<your key>'
export MIDSCENE_MODEL_BASE_URL='<your provider endpoint>'
bash scripts/midscene/run.sh
```

`run.sh` exports the web build with the seeded demo ledger
(`EXPO_PUBLIC_WAFRA_E2E_DEMO=1`), serves it with `scripts/e2e/serve.mjs`, and
runs the suite against it. Arguments are passed through to Playwright:

```bash
bash scripts/midscene/run.sh specs/home.spec.ts        # one file
bash scripts/midscene/run.sh --grep "categories sum"   # one test
MIDSCENE_REUSE_EXPORT=1 bash scripts/midscene/run.sh   # skip the ~2min export
MIDSCENE_DARK=1 bash scripts/midscene/run.sh           # light and dark, 2x spend
```

The report lands in `midscene_run/report/` — an HTML file per run with the
screenshot, the model's reasoning and the located element for every step. Read
it when a test fails; the assertion text alone will not tell you whether the
app was wrong or the prompt was.

## Configuring a model

Midscene needs a model that can **read screenshots**. A text-only model will
fail every step. It talks to any OpenAI-compatible endpoint:

| Variable | Required | Notes |
| --- | --- | --- |
| `MIDSCENE_MODEL_NAME` | yes | the model id |
| `MIDSCENE_MODEL_API_KEY` | yes | or `OPENAI_API_KEY` |
| `MIDSCENE_MODEL_BASE_URL` | yes | or `OPENAI_BASE_URL`. 1.13 has no implicit default — a key and a model with no endpoint fail with `failed to get base URL of model` |
| `MIDSCENE_MODEL_FAMILY` | no | for a non-OpenAI family |

Midscene 1.13 ships families for OpenAI, Gemini, Qwen-VL/Qwen3-VL, Doubao and
UI-TARS, selected either with `MIDSCENE_MODEL_FAMILY` or the matching
`MIDSCENE_USE_*` switch. There is no Anthropic family in this version.

`preflight.mjs` checks this before Chromium starts and names the missing
variable. Without it the run dies inside the first `ai*` call with a provider
error several frames deep, which reads like the app is broken.

**Keep the key out of the repository.** Wafra's `AGENTS.md` rule applies: no
secrets in source, logs, documentation, commits or chat. Export it in your
shell or put it in `scripts/midscene/.env.local`, which `.gitignore` excludes.

## What it costs

Every `ai*` call is a screenshot plus a model round trip. The suite is 39 tests
across 10 files, most of them several steps. Expect a few hundred model calls
for a full pass and budget accordingly — this is a pre-release or
post-UI-change pass, not something to run on every commit. `scripts/e2e` is
what belongs in CI.

`workers` defaults to 1 and `retries` to 0, both deliberately: parallel workers
multiply spend and produce rate-limit errors that look like app bugs, and a
retry re-runs the model, so a flaky assertion costs twice and still reports
green.

## Writing a test here

Two rules keep this suite honest.

**Assert a conclusion, not an element.** `aiAssert('the Spending screen is
open')` is worth a model call. `aiAssert('a div exists')` is not — that is a
selector, and it belongs in `scripts/e2e` where it runs for free.

**Never act on a destructive control.** Wafra's `.screenmap/SKILL.md` forbids
an exploring agent from tapping erase, delete-account or delete-card, from
importing any real data, and from starting a purchase. A model told to
"explore settings" will eventually tap one of those. `settings-privacy.spec.ts`
reads those controls and never activates them; keep new tests to the same line.

## What this suite cannot cover

The web export has no SMS inbox, no notification listener, no biometrics, no
haptics and no store. Nothing here tests the capture pipeline, and a green run
says nothing about it. Those paths are covered by the unit suites in
`scripts/test/` and still owe a pass on a real device.
