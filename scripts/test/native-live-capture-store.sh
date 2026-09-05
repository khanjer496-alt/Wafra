#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

if ! command -v swiftc >/dev/null 2>&1; then
  echo "native-live-capture-store.sh: swiftc is required to test the protected iOS queue." >&2
  exit 1
fi

test_dir="$(mktemp -d /tmp/wafra-native-live.XXXXXX)"
trap 'rm -rf "$test_dir"' EXIT

swiftc -D DEBUG \
  modules/wafra-live-capture/ios/WafraLiveCaptureStore.swift \
  scripts/test/native-live-capture-store.swift \
  -o "$test_dir/native-live-capture-store-tests"

"$test_dir/native-live-capture-store-tests"

swiftc \
  -parse-as-library \
  -emit-module \
  -emit-object \
  -module-name ExpoModulesCore \
  -emit-module-path "$test_dir/ExpoModulesCore.swiftmodule" \
  modules/wafra-live-capture/ios/Tests/ExpoModulesCoreStub.swift \
  -o "$test_dir/ExpoModulesCore.o"

swiftc \
  -I "$test_dir" \
  "$test_dir/ExpoModulesCore.o" \
  modules/wafra-live-capture/ios/Tests/WafraLiveCaptureStoreStub.swift \
  modules/wafra-live-capture/ios/WafraLiveCaptureModule.swift \
  modules/wafra-live-capture/ios/Tests/WafraLiveCaptureBridgeBehaviorTests.swift \
  -o "$test_dir/native-live-capture-bridge-tests"

"$test_dir/native-live-capture-bridge-tests"

ios_simulator_sdk="$(xcrun --sdk iphonesimulator --show-sdk-path)"
mkdir -p "$test_dir/intent-debug" "$test_dir/intent-release"

xcrun swiftc \
  -parse-as-library \
  -emit-module \
  -module-name WafraLiveCapture \
  -D DEBUG \
  -target arm64-apple-ios15.1-simulator \
  -sdk "$ios_simulator_sdk" \
  -emit-module-path "$test_dir/intent-debug/WafraLiveCapture.swiftmodule" \
  modules/wafra-live-capture/ios/Tests/WafraLiveCaptureIntentModuleStub.swift

xcrun swiftc \
  -typecheck \
  -D DEBUG \
  -target arm64-apple-ios15.1-simulator \
  -sdk "$ios_simulator_sdk" \
  -I "$test_dir/intent-debug" \
  ios/Wafra/WafraLiveCaptureIntent.swift
echo "✓ Debug App Intent source includes and type-checks the automation-input probe"

xcrun swiftc \
  -parse-as-library \
  -emit-module \
  -module-name WafraLiveCapture \
  -target arm64-apple-ios15.1-simulator \
  -sdk "$ios_simulator_sdk" \
  -emit-module-path "$test_dir/intent-release/WafraLiveCapture.swiftmodule" \
  modules/wafra-live-capture/ios/Tests/WafraLiveCaptureIntentModuleStub.swift

xcrun swiftc \
  -typecheck \
  -target arm64-apple-ios15.1-simulator \
  -sdk "$ios_simulator_sdk" \
  -I "$test_dir/intent-release" \
  ios/Wafra/WafraLiveCaptureIntent.swift
echo "✓ Release App Intent source type-checks without the diagnostic probe writer"

swiftc \
  modules/wafra-live-capture/ios/WafraLiveCaptureResources.swift \
  modules/wafra-live-capture/ios/Tests/WafraLiveCaptureResourcesBehaviorTests.swift \
  -o "$test_dir/native-live-capture-resource-tests"

mkdir "$test_dir/runtime-resources"
cp "$test_dir/native-live-capture-resource-tests" "$test_dir/runtime-resources/"
mkdir "$test_dir/runtime-resources/WafraLiveCaptureResources.bundle"
cp -R modules/wafra-live-capture/ios/Resources/. \
  "$test_dir/runtime-resources/WafraLiveCaptureResources.bundle/"

"$test_dir/runtime-resources/native-live-capture-resource-tests" verify

set +e
bash -c '"$1" "$2" >/dev/null 2>&1' _ \
  "$test_dir/runtime-resources/native-live-capture-resource-tests" missing-key \
  2>/dev/null
missing_key_status=$?
mkdir "$test_dir/runtime-missing-bundle"
cp "$test_dir/native-live-capture-resource-tests" "$test_dir/runtime-missing-bundle/"
bash -c '"$1" "$2" >/dev/null 2>&1' _ \
  "$test_dir/runtime-missing-bundle/native-live-capture-resource-tests" missing-bundle \
  2>/dev/null
missing_bundle_status=$?
set -e

if [[ "$missing_key_status" -eq 0 || "$missing_key_status" -eq 126 || "$missing_key_status" -eq 127 ||
      "$missing_bundle_status" -eq 0 || "$missing_bundle_status" -eq 126 || "$missing_bundle_status" -eq 127 ]]; then
  echo "native-live-capture-store.sh: resource helper did not fail closed." >&2
  exit 1
fi
echo "✓ resource helper terminates for a missing localization key"
echo "✓ resource helper terminates for a missing CocoaPods bundle"

english_intents="modules/wafra-live-capture/ios/Resources/en.lproj/WafraIntents.strings"
arabic_intents="modules/wafra-live-capture/ios/Resources/ar.lproj/WafraIntents.strings"
plutil -lint "$english_intents" "$arabic_intents" >/dev/null

english_sender="$(plutil -extract 'live\.stage\.sender\.parameter' raw "$english_intents")"
arabic_sender="$(plutil -extract 'live\.stage\.sender\.parameter' raw "$arabic_intents")"
if [[ "$english_sender" != "Sender" || "$arabic_sender" == "$english_sender" || "$arabic_sender" == "live.stage.sender.parameter" ]]; then
  echo "native-live-capture-store.sh: intent localization lookup failed closed-set checks." >&2
  exit 1
fi
