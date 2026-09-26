# Parser AI — wiring (2026-09-26)

Follow-up to `2026-09-25-parser-ai-phase2.md`. The phase-2 pieces that worked are now
wired into capture, Review and Settings. Metrics only; no message text.

## What is wired

1. **Learned bank formats**. Pure module: `learned-alert-formats.ts`. Wiring:
   `learned-format-capture.ts`.
   - **Learning drafts.** A universal Review item for an unrecognised alert carries a
     learning draft, made at capture time: boilerplate literals and slot types only,
     so the tray still holds no message text.
   - **Confirming.** "Confirm and add" (`store.tsx` `promoteReviewAlert`) learns the
     template or counts one more confirmation. It uses the person's direction and day.
   - **Matching.** Runs after the proven parsers and the best-effort policy, before AI:
     - 1 confirmation: a Review item labelled "Recognised format — confirm".
     - ≥ 2 confirmations: the row is added with the marker
       `learned:template:<dir>` plus the template id, shown as "Learned format — check".
   - **Where matching runs:** Android SMS and notifications, the iOS History import,
     and iOS live capture. iOS live capture is Review only; see "Not done" below.
   - **Stopping a format.** Any of these stops it: Undo, deleting the row, correcting
     its amount or direction, or confirming the opposite direction.
   - **Settings → Learned bank formats:**
     - A list showing the masked shape, sender, direction, currency, confirmations
       and status.
     - Forget one format, or all of them.
     - An "Auto-add from learned formats" switch, on by default.
   - **Data.** Encrypted ledger state, included in the exported backup, and validated
     on restore.
2. **Phone-AI Review prefill**. Code: `ai-alert-platform-reader.ts`,
   `ai-alert-reader.ts` and `ai-alert-prefill-queue.ts`.
   - **Models.** Apple Foundation Models (guided generation over a closed schema) or
     Gemini Nano, through the new `alert-read` task in `modules/wafra-on-device-ai`.
   - **Output.** The phase-2 harness JSON, passed through the unchanged `gateAiAlert`.
     Amounts are located on token boundaries only. The direction is kept only when a
     text cue agrees with it.
   - **Limits.** It never posts. It is foreground only, skipped in Low Power Mode or
     Battery Saver, and limited to alerts from the last 3 days. At most 6 readings
     run per 10 minutes, one at a time, with an 8 s timeout.
   - **Fallback.** If the phone model is unavailable, the downloaded tagger is used;
     otherwise the alert gets plain Review.
   - **iOS.** Live capture and History import parse synchronously, so they use a
     bounded in-memory queue. At most 8 items wait; the text is cleared once read,
     and the queue is cleared on opt-out, Private Mode, erase or restore.
3. **Settings → On-device alert reader.**
   - The "Suggest fields with on-device AI" switch.
   - The phone-model status.
   - A tagger download (32.7 MB, off by default, Wi-Fi only by default), verified by
     SHA-256 against `ai-alert-model-manifest.ts`, with a delete option. Nothing is
     uploaded.
4. **Review UI.**
   - **Labels.** Review items are labelled "Recognised format — confirm" or "Suggested
     by on-device AI", in English and Arabic.
   - **Editing.** On suggested items the direction can always be changed; the
     promotion no longer treats a suggested direction as binding. The merchant title
     can be edited on AI items.
5. **Native methods.** `getPowerState`, `getNetworkType` and the `alert-read` task
   whitelist, in Swift and Kotlin.

Never for UAE/Saudi: this covers AE/SA senders, routes (including AED/SAR money in the
text), AE/SA users and AED/SAR ledgers. Learning, matching and AI all refuse them.

## Verification

- **Typecheck:** `tsc --noEmit` is clean. ESLint shows no new findings.
- **JS suite:** `npm test` exits 0, with every app suite, the server suites and the
  native Swift suites. Two suites are new:
  - `learned-format-wiring.test.cjs` (18 cases);
  - `ai-alert-platform-reader.test.cjs` (12 cases).
  (`run.sh` reports 83 declared app suites plus the node:test files.)
- **Corpus identity with no templates and no model:** 14,142 rows were compared
  between origin/parser-ai-phase2 (2201e26d) and this tree, covering repo fixtures,
  the committed public samples, and the phase-1 dev, test and train sets and the v2
  test and author sets.
  - Ledger and extraction (`corpus-snapshot.cjs`): **14,142 identical, 0 changed**
    (1,059 posted on both).
  - Review decisions from the refusal pipeline, with the new learning draft removed:
    **14,142 identical** (4,707 review items).
  - The private UAE export was not available to this session, so it was not re-run.
- **Wired learned-format evaluation** (`scripts/parser-ai/learned-wire-eval.cjs`, v2
  generator, 22,298 rows through the production capture path, confirming each Review
  item with its true label):
  - 684 rows posted by the rules; 6,925 reached Review; 2,464 carried a learning
    draft and 2,446 of those confirmations learned a template.
  - Later rows read by a learned format: 70 pre-filled (70 correct, 100%) and 1
    auto-added (correct). False hits on non-posting rows: 0.
  - Coverage is small because the v2 generator repeats each (template, sender)
    only about once; phase 2 measured same-shape repeats at 99–100%. No non-posting
    row followed a learned template in the same group, so this run does not
    measure false hits on negatives; the pure-module evaluation (1.4M+ comparisons,
    0 false matches) and the near-miss tests do.
- **Web e2e** (`scripts/e2e/e2e-learned-formats.mjs`, web export with
  `EXPO_PUBLIC_WAFRA_E2E_DEMO=1`): 9 of 9 pass. They cover:
  - both labels in the Review list;
  - confirming a recognised format, which moves it from 1 to 2 confirmations;
  - editing an AI item's title and confirming it, which learns the format;
  - flipping the direction on a recognised format, which stops it;
  - an unknown-direction item, which learns once the person answers;
  - the Settings list: masked shape, auto-add off, forget one or all;
  - the alert-reader switch;
  - the Settings links;
  - the Arabic labels.

  `e2e-universal-review.mjs` passes 14 of 15. The one failure is its Japanese
  observed-date case: it compares a local date with a UTC date, which breaks between
  00:00 and 04:00 in UTC+4. That fixture has no learned or AI fields.
- **Swift:** `ios/Tests/typecheck.sh` passes for iOS 15.1 and 26.0 in Swift 5 and 6.
  The engine host tests pass, including the alert-read schema, the network classifier
  and a live network probe. Apple Foundation Models reports `deviceNotEligible` on this
  M1, so live generation was skipped.
- **Kotlin:** **not compiled.** No kotlinc or ML Kit jars are available locally. The
  code mirrors the existing patterns, the typecheck stubs were extended, and it was
  read-checked by the reviewer.
- **Independent read-only review:**
  - It found 1 blocker: learning still ran for AE/SA users and AED/SAR ledgers. This
    is fixed and tested.
  - It found 7 should-fix issues, now fixed:
    - amounts were matched inside other numbers;
    - deleting or editing a learned row did not stop its format;
    - a queue race could strand a job;
    - queued jobs outlived opt-out or erase;
    - AI ran during background wakes;
    - the copy overclaimed;
    - "Wi-Fi only" was misread as unknown on older builds.

Screenshots (web, 390 px): `docs/design/2026-09-26-parser-ai-wire/`.

## Not done / must be verified on devices

- **iOS live capture never auto-adds from a learned format.** It has no automatic row
  type for non-AE/SA alerts, so a match becomes a pre-filled Review item. Android and
  the iOS History import do auto-add.
- **The iPhone 16 Pro (Apple Intelligence on) has not been tested.** Check that:
  - the Settings screen shows "Apple Intelligence is ready";
  - an unrecognised non-Gulf alert arriving through the Shortcut produces a
    "Suggested by on-device AI" item within seconds of the app being opened;
  - Low Power Mode suppresses it;
  - the downloaded tagger's Wi-Fi check reports Wi-Fi versus a hotspot correctly.
- **An Android phone with Gemini Nano (AICore) has not been tested.** Check that:
  - the module compiles and links with ML Kit GenAI beta2;
  - `getNetworkType` and `getPowerState` return correct values, which needs
    `ACCESS_NETWORK_STATE` (added to the module manifest, a normal permission);
  - the model returns parseable JSON for the alert schema;
  - prefill appears after a foreground scan.
- **Real-data precision** for the phone model on this gate is still unmeasured (phase 2
  measured open 1–3B models only). It is a Review prefill, so a wrong reading costs
  one correction.
