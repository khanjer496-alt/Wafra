# On-device AI (platform models)

Wafra uses the language model that ships with the phone's operating system,
for two advisory jobs. Deterministic code keeps owning money, dates,
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
  - `task`: `ask-plan | categorize`; `schemaJson` is a closed field list
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
