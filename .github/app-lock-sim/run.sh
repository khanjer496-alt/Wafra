#!/usr/bin/env bash
# Scripted App Lock flow on a booted iOS simulator with Face ID enrolled and the
# Release app installed. Usage: run.sh UDID OUT_DIR
# No `set -e`: every step records its own result and the table is built at the end.
set -uo pipefail
UDID=$1; OUT=${2:-shots}; APP=app.wafra.ios
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT"; RESULTS="$OUT/results.tsv"; : > "$RESULTS"
MARKER=Settings
MATCH=com.apple.BiometricKit_Sim.pearl.match
NOMATCH=com.apple.BiometricKit_Sim.pearl.nomatch
LOCKED_SHOTS=()

mono()  { python3 -c "import time;print(int(time.monotonic()))"; }   # bash SECONDS follows the wall clock, which S6 sets back
log()   { echo "[$(date -u +%H:%M:%S)] $*"; }
match() { log "notifyutil $MATCH"; xcrun simctl spawn "$UDID" notifyutil -p "$MATCH"; }
nomatch() { log "notifyutil $NOMATCH"; xcrun simctl spawn "$UDID" notifyutil -p "$NOMATCH"; }
shot()  { xcrun simctl io "$UDID" screenshot "$OUT/$1.png" >/dev/null 2>&1 && log "screenshot $1"; }
# mro NAME  -> runs flows/NAME.yaml, returns its exit code, keeps the log
mro() {
  local name=$1 tag=${2:-$1}
  maestro --device "$UDID" test -e APP_ID="$APP" -e MARKER="${MARKER:-Settings}" --test-output-dir "$OUT/maestro-$tag" \
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

# Maestro's tree shows only the system Face ID sheet while the lock screen prompts, so "locked" is read off the screen itself.
OCRBIN="${RUNNER_TEMP:-/tmp}/wafra-ocr"
swiftc -O "$HERE/ocr.swift" -o "$OCRBIN" >/dev/null 2>&1 || log "ocr build failed"
is_locked() { # $1 = tag; true when the screenshot shows the lock screen's own text
  local img="${RUNNER_TEMP:-/tmp}/lockcheck-$1.png" t
  xcrun simctl io "$UDID" screenshot "$img" >/dev/null 2>&1
  t=$("$OCRBIN" "$img" 2>/dev/null | tr '\n' ' ')
  # A system "Sign in to Apple Account" alert (StoreKit, no store account on the simulator) with its keyboard can hide
  # the lock text: cancel it and look again. Keep the first OCR text as evidence.
  if printf '%s' "$t" | grep -qi "Sign in to Apple Account"; then
    printf '%s\n' "$t" > "$OUT/ocr-lockcheck-$1-with-signin-alert.txt"
    cp "$img" "$OUT/lockcheck-$1-with-signin-alert.png" 2>/dev/null || true
    mro dismiss-signin "dismiss-$1" || true
    sleep 2
    xcrun simctl io "$UDID" screenshot "$img" >/dev/null 2>&1
    t=$("$OCRBIN" "$img" 2>/dev/null | tr '\n' ' ')
  fi
  printf '%s\n' "$t" > "$OUT/ocr-lockcheck-$1.txt"
  printf '%s' "$t" | grep -qiE "unlock with face id|passcode works too|balances stay hidden|wafra is locked|you unlock|your balan" && return 0
  # The app can hide everything behind a black cover while the system Face ID sheet prompts, so its own words are not on
  # screen. Accept that only in strict forms, and never when any seeded ledger text is visible: the system sheet alone
  # ("Face ID"), the sheet after a failed match, or the sheet under the StoreKit sign-in alert.
  local norm; norm=$(printf '%s' "$t" | tr '|' ' ' | tr -s ' ' | sed 's/^ //; s/ $//')
  if printf '%s' "$t" | grep -qiE "LULU|ADNOC|CAREEM|Transactions|Spent"; then return 1; fi
  if [ "$norm" = "Face ID" ] || printf '%s' "$t" | grep -qiE "Face Not Recognized|Try Face ID Again" \
     || { printf '%s' "$t" | grep -qi "Sign in to Apple Account" && printf '%s' "$t" | grep -qi "Face ID"; }; then
    echo "system Face ID sheet, no ledger text, no app lock wording" > "$OUT/lockcheck-$1.method"; return 0
  fi
  return 1
}

# ---- setup: seed a small ledger, then turn App Lock on -------------------------------
if ! mro seed && ! { cp "$OUT/maestro-seed.log" "$OUT/maestro-seed-attempt1.log"; sleep 10; mro seed seed-retry; }; then
  dump seed-fail; shot setup-seed-failed; diag; record SETUP FAIL "could not seed the ledger (see maestro-seed.log)"; exit 1
fi
if mro addrows && mro seedcheck seedcheck; then MARKER='(?i).*lulu.*'; record SEEDROWS PASS "3 entries added through the Add screen (LULU HYPERMARKET, ADNOC FUEL, CAREEM RIDE); Home lists them"
else dump addrows-fail; shot 00-addrows-failed; record SEEDROWS FAIL "could not add ledger rows: the lock tests run on an EMPTY ledger (see maestro-addrows.log)"; fi
shot 00-seeded-home-unlocked
cp "$OUT/00-seeded-home-unlocked.png" "$OUT/.home-reference.png"
mro enable || { dump enable-fail; shot 00-enable-failed; record SETUP FAIL "could not reach the App Lock switch"; }
sleep 2; match; sleep 3; shot 00-after-enable-1; match; sleep 3; shot 00-after-enable-2

away; sleep 2; back; sleep 2   # warm-up: first launch of the Settings app is slow, later ones are not

# ---- S1: cold launch is locked; Face ID match unlocks; ledger shows --------------------
xcrun simctl terminate "$UDID" "$APP"; sleep 2
back; sleep 7
shot 01a-cold-launch-locked
if is_locked s1a; then
  mro faceid-label s1-faceid-label && FID="Face ID is the unlock method" || FID="Face-ID label not seen"
  record S1a PASS "cold launch showed the lock screen, no ledger; $FID"; LOCKED_SHOTS+=(01a-cold-launch-locked)
else dump s1-locked; record S1a FAIL "cold launch was not locked (see maestro-s1-locked.log)"; fi
if unlock s1; then record S1b PASS "pearl.match unlocked and the ledger shows (attempts: $UNLOCK_ATTEMPTS)"
else record S1b FAIL "ledger not shown after pearl.match"; fi
shot 01b-after-match-unlocked

# ---- S4: away < 20 s stays unlocked. simctl calls are slow on the runner, so the absence is MEASURED, not assumed.
T0=$(mono); away; sleep 1; back; ABS=$(( $(mono) - T0 )); sleep 3; shot 04b-back-after-short-absence
if mro unlocked s4; then S4OK=1; else S4OK=0; fi
if [ "$ABS" -ge 20 ]; then record S4 INCONCLUSIVE "absence measured ${ABS}s, at or beyond the 20 s grace, so it proves nothing (runner too slow); observed: $([ $S4OK = 1 ] && echo unlocked || echo locked)"
elif [ $S4OK = 1 ]; then record S4 PASS "away ${ABS}s (<20 s): still unlocked, ledger visible"
else dump s4; record S4 FAIL "away only ${ABS}s (<20 s) but the app re-locked or the ledger is missing"; fi

# ---- S3: away > 20 s re-locks ----------------------------------------------------------
away; sleep 25; shot 03a-away-25s-in-Settings-app
back; sleep 5; shot 03b-back-after-25s-locked
if is_locked s3; then record S3 PASS "25 s away: lock screen, no ledger"; LOCKED_SHOTS+=(03b-back-after-25s-locked)
else dump s3; record S3 FAIL "not locked after 25 s away"; fi

# ---- S5: pearl.nomatch stays locked ------------------------------------------------------
nomatch; sleep 5; shot 05a-after-nomatch
if is_locked s5; then record S5 PASS "pearl.nomatch: still locked, no ledger"; LOCKED_SHOTS+=(05a-after-nomatch)
else dump s5; record S5 FAIL "not locked after pearl.nomatch"; fi
if unlock s5r; then record S5r PASS "recovered: pearl.match after the failed match unlocked (attempts: $UNLOCK_ATTEMPTS)"
else record S5r FAIL "could not unlock after the failed match"; fi
shot 05b-after-recovery-unlocked

# ---- S6: clock set back while away re-locks. The grace is 20 s, so the absence must be SHORT for the clock to be the cause.
sudo systemsetup -setusingnetworktime off >/dev/null 2>&1 || log "could not disable network time"
REAL0=$(date +%s); MONO0=$(mono)
away; sleep 1
BACKTO=$((REAL0 + ($(mono) - MONO0) - 3600))
sudo date -u "$(date -u -r "$BACKTO" +%m%d%H%M%Y.%S)" >/dev/null
back; ABS=$(( $(mono) - MONO0 )); sleep 3; shot 06b-back-with-clock-set-back-1h
REAL=$((REAL0 + ($(mono) - MONO0)))
sudo date -u "$(date -u -r "$REAL" +%m%d%H%M%Y.%S)" >/dev/null; log "clock restored: $(date -u)"
if is_locked s6; then S6L=1; else S6L=0; fi
if [ $S6L = 1 ] && [ "$ABS" -lt 20 ]; then record S6 PASS "clock set back 1 h, real absence ${ABS}s (<20 s grace, so only the clock rule can explain it): lock screen, no ledger"; LOCKED_SHOTS+=(06b-back-with-clock-set-back-1h)
elif [ $S6L = 1 ]; then record S6 INCONCLUSIVE "locked, but the real absence was ${ABS}s (>= 20 s) so the 20 s rule alone could explain it"; LOCKED_SHOTS+=(06b-back-with-clock-set-back-1h)
else dump s6; record S6 FAIL "clock set back 1 h with a ${ABS}s absence and the app is NOT locked"; fi
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
