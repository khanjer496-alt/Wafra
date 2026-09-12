#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildPagedHistoryShortcut } from './build-ios-paged-history-shortcut.mjs';

// Use the exact shipping extraction graph, then stop before Wafra is invoked.
// Only field lengths leave the local action variables. No source values, ledger
// writes, network, files or clipboard operations are part of this diagnostic.
export function buildHistoryInputProbe() {
  const workflow = buildPagedHistoryShortcut();
  const beginIndex = workflow.WFWorkflowActions.findIndex(action =>
    action.WFWorkflowActionIdentifier === 'app.wafra.ios.BeginWafraPagedImportIntent');
  if (beginIndex < 0) throw new Error('Missing paging boundary');
  const begin = workflow.WFWorkflowActions[beginIndex].WFWorkflowActionParameters;
  workflow.WFWorkflowActions = workflow.WFWorkflowActions.slice(0, beginIndex);
  workflow.WFWorkflowName = 'Wafra History Input Check';
  Object.assign(workflow.WFWorkflowActions[0].WFWorkflowActionParameters, {
    WFAlertActionTitle: 'Check history input',
    WFAlertActionMessage: 'This reads only the oldest and newest message metadata. The result shows field lengths, never identifiers, dates or message text. It does not start an import or change Wafra.',
  });
  let index = 0;
  const emit = (identifier, parameters) => {
    const UUID = `C17D0000-0000-4000-8000-${String(++index).padStart(12, '0')}`;
    workflow.WFWorkflowActions.push({ WFWorkflowActionIdentifier: identifier,
      WFWorkflowActionParameters: { UUID, ...parameters } });
    return { Type: 'ActionOutput', OutputUUID: UUID, OutputName: 'Count' };
  };
  let summary = 'WAFRA_HISTORY_INPUT_CHECK_V1\nZero means a required field is missing.\n';
  const attachmentsByRange = {};
  for (const field of ['oldestGUID', 'oldestDate', 'newestGUID', 'newestDate']) {
    const count = emit('is.workflow.actions.count', {
      WFCountType: 'Characters', Input: begin[field], WFInput: begin[field],
    });
    summary += `${field} length: `;
    attachmentsByRange[`{${summary.length}, 1}`] = count;
    summary += '\ufffc\n';
  }
  emit('is.workflow.actions.alert', {
    WFAlertActionTitle: 'History input check result',
    WFAlertActionMessage: { Value: { string: summary, attachmentsByRange }, WFSerializationType: 'WFTextTokenString' },
    WFAlertActionCancelButtonShown: false,
  });
  emit('is.workflow.actions.exit', {});
  return workflow;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const target = resolve(process.argv[2] ?? '/tmp/Wafra History Input Check.json');
  writeFileSync(target, JSON.stringify(buildHistoryInputProbe(), null, 2) + '\n');
  console.log(target);
}
