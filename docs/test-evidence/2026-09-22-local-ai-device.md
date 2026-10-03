# Local AI on-device evidence — 22 September 2026

Device: OnePlus CPH2653 (adb `f605ff7a`), Android 16. App installed in place
with `adb install -r`; no data erase; ledger of 14,796 transactions retained.
Diagnostics exports were saved by the owner to Downloads and read with the
runtime/shadow/stability sections only; financial rows were not inspected.

## Build 331 (commit e73bc22c, run 35648697307) — launch crash

- Fatal at JS module load: `TypeError: Cannot read property 'install' of null`
  from `onnxruntime-react-native`'s binding, rethrown by expo-updates error
  recovery. Reproduced on two consecutive launches; the app never reached the
  first screen.
- Cause: the package ships a legacy `unimodule.json`, so Expo SDK 55 autolinking
  compiles it (the .so files were in the APK) but never registers its
  `OnnxruntimePackage`, and `expo-modules-autolinking react-native-config` does
  not list it. `NativeModules.Onnxruntime` was null.
- A downgrade to the previous build 326 was refused by Android
  (`INSTALL_FAILED_VERSION_DOWNGRADE`); uninstalling would have erased data, so
  the fix shipped as a new build instead.

## Build 332 (commit 582f8b74, run 35650983097) — first working runtime

| Measurement | Value |
| --- | --- |
| Cold launch (`am start -W`) | TotalTime 1,269 ms |
| Process | stable for 90 s in the foreground, no crash since install |
| App receive bytes since install | 38.9 MB (encoder 34.8 MB + tokenizer 2.4 MB + overhead) |
| `localSemantic.runtime.state` | `ready`, model `e5-arb-32768@e1b3907e6c83#int8-70fd5ee627d2` |
| `metrics.downloadMs` | 5,425 (sum of the two parallel artifact downloads) |
| `metrics.prepareMs` | 4,309 (download, verification, tokenizer load) |
| `metrics.sessionMs` | 210 (ONNX session creation) |
| `metrics.failures` | 0 |
| `metrics.encodeCount` | 0 at export time (see below) |
| `shadow.observed / eligible` | 2 / 0 (two live notifications, neither review-eligible) |
| PSS after launch | 340–486 MB while the export was being prepared |
| `stability.androidHistoricalExits` | the build-331 crashes are recorded as `reason: crash`; none after 332 |

Why encode count was still zero: live capture only sees new messages and the
startup parser-repair pass is excluded from shadow mode, so an existing inbox
never reached the encoder; and the Ask fallback did not fire because the
planner answers an unread question with Help plus a clarification, which the
recovered chooser treated as authoritative. Both are addressed in the commits
that follow this build (tester-triggered inbox pass; `unrecognized` Help).

## Ask Wafra on device (build 332)

- "gimme the lowdown on where my cash went" → deterministic clarification
  ("could not find a recorded merchant matching …"), no model call. Correct:
  the planner recognised a merchant-shaped phrase, so the model must stay out.
- Arabic and mixed-language questions: not yet exercised on device (adb cannot
  type non-ASCII; to be done by the owner on the next build).

## Build 333 (commit d327ee7a, run 35654399147) — inbox shadow pass

- Installed in place; launched cleanly. "Send test diagnostics" started the
  bounded inbox pass (owner's inbox: about 30,000 SMS).
- The unthrottled drain held the JS thread at 106–117% CPU for roughly nine
  minutes with the process stable (pid unchanged, PSS 345–415 MB) and finished
  on its own; CPU returned to 0% and PSS to about 275 MB. The owner reported
  the app as laggy during that window, which is what the 40 ms drain gap in
  the following commit addresses. An Ask question typed during the drain was
  answered, but slowly.
- The next export (01:22 device time) came from a fresh process: the app had
  been restarted between the pass and the export, and the counters lived only
  in memory, so the pass results were lost. Persistence of the counters and
  the pass status follows in the next commit. The same export did confirm the
  verified-marker path: `downloadMs 0`, `prepareMs 247` (was 4,309 on first
  run), `sessionMs 304`, `failures 0`, state `ready`.

## Not yet measured

- Encode latency and shadow agreement over the inbox (needs the next build).
- HSBC live notification (needs a real alert to arrive; none spoofed).
- iOS runtime.
