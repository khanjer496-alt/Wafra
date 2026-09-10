#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
test_dir="$(mktemp -d /tmp/wafra-paging-check.XXXXXX)"
trap 'rm -rf "$test_dir"' EXIT
swiftc -O -warnings-as-errors -parse-as-library \
  scripts/test/support/host-file-protection.swift \
  modules/wafra-message-history/ios/WafraMessageHistoryStore.swift \
  modules/wafra-message-history/ios/WafraPreparedHistoryStore.swift \
  modules/wafra-message-history/ios/WafraMessageHistoryImporter.swift \
  modules/wafra-message-history/ios/WafraHistoryCursor.swift \
  modules/wafra-message-history/ios/WafraPagedHistoryStore.swift \
  scripts/test/ios-history-paging.swift -o "$test_dir/check"
"$test_dir/check"
