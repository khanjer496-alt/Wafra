#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
scratch=$(mktemp -d "${TMPDIR:-/tmp}/wafra-native-queue-signal.XXXXXX")
trap 'rm -rf "$scratch"' EXIT
swiftc -parse-as-library -emit-module -emit-object -module-name ExpoModulesCore \
  -emit-module-path "$scratch/ExpoModulesCore.swiftmodule" \
  modules/wafra-live-capture/ios/Tests/ExpoModulesCoreStub.swift -o "$scratch/ExpoModulesCore.o"
swiftc -I "$scratch" "$scratch/ExpoModulesCore.o" \
  modules/wafra-live-capture/ios/WafraLiveCaptureStore.swift \
  modules/wafra-live-capture/ios/WafraLiveCaptureModule.swift \
  scripts/test/native-live-queue-signal.swift -o "$scratch/queue-signal-tests"
"$scratch/queue-signal-tests"
