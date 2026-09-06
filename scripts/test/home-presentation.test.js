const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Execute the production presentation policies without loading a native UI or
// sharing the integration suite's build directory.
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

const groupPayments = productionFunction('src/screens/ledger-home-screen.tsx', 'homePaymentGroups');
const chargePresentation = productionFunction('src/app/(tabs)/bills.tsx', 'recurringChargePresentation');
const routes = [];
const jsx = (type, props) => ({ type, props });
const Hero = productionFunction('src/screens/ledger-home-screen.tsx', 'Hero', {
  require: (name) => {
    assert.equal(name, 'react/jsx-runtime');
    return { jsx, jsxs: jsx };
  },
  View: 'view', ThemedText: 'text', SpringPressable: 'button',
  Money: 'money', PeriodPill: 'period-control',
  useTheme: () => ({}), Spacing: { three: 12 }, StyleSheet: { hairlineWidth: 1 },
  styles: new Proxy({}, { get: () => ({}) }),
  useRouter: () => ({ push: (route) => routes.push(route) }),
  useLargeTextLayout: () => false,
  t: (key) => key, tapped: () => {},
  ledgerCurrencyDisplay: () => 'AED',
  formatAED: (amount) => `AED ${amount}`,
  formatAmount: (amount) => String(amount),
});
function elements(node, type) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap((child) => elements(child, type));
  return [...(node.type === type ? [node] : []), ...elements(node.props?.children, type)];
}
const changePeriod = () => {};
for (const incomeFils of [0, 20_000]) {
  const tree = Hero({ incomeFils, expenseFils: 5_500, netFils: incomeFils - 5_500,
    comparison: null, active: true, onChangePeriod: changePeriod });
  assert.equal(elements(tree, 'money')[0].props.fils, 5_500,
    'recorded spending remains the headline even when income is missing');
  assert.equal(elements(tree, 'period-control')[0].props.onPress, changePeriod);
  const actions = elements(tree, 'button');
  actions.find((item) => item.props.accessibilityLabel.startsWith('totalOut')).props.onPress();
  actions.find((item) => item.props.accessibilityLabel.startsWith('inLabel')).props.onPress();
}
assert.deepEqual(routes, ['/transactions?type=expense', '/transactions?type=income',
  '/transactions?type=expense', '/transactions?type=income']);
const payment = (id, kind, daysLeft, amountFils) => Object.freeze({
  id, kind, daysLeft, amountFils, title: id, icon: 'wallet',
  dateISO: '2026-09-08', stale: false,
  overdue: daysLeft < 0, urgent: daysLeft >= 0 && daysLeft <= 3,
});
const overdue = payment('statement-overdue', 'card', -2, 552_200);
const dueReminder = payment('saved-reminder', 'bill', 2, 38_900);
const future = payment('future-statement', 'card', 9, 120_000);
const forecast = payment('predicted-charge', 'subscription', 1, 120_000);
const overdueForecast = payment('missed-prediction', 'subscription', -5, 999_999_900);
const input = Object.freeze([overdueForecast, overdue, forecast, dueReminder, future]);
const result = groupPayments(input);

assert.deepEqual(Array.from(result.due, (item) => item.id), ['statement-overdue', 'saved-reminder']);
assert.deepEqual(Array.from(result.upcoming, (item) => item.id), ['future-statement']);
assert.equal(result.due[0], overdue, 'statement amount and source evidence are preserved');
assert.equal(result.due[1], dueReminder, 'saved reminders remain actionable');
assert.equal(result.upcoming[0].amountFils, 120_000, 'presentation must not recompute money');
assert.equal(input.length, 5, 'grouping must not mutate the source timeline');
assert.equal(groupPayments([]).due.length, 0);
assert.equal(groupPayments([forecast, overdueForecast]).upcoming.length, 0,
  'predictions must not become confirmed Home obligations or overdue warnings');

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

console.log('✓ Home obligation priority and recurring charge presentation');
