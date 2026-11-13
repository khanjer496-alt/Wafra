'use strict';
// "Erase all data" crashed the iOS Release app (TestFlight 192 and 193) with
// "Invariant Violation: `new NativeEventEmitter()` requires a non-null
// argument". The private-format key erase asked `(await import('react-native'))`
// for Platform. Metro compiles a dynamic import to importAll, which copies
// EVERY export of react-native and so runs each deprecated lazy getter.
// PushNotificationIOS builds a NativeEventEmitter over a native module that is
// no longer linked, and the module-load guard reports that throw as fatal.
// A plain require reads only Platform.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const source = path.join(root, 'src/lib/private-alert-format-runtime.ts');
const SECRET_NAME = 'wafra.private-alert-format.key.v1';

// Stands in for react-native: it records every export read and any
// enumeration of its exports, and its PushNotificationIOS getter throws the
// production invariant, as the real lazy getter does on iOS.
function guardedReactNative() {
  const seen = { reads: [], enumerated: false };
  const target = { Platform: { OS: 'ios' } };
  Object.defineProperty(target, 'PushNotificationIOS', { enumerable: true, configurable: true, get() {
    throw new Error('Invariant Violation: `new NativeEventEmitter()` requires a non-null argument.');
  } });
  const module = new Proxy(target, {
    get(object, key, receiver) {
      if (typeof key === 'string') seen.reads.push(key);
      return Reflect.get(object, key, receiver);
    },
    ownKeys(object) { seen.enumerated = true; return Reflect.ownKeys(object); },
  });
  return { module, seen };
}

test('Erase all data removes the private-format key reading only Platform, never every react-native export', async () => {
  const rn = guardedReactNative();
  const items = new Map([[SECRET_NAME, 'ab'.repeat(32)]]);
  const secure = {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only',
    getItemAsync: async key => items.get(key) ?? null,
    setItemAsync: async (key, value) => { items.set(key, value); },
    deleteItemAsync: async key => { items.delete(key); },
  };
  // The erase path needs none of the format engine; these only satisfy imports.
  const unused = name => () => { throw new Error(`${name} is not on the erase path`); };
  const engine = Object.fromEntries(['authenticatePrivateAlertFormat', 'createPrivateAlertFormat', 'matchPrivateAlertFormat',
    'normalizePrivateAlertFormatStore', 'validatePrivateAlertFormat'].map(name => [name, unused(name)]));
  engine.emptyPrivateAlertFormatStore = () => ({ version: 1, templates: [] });
  const api = load(source, { 'react-native': rn.module, 'expo-secure-store': secure,
    '@/lib/private-alert-formats': engine,
    '@/lib/private-alert-teaching': { privateAlertSourceDateContext: unused('privateAlertSourceDateContext') },
    '@/lib/universal-parser': { inspectUniversalBankEvent: unused('inspectUniversalBankEvent') },
    '@noble/hashes/hmac.js': require('@noble/hashes/hmac.js'), '@noble/hashes/sha2.js': require('@noble/hashes/sha2.js'),
    '@noble/hashes/utils.js': require('@noble/hashes/utils.js') });
  await api.erasePrivateAlertFormatKey();
  assert.equal(items.has(SECRET_NAME), false, 'erase reached the native key removal');
  assert.equal(rn.seen.enumerated, false, 'react-native exports were enumerated, as Metro importAll does for import()');
  assert.deepEqual([...new Set(rn.seen.reads)], ['Platform']);
});

test('no app or module source dynamically imports react-native', () => {
  const hits = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', 'ios', 'android', 'build'].includes(entry.name)) walk(file);
      } else if (/\.(?:[cm]?[jt]sx?)$/.test(entry.name)) {
        const text = fs.readFileSync(file, 'utf8');
        for (const [index, line] of text.split('\n').entries()) {
          // Comments may name the trap; `typeof import(...)` is a type and compiles away.
          if (/^\s*(?:\/\/|\/?\*)/.test(line)) continue;
          if (/(?<!typeof\s*)\bimport\s*\(\s*(['"`])react-native\1\s*\)/.test(line)) hits.push(`${path.relative(root, file)}:${index + 1}`);
        }
      }
    }
  };
  walk(path.join(root, 'src')); walk(path.join(root, 'modules'));
  assert.deepEqual(hits, [], 'use require(\'react-native\') for one export; import() runs every lazy getter on iOS');
});
