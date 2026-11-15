'use strict';
// Diagnostic observer only: compiled shipping functions keep their return path.
const fs = require('node:fs'), Module = require('node:module'), path = require('node:path');
const root = process.cwd(), frames = [];
const original = Module.prototype._compile;
const selected = /QA MART/iu;
globalThis.__wafraPrincipalDiagnostic = (context, parsed) => {
  if (!selected.test(context.raw)) return;
  try {
    const fpg = require(path.join(root, 'scripts/test/build/principal-posting-guards.js'));
    frames.push({ context, parsed, detail: fpg.__principalDetail(context.raw, context.spans[0]) });
  } catch (error) { frames.push({ context, diagnosticError: String(error.stack || error) }); }
};
Module.prototype._compile = function(code, file) {
  if (file.endsWith('/scripts/test/build/sms-parser.js')) {
    const entry = 'function hasUnsettledPrincipalInContext(context, parsed) {';
    if (code.split(entry).length !== 2) throw Error('unexpected guard observer anchor');
    code = code.replace(entry, entry + '\n globalThis.__wafraPrincipalDiagnostic(context, parsed);');
  }
  if (file.endsWith('/scripts/test/build/principal-posting-guards.js')) {
    const start = code.indexOf('function closedNominalReceipt('), end = code.indexOf('function completedPredicate(', start);
    if (start < 0 || end < 0) throw Error('unexpected receipt observer anchor');
    const rawBody = code.slice(start, end);
    const declaration = rawBody.indexOf('let rest = ');
    if (declaration < 0) throw Error('missing receipt state declaration');
    const body = rawBody.slice(0, declaration) + rawBody.slice(declaration).replaceAll('closed: false, complete: false', 'closed: false, complete: false, remaining: rest');
    code = code.slice(0, start) + body + code.slice(end);
    code += `\nexports.__principalDetail = function(source, span) {
      const clause=principalClause(source,span);if(!clause)return {missingSpan:true};
      const lead=source.slice(clause.start,span.start),tail=source.slice(span.end,clause.end),clean=withoutPriceAnnotations(tail),next=firstStatedPrice(clean),owned=clean.slice(0,next===null?clean.length:next);
      return {lead,tail,owned,next,receipt:closedNominalReceipt(lead,owned,next!==null),incomplete:isIncompletePrincipal(source,span,true),complete:isCompletedExpensePrincipal(source,span)};
    };`;
  }
  return original.call(this, code, file);
};
process.on('exit', () => fs.writeFileSync('principal-diagnostics.json', JSON.stringify({ diagnosticOnly: true, fileBytesUnchanged: true, frames }, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2)));
