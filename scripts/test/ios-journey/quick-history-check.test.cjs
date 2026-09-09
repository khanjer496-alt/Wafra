'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const load = () => import(pathToFileURL(path.resolve(__dirname, '../../build-ios-quick-history-check.mjs')));
test('device diagnostic is four three-reference queries, consent and count output only', async () => {
  const { buildQuickHistoryCheck, verifyQuickHistoryCheck } = await load();
  const graph = buildQuickHistoryCheck();
  assert.equal(verifyQuickHistoryCheck(graph), true);
  const actions = graph.WFWorkflowActions;
  assert.equal(actions[0].WFWorkflowActionIdentifier, 'is.workflow.actions.alert');
  assert.equal(actions[0].WFWorkflowActionParameters.WFAlertActionCancelButtonShown, true);
  const queries = actions.filter(a => a.WFWorkflowActionIdentifier === 'com.apple.MobileSMS.MessageEntity');
  assert.equal(queries.length, 4);
  assert.ok(queries.every(a => a.WFWorkflowActionParameters.WFContentItemLimitEnabled === true && a.WFWorkflowActionParameters.WFContentItemLimitNumber === 3));
  assert.equal(queries[2].WFWorkflowActionParameters.WFContentItemFilter.Value.WFActionParameterFilterTemplates[0].Operator, 2);
  assert.equal(queries[3].WFWorkflowActionParameters.WFContentItemFilter.Value.WFActionParameterFilterTemplates[0].Operator, 0);
  const last = actions.at(-1).WFWorkflowActionParameters;
  assert.equal(last.WFAlertActionTitle, 'History check result');
  assert.equal(Object.keys(last.WFAlertActionMessage.Value.attachmentsByRange).length, 4);
  const ids = new Set(actions.map(a => a.WFWorkflowActionParameters.UUID));
  for (const [range, ref] of Object.entries(last.WFAlertActionMessage.Value.attachmentsByRange)) {
    const index = Number(range.match(/^\{(\d+), 1\}$/)[1]);
    assert.equal(last.WFAlertActionMessage.Value.string[index], '\ufffc');
    assert.ok(ids.has(ref.OutputUUID));
  }
});
test('modified, unbounded, source-property and network variants are rejected', async () => {
  const { buildQuickHistoryCheck, verifyQuickHistoryCheck } = await load();
  for (const mutate of [g => g.WFWorkflowActions.push({ WFWorkflowActionIdentifier: 'is.workflow.actions.downloadurl' }),
    g => { g.WFWorkflowActions[3].WFWorkflowActionParameters.WFContentItemLimitEnabled = false; },
    g => { g.WFWorkflowActions[3].WFWorkflowActionParameters.PropertyName = 'Body'; }]) {
    const graph = buildQuickHistoryCheck(); mutate(graph); assert.throws(() => verifyQuickHistoryCheck(graph));
  }
});
test('all Date fields use native text-token serialization rather than discarded attachments', async () => {
  const { buildQuickHistoryCheck } = await load();
  const graph = buildQuickHistoryCheck();
  const adjust = graph.WFWorkflowActions.find(a => a.WFWorkflowActionIdentifier === 'is.workflow.actions.adjustdate');
  assert.equal(adjust.WFWorkflowActionParameters.WFDate.WFSerializationType, 'WFTextTokenString');
  for (const item of graph.WFWorkflowActions.filter(a => a.WFWorkflowActionIdentifier === 'com.apple.MobileSMS.MessageEntity')) {
    for (const predicate of item.WFWorkflowActionParameters.WFContentItemFilter.Value.WFActionParameterFilterTemplates) {
      assert.equal(predicate.Values.Date.WFSerializationType, 'WFTextTokenString');
      assert.equal(predicate.Values.Date.Value.string, '\ufffc');
    }
  }
  const { buildDateFilterCheck, verifyDateFilterCheck } = await import(pathToFileURL(path.resolve(__dirname, '../../build-ios-date-filter-check.mjs')));
  const dateGraph = buildDateFilterCheck();
  assert.equal(verifyDateFilterCheck(dateGraph), true);
  const format = dateGraph.WFWorkflowActions.find(a => a.WFWorkflowActionIdentifier === 'is.workflow.actions.format.date');
  assert.equal(format.WFWorkflowActionParameters.WFDate.WFSerializationType, 'WFTextTokenString');
  assert.equal(dateGraph.WFWorkflowName, 'Wafra Date Filter Check v2');
});
