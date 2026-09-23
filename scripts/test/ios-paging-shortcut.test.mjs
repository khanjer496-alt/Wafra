import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import {
  BOUNDARY_SAFE_SHORTCUT_NAME, buildBoundarySafeHistoryShortcut, verifyBoundarySafeHistoryShortcut,
  COLUMN_SEPARATOR, FAST_SHORTCUT_NAME, ROW_SHORTCUT_NAME, WINDOWED_SHORTCUT_NAME, buildColumnarHistoryShortcut, buildFastHistoryShortcut, buildPagedHistoryShortcut, buildRowHistoryShortcut, buildWindowedHistoryShortcut,
  verifyColumnarHistoryShortcut, verifyFastHistoryShortcut, verifyPagedHistoryShortcut, verifyRowHistoryShortcut, verifyWindowedHistoryShortcut,
} from '../build-ios-paged-history-shortcut.mjs';
import { buildQueryProbe } from '../build-ios-history-query-probe.mjs';
import { buildColumnFrameProbe } from '../build-ios-column-frame-check.mjs';

// Evaluate the generator's actual date actions and strict query predicates.
// This checks our query contract, not Apple's on-device Messages implementation.
function selectOldestFromProbeGraph(graph, messages, now) {
  const dates = new Map();
  const reference = value => value.Value.attachmentsByRange['{0, 1}'];
  for (const action of graph.WFWorkflowActions) {
    const p = action.WFWorkflowActionParameters;
    if (action.WFWorkflowActionIdentifier === 'is.workflow.actions.date') dates.set(p.UUID, now);
    if (action.WFWorkflowActionIdentifier === 'is.workflow.actions.adjustdate') {
      const duration = p.WFDuration.Value;
      assert.ok(['days', 'sec'].includes(duration.Unit));
      assert.equal(p.WFAdjustOperation, 'Subtract');
      const delta = duration.Magnitude * (duration.Unit === 'days' ? 86_400_000 : 1_000);
      const source = dates.get(reference(p.WFDate).OutputUUID);
      assert.ok(Number.isFinite(source), 'date adjustment has a resolved input');
      dates.set(p.UUID, source - delta);
    }
    if (action.WFWorkflowActionIdentifier !== 'com.apple.MobileSMS.MessageEntity') continue;
    if (p.WFContentItemSortOrder !== 'Oldest First' || p.WFContentItemLimitNumber !== 1) continue;
    const candidates = messages.filter(message => p.WFContentItemFilter.Value.WFActionParameterFilterTemplates.every(predicate => {
      const boundary = dates.get(reference(predicate.Values.Date).OutputUUID);
      assert.ok(Number.isFinite(boundary), 'query has a resolved date boundary');
      assert.ok([0, 2].includes(predicate.Operator));
      return predicate.Operator === 0 ? message < boundary : message > boundary;
    }));
    // The generated ladder stops probing after its first non-empty band.
    if (candidates.length) return Math.min(...candidates);
  }
  return null;
}

test('oldest anchor includes messages on either side of every strict age-band boundary', () => {
  const graph = buildBoundarySafeHistoryShortcut();
  const now = Date.UTC(2026, 8, 23, 12);
  for (const ageDays of [365, 1_095, 3_650]) {
    const boundary = now - ageDays * 86_400_000;
    for (const offset of [-1, 0, 1]) {
      const oldest = boundary + offset;
      assert.equal(selectOldestFromProbeGraph(graph, [oldest, boundary + 2_000], now), oldest,
        `oldest at ${ageDays} days plus ${offset} ms must not disappear between bands`);
      assert.equal(selectOldestFromProbeGraph(graph, [oldest], now), oldest,
        `a single message at ${ageDays} days plus ${offset} ms must not appear empty`);
    }
  }
});

test('v7 is a separate candidate; existing v2-v6 artifact graphs remain byte-identical', () => {
  const candidate = buildBoundarySafeHistoryShortcut();
  assert.equal(candidate.WFWorkflowName, BOUNDARY_SAFE_SHORTCUT_NAME);
  assert.equal(verifyBoundarySafeHistoryShortcut(candidate), true);
  assert.throws(() => verifyWindowedHistoryShortcut(candidate));
  assert.throws(() => verifyBoundarySafeHistoryShortcut(buildWindowedHistoryShortcut()));
  for (const [build, digest] of [
    [buildPagedHistoryShortcut, '7f210db00b72757636273b5bccd8a3e070ba02385ab918383d4e42f6475ae41d'],
    [buildColumnarHistoryShortcut, '71c2370ffaad57b9ddbdbabcac86def42e1f6032a62ed3f535ac04dd463bde07'],
    [buildRowHistoryShortcut, 'e606e26b88d7bf570994e1c7fee836bbe2a047c316b55816a4b16e68d0154223'],
    [buildFastHistoryShortcut, 'afad094ade5c1df80020e26a4082439a6e2b36bc2a474ced9924676f5db784d1'],
    [buildWindowedHistoryShortcut, '647abdf525f00938ad49eb226dcad53b08d37e0164b10558f893509c6d14f67c'],
  ]) {
    assert.equal(createHash('sha256').update(JSON.stringify(build())).digest('hex'), digest, build.name);
  }
});

test('typed-date graph never formats or parses a date inside Shortcuts', () => {
  // iOS 26 materialized the Message `date` property as the phone's display
  // string wherever v2 formatted it as text, losing seconds and breaking the
  // whole-second cursor. v4 hands the property straight to `Date` parameters.
  const graph = buildRowHistoryShortcut();
  assert.equal(graph.WFWorkflowName, ROW_SHORTCUT_NAME);
  assert.equal(verifyRowHistoryShortcut(graph), true);
  assert.deepEqual(graph, buildRowHistoryShortcut());
  assert.throws(() => verifyPagedHistoryShortcut(graph));
  assert.throws(() => verifyRowHistoryShortcut(buildPagedHistoryShortcut()));
  const ids = graph.WFWorkflowActions.map(a => a.WFWorkflowActionIdentifier);
  for (const forbidden of ['is.workflow.actions.format.date', 'is.workflow.actions.detect.date',
    'is.workflow.actions.base64encode', 'is.workflow.actions.text.combine', 'is.workflow.actions.appendvariable',
    'app.wafra.ios.BeginWafraPagedImportIntent', 'app.wafra.ios.StageWafraPagedImportIntent', 'app.wafra.ios.StageWafraPagedColumnsIntent']) {
    assert.ok(!ids.includes(forbidden), forbidden);
  }
  const typedDate = (value, expectedSource) => {
    assert.equal(value.WFSerializationType, 'WFTextTokenString');
    const ref = value.Value.attachmentsByRange['{0, 1}'];
    assert.deepEqual(ref.Aggrandizements, [{ Type: 'WFPropertyVariableAggrandizement', PropertyName: 'date' }],
      'the raw date property, with no text coercion');
    expectedSource(ref);
  };
  const begin = graph.WFWorkflowActions.find(a => a.WFWorkflowActionIdentifier === 'app.wafra.ios.BeginWafraPagedImportV2Intent');
  assert.ok(begin);
  const items = graph.WFWorkflowActions.filter(a => a.WFWorkflowActionIdentifier === 'is.workflow.actions.getitemfromlist');
  typedDate(begin.WFWorkflowActionParameters.oldestDate, ref => assert.equal(ref.OutputUUID, items[0].WFWorkflowActionParameters.UUID));
  typedDate(begin.WFWorkflowActionParameters.newestDate, ref => assert.equal(ref.OutputUUID, items[1].WFWorkflowActionParameters.UUID));
  for (const key of ['oldestGUID', 'newestGUID']) {
    const source = graph.WFWorkflowActions.find(a => a.WFWorkflowActionParameters.UUID === begin.WFWorkflowActionParameters[key].Value.attachmentsByRange['{0, 1}'].OutputUUID);
    assert.equal(source.WFWorkflowActionIdentifier, 'is.workflow.actions.gettext');
    assert.equal(source.WFWorkflowActionParameters.WFTextActionText.Value.attachmentsByRange['{0, 1}'].Aggrandizements[0].PropertyName, 'GUID');
  }
  // One typed row per Message inside the page loop, then one commit outside it.
  const loopStart = ids.indexOf('is.workflow.actions.repeat.each');
  const loopEnd = ids.lastIndexOf('is.workflow.actions.repeat.each');
  const rowIndex = ids.indexOf('app.wafra.ios.StageWafraPagedRowIntent');
  const commitIndex = ids.indexOf('app.wafra.ios.CommitWafraPagedPageIntent');
  assert.ok(loopStart < rowIndex && rowIndex < loopEnd && loopEnd < commitIndex);
  assert.equal(ids.filter(id => id === 'app.wafra.ios.StageWafraPagedRowIntent').length, 1);
  assert.equal(ids.filter(id => id === 'app.wafra.ios.CommitWafraPagedPageIntent').length, 1);
  const row = graph.WFWorkflowActions[rowIndex].WFWorkflowActionParameters;
  // The loop variable itself must never feed a Wafra Date parameter: on iOS 26
  // Shortcuts prompts "Message date" for it. The row is re-fetched by index.
  const rowItem = graph.WFWorkflowActions[rowIndex - 4];
  assert.equal(rowItem.WFWorkflowActionIdentifier, 'is.workflow.actions.getitemfromlist');
  assert.equal(rowItem.WFWorkflowActionParameters.WFItemSpecifier, 'Item At Index');
  // Number fields keep only the attachment wrapper; a scalar token here fell
  // back to item 1 on-device and staged one Message 51 times.
  assert.deepEqual(rowItem.WFWorkflowActionParameters.WFItemIndex,
    { Value: { Type: 'Variable', VariableName: 'Repeat Index 2' }, WFSerializationType: 'WFTextTokenAttachment' },
    'the page loop is nested inside the work-budget Repeat, so its own index is "Repeat Index 2"');
  // Nothing inside the nested page loop may read the outer loop's variables.
  const loopBody = JSON.stringify(graph.WFWorkflowActions.slice(loopStart + 1, loopEnd));
  assert.ok(!/"VariableName":"Repeat (Item|Index)"/.test(loopBody), 'outer-loop variables inside the nested page loop');
  assert.equal(rowItem.WFWorkflowActionParameters.WFInput.Value.VariableName, 'Page');
  typedDate(row.date, ref => { assert.equal(ref.Type, 'ActionOutput'); assert.equal(ref.OutputUUID, rowItem.WFWorkflowActionParameters.UUID); });
  assert.ok(!JSON.stringify(row).includes('Repeat Item'), 'no loop-variable binding on the row intent');
  for (const key of ['guid', 'body', 'sender']) {
    const source = graph.WFWorkflowActions.find(a => a.WFWorkflowActionParameters.UUID === row[key].Value.attachmentsByRange['{0, 1}'].OutputUUID);
    assert.equal(source.WFWorkflowActionIdentifier, 'is.workflow.actions.gettext');
    const aggr = source.WFWorkflowActionParameters.WFTextActionText.Value.attachmentsByRange['{0, 1}'].Aggrandizements;
    assert.equal(aggr[0].PropertyName, { guid: 'GUID', body: 'Body', sender: 'Sender' }[key]);
    assert.equal(aggr[1].CoercionItemClass, 'WFStringContentItem', 'explicit Text coercion is mandatory for entity fields');
  }
  assert.equal(row.request.Value.attachmentsByRange['{0, 1}'].VariableName, 'Request');
  const commit = graph.WFWorkflowActions[commitIndex].WFWorkflowActionParameters;
  assert.equal(commit.request.Value.attachmentsByRange['{0, 1}'].VariableName, 'Request');
  assert.equal(commit.found.WFSerializationType, 'WFTextTokenAttachment');
  assert.equal(commit.found.Value.OutputName, 'Count');
  // The commit response becomes the next request; the loop releases the page.
  const promote = graph.WFWorkflowActions[commitIndex + 1];
  assert.equal(promote.WFWorkflowActionIdentifier, 'is.workflow.actions.setvariable');
  assert.equal(promote.WFWorkflowActionParameters.WFVariableName, 'Request');
  assert.equal(promote.WFWorkflowActionParameters.WFInput.Value.OutputUUID, commit.UUID);
  assert.equal(graph.WFWorkflowActions[loopEnd - 1].WFWorkflowActionIdentifier, 'is.workflow.actions.nothing');
  // Cursor date and bounded queries are shared with v2.
  assert.ok(ids.includes('app.wafra.ios.WafraPagedCursorDateIntent'));
  const queries = graph.WFWorkflowActions.filter(a => a.WFWorkflowActionIdentifier === 'com.apple.MobileSMS.MessageEntity');
  assert.deepEqual(queries.map(a => a.WFWorkflowActionParameters.WFContentItemLimitNumber), [1, 1, 51, 102, 204, 408]);
});

test('windowed graph never asks Apple for the whole inbox', () => {
  // A tester's iOS 26 iPhone failed our unbounded "oldest first" query with
  // Apple's own "unknown error" while a plain Find Messages worked: Find
  // Messages materializes every match before sorting. v6 bounds every query.
  const graph = buildWindowedHistoryShortcut();
  assert.equal(graph.WFWorkflowName, WINDOWED_SHORTCUT_NAME);
  assert.equal(verifyWindowedHistoryShortcut(graph), true);
  assert.deepEqual(graph, buildWindowedHistoryShortcut());
  const A = graph.WFWorkflowActions; const ids = A.map(a => a.WFWorkflowActionIdentifier);
  const queries = A.filter(a => a.WFWorkflowActionIdentifier === 'com.apple.MobileSMS.MessageEntity');
  assert.equal(queries.length, 12);
  const probes = queries.filter(a => a.WFWorkflowActionParameters.WFContentItemLimitNumber === 1);
  const pages = queries.filter(a => a.WFWorkflowActionParameters.WFContentItemLimitNumber > 1);
  assert.equal(probes.length, 8); assert.deepEqual(pages.map(a => a.WFWorkflowActionParameters.WFContentItemLimitNumber), [51, 102, 204, 408]);
  // Seven of the eight boundary probes are bounded by age. Only the newest
  // ladder ends unbounded (an inbox silent for three years), and it runs only
  // if every bounded band was empty.
  const unbounded = probes.filter(a => a.WFWorkflowActionParameters.WFContentItemFilter.Value.WFActionParameterFilterTemplates.length === 0);
  assert.equal(unbounded.length, 1);
  for (const probe of probes) {
    const before = A[A.indexOf(probe) - 1];
    assert.equal(before.WFWorkflowActionIdentifier, 'is.workflow.actions.conditional');
    assert.equal(before.WFWorkflowActionParameters.WFNumberValue, 0, 'each probe runs only while its ladder is still empty');
  }
  // Every page query carries both bounds: after = Wafra's window start, before = Wafra's cursor.
  const cursor = A.find(a => a.WFWorkflowActionIdentifier === 'app.wafra.ios.WafraPagedCursorDateIntent');
  const windowStart = A.find(a => a.WFWorkflowActionIdentifier === 'app.wafra.ios.WafraPagedWindowStartDateIntent');
  assert.ok(cursor && windowStart);
  for (const page of pages) {
    const rows = page.WFWorkflowActionParameters.WFContentItemFilter.Value.WFActionParameterFilterTemplates;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].Operator, 2); assert.equal(rows[0].Values.Date.Value.attachmentsByRange['{0, 1}'].OutputUUID, windowStart.WFWorkflowActionParameters.UUID);
    assert.equal(rows[1].Operator, 0); assert.equal(rows[1].Values.Date.Value.attachmentsByRange['{0, 1}'].OutputUUID, cursor.WFWorkflowActionParameters.UUID);
    assert.equal(page.WFWorkflowActionParameters.WFContentItemSortOrder, 'Latest First');
  }
  // An empty window is committed (found = 0) instead of pausing the import,
  // and the page work runs only inside the "found is not 0" branch.
  assert.equal(ids.filter(id => id === 'app.wafra.ios.CommitWafraPagedPageIntent').length, 2);
  assert.doesNotMatch(JSON.stringify(graph), /No page was returned at the saved position/);
  const notZero = A.find(a => a.WFWorkflowActionIdentifier === 'is.workflow.actions.conditional' && a.WFWorkflowActionParameters.WFCondition === 5 && a.WFWorkflowActionParameters.WFNumberValue === 0);
  assert.ok(notZero);
  const loopStart = ids.indexOf('is.workflow.actions.repeat.each');
  assert.ok(A.indexOf(notZero) < loopStart);
  const loopEnd = ids.lastIndexOf('is.workflow.actions.repeat.each');
  const loopBody = JSON.stringify(A.slice(loopStart + 1, loopEnd));
  assert.ok(!/"VariableName":"Repeat (Item|Index)"/.test(loopBody));
  assert.ok(loopBody.includes('"VariableName":"Repeat Index 2"'));
  // v2/v4/v5 outputs are untouched.
  assert.equal(buildPagedHistoryShortcut().WFWorkflowActions.length, 98);
  assert.equal(buildRowHistoryShortcut().WFWorkflowActions.length, 87);
  assert.equal(buildFastHistoryShortcut().WFWorkflowActions.length, 119);
});
test('fast graph tries column framing per page and falls back to typed rows for that page only', () => {
  const graph = buildFastHistoryShortcut();
  assert.equal(graph.WFWorkflowName, FAST_SHORTCUT_NAME);
  assert.equal(verifyFastHistoryShortcut(graph), true);
  assert.deepEqual(graph, buildFastHistoryShortcut());
  const ids = graph.WFWorkflowActions.map(a => a.WFWorkflowActionIdentifier);
  assert.ok(ids.includes('app.wafra.ios.BeginWafraPagedImportV2Intent'));
  assert.ok(ids.includes('app.wafra.ios.StageWafraPagedColumnsIntent'));
  assert.ok(ids.includes('app.wafra.ios.StageWafraPagedRowIntent'));
  assert.ok(ids.includes('app.wafra.ios.CommitWafraPagedPageIntent'));
  assert.ok(!ids.includes('app.wafra.ios.StageWafraPagedImportIntent'));
  assert.ok(!ids.includes('app.wafra.ios.BeginWafraPagedImportIntent'));
  // The column attempt runs before the row loop; the row loop sits inside the
  // Frame Mode == rows branch and reads its own nested index.
  const columns = ids.indexOf('app.wafra.ios.StageWafraPagedColumnsIntent');
  const rowsBranch = graph.WFWorkflowActions.findIndex(a => a.WFWorkflowActionIdentifier === 'is.workflow.actions.conditional' &&
    a.WFWorkflowActionParameters.WFConditionalActionString === 'rows' && a.WFWorkflowActionParameters.WFControlFlowMode === 0);
  const loopStart = ids.indexOf('is.workflow.actions.repeat.each');
  const rowIndex = ids.indexOf('app.wafra.ios.StageWafraPagedRowIntent');
  const commitIndex = ids.indexOf('app.wafra.ios.CommitWafraPagedPageIntent');
  assert.ok(columns < rowsBranch && rowsBranch < loopStart && loopStart < rowIndex && rowIndex < commitIndex);
  const loopEnd = ids.lastIndexOf('is.workflow.actions.repeat.each');
  const loopBody = JSON.stringify(graph.WFWorkflowActions.slice(loopStart + 1, loopEnd));
  assert.ok(!/"VariableName":"Repeat (Item|Index)"/.test(loopBody));
  assert.ok(loopBody.includes('"VariableName":"Repeat Index 2"'));
  // Every framing/field/date refusal of the column path falls back to rows.
  const text = JSON.stringify(graph);
  assert.match(text, /"WFCondition":99,"WFConditionalActionString":"invalid-input-"/);
  assert.match(text, /"WFConditionalActionString":"frame-columns"/);
  for (const reason of ['unauthorized', 'stale-request', 'staging-full', 'source-changed']) {
    assert.doesNotMatch(text, new RegExp(`"WFConditionalActionString":"${reason}"`));
  }
  // v2/v3/v4 outputs are untouched by the v5 flag.
  assert.equal(buildPagedHistoryShortcut().WFWorkflowActions.length, 98);
  assert.equal(buildRowHistoryShortcut().WFWorkflowActions.length, 87);
});
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
  // against this generator, so any graph change needs a newly published record.
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
  for (const graph of [buildPagedHistoryShortcut(), buildColumnarHistoryShortcut(), buildRowHistoryShortcut(), buildFastHistoryShortcut(), buildWindowedHistoryShortcut(), buildBoundarySafeHistoryShortcut(), buildQueryProbe(), buildColumnFrameProbe()]) {
    const ids = graph.WFWorkflowActions.map(a => a.WFWorkflowActionParameters.UUID);
    assert.equal(new Set(ids).size, ids.length);
    walk(graph, value => {
      if (value.Type === 'ActionOutput') assert.ok(ids.includes(value.OutputUUID), value.OutputUUID);
    });
  }
});
test('all scalar text variable ranges actually cover the placeholder', () => {
  for (const graph of [buildPagedHistoryShortcut(), buildColumnarHistoryShortcut(), buildRowHistoryShortcut(), buildFastHistoryShortcut(), buildWindowedHistoryShortcut(), buildBoundarySafeHistoryShortcut(), buildQueryProbe(), buildColumnFrameProbe()]) walk(graph, value => {
    if (value.WFSerializationType !== 'WFTextTokenString') return;
    for (const range of Object.keys(value.Value.attachmentsByRange || {})) {
      const match = /^\{(\d+), (\d+)\}$/.exec(range);
      assert.ok(match, range);
      assert.equal(value.Value.string.slice(Number(match[1]), Number(match[1]) + Number(match[2])), '\ufffc');
    }
  });
});
test('conditional subjects are explicitly typed for Shortcuts on-device comparisons', () => {
  const actions = [...buildPagedHistoryShortcut().WFWorkflowActions, ...buildColumnarHistoryShortcut().WFWorkflowActions, ...buildRowHistoryShortcut().WFWorkflowActions, ...buildFastHistoryShortcut().WFWorkflowActions, ...buildWindowedHistoryShortcut().WFWorkflowActions, ...buildBoundarySafeHistoryShortcut().WFWorkflowActions]
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
  for (const graph of [buildPagedHistoryShortcut(), buildColumnarHistoryShortcut(), buildRowHistoryShortcut(), buildFastHistoryShortcut(), buildWindowedHistoryShortcut(), buildBoundarySafeHistoryShortcut()]) {
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
  for (const graph of [buildPagedHistoryShortcut(), buildColumnarHistoryShortcut(), buildRowHistoryShortcut(), buildFastHistoryShortcut(), buildWindowedHistoryShortcut(), buildBoundarySafeHistoryShortcut(), buildQueryProbe(), buildColumnFrameProbe()]) {
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
