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

fresh_install() {
  xcrun simctl terminate "$UDID" "$APP" >/dev/null 2>&1
  xcrun simctl uninstall "$UDID" "$APP" >/dev/null 2>&1
  xcrun simctl install "$UDID" "$(ls -d "$APPDIR"/*.app | head -1)"
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
  for n in 1 2 3; do
    if [ -f "$WORK/hs/reinstall-$n.request" ] && [ ! -f "$WORK/hs/reinstall-$n.done" ]; then
      echo "[host] reinstall #$n"; fresh_install; touch "$WORK/hs/reinstall-$n.done"
    fi
  done
  sleep 1
done
kill -0 $TPID 2>/dev/null && { echo "::error::purchase test timed out"; pkill -f "xcodebuild test-without-building" ; }
wait $TPID 2>/dev/null
clean < "$WORK/test.raw" | grep -v "^$" > "$OUT/purchase-xcodebuild-test.log"
cp -R "$WORK/shots/." "$OUT/purchase-shots/" 2>/dev/null
cp "$WORK/shots/purchase-results.tsv" "$OUT/purchase-results.tsv" 2>/dev/null
cat "$OUT/purchase-results.tsv" 2>/dev/null
echo "test rc=$(cat "$WORK/test.rc" 2>/dev/null)"
grep -E "error:|failed|Failed|passed" "$OUT/purchase-xcodebuild-test.log" | head -15 | while read -r l; do echo "::notice::${l:0:300}"; done
