#!/usr/bin/env node
// Read-only capability probe for column framing. It answers one question on a
// real iPhone before the v3 History graph is published: does a list-wide
// property read plus Combine Text yield exactly one item per Message, for GUID,
// Body, Sender and formatted Date alike — including Messages with no text or
// no sender? The alert shows counts only. No Wafra App Intent, network, Files,
// clipboard or ledger action is involved.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildHistoryShortcut } from './build-ios-history-shortcut.mjs';
import { COLUMN_SEPARATOR } from './build-ios-paged-history-shortcut.mjs';

export const COLUMN_PROBE_NAME = 'Wafra Column Frame Check';
export const COLUMN_PROBE_LIMIT = 25;

export function buildColumnFrameProbe() {
  let serial = 0;
  const actions = [];
  const uuid = () => `C17D0000-0000-4000-8000-${String(++serial).padStart(12, '0')}`;
  const outValue = (id, name) => ({ Type: 'ActionOutput', OutputUUID: id, OutputName: name });
  const attachment = value => ({ Value: value, WFSerializationType: 'WFTextTokenAttachment' });
  const text = (string, attachmentsByRange) => ({ Value: { string, ...(attachmentsByRange ? { attachmentsByRange } : {}) }, WFSerializationType: 'WFTextTokenString' });
  const scalar = value => text('￼', { '{0, 1}': value });
  const property = name => ({ Type: 'WFPropertyVariableAggrandizement', PropertyName: name });
  const emit = (identifier, parameters = {}) => {
    const id = uuid(); actions.push({ WFWorkflowActionIdentifier: identifier, WFWorkflowActionParameters: { UUID: id, ...parameters } }); return id;
  };
  const count = value => outValue(emit('is.workflow.actions.count', { WFCountType: 'Items', Input: attachment(value), WFInput: attachment(value) }), 'Count');

  emit('is.workflow.actions.comment', { WFCommentActionText: 'Read-only diagnostic: one bounded query. Output contains only counts. No network, Files, clipboard, Wafra ledger, or automatic permission changes.' });
  const find = emit('com.apple.MobileSMS.MessageEntity', {
    AppIntentDescriptor: { TeamIdentifier: '0000000000', BundleIdentifier: 'com.apple.MobileSMS', Name: 'Messages', AppIntentIdentifier: 'MessageEntity', ActionRequiresAppInstallation: true },
    WFContentItemFilter: { WFSerializationType: 'WFContentPredicateTableTemplate', Value: {
      WFActionParameterFilterPrefix: 1, WFContentPredicateBoundedDate: false, WFActionParameterFilterTemplates: [],
    } },
    WFContentItemSortProperty: 'date', WFContentItemSortOrder: 'Latest First',
    WFContentItemLimitEnabled: true, WFContentItemLimitNumber: COLUMN_PROBE_LIMIT,
  });
  const page = outValue(find, 'Message');
  const messages = count(page);
  // The exact column construction the v3 graph uses, applied to the same
  // Message list, then split back apart so only item counts leave the run.
  const column = name => ({ ...page, Aggrandizements: [property(name),
    { Type: 'WFCoercionVariableAggrandizement', CoercionItemClass: 'WFStringContentItem' }] });
  const combine = value => outValue(emit('is.workflow.actions.text.combine', {
    WFTextSeparator: 'Custom', WFTextCustomSeparator: COLUMN_SEPARATOR, text: attachment(value),
  }), 'Combined Text');
  const split = value => outValue(emit('is.workflow.actions.text.split', {
    WFTextSeparator: 'Custom', WFTextCustomSeparator: COLUMN_SEPARATOR, text: scalar(value),
  }), 'Split Text');
  const formatted = emit('is.workflow.actions.format.date', {
    WFDate: scalar({ ...page, Aggrandizements: [property('date')] }),
    WFDateFormatStyle: 'Custom', WFTimeFormatStyle: 'None', WFDateFormat: "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
  });
  const columns = [
    ['guids', count(split(combine(column('GUID'))))],
    ['bodies', count(split(combine(column('Body'))))],
    ['senders', count(split(combine(column('Sender'))))],
    ['dates', count(split(combine(outValue(formatted, 'Formatted Date'))))],
  ];
  let summary = 'WAFRA_COLUMN_PROBE_V1\n'; const attachments = {};
  for (const [name, value] of [['messages', messages], ...columns]) {
    summary += `${name}=`; attachments[`{${summary.length}, 1}`] = value; summary += '￼\n';
  }
  const rendered = emit('is.workflow.actions.gettext', { WFTextActionText: text(summary, attachments) });
  emit('is.workflow.actions.alert', {
    WFAlertActionTitle: 'Wafra column frame check',
    WFAlertActionMessage: scalar(outValue(rendered, 'Text')), WFAlertActionCancelButtonShown: false,
  });
  emit('is.workflow.actions.exit');

  const workflow = buildHistoryShortcut({ messageLimit: 1500, smoke: false });
  workflow.WFWorkflowName = COLUMN_PROBE_NAME; workflow.WFWorkflowActions = actions;
  workflow.WFWorkflowImportQuestions = [];
  return workflow;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const target = resolve(process.argv[2] ?? '/tmp/WafraColumnFrameCheck.json');
  writeFileSync(target, JSON.stringify(buildColumnFrameProbe(), null, 2) + '\n'); console.log(target);
}
