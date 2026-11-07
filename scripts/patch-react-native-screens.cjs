'use strict';

// Install-time compatibility shims for pinned release dependencies.
// The screens backport resets stale freeze state; the URI shim preserves the
// SDK55 query parser API with the maintained, patched ESM decoder.
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

function patchQueryString(projectDirectory = path.resolve(__dirname, '..')) {
  const modules = path.join(projectDirectory, 'node_modules');
  if (fs.existsSync(modules) && fs.lstatSync(modules).isSymbolicLink()) {
    throw new Error('Do not patch a shared node_modules symlink; install this checkout independently.');
  }
  const directory = path.join(modules, 'query-string');
  if (!fs.existsSync(directory)) return { present: false, changed: false };
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  const decoder = JSON.parse(fs.readFileSync(path.join(modules, 'decode-uri-component/package.json'), 'utf8'));
  if (manifest.version !== '7.1.3' || decoder.version !== '0.5.1') {
    throw new Error('Review URI decoder compatibility before changing the pinned query-string/decoder versions.');
  }
  const file = path.join(directory, 'index.js');
  const original = "const decodeComponent = require('decode-uri-component');";
  const replacement = "const decodeComponentModule = require('decode-uri-component');\n" +
    "const decodeComponent = typeof decodeComponentModule === 'function' ? decodeComponentModule : decodeComponentModule.default;";
  const text = fs.readFileSync(file, 'utf8');
  if (text.includes(replacement)) return { present: true, changed: false };
  if (text.split(original).length !== 2) throw new Error('Unrecognized query-string decoder import; refusing a partial patch.');
  fs.writeFileSync(file, text.replace(original, replacement));
  return { present: true, changed: true };
}

module.exports = { patchReactNativeScreens, patchQueryString };

if (require.main === module) {
  try {
    const modules = path.resolve(__dirname, '../node_modules');
    if (fs.existsSync(modules) && fs.lstatSync(modules).isSymbolicLink()) {
      throw new Error('Refusing to modify another checkout through a shared dependency symlink.');
    }
    const result = patchReactNativeScreens();
    console.log(`[Wafra] DelayedFreeze ${result.version} backport verified; ${result.changedFiles} files patched.`);
    const decoder = patchQueryString();
    console.log(`[Wafra] URI decoder compatibility ${decoder.present ? 'verified' : 'not needed in this dependency layer'}.`);
  } catch (error) {
    console.error(`[Wafra] DelayedFreeze backport refused: ${error.message}`);
    process.exitCode = 1;
  }
}
