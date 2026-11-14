'use strict';
// A small static import-graph walker that follows Metro's platform file
// resolution (`.ios`/`.android`/`.web`, then `.native`, then the default file).
// It answers "which source files does this platform evaluate at startup?":
// every static `import`/`export ... from` reachable from the app entry and
// from every Expo Router route file. Lazy `import()` and `require()` calls are
// deliberately NOT followed (they run only when called), and `import type` is
// erased by the compiler, so neither counts.
const fs = require('node:fs');
const path = require('node:path');

const EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];
const STATIC_IMPORT = /(?:^|[\s;(])(?:import|export)\s+(?:type\s+)?(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]/g;

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function staticImports(source) {
  const specs = [];
  STATIC_IMPORT.lastIndex = 0;
  let match;
  const text = stripComments(source);
  while ((match = STATIC_IMPORT.exec(text))) {
    if (/^\s*(?:import|export)\s+type\b/.test(match[0])) continue;
    specs.push(match[1]);
  }
  return specs;
}

function reachableFiles(root, platform) {
  const platformSuffixes = platform === 'web' ? ['.web'] : [`.${platform}`, '.native'];
  const tryFile = (base) => {
    for (const suffix of [...platformSuffixes, '']) {
      for (const ext of EXTENSIONS) {
        const file = base + suffix + ext;
        if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
      }
    }
    return null;
  };
  const inside = (file) => file.startsWith(path.join(root, 'src') + path.sep) ||
    file.startsWith(path.join(root, 'modules') + path.sep);
  const resolve = (from, spec) => {
    let base;
    if (spec.startsWith('@/')) base = path.join(root, 'src', spec.slice(2));
    else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
    else return null; // a package, not ours
    if (!inside(base)) return null;
    return tryFile(base) || tryFile(path.join(base, 'index'));
  };

  const seen = new Set();
  const queue = [];
  const add = (file) => {
    if (file && !seen.has(file)) { seen.add(file); queue.push(file); }
  };
  add(path.join(root, 'index.js'));
  const walkRoutes = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name);
      if (fs.statSync(file).isDirectory()) walkRoutes(file);
      else if (/\.(tsx?|jsx?)$/.test(name)) add(file);
    }
  };
  walkRoutes(path.join(root, 'src/app'));
  while (queue.length) {
    const file = queue.pop();
    for (const spec of staticImports(fs.readFileSync(file, 'utf8'))) add(resolve(file, spec));
  }
  return new Set([...seen].map((file) => path.relative(root, file)));
}

module.exports = { reachableFiles, staticImports };
