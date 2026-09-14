import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  COLUMN_SEPARATOR, buildColumnarHistoryShortcut, buildPagedHistoryShortcut,
  verifyColumnarHistoryShortcut, verifyPagedHistoryShortcut,
} from '../build-ios-paged-history-shortcut.mjs';
import { buildQueryProbe } from '../build-ios-history-query-probe.mjs';
import { buildColumnFrameProbe } from '../build-ios-column-frame-check.mjs';

test('saved paging cursor is returned by Wafra as a typed date; Shortcuts never reparses it', () => {
  const actions = buildPagedHistoryShortcut().WFWorkflowActions;
  assert.equal(actions.filter(action => action.WFWorkflowActionIdentifier === 'is.workflow.actions.detect.date').length, 0);
  const cursor = actions.find(action => action.WFWorkflowActionIdentifier === 'app.wafra.ios.WafraPagedCursorDateIntent');
  assert.ok(cursor);
  assert.equal(cursor.WFWorkflowActionParameters.request.WFSerializationType, 'WFTextTokenString');
  assert.equal(cursor.WFWorkflowActionParameters.request.Value.attachmentsByRange['{0, 1}'].Type, 'Variable');
  assert.equal(cursor.WFWorkflowActionParameters.request.Value.attachmentsByRange['{0, 1}'].VariableName, 'Request');
  const queries = actions.filter(action => action.WFWorkflowActionIdentifier === 'com.apple.MobileSMS.MessageEntity').slice(2);
  for (const query of queries) {
    const date = query.WFWorkflowActionParameters.WFContentItemFilter.Value.WFActionParameterFilterTemplates[0].Values.Date;
    const ref = date.Value.attachmentsByRange['{0, 1}'];
    assert.equal(ref.Type, 'ActionOutput');
    assert.equal(ref.OutputUUID, cursor.WFWorkflowActionParameters.UUID);
  }
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
  // The public record check compares the published record byte-for-byte
  // against this generator. The action count is unchanged by the Combine Text
  // key repair; the record `5a0da9b5…` is expected to mismatch until the
  // repaired graph is signed and published.
  assert.equal(graph.WFWorkflowActions.length, 98);
  assert.doesNotMatch(JSON.stringify(graph), /StageWafraPagedColumnsIntent|Frame Mode|Columns Result/);
});
test('column-framed candidate is deterministic, bounded and source-free', () => {
  const graph = buildColumnarHistoryShortcut();
  assert.equal(graph.WFWorkflowName, 'Wafra History v3');
  assert.equal(verifyColumnarHistoryShortcut(graph), true);
  assert.deepEqual(graph, buildColumnarHistoryShortcut());
  assert.throws(() => verifyPagedHistoryShortcut(graph));
  assert.throws(() => verifyColumnarHistoryShortcut(buildPagedHistoryShortcut()));
});
test('column framing reads each field for the whole page with no per-message action', () => {
  const actions = buildColumnarHistoryShortcut().WFWorkflowActions;
  const combines = actions.filter(a => a.WFWorkflowActionIdentifier === 'is.workflow.actions.text.combine' &&
    a.WFWorkflowActionParameters.WFTextSeparator === 'Custom');
  assert.equal(combines.length, 4);
  for (const combine of combines) assert.equal(combine.WFWorkflowActionParameters.WFTextCustomSeparator, COLUMN_SEPARATOR);
  const properties = combines.map(c => c.WFWorkflowActionParameters.text.Value.Aggrandizements?.[0]?.PropertyName);
  assert.deepEqual(properties.slice(0, 3), ['GUID', 'Body', 'Sender']);
  // The date column comes from Format Date applied to the whole page, so the
  // native side receives the same ISO instant format as the v2 line frame.
  const dateInput = combines[3].WFWorkflowActionParameters.text.Value;
  const formatter = actions.find(a => a.WFWorkflowActionParameters.UUID === dateInput.OutputUUID);
  assert.equal(formatter.WFWorkflowActionIdentifier, 'is.workflow.actions.format.date');
  assert.equal(formatter.WFWorkflowActionParameters.WFDateFormat, "yyyy-MM-dd'T'HH:mm:ss.SSSXXX");
  assert.equal(formatter.WFWorkflowActionParameters.WFDate.WFSerializationType, 'WFTextTokenString');
  const stage = actions.find(a => a.WFWorkflowActionIdentifier === 'app.wafra.ios.StageWafraPagedColumnsIntent');
  for (const key of ['request', 'guids', 'bodies', 'senders', 'dates']) {
    assert.equal(stage.WFWorkflowActionParameters[key].WFSerializationType, 'WFTextTokenString', key);
  }
  assert.equal(stage.WFWorkflowActionParameters.found.Value.OutputName, 'Count');
  // The column intent runs before the per-message loop and outside it: the
  // loop is the fallback, not the primary path.
  const columnIndex = actions.indexOf(stage);
  const loopStart = actions.findIndex(a => a.WFWorkflowActionIdentifier === 'is.workflow.actions.repeat.each');
  assert.ok(columnIndex < loopStart);
});
test('a column framing refusal falls back to the exact v2 per-message page for that page only', () => {
  const actions = buildColumnarHistoryShortcut().WFWorkflowActions;
  const text = JSON.stringify(actions);
  assert.match(text, /"WFConditionalActionString":"frame-columns"/);
  assert.match(text, /"WFConditionalActionString":"invalid-input"/);
  // Other refusals (authorization, stale cursor, capacity) must still surface
  // as the ordinary paused-safely path rather than being retried row by row.
  for (const reason of ['unauthorized', 'stale-request', 'staging-full', 'source-changed']) {
    assert.doesNotMatch(text, new RegExp(`"WFConditionalActionString":"${reason}"`));
  }
  const rowsBranch = actions.find(a => a.WFWorkflowActionIdentifier === 'is.workflow.actions.conditional' &&
    a.WFWorkflowActionParameters.WFConditionalActionString === 'rows' && a.WFWorkflowActionParameters.WFControlFlowMode === 0);
  assert.ok(rowsBranch);
  const rowsClose = actions.find(a => a.WFWorkflowActionIdentifier === 'is.workflow.actions.conditional' &&
    a.WFWorkflowActionParameters.GroupingIdentifier === rowsBranch.WFWorkflowActionParameters.GroupingIdentifier &&
    a.WFWorkflowActionParameters.WFControlFlowMode === 2);
  const inside = actions.slice(actions.indexOf(rowsBranch), actions.indexOf(rowsClose));
  // The fallback is the v2 page body verbatim: four-field scalar framing and
  // the original line-frame intent, bound to the untouched request.
  assert.ok(inside.some(a => a.WFWorkflowActionParameters.WFTextActionText?.Value?.string === '\ufffc|\ufffc|\ufffc|\ufffc'));
  const lineStage = inside.find(a => a.WFWorkflowActionIdentifier === 'app.wafra.ios.StageWafraPagedImportIntent');
  assert.equal(lineStage.WFWorkflowActionParameters.request.Value.attachmentsByRange['{0, 1}'].VariableName, 'Request');
  // The column result is only promoted to the request when framing succeeded.
  const promote = actions.find(a => a.WFWorkflowActionIdentifier === 'is.workflow.actions.setvariable' &&
    a.WFWorkflowActionParameters.WFVariableName === 'Request' &&
    a.WFWorkflowActionParameters.WFInput.Value.VariableName === 'Columns Result');
  assert.ok(promote);
  const promoteGuard = actions.slice(0, actions.indexOf(promote)).reverse().find(a =>
    a.WFWorkflowActionIdentifier === 'is.workflow.actions.conditional' && a.WFWorkflowActionParameters.WFControlFlowMode === 0);
  assert.equal(promoteGuard.WFWorkflowActionParameters.WFConditionalActionString, 'columns');
});
test('column frame probe uses the same column construction, needs no Wafra intent and shows only counts', () => {
  const graph = buildColumnFrameProbe();
  assert.equal(graph.WFWorkflowName, 'Wafra Column Frame Check');
  assert.ok(graph.WFWorkflowActions.every(a => !a.WFWorkflowActionIdentifier.startsWith('app.wafra.')));
  const queries = graph.WFWorkflowActions.filter(a => a.WFWorkflowActionIdentifier === 'com.apple.MobileSMS.MessageEntity');
  assert.equal(queries.length, 1);
  assert.equal(queries[0].WFWorkflowActionParameters.WFContentItemLimitNumber, 25);
  const combines = graph.WFWorkflowActions.filter(a => a.WFWorkflowActionIdentifier === 'is.workflow.actions.text.combine');
  const splits = graph.WFWorkflowActions.filter(a => a.WFWorkflowActionIdentifier === 'is.workflow.actions.text.split');
  assert.equal(combines.length, 4); assert.equal(splits.length, 4);
  for (const a of [...combines, ...splits]) assert.equal(a.WFWorkflowActionParameters.WFTextCustomSeparator, COLUMN_SEPARATOR);
  assert.equal(graph.WFWorkflowActions.at(-2).WFWorkflowActionIdentifier, 'is.workflow.actions.alert');
  assert.equal(graph.WFWorkflowActions.at(-1).WFWorkflowActionIdentifier, 'is.workflow.actions.exit');
  assert.match(JSON.stringify(graph), /WAFRA_COLUMN_PROBE_V1/);
});
test('a published plist may reorder dictionary keys without changing its action graph', () => {
  const reorder = value => Array.isArray(value) ? value.map(reorder)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).reverse().map(key => [key, reorder(value[key])]))
      : value;
  assert.equal(verifyPagedHistoryShortcut(reorder(buildPagedHistoryShortcut())), true);
});
test('every generated action reference resolves and all action IDs are unique', () => {
  for (const graph of [buildPagedHistoryShortcut(), buildColumnarHistoryShortcut(), buildQueryProbe(), buildColumnFrameProbe()]) {
    const ids = graph.WFWorkflowActions.map(a => a.WFWorkflowActionParameters.UUID);
    assert.equal(new Set(ids).size, ids.length);
    walk(graph, value => {
      if (value.Type === 'ActionOutput') assert.ok(ids.includes(value.OutputUUID), value.OutputUUID);
    });
  }
});
test('all scalar text variable ranges actually cover the placeholder', () => {
  for (const graph of [buildPagedHistoryShortcut(), buildColumnarHistoryShortcut(), buildQueryProbe(), buildColumnFrameProbe()]) walk(graph, value => {
    if (value.WFSerializationType !== 'WFTextTokenString') return;
    for (const range of Object.keys(value.Value.attachmentsByRange || {})) {
      const match = /^\{(\d+), (\d+)\}$/.exec(range);
      assert.ok(match, range);
      assert.equal(value.Value.string.slice(Number(match[1]), Number(match[1]) + Number(match[2])), '\ufffc');
    }
  });
});
test('conditional subjects are explicitly typed for Shortcuts on-device comparisons', () => {
  const actions = [...buildPagedHistoryShortcut().WFWorkflowActions, ...buildColumnarHistoryShortcut().WFWorkflowActions]
    .filter(action => action.WFWorkflowActionIdentifier === 'is.workflow.actions.conditional' &&
      action.WFWorkflowActionParameters.WFControlFlowMode === 0);
  assert.ok(actions.length > 0);
  for (const action of actions) {
    const p = action.WFWorkflowActionParameters;
    const variable = p.WFInput?.Variable?.Value;
    if (variable?.Type !== 'ActionOutput' && variable?.Type !== 'Variable') continue;
    const coercion = variable.Aggrandizements?.find(item => item.Type === 'WFCoercionVariableAggrandizement');
    assert.ok(coercion, 'Dictionary/Action outputs used by If must be explicitly typed');
    assert.equal(
      coercion.CoercionItemClass,
      typeof p.WFNumberValue === 'number' ? 'WFNumberContentItem' : 'WFStringContentItem',
    );
  }
});

test('repeat and conditional blocks are nested and closed correctly', () => {
  for (const graph of [buildPagedHistoryShortcut(), buildColumnarHistoryShortcut()]) {
  const stack = [];
  for (const action of graph.WFWorkflowActions) {
    const p = action.WFWorkflowActionParameters;
    if (!p.GroupingIdentifier) continue;
    if (p.WFControlFlowMode === 0) stack.push([p.GroupingIdentifier, action.WFWorkflowActionIdentifier]);
    else if (p.WFControlFlowMode === 2) assert.deepEqual(stack.pop(), [p.GroupingIdentifier, action.WFWorkflowActionIdentifier]);
    else assert.equal(stack.at(-1)?.[0], p.GroupingIdentifier);
  }
  assert.equal(stack.length, 0);
  }
});
test('all message queries are bounded and paging uses a single strict upper date', () => {
  const queries = buildPagedHistoryShortcut().WFWorkflowActions.filter(a => a.WFWorkflowActionIdentifier === 'com.apple.MobileSMS.MessageEntity');
  assert.deepEqual(queries.map(a => a.WFWorkflowActionParameters.WFContentItemLimitNumber), [1, 1, 51, 102, 204, 408]);
  for (const a of queries.slice(2)) {
    const filters = a.WFWorkflowActionParameters.WFContentItemFilter.Value.WFActionParameterFilterTemplates;
    assert.equal(filters.length, 1); assert.equal(filters[0].Property, 'date'); assert.equal(filters[0].Operator, 0);
  }
});
test('Combine Text and Split Text receive their input under Apple\'s `text` key', () => {
  // Builds 127-137 handed Wafra an empty frame on a real iPhone: the v2 graph
  // keyed Combine Text's input as `WFInput`, which Shortcuts ignores, so the
  // action fell back to the preceding Repeat's (empty) results. Every text
  // component action must bind its input as `text` and never as `WFInput`.
  for (const graph of [buildPagedHistoryShortcut(), buildColumnarHistoryShortcut(), buildColumnFrameProbe()]) {
    const components = graph.WFWorkflowActions.filter(a =>
      a.WFWorkflowActionIdentifier === 'is.workflow.actions.text.combine' ||
      a.WFWorkflowActionIdentifier === 'is.workflow.actions.text.split');
    assert.ok(components.length > 0);
    for (const action of components) {
      const p = action.WFWorkflowActionParameters;
      assert.equal(p.WFInput, undefined, 'WFInput is not a Combine/Split Text parameter');
      assert.ok(p.text, 'text input is bound');
      assert.ok(['WFTextTokenAttachment', 'WFTextTokenString'].includes(p.text.WFSerializationType));
      assert.ok(['New Lines', 'Spaces', 'Custom'].includes(p.WFTextSeparator));
    }
  }
  const frame = buildPagedHistoryShortcut().WFWorkflowActions.find(a => a.WFWorkflowActionIdentifier === 'is.workflow.actions.text.combine');
  assert.deepEqual(frame.WFWorkflowActionParameters.text.Value, { Type: 'Variable', VariableName: 'Encoded Page' });
  assert.equal(frame.WFWorkflowActionParameters.WFTextSeparator, 'New Lines');
});
test('bounded list collection does not retain per-record repeat results', () => {
  const actions = buildPagedHistoryShortcut().WFWorkflowActions;
  const end = actions.findIndex(a => a.WFWorkflowActionIdentifier === 'is.workflow.actions.repeat.each' && a.WFWorkflowActionParameters.WFControlFlowMode === 2);
  assert.equal(actions[end - 1].WFWorkflowActionIdentifier, 'is.workflow.actions.nothing');
  assert.ok(actions.some(a => a.WFWorkflowActionIdentifier === 'is.workflow.actions.appendvariable' && a.WFWorkflowActionParameters.WFVariableName === 'Encoded Page'));
  const stage = actions.find(a => a.WFWorkflowActionIdentifier === 'app.wafra.ios.StageWafraPagedImportIntent');
  assert.equal(stage.WFWorkflowActionParameters.frame.WFSerializationType, 'WFTextTokenString');
  const dictionaries = actions.filter(a => a.WFWorkflowActionIdentifier === 'is.workflow.actions.dictionary');
  assert.equal(dictionaries.length, 0, 'records must not rely on Dictionary-to-Text JSON coercion');
  const recordText = actions.find(a => a.WFWorkflowActionIdentifier === 'is.workflow.actions.gettext' &&
    a.WFWorkflowActionParameters.WFTextActionText?.Value?.string === '\ufffc|\ufffc|\ufffc|\ufffc');
  assert.ok(recordText, 'records use deterministic four-field scalar framing');
});
test('empty pages and the safety work budget cannot be advertised as completion', () => {
  const graph = buildPagedHistoryShortcut();
  const text = JSON.stringify(graph);
  assert.match(text, /This is not a completed history import/);
  assert.match(text, /Nothing was added to Wafra/);
  assert.equal(graph.WFWorkflowActions.filter(a => a.WFWorkflowActionIdentifier === 'is.workflow.actions.url' && JSON.stringify(a).includes('import-sms')).length, 1);
});
test('no raw source leaves through files, network, clipboard, mail, or messages', () => {
  for (const graph of [buildPagedHistoryShortcut(), buildColumnarHistoryShortcut(), buildQueryProbe(), buildColumnFrameProbe()]) {
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
