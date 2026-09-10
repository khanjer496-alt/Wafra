#!/usr/bin/env node
// Read-only capability probe. Returns counts, never message text/senders/IDs.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildHistoryShortcut } from './build-ios-history-shortcut.mjs';

const id = n => `C17C0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const outValue = (n, name) => ({ Type: 'ActionOutput', OutputUUID: id(n), OutputName: name });
const out = (n, name) => ({ Value: outValue(n, name), WFSerializationType: 'WFTextTokenAttachment' });
const token = (string, attachmentsByRange) => ({ Value: { string, ...(attachmentsByRange ? { attachmentsByRange } : {}) }, WFSerializationType: 'WFTextTokenString' });
const scalar = (n, name) => token('\ufffc', { '{0, 1}': outValue(n, name) });
const action = (identifier, n, parameters) => ({ WFWorkflowActionIdentifier: identifier, WFWorkflowActionParameters: { UUID: id(n), ...parameters } });
const date = (n, value) => action('is.workflow.actions.date', n, { WFDateActionMode: 'Specified Date', WFDateActionDate: value });
const count = (n, input) => action('is.workflow.actions.count', n, { WFCountType: 'Items', Input: out(input, 'Message'), WFInput: out(input, 'Message') });
function find(n, filter = null) {
  return action('com.apple.MobileSMS.MessageEntity', n, {
    AppIntentDescriptor: { TeamIdentifier: '0000000000', BundleIdentifier: 'com.apple.MobileSMS', Name: 'Messages', AppIntentIdentifier: 'MessageEntity', ActionRequiresAppInstallation: true },
    WFContentItemFilter: { WFSerializationType: 'WFContentPredicateTableTemplate', Value: {
      WFActionParameterFilterPrefix: 1, WFContentPredicateBoundedDate: false,
      WFActionParameterFilterTemplates: filter ? [filter] : [],
    } },
    WFContentItemSortProperty: 'date', WFContentItemSortOrder: 'Latest First',
    WFContentItemLimitEnabled: true, WFContentItemLimitNumber: 5,
  });
}

export function buildQueryProbe() {
  const workflow = buildHistoryShortcut({ messageLimit: 1500, smoke: false });
  workflow.WFWorkflowName = 'Wafra History Query Check';
  workflow.WFWorkflowImportQuestions = [];
  const before = { Property: 'date', Operator: 0, Removable: true, Values: { Unit: 4, Date: out(1, 'Date') } };
  const after = { Property: 'date', Operator: 2, Removable: true, Values: { Unit: 4, Date: out(4, 'Date') } };
  // Exact old producer binding first; then scalar-text binding as a separate probe.
  const beforeScalar = structuredClone(before); beforeScalar.Values.Date = scalar(1, 'Date');
  const afterScalar = structuredClone(after); afterScalar.Values.Date = scalar(4, 'Date');
  const fields = [
    ['unfiltered', 8], ['before1900_attachment', 3], ['after2100_attachment', 6],
    ['before1900_scalar', 10], ['after2100_scalar', 12],
  ];
  let text = 'WAFRA_QUERY_PROBE_V1\n'; const attachments = {};
  for (const [name, n] of fields) {
    text += `${name}=`; attachments[`{${text.length}, 1}`] = outValue(n, 'Count'); text += '\ufffc\n';
  }
  workflow.WFWorkflowActions = [
    action('is.workflow.actions.comment', 90, { WFCommentActionText: 'Read-only diagnostic: five bounded queries. Output contains only counts. No network, Files, clipboard, Wafra ledger, or automatic permission changes.' }),
    date(1, '1900-01-01T00:00:00Z'), find(2, before), count(3, 2),
    action('is.workflow.actions.nothing', 31, {}),
    date(4, '2100-01-01T00:00:00Z'), find(5, after), count(6, 5),
    action('is.workflow.actions.nothing', 61, {}),
    find(7), count(8, 7), action('is.workflow.actions.nothing', 81, {}),
    find(9, beforeScalar), count(10, 9), action('is.workflow.actions.nothing', 101, {}),
    find(11, afterScalar), count(12, 11), action('is.workflow.actions.nothing', 121, {}),
    action('is.workflow.actions.gettext', 99, { WFTextActionText: token(text, attachments) }),
    action('is.workflow.actions.alert', 100, {
      WFAlertActionTitle: 'Wafra query check result',
      WFAlertActionMessage: scalar(99, 'Text'), WFAlertActionCancelButtonShown: false,
    }),
    action('is.workflow.actions.exit', 102, {}),
  ];
  return workflow;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const path = resolve(process.argv[2] ?? '/tmp/WafraHistoryQueryCheck.json');
  writeFileSync(path, JSON.stringify(buildQueryProbe(), null, 2) + '\n'); console.log(path);
}
