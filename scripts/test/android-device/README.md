# Focused Unicode input helper

Local QA tooling for the authorized Wafra phone session. This builds a dex JAR
for the legacy Android `uiautomator runtest` runner, not an app APK. Nothing in
the build script connects to a device.

```sh
bash scripts/test/android-device/build-input-helper.sh
```

Requires a JDK with `javac --release 8`, SDK platform 36 (`android.jar` and
`uiautomator.jar`), and build-tools 36.0.0 (`d8`). The build also uses
`optional/android.test.base.jar` when present. Set `ANDROID_SDK_ROOT` or
`ANDROID_HOME` if the SDK is outside the default macOS SDK location. Output is
ignored at `artifacts/android-device-20260919/input-helper/wafra-text-input.jar`.

## Runtime command

Verified on Android 16 with exact English and Arabic text, including Arabic-Indic
digits, and refusal when no editable Wafra field was focused. Confirm `uiautomator runtest` and `/system/framework/android.test.base.jar`
are available, then push the JAR to `/data/local/tmp/wafra-text-input.jar`.
Deliberately focus
the intended Wafra field. For example, this would enter the synthetic text
`Wafra QA`. Set `ANDROID_SERIAL` to the explicitly selected device from
`adb devices -l` first:

```sh
adb -s "$ANDROID_SERIAL" shell uiautomator runtest \
  /system/framework/android.test.base.jar /data/local/tmp/wafra-text-input.jar \
  -c app.wafra.qa.WafraTextInput#testSetFocusedText \
  -e text_base64 V2FmcmEgUUE=
```

The framework dependency is required on the tested Android 16 device: without it,
the legacy runner aborts on `android.test.RepetitiveTest` while still printing
`OK (1 test)`. Treat any unexpected exception, shortMsg, failure, or aborted run
as failure; verify the screen as well as the test result. The final runner status
`-1` alone is not a failure.

An optional `-e resource_id EXACT_RESOURCE_ID` adds an exact resource-ID match.
Use standard padded Base64 of UTF-8 bytes, without line breaks. The Java helper accepts an explicitly empty argument, but
the legacy shell
launcher may discard empty arguments; clearing through this command is not
verified. A missing argument is refused. Decoded input is capped at 8 KiB.

The helper requires a visible, enabled, focused, editable
`android.widget.EditText` belonging to `app.wafra.android`. It checks the same
node immediately before writing and during bounded exact-text verification.
It uses only `ACTION_SET_TEXT`, never focuses another field, submits a form,
presses a key, accesses the clipboard, reads SMS or databases, or uses the
network. Output and failure messages do not include requested or observed text.

Only use synthetic QA input. Setting text can invoke the app's ordinary change
handler; this helper does not override that behavior or roll it back. A failed
readback can leave the field edited, so inspect the intended screen before the
next QA step. It does not prove keyboard/IME behavior or native message capture.
