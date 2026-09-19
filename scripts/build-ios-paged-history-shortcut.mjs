#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { buildHistoryShortcut } from './build-ios-history-shortcut.mjs';

// Shipping paged history artifact. One native handoff per bounded page replaces
// the old per-message native call loop.
export const PAGED_SHORTCUT_NAME = 'Wafra History v2';
// Column-framed candidate. The v2 graph still runs ~10 Shortcuts actions per
// message inside Repeat With Each (four field reads, four Base64 encodes, one
// Text, one Append), so a 10,000-message inbox is ~100,000 interpreted actions.
// v3 builds each field for the whole page with one list-wide Combine Text and
// hands the four columns to Wafra in one call, so a page costs the same handful
// of actions whether it holds 51 or 408 messages. If Wafra cannot reconcile any
// of a page's four columns (a body containing the sentinel, a dropped nil
// property), the graph falls back to the exact v2 per-message framing for that
// page only.
export const COLUMNAR_SHORTCUT_NAME = 'Wafra History v3';
// Printable and absent from real SMS; the native side counts items per column
// against the page count and refuses any page where they disagree.
export const COLUMN_SEPARATOR = '\u241E';
// Typed-date graph. Every device run of v2 on iOS 26 has stalled on dates:
// Shortcuts materialized the Message `date` property as the phone's display
// string ("12 Sep 2026 at 9:22 PM") wherever the graph formatted it as text,
// which loses seconds and breaks the whole-second cursor overlap. The one
// binding that has physically delivered exact instants on this phone is a
// `Date` App Intent parameter fed the property directly (the legacy
// per-message graph). v4 therefore never formats a date in Shortcuts: the
// Begin boundaries and every row hand the Message date to a typed parameter,
// one native call per Message plus one commit per page. Slower than a pure
// text frame, but it is built only from primitives proven on the device.
export const ROW_SHORTCUT_NAME = 'Wafra History v4';
export function buildPagedHistoryShortcut() { return buildPagedGraph({ columnar: false }); }
export function buildColumnarHistoryShortcut() { return buildPagedGraph({ columnar: true }); }
export function buildRowHistoryShortcut() { return buildPagedGraph({ columnar: false, rows: true }); }
function buildPagedGraph({ columnar, rows = false }) {
  let serial = 0;
  const actions = [];
  const uuid = () => `C17B0000-0000-4000-8000-${String(++serial).padStart(12, '0')}`;
  const output = (id, name = 'Result', extra = {}) => ({ Type: 'ActionOutput', OutputUUID: id, OutputName: name, ...extra });
  const variable = name => ({ Type: 'Variable', VariableName: name });
  const attachment = value => ({ Value: value, WFSerializationType: 'WFTextTokenAttachment' });
  const text = (string, attachmentsByRange) => ({ Value: { string, ...(attachmentsByRange ? { attachmentsByRange } : {}) }, WFSerializationType: 'WFTextTokenString' });
  const scalar = value => text('\ufffc', { '{0, 1}': value });
  const property = name => ({ Type: 'WFPropertyVariableAggrandizement', PropertyName: name });
  const emit = (identifier, parameters = {}) => {
    const id = uuid(); actions.push({ WFWorkflowActionIdentifier: identifier, WFWorkflowActionParameters: { UUID: id, ...parameters } }); return id;
  };
  const stop = () => emit('is.workflow.actions.exit');
  const nothing = () => emit('is.workflow.actions.nothing');
  const set = (name, value) => emit('is.workflow.actions.setvariable', { WFVariableName: name, WFInput: attachment(value) });
  const get = (name, source = variable('Request')) => emit('is.workflow.actions.getvalueforkey', { WFDictionaryKey: name, WFInput: attachment(source) });
  const count = (value, kind = 'Items') => emit('is.workflow.actions.count', { WFCountType: kind, Input: attachment(value), WFInput: attachment(value) });
  const alert = (title, message, cancel = false) => emit('is.workflow.actions.alert', { WFAlertActionTitle: title, WFAlertActionMessage: message, WFAlertActionCancelButtonShown: cancel });
  const condition = (value, comparison, operation) => {
    const group = uuid();
    // Dictionary Value outputs are untyped. Shortcuts leaves the comparison
    // parameter unresolved on-device unless the conditional subject is
    // explicitly coerced to the type of the literal being compared.
    const typedValue = value?.Type === 'ActionOutput' || value?.Type === 'Variable'
      ? { ...value, Aggrandizements: [...(value.Aggrandizements ?? []), {
          Type: 'WFCoercionVariableAggrandizement',
          CoercionItemClass: typeof comparison === 'number' ? 'WFNumberContentItem' : 'WFStringContentItem',
        }] }
      : value;
    emit('is.workflow.actions.conditional', { GroupingIdentifier: group, WFControlFlowMode: 0, WFInput: { Type: 'Variable', Variable: attachment(typedValue) }, WFCondition: 4,
      ...(typeof comparison === 'number' ? { WFNumberValue: comparison } : { WFConditionalActionString: comparison }) });
    operation(); emit('is.workflow.actions.conditional', { GroupingIdentifier: group, WFControlFlowMode: 2 });
  };
  const find = (limit, order, before) => emit('com.apple.MobileSMS.MessageEntity', {
    AppIntentDescriptor: { TeamIdentifier: '0000000000', BundleIdentifier: 'com.apple.MobileSMS', Name: 'Messages', AppIntentIdentifier: 'MessageEntity', ActionRequiresAppInstallation: true },
    WFContentItemFilter: { WFSerializationType: 'WFContentPredicateTableTemplate', Value: {
      WFActionParameterFilterPrefix: 1, WFContentPredicateBoundedDate: false,
      WFActionParameterFilterTemplates: before ? [{ Property: 'date', Operator: 0, Removable: true, Values: { Unit: 4, Date: scalar(before) } }] : [],
    } },
    WFContentItemSortProperty: 'date', WFContentItemSortOrder: order,
    WFContentItemLimitEnabled: true, WFContentItemLimitNumber: limit,
  });
  const field = (value, name) => emit('is.workflow.actions.gettext', { WFTextActionText: scalar({ ...value,
    Aggrandizements: [property(name), { Type: 'WFCoercionVariableAggrandizement', CoercionItemClass: 'WFStringContentItem' }] }) });
  const dateText = value => emit('is.workflow.actions.format.date', {
    WFDate: scalar({ ...value, Aggrandizements: [property('date')] }),
    WFDateFormatStyle: 'Custom', WFTimeFormatStyle: 'None', WFDateFormat: "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
  });
  const native = (name, parameters) => emit(`app.wafra.ios.${name}`, {
    AppIntentDescriptor: { TeamIdentifier: 'UV7YN4GQ66', BundleIdentifier: 'app.wafra.ios', Name: 'Wafra', AppIntentIdentifier: name }, ...parameters,
  });
  const open = value => {
    const url = emit('is.workflow.actions.url', { WFURLActionURL: value });
    emit('is.workflow.actions.openurl', { WFInput: attachment(output(url, 'URL')) });
  };

  alert('Import your message history', 'Wafra transfers history in local pages instead of sending one message at a time. Keep this iPhone unlocked while Apple reads Messages. Finished pages are checkpointed so an interrupted import can resume. Nothing is uploaded.', true);
  const oldest = find(1, 'Oldest First'); const oldestCount = count(output(oldest, 'Message'));
  const newest = find(1, 'Latest First'); const newestCount = count(output(newest, 'Message'));
  condition(output(oldestCount, 'Count'), 0, () => {
    condition(output(newestCount, 'Count'), 0, () => { alert('No available messages', 'Messages returned no available history. Nothing was added to Wafra.'); stop(); });
    alert('Messages changed', 'The two initial queries disagreed. No history was started.'); stop();
  });
  condition(output(newestCount, 'Count'), 0, () => { alert('Messages changed', 'The initial queries disagreed. No history was started.'); stop(); });
  const oldestItem = emit('is.workflow.actions.getitemfromlist', { WFItemSpecifier: 'First Item', WFInput: attachment(output(oldest, 'Message')) });
  const newestItemAction = () => emit('is.workflow.actions.getitemfromlist', { WFItemSpecifier: 'First Item', WFInput: attachment(output(newest, 'Message')) });
  // The Message `date` property bound straight into a typed `Date` parameter:
  // the scalar token carries the property aggrandizement and nothing else.
  const typedDate = value => scalar({ ...value, Aggrandizements: [property('date')] });
  let initial;
  if (rows) {
    const newestItem = newestItemAction();
    const oldestGUID = field(output(oldestItem), 'GUID');
    const newestGUID = field(output(newestItem), 'GUID');
    initial = native('BeginWafraPagedImportV2Intent', {
      oldestGUID: scalar(output(oldestGUID)), oldestDate: typedDate(output(oldestItem)),
      newestGUID: scalar(output(newestGUID)), newestDate: typedDate(output(newestItem)),
    });
  } else {
    // Action order here is pinned by the published v2/v3 records; do not reorder.
    const oldestGUID = field(output(oldestItem), 'GUID'); const oldestDate = dateText(output(oldestItem));
    const newestItem = newestItemAction();
    const newestGUID = field(output(newestItem), 'GUID'); const newestDate = dateText(output(newestItem));
    initial = native('BeginWafraPagedImportIntent', {
      oldestGUID: scalar(output(oldestGUID)), oldestDate: scalar(output(oldestDate)),
      newestGUID: scalar(output(newestGUID)), newestDate: scalar(output(newestDate)),
    });
  }
  set('Request', output(initial)); nothing();
  const loop = uuid();
  emit('is.workflow.actions.repeat.count', { GroupingIdentifier: loop, WFControlFlowMode: 0, WFRepeatCount: 10000 });
  const dictionary = emit('is.workflow.actions.detect.dictionary', { WFInput: attachment(variable('Request')) });
  const status = get('status', output(dictionary, 'Dictionary'));
  condition(output(status), 'complete', () => {
    const session = get('sessionId', output(dictionary, 'Dictionary'));
    const encoded = emit('is.workflow.actions.urlencode', { WFEncodeMode: 'Encode', WFInput: scalar(output(session)) });
    open(text('wafra://import-sms?history=\ufffc', { '{27, 1}': output(encoded) })); stop();
  });
  condition(output(status), 'blocked', () => {
    const reason = get('reason', output(dictionary, 'Dictionary'));
    const prefix = 'Your saved pages are retained. Open Wafra to check progress. Reason: ';
    alert('History paused safely', text(`${prefix}\ufffc`, { [`{${prefix.length}, 1}`]: output(reason) }));
    open('wafra://ios-setup?section=history'); stop();
  });
  const before = get('before', output(dictionary, 'Dictionary'));
  const limit = get('limit', output(dictionary, 'Dictionary'));
  // Never ask Shortcuts to parse Wafra's ISO cursor string. iOS 26 has
  // produced both unresolved parameters and empty Detect Dates results for
  // valid cursors. Wafra returns the exact same cursor as a typed Date.
  const date = native('WafraPagedCursorDateIntent', { request: scalar(variable('Request')) });
  const noPage = emit('is.workflow.actions.list', { WFItems: [] });
  set('Page', output(noPage, 'List'));
  // Four literal bounds avoid relying on dynamic limit-field serialization.
  for (const n of [51, 102, 204, 408]) {
    condition(output(limit), n, () => { const page = find(n, 'Latest First', output(date)); set('Page', output(page, 'Message')); });
  }
  const found = count(variable('Page'));
  condition(output(found, 'Count'), 0, () => {
    alert('History paused safely', 'No page was returned at the saved position. This is not proof that history is complete. Your saved progress is retained.');
    open('wafra://ios-setup?section=history'); stop();
  });
  // Column framing first. Every list-wide action here is Apple's own: the
  // property aggrandizement maps over each Message and Combine Text joins the
  // results, so no per-message action runs and no App Intent array parameter
  // is bound (the binding path that failed on-device for the bulk intent).
  const literal = value => output(emit('is.workflow.actions.gettext', { WFTextActionText: text(value) }), 'Text');
  if (columnar) {
    set('Frame Mode', literal('columns'));
    const column = name => ({ ...variable('Page'), Aggrandizements: [property(name),
      { Type: 'WFCoercionVariableAggrandizement', CoercionItemClass: 'WFStringContentItem' }] });
    const combine = value => output(emit('is.workflow.actions.text.combine', {
      WFTextSeparator: 'Custom', WFTextCustomSeparator: COLUMN_SEPARATOR, text: attachment(value),
    }), 'Combined Text');
    const formatted = emit('is.workflow.actions.format.date', {
      WFDate: scalar({ ...variable('Page'), Aggrandizements: [property('date')] }),
      WFDateFormatStyle: 'Custom', WFTimeFormatStyle: 'None', WFDateFormat: "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
    });
    const guids = combine(column('GUID'));
    const bodies = combine(column('Body'));
    const senders = combine(column('Sender'));
    const dates = combine(output(formatted, 'Formatted Date'));
    set('Columns Result', output(native('StageWafraPagedColumnsIntent', {
      request: scalar(variable('Request')), found: attachment(output(found, 'Count')),
      guids: scalar(guids), bodies: scalar(bodies), senders: scalar(senders), dates: scalar(dates),
    })));
    const columnsDictionary = emit('is.workflow.actions.detect.dictionary', { WFInput: attachment(variable('Columns Result')) });
    const columnsStatus = get('status', output(columnsDictionary, 'Dictionary'));
    condition(output(columnsStatus), 'blocked', () => {
      const columnsReason = get('reason', output(columnsDictionary, 'Dictionary'));
      // Only a framing refusal falls back. Authorization, cursor, capacity
      // and storage refusals surface through the ordinary blocked path.
      for (const reason of ['frame-columns', 'invalid-input']) {
        condition(output(columnsReason), reason, () => { set('Frame Mode', literal('rows')); });
      }
    });
    condition(variable('Frame Mode'), 'columns', () => { set('Request', variable('Columns Result')); });
  }
  const rowsGroup = columnar ? uuid() : null;
  if (columnar) {
    emit('is.workflow.actions.conditional', { GroupingIdentifier: rowsGroup, WFControlFlowMode: 0,
      WFInput: { Type: 'Variable', Variable: attachment({ ...variable('Frame Mode'), Aggrandizements: [
        { Type: 'WFCoercionVariableAggrandizement', CoercionItemClass: 'WFStringContentItem' }] }) },
      WFCondition: 4, WFConditionalActionString: 'rows' });
  }
  if (rows) {
    // One typed native call per Message. GUID/Body/Sender use the explicit
    // Text coercion proven on-device; the date is the raw property.
    //
    // Device evidence (iPhone 16 Pro, iOS 26.6.2, 19 Sep 2026): this page
    // loop is NESTED inside the outer work-budget Repeat, and Shortcuts names
    // a nested loop's variables "Repeat Item 2" / "Repeat Index 2". A bare
    // "Repeat Item" here is the OUTER loop's item, the number 1: that is why
    // v2 formatted nonsense dates, why the v4 Date parameter prompted
    // "Message date", and why an index bound to "Repeat Index" staged the
    // first Message 51 times (staged=1 found=51). The row is fetched by the
    // inner index and every field is bound from that action output.
    const each = uuid();
    emit('is.workflow.actions.repeat.each', { GroupingIdentifier: each, WFControlFlowMode: 0, WFInput: attachment(variable('Page')) });
    const item = emit('is.workflow.actions.getitemfromlist', {
      // WFItemIndex is a number field: Apple keeps only the attachment wrapper there.
      WFItemSpecifier: 'Item At Index', WFItemIndex: attachment(variable('Repeat Index 2')), WFInput: attachment(variable('Page')),
    });
    const guid = field(output(item), 'GUID');
    const body = field(output(item), 'Body');
    const sender = field(output(item), 'Sender');
    native('StageWafraPagedRowIntent', {
      request: scalar(variable('Request')), guid: scalar(output(guid)), body: scalar(output(body)),
      sender: scalar(output(sender)), date: typedDate(output(item)),
    });
    nothing();
    emit('is.workflow.actions.repeat.each', { GroupingIdentifier: each, WFControlFlowMode: 2 });
    const committed = native('CommitWafraPagedPageIntent', { request: scalar(variable('Request')), found: attachment(output(found, 'Count')) });
    set('Request', output(committed));
    const releasedPage = emit('is.workflow.actions.list', { WFItems: [] });
    set('Page', output(releasedPage, 'List')); nothing();
    emit('is.workflow.actions.repeat.count', { GroupingIdentifier: loop, WFControlFlowMode: 2 });
    alert('History paused', 'The work budget was reached. Your saved pages are retained; resume from Wafra. This is not a completed history import.');
    open('wafra://ios-setup?section=history'); stop();
    const workflow = buildHistoryShortcut({ messageLimit: 1500, smoke: false });
    workflow.WFWorkflowName = ROW_SHORTCUT_NAME;
    workflow.WFWorkflowActions = actions;
    workflow.WFWorkflowImportQuestions = [];
    return workflow;
  }
  const empty = emit('is.workflow.actions.list', { WFItems: [] });
  set('Encoded Page', output(empty, 'List'));
  const each = uuid();
  emit('is.workflow.actions.repeat.each', { GroupingIdentifier: each, WFControlFlowMode: 0, WFInput: attachment(variable('Page')) });
  const guid = field(variable('Repeat Item'), 'GUID');
  const body = field(variable('Repeat Item'), 'Body');
  const sender = field(variable('Repeat Item'), 'Sender');
  const received = dateText(variable('Repeat Item'));
  // Do not coerce a Shortcut Dictionary to Text here. On-device that coercion
  // is not guaranteed to be JSON, which made the first real page fail native
  // validation with `invalid-input`. Frame four independently base64-encoded
  // scalar fields instead; base64 never contains `|`, so the native parser can
  // split this deterministically without retaining Message entities.
  const guid64 = emit('is.workflow.actions.base64encode', { WFEncodeMode: 'Encode', WFBase64LineBreakMode: 'None', WFInput: attachment(output(guid)) });
  const body64 = emit('is.workflow.actions.base64encode', { WFEncodeMode: 'Encode', WFBase64LineBreakMode: 'None', WFInput: attachment(output(body)) });
  const sender64 = emit('is.workflow.actions.base64encode', { WFEncodeMode: 'Encode', WFBase64LineBreakMode: 'None', WFInput: attachment(output(sender)) });
  const date64 = emit('is.workflow.actions.base64encode', { WFEncodeMode: 'Encode', WFBase64LineBreakMode: 'None', WFInput: attachment(output(received)) });
  const record = emit('is.workflow.actions.gettext', { WFTextActionText: text('\ufffc|\ufffc|\ufffc|\ufffc', {
    '{0, 1}': output(guid64, 'Base64 Encoded'), '{2, 1}': output(body64, 'Base64 Encoded'),
    '{4, 1}': output(sender64, 'Base64 Encoded'), '{6, 1}': output(date64, 'Base64 Encoded'),
  }) });
  emit('is.workflow.actions.appendvariable', { WFVariableName: 'Encoded Page', WFInput: attachment(output(record, 'Text')) });
  nothing();
  emit('is.workflow.actions.repeat.each', { GroupingIdentifier: each, WFControlFlowMode: 2 });
  // Combine Text's input parameter is keyed `text`, not `WFInput`. With the
  // wrong key Shortcuts ignores the value and feeds the previous action's
  // output instead: the Repeat's results, which are empty because the loop
  // ends with Nothing. That is why every device run of the published record
  // (`5a0da9b5…`) handed Wafra an empty frame (`fragments=0 … found=51`).
  const frame = emit('is.workflow.actions.text.combine', { WFTextSeparator: 'New Lines', text: attachment(variable('Encoded Page')) });
  const response = native('StageWafraPagedImportIntent', { request: scalar(variable('Request')), found: attachment(output(found, 'Count')), frame: scalar(output(frame, 'Combined Text')) });
  set('Request', output(response));
  if (columnar) emit('is.workflow.actions.conditional', { GroupingIdentifier: rowsGroup, WFControlFlowMode: 2 });
  const released = emit('is.workflow.actions.list', { WFItems: [] });
  set('Page', output(released, 'List')); set('Encoded Page', output(released, 'List'));
  if (columnar) set('Columns Result', output(released, 'List'));
  nothing();
  emit('is.workflow.actions.repeat.count', { GroupingIdentifier: loop, WFControlFlowMode: 2 });
  alert('History paused', 'The work budget was reached. Your saved pages are retained; resume from Wafra. This is not a completed history import.');
  open('wafra://ios-setup?section=history'); stop();

  const workflow = buildHistoryShortcut({ messageLimit: 1500, smoke: false });
  workflow.WFWorkflowName = columnar ? COLUMNAR_SHORTCUT_NAME : PAGED_SHORTCUT_NAME;
  workflow.WFWorkflowActions = actions;
  workflow.WFWorkflowImportQuestions = [];
  return workflow;
}

function verifyBoundedSourceFreeGraph(workflow, expected, label) {
  if (!isDeepStrictEqual(workflow, expected)) throw new Error(`${label} graph differs from the audited generator`);
  const text = JSON.stringify(workflow);
  if (/https?:|downloadurl|clipboard|savefile|appendfile|sendmessage|sendemail/.test(text)) throw new Error('Forbidden external/source-output action');
  const queries = workflow.WFWorkflowActions.filter(a => a.WFWorkflowActionIdentifier === 'com.apple.MobileSMS.MessageEntity');
  if (queries.length !== 6 || queries.some(a => ![1, 51, 102, 204, 408].includes(a.WFWorkflowActionParameters.WFContentItemLimitNumber))) throw new Error('Unbounded query');
  return true;
}
export function verifyPagedHistoryShortcut(workflow) {
  return verifyBoundedSourceFreeGraph(workflow, buildPagedHistoryShortcut(), 'Paged');
}
export function verifyColumnarHistoryShortcut(workflow) {
  return verifyBoundedSourceFreeGraph(workflow, buildColumnarHistoryShortcut(), 'Columnar');
}
export function verifyRowHistoryShortcut(workflow) {
  verifyBoundedSourceFreeGraph(workflow, buildRowHistoryShortcut(), 'Row');
  const text = JSON.stringify(workflow);
  if (/format\.date|detect\.date|base64encode|text\.combine/.test(text)) throw new Error('Row graph must not format dates or frame text');
  return true;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const columnar = process.argv.includes('--columnar');
  const rows = process.argv.includes('--rows');
  const target = resolve(process.argv.filter(arg => !arg.startsWith('--'))[2]
    ?? (rows ? '/tmp/WafraHistoryRows.json' : columnar ? '/tmp/WafraHistoryColumnar.json' : '/tmp/WafraHistoryImport.json'));
  const workflow = rows ? buildRowHistoryShortcut() : columnar ? buildColumnarHistoryShortcut() : buildPagedHistoryShortcut();
  (rows ? verifyRowHistoryShortcut : columnar ? verifyColumnarHistoryShortcut : verifyPagedHistoryShortcut)(workflow);
  writeFileSync(target, JSON.stringify(workflow, null, 2) + '\n'); console.log(target);
}
