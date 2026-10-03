'use strict';
// Design language E, settings side: the new copy module's English/Arabic
// parity and truth limits, and the pure layout figures the screens use.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const theme = load(path.join(root, 'src/constants/theme.ts'), { '@/global.css': {}, 'react-native': { Platform: { select: (x) => x.ios } } });
const { SETTINGS_E_COPY, settingsECopy } = load(path.join(root, 'src/lib/settings-e-copy.ts'));
const layout = load(path.join(root, 'src/lib/settings-layout.ts'), { '@/constants/theme': theme });
const ARABIC = /[؀-ۿ]/;

const shape = (value) => {
  if (typeof value === 'function') return `function/${value.length}`;
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, shape(value[k])]));
  return typeof value;
};
const strings = (value, key = '') => typeof value === 'string' ? [[key, value]]
  : Object.entries(value).flatMap(([k, v]) => strings(v, `${key}.${k}`));

test('English and Arabic carry exactly the same keys and kinds', () => {
  assert.deepEqual(shape(SETTINGS_E_COPY.ar), shape(SETTINGS_E_COPY.en));
  assert.equal(settingsECopy('ar'), SETTINGS_E_COPY.ar);
  assert.equal(settingsECopy('en'), SETTINGS_E_COPY.en);
  assert.equal(settingsECopy(undefined), SETTINGS_E_COPY.en, 'anything else reads English');
});

test('every Arabic string is Arabic and every English string is not', () => {
  for (const [key, value] of strings(SETTINGS_E_COPY.en)) assert.ok(value.trim() && !ARABIC.test(value), `en${key}`);
  for (const [key, value] of strings(SETTINGS_E_COPY.ar)) assert.ok(ARABIC.test(value), `ar${key}`);
});

test('the Pro sheet names only gated features and no price or saving', () => {
  assert.deepEqual(Object.keys(SETTINGS_E_COPY.en.proSheetTitle).sort(), ['capture', 'notifications']);
  for (const lang of ['en', 'ar']) {
    for (const [key, value] of strings(SETTINGS_E_COPY[lang])) {
      assert.doesNotMatch(value, /\d|%|save|saving|وفّر|توفير/i, `${lang}${key}`);
    }
  }
});

test('the not-found screen is plain: a title, one line, the way home', () => {
  assert.equal(SETTINGS_E_COPY.en.notFoundTitle, 'Page not found');
  assert.match(SETTINGS_E_COPY.en.notFoundBody, /Your ledger is fine\.$/);
  assert.equal(SETTINGS_E_COPY.en.notFoundBody.split('. ').length, 2);
});

test('a Settings recovery link scrolls to its group inside the sheet', () => {
  const { Spacing } = theme;
  // Band content ends 180pt down its column; the group sits 16pt into the sheet.
  assert.equal(layout.settingsSectionScrollY(180, 16), Spacing.two + 180 + Spacing.four + 16 - Spacing.three);
  // Never above the top of the page.
  assert.equal(layout.settingsSectionScrollY(0, 0), Math.max(0, Spacing.two + Spacing.four - Spacing.three));
  assert.ok(layout.settingsSectionScrollY(-500, 0) >= 0);
  // Larger text makes the band taller, and the target moves with it.
  assert.ok(layout.settingsSectionScrollY(320, 16) > layout.settingsSectionScrollY(180, 16));
});

test('an invite countdown reads mm:ss and never goes negative', () => {
  assert.deepEqual({ ...layout.inviteCountdown(582) }, { text: '09:42', minutes: 9, seconds: '42' });
  assert.deepEqual({ ...layout.inviteCountdown(600) }, { text: '10:00', minutes: 10, seconds: '00' });
  assert.deepEqual({ ...layout.inviteCountdown(5) }, { text: '00:05', minutes: 0, seconds: '05' });
  assert.deepEqual({ ...layout.inviteCountdown(0) }, { text: '00:00', minutes: 0, seconds: '00' });
  assert.deepEqual({ ...layout.inviteCountdown(-3) }, { text: '00:00', minutes: 0, seconds: '00' });
  assert.deepEqual({ ...layout.inviteCountdown(Number.NaN) }, { text: '00:00', minutes: 0, seconds: '00' });
  assert.deepEqual({ ...layout.inviteCountdown(61.9) }, { text: '01:01', minutes: 1, seconds: '01' });
});
