'use strict';

// Backport the synchronous stale-freeze reset from upstream issue #4518.
// No topology, native code, freeze policy, dependency or source-map changes.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const VERSION = '4.23.0';
const RESET = '  if (!freeze && freezeState) {\n    setFreezeState(false);\n  }\n';
const TARGETS = [
  {
    "path": "src/components/helpers/DelayedFreeze.tsx",
    "anchor": "  const [freezeState, setFreezeState] = React.useState(false);\n",
    "originalHash": "9d4cc57ce1c02c004045f2bba70650cd3c13751a9785be57b00d069f3a4b9249",
    "patchedHash": "d1e9ebcbcefa86eb67b5651717f5256dee9fbe44a9a3b7f1d9577be13b38c5b4"
  },
  {
    "path": "lib/module/components/helpers/DelayedFreeze.js",
    "anchor": "  const [freezeState, setFreezeState] = React.useState(false);\n",
    "originalHash": "9b2c134a14158a184089ed2d1dc46b4f9f49497ca0373c4e9b4d3e4be8f83fb5",
    "patchedHash": "70df77909f5369015533ddf512a61580fd5d11cc1832a77689a427ed42f4a49b"
  },
  {
    "path": "lib/commonjs/components/helpers/DelayedFreeze.js",
    "anchor": "  const [freezeState, setFreezeState] = _react.default.useState(false);\n",
    "originalHash": "8d0b50f457d24dfa3bc4bdf12483307c2380835875c35aa30065619c1a3f5799",
    "patchedHash": "1338c5ce34eceeadc2e4c296d70b7027bb54f2038c4be5a520b134f2505f9c41"
  }
];
const hash = text => createHash('sha256').update(text).digest('hex');

function patchReactNativeScreens(packageDirectory = path.resolve(__dirname, '../node_modules/react-native-screens')) {
  const manifest = JSON.parse(fs.readFileSync(path.join(packageDirectory, 'package.json'), 'utf8'));
  if (manifest.name !== 'react-native-screens' || manifest.version !== VERSION) {
    throw new Error('DelayedFreeze backport requires react-native-screens 4.23.0; review the patch before changing versions.');
  }

  // Preflight EVERY entry point before writing any of them. A missing file or
  // an unexpected vendor edit must never leave a partially validated patch.
  const planned = TARGETS.map(target => {
    const file = path.join(packageDirectory, target.path);
    if (!fs.lstatSync(file).isFile()) throw new Error(`Expected regular file: ${target.path}`);
    const original = fs.readFileSync(file, 'utf8');
    const digest = hash(original);
    if (digest === target.patchedHash) return { file, changed: false };
    if (digest !== target.originalHash || original.split(target.anchor).length !== 2) {
      throw new Error(`Unrecognized DelayedFreeze contents: ${target.path}`);
    }
    const patched = original.replace(target.anchor, target.anchor + RESET);
    if (hash(patched) !== target.patchedHash) throw new Error(`Unexpected patch result: ${target.path}`);
    return { file, changed: true, patched };
  });
  for (const target of planned) {
    if (target.changed) fs.writeFileSync(target.file, target.patched, 'utf8');
  }
  return { version: VERSION, changedFiles: planned.filter(target => target.changed).length };
}

module.exports = { patchReactNativeScreens };

if (require.main === module) {
  try {
    const result = patchReactNativeScreens();
    console.log(`[Wafra] DelayedFreeze ${result.version} backport verified; ${result.changedFiles} files patched.`);
  } catch (error) {
    console.error(`[Wafra] DelayedFreeze backport refused: ${error.message}`);
    process.exitCode = 1;
  }
}
