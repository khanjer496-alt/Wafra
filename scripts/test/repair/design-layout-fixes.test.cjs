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

test('Watch: one row per category; the name keeps a readable line and the clay marks a set limit', () => {
  // 2026-10-03 onboarding polish: the tile grid became expandable rows (one
  // open at a time, quick amounts, typed figure). A row is full width, so the
  // name never competes with two neighbours for its longest word.
  const watch = read('src/components/onboarding/e-watch.tsx');
  assert.match(watch, /amount \? clay\.fill/, 'a row with a limit wears the board\'s clay on its icon');
  assert.match(watch, /const clay = useBand\('spending'\)/);
  assert.doesNotMatch(watch, /numberOfLines|adjustsFontSizeToFit|maxFontSizeMultiplier/);
  // At the accessibility sizes the amount wraps under the name, never the chevron alone,
  // and the name keeps a readable width instead of a sliver.
  assert.match(watch, /largeText && styles\.headWrap/);
  assert.match(watch, /headWrap: \{ flexWrap: 'wrap' \}/);
  assert.match(watch, /largeText && styles\.nameWide/);
  assert.match(watch, /nameWide: \{ minWidth: 140 \}/);
  assert.match(watch, /useCategoryCatalog\(\)/, 'custom category names and icons, as everywhere else');
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
