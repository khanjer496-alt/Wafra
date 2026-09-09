'use strict';
// Parameter-serialization regression, not an emulator of the Messages index.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const load = () => import(pathToFileURL(path.resolve(__dirname, '../../build-ios-history-shortcut.mjs')));
const validDate = field => {
  assert.equal(field?.WFSerializationType, 'WFTextTokenString');
  assert.equal(field.Value.string, '\ufffc');
  assert.deepEqual(Object.keys(field.Value.attachmentsByRange), ['{0, 1}']);
  const reference = field.Value.attachmentsByRange['{0, 1}'];
  assert.ok(['ActionOutput', 'Variable'].includes(reference.Type));
  assert.ok(reference.OutputUUID || reference.VariableName);
};

test('published two-ended production graph stays byte-identical to the pre-fix source', async () => {
  const { buildHistoryShortcut, verifyHistoryShortcutGraph } = await load();
  const graph = buildHistoryShortcut();
  assert.equal(createHash('sha256').update(JSON.stringify(graph)).digest('hex'),
    'f4e1d3cb8859cab4b6387fbdd588d2994b92043feabf3a737027a2f7f3d02d72');
  assert.equal(verifyHistoryShortcutGraph(graph), true);
});

for (const variant of ['smoke', 'adaptive']) {
  test(`${variant}: every date boundary/filter has a real native Date-field wrapper`, async () => {
    const { buildHistoryShortcut, buildAdaptiveHistoryDiagnostic, verifyHistoryShortcutGraph } = await load();
    const graph = variant === 'smoke' ? buildHistoryShortcut({ smoke: true }) : null;
    const actions = graph ? graph.WFWorkflowActions : buildAdaptiveHistoryDiagnostic();
    if (graph) assert.equal(verifyHistoryShortcutGraph(graph), true);
    let dates = 0, filters = 0, quantities = 0;
    for (const action of actions) {
      const p = action.WFWorkflowActionParameters ?? {};
      if (p.WFDate) { validDate(p.WFDate); dates++; }
      if (p.WFTimeUntilFromDate) { validDate(p.WFTimeUntilFromDate); dates++; }
      if (p.WFDuration) {
        assert.equal(p.WFDuration.WFSerializationType, 'WFQuantityFieldValue');
        assert.ok(['sec', 'min', 'hr', 'days', 'weeks', 'months', 'years'].includes(p.WFDuration.Value.Unit));
        assert.notEqual(p.WFDuration.Value.Magnitude, undefined); quantities++;
      }
      for (const predicate of p.WFContentItemFilter?.Value?.WFActionParameterFilterTemplates ?? []) {
        assert.equal(predicate.Property, 'date');
        assert.ok([0, 2].includes(predicate.Operator));
        validDate(predicate.Values.Date); filters++;
      }
    }
    assert.ok(dates >= 5 && filters >= 2 && quantities >= 3);
  });
}

test('a smoke artifact reverting to empty native Date fields or ignored units is rejected', async () => {
  const { buildHistoryShortcut, verifyHistoryShortcutGraph } = await load();
  for (const mutate of [
    graph => { const p = graph.WFWorkflowActions.find(a => a.WFWorkflowActionIdentifier === 'is.workflow.actions.adjustdate').WFWorkflowActionParameters;
      p.WFDate = { Value: p.WFDate.Value.attachmentsByRange['{0, 1}'], WFSerializationType: 'WFTextTokenAttachment' }; },
    graph => { const p = graph.WFWorkflowActions.find(a => a.WFWorkflowActionIdentifier === 'com.apple.MobileSMS.MessageEntity').WFWorkflowActionParameters;
      p.WFContentItemFilter.Value.WFActionParameterFilterTemplates[0].Values.Date = ''; },
    graph => { const p = graph.WFWorkflowActions.find(a => a.WFWorkflowActionParameters.WFDuration?.Value.Unit === 'sec').WFWorkflowActionParameters;
      p.WFDuration.Value.Unit = 'seconds'; },
  ]) {
    const graph = buildHistoryShortcut({ smoke: true }); mutate(graph);
    assert.throws(() => verifyHistoryShortcutGraph(graph));
  }
});
