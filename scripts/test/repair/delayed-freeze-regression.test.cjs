'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { patchReactNativeScreens } = require('../../patch-react-native-screens.cjs');
const { test } = require('node:test');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const variants = ['src/components/helpers/DelayedFreeze.tsx',
  'lib/module/components/helpers/DelayedFreeze.js',
  'lib/commonjs/components/helpers/DelayedFreeze.js'];

function componentHarness(file) {
  const slots = [];
  const timers = new Map();
  let cursor = 0, pendingEffects = [], nextTimer = 0, dirty = false, rendering = false;
  let mounted = true, stateUpdatesAfterUnmount = 0, props, output;
  const react = {
    useState(initial) {
      const index = cursor++;
      const slot = slots[index] ??= { value: initial };
      return [slot.value, next => {
        if (!mounted) stateUpdatesAfterUnmount++;
        const value = typeof next === 'function' ? next(slot.value) : next;
        if (!Object.is(value, slot.value)) { slot.value = value; dirty = true; }
      }];
    },
    useEffect(callback, dependencies) {
      const index = cursor++;
      const slot = slots[index] ??= {};
      if (!slot.dependencies || dependencies.some((value, i) => !Object.is(value, slot.dependencies[i]))) {
        pendingEffects.push(() => {
          slot.cleanup?.(); slot.dependencies = dependencies; slot.cleanup = callback();
        });
      }
    },
    createElement: (type, attributes, children) => ({ type, props: { ...attributes, children } }),
  };
  const Component = load(file, { react, 'react-freeze': { Freeze: 'Freeze' },
    'react/jsx-runtime': { jsx: (type, attributes) => ({ type, props: attributes }) } }, {
    setTimeout: callback => { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
  }).default;
  const render = freeze => {
    props = { freeze, children: { activityState: freeze ? 0 : 2 } };
    let attempts = 0;
    do {
      if (++attempts > 10) throw new Error('render-phase update did not settle');
      dirty = false; cursor = 0; pendingEffects = []; rendering = true;
      output = Component(props);
      rendering = false;
    } while (dirty);
    for (const effect of pendingEffects) effect();
    return output.props.freeze;
  };
  return {
    render,
    flushTimers() {
      assert.equal(rendering, false);
      const pending = [...timers]; timers.clear();
      for (const [, callback] of pending) callback();
      if (dirty && mounted) render(props.freeze);
      return output.props.freeze;
    },
    unmount() { mounted = false; for (const slot of slots) slot.cleanup?.(); },
    timerCount: () => timers.size,
    lateUpdates: () => stateUpdatesAfterUnmount,
  };
}

// Only private temporary package copies are modified, never shared node_modules.
const reset = '  if (!freeze && freezeState) {\n    setFreezeState(false);\n  }\n';
function packageCopy(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-delayed-freeze-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.copyFileSync(path.join(root, 'node_modules/react-native-screens/package.json'), path.join(directory, 'package.json'));
  for (const relative of variants) {
    const file = path.join(directory, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Postinstall may already have applied this exact backport. Reconstruct
    // only its known pristine counterpart for the before/after regression.
    const installed = fs.readFileSync(path.join(root, 'node_modules/react-native-screens', relative), 'utf8');
    assert.ok(installed.split(reset).length <= 2);
    fs.writeFileSync(file, installed.replace(reset, ''));
  }
  return directory;
}
const snapshot = directory => variants.map(relative => {
  const file = path.join(directory, relative);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
});

for (const relative of variants) {
  test(`${relative}: pristine source reproduces the stale second-blur freeze`, t => {
    const directory = packageCopy(t);
    const h = componentHarness(path.join(directory, relative));
    h.render(false); h.flushTimers();
    assert.equal(h.render(true), false); assert.equal(h.flushTimers(), true);
    assert.equal(h.render(false), false);
    assert.equal(h.render(true), true, 'unpatched second blur swallows native deactivation before timer reset');
    h.unmount();
  });

  test(`${relative}: backport restores deactivation grace every cycle and still freezes later`, t => {
    const directory = packageCopy(t);
    patchReactNativeScreens(directory);
    const h = componentHarness(path.join(directory, relative));
    assert.equal(h.render(false), false); h.flushTimers();
    assert.equal(h.render(true), false); assert.equal(h.flushTimers(), true);
    for (let cycle = 0; cycle < 8; cycle++) {
      assert.equal(h.render(false), false);
      assert.equal(h.render(true), false, 'second blur before reset timer must deliver activityState=0');
      assert.equal(h.timerCount(), 1, 'refocus timer was canceled rather than queued');
      assert.equal(h.flushTimers(), true, 'inactive screen still freezes after its grace render');
    }
    h.render(false);
    assert.equal(h.timerCount(), 1);
    h.unmount();
    assert.equal(h.timerCount(), 0);
    h.flushTimers();
    assert.equal(h.lateUpdates(), 0);
  });
}

test('patch changes only the synchronous reset in all three entries and is idempotent', t => {
  const directory = packageCopy(t);
  const before = snapshot(directory);
  assert.deepEqual(patchReactNativeScreens(directory), { version: '4.23.0', changedFiles: 3 });
  const after = snapshot(directory);
  for (let i = 0; i < after.length; i++) {
    assert.equal(after[i].split(reset).length, 2);
    assert.equal(after[i].replace(reset, ''), before[i]);
  }
  assert.deepEqual(patchReactNativeScreens(directory), { version: '4.23.0', changedFiles: 0 });
  assert.deepEqual(snapshot(directory), after);
  fs.writeFileSync(path.join(directory, variants[2]), before[2]);
  assert.equal(patchReactNativeScreens(directory).changedFiles, 1, 'valid partial installation completes safely');
  assert.deepEqual(snapshot(directory), after);
});

for (const relative of variants) {
  for (const failure of ['modified', 'missing']) {
    test(`${relative}: ${failure} content rejects before any file is mutated`, t => {
      const directory = packageCopy(t);
      const file = path.join(directory, relative);
      if (failure === 'missing') fs.unlinkSync(file);
      else fs.appendFileSync(file, '\n// unreviewed vendor change\n');
      const before = snapshot(directory);
      assert.throws(() => patchReactNativeScreens(directory), /Unrecognized DelayedFreeze|ENOENT/);
      assert.deepEqual(snapshot(directory), before);
    });
  }
}

test('unknown package version or identity rejects before touching helpers', t => {
  for (const patch of [{ version: '4.23.1' }, { name: 'other-package' }]) {
    const directory = packageCopy(t);
    const file = path.join(directory, 'package.json');
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), ...patch }));
    const before = snapshot(directory);
    assert.throws(() => patchReactNativeScreens(directory), /requires react-native-screens 4.23.0/);
    assert.deepEqual(snapshot(directory), before);
  }
});

test('both dependency-only feedback images include the root postinstall before npm ci', t => {
  const { spawnSync } = require('node:child_process');
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/feedback-agent.yml'), 'utf8');
  const layers = [...workflow.matchAll(/WORKDIR \/opt\/wafra\n([\s\S]*?)\s+RUN npm ci\n/g)];
  assert.equal(layers.length, 2, 'both generation and independent validation dependency layers are exercised');
  for (const [, instructions] of layers) {
    const build = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-freeze-install-layer-'));
    t.after(() => fs.rmSync(build, { recursive: true, force: true }));
    for (const line of instructions.trim().split('\n')) {
      const [, sources, destination] = line.trim().match(/^COPY (.+) (\.\/\S*)$/) ?? [];
      assert.ok(sources && destination, 'the minimal trusted dependency COPY layer remains explicit');
      const output = path.resolve(build, destination);
      assert.ok(output === build || output.startsWith(build + path.sep));
      fs.mkdirSync(output, { recursive: true });
      for (const source of sources.split(' ')) fs.copyFileSync(path.join(root, source), path.join(output, path.basename(source)));
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(build, 'package.json'), 'utf8'));
    assert.equal(manifest.scripts.postinstall, 'node scripts/patch-react-native-screens.cjs');
    assert.equal(JSON.parse(fs.readFileSync(path.join(build, 'package-lock.json'), 'utf8')).packages[''].hasInstallScript, true);
    // npm has unpacked its dependency before invoking the root lifecycle.
    const dependency = path.join(build, 'node_modules/react-native-screens');
    fs.cpSync(packageCopy(t), dependency, { recursive: true });
    const result = spawnSync(process.execPath, ['scripts/patch-react-native-screens.cjs'], { cwd: build, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /3 files patched/);
    assert.equal(patchReactNativeScreens(dependency).changedFiles, 0);
  }
});
