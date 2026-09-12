import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildHistoryInputProbe } from '../build-ios-history-input-probe.mjs';
import { buildPagedHistoryShortcut } from '../build-ios-paged-history-shortcut.mjs';

test('diagnostic preserves the installed anchor extraction but never invokes Wafra or emits source values', () => {
  const original = buildPagedHistoryShortcut().WFWorkflowActions;
  const boundary = original.findIndex(action => action.WFWorkflowActionIdentifier === 'app.wafra.ios.BeginWafraPagedImportIntent');
  const probe = buildHistoryInputProbe();
  const actions = probe.WFWorkflowActions;
  assert.deepEqual(actions.slice(1, boundary), original.slice(1, boundary));
  assert.equal(probe.WFWorkflowName, 'Wafra History Input Check');
  const queries = actions.filter(action => action.WFWorkflowActionIdentifier === 'com.apple.MobileSMS.MessageEntity');
  assert.equal(queries.length, 2);
  for (const query of queries) assert.equal(query.WFWorkflowActionParameters.WFContentItemLimitNumber, 1);
  const outputs = new Set(actions.slice(boundary, boundary + 4).map(action => {
    assert.equal(action.WFWorkflowActionIdentifier, 'is.workflow.actions.count');
    assert.equal(action.WFWorkflowActionParameters.WFCountType, 'Characters');
    return action.WFWorkflowActionParameters.UUID;
  }));
  const alert = actions.at(-2).WFWorkflowActionParameters.WFAlertActionMessage.Value;
  assert.equal(Object.keys(alert.attachmentsByRange).length, 4);
  for (const [range, value] of Object.entries(alert.attachmentsByRange)) {
    assert.ok(outputs.has(value.OutputUUID));
    const offset = Number(range.match(/^\{(\d+), 1\}$/)[1]);
    assert.equal(alert.string[offset], '\ufffc');
  }
  assert.equal(actions.at(-1).WFWorkflowActionIdentifier, 'is.workflow.actions.exit');
  for (const action of actions) {
    assert.doesNotMatch(action.WFWorkflowActionIdentifier, /app\.wafra|url|file|clipboard|mail|sendmessage/);
  }
  assert.doesNotMatch(JSON.stringify(actions), /https?:|"PropertyName":"(?:Body|Sender)"/);
});
