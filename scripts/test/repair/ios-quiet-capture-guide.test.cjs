'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const { iosShortcutSetupCopy } = load(path.join(root, 'src/lib/ios-shortcut-setup-copy.ts'));
for (const language of ['en','ar']) test(`SMS setup ${language} has one currency-independent trigger`, () => {
  const guide = iosShortcutSetupCopy(language);
  assert.equal(guide.guide.length, 5);
  assert.match(guide.guide[2].body, language === 'en' ? /single space/ : /مسافة واحدة/);
  assert.doesNotMatch(JSON.stringify(guide), /\{currency\}|AED|USD|SAR/);
  assert.match(guide.guide[3].body, language === 'en' ? /Notify When Run if shown/ : /إن ظهر/);
  assert.match(guide.existing, language === 'en' ? /Edit it instead/ : /عدّلها بدلاً/);
});
test('setup does not derive its trigger from the ledger currency', () => {
  const screen = fs.readFileSync(path.join(root, 'src/app/ios-setup.tsx'), 'utf8');
  assert.match(screen, /iosShortcutSetupCopy\(language\)/);
  assert.doesNotMatch(screen, /iosShortcutSetupCopy\(language,/);
});
