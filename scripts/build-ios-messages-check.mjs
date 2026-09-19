#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildHistoryShortcut } from './build-ios-history-shortcut.mjs';

// Support diagnostic: "Wafra Messages Check". Runs the exact Find Messages
// query shapes the history graphs use, one at a time, each announced by an
// alert first. Apple's own error alert names only the action ("Find Message"),
// so the preceding "Step N" alert is what identifies the failing shape. Shows
// counts only; no message text, sender or date leaves the alert. No Wafra
// App Intent is called, so it runs on any iPhone with Shortcuts.
export const MESSAGES_CHECK_NAME = 'Wafra Messages Check';
export function buildMessagesCheck() {
  let serial = 0;
  const actions = [];
  const uuid = () => `C19A0000-0000-4000-8000-${String(++serial).padStart(12, '0')}`;
  const output = (id, name = 'Result') => ({ Type: 'ActionOutput', OutputUUID: id, OutputName: name });
  const attachment = value => ({ Value: value, WFSerializationType: 'WFTextTokenAttachment' });
  const text = (string, attachmentsByRange) => ({ Value: { string, ...(attachmentsByRange ? { attachmentsByRange } : {}) }, WFSerializationType: 'WFTextTokenString' });
  const scalar = value => text('￼', { '{0, 1}': value });
  const emit = (identifier, parameters = {}) => {
    const id = uuid(); actions.push({ WFWorkflowActionIdentifier: identifier, WFWorkflowActionParameters: { UUID: id, ...parameters } }); return id;
  };
  const alert = (title, message) => emit('is.workflow.actions.alert', { WFAlertActionTitle: title, WFAlertActionMessage: message, WFAlertActionCancelButtonShown: false });
  const descriptor = { TeamIdentifier: '0000000000', BundleIdentifier: 'com.apple.MobileSMS', Name: 'Messages', AppIntentIdentifier: 'MessageEntity', ActionRequiresAppInstallation: true };
  const find = ({ sort, order, limit, filters, template = true }) => emit('com.apple.MobileSMS.MessageEntity', {
    AppIntentDescriptor: descriptor,
    ...(template ? { WFContentItemFilter: { WFSerializationType: 'WFContentPredicateTableTemplate', Value: {
      WFActionParameterFilterPrefix: 1, WFContentPredicateBoundedDate: false, WFActionParameterFilterTemplates: filters ?? [],
    } } } : {}),
    ...(sort ? { WFContentItemSortProperty: sort, WFContentItemSortOrder: order } : {}),
    WFContentItemLimitEnabled: true, WFContentItemLimitNumber: limit,
  });
  const count = value => emit('is.workflow.actions.count', { WFCountType: 'Items', Input: attachment(value), WFInput: attachment(value) });
  const step = (number, label, query) => {
    alert(`Step ${number} of 6`, `Now testing: ${label}. If Apple shows an error after this, the failing shape is step ${number}.`);
    const found = count(output(query(), 'Message'));
    alert(`Step ${number} passed`, text(`${label}: ￼ message(s)`, { [`{${label.length + 2}, 1}`]: output(found, 'Count') }));
  };
  const now = emit('is.workflow.actions.date', { WFDateActionMode: 'Current Date' });
  const ago = emit('is.workflow.actions.adjustdate', {
    WFDate: scalar(output(now, 'Current Date')), WFAdjustOperation: 'Subtract',
    WFDuration: { Value: { Magnitude: 90, Unit: 'days' }, WFSerializationType: 'WFQuantityFieldValue' },
  });
  const after = { Property: 'date', Operator: 2, Removable: true, Values: { Unit: 4, Date: scalar(output(ago, 'Adjusted Date')) } };
  const before = { Property: 'date', Operator: 0, Removable: true, Values: { Unit: 4, Date: scalar(output(now, 'Current Date')) } };

  alert('Wafra Messages Check', 'Six short tests of how this iPhone answers Messages queries. Only counts are shown; no message text is read into Wafra or sent anywhere. Tap OK after each step.');
  step(1, 'no sort, 2 items', () => find({ limit: 2, template: false }));
  step(2, 'sort by date, latest first, 1 item', () => find({ sort: 'date', order: 'Latest First', limit: 1, template: false }));
  step(3, 'sort by date with the empty filter table, 1 item', () => find({ sort: 'date', order: 'Latest First', limit: 1 }));
  step(4, 'sort by date, oldest first, 1 item', () => find({ sort: 'date', order: 'Oldest First', limit: 1 }));
  step(5, 'last 90 days window, sorted, up to 51', () => find({ sort: 'date', order: 'Latest First', limit: 51, filters: [after, before] }));
  step(6, 'last 90 days window, no sort, up to 51', () => find({ limit: 51, filters: [after, before] }));
  alert('All six passed', 'Every query shape works on this iPhone. Send Wafra a screenshot of this screen together with the step counts.');
  emit('is.workflow.actions.exit');

  const workflow = buildHistoryShortcut({ messageLimit: 1500, smoke: false });
  workflow.WFWorkflowName = MESSAGES_CHECK_NAME; workflow.WFWorkflowActions = actions; workflow.WFWorkflowImportQuestions = [];
  return workflow;
}
export function verifyMessagesCheck(workflow) {
  const text = JSON.stringify(workflow);
  if (/app\.wafra\.|https?:|downloadurl|clipboard|savefile|appendfile|sendmessage|sendemail/.test(text)) throw new Error('Diagnostic must call no Wafra intent and leave nothing');
  const queries = workflow.WFWorkflowActions.filter(a => a.WFWorkflowActionIdentifier === 'com.apple.MobileSMS.MessageEntity');
  if (queries.length !== 6 || queries.some(a => a.WFWorkflowActionParameters.WFContentItemLimitNumber > 51)) throw new Error('Unbounded query');
  return true;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const target = resolve(process.argv[2] ?? '/tmp/WafraMessagesCheck.json');
  const workflow = buildMessagesCheck(); verifyMessagesCheck(workflow);
  writeFileSync(target, JSON.stringify(workflow, null, 2) + '\n'); console.log(target);
}
