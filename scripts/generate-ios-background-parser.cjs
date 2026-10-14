#!/usr/bin/env node
'use strict';

// Shipping generation reads only ordinary src/lib TypeScript. It never reads
// test builds, recovery bundles, Metro output, or downloaded executable code.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = 'ios-background-alert-parser';
const RESOURCE_DIRECTORY = 'modules/wafra-live-capture/ios/Resources';
const OUTPUTS = {
  bundle: `${RESOURCE_DIRECTORY}/WafraBackgroundParser.js`,
  metadata: `${RESOURCE_DIRECTORY}/WafraBackgroundParser.meta.json`,
  foregroundSource: 'src/lib/ios-background-parser-source.generated.ts',
};
const MAX_MODULES = 64;
const MAX_BUNDLE_BYTES = 2 * 1024 * 1024;
const HOST_IDENTIFIERS = new Set([
  'process', 'Buffer', '__dirname', '__filename', 'fetch', 'XMLHttpRequest',
  'WebSocket', 'window', 'document', 'navigator', 'localStorage', 'sessionStorage',
  'Deno', 'Bun', 'eval', 'Function', 'setTimeout', 'setInterval', 'console',
  'AbortController', 'AbortSignal', 'clearTimeout', 'clearInterval',
]);
const DORMANT_HOST_IDENTIFIERS = new Set([
  'fetch', 'AbortController', 'AbortSignal', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
]);
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const compilerOptions = Object.freeze({
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.CommonJS,
  removeComments: true,
  esModuleInterop: false,
  importHelpers: false,
  sourceMap: false,
  inlineSourceMap: false,
  newLine: ts.NewLineKind.LineFeed,
});

function pureModulePath(root, id) {
  if (!/^[a-z0-9.-]+(?:\/[a-z0-9.-]+)*$/i.test(id) || id.split('/').includes('..')) {
    throw new Error(`Forbidden pure source module path: ${id}`);
  }
  if (/(?:^|[/.\-])(?:stub|stubs|store|storage|keychain|database|db|native)(?:[/.\-]|$)/i.test(id) ||
      (/^(?:android|ios|react-native|expo)(?:[/.\-]|$)/i.test(id) && id !== ENTRY)) {
    throw new Error(`Forbidden native, storage or stub module: ${id}`);
  }
  const lib = path.resolve(root, 'src/lib');
  const file = path.resolve(lib, `${id}.ts`);
  if (!file.startsWith(`${lib}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new Error(`Pure shipping source is missing: src/lib/${id}.ts`);
  }
  // A source symlink cannot smuggle a test, node_modules or native file into
  // the otherwise bounded shipping path.
  if (!fs.realpathSync(file).startsWith(`${fs.realpathSync(lib)}${path.sep}`)) {
    throw new Error(`Forbidden source symlink outside src/lib: ${id}`);
  }
  return file;
}

function resolveImport(id, specifier) {
  let resolved;
  if (specifier.startsWith('@/lib/')) resolved = specifier.slice('@/lib/'.length);
  else if (specifier.startsWith('./') || specifier.startsWith('../')) {
    resolved = path.posix.normalize(path.posix.join(path.posix.dirname(id), specifier));
  } else throw new Error(`Forbidden external runtime dependency in ${id}: ${specifier}`);
  return resolved.replace(/\.ts$/, '');
}

function inspectSource(source, id, emitted = false) {
  const ast = ts.createSourceFile(`${id}.${emitted ? 'js' : 'ts'}`, source, ts.ScriptTarget.ES2020, true,
    emitted ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  const dependencies = new Map();
  const deferredHostFunctions = new Set();
  const functions = new Map();
  const imports = new Map();
  const exportAliases = new Map();
  const valueAliases = [];
  const functionName = (node) => ts.isFunctionDeclaration(node) && node.name ? node.name.text
    : ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name) ? node.parent.name.text : null;
  // Full module factories preserve normal TypeScript semantics. Existing FX
  // modules also export dormant networking functions. They have no host
  // bindings in JavaScriptCore and may not execute during module admission.
  function deferredFunction(node) {
    let outer = null;
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isFunctionLike(parent)) outer = parent;
    }
    return outer && functionName(outer) ? outer : null;
  }
  function gatherFunctions(node) {
    if (ts.isFunctionLike(node) && functionName(node)) {
      const name = functionName(node);
      const declarations = functions.get(name) || [];
      declarations.push(node);
      functions.set(name, declarations);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
        ts.isCallExpression(node.initializer) && ts.isIdentifier(node.initializer.expression) &&
        node.initializer.expression.text === 'require' && node.initializer.arguments.length === 1 &&
        ts.isStringLiteral(node.initializer.arguments[0])) {
      imports.set(node.name.text, resolveImport(id, node.initializer.arguments[0].text));
    }
    if (ts.isVariableDeclaration(node) && node.initializer) valueAliases.push([node.name, node.initializer]);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      valueAliases.push([node.left, node.right]);
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(node.left) && ts.isIdentifier(node.left.expression) &&
        node.left.expression.text === 'exports' && ts.isIdentifier(node.right)) {
      exportAliases.set(node.left.name.text, node.right.text);
    }
    ts.forEachChild(node, gatherFunctions);
  }
  if (emitted) gatherFunctions(ast);
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      throw new Error(`Forbidden dynamic import in ${id}`);
    }
    if (emitted && ts.isIdentifier(node)) {
      if (HOST_IDENTIFIERS.has(node.text)) {
        const deferred = deferredFunction(node);
        if (id === ENTRY || !DORMANT_HOST_IDENTIFIERS.has(node.text) || !deferred) {
          throw new Error(`Forbidden executed host binding in ${id}: ${node.text}`);
        }
        deferredHostFunctions.add(functionName(deferred));
      }
      if (node.text === 'require') {
        const call = node.parent;
        if (!ts.isCallExpression(call) || call.expression !== node || call.arguments.length !== 1 ||
            !ts.isStringLiteral(call.arguments[0])) {
          throw new Error(`Forbidden dynamic runtime loader in ${id}`);
        }
        const specifier = call.arguments[0].text;
        dependencies.set(specifier, resolveImport(id, specifier));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (emitted) {
    // Namespace aliases retain import identity; value aliases retain possible
    // function identity. This is intentionally conservative: passing a host
    // function to a top-level call counts as a possible callback invocation.
    let namespaceChanged = true;
    while (namespaceChanged) {
      namespaceChanged = false;
      for (const [target, value] of valueAliases) {
        if (ts.isIdentifier(target) && ts.isIdentifier(value) && imports.has(value.text) && !imports.has(target.text)) {
          imports.set(target.text, imports.get(value.text));
          namespaceChanged = true;
        }
      }
    }
    const valueReferences = (node) => {
      const refs = new Set();
      function scan(current) {
        if (ts.isIdentifier(current)) refs.add(`${id}::${current.text}`);
        if (ts.isPropertyAccessExpression(current) && ts.isIdentifier(current.expression) && imports.has(current.expression.text)) {
          refs.add(`${imports.get(current.expression.text)}::${current.name.text}`);
        } else if (ts.isElementAccessExpression(current) && ts.isIdentifier(current.expression) &&
            imports.has(current.expression.text) && ts.isStringLiteral(current.argumentExpression)) {
          refs.add(`${imports.get(current.expression.text)}::${current.argumentExpression.text}`);
        }
        ts.forEachChild(current, scan);
      }
      scan(node);
      return refs;
    };
    const aliasGraph = new Map();
    const addEdges = (name, refs) => {
      const edges = aliasGraph.get(name) || new Set();
      for (const reference of refs) edges.add(reference);
      aliasGraph.set(name, edges);
    };
    for (const [target, value] of valueAliases) {
      const refs = valueReferences(value);
      if (ts.isIdentifier(target)) addEdges(`${id}::${target.text}`, refs);
      else if (ts.isPropertyAccessExpression(target) && ts.isIdentifier(target.expression)) {
        // Exports have named slots. Other objects conservatively retain all
        // possible function members so obj.run(), obj[key]() and .bind() work.
        addEdges(`${id}::${target.expression.text === 'exports' ? target.name.text : target.expression.text}`, refs);
      } else if (ts.isElementAccessExpression(target) && ts.isIdentifier(target.expression)) {
        addEdges(`${id}::${target.expression.text}`, refs);
      } else if (ts.isObjectBindingPattern(target)) {
        for (const element of target.elements) {
          if (!ts.isIdentifier(element.name)) continue;
          const name = element.propertyName || element.name;
          const elementRefs = new Set(refs);
          if (ts.isIdentifier(value) && imports.has(value.text) &&
              (ts.isIdentifier(name) || ts.isStringLiteral(name))) {
            elementRefs.add(`${imports.get(value.text)}::${name.text}`);
          }
          addEdges(`${id}::${element.name.text}`, elementRefs);
        }
      } else if (ts.isArrayBindingPattern(target)) {
        for (const element of target.elements) {
          if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) addEdges(`${id}::${element.name.text}`, refs);
        }
      }
    }
    const calledFunctions = (node, skipDeferred) => {
      const calls = new Set();
      function scan(current) {
        if (skipDeferred && ts.isFunctionLike(current) && functionName(current)) return;
        if (ts.isCallExpression(current)) {
          for (const reference of valueReferences(current.expression)) calls.add(reference);
          for (const argument of current.arguments) {
            for (const reference of valueReferences(argument)) calls.add(reference);
          }
          let target = current.expression;
          while (ts.isParenthesizedExpression(target) ||
              (ts.isBinaryExpression(target) && target.operatorToken.kind === ts.SyntaxKind.CommaToken)) {
            target = ts.isParenthesizedExpression(target) ? target.expression : target.right;
          }
          if (ts.isIdentifier(target)) calls.add(`${id}::${target.text}`);
          else if (ts.isPropertyAccessExpression(target) && ts.isIdentifier(target.expression) &&
              imports.has(target.expression.text)) {
            calls.add(`${imports.get(target.expression.text)}::${target.name.text}`);
          } else if (ts.isElementAccessExpression(target) && ts.isIdentifier(target.expression) &&
              imports.has(target.expression.text) && ts.isStringLiteral(target.argumentExpression)) {
            calls.add(`${imports.get(target.expression.text)}::${target.argumentExpression.text}`);
          }
        }
        ts.forEachChild(current, scan);
      }
      scan(node);
      return calls;
    };
    for (const [name, declarations] of functions) {
      for (const fn of declarations) {
        addEdges(`${id}::${name}`, calledFunctions(fn, false));
        // A function can return a callback or place it in an object without
        // calling it itself. Preserve identity across shadowed declarations.
        addEdges(`${id}::${name}`, valueReferences(fn));
      }
    }
    for (const [name, target] of exportAliases) addEdges(`${id}::${name}`, new Set([`${id}::${target}`]));
    return { dependencies, hostFunctions: [...deferredHostFunctions].map((name) => `${id}::${name}`),
      topLevelCalls: calledFunctions(ast, true),
      callGraph: aliasGraph };
  }
  return { dependencies };
}

function buildParserResources(root = ROOT) {
  const modules = new Map();
  function visit(id) {
    if (modules.has(id)) return;
    if (modules.size >= MAX_MODULES) throw new Error(`Pure parser module limit is ${MAX_MODULES}`);
    const file = pureModulePath(root, id);
    const source = fs.readFileSync(file, 'utf8');
    inspectSource(source, id);
    const compiled = ts.transpileModule(source, { fileName: file, compilerOptions, reportDiagnostics: true });
    const errors = (compiled.diagnostics || []).filter((item) => item.category === ts.DiagnosticCategory.Error);
    if (errors.length) throw new Error(`TypeScript emit failed for ${id}: ${ts.formatDiagnostics(errors, {
      getCanonicalFileName: (name) => name, getCurrentDirectory: () => root, getNewLine: () => '\n',
    })}`);
    // TypeScript's normal import erasure runs first. Only emitted runtime
    // imports enter the closure; type-only RN/Node types cannot drag in code.
    const inspection = inspectSource(compiled.outputText, id, true);
    modules.set(id, { source, compiled: compiled.outputText, ...inspection });
    for (const dependency of inspection.dependencies.values()) visit(dependency);
  }
  visit(ENTRY);
  // Propagate calls across the complete source closure, including import and
  // export aliases. A dormant async FX helper also must not be invoked while
  // factories are admitted: an unhandled promise is not an admission gate.
  const hostFunctions = new Set([...modules.values()].flatMap((module) => module.hostFunctions));
  const callGraph = new Map([...modules.values()].flatMap((module) => [...module.callGraph]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, calls] of callGraph) {
      if (!hostFunctions.has(name) && [...calls].some((called) => hostFunctions.has(called))) {
        hostFunctions.add(name);
        changed = true;
      }
    }
  }
  for (const [id, module] of modules) {
    if ([...module.topLevelCalls].some((called) => hostFunctions.has(called))) {
      throw new Error(`Forbidden top-level call to a dormant host function during ${id} admission`);
    }
  }
  const ordered = [...modules.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const sourceHash = sha256(JSON.stringify({
    v: 1, entry: ENTRY, compilerVersion: ts.version, compilerOptions,
    generatorSha256: sha256(fs.readFileSync(__filename)),
    sources: ordered.map(([id, module]) => [`src/lib/${id}.ts`, module.source]),
  }));
  const factories = ordered.map(([id, module]) =>
    `${JSON.stringify(id)}:function(module,exports,require){\n${module.compiled}}`).join(',\n');
  const mappings = Object.fromEntries(ordered.map(([id, module]) => [id, Object.fromEntries(module.dependencies)]));
  const loader = `const factories={\n${factories}\n};\nconst mappings=${JSON.stringify(mappings)};\n` +
    `const cache=Object.create(null);\nfunction load(id){\n` +
    `if(Object.prototype.hasOwnProperty.call(cache,id))return cache[id].exports;\n` +
    `if(!Object.prototype.hasOwnProperty.call(factories,id))throw new Error('Unknown bundled module');\n` +
    `const module={exports:{}};cache[id]=module;\n` +
    `factories[id](module,module.exports,function(specifier){\n` +
    `if(!Object.prototype.hasOwnProperty.call(mappings[id],specifier))throw new Error('External dependency refused');\n` +
    `return load(mappings[id][specifier]);});return module.exports;\n}\n`;
  const bundle = `// Generated from normal shipping TypeScript. Source SHA-256: ${sourceHash}\n` +
    `(function(){'use strict';\n${loader}` +
    `const parse=load(${JSON.stringify(ENTRY)}).parseIosBackgroundAlert;\n` +
    `if(typeof parse!=='function')throw new Error('Parser adapter export missing');\n` +
    `globalThis.wafraNativeAlertParse=function(inputJson){return JSON.stringify(parse(JSON.parse(inputJson)));};\n})();\n`;
  if (Buffer.byteLength(bundle, 'utf8') > MAX_BUNDLE_BYTES) throw new Error('Native parser bundle limit is 2 MiB');
  // Validate all entry factories, not only the metadata modules, with the same
  // absence of host bindings as the shipping JavaScriptCore runtime.
  vm.runInNewContext(bundle, {}, { timeout: 2000 });
  // Read metadata from the compiled shipping modules in a context with no
  // Node/native bindings. This does not run an alert or rewrite parser logic.
  const values = vm.runInNewContext(`(function(){'use strict';${loader}
return {parserVersion:load('sms-parser').PARSER_VERSION,
currencies:load('currency-metadata').CURRENCY_MINOR_UNITS,countries:load('country').COUNTRY_CODES};})()`, {}, { timeout: 2000 });
  if (!Number.isSafeInteger(values.parserVersion) || values.parserVersion < 1) throw new Error('Invalid parser version');
  const currencies = {};
  for (const code of Object.keys(values.currencies).sort()) {
    const exponent = values.currencies[code];
    if (!/^[A-Z]{3}$/.test(code)) throw new Error('Invalid currency metadata');
    if ([0, 2, 3].includes(exponent)) currencies[code] = exponent;
  }
  const countries = [...values.countries, 'ZZ'].sort();
  if (!countries.length || countries.some((code) => !/^[A-Z]{2}$/.test(code)) ||
      new Set(countries).size !== countries.length) throw new Error('Invalid country metadata');
  const metadata = { v: 1, parserVersion: values.parserVersion, sourceHash,
    bundleSha256: sha256(bundle), moduleCount: modules.size, currencies, countries };
  const foregroundSource = '// Generated by scripts/generate-ios-background-parser.cjs. Do not edit.\n' +
    `export const IOS_BACKGROUND_PARSER_SOURCE_HASH = '${sourceHash}';\n`;
  return { bundle, metadata, foregroundSource, moduleIds: ordered.map(([id]) => id) };
}

function generateParserResources(root = ROOT, { check = false } = {}) {
  const resources = buildParserResources(root);
  const contents = { bundle: resources.bundle, metadata: `${JSON.stringify(resources.metadata, null, 2)}\n`,
    foregroundSource: resources.foregroundSource };
  if (check) {
    const stale = Object.entries(OUTPUTS).filter(([key, relative]) => {
      const file = path.join(root, relative);
      return !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== contents[key];
    }).map(([, relative]) => relative);
    if (stale.length) throw new Error(`Native parser resources are stale: ${stale.join(', ')}. Run node scripts/generate-ios-background-parser.cjs and build a matching native runtime.`);
  } else {
    for (const [key, relative] of Object.entries(OUTPUTS)) {
      const file = path.join(root, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, contents[key], 'utf8');
    }
  }
  return resources;
}

function verifyResourceDirectory(directory, root = ROOT) {
  const expected = generateParserResources(root, { check: true });
  const actualBundle = fs.readFileSync(path.join(directory, path.basename(OUTPUTS.bundle)));
  const actualMetadata = fs.readFileSync(path.join(directory, path.basename(OUTPUTS.metadata)), 'utf8');
  if (!actualBundle.equals(Buffer.from(expected.bundle, 'utf8')) ||
      actualMetadata !== `${JSON.stringify(expected.metadata, null, 2)}\n` ||
      sha256(actualBundle) !== expected.metadata.bundleSha256) {
    throw new Error('Packaged native parser resource/hash/version differs from the exact source');
  }
  return expected.metadata;
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 2 && args[0] === '--verify-resource-directory') {
      const meta = verifyResourceDirectory(path.resolve(args[1]));
      console.log(`Packaged native parser verified: version ${meta.parserVersion}, source ${meta.sourceHash}, bundle ${meta.bundleSha256}.`);
    } else {
      if (args.length && !(args.length === 1 && args[0] === '--check')) throw new Error('Usage: generate-ios-background-parser.cjs [--check | --verify-resource-directory DIRECTORY]');
      const result = generateParserResources(ROOT, { check: args[0] === '--check' });
      console.log(`Native parser ${args[0] === '--check' ? 'fresh' : 'generated'}: ${result.metadata.moduleCount} modules, ${Buffer.byteLength(result.bundle)} bytes, source ${result.metadata.sourceHash}.`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { buildParserResources, generateParserResources, verifyResourceDirectory };
