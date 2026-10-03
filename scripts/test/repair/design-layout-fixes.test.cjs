'use strict';
// Pins the design-audit layout fixes: recap cards anchor under their headline,
// the Watch grid is three across unless a word would not fit, the Goals tray
// is loose on-band tiles, Data and help's Erase/diagnosis rows match their
// neighbours, the dark Erase dialog is a lifted surface, and the account
// sheet's Delete is destructive with straight rules.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

/** Load a component file for its pure exports: every import is an inert boundary. */
function pure(file) {
  const source = read(file);
  const inert = new Proxy(function inert() { return null; }, { get: (_t, key) => key === '__esModule' ? true : inert });
  const deps = {};
  for (const [, name] of source.matchAll(/from '([^']+)'/g)) deps[name] = inert;
  deps['react-native'] = { StyleSheet: { create: (styles) => styles, hairlineWidth: 1 }, View: inert, Pressable: inert };
  deps['react/jsx-runtime'] = { jsx: () => null, jsxs: () => null, Fragment: 'Fragment' };
  deps.react = { __esModule: true, default: {}, useState: (v) => [v, () => {}] };
  return load(path.join(root, file), deps);
}

test('recap cards sit directly under their headline; the account shows its last four once', () => {
  const story = read('src/components/recap/recap-story.tsx');
  assert.doesNotMatch(story, /pushBottom/, 'no card pins its tiles or lists to the bottom');
  assert.match(story, /bigPurchase: \{ gap: 16 \}/, 'the largest payment is top-anchored, not centred');
  const account = story.slice(story.indexOf('function AccountScene'), story.indexOf('function RhythmScene'));
  assert.doesNotMatch(account, /last4/, 'row.label (accountDisplayName) already carries the last four');
  // Only Done keeps to the foot of the final card.
  assert.match(story, /<View style=\{styles\.finalAction\}>\s*<EButton testID="recap-done"/);
  assert.match(story, /finalAction: \{ marginTop: 'auto' \}/);
});

test('Watch: three across when every row fits its longest words, else two, else one', () => {
  const { watchColumns } = pure('src/components/onboarding/e-watch.tsx');
  // Unmeasured: the board's own count (two at Larger Text).
  assert.equal(watchColumns(0, null, 3), 3);
  assert.equal(watchColumns(342, null, 2), 2);
  // 390pt phone, Geist 15: "Entertainment" needs ~125pt with padding; its row still fits.
  const mins = [68, 91, 91, 90, 125, 69];
  assert.equal(watchColumns(342, mins, 3), 3);
  assert.equal(watchColumns(312, mins, 3), 3);
  // At a larger text size the long row no longer fits three across.
  const big = mins.map((m) => Math.round(m * 1.35));
  assert.equal(watchColumns(342, big, 3), 2);
  // Larger Text never goes past two; one when even two cannot hold a word.
  assert.equal(watchColumns(342, mins, 2), 2);
  assert.equal(watchColumns(200, [150, 150, 60, 60, 60, 60], 2), 1);
  const watch = read('src/components/onboarding/e-watch.tsx');
  assert.match(watch, /picked \? clay\.fill/, 'the picked tile wears the board\'s clay');
  assert.match(watch, /const clay = useBand\('spending'\)/);
  assert.doesNotMatch(watch, /numberOfLines|adjustsFontSizeToFit/);
});

test('Goals: loose on-band tray, no card, green shapes take on-band tones', () => {
  const { trayTiles } = pure('src/components/onboarding/e-goals.tsx');
  const tiles = [
    { key: 'goals:subscriptions', col: 1, row: 1, kind: 'ring', color: 'green' },
    { key: 'goals:bills', col: 1, row: 0, kind: 'quarter', color: 'green' },
    { key: 'name:you', col: 0, row: 0, kind: 'letter', color: 'clay' },
  ];
  const out = trayTiles(tiles).map((tile) => `${tile.key}:${tile.color}`);
  assert.deepEqual([...out], ['name:you:clay', 'goals:bills:mint', 'goals:subscriptions:cream']);
  const goals = read('src/components/onboarding/e-goals.tsx');
  assert.doesNotMatch(goals, /patternCard|band\.sheet/);
  assert.match(goals, /const TRAY_TILE = 38;/);
  assert.match(goals, /testID="onboarding-goals-pattern" accessible accessibilityRole="image"/);
});

test('Data and help: Erase and diagnosis are ordinary rows; the dark dialog is lifted', () => {
  const data = read('src/app/settings-data.tsx');
  assert.match(data, /<SettingsLinkRow\s+title=\{t\('eraseAll'\)\}\s+icon="trash"\s+tone="danger"/);
  assert.doesNotMatch(data, /paddingTop: Spacing\.five/);
  assert.match(data, /palette\.scheme === 'dark'[\s\S]{0,200}backgroundColor: palette\.tile, borderColor: palette\.bandRule/);
  const diag = read('src/components/diagnostic-export-control.tsx');
  assert.match(diag, /<SettingsLinkRow title=\{w\.title\} subtitle=\{w\.intro\} icon="tools"/);
});

test('account manage sheet: Delete is destructive and rules are straight hairlines', () => {
  const account = read('src/app/account.tsx');
  assert.match(account, /\{ value: 'delete', label: t\('delete'\), destructive: true \}/);
  assert.match(account, /option\.destructive \? palette\.statusOver : palette\.text/);
  const row = account.match(/manageRow: \{[^}]*\}/)[0];
  assert.doesNotMatch(row, /borderRadius/);
  // Delete still asks first.
  assert.match(account, /<ConfirmSheet[\s\S]{0,200}question=\{t\('removeAccountTitle'\)\}/);
});
