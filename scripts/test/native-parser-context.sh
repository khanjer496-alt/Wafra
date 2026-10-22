#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
scratch=$(mktemp -d "${TMPDIR:-/tmp}/wafra-parser-context.XXXXXX")
trap 'rm -rf "$scratch"' EXIT
swiftc -D DEBUG \
  modules/wafra-live-capture/ios/WafraNativeParserContext.swift \
  modules/wafra-live-capture/ios/WafraLiveCaptureStore.swift \
  modules/wafra-live-capture/ios/WafraInstantAlertPatterns.generated.swift \
  modules/wafra-live-capture/ios/WafraInstantAlertReader.swift \
  scripts/test/native-parser-context.swift -o "$scratch/context-tests"
"$scratch/context-tests"
