// Small in-memory harness: no shared build directory, generated JS, or native build.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');
const root = path.resolve(__dirname, '../..');

function createLoader() {
  const cache = new Map();
  const native = {
    'react-native': 'stub-react-native',
    'expo-constants': 'stub-expo-constants',
    'expo-crypto': 'stub-expo-crypto',
    'expo-secure-store': 'stub-secure-store',
    '@react-native-async-storage/async-storage': 'stub-async-storage',
    'expo-modules-core': 'stub-expo-modules-core',
  };
  function load(request, parent = path.join(root, 'index.cjs')) {
    let file;
    if (request.startsWith('@/')) file = path.join(root, 'src', request.slice(2));
    else if (native[request]) file = path.join(root, 'scripts/test/stubs', native[request]);
    else if (request.startsWith('.') || path.isAbsolute(request)) file = path.resolve(path.dirname(parent), request);
    else return Module.createRequire(parent)(request);
    if (!fs.existsSync(file) && fs.existsSync(file + '.ts')) file += '.ts';
    if (cache.has(file)) return cache.get(file).exports;
    if (!file.endsWith('.ts') && !file.endsWith('.tsx')) return Module.createRequire(parent)(file);
    const module = { exports: {} };
    cache.set(file, module);
    const source = fs.readFileSync(file, 'utf8');
    const output = ts.transpileModule(source, { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
      esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX,
    }, fileName: file }).outputText;
    new Function('require', 'module', 'exports', '__filename', '__dirname', output)(
      (next) => load(next, file), module, module.exports, file, path.dirname(file),
    );
    return module.exports;
  }
  return load;
}
module.exports = { createLoader };
