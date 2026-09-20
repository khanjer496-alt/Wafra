# Does a second model catch the first one's confident mistakes?

Generated from `results/proba-main-*.npz` (tag `main`, seed 20260920).

The handoff proposed requiring "deterministic financial evidence **and/or**
independent semantic agreement" before an auto-import. This measures the second
half of that: for every case where the primary model is wrong about
`(family, state)` while reporting confidence >= 0.90, does a second model
disagree — that is, would the agreement requirement have caught it?

Pooled over all five test splits (MSA, PAL, Saudi, Moroccan, Tunisian).

| primary | secondary | confident and wrong | secondary disagreed | catch rate |
|---|---|---|---|---|
| linear | charcnn | 17 | 0 | 0.0% |
| linear | charcnn-tiny | 17 | 0 | 0.0% |
| linear | centroid | 17 | 1 | 5.9% |
| charcnn | linear | 47 | 3 | 6.4% |
| charcnn | charcnn-tiny | 47 | 2 | 4.3% |
| charcnn | centroid | 47 | 17 | 36.2% |
| charcnn-tiny | linear | 39 | 9 | 23.1% |
| charcnn-tiny | charcnn | 39 | 3 | 7.7% |
| charcnn-tiny | centroid | 39 | 11 | 28.2% |

Overall agreement between linear and charcnn does fall with dialect distance —
94.2% on MSA, 84.6% Saudi, 75.4% Moroccan, 56.1% Tunisian on `(family, state)`
— so these are not the same model. But restricted to confidence >= 0.90 they
agree 99.9-100% of the time, including on every case where the primary is
confidently wrong.

**Independent semantic agreement is not a safety mechanism here.** Models
trained on the same corpus share their blind spots: when wording falls outside
what the training data covered, both models fail on it, and both fail
confidently. The most architecturally different pairing available (a TF-IDF
nearest-centroid scorer against a char-CNN) is the best of a bad set at 36%,
and still misses roughly two thirds.

This is visible end to end in `gate-policies-main.json`: policy C
(independent agreement) is indistinguishable from policy A (confidence only) —
Saudi coverage 26.8% vs 27.0%, unsafe auto-imports 3 in both. Adding the second
model changed essentially nothing.

Genuine independence has to come from a different *kind* of evidence, not a
second model of the same kind. In this pipeline that is the deterministic
amount/currency extraction and the auditable marker layer, which is what
policies B, D and F actually rely on.
