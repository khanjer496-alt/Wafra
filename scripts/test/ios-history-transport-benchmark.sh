#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
count="${1:-1000}"
if [[ ! "$count" =~ ^[0-9]{1,5}$ ]]; then
  echo "usage: bash scripts/test/ios-history-transport-benchmark.sh [1..10000]" >&2
  exit 2
fi
count=$((10#$count))
if (( count < 1 || count > 10000 )); then
  echo "usage: bash scripts/test/ios-history-transport-benchmark.sh [1..10000]" >&2
  exit 2
fi
test_dir="$(mktemp -d /tmp/wafra-transport-benchmark.XXXXXX)"
trap 'rm -rf "$test_dir"' EXIT
swiftc -O -warnings-as-errors -parse-as-library \
  scripts/test/support/host-file-protection.swift \
  modules/wafra-message-history/ios/WafraMessageHistoryStore.swift \
  modules/wafra-message-history/ios/WafraPreparedHistoryStore.swift \
  modules/wafra-message-history/ios/WafraMessageHistoryImporter.swift \
  scripts/test/ios-history-transport-benchmark.swift \
  -o "$test_dir/benchmark"
"$test_dir/benchmark" "$count"
