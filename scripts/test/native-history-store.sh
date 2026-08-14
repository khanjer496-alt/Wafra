#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

if ! command -v swiftc >/dev/null 2>&1; then
  echo "native-history-store.sh: swiftc is required to test the iOS history bridge." >&2
  exit 1
fi

generated_intent="ios/Wafra/WafraMessageHistoryIntent.swift"
project_file="ios/Wafra.xcodeproj/project.pbxproj"
plugin_file="modules/wafra-message-history/plugin/index.js"
module_config="modules/wafra-message-history/expo-module.config.json"

for file in "$generated_intent" "$project_file" "$plugin_file" "$module_config"; do
  if [ ! -f "$file" ]; then
    echo "native-history-store.sh: missing required native integration file: $file" >&2
    exit 1
  fi
done

grep -q 'struct StageWafraMessageHistoryIntent: AppIntent' "$generated_intent" || {
  echo "native-history-store.sh: generated App Intent is missing." >&2
  exit 1
}
awk '
  /Begin PBXSourcesBuildPhase section/ { in_sources = 1 }
  /End PBXSourcesBuildPhase section/ { in_sources = 0 }
  in_sources { print }
' "$project_file" | grep -q 'WafraMessageHistoryIntent.swift in Sources' || {
  echo "native-history-store.sh: App Intent is not a member of the iOS Sources build phase." >&2
  exit 1
}
grep -q "filePath: 'WafraMessageHistoryIntent.swift'" "$plugin_file" || {
  echo "native-history-store.sh: config plugin no longer generates the App Intent." >&2
  exit 1
}
grep -q '"podspecPath": "ios/WafraMessageHistory.podspec"' "$module_config" || {
  echo "native-history-store.sh: Expo cannot link the Message History pod on a clean prebuild." >&2
  exit 1
}

test_dir="$(mktemp -d /tmp/wafra-native-history.XXXXXX)"
trap 'rm -rf "$test_dir"' EXIT

swiftc \
  modules/wafra-message-history/ios/WafraMessageHistoryStore.swift \
  scripts/test/native-history-store.swift \
  -o "$test_dir/native-history-store-tests"

"$test_dir/native-history-store-tests"

echo "✓ generated App Intent is present in the iOS Sources build phase"
