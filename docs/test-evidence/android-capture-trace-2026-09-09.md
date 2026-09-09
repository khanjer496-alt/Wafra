# Android capture stage tracing

Build 143 was observed with a saved parser version of 37 despite containing
version 38. A controlled foreground refresh remained CPU-heavy without a
verified durable migration. A successful Node corpus replay does not establish
where the Android runtime is spending that time.

The opt-in `capture_trace` input on `build-apk.yml` enables local `WafraCapture`
log entries for inbox reads, per-page progress/completion, review persistence,
planning, ledger saving and completion. This is measurement, not a claimed fix.
It changes no monetary, matching, cursor, permission or persistence decisions.

The payload accepts only enumerated stage names, non-negative numeric counts,
page numbers and elapsed milliseconds. It accepts no bodies, senders, source
IDs, transaction IDs, message dates, account identifiers, amounts or errors.
Nothing is sent over a network or retained by the tracing module. Logging sink
failures are ignored, never financial execution failures. Ordinary APKs default
off; a diagnostic-traced Play bundle is refused by the workflow.

Observe an installed diagnostic APK using:

```sh
adb -s DEVICE_SERIAL logcat -v threadtime ReactNativeJS:I '*:S'
```

Interpret the last completed boundary, not CPU usage alone. `page:read` times
the native read; `page:progress` reports actual processed positions at roughly
one-second intervals when JavaScript advances; `page:done` times its parsing and
scheduling. `plan:done` and `save:done` distinguish computation from durability.
Absence of a completion marker is not permission to stamp the parser version.

Install only with the established signer and without uninstalling or clearing
app data. Keep raw exports and captured local evidence outside tracked source.
The trace build is for the owner's connected-phone diagnosis, not a public
download or a claim that the recheck is complete.
