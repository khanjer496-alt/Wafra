import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { action, output, textOutput, text, value, alert, count, findMessages, datePredicate, makeShortcut } from './lib/history-shortcut-graph.mjs';

/** Bounded, standalone device diagnostic. Each of four queries returns at most
 * three Message references. Only counts are used; no body, sender, GUID, file,
 * clipboard, network, Wafra action or transaction write is part of this graph.
 * This tests Apple's predicate behavior, not total inbox coverage or import.
 */
export function buildQuickHistoryCheck() {
  const actions = [
    alert('quick consent', 'Wafra history check',
      'Check four small Message queries on this iPhone. Each returns at most three references. This Shortcut uses only their counts; it does not extract message text or senders, upload data, or change Wafra. You may cancel.', true),
    action('is.workflow.actions.date', 'Quick start', { WFDateActionMode: 'Current Date' }),
    action('is.workflow.actions.adjustdate', 'Quick future', { WFDate: textOutput('Quick start'),
      WFAdjustOperation: 'Add', WFDuration: { Value: { Magnitude: 2, Unit: 'years' }, WFSerializationType: 'WFQuantityFieldValue' } }),
    findMessages('Quick newest', { limit: 3 }), count('Newest', output('Quick newest')),
    findMessages('Quick oldest', { limit: 3, order: 'Oldest First' }), count('Oldest', output('Quick oldest')),
    findMessages('Quick after future', { limit: 3, predicates: [datePredicate(2, output('Quick future'))] }),
    count('Future', output('Quick after future')),
    findMessages('Quick before future', { limit: 3, predicates: [datePredicate(0, output('Quick future'))] }),
    count('Before future', output('Quick before future')),
    action('is.workflow.actions.nothing', 'Release quick query output'),
  ];
  let message = 'Wafra quick history check\n'; const attachments = {};
  for (const label of ['Newest', 'Oldest', 'Future', 'Before future']) {
    message += label + ': '; attachments[`{${message.length}, 1}`] = value(label); message += '\ufffc\n';
  }
  message += '\nSend a screenshot of these four counts. No messages were imported. These small samples do not prove full-history coverage.';
  actions.push(alert('Quick result', 'History check result', text(message, attachments)));
  return makeShortcut('Wafra Quick History Check', actions);
}

export function verifyQuickHistoryCheck(graph) {
  if (!isDeepStrictEqual(graph, buildQuickHistoryCheck())) throw Error('quick_history_graph_changed');
  const queries = graph.WFWorkflowActions.filter(a => a.WFWorkflowActionIdentifier === 'com.apple.MobileSMS.MessageEntity');
  if (queries.length !== 4 || queries.some(a => a.WFWorkflowActionParameters.WFContentItemLimitEnabled !== true ||
      a.WFWorkflowActionParameters.WFContentItemLimitNumber !== 3)) throw Error('quick_history_unbounded');
  if (graph.WFWorkflowActions.some(a => /downloadurl|openurl|runworkflow|clipboard|savefile|sendmessage|app\.wafra/.test(a.WFWorkflowActionIdentifier))) throw Error('quick_history_unsafe_action');
  if (/"PropertyName"/.test(JSON.stringify(graph))) throw Error('quick_history_extracts_property');
  return true;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const graph = buildQuickHistoryCheck(); verifyQuickHistoryCheck(graph);
  const destination = resolve(process.argv[2] ?? 'Wafra Quick History Check.json');
  await writeFile(destination, JSON.stringify(graph, null, 2) + '\n');
  console.log(destination);
}
