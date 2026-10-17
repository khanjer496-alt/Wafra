#!/usr/bin/env bash
# Typechecks the iOS module (bridge, app-delegate subscriber and adopter)
# against the installed iPhoneOS SDK at the app's deployment target and the
# current SDK, in Swift 5 and 6 modes. No Xcode project or pods are created.
set -euo pipefail
cd "$(dirname "$0")/.."
SDK="$(xcrun --sdk iphoneos --show-sdk-path)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
for file in WafraIncomingFileModule.swift WafraIncomingFileAppDelegateSubscriber.swift; do
  sed '/^import ExpoModulesCore$/d' "$file" > "$WORK/$file"
done
for target in arm64-apple-ios15.1 arm64-apple-ios26.0; do
  for mode in 5 6; do
    xcrun swiftc -typecheck -swift-version "$mode" -sdk "$SDK" -target "$target" \
      Tests/ExpoModulesCoreStub.swift WafraIncomingFileAdopter.swift \
      "$WORK/WafraIncomingFileModule.swift" "$WORK/WafraIncomingFileAppDelegateSubscriber.swift"
    echo "typecheck ok: $target swift $mode"
  done
done
