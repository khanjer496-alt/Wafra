# Dedicated iPhone 15 acceptance — 15 October 2026

Scheduled thread follow-up: **6 PM Dubai time**. The owner authorizes intensive Wafra testing and installation on the dedicated phone. Public App Store release, real-money bank actions, repository commits/pushes and changes to unrelated apps/data require separate authorization.

## Before connecting

Keep the iOS version the phone arrives with until the older-iOS banner is reproduced. Connect by USB, unlock and accept Trust; enable Developer Mode if required for developer tools. Provide an active SMS-capable SIM/eSIM for carrier tests. Do not transfer another phone's SIM/account silently. A newer OS cannot prove the reported older-OS behavior.

Use `/Users/naserkhanjar/Wafra`, not the preserved Documents checkout. The verified launch candidate remains `/Users/naserkhanjar/.codex/worktrees/parser-launch-candidate/Wafra` while canonical main is dirty/behind; preserve all unfinished work. Build artifact provenance must identify the actual candidate rather than only its base Git SHA.

Run the read-only helper with the exact new build after it is verified:

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH node scripts/release/iphone-test-readiness.mjs \
  --expected-version 1.0.0 --expected-build VERIFIED_BUILD_NUMBER \
  --output /tmp/wafra-iphone15-readiness.safe.json
```

It never installs/launches/pairs/erases, never selects iPhone16 by default and refuses ambiguous/unavailable targets. Use `--device` with the exact CoreDevice ID if more than one iPhone15 is connected. An inventory/app lookup does not prove installed parser resources or physical behavior; unfamiliar JSON remains an explicit metadata blocker. Output files are private and are not overwritten.

## Artifact lanes

- Version1.0.0 build188 is an older signed baseline; its verified IPA lacks the new background parser. It cannot qualify the new integration.
- Use a freshly verified production-candidate build for store/entitlement tests. history-beta automatic founder Pro masks purchase/restore/expiry faults; start with clean synthetic state and keep the phases separate.
- Inspect signing, AppIntent metadata, parser resources/hash/version and native runtime compatibility. TestFlight acceptance/processing and access by this phone are separate from a signed IPA.
- The normal GitHub macOS workflow uses Xcode26.2+, pinned tooling and signed resource checks. EAS working-tree builds do not need Git publication, but the current Free iOS quota is exhausted; the attempted fresh build uploaded source and advanced the counter188→189 without producing a build. No paid plan was changed or binary submitted.

## Evidence lanes

1. Genuine bank/carrier SMS establishes actual bank sender/delivery.
2. A message from another test phone establishes the Message trigger with an unverified numeric sender.
3. Direct AppIntent fixtures establish controlled native parser/queue/presentation behavior. They do not establish Apple delivered a Message.

Capture the actual iOS/build, profile, artifact/source hashes, lane, app lifecycle, protection state, radio/data state, notification settings, expected and observed results for each case. Distinguish notification replacement from ledger dedupe. Keep raw messages/identifiers/financial screens in private local evidence only; share closed counts/statuses and sanitized failures. Do not create debug logs with SMS bodies or a second background ledger writer.

## Execution order

| Case | Required check |
| --- | --- |
| 1. `artifact` | Confirm exact model, original iOS, installed app/build, signed artifact and parser hashes. |
| 2. `onboarding` | Clean synthetic ledger, EN/AR, permission allow/deny/defer, manual entry remains usable. |
| 3. `capture_setup` | Install bundled Capture v3, detect duplicate versions, no-input setup proof. |
| 4. `automation` | Use actual in-app guide; currency-neutral space filter; inspect automatic execution and Notify When Run; record Apple and Wafra banners separately. |
| 5. `sms_foreground` | Genuine bank SMS while active: exact principal, date, direction and one ledger/Review result. |
| 6. `sms_locked` | Genuine SMS background/closed/locked after first unlock: no foreground jump, correct preview, one durable result after resume. |
| 7. `sms_offline` | Disable Wi-Fi/mobile data but retain cellular radio; separately enable airplane mode after receipt to test offline draining. |
| 8. `force_quit` | Receive after force-quit, reopen and retry; verify queue and eventual exactly-once ledger result. |
| 9. `reboot` | Separate before-first-unlock from after-first-unlock; document file-protection restrictions and recovery. |
| 10. `negative` | Personal/non-financial/OTP/grouped Unicode OTP/pending/declined/mixed activity: no financial caption or false ledger row; credential source is not persisted. |
| 11. `enbd` | Four controlled ENBD transfers, same AED2309 opposite legs, partial masks: source principal and direction, no invented tail or synthetic counterparty. |
| 12. `currencies` | AE+USD/JOD3, GB+SA pack+SAR, JPY0, EURcomma, missingFX: preserve source units; uncertain routes remain Review. |
| 13. `replay` | Same ID replay, missing GUID/date fallback, legitimate equal amounts and opposite directions: independent receipts survive, retries are idempotent. |
| 14. `interruption` | Active receipt, return from Shortcuts, interrupted save, restart: acknowledge only after durability and retain unhandled input. |
| 15. `settings` | Capture/charge alerts/OS permissions/entitlement/context/erase gates independently; no stale notification after disable. |
| 16. `space_boundary` | Real no-space/non-Latin control: record trigger coverage separately from direct parser fixtures. |
| 17. `history` | Actual small inbox, mixed banks, deferral/cancel/retry/relaunch; no false completion on empty/unsupported/large sets. |
| 18. `history_diagnostics` | Only when needed: bundled Quick History Check/Messages Check with counts-only evidence. |
| 19. `statements` | CSV/TSV/XLSX/PDF Files+Share sheet, mapping/password/cancel/network/reimport; explicit cloud consent, exact money/dates and dedupe. |
| 20. `private_formats` | Two synthetic samples, relaunch/use/edit/delete, private mode; no raw samples in public evidence and no implied background private-format support. |
| 21. `app_lock` | FaceID/cancel/retry/passcode/background/switcher/relaunch; ledger remains protected. |
| 22. `data_lifecycle` | Synthetic export/backup/restore/erase online/offline with pending work; late work cannot resurrect erased state. |
| 23. `storekit` | Production-candidate, no founder grant: store prices/currency, cancel/purchase/restore/renewal/expiry/refund/offline lease in sandbox only. |
| 24. `notifications_widgets` | Reminders/daily summary/taps/Focus/Scheduled Summary/previews/widgets; correct times, safe display and normal resume. |
| 25. `accessibility` | EN/AR x light/dark, largest text/VoiceOver/ReduceMotion/long names/keyboard/safeareas. |
| 26. `performance` | Cold/warm launch, large synthetic ledger, interrupted imports/burst/lowpower; measure phone CPU/RAM/energy and durable receipts. |

Every row starts **not tested**. Save pass/fail/blocked and its evidence after execution; a missing banner must be traced through input delivery, native queue, context/resource matching, parser refusal/busy/deadline, capture/lease/alert settings and OS permission. Do not infer the cause from a single symptom. Current queue health does not expose a full preview refusal reason.

No public API suppression of Apple's automation banner has been verified. Inspect the actual Notify When Run/Run Immediately controls first. Keep Wafra's own financial preview quiet for refused messages and distinguish Apple's trigger banner. The space trigger excludes no-space messages; report the boundary instead of claiming all languages/banks are captured.

## Exit criteria

No launch sign-off with unresolved monetary, duplicate, privacy, durability, crash or inaccessible-onboarding failures. A pass on this phone covers its actual OS/profile/lifecycle only. Keep other iOS versions, other bank formats and worldwide automatic posting as separate coverage rows. Archive exact failures, implement conservative repairs, rerun their affected tests and the physical failing path, then obtain independent review before publication.
