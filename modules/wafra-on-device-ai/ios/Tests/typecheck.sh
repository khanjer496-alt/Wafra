#!/usr/bin/env bash
# Typechecks the iOS module against the installed iPhoneOS SDK at both the
# app's deployment target (15.1: every FoundationModels use must be guarded)
# and iOS 26 (the FoundationModels path itself). No Xcode project, pods or
# build products are created.
set -euo pipefail
cd "$(dirname "$0")/.."
SDK="$(xcrun --sdk iphoneos --show-sdk-path)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
sed '/^import ExpoModulesCore$/d' WafraOnDeviceAIModule.swift > "$WORK/WafraOnDeviceAIModule.swift"
for target in arm64-apple-ios15.1 arm64-apple-ios26.0; do
  for mode in 5 6; do
    xcrun swiftc -typecheck -swift-version "$mode" -sdk "$SDK" -target "$target" \
      Tests/ExpoModulesCoreStub.swift WafraOnDeviceAIEngine.swift "$WORK/WafraOnDeviceAIModule.swift"
    echo "typecheck ok: $target swift $mode"
  done
done
