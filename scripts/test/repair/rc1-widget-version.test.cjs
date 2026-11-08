const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');

test('literal local host version is used without an EAS build-number variable', () => {
  const run = value => spawnSync(process.execPath, ['-e', `
    const configure = require('./app.config.js');
    const result = configure({config:{ios:{buildNumber:${JSON.stringify(value)}}}});
    process.stdout.write(result.ios.buildNumber);
  `], {cwd:root, env:{...process.env, EAS_BUILD_IOS_BUILD_NUMBER:''}, encoding:'utf8'});
  assert.equal(run('192').stdout, '192');
  assert.notEqual(run('').status, 0);
  assert.notEqual(run('invalid').status, 0);
  const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json')));
  assert.equal(eas.cli.appVersionSource, 'local');
  assert.equal(eas.build.base.ios.autoIncrement, false);
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json')));
  assert.match(app.expo.ios.buildNumber, /^[0-9]+$/);
  assert.ok(Number(app.expo.ios.buildNumber) > 191, 'reserve a literal build above the last ASC build');
});
test('the iOS shipping shortcut cannot auto-submit an unchecked IPA', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
  assert.doesNotMatch(pkg.scripts['ship:ios'], /--auto-submit/);
});
test('product checker rejects unresolved, mismatched and absent build/marketing versions', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-version-test-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const app = path.join(dir, 'Wafra.app');
  const widget = path.join(app, 'PlugIns/widget.appex');
  fs.mkdirSync(widget, {recursive:true});
  const plist = (version, short = '1.0.0') => `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleVersion</key><string>${version}</string><key>CFBundleShortVersionString</key><string>${short}</string></dict></plist>`;
  fs.writeFileSync(path.join(app, 'Info.plist'), plist('394'));
  const run = () => spawnSync(process.platform === 'darwin' ? '/usr/bin/python3' : 'python3', ['scripts/check-ios-product-versions.py', app], {cwd:root, encoding:'utf8'});
  fs.writeFileSync(path.join(widget, 'Info.plist'), plist('1'));
  assert.notEqual(run().status, 0);
  fs.writeFileSync(path.join(widget, 'Info.plist'), plist('394'));
  const matching = run(); assert.equal(matching.status, 0, matching.stderr);
  for (const bad of ['$(CURRENT_PROJECT_VERSION)', '', '192..1', '192.', '.192', ' 192', '-192', '١٩٢']) {
    fs.writeFileSync(path.join(app, 'Info.plist'), plist(bad));
    fs.writeFileSync(path.join(widget, 'Info.plist'), plist(bad));
    assert.notEqual(run().status, 0, `matching invalid build versions must fail: ${bad}`);
  }
  fs.writeFileSync(path.join(app, 'Info.plist'), plist('394'));
  fs.writeFileSync(path.join(widget, 'Info.plist'), plist('394', '1.0.1'));
  assert.notEqual(run().status, 0, 'marketing version mismatch must fail');
  for (const bad of ['$(MARKETING_VERSION)', '', '1..0']) {
    fs.writeFileSync(path.join(app, 'Info.plist'), plist('394', bad));
    fs.writeFileSync(path.join(widget, 'Info.plist'), plist('394', bad));
    assert.notEqual(run().status, 0, 'matching invalid marketing versions must fail');
  }
  fs.writeFileSync(path.join(app, 'Info.plist'), plist('394'));
  fs.unlinkSync(path.join(widget, 'Info.plist'));
  assert.notEqual(run().status, 0);
});
