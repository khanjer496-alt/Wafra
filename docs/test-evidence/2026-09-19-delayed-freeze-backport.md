# DelayedFreeze stale-state backport

The physical Android build-314 report showed Spending content while Home was selected; the corresponding view hierarchy contained both scenes. The installed `react-native-screens` 4.23.0 helper also reproduces the stale-freeze sequence described in [upstream issue #4518](https://github.com/software-mansion/react-native-screens/issues/4518). The upstream author tested iOS, not Android. The shared JavaScript defect is reproduced locally; the Android observation is consistent with it. Native activity-state instrumentation was not performed. Subsequent signed-build physical verification is recorded below.

After a screen has frozen, refocusing and immediately blurring it before the reset timer runs leaves its old freeze flag true. The next deactivation can therefore suspend the subtree before native `activityState=0` is delivered. The backport resets that flag synchronously during the unfrozen render. It preserves delayed freezing, native detachment, tab state, and dependencies. It does not include the broader freeze-boundary movement proposed in the still-open [upstream PR #4608](https://github.com/software-mansion/react-native-screens/pull/4608).

`scripts/patch-react-native-screens.cjs` accepts only package version 4.23.0 and exact reviewed original or patched SHA-256 contents. It validates the source, module and CommonJS helpers before writing any file. Repeated application is a no-op. Its exported function accepts a package directory so tests never modify shared dependencies. Root npm postinstall applies the patch after dependency extraction. Both dependency-only feedback Docker images explicitly copy this trusted script before npm ci; an executable regression assembles those exact COPY contexts and invokes the patch successfully.

Validation on pinned Node 22:

- All three original helper entry points failed the deactivation-grace regression before the backport.
- All 15 final tests pass, covering original reproduction, repeated patched focus cycles, eventual freezing, timer cancellation/unmount, exact patch-only changes, idempotence, and rejection of missing/modified files or unsupported versions before writes.
- Focused ESLint, navigation/foreground-history tests and the 95 performance-configuration assertions pass. The feedback-security suite passes all 11 checks.
- An independent experiment using actual React 19.2.0 and react-freeze 1.0.4 reproduced committed mock-native activity states `2 -> 0 -> 2` before, and `2 -> 0 -> 2 -> 0` after, for all three helper entry points. Eventual suspension and timer cleanup remained intact. This is real React commit evidence with a mock native host, not Android/Fabric proof.
- A freshly downloaded registry tarball matches the package-lock integrity. The patch applies to all three pristine entries and is a no-op on repeat.

The host tests above performed no physical-device actions or shared dependency modifications. At the time of the backport commit, signed-build verification remained pending.

Subsequent build-317 testing on the connected Android phone passed eight normal switches, eight rapid-switch bursts containing 32 requested taps, and a 30-second no-input observation. Selected state and exactly one matching content scene agreed at each settled check. The rapid bursts and idle observation retained the same app process. Interrupted attempts were excluded. This is bounded device evidence, not a guarantee for every workload; see [the final Android QA report and its remaining limits](2026-09-19-android-317-qa.md).
