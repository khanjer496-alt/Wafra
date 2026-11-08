const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');

test('EAS resolved host version reaches the extension config; malformed versions fail closed', () => {
  const run = value => spawnSync(process.execPath, ['-e', `
    const configure = require('./app.config.js');
    const result = configure({config:{ios:{buildNumber:'1'}}});
    process.stdout.write(result.ios.buildNumber);
  `], {cwd:root, env:{...process.env, EAS_BUILD_IOS_BUILD_NUMBER:value}, encoding:'utf8'});
  assert.equal(run('394').stdout, '394');
  assert.equal(run('').stdout, '1');
  assert.notEqual(run('invalid').status, 0);
});
test('unsigned product checker rejects mismatched or absent widget versions', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-version-test-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const app = path.join(dir, 'Wafra.app');
  const widget = path.join(app, 'PlugIns/widget.appex');
  fs.mkdirSync(widget, {recursive:true});
  const plist = version => `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleVersion</key><string>${version}</string></dict></plist>`;
  fs.writeFileSync(path.join(app, 'Info.plist'), plist('394'));
  const run = () => spawnSync(process.platform === 'darwin' ? '/usr/bin/python3' : 'python3', ['scripts/check-ios-product-versions.py', app], {cwd:root, encoding:'utf8'});
  fs.writeFileSync(path.join(widget, 'Info.plist'), plist('1'));
  assert.notEqual(run().status, 0);
  fs.writeFileSync(path.join(widget, 'Info.plist'), plist('394'));
  const matching = run(); assert.equal(matching.status, 0, matching.stderr);
  fs.unlinkSync(path.join(widget, 'Info.plist'));
  assert.notEqual(run().status, 0);
});
