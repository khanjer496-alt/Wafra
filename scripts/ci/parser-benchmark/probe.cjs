#!/usr/bin/env node
'use strict';
/**
 * CI-only probe for two recognition differences seen in the paired benchmark:
 *  (a) "Your refund request has been received. Refund of AED X from M has been
 *      credited to your card ending N." refused by newer parsers for some M;
 *  (b) "Card ending N was used for FCY F at M on D. Amount charged AED A."
 *      recognised by build 190 but not by the RC parsers for some rows.
 * It records, per message and per source tree, the result of
 *   parseSms(text)                           (what the CI gate and benchmark call)
 *   parseSms(text, {}, {sender, observedAt}) (closer to production capture)
 *   nonPostingReason(text)
 * Nothing here ships and nothing touches runtime code.
 *
 *   probe.cjs --root DIR --label NAME --corpus FILE --out FILE
 */
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1];
  return args;
}

function loadParser(root) {
  const ts = require(path.join(process.cwd(), 'node_modules', 'typescript'));
  const Module = require('module');
  const libDir = path.join(root, 'src', 'lib');
  const stub = path.join(__dirname, 'empty-module.cjs');
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function resolve(request, parent, isMain, options) {
    if (request === '@/components/ui/icon.types') return stub;
    if (request.startsWith('@/lib/')) request = path.join(libDir, request.slice('@/lib/'.length));
    return originalResolve.call(this, request, parent, isMain, options);
  };
  require.extensions['.ts'] = function compileTs(module, filename) {
    const out = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename, reportDiagnostics: false,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
    });
    module._compile(out.outputText, filename);
  };
  return require(path.join(libDir, 'sms-parser.ts'));
}

const summarize = (parsed) => (parsed
  ? { kind: parsed.kind, type: parsed.type, amountFils: parsed.amountFils, currency: parsed.currency, merchant: parsed.merchant }
  : null);

function variants() {
  const out = [];
  const refund = (merchant) => `Your refund request has been received. Refund of AED 100.00 from ${merchant} has been credited to your card ending 1234.`;
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let n = 3; n <= 26; n++) out.push({ group: 'refund-merchant-length-word', key: String(n), text: refund(letters.slice(0, n)) });
  for (let n = 3; n <= 22; n++) out.push({ group: 'refund-merchant-length-spaced', key: String(n), text: refund(`AL ${letters.slice(0, n - 3)}`) });
  out.push({ group: 'refund-known', key: 'IKEA', text: refund('IKEA') });
  out.push({ group: 'refund-known', key: 'GOLDEN SANDS RESTAURANT', text: refund('GOLDEN SANDS RESTAURANT') });
  out.push({ group: 'refund-known', key: 'no-ack-sentence', text: 'Refund of AED 100.00 from GOLDEN SANDS RESTAURANT has been credited to your card ending 1234.' });
  // Arabic refund acknowledgement followed by a completed credit: is the result merchant-length dependent?
  const arMerchants = { 5: 'نون اي', 12: 'مطعم الشام ال', 30: 'مطعم الشام للمأكولات والمشروبات', 60: 'مطعم الشام للمأكولات والمشروبات الشرقية والغربية في دبي مول فرع' };
  for (const [n, merchant] of Object.entries(arMerchants)) {
    out.push({ group: 'ar-refund-ack-completed', key: `${n} (${merchant.length} chars)`, text: `تم استلام طلب استرداد مبلغ 100.00 درهم من ${merchant}. تم استرداد المبلغ إلى بطاقتك المنتهية بـ 1234.` });
    out.push({ group: 'ar-refund-ack-pending', key: `${n} (${merchant.length} chars)`, text: `تم استلام طلب استرداد مبلغ 100.00 درهم من ${merchant}. سيتم استرداد المبلغ إلى بطاقتك خلال 5 أيام عمل.` });
    out.push({ group: 'ar-refund-completed-amount', key: `${n} (${merchant.length} chars)`, text: `تم استرداد مبلغ 100.00 درهم إلى بطاقتك المنتهية بـ 1234 من ${merchant}.` });
  }
  const fx = (cur, f, a) => `Card ending 1234 was used for ${cur} ${f} at ORBIT BOOKSTORE on 19/10/2026. Amount charged AED ${a}.`;
  for (const [cur, f, plausible, implausible] of [['SAR', '350.70', '343.69', '29.72'], ['USD', '100', '367.30', '36.73'],
    ['EUR', '100', '400.00', '40.00'], ['INR', '530', '23.32', '235.97'], ['GBP', '100', '470.00', '47.00'], ['KWD', '10', '119.50', '11.95']]) {
    out.push({ group: 'fx-plausible', key: `${cur} ${f} -> AED ${plausible}`, text: fx(cur, f, plausible) });
    out.push({ group: 'fx-implausible', key: `${cur} ${f} -> AED ${implausible}`, text: fx(cur, f, implausible) });
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const parser = loadParser(path.resolve(args.root));
  const observedAt = Date.parse('2026-11-05T10:00:00Z');
  const rows = fs.readFileSync(args.corpus, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const items = [];
  rows.forEach((row) => {
    if (row.shape === 'refund' && row.text.startsWith('Your refund request')) items.push({ group: 'corpus-refund-ack', key: String(row.id), text: row.text });
    if (row.shape === 'foreign-currency-purchase' && row.text.includes('Amount charged')) items.push({ group: 'corpus-foreign-charged', key: String(row.id), text: row.text });
  });
  items.push(...variants());
  const results = items.map((item) => {
    const entry = { ...item };
    try { entry.plain = summarize(parser.parseSms(item.text)); } catch (error) { entry.plainError = String(error && error.message || error); }
    try { entry.context = summarize(parser.parseSms(item.text, {}, { sender: 'ENBD', observedAt })); } catch (error) { entry.contextError = String(error && error.message || error); }
    try { entry.nonPosting = typeof parser.nonPostingReason === 'function' ? parser.nonPostingReason(item.text) : 'n/a'; } catch (error) { entry.nonPostingError = String(error && error.message || error); }
    return entry;
  });
  fs.writeFileSync(args.out, JSON.stringify({ label: args.label, root: args.root, count: results.length, results }));
}

main();
