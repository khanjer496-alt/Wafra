'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../..');

test('type checking includes shipping UI/import modules, not disposable build snapshots', () => {
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  assert.equal(parsed.errors.length, 0);
  const files = new Set(parsed.fileNames.map(file => path.relative(root, file).split(path.sep).join('/')));
  for (const source of ['src/screens/journal-home-screen.tsx', 'src/hooks/use-history-import.ts',
    'src/lib/android-history-background.ts', 'src/lib/store.tsx', 'modules/sms-reader/index.ts']) {
    assert.ok(files.has(source), `${source} must remain type checked`);
  }
  assert.ok(config.config.exclude.includes('builds'));
  assert.ok([...files].every(file => !file.startsWith('builds/')));
});
