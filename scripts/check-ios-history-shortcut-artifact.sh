#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
usage:
  bash scripts/check-ios-history-shortcut-artifact.sh <artifact>
  bash scripts/check-ios-history-shortcut-artifact.sh --production <json|binary.shortcut>
  bash scripts/check-ios-history-shortcut-artifact.sh --smoke <json|binary.shortcut>
  bash scripts/check-ios-history-shortcut-artifact.sh --signature-only <signed.shortcut>
  bash scripts/check-ios-history-shortcut-artifact.sh --sign-production <input> <output.signed.shortcut>
  bash scripts/check-ios-history-shortcut-artifact.sh --sign-smoke <input> <output.signed.shortcut>

One unsigned argument defaults to production verification. A signed AEA
requires explicit --signature-only because Apple does not expose its decrypted
graph. Use --sign-production or --sign-smoke to verify and sign in one trusted
process.
USAGE
  exit 2
}

MODE=auto
INPUT_PATH=
OUTPUT_PATH=
case $# in
  1)
    INPUT_PATH=$1
    ;;
  2)
    case $1 in
      --production) MODE=production ;;
      --smoke) MODE=smoke ;;
      --signature-only) MODE=signature-only ;;
      *) usage ;;
    esac
    INPUT_PATH=$2
    ;;
  3)
    case $1 in
      --sign-production) MODE=sign-production ;;
      --sign-smoke) MODE=sign-smoke ;;
      *) usage ;;
    esac
    INPUT_PATH=$2
    OUTPUT_PATH=$3
    ;;
  *) usage ;;
esac

[[ -f "$INPUT_PATH" ]] || usage
if [[ -n "$OUTPUT_PATH" && "$INPUT_PATH" == "$OUTPUT_PATH" ]]; then
  echo "FAIL: signed output must differ from input" >&2
  exit 1
fi

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
BUILDER_PATH="$SCRIPT_DIR/build-ios-history-shortcut.mjs"
TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/wafra-history-shortcut-check.XXXXXX")
trap 'rm -rf "$TMP_DIR"' EXIT

first_four_bytes() {
  LC_ALL=C dd if="$1" bs=1 count=4 status=none 2>/dev/null || true
}

decode_graph() {
  local source_path=$1
  local destination_path=$2
  # Cross-platform CI can still verify the canonical JSON graph without
  # Apple's plist tools. Binary Shortcut decoding remains an Apple-host gate.
  if node - "$source_path" "$destination_path" <<'NODE'
const fs = require('node:fs');
const [source, destination] = process.argv.slice(2);
try {
  const text = fs.readFileSync(source, 'utf8');
  JSON.parse(text);
  fs.writeFileSync(destination, text);
} catch {
  process.exit(1);
}
NODE
  then
    return
  fi
  command -v plutil >/dev/null 2>&1 || {
    echo "FAIL: Apple plutil is required to decode a binary Shortcut" >&2
    exit 1
  }
  if ! plutil -convert json -o "$destination_path" "$source_path" 2>"$TMP_DIR/plutil.err"; then
    sed -n '1,20p' "$TMP_DIR/plutil.err" >&2
    echo "FAIL: artifact is not a JSON or binary Shortcut property list" >&2
    exit 1
  fi
}

verify_graph() {
  local graph_path=$1
  local graph_mode=$2
  node --input-type=module - "$BUILDER_PATH" "$graph_path" "$graph_mode" <<'NODE'
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';

const builderPath = process.argv[2];
const graphPath = process.argv[3];
const graphMode = process.argv[4];
const graph = JSON.parse(readFileSync(graphPath, 'utf8'));
const { buildHistoryShortcut, verifyHistoryShortcutGraph } = await import(
  pathToFileURL(builderPath)
);

verifyHistoryShortcutGraph(graph);
const expected = buildHistoryShortcut({
  messageLimit: graphMode === 'smoke' ? 50 : 1500,
  smoke: graphMode === 'smoke',
});
if (!isDeepStrictEqual(graph, expected)) {
  throw new Error(
    graphMode === 'smoke'
      ? 'artifact is not the exact limit-50 smoke graph'
      : 'artifact is not the exact two-ended production graph',
  );
}
NODE
}

apple_validate_signed() {
  local signed_path=$1
  if [[ "$(first_four_bytes "$signed_path")" != "AEA1" ]]; then
    echo "FAIL: expected an Apple signed AEA1 Shortcut" >&2
    exit 1
  fi
  command -v shortcuts >/dev/null 2>&1 || {
    echo "FAIL: Apple Shortcuts CLI is required to validate a signed AEA" >&2
    exit 1
  }
  if ! shortcuts sign --mode anyone \
    --input "$signed_path" \
    --output "$TMP_DIR/apple-validated.signed.shortcut" \
    >"$TMP_DIR/shortcuts-sign.out" 2>"$TMP_DIR/shortcuts-sign.err"; then
    sed -n '1,20p' "$TMP_DIR/shortcuts-sign.err" >&2
    echo "FAIL: Apple rejected the signed Shortcut AEA" >&2
    exit 1
  fi
  if [[ "$(first_four_bytes "$TMP_DIR/apple-validated.signed.shortcut")" != "AEA1" ]]; then
    echo "FAIL: Apple did not produce a validated signed AEA" >&2
    exit 1
  fi
}

MAGIC=$(first_four_bytes "$INPUT_PATH")
if [[ "$MODE" == auto ]]; then
  if [[ "$MAGIC" == "AEA1" ]]; then
    echo "FAIL: signed Shortcuts are opaque; use --signature-only explicitly or verify and sign with --sign-*" >&2
    exit 1
  else
    MODE=production
  fi
fi

case $MODE in
  production|smoke)
    if [[ "$MAGIC" == "AEA1" ]]; then
      echo "FAIL: a signed AEA is opaque; use --signature-only or a trusted --sign-* pipeline" >&2
      exit 1
    fi
    decode_graph "$INPUT_PATH" "$TMP_DIR/decoded.json"
    verify_graph "$TMP_DIR/decoded.json" "$MODE"
    echo "PASS: audited $MODE Wafra History Import graph matches"
    ;;
  signature-only)
    apple_validate_signed "$INPUT_PATH"
    echo "SIGNATURE-ONLY: Apple validated the AEA; graph contents are opaque and were not audited"
    ;;
  sign-production|sign-smoke)
    if [[ "$MAGIC" == "AEA1" ]]; then
      echo "FAIL: trusted signing requires an unsigned JSON or binary graph" >&2
      exit 1
    fi
    GRAPH_MODE=${MODE#sign-}
    decode_graph "$INPUT_PATH" "$TMP_DIR/decoded.json"
    verify_graph "$TMP_DIR/decoded.json" "$GRAPH_MODE"
    command -v plutil >/dev/null 2>&1 || {
      echo "FAIL: Apple plutil is required by the trusted signing pipeline" >&2
      exit 1
    }
    plutil -convert binary1 -o "$TMP_DIR/audited.shortcut" "$TMP_DIR/decoded.json"
    if ! shortcuts sign --mode anyone \
      --input "$TMP_DIR/audited.shortcut" \
      --output "$TMP_DIR/audited.signed.shortcut" \
      >"$TMP_DIR/shortcuts-sign.out" 2>"$TMP_DIR/shortcuts-sign.err"; then
      sed -n '1,20p' "$TMP_DIR/shortcuts-sign.err" >&2
      echo "FAIL: Apple could not sign the audited Shortcut" >&2
      exit 1
    fi
    apple_validate_signed "$TMP_DIR/audited.signed.shortcut"
    mkdir -p "$(dirname "$OUTPUT_PATH")"
    cp "$TMP_DIR/audited.signed.shortcut" "$OUTPUT_PATH"
    CHECKSUM=$(shasum -a 256 "$OUTPUT_PATH" | awk '{print $1}')
    echo "PASS: TRUSTED PIPELINE signed audited $GRAPH_MODE graph"
    echo "SHA-256 $CHECKSUM  $OUTPUT_PATH"
    ;;
  *) usage ;;
esac
