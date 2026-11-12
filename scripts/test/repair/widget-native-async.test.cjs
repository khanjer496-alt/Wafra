'use strict';
// The iOS widget write (App Group UserDefaults plus WidgetKit's reloadAllTimelines,
// which re-renders every placed widget) used to be a synchronous Expo Function that
// ran on the JS thread. It is an AsyncFunction now; the JS bridge accepts both the
// async answer of current binaries and the synchronous answer of older ones and of
// Android. Swift cannot run here, so its shape is checked against the source.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');

const bridgeWith = (setSnapshot, os = 'ios') => load(path.join(root, 'modules/wafra-widgets/index.ts'), {
  'react-native': { Platform: { OS: os } },
  'expo-modules-core': { requireOptionalNativeModule: () => ({ setSnapshot, clearSnapshot() {} }) },
});

test('an async native answer is awaited: nothing (iOS) and true count as stored, false and a rejection do not', async () => {
  assert.equal(await bridgeWith(async () => undefined).setWidgetSnapshot('{}'), true, 'iOS resolves with nothing');
  assert.equal(await bridgeWith(async () => true).setWidgetSnapshot('{}'), true);
  assert.equal(await bridgeWith(async () => false).setWidgetSnapshot('{}'), false);
  assert.equal(await bridgeWith(() => Promise.reject(new Error('fixture'))).setWidgetSnapshot('{}'), false);
});

test('the synchronous answers of Android and of older iOS binaries keep their meaning', () => {
  assert.equal(bridgeWith(() => undefined).setWidgetSnapshot('{}'), true);
  assert.equal(bridgeWith(() => true, 'android').setWidgetSnapshot('{}'), true);
  assert.equal(bridgeWith(() => false, 'android').setWidgetSnapshot('{}'), false);
  assert.equal(bridgeWith(() => { throw new Error('fixture'); }).setWidgetSnapshot('{}'), false);
});

test('without a native module the write is a silent success', () => {
  const none = load(path.join(root, 'modules/wafra-widgets/index.ts'), {
    'react-native': { Platform: { OS: 'web' } },
    'expo-modules-core': { requireOptionalNativeModule: () => null },
  });
  assert.equal(none.setWidgetSnapshot('{}'), true);
});

test('the iOS module writes off the JS thread on one serial queue, and keeps its guards', () => {
  const swift = fs.readFileSync(path.join(root, 'modules/wafra-widgets/ios/WafraWidgetsModule.swift'), 'utf8');
  // Async, and still answers false when the size or App Lock privacy gate refused the write.
  assert.match(swift, /AsyncFunction\("setSnapshot"\) \{ \(json: String\) -> Bool in/);
  assert.doesNotMatch(swift, /\bFunction\("setSnapshot"\)/, 'setSnapshot is no longer synchronous');
  // Module-internal (not private) so WafraPrivacyCover's purge shares the same serial queue.
  assert.match(swift, /\bstatic let queue = DispatchQueue\(label: "app\.wafra\.widgets\.snapshot"\)/);
  // The privacy check runs on the queue together with the write, so a write cannot pass the
  // check and then land after App Lock's purge, which also runs on the queue.
  assert.match(swift, /AsyncFunction\("setSnapshot"\)[\s\S]*?WafraWidgetsModule\.queue\.sync \{[\s\S]*?!WafraPrivacyCover\.acceptsSnapshot\(json\)[\s\S]*?return false[\s\S]*?defaults\.set\(json/);
  const cover = fs.readFileSync(path.join(root, 'modules/wafra-widgets/ios/WafraPrivacyCover.swift'), 'utf8');
  assert.match(cover, /if Self\.hidesWidgetAmounts \{[\s\S]*?WafraWidgetsModule\.queue\.sync \{[\s\S]*?!Self\.acceptsSnapshot\(raw\)[\s\S]*?removeObject\(forKey: WafraWidgetsModule\.snapshotKey\)/);
  // Both write and erase go through the queue, so an erase cannot be overtaken by an older write.
  assert.match(swift, /AsyncFunction\("setSnapshot"\)[\s\S]*?WafraWidgetsModule\.queue\.sync \{[\s\S]*?defaults\.set\(json, forKey: WafraWidgetsModule\.snapshotKey\)[\s\S]*?WafraWidgetsModule\.reloadWidgets\(\)/);
  assert.match(swift, /Function\("clearSnapshot"\) \{\s*WafraWidgetsModule\.queue\.sync \{[\s\S]*?removeObject\(forKey: WafraWidgetsModule\.snapshotKey\)[\s\S]*?reloadWidgets\(\)/);
  // The 64 KB guard still removes the older snapshot instead of leaving it on screen.
  assert.match(swift, /json\.utf8\.count > WafraWidgetsModule\.maxSnapshotBytes \|\|\s*!WafraPrivacyCover\.acceptsSnapshot\(json\) \{[\s\S]*?defaults\.removeObject\(forKey: WafraWidgetsModule\.snapshotKey\)/);
  assert.match(swift, /WidgetCenter\.shared\.reloadAllTimelines\(\)/);
  assert.match(swift, /static let appGroup = "group\.app\.wafra\.ios"/);
});

test('the Android module and its synchronous answer are untouched', () => {
  const kotlin = fs.readFileSync(path.join(root, 'modules/wafra-widgets/android/src/main/java/expo/modules/wafrawidgets/WafraWidgetsModule.kt'), 'utf8');
  assert.match(kotlin, /Function\("setSnapshot"\)/);
  assert.doesNotMatch(kotlin, /AsyncFunction\("setSnapshot"\)/);
});

// Erase Everything calls the SYNCHRONOUS clearSnapshot directly. A write that was still in
// flight (queued behind Expo's dispatcher, so not yet on the Swift serial queue) can land
// after it and resurrect the pre-erase figures; the bridge erases again when that happens.
test('an erase that overtakes an in-flight write is repeated when the write lands', async () => {
  let release;
  const clearsSeen = [];
  const bridge = load(path.join(root, 'modules/wafra-widgets/index.ts'), {
    'react-native': { Platform: { OS: 'ios' } },
    'expo-modules-core': { requireOptionalNativeModule: () => ({
      setSnapshot: () => new Promise((resolve) => { release = resolve; }),
      clearSnapshot: () => { clearsSeen.push('clear'); },
    }) },
  });
  const write = bridge.setWidgetSnapshot('{"stale":true}');
  bridge.clearWidgetSnapshot();
  assert.deepEqual(clearsSeen, ['clear'], 'the erase itself ran at once');
  release();
  assert.equal(await write, false, 'a write that lost to the erase is not "stored"');
  assert.deepEqual(clearsSeen, ['clear', 'clear'], 'and the erase is repeated after it landed');
  assert.equal(bridge.widgetSnapshotClearCount(), 1, 'the repeat is not a second user-visible erase');
});

test('a write issued AFTER the erase is the answer to show, and is not wiped by an older write landing', async () => {
  const releases = [];
  const clearsSeen = [];
  const bridge = load(path.join(root, 'modules/wafra-widgets/index.ts'), {
    'react-native': { Platform: { OS: 'ios' } },
    'expo-modules-core': { requireOptionalNativeModule: () => ({
      setSnapshot: () => new Promise((resolve) => { releases.push(resolve); }),
      clearSnapshot: () => { clearsSeen.push('clear'); },
    }) },
  });
  const older = bridge.setWidgetSnapshot('{"old":1}');
  bridge.clearWidgetSnapshot();
  const newer = bridge.setWidgetSnapshot('{"fresh":1}');
  releases[0]();
  assert.equal(await older, true, 'the older write is not mistaken for a stale resurrection');
  releases[1]();
  assert.equal(await newer, true);
  assert.deepEqual(clearsSeen, ['clear'], 'only the erase itself; the fresh snapshot is never wiped');
});

test('with no erase in between, an async write behaves as before', async () => {
  const clearsSeen = [];
  const bridge = load(path.join(root, 'modules/wafra-widgets/index.ts'), {
    'react-native': { Platform: { OS: 'ios' } },
    'expo-modules-core': { requireOptionalNativeModule: () => ({
      setSnapshot: async () => undefined, clearSnapshot: () => { clearsSeen.push('clear'); } }) },
  });
  assert.equal(await bridge.setWidgetSnapshot('{}'), true);
  assert.deepEqual(clearsSeen, []);
});

test('Erase Everything clears the widgets directly, and that direct erase is safe against an in-flight write', () => {
  const store = fs.readFileSync(path.join(root, 'src/lib/store.tsx'), 'utf8');
  // clearAll calls the bridge's synchronous erase outside the sync chain; this pins it so a change must be deliberate.
  assert.match(store, /\/\/ Widgets hold a copy of a few figures; erasing the ledger erases those too\.\s*clearWidgetSnapshot\(\);/);
  const bridge = fs.readFileSync(path.join(root, 'modules/wafra-widgets/index.ts'), 'utf8');
  // ...and its safety is the bridge's repeat-erase for a write that was in flight (tested above).
  assert.match(bridge, /if \(clears !== clearsBefore && writesSinceClear === 0\) \{\s*try \{ native\?\.clearSnapshot\(\); \} catch/);
  const swift = fs.readFileSync(path.join(root, 'modules/wafra-widgets/ios/WafraWidgetsModule.swift'), 'utf8');
  assert.doesNotMatch(swift, /can never be overtaken/, 'the comment must not claim more than the queue guarantees');
  assert.match(swift, /does not order an\s+\/\/\/ erase against a write that Expo has not dispatched/);
});

