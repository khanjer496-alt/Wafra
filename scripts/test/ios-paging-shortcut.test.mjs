import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPagedHistoryShortcut, verifyPagedHistoryShortcut } from '../build-ios-paged-history-shortcut.mjs';
import { buildQueryProbe } from '../build-ios-history-query-probe.mjs';

test('Get Dates from Input uses a variable-picker attachment while Format Date keeps its date-field token', () => {
  const actions = buildPagedHistoryShortcut().WFWorkflowActions;
  const detect = actions.find(action => action.WFWorkflowActionIdentifier === 'is.workflow.actions.detect.date');
  assert.ok(detect);
  const input = detect.WFWorkflowActionParameters.WFInput;
  assert.equal(input.WFSerializationType, 'WFTextTokenAttachment',
    'Apple WFVariablePickerParameter discards scalar text tokens during parameter deserialization');
  assert.equal(input.Value.Type, 'ActionOutput');
  const source = actions.find(action => action.WFWorkflowActionParameters.UUID === input.Value.OutputUUID);
  assert.equal(source?.WFWorkflowActionIdentifier, 'is.workflow.actions.getvalueforkey');
  assert.equal(source.WFWorkflowActionParameters.WFDictionaryKey, 'before');
  for (const action of actions.filter(action => action.WFWorkflowActionIdentifier === 'is.workflow.actions.format.date')) {
    assert.equal(action.WFWorkflowActionParameters.WFDate.WFSerializationType, 'WFTextTokenString',
      'WFDateFieldParameter needs the scalar wrapper; this is not a global wrapper replacement');
  }
});

function walk(value, visit) {
  if (!value || typeof value !== 'object') return;
  visit(value);
  for (const item of Object.values(value)) walk(item, visit);
}

test('deterministic paged graph is the shipping history shortcut', () => {
  const graph = buildPagedHistoryShortcut();
  assert.equal(graph.WFWorkflowName, 'Wafra History v2');
  assert.equal(verifyPagedHistoryShortcut(graph), true);
  assert.deepEqual(graph, buildPagedHistoryShortcut());
});
test('a published plist may reorder dictionary keys without changing its action graph', () => {
  const reorder = value => Array.isArray(value) ? value.map(reorder)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).reverse().map(key => [key, reorder(value[key])]))
      : value;
  assert.equal(verifyPagedHistoryShortcut(reorder(buildPagedHistoryShortcut())), true);
});
test('every generated action reference resolves and all action IDs are unique', () => {
  for (const graph of [buildPagedHistoryShortcut(), buildQueryProbe()]) {
    const ids = graph.WFWorkflowActions.map(a => a.WFWorkflowActionParameters.UUID);
    assert.equal(new Set(ids).size, ids.length);
    walk(graph, value => {
      if (value.Type === 'ActionOutput') assert.ok(ids.includes(value.OutputUUID), value.OutputUUID);
    });
  }
});
test('all scalar text variable ranges actually cover the placeholder', () => {
  for (const graph of [buildPagedHistoryShortcut(), buildQueryProbe()]) walk(graph, value => {
    if (value.WFSerializationType !== 'WFTextTokenString') return;
    for (const range of Object.keys(value.Value.attachmentsByRange || {})) {
      const match = /^\{(\d+), (\d+)\}$/.exec(range);
      assert.ok(match, range);
      assert.equal(value.Value.string.slice(Number(match[1]), Number(match[1]) + Number(match[2])), '\ufffc');
    }
  });
});
test('conditional subjects are explicitly typed for Shortcuts on-device comparisons', () => {
  const actions = buildPagedHistoryShortcut().WFWorkflowActions
    .filter(action => action.WFWorkflowActionIdentifier === 'is.workflow.actions.conditional' &&
      action.WFWorkflowActionParameters.WFControlFlowMode === 0);
  assert.ok(actions.length > 0);
  for (const action of actions) {
    const p = action.WFWorkflowActionParameters;
    const variable = p.WFInput?.Variable?.Value;
    if (variable?.Type !== 'ActionOutput') continue;
    const coercion = variable.Aggrandizements?.find(item => item.Type === 'WFCoercionVariableAggrandizement');
    assert.ok(coercion, 'Dictionary/Action outputs used by If must be explicitly typed');
    assert.equal(
      coercion.CoercionItemClass,
      typeof p.WFNumberValue === 'number' ? 'WFNumberContentItem' : 'WFStringContentItem',
    );
  }
});

test('repeat and conditional blocks are nested and closed correctly', () => {
  const stack = [];
  for (const action of buildPagedHistoryShortcut().WFWorkflowActions) {
    const p = action.WFWorkflowActionParameters;
    if (!p.GroupingIdentifier) continue;
    if (p.WFControlFlowMode === 0) stack.push([p.GroupingIdentifier, action.WFWorkflowActionIdentifier]);
    else if (p.WFControlFlowMode === 2) assert.deepEqual(stack.pop(), [p.GroupingIdentifier, action.WFWorkflowActionIdentifier]);
    else assert.equal(stack.at(-1)?.[0], p.GroupingIdentifier);
  }
  assert.equal(stack.length, 0);
});
test('all message queries are bounded and paging uses a single strict upper date', () => {
  const queries = buildPagedHistoryShortcut().WFWorkflowActions.filter(a => a.WFWorkflowActionIdentifier === 'com.apple.MobileSMS.MessageEntity');
  assert.deepEqual(queries.map(a => a.WFWorkflowActionParameters.WFContentItemLimitNumber), [1, 1, 51, 102, 204, 408]);
  for (const a of queries.slice(2)) {
    const filters = a.WFWorkflowActionParameters.WFContentItemFilter.Value.WFActionParameterFilterTemplates;
    assert.equal(filters.length, 1); assert.equal(filters[0].Property, 'date'); assert.equal(filters[0].Operator, 0);
  }
});
test('bounded list collection does not retain per-record repeat results', () => {
  const actions = buildPagedHistoryShortcut().WFWorkflowActions;
  const end = actions.findIndex(a => a.WFWorkflowActionIdentifier === 'is.workflow.actions.repeat.each' && a.WFWorkflowActionParameters.WFControlFlowMode === 2);
  assert.equal(actions[end - 1].WFWorkflowActionIdentifier, 'is.workflow.actions.nothing');
  assert.ok(actions.some(a => a.WFWorkflowActionIdentifier === 'is.workflow.actions.appendvariable' && a.WFWorkflowActionParameters.WFVariableName === 'Encoded Page'));
  const stage = actions.find(a => a.WFWorkflowActionIdentifier === 'app.wafra.ios.StageWafraPagedImportIntent');
  assert.equal(stage.WFWorkflowActionParameters.frame.WFSerializationType, 'WFTextTokenString');
});
test('empty pages and the safety work budget cannot be advertised as completion', () => {
  const graph = buildPagedHistoryShortcut();
  const text = JSON.stringify(graph);
  assert.match(text, /This is not a completed history import/);
  assert.match(text, /Nothing was added to Wafra/);
  assert.equal(graph.WFWorkflowActions.filter(a => a.WFWorkflowActionIdentifier === 'is.workflow.actions.url' && JSON.stringify(a).includes('import-sms')).length, 1);
});
test('no raw source leaves through files, network, clipboard, mail, or messages', () => {
  for (const graph of [buildPagedHistoryShortcut(), buildQueryProbe()]) {
    assert.doesNotMatch(JSON.stringify(graph), /https?:/);
    // Inspect executable identifiers, not explanatory comments such as
    // "no clipboard". The exact-graph validator independently pins parameters.
    for (const action of graph.WFWorkflowActions) {
      assert.doesNotMatch(action.WFWorkflowActionIdentifier,
        /downloadurl|clipboard|savefile|appendfile|sendmessage|sendemail/);
    }
  }
});
test('a changed or unbounded signed candidate must fail graph validation', () => {
  const graph = buildPagedHistoryShortcut();
  graph.WFWorkflowActions.find(a => a.WFWorkflowActionIdentifier === 'com.apple.MobileSMS.MessageEntity').WFWorkflowActionParameters.WFContentItemLimitNumber = 100000;
  assert.throws(() => verifyPagedHistoryShortcut(graph));
});
test('standalone query check needs no Wafra App Intent and displays only counts', () => {
  const graph = buildQueryProbe();
  assert.ok(graph.WFWorkflowActions.every(a => !a.WFWorkflowActionIdentifier.startsWith('app.wafra.')));
  assert.equal(graph.WFWorkflowActions.at(-2).WFWorkflowActionIdentifier, 'is.workflow.actions.alert');
  assert.equal(graph.WFWorkflowActions.at(-1).WFWorkflowActionIdentifier, 'is.workflow.actions.exit');
});
