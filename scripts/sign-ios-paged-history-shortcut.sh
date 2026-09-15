#!/usr/bin/env bash
set -euo pipefail

# Generate, verify, convert and sign the paged History Shortcut on a Mac.
#
# Apple's `shortcuts sign` only works on a Mac that is signed into iCloud
# ("In order to do this, you must be signed into iCloud"), so this cannot run
# on a CI runner. The signed file is named so that Apple installs it under the
# name the released app already runs (`Wafra-History-v2-typed-date.signed`),
# which lets a phone test a repaired graph against an existing TestFlight build
# without an app rebuild. Nothing here publishes an iCloud record.
#
# usage:
#   bash scripts/sign-ios-paged-history-shortcut.sh [output.shortcut] [--columnar]
#
# default output: ~/Desktop/Wafra-History-v2-typed-date.signed.shortcut

OUTPUT="$HOME/Desktop/Wafra-History-v2-typed-date.signed.shortcut"
GRAPH=paged-v2
for arg in "$@"; do
  case "$arg" in
    --columnar) GRAPH=columnar-v3 ;;
    --*) echo "unknown option: $arg" >&2; exit 2 ;;
    *) OUTPUT=$arg ;;
  esac
done

[[ "$(uname -s)" == Darwin ]] || { echo "FAIL: signing needs macOS with the Shortcuts CLI" >&2; exit 1; }
command -v shortcuts >/dev/null 2>&1 || { echo "FAIL: Apple's shortcuts CLI is missing" >&2; exit 1; }
command -v plutil >/dev/null 2>&1 || { echo "FAIL: plutil is missing" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "FAIL: node is required to generate the graph" >&2; exit 1; }

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/wafra-paged-shortcut-sign.XXXXXX")
trap 'rm -rf "$TMP_DIR"' EXIT

cd "$ROOT"
if [[ "$GRAPH" == columnar-v3 ]]; then
  node scripts/build-ios-paged-history-shortcut.mjs --columnar "$TMP_DIR/graph.json" >/dev/null
else
  node scripts/build-ios-paged-history-shortcut.mjs "$TMP_DIR/graph.json" >/dev/null
fi

node --test scripts/test/ios-paging-shortcut.test.mjs >"$TMP_DIR/tests.out" 2>&1 || {
  tail -n 40 "$TMP_DIR/tests.out" >&2
  echo "FAIL: paging shortcut tests did not pass; not signing" >&2
  exit 1
}

node --input-type=module - "$TMP_DIR/graph.json" "$GRAPH" <<'NODE'
import { readFileSync } from 'node:fs';
import { verifyPagedHistoryShortcut, verifyColumnarHistoryShortcut } from './scripts/build-ios-paged-history-shortcut.mjs';
const graph = JSON.parse(readFileSync(process.argv[2], 'utf8'));
(process.argv[3] === 'columnar-v3' ? verifyColumnarHistoryShortcut : verifyPagedHistoryShortcut)(graph);
const combines = graph.WFWorkflowActions.filter(a => a.WFWorkflowActionIdentifier === 'is.workflow.actions.text.combine');
if (combines.length === 0 || combines.some(a => !a.WFWorkflowActionParameters.text || a.WFWorkflowActionParameters.WFInput)) {
  throw new Error('Combine Text must bind its input under the `text` key');
}
console.log(`graph verified: ${graph.WFWorkflowName}, ${graph.WFWorkflowActions.length} actions, ${combines.length} Combine Text`);
NODE

plutil -convert binary1 -o "$TMP_DIR/unsigned.shortcut" "$TMP_DIR/graph.json"
mkdir -p "$(dirname "$OUTPUT")"
rm -f "$OUTPUT"
if ! shortcuts sign --mode anyone --input "$TMP_DIR/unsigned.shortcut" --output "$OUTPUT" 2>"$TMP_DIR/sign.err"; then
  cat "$TMP_DIR/sign.err" >&2
  echo "FAIL: Apple refused to sign. This Mac must be signed into iCloud in System Settings." >&2
  exit 1
fi
MAGIC=$(LC_ALL=C dd if="$OUTPUT" bs=1 count=4 status=none)
[[ "$MAGIC" == "AEA1" ]] || { echo "FAIL: output is not an Apple-signed AEA1 Shortcut" >&2; exit 1; }

echo "signed: $OUTPUT"
shasum -a 256 "$OUTPUT"
cat <<'NEXT'

Next, on the iPhone (or on this Mac; Shortcuts syncs through iCloud):
  1. In Shortcuts, delete the installed "Wafra-History-v2-typed-date.signed".
  2. Open the signed file (AirDrop, Files, or double-click here) and tap Add Shortcut.
  3. In Wafra, run the history import again (Settings > iOS setup > History, or Continue).
  4. When the first page is accepted, share the Shortcut > Copy iCloud Link, then run
     bash scripts/refresh-history-shortcut-record.sh <current-id> <new-id>
     and node scripts/release/ios-public-shortcut-check.mjs.
NEXT
