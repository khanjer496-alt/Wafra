#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
if ! command -v swiftc >/dev/null 2>&1; then
  echo "Swift compiler is required for the native synthetic benchmark." >&2
  exit 1
fi
test_dir="$(mktemp -d /tmp/wafra-batch-benchmark-build.XXXXXX)"
trap 'rm -rf "$test_dir"' EXIT
swiftc -warnings-as-errors -parse-as-library \
  scripts/test/support/host-file-protection.swift \
  modules/wafra-message-history/ios/WafraMessageHistoryStore.swift \
  modules/wafra-message-history/ios/WafraPreparedHistoryStore.swift \
  modules/wafra-message-history/ios/WafraMessageHistoryImporter.swift \
  scripts/test/ios-history-batch-benchmark.swift \
  -o "$test_dir/benchmark"
if [ "$#" -eq 0 ]; then
  set -- 300
fi
"$test_dir/benchmark" "$@"
