'use strict';
// CI-only tracer (side branches, never merged). Loaded with NODE_OPTIONS=--require, it records every exported call
// of parseSms and interpretBankAlert made by the test suites, as body + sender -> the set of result shapes. It writes
// one file per process into $WAFRA_PARSE_TRACE_DIR. Synthetic test bodies only; it changes no result.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const dir = process.env.WAFRA_PARSE_TRACE_DIR;
if (dir) {
  const seen = new Map();
  const record = (fn, body, sender, shape) => {
    if (typeof body !== 'string') return;
    const key = JSON.stringify([fn, body, sender || '']);
    if (!seen.has(key)) seen.set(key, new Set());
    seen.get(key).add(shape);
  };
  const txShape = (p) => (p ? `${p.kind === 'transaction' || p.kind === undefined ? p.type : p.kind} ${p.amountFils ?? ''} ${p.currency ?? ''}`.trim() : 'none');
  const wrapParse = (f) => function tracedParseSms(body, overrides, opts) {
    const result = f.apply(this, arguments);
    try { record('parseSms', body, opts?.sender, txShape(result)); } catch {}
    return result;
  };
  const wrapInterpret = (f) => function tracedInterpretBankAlert(input) {
    const result = f.apply(this, arguments);
    try {
      const shape = result?.outcome === 'parsed' ? `parsed ${txShape(result.parsed)}`
        : result?.outcome === 'review' ? `review ${result.meaning ?? ''}` : `${result?.outcome ?? 'none'} ${result?.reason ?? ''}`;
      record('interpretBankAlert', input?.source, input?.sender, shape.trim());
    } catch {}
    return result;
  };
  const patch = (exports) => {
    if (!exports || exports.__wafraTraced) return exports;
    for (const [name, wrap] of [['parseSms', wrapParse], ['interpretBankAlert', wrapInterpret]]) {
      const d = Object.getOwnPropertyDescriptor(exports, name);
      if (!d) continue;
      const original = d.get ? d.get.call(exports) : d.value;
      if (typeof original !== 'function') continue;
      try { Object.defineProperty(exports, name, { value: wrap(original), writable: true, enumerable: true, configurable: true }); } catch {}
    }
    try { Object.defineProperty(exports, '__wafraTraced', { value: true }); } catch {}
    return exports;
  };
  const TARGET = /[\\/](?:sms-parser|bank-alert-interpreter)\.(?:js|cjs|ts)$/;
  // Compiled suites (scripts/test/build) load the modules through require.
  const load = Module._load;
  let tsWrapper = null;
  Module._load = function tracedLoad(request, parent, isMain) {
    const exports = load.apply(this, arguments);
    if (request === 'typescript' && exports) {
      // TypeScript's exports are getters; hand out a wrapper whose prototype is the real module instead.
      if (!tsWrapper || tsWrapper.real !== exports) {
        const transpile = exports.transpileModule;
        const wrapped = Object.create(exports, { transpileModule: { value: function tracedTranspile(source, options) {
          const out = transpile.apply(exports, arguments);
          // The in-memory loader (scripts/universal-test/load-ts.cjs) transpiles src/lib/*.ts itself: append the patch.
          if (options?.fileName && TARGET.test(options.fileName)) {
            out.outputText += `\n;require(${JSON.stringify(__filename)}).__patch(module.exports);\n`;
          }
          return out;
        } } });
        tsWrapper = { real: exports, wrapped };
      }
      return tsWrapper.wrapped;
    }
    try {
      const file = Module._resolveFilename(request, parent, isMain);
      if (TARGET.test(file)) patch(exports);
    } catch {}
    return exports;
  };
  module.exports.__patch = patch;
  process.on('exit', () => {
    if (!seen.size) return;
    fs.mkdirSync(dir, { recursive: true });
    const lines = [...seen].map(([key, shapes]) => JSON.stringify([...JSON.parse(key), [...shapes].sort()]));
    fs.writeFileSync(path.join(dir, `trace-${process.pid}-${Date.now()}.jsonl`), lines.join('\n') + '\n');
  });
} else {
  module.exports.__patch = (exports) => exports;
}
