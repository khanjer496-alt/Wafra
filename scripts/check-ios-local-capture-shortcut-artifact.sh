#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
usage:
  bash scripts/check-ios-local-capture-shortcut-artifact.sh <json|binary.shortcut>
  bash scripts/check-ios-local-capture-shortcut-artifact.sh --json <json>
  bash scripts/check-ios-local-capture-shortcut-artifact.sh --signature-only <signed.shortcut>
  bash scripts/check-ios-local-capture-shortcut-artifact.sh --sign <input> <output.signed.shortcut>

Unsigned input is decoded and compared with the complete audited graph. Apple
signed AEA files are opaque, so use --signature-only only to validate Apple's
signature. Use --sign to audit and sign in one trusted temporary pipeline.
USAGE
  exit 2
}

MODE=verify
INPUT_PATH=
OUTPUT_PATH=
case $# in
  1)
    INPUT_PATH=$1
    ;;
  2)
    case $1 in
      --json) MODE=verify-json ;;
      --signature-only) MODE=signature-only ;;
      *) usage ;;
    esac
    INPUT_PATH=$2
    ;;
  3)
    [[ $1 == --sign ]] || usage
    MODE=sign
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
BUILDER_PATH="$SCRIPT_DIR/build-ios-local-capture-shortcut.mjs"
TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/wafra-local-capture-check.XXXXXX")
trap 'rm -rf "$TMP_DIR"' EXIT

first_four_bytes() {
  LC_ALL=C dd if="$1" bs=1 count=4 status=none 2>/dev/null || true
}

decode_graph() {
  local source_path=$1
  local destination_path=$2
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
  node --input-type=module - "$BUILDER_PATH" "$graph_path" <<'NODE'
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';

const builderPath = process.argv[2];
const graphPath = process.argv[3];
const graph = JSON.parse(readFileSync(graphPath, 'utf8'));
const { buildLocalCaptureShortcut, verifyLocalCaptureShortcutGraph } =
  await import(pathToFileURL(builderPath));

verifyLocalCaptureShortcutGraph(graph);
if (!isDeepStrictEqual(graph, buildLocalCaptureShortcut())) {
  throw new Error('artifact is not the exact Wafra Local Capture graph');
}
NODE
}

apple_validate_signed() {
  local signed_path=$1
  if [[ "$(first_four_bytes "$signed_path")" != AEA1 ]]; then
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
  if [[ "$(first_four_bytes "$TMP_DIR/apple-validated.signed.shortcut")" != AEA1 ]]; then
    echo "FAIL: Apple did not produce a validated signed AEA" >&2
    exit 1
  fi
}

MAGIC=$(first_four_bytes "$INPUT_PATH")

case $MODE in
  verify|verify-json)
    if [[ "$MAGIC" == AEA1 ]]; then
      echo "FAIL: signed Shortcuts are opaque; use --signature-only or the trusted --sign pipeline" >&2
      exit 1
    fi
    if [[ "$MODE" == verify-json ]]; then
      node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))' \
        "$INPUT_PATH" 2>/dev/null || {
          echo "FAIL: --json requires a JSON Shortcut graph" >&2
          exit 1
        }
    fi
    decode_graph "$INPUT_PATH" "$TMP_DIR/decoded.json"
    verify_graph "$TMP_DIR/decoded.json"
    echo "PASS: exact Wafra Local Capture graph matches"
    ;;
  signature-only)
    apple_validate_signed "$INPUT_PATH"
    echo "SIGNATURE-ONLY: Apple validated the AEA; graph contents are opaque and were not audited"
    ;;
  sign)
    if [[ "$MAGIC" == AEA1 ]]; then
      echo "FAIL: trusted signing requires an unsigned JSON or binary graph" >&2
      exit 1
    fi
    decode_graph "$INPUT_PATH" "$TMP_DIR/decoded.json"
    verify_graph "$TMP_DIR/decoded.json"
    command -v plutil >/dev/null 2>&1 || {
      echo "FAIL: Apple plutil is required by the trusted signing pipeline" >&2
      exit 1
    }
    command -v shortcuts >/dev/null 2>&1 || {
      echo "FAIL: Apple Shortcuts CLI is required by the trusted signing pipeline" >&2
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
    echo "PASS: TRUSTED PIPELINE signed exact Wafra Local Capture graph"
    echo "SHA-256 $CHECKSUM  $OUTPUT_PATH"
    ;;
  *) usage ;;
esac
