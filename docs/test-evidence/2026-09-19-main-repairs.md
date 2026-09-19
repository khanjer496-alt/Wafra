# Main repairs — 19 September 2026

Final base: `abb50ee48f9c2b9b747036de6a88903606a54e76` (`origin/main`, parser v48).
Final carrier: `/Users/naserkhanjar/Wafra-main-ready-20260919`, branch `fix/main-ready-20260919`.
The original dirty `/Users/naserkhanjar/Wafra` checkout is unchanged. Intermediate repair/validation worktrees are task scratch space, not another development line. Implementation and the verification below were completed before publication. The owner subsequently authorized commits, a push to main, a latest Android APK build, installation on the connected phone, and full device QA. Those delivery results are recorded separately; this report does not claim a completed phone test or release.

## Implemented repairs

- **Ledger preservation:** inline snapshots cannot populate the unchanged-chunk cache. Their first save now writes all chunks before replacing the metadata containing the original rows. The original reproduction lost 2,800 of 3,113 rows after a one-row edit; a metadata-only save could lose every row. Focused regression cases and all four transfer-review browser cases now retain exact rows, amounts, decisions and backups. No monetary assertion was relaxed.
- **Feedback reliability:** all three upload paths use a 15-second deadline through response-body consumption, abort timed-out requests and release timers. Known HTTP refusals survive stalled error bodies. Scan counts and sending status are distinct. English and Arabic describe unconfirmed delivery accurately. Existing collection limits and privacy/import guards remain intact.
- **Public pages:** escaped static Privacy, Terms, Support and 404 documents, landing links, correct canonicals/sitemap and real local Pages 404 responses. The support contact comes from the existing policy. Terms describe local iPhone capture accurately. Legal drafts and unresolved governing law remain visibly unresolved.
- **Onboarding accessibility:** welcome and preview text wraps at narrow widths and 200% browser text size; selected choices expose matching web/native accessibility state; two-digit sample due dates stay on one line. Font scaling is preserved. Updated browser tests follow the current welcome/name/profile/manual path and retain data, consent, persistence, routing, touch-target and clipping checks.
- **Integration repairs:** Arabic labels cover the new upstream Credit reversal and Invoice payment titles. An impossible synthetic ADIB statement fixture was corrected to total AED 42.10/minimum AED 4.21 without changing parsing behavior. The historical-backfill test checks an independent numeric contract instead of freezing an obsolete release number.
- **Feedback workflow isolation:** only the reviewed dirty hunks from the older local patch were ported. Generation, offline validation and privileged publication run separately. Candidate code is never executed by the publisher. Images include pinned Node 22.22.3/npm 10.9.8 and Swift 6.2.4, plus required Java/SQLite tools. Required native fixtures are generated offline. Disposable temporary storage permits compiled tests while retaining other container protections. Swift spawn errors are now reported instead of hidden behind empty output.

## Verification evidence

All logs and screenshots below are local, ignored artifacts under `artifacts/main-finish-20260919/`.

- Database regression: 239 passed/4 failed before the fix, then **243 passed**.
- Latest-main app/server runner: **76 app suites + 3 server suites**, **1,067 interaction checks**, numeric input checks, and **27 onboarding-action checks** passed. The final temporary-directory permission regression adds one more focused workflow check after this broad run.
- Latest-main parser invariants: **34 passed**, including a 5,000-message run below the unchanged 1,500ms ceiling. Parallel build activity produced timing-only failures; isolated reruns passed. Thresholds were not increased.
- Diagnostics: **31 focused regressions**, **116 feedback checks**, and **8 export checks** passed.
- Web: **26 unit checks**, actual marketing export, **32 SEO checks**, five marketing viewports, 16 public-page/viewport cases, and genuine local Pages 404 responses on three unknown top-level/nested URLs passed.
- Browser suite: the initial full run passed the diagnostic, transaction, cleanup, cashflow, merchant, smoke, period, assistant, analysis, persistence, navigation, universal-review and four transfer-review cases. It then exposed stale later expectations. Updated tail suites passed: **41 redesign checks**, **16 local-only logo checks**, and **4 final-export onboarding scenarios**. Onboarding includes EN/AR at 320px with 200% text, reduced motion, one selected radio per chooser, no invented ledger/currency/import, name/skip/resume, and durable manual completion. Final screenshots were inspected.
- Native host evidence: **394 history-store checks**, **133 live-store + 53 bridge + 78 resource checks**, and **16 queue-signal checks** passed. Debug/Release App Intent source typechecks passed.
- Swift-enabled restricted Docker: **394 iOS capture/setup checks** passed with networking disabled, read-only root/dependencies, no added capabilities or credentials, and an unprivileged user.
- Feedback security: **11 focused checks** passed. These include actual permission-denied/successful executable launches, consent/schema/copy/path validation, fixture setup ordering, and API-only publisher tests.
- Typecheck passed. Lint has **0 errors and 15 existing warnings** outside the changed surfaces. The Worker dry-run passed without deployment.
- Independent read-only reviews approved persistence, diagnostics, public pages, workflow boundaries/toolchain, accessibility changes and updated acceptance tests. Every reported source finding was corrected and re-reviewed.
- Full restricted Docker sequence **passed**: clean baseline green; synthetic test-only change failed at its intended assertion; complete synthetic fix green. Both successful runs exercised all **76 app + 3 server suites, 1,068 interaction checks, 27 onboarding-action checks**, relay typechecking and **356 Worker checks**. No model or GitHub publication was invoked. Python and Swift were explicitly provisioned; test-file concurrency is two, with every assertion and timing limit unchanged.

The original full app browser export was based on `0d8623bf`; the final carrier includes the later v47/v48 parser commits, which were separately integrated and covered by full app/server checks. Final onboarding uses the latest carrier export. Docker proof uses synthetic canary changes in disposable copies only; those canaries are not in shipping source.

## Remaining external gates

The unmodified full macOS `npm test` stopped at the native app build after passing history host checks because the temporary checkout has no CocoaPods workspace. Installed Xcode is 26.1.1, below the repository's 26.2+ release requirement. Host/browser checks do not certify a signed native app, physical capture, or native Dynamic Type.

Local Pages used compatibility date 2026-08-08, the installed workerd ceiling. No deployed site's state was claimed or changed. Legal review and the publisher's governing-law choice remain required before publishing finalized terms.

No real feedback was sent to a model and no live draft PR was created. Optional native-tab/Icon Composer and MobAI TestFlight proposals remain separate. Superseded PRs were not closed and old branches were not deleted. The owner has authorized commit/push and Android build/install/device QA. Site deployment, store submission, and legal choices remain separate gates under AGENTS.md.
