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

xcrun simctl spawn "$UDID" log stream --level debug --style compact \
  --predicate 'process == "Wafra" OR eventMessage CONTAINS "Unhandled JS Exception" OR eventMessage CONTAINS "RCTFatal" OR eventMessage CONTAINS "reportFatal" OR eventMessage CONTAINS "RCTExceptionsManager"' >> "$RAW" 2>&1 &
LS=$!; sleep 3
MARK=${RUNNER_TEMP:-/tmp}/crash.marker; touch "$MARK"
CRASHES=0
for attempt in 1 2; do
  note "== attempt $attempt"
  fresh; sleep 2
  mro "$H/.github/app-lock-sim/flows/seed.yaml" "seed$attempt"; note "seed rc=$?"
  mro "$H/.github/app-lock-sim/flows/addrows.yaml" "rows$attempt"; ROWS=$?; note "addrows rc=$ROWS (0 = three ledger rows were added through the Add screen)"
  xcrun simctl io "$UDID" screenshot "$OUT/a${attempt}-before-erase.png" >/dev/null 2>&1
  PB=$(app_pid); note "app pid before erase: ${PB:-none}"
  echo "=== ERASE STEP attempt $attempt $(date -u +%T)" >> "$RAW"
  mro "$H/.github/erase-repro/erase.yaml" "erase$attempt"; note "erase flow rc=$? (it taps Settings > Data and help > Erase all data > Erase)"
  sleep 25
  PA=$(app_pid); note "app pid 25 s after the Erase tap: ${PA:-none}"
  xcrun simctl io "$UDID" screenshot "$OUT/a${attempt}-after-erase.png" >/dev/null 2>&1
  if [ -n "${PB:-}" ] && [ "${PB:-x}" != "-" ] && { [ -z "${PA:-}" ] || [ "${PA:-}" = "-" ] || [ "$PA" != "$PB" ]; }; then
    note "RESULT attempt $attempt: the app process ended or was replaced after Erase (pid $PB -> ${PA:-none}) = CRASH or relaunch"; CRASHES=$((CRASHES+1))
  else note "RESULT attempt $attempt: the same app process is still running after Erase (pid ${PB:-none} -> ${PA:-none}) = NO CRASH"; fi
done
kill $LS 2>/dev/null; sleep 1
note "crashes in 2 attempts: $CRASHES"
# ---- only the JS-exception / fatal lines
clean < "$RAW" | grep -nE "Unhandled JS Exception|RCTExceptionsManager|reportFatal|RCTFatal|Terminating app|uncaught exception|SIGABRT|EXC_|Fatal|Uncaught|ERROR|ReferenceError|TypeError|=== ERASE STEP" | cut -c1-1500 | head -400 > "$OUT/js-exception-lines.txt"
note "js-exception-lines.txt: $(wc -l < "$OUT/js-exception-lines.txt") lines"
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
