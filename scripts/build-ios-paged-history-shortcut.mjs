#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildHistoryShortcut } from './build-ios-history-shortcut.mjs';

// This is a separate, opt-in beta artifact. Never overwrite the public V3 graph.
export const PAGED_SHORTCUT_NAME = 'Wafra History Paging Beta';
export function buildPagedHistoryShortcut() {
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
    emit('is.workflow.actions.conditional', { GroupingIdentifier: group, WFControlFlowMode: 0, WFInput: { Type: 'Variable', Variable: attachment(value) }, WFCondition: 4,
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
  const field = (value, name, customOutputName) => ({ id: emit('is.workflow.actions.gettext', { CustomOutputName: customOutputName, WFTextActionText: scalar({ ...value,
    Aggrandizements: [property(name), { Type: 'WFCoercionVariableAggrandizement', CoercionItemClass: 'WFStringContentItem' }] }) }), name: customOutputName });
  const dateText = (value, customOutputName) => ({ id: emit('is.workflow.actions.format.date', {
    CustomOutputName: customOutputName,
    WFDate: scalar({ ...value, Aggrandizements: [property('date')] }),
    WFDateFormatStyle: 'Custom', WFTimeFormatStyle: 'None',
    WFDateFormat: "yyyy-MM-dd'T'HH:mm:ssXXX",
  }), name: customOutputName });
  const native = (name, parameters) => emit(`app.wafra.ios.${name}`, {
    AppIntentDescriptor: { TeamIdentifier: 'UV7YN4GQ66', BundleIdentifier: 'app.wafra.ios', Name: 'Wafra', AppIntentIdentifier: name }, ...parameters,
  });
  const open = value => {
    const url = emit('is.workflow.actions.url', { WFURLActionURL: value });
    emit('is.workflow.actions.openurl', { WFInput: attachment(output(url, 'URL')) });
  };

  alert('Import available message history', 'This test Shortcut processes history locally in automatic pages. Keep this iPhone unlocked and Shortcuts open. Saved pages survive interruptions for up to 24 hours. Wafra opens for review only after the extractor verifies its final page. Nothing is uploaded.', true);
  const oldest = find(1, 'Oldest First'); const oldestCount = count(output(oldest, 'Message'));
  const newest = find(1, 'Latest First'); const newestCount = count(output(newest, 'Message'));
  condition(output(oldestCount, 'Count'), 0, () => {
    condition(output(newestCount, 'Count'), 0, () => { alert('No available messages', 'Messages returned no available history. Nothing was added to Wafra.'); stop(); });
    alert('Messages changed', 'The two initial queries disagreed. No history was started.'); stop();
  });
  condition(output(newestCount, 'Count'), 0, () => { alert('Messages changed', 'The initial queries disagreed. No history was started.'); stop(); });
  const oldestItem = emit('is.workflow.actions.getitemfromlist', { WFItemSpecifier: 'First Item', WFInput: attachment(output(oldest, 'Message')) });
  const oldestGUID = field(output(oldestItem), 'GUID', 'Oldest Message GUID'); const oldestDate = dateText(output(oldestItem), 'Oldest Message Date');
  const newestItem = emit('is.workflow.actions.getitemfromlist', { WFItemSpecifier: 'First Item', WFInput: attachment(output(newest, 'Message')) });
  const newestGUID = field(output(newestItem), 'GUID', 'Newest Message GUID'); const newestDate = dateText(output(newestItem), 'Newest Message Date');
  const initial = native('BeginWafraPagedImportIntent', {
    oldestGUID: scalar(output(oldestGUID.id, oldestGUID.name)), oldestDate: scalar(output(oldestDate.id, oldestDate.name)),
    newestGUID: scalar(output(newestGUID.id, newestGUID.name)), newestDate: scalar(output(newestDate.id, newestDate.name)),
  });
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
    open('wafra://ios-paging-beta'); stop();
  });
  const before = get('before', output(dictionary, 'Dictionary'));
  const limit = get('limit', output(dictionary, 'Dictionary'));
  const dates = emit('is.workflow.actions.detect.date', { WFInput: scalar(output(before)) });
  const date = emit('is.workflow.actions.getitemfromlist', { WFItemSpecifier: 'First Item', WFInput: attachment(output(dates, 'Dates')) });
  // Four literal bounds avoid relying on dynamic limit-field serialization.
  for (const n of [51, 102, 204, 408]) {
    condition(output(limit), n, () => { const page = find(n, 'Latest First', output(date, 'Date')); set('Page', output(page, 'Message')); });
  }
  const found = count(variable('Page'));
  const empty = emit('is.workflow.actions.list', { WFItems: [] });
  set('Encoded Page', output(empty, 'List'));
  const each = uuid();
  emit('is.workflow.actions.repeat.each', { GroupingIdentifier: each, WFControlFlowMode: 0, WFInput: attachment(variable('Page')) });
  const guid = field(variable('Repeat Item'), 'GUID', 'Message GUID');
  const body = field(variable('Repeat Item'), 'Body', 'Message Body');
  const sender = field(variable('Repeat Item'), 'Sender', 'Message Sender');
  const received = dateText(variable('Repeat Item'), 'Message Date');
  const record = emit('is.workflow.actions.dictionary', { WFItems: { WFSerializationType: 'WFDictionaryFieldValue', Value: {
    WFDictionaryFieldValueItems: [['guid', guid], ['body', body], ['sender', sender], ['date', received]].map(([key, value]) => ({
      WFKey: text(key), WFItemType: 0, WFValue: scalar(output(value.id, value.name)),
    })),
  } } });
  const serialized = emit('is.workflow.actions.gettext', { WFTextActionText: scalar(output(record, 'Dictionary', {
    Aggrandizements: [{ Type: 'WFCoercionVariableAggrandizement', CoercionItemClass: 'WFStringContentItem' }],
  })) });
  const encodedRecord = emit('is.workflow.actions.base64encode', { WFEncodeMode: 'Encode', WFBase64LineBreakMode: 'None', WFInput: attachment(output(serialized, 'Text')) });
  emit('is.workflow.actions.appendvariable', { WFVariableName: 'Encoded Page', WFInput: attachment(output(encodedRecord, 'Base64 Encoded')) });
  nothing();
  emit('is.workflow.actions.repeat.each', { GroupingIdentifier: each, WFControlFlowMode: 2 });
  const frame = emit('is.workflow.actions.text.combine', { WFTextSeparator: 'New Lines', WFInput: attachment(variable('Encoded Page')) });
  const response = native('StageWafraPagedImportIntent', { request: scalar(variable('Request')), found: attachment(output(found, 'Count')), frame: scalar(output(frame, 'Combined Text')) });
  set('Request', output(response)); nothing();
  emit('is.workflow.actions.repeat.count', { GroupingIdentifier: loop, WFControlFlowMode: 2 });
  alert('History paused', 'The work budget was reached. Your saved pages are retained; resume from Wafra. This is not a completed history import.');
  open('wafra://ios-paging-beta'); stop();

  const workflow = buildHistoryShortcut({ messageLimit: 1500, smoke: false });
  workflow.WFWorkflowName = PAGED_SHORTCUT_NAME; workflow.WFWorkflowActions = actions;
  workflow.WFWorkflowImportQuestions = [];
  return workflow;
}

export function verifyPagedHistoryShortcut(workflow) {
  if (JSON.stringify(workflow) !== JSON.stringify(buildPagedHistoryShortcut())) throw new Error('Paged graph differs from the audited generator');
  const text = JSON.stringify(workflow);
  if (/https?:|downloadurl|clipboard|savefile|appendfile|sendmessage|sendemail/.test(text)) throw new Error('Forbidden external/source-output action');
  const queries = workflow.WFWorkflowActions.filter(a => a.WFWorkflowActionIdentifier === 'com.apple.MobileSMS.MessageEntity');
  if (queries.length !== 6 || queries.some(a => ![1, 51, 102, 204, 408].includes(a.WFWorkflowActionParameters.WFContentItemLimitNumber))) throw new Error('Unbounded query');
  return true;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const target = resolve(process.argv[2] ?? '/tmp/WafraHistoryPagingBeta.json');
  const workflow = buildPagedHistoryShortcut(); verifyPagedHistoryShortcut(workflow);
  writeFileSync(target, JSON.stringify(workflow, null, 2) + '\n'); console.log(target);
}
