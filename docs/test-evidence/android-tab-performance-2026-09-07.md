# Android tab-switch render-cost correction

## Scope

Baseline: `c13fd461073e8139a1dfd79fef5cd039ffbc85d2` (`main`).
This change addresses avoidable rendering and projection calls without
changing tab design, monetary rules, storage, parser behavior or dependencies.

- Android tab screens opt into `freezeOnBlur`; inactive screens keep their
  state without rendering every ledger update. Lazy loading and native
  detachment defaults remain unchanged. iOS/web do not opt into freezing.
- The history/foreground capture owner remains outside the tab navigator.
- Tab labels subscribe to the narrow language context rather than the entire
  ledger, while still passing the reactive language explicitly to translations.
- The theme hook reuses its result until palette or contrast changes.
- Accounts and Bills memoize card/balance work against the immutable financial
  input arrays rather than the whole state object. Actual account, transaction
  and statement changes still invalidate calculations. Cash outflow also
  invalidates when the reporting-month start setting changes.

Production files: `src/components/app-tabs-layout.tsx`,
`src/components/tab-bar.tsx`, `src/hooks/use-theme.ts`,
`src/app/(tabs)/wallet.tsx`, and `src/app/(tabs)/bills.tsx`.
Regression suite: `scripts/test/repair/tab-render-cost.test.cjs`, automatically
included by the existing focused-test glob in `scripts/test/run.sh`.

## Reproduction and result

The new suite executes actual screen source with persistent hook dependency
slots and explicit native/store/child-component boundaries. It counts
projection invocations; it is not a device frame-rate or latency benchmark.

With an initial render followed by 20 unrelated status/progress updates:

| Invocation | Before | After |
| --- | ---: | ---: |
| Accounts balance breakdown | 21 | 1 |
| Accounts reissue suggestions | 21 | 1 |
| Accounts cash-outflow summary | 21 | 1 |
| Accounts per-row card figures (four fixture accounts) | 84 | 4 |
| Bills open-statement projection | 21 | 1 |
| Bills settled-statement projection | 21 | 1 |

Five of the ten new tests failed before the change and all ten pass after it.
The suite also checks fresh financial inputs, actual balance changes, salary
month changes, English/Arabic labels, prevented/repeated tab presses, reactive
theme/contrast changes and the independent capture owner's placement.

## Verification

Node 22.22.3, the project's pinned toolchain, was used.

- Application and server TypeScript checks passed.
- Focused ESLint passed without warnings.
- All 71 app JavaScript suites passed in an isolated snapshot of the baseline
  plus this correction. The initial run passed 70; the remaining source
  contract expected the canonical `netWorthBreakdown(state)` call. That call
  was retained with narrow memo dependencies, and onboarding then passed all
  77 checks. The ten new tests were rerun successfully afterward.
- All 136 focused repair/workflow tests passed in the isolated snapshot.
- Existing Android performance configuration checks still pass, including
  the guards against eager tab mounting, disabling native detachment and
  reintroducing tab-screen entering/layout animations.
- Native iOS contract fixtures were generated, but native Swift/runtime tests,
  full browser end-to-end tests and an Android release build were not run as
  part of this correction. Existing unrelated CI failures are not declared fixed.

Concurrent sessions changed SMS import, merchant artwork and presentation
while testing. Their changes were not reverted or bundled into this validation.
The performance-only snapshot specifically excludes the concurrent Bills
grouping additions. The pre-existing entry-detail edit was preserved.
The shared working tree's first broader run encountered another session's new
`AppState` import without a corresponding test stub; no production or test
code belonging to that work was edited to mask the failure.

Exact source hashes, the performance-only patch and test logs are retained in
`.git/tab-performance/`. The isolated snapshot there is temporary verification
material, not another Git branch or development checkout.

## Device and release limits

No Android device or emulator was attached when inspected, so the installed
app version, real tab-switch timings and real-inbox performance could not be
measured. The invocation reduction is not a claim of equivalent device speedup.
Test rapid switching and freshness after imports in a signed release build on
the affected phone before declaring its lag resolved.

No commit, push, installation, APK publication, store submission or OTA update
was performed by this performance task. These are local working-tree changes.
