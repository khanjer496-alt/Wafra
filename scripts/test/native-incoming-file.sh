#!/usr/bin/env bash
# Host tests for the "Open in Wafra" adopter (modules/wafra-incoming-file):
# the Foundation-only copy/validation core against real temporary files, plus
# an iPhoneOS SDK typecheck of the Expo bridge and app-delegate subscriber.
# Security-scoped access and iCloud downloads themselves need a device.
set -euo pipefail
cd "$(dirname "$0")/../.."
scratch=$(mktemp -d "${TMPDIR:-/tmp}/wafra-native-incoming-file.XXXXXX")
trap 'rm -rf "$scratch"' EXIT
cp scripts/test/native-incoming-file.swift "$scratch/main.swift"
swiftc -warnings-as-errors \
  modules/wafra-incoming-file/ios/WafraIncomingFileAdopter.swift \
  "$scratch/main.swift" -o "$scratch/incoming-file-tests"
"$scratch/incoming-file-tests"
bash modules/wafra-incoming-file/ios/Tests/typecheck.sh
