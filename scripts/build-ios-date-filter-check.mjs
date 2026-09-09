import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { buildQuickHistoryCheck } from './build-ios-quick-history-check.mjs';
import { action, textOutput, text, value, alert } from './lib/history-shortcut-graph.mjs';

// Same four count-only bounded queries, with the synthetic boundary displayed.
// No message's date, ID, body or sender is exposed by this diagnostic.
export function buildDateFilterCheck() {
  const graph = buildQuickHistoryCheck();
  graph.WFWorkflowName = 'Wafra Date Filter Check v2';
  graph.WFWorkflowActions.splice(3, 0,
    action('is.workflow.actions.format.date', 'Displayed future boundary', {
      WFDate: textOutput('Quick future'), WFDateFormatStyle: 'Custom',
      WFTimeFormatStyle: 'None', WFDateFormat: "yyyy-MM-dd'T'HH:mm:ssXXX",
    }));
  let content = 'Wafra date filter check v2\n'; const attachments = {};
  for (const [label, name] of [['Query boundary', 'Displayed future boundary'],
    ['Newest', 'Newest'], ['Oldest', 'Oldest'], ['Future', 'Future'], ['Before future', 'Before future']]) {
    content += label + ': '; attachments[`{${content.length}, 1}`] = value(name); content += '\ufffc\n';
  }
  content += '\nThe boundary is a test date, not a message date. No messages were imported.';
  graph.WFWorkflowActions[graph.WFWorkflowActions.length - 1] = alert('Date binding result', 'Date filter result', text(content, attachments));
  return graph;
}
export function verifyDateFilterCheck(graph) {
  if (!isDeepStrictEqual(graph, buildDateFilterCheck())) throw Error('date_filter_check_changed');
  if (/"PropertyName"|downloadurl|clipboard|savefile|app\.wafra/.test(JSON.stringify(graph))) throw Error('date_filter_check_unsafe');
  return true;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const graph = buildDateFilterCheck(); verifyDateFilterCheck(graph);
  const file = resolve(process.argv[2] ?? 'Wafra Date Filter Check.json');
  await writeFile(file, JSON.stringify(graph, null, 2) + '\n'); console.log(file);
}
