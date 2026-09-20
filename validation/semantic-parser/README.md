# Wafra local semantic parser — ArBanking77 dialect-holdout benchmark

Research only. Nothing in this directory is wired into the app, and none of it
may be until the acceptance gates in `../WAFRA_S1_RESEARCH_HANDOFF.md` are met
on a genuinely untouched holdout.

## The question

Wafra needs a fully local parser that can decide, from a bank SMS or
notification, whether to write a ledger row by itself. The product requirement
is not maximum accuracy:

> **unsafe auto-imports = 0**, with safe automatic coverage pushed toward 90%.

Everything here is built around measuring that, not around leaderboard numbers.

## Data

`SinaLab/ArBanking77` — the Arabic Banking77 adaptation, with MSA + Palestinian
training data and Saudi / Moroccan / Tunisian dialect test sets.

Use the **git checkout**, not the Hugging Face mirror. The mirror publishes only
~1k-row *sample* CSVs and carries no dialect test sets at all:

```sh
git clone --depth 1 https://github.com/SinaLab/ArBanking77 /path/to/arbanking77
export ARBANKING77_DATA=/path/to/arbanking77/data
```

| split | file | rows |
|---|---|---|
| train | `Banking77_Arabized_MSA_PAL_train.csv` | 21,559 |
| val | `Banking77_Arabized_MSA_PAL_val.csv` | 2,464 |
| MSA test | `Banking77_Arabized_MSA_test.csv` | 3,574 |
| PAL test | `Banking77_Arabized_PAL_test.csv` | 3,807 |
| Saudi test | `Banking77_Arabized_Saudi_test.csv` | 3,580 |
| Moroccan test | `Banking77_Arabized_Moroccan_test.csv` | 3,574 |
| Tunisian test | `Banking77_Arabized_Tunisian_test.csv` | 999 (27 of 77 intents) |

Normalized exact overlap between each test set and training is 0.00–0.06%.

## Methodology rules this code enforces

1. **Fitting uses train; selection uses val. Nothing else.** `arb_data.load_split`
   raises unless a dialect split is requested with `purpose="evaluate"`, so an
   accidental tune-on-Saudi loop fails loudly instead of quietly producing an
   untrustworthy number.
2. **The label projection is frozen.** `wafra_taxonomy.py` maps the 77 intents
   to `(family, state, direction)` using the English intent names alone. It was
   written before any dialect utterance was read. `MAPPING_VERSION` ties every
   stored result to the mapping that produced it.
3. **Tuning for dialect robustness happens on a dialect-shift proxy, not on the
   holdouts.** `dialect_shift_dev.py` splits the *training pool* into its own
   MSA and Palestinian halves (the source dialect of each row is recoverable
   from `Banking77_full_corpus.csv`) and measures MSA→PAL transfer. The sealed
   sets are never loaded by that script.
4. **Results are self-describing.** Every result JSON records seeds, exact
   configs, per-file sha256, per-split content digests, and the environment.

## Files

| file | role |
|---|---|
| `wafra_taxonomy.py` | frozen 77-intent → `(family, state, direction)` projection |
| `arb_data.py` | corpus loader, normalization, split sealing, provenance digests |
| `metrics.py` | semantic accuracy, gate safety, calibration, latency |
| `deterministic.py` | exact amount/currency extraction, amount-role safety, auditable marker layer |
| `models.py` | char n-gram linear, char n-gram centroid, small char-CNN |
| `pretrained.py` | compact pretrained encoders, frozen or fine-tuned |
| `gate.py` | the auto-import policy and its val-only threshold selection |
| `run_benchmark.py` | fits models and runs the sealed dialect evaluation |
| `gate_experiments.py` | compares gate policies over cached probabilities |
| `dialect_shift_dev.py` | dialect-shift tuning proxy, no sealed data |
| `tune_linear.py` | linear-baseline hyperparameter sweep on val |
| `amount_role_benchmark.py` | amount-role safety on Wafra's bank-alert fixtures |
| `export_wafra_fixtures.cjs` | exports those fixtures to JSON |
| `summarize.py` | renders a result JSON as markdown tables |

## Reproducing

```sh
python -m venv .venv && .venv/bin/pip install numpy scipy scikit-learn
.venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
.venv/bin/pip install transformers          # only for pretrained encoders

export ARBANKING77_DATA=/path/to/arbanking77/data

# 1. representation choice, on the dialect-shift proxy
.venv/bin/python dialect_shift_dev.py --tag v1

# 2. sealed dialect evaluation, caching probabilities for later gate work
.venv/bin/python run_benchmark.py \
    --models linear,centroid,charcnn,charcnn-tiny \
    --secondary charcnn --tag main --dump-proba

# 3. gate policy comparison, no refitting
.venv/bin/python gate_experiments.py --tag main --primary linear --secondary charcnn

# 4. deterministic amount-role safety on real bank-alert formats
node export_wafra_fixtures.cjs > results/wafra-alert-fixtures.json
.venv/bin/python amount_role_benchmark.py

# 5. tables
.venv/bin/python summarize.py results/benchmark-main.json
```

Seed is `20260920` everywhere. `results/wafra-alert-fixtures.json` is generated,
not committed — regenerate it with step 4.

`results/proba-main-*.npz` are the cached probability matrices from step 2, one
per model, about 4.8 MB each. They are committed deliberately: the gate-policy
and model-agreement analyses read them, and regenerating them means refitting
every model (~15 minutes of CPU). Step 2 reproduces them byte-for-byte from the
fixed seed if they are ever dropped.

## What the two benchmarks do and do not measure

`run_benchmark.py` measures **semantic robustness under dialect shift**.
ArBanking77 utterances are customer questions, not bank alerts, so this is a
deliberately hard stress test of the semantic layer: it asks what happens when
wording is genuinely novel. It is not a prediction of SMS parsing accuracy, and
must never be quoted as one.

`amount_role_benchmark.py` measures **deterministic extraction safety** on
real-format bank alerts: does the parser ever pick an available balance, credit
limit, statement total or minimum due instead of the transaction amount. Those
fixtures are privacy-safe near-real templates and standard-derived
reconstructions, not consented customer evidence, and they are never used to
train or tune the semantic model.

Neither is a substitute for a consented real-world holdout.
