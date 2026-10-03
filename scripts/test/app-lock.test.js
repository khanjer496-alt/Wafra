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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
