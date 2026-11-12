// App Lock must accept the device passcode. A user who removed Face ID or
// fingerprints but kept a passcode used to be shut out of the app (only the
// phone's Settings app was reachable from the lock screen). lock-gate.tsx and
// settings.tsx import native modules, so their decisions live in app-lock.ts
// and the wiring is checked against source.
const fs = require('fs');
const path = require('path');

const lock = require('./build/app-lock');

let pass = 0, fail = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}\n    got ${a}\n    want ${e}`); }
}
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} ${detail}`); }
}
const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

// expo-local-authentication SDK 55 SecurityLevel values, pinned against the
// installed package so an SDK renumbering fails here rather than on a phone.
const types = fs.readFileSync(
  require.resolve('expo-local-authentication/build/LocalAuthentication.types.d.ts',
    { paths: [path.join(__dirname, '../..')] }), 'utf8');
ok('SecurityLevel numbering matches the installed SDK',
  /NONE = 0/.test(types) && /SECRET = 1/.test(types) &&
    /BIOMETRIC_WEAK = 2/.test(types) && /BIOMETRIC_STRONG = 3/.test(types));

eq('no owner authentication at all', lock.deviceLockLevel(0), 'none');
eq('passcode only (biometrics removed) is still a lock', lock.deviceLockLevel(1), 'passcode');
eq('weak biometrics', lock.deviceLockLevel(2), 'biometric');
eq('strong biometrics', lock.deviceLockLevel(3), 'biometric');
eq('an unknown answer is not treated as a lock', lock.deviceLockLevel(undefined), 'none');

eq('device fallback stays enabled', lock.APP_LOCK_AUTH_OPTIONS, { disableDeviceFallback: false });

eq('success unlocks', lock.unlockOutcome({ success: true }), 'unlocked');
eq('iOS no passcode is unavailable', lock.unlockOutcome({ success: false, error: 'passcode_not_set' }), 'unavailable');
eq('Android device not secure is unavailable', lock.unlockOutcome({ success: false, error: 'not_enrolled' }), 'unavailable');
for (const error of ['user_cancel', 'system_cancel', 'lockout', 'authentication_failed', 'app_cancel', 'user_fallback']) {
  eq(`${error} keeps the retry button`, lock.unlockOutcome({ success: false, error }), 'failed');
}

const gate = stripComments(read('src/components/lock-gate.tsx'));
ok('the gate asks for any owner authentication, not biometric enrollment',
  /getEnrolledLevelAsync\(\)/.test(gate) && !/isEnrolledAsync\(\)/.test(gate) && !/hasHardwareAsync\(\)/.test(gate));
ok('the gate authenticates with the device-credential fallback',
  /authenticateAsync\(\{[\s\S]*?\.\.\.APP_LOCK_AUTH_OPTIONS[\s\S]*?\}\)/.test(gate) && !/disableDeviceFallback:\s*true/.test(gate));
ok('the gate maps results through unlockOutcome', /unlockOutcome\(/.test(gate));
ok('the gate ignores app-state changes caused by its own OS prompt',
  /authenticatingRef\.current = true/.test(gate) && /if \(authenticatingRef\.current\) return;/.test(gate));
ok('the no-lock sheet re-checks when the user returns from Settings',
  /unavailableRef\.current/.test(gate));

const settings = stripComments(read('src/app/settings.tsx'));
const toggle = settings.slice(settings.indexOf('const toggleAppLock'), settings.indexOf('const toggleAppLock') + 1500);
ok('turning App Lock on accepts a passcode-only phone',
  /getEnrolledLevelAsync\(\)/.test(toggle) && !/isEnrolledAsync\(\)/.test(toggle) &&
    /\.\.\.APP_LOCK_AUTH_OPTIONS/.test(toggle));

// Changing the language remounts the navigator subtree, and the gate sits inside
// it. The unlock flag therefore lives in a process-wide session, not only in
// React state, or the user is asked for Face ID again after switching language.
{
  const fresh = lock.createUnlockSession();
  eq('a new process starts locked', fresh.isUnlocked(), false);
  fresh.setUnlocked(true);
  // A remounted gate reads its starting value from the same session.
  const remounted = { unlocked: fresh.isUnlocked() };
  eq('a remounted gate (language change) stays unlocked', remounted.unlocked, true);
  fresh.setUnlocked(false);
  eq('a real re-lock still locks the next mount', { unlocked: fresh.isUnlocked() }.unlocked, false);
  const other = lock.createUnlockSession();
  eq('sessions are independent objects (no shared hidden state)', other.isUnlocked(), false);
  // The time the app was left also survives a remount, so a >20 s absence still re-locks.
  const away = lock.createUnlockSession();
  eq('no absence is recorded at first', away.leftAt(), 0);
  away.setLeftAt(1_000);
  eq('a remounted gate still sees when the app was left', { leftAt: away.leftAt() }.leftAt, 1_000);
  away.setLeftAt(0);
  eq('and a return clears it', away.leftAt(), 0);
  eq('an absence longer than the grace re-locks', lock.shouldRelockAfterAbsence(1_000, 22_000, 20_000), true);
  eq('exactly the grace does not', lock.shouldRelockAfterAbsence(1_000, 21_000, 20_000), false);
  eq('a short trip (a permission sheet) does not', lock.shouldRelockAfterAbsence(1_000, 6_000, 20_000), false);
  eq('no recorded absence never re-locks', lock.shouldRelockAfterAbsence(0, 999_999, 20_000), false);
  eq('a clock set back while away re-locks (fail closed)', lock.shouldRelockAfterAbsence(50_000, 10_000, 20_000), true);
  eq('an unchanged clock is not "set back"', lock.shouldRelockAfterAbsence(5_000, 5_000, 20_000), false);
  eq('the process session starts locked', lock.appLockSession.isUnlocked(), false);
  lock.appLockSession.setUnlocked(true);
  eq('the process session is one object for every mount', lock.appLockSession.isUnlocked(), true);
  lock.appLockSession.setUnlocked(false);
}
{
  const unlockedDecl = gate.match(/const \[unlocked, setUnlocked\] = useState\(([^;]*)\);/);
  ok('the gate starts from the process session, not from false',
    !!unlockedDecl && /appLockSession\.isUnlocked\(\)/.test(unlockedDecl[1]) && !/^false$/.test(unlockedDecl[1].trim()));
  ok('every unlock change is mirrored into the session through one setter',
    /const markUnlocked = useCallback\(\(next: boolean\) => \{\s*appLockSession\.setUnlocked\(next\);\s*setUnlocked\(next\);/.test(gate) &&
      (gate.match(/(?<![.\w])setUnlocked\(/g) ?? []).length === 1 &&
      /markUnlocked\(true\)/.test(gate) && /markUnlocked\(false\)/.test(gate));
  const layout = stripComments(read('src/components/app-root-layout.tsx'));
  ok('the gate keeps the time it was left in the session, not in a local variable of the effect',
    !/let leftAt\b/.test(gate) && /appLockSession\.setLeftAt\(appLockSession\.leftAt\(\) \|\| Date\.now\(\)\)/.test(gate) &&
      /appLockSession\.setLeftAt\(0\);\s*if \(relock\) \{/.test(gate));
  ok('the very first commit after a long absence is already locked (no frame of content before the effect)',
    /const \[unlocked, setUnlocked\] = useState\(\(\) => appLockSession\.isUnlocked\(\) &&\s*!\(AppState\.currentState === 'active' &&\s*shouldRelockAfterAbsence\(appLockSession\.leftAt\(\), Date\.now\(\), RELOCK_GRACE_MS\)\)\);/.test(gate) &&
      /const lockRequired = state\.hydrated && state\.appLock && Platform\.OS !== 'web' && !unlocked;/.test(gate) &&
      /<PrivacyGateContext\.Provider value=\{!privacyHidden\}>/.test(gate));
  // Only the gate may touch the process session: another importer could unlock the app.
  {
    const found = [];
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir)) {
        const file = path.join(dir, name);
        if (fs.statSync(file).isDirectory()) walk(file);
        else if (/\.(tsx?|jsx?)$/.test(name) && fs.readFileSync(file, 'utf8').includes('appLockSession')) found.push(path.relative(path.join(__dirname, '../..'), file));
      }
    };
    walk(path.join(__dirname, '../../src'));
    eq('lock-gate.tsx is the only importer of appLockSession', found.sort(), ['src/components/lock-gate.tsx', 'src/lib/app-lock.ts']);
  }
  ok('a gate that registers after the active event checks the recorded absence once on mount',
    /if \(AppState\.currentState === 'active' &&\s*shouldRelockAfterAbsence\(appLockSession\.leftAt\(\), Date\.now\(\), RELOCK_GRACE_MS\)\) \{\s*appLockSession\.setLeftAt\(0\);\s*markUnlocked\(false\);/.test(gate) &&
      /const relock = shouldRelockAfterAbsence\(appLockSession\.leftAt\(\), Date\.now\(\), RELOCK_GRACE_MS\);/.test(gate));
  ok('a language change still remounts the subtree (compiled text is evaluated again)',
    /key=\{language\}/.test(layout) && /<LockGate>/.test(layout));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
