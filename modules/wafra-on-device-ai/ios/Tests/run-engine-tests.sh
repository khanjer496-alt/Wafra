#!/usr/bin/env bash
# Builds the engine plus its host tests for macOS 26 (FoundationModels shares
# its API with iOS 26) into a temporary directory and runs them.
set -euo pipefail
cd "$(dirname "$0")/.."
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
xcrun swiftc -parse-as-library -swift-version 5 -target arm64-apple-macos26.0 \
  -sdk "$(xcrun --sdk macosx --show-sdk-path)" \
  WafraOnDeviceAIEngine.swift Tests/WafraOnDeviceAIEngineTests.swift -o "$WORK/engine-tests"
"$WORK/engine-tests"
