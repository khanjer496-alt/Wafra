# On-device AI (platform models)

Wafra uses the language model that ships with the phone's operating system,
for three advisory jobs. Deterministic code keeps owning money, dates,
direction, dedupe and imports.

| Platform | Provider | Requirement |
| --- | --- | --- |
| iOS | Apple Foundation Models (`SystemLanguageModel.default`) | iOS 26+, Apple Intelligence–capable device, Apple Intelligence on, model ready |
| Android | Gemini Nano via ML Kit GenAI Prompt API (`com.google.mlkit:genai-prompt:1.0.0-beta2`) on AICore | API 26+ and an AICore device that supports Gemini Nano (unlocked bootloaders unsupported) |

Everything else (older iOS, web, Expo Go, unsupported Android) reports a
non-`available` status and every feature stays on its rule-based path.

## Native module: `modules/wafra-on-device-ai`

JavaScript API (`index.ts`, optional native module `WafraOnDeviceAI`):

- `getAvailability() → { status, provider, languages, canPrepare }`
  - `status`: `available | unsupported-os | device-not-eligible | not-enabled | model-not-ready | unavailable`
  - `provider`: `apple-foundation-models | gemini-nano | null`
  - `languages`: codes Apple reports (`supportedLanguages`); `null` on Gemini Nano, which publishes no list
  - `canPrepare`: Android only, AICore reports the model `DOWNLOADABLE`
- `respond(requestId, task, instructions, prompt, schemaJson, maxTokens, timeoutMs) → string`
  - `task`: `ask-plan | categorize | alert-review`; `schemaJson` is a closed field list
    `{ name, fields: [{ name, description?, choices: string[] } | { name, description?, maxLength }] }`
  - iOS builds a `DynamicGenerationSchema` (`anyOf` string choices) and uses guided
    generation (`LanguageModelSession.respond(to:schema:…)`, greedy sampling, a
    fresh session per request) and returns `GeneratedContent.jsonString`.
  - Android (beta2 has no constrained decoding) renders the field list into the
    prompt, `temperature 0`, `topK 1`, `candidateCount 1`, and returns the text.
  - One request at a time (`ERR_ON_DEVICE_AI_BUSY`), native timeout
    (`ERR_ON_DEVICE_AI_TIMEOUT`), `cancel(requestId)` (`ERR_ON_DEVICE_AI_CANCELLED`).
    Errors carry fixed codes only, never prompt or model text.
- `prepare()`: Android only; asks AICore to download Gemini Nano. Called only
  from the explicit "Download on-device model" button in Ask Wafra; returns after
  AICore's first download status (at most 10 s) while the download continues.

iOS 15.1 deployment safety: every FoundationModels reference is inside
`#if canImport(FoundationModels)` and `@available(iOS 26.0, *)`, and the
podspec weak-links `FoundationModels`. Android minSdk 24: the module manifest
uses `tools:overrideLibrary` for the two ML Kit GenAI packages (minSdk 26) and
the module never constructs `GeminiNanoEngine` (the only ML Kit user) below
API 26. The dependency is pinned to beta2 because beta3/beta4 carry Kotlin 2.3
metadata that RN 0.83's Kotlin 2.1.20 compiler cannot read (verified with
`kotlinc 2.1.20`).

Local checks (no Xcode project or Gradle build needed):

- `modules/wafra-on-device-ai/ios/Tests/typecheck.sh` — Swift typecheck at
  `arm64-apple-ios15.1` and `arm64-apple-ios26.0`, Swift 5 and 6 modes.
- `modules/wafra-on-device-ai/ios/Tests/run-engine-tests.sh` — host (macOS 26)
  run of the schema parser, request lifecycle and, when the Mac has Apple
  Intelligence available, one real guided generation.
- `modules/wafra-on-device-ai/android/typecheck/typecheck.sh` — `kotlinc 2.1.20`
  against the real ML Kit class files with compile-only Expo stubs.

## JavaScript layer

- `src/lib/on-device-ai.ts`: availability cache (30 s, refreshed on Ask focus
  and app return), language gate (Apple's list; English only on Gemini Nano),
  JS-side timeout plus native cancel, serial queue, and `parseClosedOutput`,
  which accepts exactly one JSON object with exactly the schema's keys, every
  closed value verbatim from its choices and every free value short and free of
  control/bidi characters. Anything else is `invalid-output`.
- `src/lib/on-device-assistant.ts` (Ask Wafra): runs only when the
  deterministic planner returned exact plain Help for a fresh question. The
  model sees the question and the tool catalog (`wafra-assistant-ai.ts`), never
  the ledger, and returns one of the catalog tools (minus `obligation-status`,
  which needs locally resolved identifiers) plus closed arguments. Wafra then
  refuses questions with dates it cannot map (digits, month/weekday names,
  relative days/weeks), derives the period from the question's own wording
  (the model's period must agree), accepts a merchant only when the question
  names it AND it equals one ledger merchant title, refuses the plan when the
  question names a ledger merchant, account or bank (or, in English, any
  capitalised name) the plan does not carry, keeps a category filter only when
  the question names the category (category-breakdown is headed by its label),
  never takes numbers (limits, day windows) from the model, runs
  `isAssistantToolRequest`, and the ledger executor computes every figure.
  Holidays, seasons and vague spans ("Ramadan", "lately", "so far") are
  refused like explicit dates. Arabic questions have no capitalisation signal,
  so unknown Arabic names are covered only by the ledger-name check. Answers chosen this way are labelled "Question interpreted by
  on-device AI".
- `src/lib/on-device-category.ts` (Improve categories screen): the
  deterministic categorizer (user merchant rules, then vocabulary/activity
  rules) answers first; only an unresolved expense merchant is sent, by name
  with long digit runs masked, and the model must return one expense category
  id (never `other`, never income) or `unsure`. The suggestion is shown with a
  "Use …" button that goes through the screen's existing assign path; bank
  bill nicknames never get a suggestion. Session cache only, cleared on
  erase/restore/private mode/backgrounding.
- `src/lib/ai-alert-reader.ts` (unfamiliar bank alerts): source stays on the
  device. This experimental path is **off by default for launch**; enabling
  `EXPO_PUBLIC_WAFRA_AI_ALERT_PREFILL=1` in a test build allows an already-ready
  model to suggest a transaction family and
  literal merchant/date quotes. `ai-alert-source-contract.ts` rechecks the
  whole source, exact money, quote ownership and calendar validity. Known facts
  stay authoritative; account-owner/lifecycle metadata cannot become a payee
  or transaction date. All output goes to Review for confirmation. Model
  numbers, currency, direction, card identity and completion are never accepted.
  Android SMS/notification scans, iOS live capture and Messages History share
  one inference attempt per session, a 2.5-second whole-request deadline and
  stale/cancellation guards. Historical ledger repair disables this fallback.
  No SMS source, spans, prompt or arbitrary model diagnostics are persisted.
  Only fixed provenance codes survive in Review. AE/SA routes retain their
  existing parser paths. This does not invoke the removed E5 runtime or the
  legacy `gateAiAlert` automatic-posting route.

Legacy E5 files that earlier installs downloaded (`<documents>/local-ai/`) are
deleted after hydration while the E5 flag is off.

## Needs a real device

Host tests use a scripted bridge. The Android merged manifest (ML Kit
`MlKitInitProvider` from `mlkit:common`, minSdk 21, which the genai packages
do not extend with startup components) and an API 24 cold launch must be
checked in the CI/EAS Android build. Quality, latency, memory, Arabic support and
the Android download flow must be measured on an Apple Intelligence iPhone
(iOS 26+) and on a Gemini Nano Android phone (for example Pixel 9 or a
supported Galaxy S series) before any quality claim.

The 12 October alert evaluation is documented in
[the source and model evidence](test-evidence/2026-10-12-ondevice-alert-ai.md).
Both independently tested portable Qwen candidates failed to add reliable
fields on this source set. No GGUF model/runtime is bundled or downloaded by
the app. A portable Arabic/older-device model remains unqualified; the current
platform language gate refuses unsupported Arabic.

## Personal bank formats

The iOS/Android **Import bank activity → Teach a bank format** screen now offers a
local deterministic alternative. Confirm exact source fields in one alert,
check a different received alert with the same layout, then explicitly save.
The authenticated format contains device-keyed digests and typed slots;
neither sample nor literal sender/anchor text is retained. Private Mode can
stay enabled. The web screen can inspect an alert but cannot save a format.

While capture, History or paste has source text available, a matching validated
format may fill missing fields in an eligible Review entry. It never invokes
the legacy learner's posting result or changes an already parsed row. A
changed layout requires new teaching. Formats are device-bound, omitted from
exports/restores and removable with **Forget this format**. This is personal
layout support, not bank-wide coverage or model accuracy. Local test evidence
and the remaining phone validation are recorded in
[private bank formats](test-evidence/2026-10-12-private-bank-formats.md).
