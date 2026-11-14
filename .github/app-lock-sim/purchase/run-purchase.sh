#!/usr/bin/env bash
# Usage: run-purchase.sh UDID OUT_DIR APP_DIR
# Runs the StoreKit purchase UI test on a booted simulator. Everything it writes is plain text (no terminal escapes).
set -uo pipefail
UDID=$1; OUT=$2; APPDIR=$3; APP=app.wafra.ios
CASE=${PURCHASE_CASE:-diagnostic}
case "$CASE" in
  diagnostic) METHOD=testBoundaryDiagnostic; LIMIT=360 ;;
  empty) METHOD=testRestoreEmpty; LIMIT=600 ;;
  owned) METHOD=testRestoreOwned; LIMIT=600 ;;
  purchases) METHOD=testPurchaseFlow; LIMIT=1500 ;;
  *) echo "invalid PURCHASE_CASE"; exit 2 ;;
esac
shopt -s nullglob
APPS=("$APPDIR"/*.app)
[ "${#APPS[@]}" = 1 ] || { echo "need exactly one app bundle"; exit 2; }
APPFILE=${APPS[0]}
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=${RUNNER_TEMP:-/tmp}/purchase-work; rm -rf "$WORK"; mkdir -p "$WORK/proj" "$WORK/hs" "$OUT"
clean() { sed -E 's/\x1b\[[0-9;?]*[A-Za-z]//g'; }
cp "$HERE/PurchaseUITests.swift" "$WORK/proj/"
cp "$HERE/WafraTest.storekit" "$WORK/WafraTest.storekit"

# Read-only observations replace the old unverified private Octane copy/restart.
# A successful file check still does NOT claim shared transaction binding.
observe_boundary() {
  python3 -I "$HERE/boundary-observe.py" "$UDID" "$APPFILE" "$WORK/WafraTest.storekit" "$1" "$OUT/boundary.jsonl" "${@:2}"
}
validate_boundary_config() { observe_boundary "$1" --require-config; }
wipe_app_data() { # "reinstall with the purchase still on the store": the simulator drops an app's StoreKit test state when the app is
  # uninstalled (the real App Store keeps the subscription), so empty the app's own data and keep the install and its store state.
  local c; xcrun simctl terminate "$UDID" "$APP" >/dev/null 2>&1
  c=$(xcrun simctl get_app_container "$UDID" "$APP" data 2>/dev/null)
  if [ -n "$c" ] && [ -d "$c" ]; then find "$c" -mindepth 1 -maxdepth 1 -exec rm -rf {} + ; echo "[host] emptied the app data container (install and store state kept): $(ls -A "$c" | wc -l) entries left"
  else echo "[host] no data container found; refusing uninstall for data-reset proof"; return 1; fi
}
fresh_install() {
  xcrun simctl terminate "$UDID" "$APP" >/dev/null 2>&1
  observe_boundary before-install || return 1
  xcrun simctl uninstall "$UDID" "$APP" >/dev/null 2>&1 || return 1
  xcrun simctl install "$UDID" "$APPFILE" || return 1
  observe_boundary after-install
}

( cd "$WORK/proj" && ruby "$HERE/make-project.rb" "$WORK/proj" ) > "$OUT/purchase-project.log" 2>&1 || { echo "::error::could not generate the UI-test project (see purchase-project.log)"; tail -5 "$OUT/purchase-project.log" | sed 's/^/::error::/'; echo "SETUP FAIL no project" > "$OUT/purchase-setup.txt"; exit 1; }

xcodebuild build-for-testing -project "$WORK/proj/WafraPurchase.xcodeproj" -scheme WafraPurchase \
  -destination "id=$UDID" -derivedDataPath "$WORK/dd" CODE_SIGNING_ALLOWED=NO > "$WORK/build.raw" 2>&1
RC=$?
clean < "$WORK/build.raw" > "$OUT/purchase-build.log"
if [ $RC -ne 0 ]; then
  echo "::error::UI-test build failed rc=$RC"
  grep -E "error:" "$OUT/purchase-build.log" | head -15 | while read -r l; do echo "::error::${l:0:300}"; done
  echo "SETUP FAIL build rc=$RC" > "$OUT/purchase-setup.txt"; exit 1
fi

fresh_install || { echo "SETUP FAIL install/identity" > "$OUT/purchase-setup.txt"; exit 1; }
mkdir -p "$OUT/purchase-shots"
# Native stream stays local to this disposable job; only bounded, guarded checkpoint windows are exported.
xcrun simctl spawn "$UDID" log stream --level debug --style compact \
  --predicate 'process == "Wafra" OR process CONTAINS "torekit" OR subsystem CONTAINS "uperwall" OR subsystem CONTAINS "storekit"' > "$WORK/applog.raw" 2>&1 &
LSPID=$!
(
  export TEST_RUNNER_PURCHASE_CASE="$CASE"
  export TEST_RUNNER_STOREKIT_CONFIG="$WORK/WafraTest.storekit" TEST_RUNNER_SHOTS_DIR="$WORK/shots" TEST_RUNNER_HANDSHAKE_DIR="$WORK/hs"
  mkdir -p "$WORK/shots"
  XCPID=
  trap '[ -z "$XCPID" ] || kill "$XCPID" 2>/dev/null; exit 124' TERM INT
  xcodebuild test-without-building -project "$WORK/proj/WafraPurchase.xcodeproj" -scheme WafraPurchase \
    -parallel-testing-enabled NO -only-testing:"WafraPurchaseUITests/PurchaseUITests/$METHOD" \
    -destination "id=$UDID" -derivedDataPath "$WORK/dd" -resultBundlePath "$WORK/result.xcresult" CODE_SIGNING_ALLOWED=NO > "$WORK/test.raw" 2>&1 &
  XCPID=$!
  wait "$XCPID"
  echo $? > "$WORK/test.rc"
) &
TPID=$!

END=$((SECONDS + LIMIT))
while kill -0 $TPID 2>/dev/null && [ $SECONDS -lt $END ]; do
  for request in "$WORK/hs"/*.request; do
    [ -f "$request" ] || continue
    base=${request%.request}
    [ ! -f "$base.done" ] && [ ! -f "$base.failed" ] && [ ! -f "$base.observed" ] || continue
    name=$(basename "$base")
    case "$name" in
      config-observation)
        if validate_boundary_config session-created; then touch "$base.done"
        else echo "config/identity observation failed; binding unproven" > "$base.failed"; fi ;;
      reinstall-*)
        n=${name#reinstall-}
        if [ "$n" = 1 ]; then action=wipe_app_data; else action=fresh_install; fi
        if "$action" && validate_boundary_config "$name-after-install"; then touch "$base.done"
        else echo "install/data/config check failed; no binding claimed" > "$base.failed"; fi ;;
      boundary-*)
        if observe_boundary "$name" --require-config; then touch "$base.done"
        else echo "config/identity observation failed" > "$base.failed"; fi ;;
      *) echo "unknown host request" > "$base.failed" ;;
    esac
    # .observed means processed, never success. Failure is explicit and terminal.
    touch "$base.observed"
  done
  sleep 1
done
if kill -0 "$TPID" 2>/dev/null; then
  echo "::error::selected case timed out"; kill "$TPID" 2>/dev/null || true
  # Exact child only; never pkill other jobs. Hosted job timeout is the outer bound.
fi
wait $TPID 2>/dev/null
kill $LSPID 2>/dev/null; wait $LSPID 2>/dev/null
python3 -I - "$WORK/applog.raw" "$WORK/shots/purchase-notes.log" "$OUT/purchase-shots" <<'PYEOF'
import re, sys, datetime
raw, notes, out = sys.argv[1:4]
tap = {}
for l in open(notes, errors='replace'):
    m = re.match(r'(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) \+0000 ([A-Z][A-Za-z0-9-]{0,40}) (?:buy tap|boundary)\b', l)
    if m and len(tap) < 24: tap[f'{m.group(2)}-{len(tap)+1}'] = datetime.datetime.strptime(m.group(1), '%Y-%m-%d %H:%M:%S')
want = re.compile(r'purchas|transaction|product|cancel|storekit|superwall|offer|payment|dialog|sheet|entitle|\[wafra:|error|fail|javascript|refus|unavailable|receipt|sandbox|account', re.I)
noise = re.compile(r'apsd|APSConnection|dt\.xctest|XCTElementQuery|AX element|XCTAutomation|XCUI|accessibility|Accessibility|launchservices|containermanager|libsystem|FSNode|BindingEvaluator|User Defaults|forced client overrides|xpc:connection|Truncating a list|AppleMediaServices|CFBundle|AMS')
lines = []
for l in open(raw, errors='replace'):
    m = re.match(r'(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\.\d+ ', l)
    if m: lines.append((datetime.datetime.strptime(m.group(1), '%Y-%m-%d %H:%M:%S'), l.rstrip('\n')))
for tag, t0 in tap.items():
    keep = [l[:320] for t, l in lines if -1 <= (t - t0).total_seconds() <= 30 and want.search(l) and not noise.search(l)]
    with open(f'{out}/purchase-diag-{tag}.txt', 'w') as f:
        dl = [l[:420] for t, l in lines if -2 <= (t - t0).total_seconds() <= 40 and ('[wafra:' in l or 'uperwall' in l)]
        f.write(f'# {len(dl)} lines (first 250 kept)\n' + '\n'.join(dl[:250]) + '\n')
    with open(f'{out}/applog-{tag}-around-buy-tap.txt', 'w') as f:
        f.write(f'# {tag}: log lines (app, StoreKit, Superwall) from -1 s to +30 s around the buy tap at {t0} UTC, purchase-related only, system noise removed; {len(keep)} lines: first 120, then last 120\n')
        f.write('\n'.join(keep[:120]) + '\n')
        if len(keep) > 120: f.write('# ---- last lines of the window ----\n' + '\n'.join(keep[max(120, len(keep) - 120):]) + '\n')
PYEOF
{ echo "== StoreKit config locations in the simulator (Octane = storekitd's per-app test configuration)";
  find "$HOME/Library/Developer/CoreSimulator/Devices/$UDID/data/Containers/Shared/AppGroup" -ipath '*Octane*' 2>/dev/null | head -30;
  echo "== storekit/storekitd processes"; xcrun simctl spawn "$UDID" launchctl list 2>/dev/null | grep -i storekit | head; } > "$OUT/purchase-storekit-diagnostics.txt" 2>&1
clean < "$WORK/test.raw" | grep -v "^$" > "$OUT/purchase-xcodebuild-test.log"
cp -R "$WORK/shots/." "$OUT/purchase-shots/" 2>/dev/null
cp "$WORK/shots/purchase-results.tsv" "$OUT/purchase-results.tsv" 2>/dev/null
observe_boundary final || true
cat "$OUT/purchase-results.tsv" 2>/dev/null
echo "test rc=$(cat "$WORK/test.rc" 2>/dev/null)"
grep -E "error:|failed|Failed|passed" "$OUT/purchase-xcodebuild-test.log" | head -15 | while read -r l; do echo "::notice::${l:0:300}"; done
RC=$(cat "$WORK/test.rc" 2>/dev/null || echo 124)
exit "$RC"
