# Adversarial mobile workflow

These flows exercise the first-run privacy boundary against a native build,
not Expo Go. They are intentionally stateful: the shell establishes the OS
permission condition, then an accessibility driver operates only the app UI.

## Android

Prerequisites: a booted AVD, the release APK installed, Maestro, and JDK 17.

```sh
export JAVA_HOME=/opt/homebrew/Cellar/openjdk@17/17.0.20/libexec/openjdk.jdk/Contents/Home
export APP_ID=app.wafra.android
export PLATFORM=android

# Retained OS permission + explicit in-app opt-out. This is the regression
# case that originally imported messages after "no SMS access" was chosen.
adb shell pm clear "$APP_ID"
adb shell pm grant "$APP_ID" android.permission.READ_SMS
adb emu sms send 15551234567 \
  "Purchase of AED 37.00 with Debit Card ending 1354 at ADVERSARIAL OPT OUT, DUBAI."
~/.maestro/bin/maestro test -e APP_ID="$APP_ID" -e PLATFORM="$PLATFORM" \
  scripts/e2e/adversarial/onboarding-manual.yaml

# Permission-denied state. Android SMS permission behavior varies by image;
# this flow taps the native "Don’t allow" action when the image presents it.
adb shell pm clear "$APP_ID"
adb shell pm revoke --user 0 "$APP_ID" android.permission.READ_SMS
adb shell pm clear-permission-flags "$APP_ID" android.permission.READ_SMS user-set user-fixed
~/.maestro/bin/maestro test -e APP_ID="$APP_ID" -e PLATFORM="$PLATFORM" \
  scripts/e2e/adversarial/onboarding-permission-denied.yaml
```

Some API 36 Google images restore restricted SMS grants automatically. A run
that never presents the native denial button is inconclusive, not a pass. The
separate `onboarding-permission-blocked.yaml` covers a durable OS-level denial
on images that honor `user-fixed`; source-level permission-denial behavior is
also covered by the onboarding and capture contract suites.

Run visual stress variants after the functional flow:

```sh
adb shell pm clear "$APP_ID"
adb shell settings put system font_scale 2.0
adb shell settings put global animator_duration_scale 0
~/.maestro/bin/maestro test -e APP_ID="$APP_ID" -e PLATFORM=android-large-text \
  scripts/e2e/adversarial/welcome-smoke.yaml

# App-scoped Arabic/RTL without changing the owner's whole emulator.
adb shell pm clear "$APP_ID"
adb shell cmd locale set-app-localeconfig "$APP_ID" --locales en,ar
adb shell cmd locale set-app-locales "$APP_ID" --locales ar-AE
~/.maestro/bin/maestro test -e APP_ID="$APP_ID" -e PLATFORM=android \
  scripts/e2e/adversarial/welcome-rtl.yaml

# Restore the dedicated emulator after screenshots.
adb shell settings put system font_scale 1.0
adb shell settings put global animator_duration_scale 1
adb shell cmd locale set-app-locales "$APP_ID" --locales en-US
```

## iOS

Use Xcode's normal `Sign to Run Locally` simulator signing, then drive the app
through Maestro or `idb`'s accessibility tree. A paid Apple signing identity is
not needed for this simulator flow. Keeping both semantic drivers avoids making
the iOS gate depend on one harness.

```sh
export DEVICE_ID=DFEF9E5D-9BC5-4B05-8CA6-C70A25587292
export DERIVED_DATA=/tmp/wafra-ios-simulator
export APP_PATH="$DERIVED_DATA/Build/Products/Release-iphonesimulator/Wafra.app"
export APP_ID=app.wafra.ios

# One-time local harness setup:
brew install idb-companion
uv tool install fb-idb

scripts/e2e/adversarial/build-ios-simulator.sh

# Primary native flow (Maestro 2.8 verified with Xcode 26.1 / iOS 26.1):
~/.maestro/bin/maestro --udid "$DEVICE_ID" test \
  -e APP_ID="$APP_ID" -e PLATFORM=ios \
  scripts/e2e/adversarial/onboarding-manual-ios.yaml

# Independent semantic fallback using the same signed app:
node scripts/e2e/adversarial/run-ios-idb.mjs

# Visual stress variants use the same signed app and simulator.
xcrun simctl ui "$DEVICE_ID" appearance dark
xcrun simctl ui "$DEVICE_ID" content_size accessibility-extra-extra-large
xcrun simctl ui "$DEVICE_ID" increase_contrast enabled
```

Do not use `CODE_SIGNING_ALLOWED=NO` for this test. It removes the Keychain
application identity, so Expo SecureStore and the SQLCipher key fail closed on
startup. The build script deliberately leaves signing enabled and verifies the
resulting local signature before installation.

Simulator evidence cannot prove real iPhone Messages automation, Shortcut
history capture, locked/background push wake, StoreKit purchase, or pasteboard
privacy. Those remain physical-device gates.
