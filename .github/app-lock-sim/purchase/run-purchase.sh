#!/usr/bin/env bash
# Usage: run-purchase.sh UDID OUT_DIR APP_DIR
# Runs the StoreKit purchase UI test on a booted simulator. Everything it writes is plain text (no terminal escapes).
set -uo pipefail
UDID=$1; OUT=$2; APPDIR=$3; APP=app.wafra.ios
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=${RUNNER_TEMP:-/tmp}/purchase-work; rm -rf "$WORK"; mkdir -p "$WORK/proj" "$WORK/hs" "$OUT"
clean() { sed -E 's/\x1b\[[0-9;?]*[A-Za-z]//g'; }
cp "$HERE/PurchaseUITests.swift" "$WORK/proj/"
cp "$HERE/WafraTest.storekit" "$WORK/WafraTest.storekit"

# storekitd keeps the test configuration per bundle id in its own app group; copy the one the test session registered
# (under the test runner's id) to the app's id, now and after every reinstall.
sync_storekit_config() {
  local src dest
  src=$(find "$HOME/Library/Developer/CoreSimulator/Devices/$UDID/data/Containers/Shared/AppGroup" -ipath '*Octane/dev.wafra.purchaseuitests.xctrunner/Configuration.storekit' 2>/dev/null | head -1)
  [ -n "$src" ] || { echo "[host] no StoreKit test configuration registered yet"; return 1; }
  dest="$(dirname "$(dirname "$src")")/$APP"; mkdir -p "$dest"; cp "$src" "$dest/Configuration.storekit"
  echo "[host] StoreKit config copied to $dest"
}
restart_storekitd() { # make storekitd re-read the per-app test configuration (a stale client keeps answering "no products")
  { xcrun simctl spawn "$UDID" launchctl kickstart -k system/com.apple.storekitd 2>&1 || xcrun simctl spawn "$UDID" launchctl stop com.apple.storekitd 2>&1; } | sed 's/^/[host] storekitd restart: /'
  sleep 6
}
fresh_install() {
  xcrun simctl terminate "$UDID" "$APP" >/dev/null 2>&1
  xcrun simctl uninstall "$UDID" "$APP" >/dev/null 2>&1
  xcrun simctl install "$UDID" "$(ls -d "$APPDIR"/*.app | head -1)"
  sync_storekit_config || true
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

fresh_install
mkdir -p "$OUT/purchase-shots"
# Native log stream (app + StoreKit + Superwall only); after the run only purchase-related lines near each buy tap are kept.
xcrun simctl spawn "$UDID" log stream --level debug --style compact \
  --predicate 'process == "Wafra" OR process CONTAINS "torekit" OR subsystem CONTAINS "uperwall" OR subsystem CONTAINS "storekit"' > "$WORK/applog.raw" 2>&1 &
LSPID=$!
(
  export TEST_RUNNER_STOREKIT_CONFIG="$WORK/WafraTest.storekit" TEST_RUNNER_SHOTS_DIR="$WORK/shots" TEST_RUNNER_HANDSHAKE_DIR="$WORK/hs"
  mkdir -p "$WORK/shots"
  xcodebuild test-without-building -project "$WORK/proj/WafraPurchase.xcodeproj" -scheme WafraPurchase \
    -destination "id=$UDID" -derivedDataPath "$WORK/dd" -resultBundlePath "$WORK/result.xcresult" CODE_SIGNING_ALLOWED=NO > "$WORK/test.raw" 2>&1
  echo $? > "$WORK/test.rc"
) &
TPID=$!

END=$((SECONDS + 1500))
while kill -0 $TPID 2>/dev/null && [ $SECONDS -lt $END ]; do
  if [ -f "$WORK/hs/storekit-sync.request" ] && [ ! -f "$WORK/hs/storekit-sync.done" ]; then
    AG=$(dirname "$(find "$HOME/Library/Developer/CoreSimulator/Devices/$UDID/data/Containers/Shared/AppGroup" -ipath '*Octane/dev.wafra.purchaseuitests.xctrunner/Configuration.storekit' 2>/dev/null | head -1)" 2>/dev/null)
    if [ -n "$AG" ] && [ -d "$AG" ]; then
      DEST="$(dirname "$AG")/$APP"; mkdir -p "$DEST"; cp "$AG/Configuration.storekit" "$DEST/Configuration.storekit"
      echo "[host] copied StoreKit config to $DEST"; ls -la "$DEST"
    else echo "[host] no Octane config for the test runner found yet"; fi
    touch "$WORK/hs/storekit-sync.done"
  fi
  for n in 1 2 3; do
    if [ -f "$WORK/hs/reinstall-$n.request" ] && [ ! -f "$WORK/hs/reinstall-$n.done" ]; then
      echo "[host] reinstall #$n"; fresh_install; for _i in $(seq 1 30); do xcrun simctl get_app_container "$UDID" "$APP" >/dev/null 2>&1 && break; sleep 1; done; sleep 8; sync_storekit_config || true; sleep 10; sync_storekit_config || true; restart_storekitd; touch "$WORK/hs/reinstall-$n.done"
    fi
  done
  sleep 1
done
kill -0 $TPID 2>/dev/null && { echo "::error::purchase test timed out"; pkill -f "xcodebuild test-without-building" ; }
wait $TPID 2>/dev/null
kill $LSPID 2>/dev/null; wait $LSPID 2>/dev/null
python3 -I - "$WORK/applog.raw" "$WORK/shots/purchase-notes.log" "$OUT/purchase-shots" <<'PYEOF'
import re, sys, datetime
raw, notes, out = sys.argv[1:4]
tap = {}
for l in open(notes, errors='replace'):
    m = re.match(r'(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) \+0000 (P\d) buy tap', l)
    if m: tap[m.group(2)] = datetime.datetime.strptime(m.group(1), '%Y-%m-%d %H:%M:%S')
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
cat "$OUT/purchase-results.tsv" 2>/dev/null
echo "test rc=$(cat "$WORK/test.rc" 2>/dev/null)"
grep -E "error:|failed|Failed|passed" "$OUT/purchase-xcodebuild-test.log" | head -15 | while read -r l; do echo "::notice::${l:0:300}"; done
