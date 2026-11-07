# Claude local reconciliation and final Android build

**Goal:** Account for the active canonical Claude-local work, incorporate useful changes into current main, retain the approved two-plan catalogue and release safeguards, and produce a newly signed APK/AAB.

**Spec:** The publisher's 7 November instruction: reconcile all Claude local work, retain weekly USD4.99 / yearly USD49.99 and release fixes, test everything, and build a new final Android version.

**Architecture:** Reconcile against current main57550e76 using canonical HEAD94400ee8 as the local-edit base. Treat the canonical checkout as an unfinished input rather than a replacement tree. Older worktree branches and recovery copies are evidence sources; integrate only changes not already incorporated or superseded.

**Tech stack:** Expo55, React Native0.83, TypeScript, Android Kotlin/Java, existing GitHub CI and signed Android workflow.

## Global constraints

- Preserve all canonical files and unfinished work; use this clean isolated checkout.
- Offer only weekly/yearly; preserve active-store prices and the approved USD4.99/49.99 references. Retired monthly ownership still grants existing subscribers access.
- Preserve exact Play SKU/base-plan/no-offer selection, latest-catalog/action/generation guards, fresh ownership query, complimentary reviewer access and native monotonic expiry.
- Preserve ledger durability, consent, privacy, shared-format and parser safety improvements in current main.
- Remove diagnostic exports and tester uploads from public customer flows. Keep normal user-owned CSV/PDF/backup exports and local correction tools.
- Do not publish private data, keys, historical local exports, generated caches or nested worktrees.
- A successful build is separate from Play review and a verified physical-device result.

## Review focus

- Stale local code must not overwrite newer parser/currency/dedupe or storage safeguards.
- UI adaptations must retain storefront prices and work at narrow widths/large text.
- A local three-plan test or pricing draft must not reintroduce monthly sales or wrong prices.
- Checkout, failed queries, cancellation and superseded async work must preserve entitlement ownership.
- Every locally edited source/native/test/config file receives a disposition; difference alone does not prove missing behavior.

## Tasks

- [x] 1. Inventory active local changes and relevant branch tips; record exact source hashes and semantic dispositions in the private reconciliation ledger. Confirm latest-main baseline typecheck and approved design guard.
- [x] 2. Reconcile product/UI work into the two-plan release and integrate any genuinely omitted source, test or tooling changes. Keep newer equivalent implementations. Add focused behavioral regression coverage for changed contracts and inspect complete diff.
- [ ] 3. Run typecheck, lint, relevant full JS/native/parser/worker/store suites and independent review. Publish the scoped branch/PR, require passing CI, merge, and dispatch the existing signed Android bundle workflow with all tester/diagnostic flags closed. Verify the new artifact's source, signer, permissions, runtime channel and native packaging; run the authorized main-profile device checks when available.

## Execution record

Detailed per-file dispositions, test output and build receipts remain in the task's private outputs directory. The public implementation and meaningful tests live in their normal paths.

The branch audit also found compatible unincorporated dynamic-text/CSV-share improvements, cooperative-worker error cleanup, and principal/status safety repairs. They are included selectively with regression coverage; obsolete alternative AI auto-posting architecture and unpublished research datasets remain preserved locally.
