# Ask Wafra integration design for local parser rationale

**Status: design only.** No file under `src/` is changed by this research
branch. The acceptance gates in `../WAFRA_S1_RESEARCH_HANDOFF.md` are not met,
so nothing here is authorized for integration. This document exists so that the
contract is settled before anyone writes the integration, and so that the
research code already emits the right shape.

## What already exists

`src/lib/wafra-assistant-ai.ts` has the boundary this needs, and it is a good
one. Two calls, neither of which can see the ledger:

1. **Interpretation** — `buildAssistantInterpretationEnvelope(question)` sends
   the user's question plus `ASSISTANT_TOOL_CATALOG`. No financial data. The
   model picks a tool; `isAssistantToolRequest` validates the choice against an
   exhaustive switch, so a new tool is an explicit product decision rather than
   authority a model can grant itself.
2. **Explanation** — `buildAssistantExplanationEnvelope(question, answer)`
   sends the already-presentable local result and the instruction *"Never
   invent, recompute, or alter financial figures."* `safeExplanationData`
   strips any key containing `rawsms`, `rawmessage`, `accountid`, `cardid`,
   `transactionid` or `identifier`.

Parser rationale should ride that boundary unchanged. It must not add a third
call, and it must not widen what crosses.

## The leak this design closes first

The obvious way to explain a parser decision is to send the evidence that
produced it. The gate's internal `evidence` list looks like:

```
["state:failed:core:declined", "family:purchase:core:purchase"]
```

That is message content. Knowing the body contained *declined* is knowing part
of the body, and a handful of such matches can reconstruct a template. It must
stay on device.

So `gate.decide()` returns two separate things:

- `evidence` — which marker matched. **Local only.** Used for debugging, the
  review card's own wording, and this benchmark.
- `rationale_codes` — a closed vocabulary (`gate.RATIONALE_CODES`) describing
  the *shape* of the decision, with no message content. The gate raises if it
  ever emits a code outside that set, so the vocabulary cannot drift open.

```
posting-wording-present      non-posting-wording-present
family-wording-matches       family-wording-conflicts      no-family-wording
amount-role-unambiguous      amount-role-ambiguous
amount-missing               amount-currency-unknown
models-agree                 models-disagree               single-model-only
confidence-high              confidence-medium             confidence-low
margin-narrow
state-not-posted             family-not-ledger
```

An explanation model given `["non-posting-wording-present", "models-agree",
"state-not-posted"]` can say *"Wafra read this as a declined payment, so it did
not add a transaction"* without ever being told what the message said.

## Proposed tool

One new entry in `ASSISTANT_TOOL_CATALOG`:

```ts
{
  tool: 'parser-decision',
  purpose: 'Explain why Wafra imported, queued for review, or ignored one locally selected alert',
  arguments: ['decisionRef'],
}
```

`decisionRef` is **not** a message id, a transaction id, or an account id. It is
a short-lived handle that the app mints when the user taps a specific review
card or transaction detail row, and that the local executor resolves against
in-memory state. A model cannot enumerate handles, cannot guess one, and a
stale handle resolves to nothing. This matches how `obligation-status` already
takes locally resolved ids rather than letting a model name records.

`isAssistantToolRequest` gains one arm:

```ts
case 'parser-decision':
  return validName(candidate.decisionRef);
```

## What the executor returns

The local executor resolves the handle, reads the stored rationale, and builds
an ordinary `AssistantAnswer`. Only this crosses the boundary:

```ts
{
  tool: 'parser-decision',
  result: {
    title: 'Why this was not added',
    body: '<locally composed sentence>',
    facts: [
      { label: 'Outcome', value: 'Not added' },
      { label: 'Read as', value: 'Card payment, declined' },
      { label: 'Amount', value: 'AED 250.75' },      // already formatted locally
      { label: 'Certainty', value: 'High' },          // band, never a percentage
    ],
    data: {
      outcome: 'refuse',
      family: 'purchase',
      direction: 'debit',
      postingStatus: 'failed',
      confidenceBand: 'high',
      semanticSource: 'deterministic',
      amountRole: 'unique-transaction-role',
      rationaleCodes: 'non-posting-wording-present,models-agree,state-not-posted',
    },
  },
}
```

Note what is absent: no body text, no sender, no template key, no account or
card fragment, no message id, no raw probability. `rationaleCodes` is a joined
string of the closed vocabulary, so `safeExplanationData`'s scalar-only rule
holds without a new escape hatch.

`confidenceBand` is a band because the handoff's UX direction says no raw
probability percentages reach the user, and because — as this benchmark
measured — the probabilities are not calibrated well enough on unseen dialects
to deserve a number. Expected calibration error roughly doubles from MSA to
Moroccan, and confident-but-wrong predictions occur on every held-out dialect.

## Authority

Ask Wafra explains. It does not decide, calculate, or mutate.

- It never receives raw SMS, and there is no route for it to ask for any.
- It never receives ledger rows, ids, or balances beyond the formatted figures
  in the answer it is explaining.
- It cannot change an import decision. Correction stays in the existing local
  correction-plan flow, which already turns a user correction into a local
  template rule.
- The existing instruction — never invent, recompute, or alter financial
  figures — applies unchanged.

A natural follow-on question such as *"so add it anyway"* is answered by the
app's own correction flow, not by the model, exactly as today.

## Preconditions

Do not build this until, on a genuinely untouched real-world holdout:

- unsafe auto-imports: 0
- amount-role safety: effectively 100% on the balance / limit / statement /
  minimum-due decoy set
- direction and posting-status accuracy ≥ 99%
- family accuracy ≥ 97–98%
- safe automatic coverage ≥ 90%
- no regression against the current deterministic parser

The current measurements are not at that bar. `FINDINGS.md` says where they are.
