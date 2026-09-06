'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

/** Execute actual checked-in source; stubs are explicit native/UI boundaries. */
module.exports = function loadTypescript(file, dependencies = {}, globals = {}) {
  const source = fs.readFileSync(file, 'utf8');
  const result = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
      isolatedModules: true,
    },
    reportDiagnostics: true,
  });
  const errors = (result.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
    getCanonicalFileName: (name) => name,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => '\n',
  }));
  const exports = {};
  const module = { exports };
  vm.runInNewContext(result.outputText, {
    exports, module,
    require: (name) => {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error(`Unstubbed runtime dependency ${name} in ${file}`);
    },
    console, setTimeout, clearTimeout, Date, Set, Map, Number, Math, Promise,
    ...globals,
  }, { filename: file });
  return module.exports;
};
