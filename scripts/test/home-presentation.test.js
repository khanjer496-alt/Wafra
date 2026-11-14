const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Execute the production presentation policy without loading a native UI or
// sharing the integration suite's build directory. (The Home hero and obligation grouping this file
// used to cover lived only in the retired ledger-home-screen and were removed with it.)
function productionFunction(relativePath, name, globals = {}) {
  const file = path.join(__dirname, '../..', relativePath);
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = source.statements.find((node) =>
    ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `${name} must remain a production function`);
  const output = ts.transpileModule(declaration.getText(source), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(`${output}\nexports.${name} = ${name};`, { exports, ...globals });
  return exports[name];
}

const chargePresentation = productionFunction('src/app/(tabs)/bills.tsx', 'recurringChargePresentation');
for (const [cadence, lastAmountFils, monthlyEquivalentFils] of [
  ['yearly', 120_000, 10_000],
  ['weekly', 5_000, 21_726],
  ['monthly', 9_900, 8_000],
]) {
  const shown = chargePresentation({ cadence, lastAmountFils, monthlyEquivalentFils,
    status: 'active', paymentHistory: false });
  assert.equal(shown.amountFils, lastAmountFils,
    `${cadence}: the charge must not be replaced by a monthly average`);
  assert.equal(shown.estimated, true, 'a predicted charge is explicitly an estimate');
}
for (const fields of [{ status: 'stopped' }, { paymentHistory: true }, { cadence: 'as-needed' }]) {
  const shown = chargePresentation({ cadence: 'monthly', status: 'active',
    paymentHistory: false, lastAmountFils: 12_345, ...fields });
  assert.equal(shown.estimated, false, 'past or unscheduled payments must not claim a next charge');
  assert.equal(shown.amountFils, 12_345);
}

console.log('✓ recurring charge presentation');
