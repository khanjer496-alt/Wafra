#!/usr/bin/env bash
# Real queue persistence in a disposable simulator. No inbox or physical device
# is accessed; simulator success does not qualify locked-phone SMS delivery.
set -euo pipefail
cd "$(dirname "$0")/../.."
if [[ "$(uname -s)" != Darwin ]] || ! command -v xcrun >/dev/null 2>&1; then
  echo 'Xcode on macOS is required for native iOS queue receipt tests.' >&2
  exit 1
fi
scratch=$(mktemp -d "${TMPDIR:-/tmp}/wafra-receipts.XXXXXX")
device=''
cleanup() {
  if [[ -n "$device" ]]; then
    xcrun simctl shutdown "$device" >/dev/null 2>&1 || true
    xcrun simctl delete "$device" >/dev/null 2>&1 || true
  fi
  rm -rf "$scratch"
}
trap cleanup EXIT
xcrun simctl list runtimes --json > "$scratch/runtimes.json"
runtime=$(python3 - "$scratch/runtimes.json" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    runtimes = json.load(f)['runtimes']
runtimes = [r for r in runtimes if r.get('isAvailable') and '.iOS-' in r['identifier']
            and int(r['version'].split('.')[0]) >= 18]
if not runtimes:
    raise SystemExit('An installed iOS 18+ simulator runtime is required.')
print(max(runtimes, key=lambda r: tuple(int(v) for v in r['version'].split('.')))['identifier'])
PY
)
device=$(xcrun simctl create WafraCaptureReceiptTests com.apple.CoreSimulator.SimDeviceType.iPhone-16 "$runtime")
xcrun simctl boot "$device"
xcrun simctl bootstatus "$device" -b
sdk=$(xcrun --sdk iphonesimulator --show-sdk-path)
xcrun swiftc -D DEBUG -target arm64-apple-ios18.0-simulator -sdk "$sdk" \
  modules/wafra-live-capture/ios/WafraLiveCaptureStore.swift \
  scripts/test/native-live-capture-receipts.swift -o "$scratch/native-receipt-tests"
codesign --force --sign - "$scratch/native-receipt-tests"
printf '%s\n' "runtime=$runtime; synthetic queue persistence only; not real SMS or locked-device protection"
xcrun simctl spawn "$device" "$scratch/native-receipt-tests"
