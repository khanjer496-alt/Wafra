#!/usr/bin/env bash
# Scripted App Lock flow on a booted iOS simulator with Face ID enrolled and the
# Release app installed. Usage: run.sh UDID OUT_DIR
# No `set -e`: every step records its own result and the table is built at the end.
set -uo pipefail
UDID=$1; OUT=${2:-shots}; APP=app.wafra.ios
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT"; RESULTS="$OUT/results.tsv"; : > "$RESULTS"
MATCH=com.apple.BiometricKit_Sim.pearl.match
NOMATCH=com.apple.BiometricKit_Sim.pearl.nomatch
LOCKED_SHOTS=()

log()   { echo "[$(date -u +%H:%M:%S)] $*"; }
match() { log "notifyutil $MATCH"; xcrun simctl spawn "$UDID" notifyutil -p "$MATCH"; }
nomatch() { log "notifyutil $NOMATCH"; xcrun simctl spawn "$UDID" notifyutil -p "$NOMATCH"; }
shot()  { xcrun simctl io "$UDID" screenshot "$OUT/$1.png" >/dev/null 2>&1 && log "screenshot $1"; }
# mro NAME  -> runs flows/NAME.yaml, returns its exit code, keeps the log
mro() {
  local name=$1 tag=${2:-$1}
  maestro --device "$UDID" test -e APP_ID="$APP" --test-output-dir "$OUT/maestro-$tag" \
    "$HERE/flows/$name.yaml" > "$OUT/maestro-$tag.log" 2>&1
  local rc=$?; log "maestro $name ($tag) rc=$rc"; return $rc
}
dump() { maestro --device "$UDID" hierarchy > "$OUT/hierarchy-$1.json" 2>&1 || true; }
record() { printf '%s\t%s\t%s\n' "$1" "$2" "$3" >> "$RESULTS"; log "RESULT $1 = $2 ($3)"; }
unlock() { # unlock the app with a simulated Face ID match; up to 3 attempts
  local n
  for n in 1 2 3; do
    match; sleep 4
    if mro unlocked "unlock-check-$1-$n"; then UNLOCK_ATTEMPTS=$n; return 0; fi
    dump "unlock-fail-$1-$n"; shot "$1-unlock-attempt-$n-failed"
    mro tapunlock "tapunlock-$1-$n" || true; sleep 2
  done
  UNLOCK_ATTEMPTS=3; return 1
}
away() { xcrun simctl launch "$UDID" com.apple.Preferences >/dev/null; }
back() { xcrun simctl launch "$UDID" "$APP" >/dev/null; }

diag() { # evidence for a failed setup: entitlements, the app's own storage diagnostics, unified log
  local c; c=$(xcrun simctl get_app_container "$UDID" "$APP" data 2>/dev/null)
  { echo "== entitlements"; codesign -d --entitlements - "$(xcrun simctl get_app_container "$UDID" "$APP" app 2>/dev/null)" 2>&1 | head -40
    echo "== data container: $c"; find "$c" -maxdepth 4 \( -iname '*diag*' -o -iname '*storage*' \) 2>/dev/null | head
    find "$c" -maxdepth 4 -iname '*diag*' -type f 2>/dev/null | head -3 | while read -r f; do echo "-- $f"; head -c 3000 "$f"; echo; done
    echo "== unified log (app)"; xcrun simctl spawn "$UDID" log show --last 15m --style compact --predicate 'process != "apsd" AND (process == "Wafra" OR eventMessage CONTAINS[c] "app.wafra" OR process == "SpringBoard" OR process == "installd" OR process == "securityd")' 2>&1 | grep -iE "wafra|denied|signature|entitle|amfi|launch" | tail -80
  } > "$OUT/app-diagnostics.txt" 2>&1
}

# ---- setup: seed a small ledger, then turn App Lock on -------------------------------
if ! mro seed && ! { cp "$OUT/maestro-seed.log" "$OUT/maestro-seed-attempt1.log"; sleep 10; mro seed seed-retry; }; then
  dump seed-fail; shot setup-seed-failed; diag; record SETUP FAIL "could not seed the ledger (see maestro-seed.log)"; exit 1
fi
shot 00-seeded-home-unlocked
cp "$OUT/00-seeded-home-unlocked.png" "$OUT/.home-reference.png"
mro enable || { dump enable-fail; shot 00-enable-failed; record SETUP FAIL "could not reach the App Lock switch"; }
sleep 2; match; sleep 3; shot 00-after-enable-1; match; sleep 3; shot 00-after-enable-2

# ---- S1: cold launch is locked; Face ID match unlocks; ledger shows --------------------
xcrun simctl terminate "$UDID" "$APP"; sleep 2
back; sleep 7
shot 01a-cold-launch-locked
if mro locked s1-locked; then
  mro faceid-label s1-faceid-label && FID="Face ID is the unlock method" || FID="Face-ID label not seen"
  record S1a PASS "cold launch showed the lock screen, no ledger; $FID"; LOCKED_SHOTS+=(01a-cold-launch-locked)
else dump s1-locked; record S1a FAIL "cold launch was not locked (see maestro-s1-locked.log)"; fi
if unlock s1; then record S1b PASS "pearl.match unlocked and the ledger shows (attempts: $UNLOCK_ATTEMPTS)"
else record S1b FAIL "ledger not shown after pearl.match"; fi
shot 01b-after-match-unlocked

# ---- S4: away < 20 s stays unlocked -----------------------------------------------------
away; sleep 5; shot 04a-away-5s-in-Settings-app
back; sleep 4; shot 04b-back-after-5s
if mro unlocked s4; then record S4 PASS "5 s away: still unlocked, ledger visible"
else dump s4; record S4 FAIL "re-locked or ledger missing after 5 s away"; fi

# ---- S3: away > 20 s re-locks ----------------------------------------------------------
away; sleep 25; shot 03a-away-25s-in-Settings-app
back; sleep 5; shot 03b-back-after-25s-locked
if mro locked s3; then record S3 PASS "25 s away: lock screen, no ledger"; LOCKED_SHOTS+=(03b-back-after-25s-locked)
else dump s3; record S3 FAIL "not locked after 25 s away"; fi

# ---- S5: pearl.nomatch stays locked ------------------------------------------------------
nomatch; sleep 5; shot 05a-after-nomatch
if mro locked s5; then record S5 PASS "pearl.nomatch: still locked, no ledger"; LOCKED_SHOTS+=(05a-after-nomatch)
else dump s5; record S5 FAIL "not locked after pearl.nomatch"; fi
if unlock s5r; then record S5r PASS "recovered: pearl.match after the failed match unlocked (attempts: $UNLOCK_ATTEMPTS)"
else record S5r FAIL "could not unlock after the failed match"; fi
shot 05b-after-recovery-unlocked

# ---- S6: clock set back while away re-locks --------------------------------------------
sudo systemsetup -setusingnetworktime off >/dev/null 2>&1 || log "could not disable network time"
REAL0=$(date +%s); MONO0=$SECONDS
away; sleep 3
BACK=$((REAL0 + (SECONDS - MONO0) - 3600))
sudo date -u "$(date -u -r "$BACK" +%m%d%H%M%Y.%S)" >/dev/null
log "host clock now $(date -u) ; simulator sees $(xcrun simctl spawn "$UDID" date -u)"
back; sleep 4; shot 06b-back-with-clock-set-back-1h
REAL=$((REAL0 + (SECONDS - MONO0)))
sudo date -u "$(date -u -r "$REAL" +%m%d%H%M%Y.%S)" >/dev/null; log "clock restored: $(date -u)"
if mro locked s6; then record S6 PASS "clock set back 1 h while away (<20 s real): lock screen, no ledger"; LOCKED_SHOTS+=(06b-back-with-clock-set-back-1h)
else dump s6; record S6 FAIL "not locked after the clock was set back"; fi
unlock s6r || true

# ---- S2: language EN -> AR keeps it unlocked ---------------------------------------------
shot 02a-before-language-switch-unlocked
if mro langswitch s2-switch; then
  sleep 3; shot 02b-after-switch-to-arabic
  if mro langcheck s2-check; then record S2 PASS "switched to Arabic from Settings: no lock screen (EN or AR), Settings shown in Arabic"
  else dump s2; record S2 FAIL "lock screen appeared or Arabic Settings not shown (see maestro-s2-check.log)"; fi
else dump s2-switch; shot 02b-switch-failed; record S2 FAIL "could not drive the language switch (see maestro-s2-switch.log)"; fi

printf '%s\n' "${LOCKED_SHOTS[@]}" > "$OUT/locked-shots.txt"
log "done"
