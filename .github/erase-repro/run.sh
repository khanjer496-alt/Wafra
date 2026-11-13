#!/usr/bin/env bash
# Reproduce "Settings > Data and help > Erase all data > Erase" on a booted simulator, with a small seeded ledger,
# and capture ONLY the JS-exception / crash lines. Usage: run.sh UDID OUT_DIR APP_DIR HARNESS_ROOT
set -uo pipefail
UDID=$1; OUT=$2; APPDIR=$3; H=$4; APP=app.wafra.ios
mkdir -p "$OUT"; RAW=${RUNNER_TEMP:-/tmp}/erase-raw.log; : > "$RAW"; STATUS="$OUT/status.txt"; : > "$STATUS"
log() { echo "[$(date -u +%H:%M:%S)] $*"; }
note() { echo "$*" | tee -a "$STATUS"; }
clean() { sed -E 's/\x1b\[[0-9;?]*[A-Za-z]//g'; }
mro() { local flow=$1 tag=$2
  maestro --device "$UDID" test -e APP_ID="$APP" -e MARKER=Settings --test-output-dir "${RUNNER_TEMP:-/tmp}/m-$tag" "$flow" > "${RUNNER_TEMP:-/tmp}/m-$tag.log" 2>&1
  local rc=$?; log "maestro $tag rc=$rc"; return $rc; }
app_pid() { xcrun simctl spawn "$UDID" launchctl list 2>/dev/null | awk '/UIKitApplication:'"$APP"'/ {print $1; exit}'; }
fresh() { xcrun simctl terminate "$UDID" "$APP" >/dev/null 2>&1; xcrun simctl uninstall "$UDID" "$APP" >/dev/null 2>&1
  xcrun simctl install "$UDID" "$(ls -d "$APPDIR"/*.app | head -1)"; }

OCRBIN="${RUNNER_TEMP:-/tmp}/wafra-ocr"; swiftc -O "$H/.github/app-lock-sim/ocr.swift" -o "$OCRBIN" >/dev/null 2>&1 || log "ocr build failed"
{ echo "== codesign entitlements of the simulator build under test"; codesign -d --entitlements - "$(ls -d "$APPDIR"/*.app | head -1)" 2>&1 | head -60
  echo; echo "== app-group containers the installed app resolves (simctl get_app_container groups)"; } > "$OUT/app-entitlements.txt"
xcrun simctl spawn "$UDID" log stream --level debug --style compact \
  --predicate 'process == "Wafra" OR eventMessage CONTAINS "Unhandled JS Exception" OR eventMessage CONTAINS "RCTFatal" OR eventMessage CONTAINS "reportFatal" OR eventMessage CONTAINS "RCTExceptionsManager"' >> "$RAW" 2>&1 &
LS=$!; sleep 3
MARK=${RUNNER_TEMP:-/tmp}/crash.marker; touch "$MARK"
CRASHES=0
for attempt in 1 2; do
  note "== attempt $attempt"
  fresh; sleep 2
  mro "$H/.github/app-lock-sim/flows/seed.yaml" "seed$attempt"; note "seed rc=$?"
  if [ "$attempt" = 2 ]; then
    mro "$H/.github/app-lock-sim/flows/addrows.yaml" "rows$attempt"; ROWS=$?; note "addrows rc=$ROWS (0 = three ledger rows were added through the Add screen; non-zero = the erase below ran on an EMPTY ledger)"
  else note "attempt 1 runs on a freshly onboarded, empty ledger (row seeding is only tried in attempt 2)"; fi
  xcrun simctl io "$UDID" screenshot "$OUT/a${attempt}-before-erase.png" >/dev/null 2>&1
  PB=$(app_pid); note "app pid before erase: ${PB:-none}"
  echo "=== ERASE STEP attempt $attempt $(date -u +%T)" >> "$RAW"
  mro "$H/.github/erase-repro/erase.yaml" "erase$attempt"; note "erase flow rc=$? (it taps Settings > Data and help > Erase all data > Erase)"
  sleep 25
  PA=$(app_pid); note "app pid 25 s after the Erase tap: ${PA:-none}"
  xcrun simctl io "$UDID" screenshot "$OUT/a${attempt}-after-erase.png" >/dev/null 2>&1
  echo "=== TRY AGAIN attempt $attempt $(date -u +%T)" >> "$RAW"
  T1=$("$OCRBIN" "$OUT/a${attempt}-after-erase.png" 2>/dev/null | cut -f2 | tr '\n' ' ')
  note "screen right after the erase (OCR): ${T1:0:240}"
  mro "$H/.github/erase-repro/tryagain.yaml" "try$attempt"; note "try-again flow rc=$?"
  sleep 20
  xcrun simctl io "$UDID" screenshot "$OUT/a${attempt}-after-tryagain.png" >/dev/null 2>&1
  T2=$("$OCRBIN" "$OUT/a${attempt}-after-tryagain.png" 2>/dev/null | cut -f2 | tr '\n' ' ')
  note "screen 20 s after Try again (OCR): ${T2:0:240}"
  if printf '%s' "$T2" | grep -qiE "your data was erased|encrypted captured messages|try again"; then note "RECOVERY after Try again attempt $attempt: the recovery screen is STILL shown"; else note "RECOVERY after Try again attempt $attempt: the recovery screen CLEARED"; fi
  xcrun simctl get_app_container "$UDID" "$APP" groups >> "$OUT/app-entitlements.txt" 2>&1
  if [ -n "${PB:-}" ] && [ "${PB:-x}" != "-" ] && { [ -z "${PA:-}" ] || [ "${PA:-}" = "-" ] || [ "$PA" != "$PB" ]; }; then
    note "RESULT attempt $attempt: the app process ended or was replaced after Erase (pid $PB -> ${PA:-none}) = CRASH or relaunch"; CRASHES=$((CRASHES+1))
  else note "RESULT attempt $attempt: the same app process is still running after Erase (pid ${PB:-none} -> ${PA:-none}) = NO CRASH"; fi
done
kill $LS 2>/dev/null; sleep 1
# Maestro step logs and failure screenshots carry only UI step names and the synthetic seed; they show whether each flow reached the Erase tap
mkdir -p "$OUT/maestro"; for f in "${RUNNER_TEMP:-/tmp}"/m-*.log; do [ -f "$f" ] && sed -E 's/\x1b\[[0-9;?]*[A-Za-z]//g' "$f" | grep -vE "^\s+at |analytics" | head -60 > "$OUT/maestro/$(basename "$f")"; done
note "crashes in 2 attempts: $CRASHES"
# ---- only the JS-exception / fatal lines
clean < "$RAW" | grep -nE "Unhandled JS Exception|RCTExceptionsManager|reportFatal|RCTFatal|Terminating app|uncaught exception|SIGABRT|EXC_|Fatal|Uncaught|ERROR|ReferenceError|TypeError|=== ERASE STEP" | cut -c1-1500 | head -400 > "$OUT/js-exception-lines.txt"
note "js-exception-lines.txt: $(wc -l < "$OUT/js-exception-lines.txt") lines"
# The fatal's JS stack is the lines AFTER the "Terminating app" message, and the JS console lines just before it are the breadcrumbs.
clean < "$RAW" | awk '/=== ERASE STEP/ {on=1} on { if (/\[wafra:/ || /Possible Unhandled Promise Rejection/ || /=== ERASE STEP/ || /=== TRY AGAIN/) { print substr($0,1,900); cont = (/\[wafra:erase-diag\]/) ? 8 : 0 } else if (cont > 0 && $0 !~ /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] /) { print "  | " substr($0,1,500); cont-- } else { cont = 0 } }' | head -300 > "$OUT/app-wafra-lines.txt"
grep -E "erase-diag|^  \| " "$OUT/app-wafra-lines.txt" > "$OUT/erase-diag-lines.txt" || true
note "app-wafra-lines.txt: $(wc -l < "$OUT/app-wafra-lines.txt") lines"
clean < "$RAW" | awk '/Terminating app due to uncaught exception/ && !seen {seen=1; n=0} seen && n<90 {print substr($0,1,1500); n++}' > "$OUT/js-fatal-stack.txt"
clean < "$RAW" | awk '/Unhandled JS Exception/ {print NR}' | head -2 | while read -r L; do
  clean < "$RAW" | sed -n "$((L>140?L-140:1)),$((L+2))p" | grep -E "com.facebook.react.log:javascript|Unhandled JS Exception|wafra:" | cut -c1-400 | tail -70
  echo "----"; done > "$OUT/js-breadcrumbs-before-fatal.txt"
note "js-fatal-stack.txt: $(wc -l < "$OUT/js-fatal-stack.txt") lines; js-breadcrumbs-before-fatal.txt: $(wc -l < "$OUT/js-breadcrumbs-before-fatal.txt") lines"
# ---- host crash reports for the app, reduced to the fields that identify the failure (no memory contents)
python3 - "$MARK" "$OUT/crash-summary.txt" <<'PY'
import glob, json, os, sys
mark, out = sys.argv[1], sys.argv[2]; lines = []
for f in sorted(glob.glob(os.path.expanduser('~/Library/Logs/DiagnosticReports/Wafra*.ips'))):
    if os.path.getmtime(f) < os.path.getmtime(mark): continue
    raw = open(f, errors='replace').read().split('\n', 1)
    try: head = json.loads(raw[0]); body = json.loads(raw[1])
    except Exception as e: lines.append(f'{os.path.basename(f)}: unreadable ({e})'); continue
    lines.append(f'== {os.path.basename(f)} build={head.get("app_version")} ({head.get("build_version")}) os={head.get("os_version")}')
    lines.append(f'exception: {json.dumps(body.get("exception"))}'); lines.append(f'termination: {json.dumps(body.get("termination"))}')
    asi = body.get('asi') or {}
    for k, v in asi.items(): lines.append(f'asi[{k}]: {json.dumps(v)[:3000]}')
    for t in body.get('threads', []):
        if t.get('triggered'):
            lines.append(f'crashed thread {t.get("id")} {t.get("name","")} frames:')
            for fr in t.get('frames', [])[:30]:
                img = (body.get('usedImages') or [{}])[fr.get('imageIndex', 0)] if body.get('usedImages') else {}
                lines.append(f'  {fr.get("symbol","?")}  [{img.get("name","?")}]')
    lb = body.get('lastExceptionBacktrace') or []
    if lb: lines.append('lastExceptionBacktrace:'); [lines.append(f'  {fr.get("symbol","?")}') for fr in lb[:30]]
open(out, 'w').write('\n'.join(lines) + ('\n' if lines else 'no Wafra crash report was written on the host during the run\n'))
PY
cat "$OUT/crash-summary.txt" | head -60
