#!/usr/bin/env bash
# Runs one Maestro flow against the probe simulator with every output under
# $OUT. Maestro resolves takeScreenshot paths inside its own output folder
# and refuses an absolute path (probe run 3), so flows name screenshots
# relatively and this wrapper points that folder at the evidence directory.
#
# usage: bash scripts/ios-sim/maestro-test.sh <flow.yaml> [-e KEY=VALUE ...]
set -euo pipefail
: "${UDID:?UDID is required}"
: "${OUT:?OUT is required}"
FLOW=$1; shift
mkdir -p "$OUT"
maestro --device "$UDID" test \
  --test-output-dir "$OUT" \
  --debug-output "$OUT" \
  --flatten-debug-output \
  "$@" "$FLOW"
