'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../../../src/app/(tabs)/bills.tsx');
const source = fs.readFileSync(filename, 'utf8');
const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function action(name, context = {}) {
  let declaration;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) declaration = node;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(declaration, `shipping action ${name} exists`);
  const js = ts.transpileModule(`const ${declaration.getText(ast)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return Function(...Object.keys(context), `${js}; return ${name};`)(...Object.values(context));
}

test('tracking a subscription saves its latest visible amount, not the historical average', () => {
  const sub = { title: 'ChatGPT', category: 'software', avgAmountFils: 32150,
    lastAmountFils: 8900, nextExpectedISO: '2026-11-01', cadence: 'monthly' };
  assert.equal(action('billFromSubscription')(sub).amountFils, 8900);
});

test('mark-paid confirmation and expense use the selected occurrence projection', () => {
  const saved = { id: 'plan', title: 'ChatGPT', category: 'software', amountFils: 39900 };
  const state = { bills: [saved], transactions: [], accounts: [{ id: 'bank' }] };
  const now = new Date(2026, 10, 1), liveAccounts = new Set(['bank']), internal = new Set();
  let confirmation, marked, selected;
  const onPay = action('onPay', {
    state, now, liveAccounts, internal, todayISO: '2026-11-01',
    billForAgendaOccurrence: (bills, transactions, selection, at, live, transfers) => {
      assert.equal(bills, state.bills); assert.equal(transactions, state.transactions);
      assert.equal(at, now); assert.equal(live, liveAccounts); assert.equal(transfers, internal);
      selected = selection;
      return { bill: { ...saved, amountFils: 8900 }, status: 'due-soon', dueISO: selection.dueISO };
    },
    setConfirmation: value => { confirmation = value; },
    tf: (key, values) => ({ key, ...values }), t: key => key,
    formatAED: amount => amount, monthKey: date => date.slice(0, 7),
    markBillPaid: (...args) => { marked = args; },
  });
  onPay('plan', '2026-11-01');
  assert.deepEqual(selected, { id: 'plan', dueISO: '2026-11-01' });
  assert.equal(confirmation.body.amount, 8900);
  confirmation.onConfirm();
  assert.equal(marked[1], '2026-11');
  assert.equal(marked[2].amountFils, 8900);
  assert.equal(saved.amountFils, 39900);
});

test('paid or missing selected occurrences cannot open a manual-payment confirmation', () => {
  for (const row of [null, { bill: { id: 'plan', amountFils: 8900 }, status: 'paid' }]) {
    let confirmations = 0;
    action('onPay', {
      state: { bills: [{ id: 'plan' }], transactions: [], accounts: [{ id: 'bank' }] },
      now: new Date(2026, 10, 1), liveAccounts: new Set(['bank']), internal: new Set(),
      billForAgendaOccurrence: () => row, setConfirmation: () => { confirmations++; },
      tf: () => '', t: () => '', formatAED: String,
    })('plan', '2026-11-01');
    assert.equal(confirmations, 0);
  }
});
