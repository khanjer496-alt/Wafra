#!/usr/bin/env bash
# Actual Apple JavaScriptCore runtime, production Swift source and generated
# shipping resources. Host checks do not establish physical AppIntent behavior.
set -euo pipefail
cd "$(dirname "$0")/../.."
runtime=modules/wafra-live-capture/ios/WafraBackgroundAlertParser.swift
if [[ ! -f "$runtime" ]]; then
  echo 'Native background parser runtime is unavailable.' >&2
  exit 1
fi
if [[ "$(uname -s)" != Darwin ]] || ! command -v xcrun >/dev/null 2>&1; then
  echo 'Apple Swift and JavaScriptCore are required.' >&2
  exit 1
fi
scratch=$(mktemp -d "${TMPDIR:-/tmp}/wafra-native-parser.XXXXXX")
trap 'rm -rf "$scratch"' EXIT
xcrun swiftc -D DEBUG \
  modules/wafra-live-capture/ios/WafraNativeParserContext.swift \
  modules/wafra-live-capture/ios/WafraLiveCaptureStore.swift \
  modules/wafra-live-capture/ios/WafraLiveCaptureResources.swift \
  modules/wafra-live-capture/ios/WafraInstantAlertPatterns.generated.swift \
  modules/wafra-live-capture/ios/WafraInstantAlertReader.swift \
  modules/wafra-live-capture/ios/WafraBackgroundAlertParser.swift \
  modules/wafra-live-capture/ios/WafraInstantAlert.swift \
  scripts/test/native-background-alert-parser.swift \
  -framework JavaScriptCore -o "$scratch/native-background-parser-tests"
"$scratch/native-background-parser-tests" modules/wafra-live-capture/ios/Resources
sdk=$(xcrun --sdk iphonesimulator --show-sdk-path)
xcrun swiftc -typecheck -target arm64-apple-ios16.0-simulator -sdk "$sdk" \
  modules/wafra-live-capture/ios/WafraNativeParserContext.swift \
  modules/wafra-live-capture/ios/WafraLiveCaptureStore.swift \
  modules/wafra-live-capture/ios/WafraLiveCaptureResources.swift \
  modules/wafra-live-capture/ios/WafraInstantAlertPatterns.generated.swift \
  modules/wafra-live-capture/ios/WafraInstantAlertReader.swift \
  modules/wafra-live-capture/ios/WafraBackgroundAlertParser.swift \
  modules/wafra-live-capture/ios/WafraInstantAlert.swift
echo '✓ Production preview Swift type-checks against the iOS 16 simulator SDK'
