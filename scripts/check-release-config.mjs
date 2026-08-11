import { appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { assessReleaseReadiness } from './lib/release-readiness.mjs';

const args = process.argv.slice(2);
const value = (name, fallback = '') => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
};
const kind = value('--intent', 'store-release');
const platform = value('--platform', 'all');
const profile = value('--profile', 'production');
const submit = value('--submit', 'true') === 'true';
const githubOutput = value('--github-output');
const githubSummary = value('--github-summary');
const root = fileURLToPath(new URL('../', import.meta.url));
const publicEnv = Object.fromEntries([
  'EXPO_PUBLIC_WAFRA_RELAY_URL',
  'EXPO_PUBLIC_WAFRA_SHORTCUT_URL',
  'EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL',
  'EXPO_PUBLIC_WAFRA_E2E_DEMO',
  'EXPO_PUBLIC_WAFRA_SMS_CORPUS_EXPORT',
  'WAFRA_SMS_CORPUS_EXPORT',
].flatMap((key) => process.env[key] ? [[key, process.env[key]]] : []));

const intent = kind === 'build'
  ? { kind: 'build', platform, profile, submit }
  : { kind: 'store-release', platform };
const report = await assessReleaseReadiness({ root, intent, publicEnv });

if (githubOutput) {
  const facts = report.facts;
  await appendFile(githubOutput, [
    `fail=${report.findings.map(({ code }) => code).join(',')}`,
    `bundle_id=${facts.bundleId}`,
    `package_id=${facts.packageId}`,
    `slug=${facts.slug}`,
    `version=${facts.version}`,
    `project_id=${facts.projectId}`,
  ].join('\n') + '\n');
}

if (!report.ready && githubSummary) {
  const lines = ['# Not started — release configuration is incomplete', ''];
  for (const item of report.findings) {
    lines.push(`## ${item.title}`, '', item.detail, '', `**Fix:** ${item.remediation}`, '');
  }
  lines.push('Nothing was built or submitted.');
  await appendFile(githubSummary, lines.join('\n') + '\n');
}

if (!report.ready) {
  console.error('Wafra is not ready for this release intent:\n');
  for (const item of report.findings) console.error(`  - [${item.code}] ${item.title}`);
  console.error('\nNo files were changed. Development and simulator builds remain usable.');
  process.exit(1);
}

console.log('Release configuration is complete. Physical-device capture and store-console review are still manual gates.');
