'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const api = import('../../build-ios-apple-pay-shortcut.mjs');
const setupId = 'app.wafra.ios.RecordWafraApplePaySetupProofIntent';
const captureId = 'app.wafra.ios.CaptureWafraApplePayIntent';

// Model only graph control flow and Apple's metadata-backed properties.
// A real Transaction trigger passing its object through Run Shortcut remains
// a physical-device test; this interpreter cannot qualify that handoff.
function trace(graph, input) {
  const effects = []; let active = true;
  const read = token => {
    assert.equal(token.WFSerializationType, 'WFTextTokenString');
    assert.equal(token.Value.string, '\ufffc');
    assert.deepEqual(Object.keys(token.Value.attachmentsByRange), ['{0, 1}']);
    const value = token.Value.attachmentsByRange['{0, 1}'];
    assert.equal(value.Type, 'ExtensionInput');
    assert.deepEqual(value.Aggrandizements[0], {
      Type: 'WFCoercionVariableAggrandizement', CoercionItemClass: 'WFWalletTransactionContentItem',
    });
    assert.equal(value.Aggrandizements.length, 2, 'no string/number conversion of the currency amount');
    const property = value.Aggrandizements[1];
    assert.equal(property.Type, 'WFPropertyVariableAggrandizement');
    if (input?.kind !== 'wallet-transaction') throw new Error('cannot coerce input to Wallet Transaction');
    return property.PropertyName === 'Amount' ? input.amount
      : property.PropertyName === 'Merchant' ? input.merchant : assert.fail('unapproved property');
  };
  for (const action of graph.WFWorkflowActions) {
    const p = action.WFWorkflowActionParameters, id = action.WFWorkflowActionIdentifier;
    if (id === 'is.workflow.actions.conditional') {
      if (p.WFControlFlowMode === 2) { active = true; continue; }
      assert.equal(p.WFCondition, 101);
      assert.deepEqual(p.WFInput, { Type: 'Variable', Variable: {
        Value: { Type: 'ExtensionInput' }, WFSerializationType: 'WFTextTokenAttachment',
      } });
      active = input == null || input === '' || (Array.isArray(input) && input.length === 0);
    } else if (active) {
      if (id === setupId) {
        assert.deepEqual(Object.keys(p).sort(), ['AppIntentDescriptor', 'UUID']);
        effects.push({ action: 'setup-proof' });
      } else if (id === captureId) effects.push({ action: 'capture', amount: read(p.amount), merchant: read(p.merchant) });
      else if (id === 'is.workflow.actions.exit') { effects.push({ action: 'stop' }); break; }
      else assert.fail(`unapproved action ${id}`);
    }
  }
  return effects;
}

test('manual no-input checks record proof without money or a Wallet lookup', async () => {
  const a = await api, graph = a.buildApplePayShortcut();
  for (const empty of [undefined, null, '', []]) assert.deepEqual(trace(graph, empty),
    [{ action: 'setup-proof' }, { action: 'stop' }]);
});

test('Wallet amount is passed as a typed currency object without decimal conversion or locale-dependent type labels', async () => {
  const a = await api, graph = a.buildApplePayShortcut();
  for (const [merchant, currency, decimal] of [
    ['Shop', 'USD', '10.50'], ['متجر', 'KWD', '0.001'], ['Café', 'JPY', '1250'],
  ]) {
    const amount = { currencyCode: currency, decimal };
    const effects = trace(graph, { kind: 'wallet-transaction', amount, merchant });
    assert.deepEqual(effects, [{ action: 'capture', amount, merchant }, { action: 'stop' }]);
    assert.equal(effects[0].amount, amount, 'preserve the typed object, not a formatted/stringified monetary value');
  }
  assert.doesNotMatch(JSON.stringify(graph), /getitemtype|WFConditionalActionString|formatnumber|calculate|WFNumberContentItem|WFStringContentItem/);
});

test('missing amount or merchant remains absent and foreign input is not treated as a transaction', async () => {
  const a = await api, graph = a.buildApplePayShortcut();
  assert.deepEqual(trace(graph, { kind: 'wallet-transaction' }),
    [{ action: 'capture', amount: undefined, merchant: undefined }, { action: 'stop' }]);
  for (const input of ['10 USD', { amount: 10 }, 'WAFRA_SETUP_CHECK_V1'])
    assert.throws(() => trace(graph, input), /cannot coerce/);
});

test('metadata pins exact native intents and allowed properties without card, date, status or financial identifiers', async () => {
  const a = await api, graph = a.buildApplePayShortcut();
  assert.equal(a.IOS_APPLE_PAY_SHORTCUT_NAME, 'Wafra Apple Pay v1');
  assert.equal(graph.WFWorkflowName, a.IOS_APPLE_PAY_SHORTCUT_NAME);
  assert.equal(graph.WFWorkflowActions.length, 6);
  assert.equal(a.verifyApplePayShortcutGraph(graph), true);
  assert.deepEqual(graph.WFWorkflowInputContentItemClasses, ['WFWalletTransactionContentItem']);
  assert.equal(graph.WFWorkflowHasOutputFallback, false);
  assert.deepEqual(graph.WFWorkflowOutputContentItemClasses, []);
  assert.deepEqual(graph.WFWorkflowImportQuestions, []);
  assert.deepEqual(graph.WFWorkflowTypes, ['WFWorkflowTypeShowInSearch']);
  const ids = graph.WFWorkflowActions.map(a => a.WFWorkflowActionParameters.UUID);
  assert.equal(new Set(ids).size, ids.length);
  const branch = graph.WFWorkflowActions.filter(a => a.WFWorkflowActionIdentifier === 'is.workflow.actions.conditional');
  assert.equal(branch.length, 2);
  assert.equal(branch[0].WFWorkflowActionParameters.GroupingIdentifier, branch[1].WFWorkflowActionParameters.GroupingIdentifier);
  assert.deepEqual(branch.map(a => a.WFWorkflowActionParameters.WFControlFlowMode), [0, 2]);
  for (const [index, name] of [[1, 'RecordWafraApplePaySetupProofIntent'], [4, 'CaptureWafraApplePayIntent']]) {
    assert.deepEqual(graph.WFWorkflowActions[index].WFWorkflowActionParameters.AppIntentDescriptor, {
      TeamIdentifier: 'UV7YN4GQ66', BundleIdentifier: 'app.wafra.ios', Name: 'Wafra', AppIntentIdentifier: name,
    });
  }
  assert.deepEqual(Object.keys(graph.WFWorkflowActions[4].WFWorkflowActionParameters).sort(), ['AppIntentDescriptor', 'UUID', 'amount', 'merchant']);
  const json = JSON.stringify(graph);
  assert.doesNotMatch(json, /https?:|downloadurl|clipboard|savefile|sendmessage|sendemail|notification|MobileSMS|WalletTransactionTrigger|Card or Pass|Currency Code|Currency Amount|"PropertyName":"(?:Date|Status|Identifier)"/i);
});

test('verification rejects altered native targets, scalar bindings, control flow and hidden external actions', async () => {
  const a = await api;
  for (const mutate of [
    graph => { graph.WFWorkflowActions[1].WFWorkflowActionIdentifier = captureId; },
    graph => { graph.WFWorkflowActions[4].WFWorkflowActionParameters.amount = '0'; },
    graph => { graph.WFWorkflowActions[4].WFWorkflowActionParameters.AppIntentDescriptor.BundleIdentifier = 'other.app'; },
    graph => { graph.WFWorkflowActions[0].WFWorkflowActionParameters.WFCondition = 100; },
    graph => { graph.WFWorkflowActions.push({ WFWorkflowActionIdentifier: 'is.workflow.actions.openurl', WFWorkflowActionParameters: { WFURLActionURL: 'https://example.com' } }); },
  ]) {
    const graph = a.buildApplePayShortcut(); mutate(graph);
    assert.throws(() => a.verifyApplePayShortcutGraph(graph));
  }
  for (const input of [null, [], {}, { WFWorkflowActions: [] }]) assert.throws(() => a.verifyApplePayShortcutGraph(input));
});
