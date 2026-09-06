import { spawnSync } from 'node:child_process';
import { validatePublishRevision, validateUpdateGroup } from './lib/update-group.mjs';

const [operation, ...rawArgs] = process.argv.slice(2);
const value = (name, fallback = '') => {
  const index = rawArgs.indexOf(name);
  return index >= 0 ? rawArgs[index + 1] ?? fallback : fallback;
};
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) process.exit(result.status ?? 1);
};
const output = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || 'Command failed.\n');
    process.exit(result.status ?? 1);
  }
  return result.stdout.trim();
};

if (!['candidate', 'production'].includes(operation)) {
  console.error('Usage:\n  npm run update:candidate -- --message "Fix description"\n  npm run update:production -- --group <candidate-group-id> [--rollout 10]');
  process.exit(2);
}

const dirty = output('git', ['status', '--porcelain', '--untracked-files=all']);
if (dirty) {
  console.error('Refusing to publish an OTA update from a dirty working tree. Commit and review every intended file first.');
  process.exit(1);
}

const head = output('git', ['rev-parse', 'HEAD']);
const sha = head.slice(0, 12);
run('node', ['scripts/check-update-config.mjs']);

const branch = output('git', ['branch', '--show-current']);
run('git', ['fetch', '--quiet', 'origin', 'main']);
const remoteMain = output('git', ['rev-parse', 'refs/remotes/origin/main']);
const revisionFailures = validatePublishRevision({ branch, head, remoteMain });
if (revisionFailures.length) {
  for (const failure of revisionFailures) console.error(failure);
  process.exit(1);
}

if (operation === 'candidate') {
  const message = value('--message');
  if (!message.trim()) {
    console.error('--message is required and must describe the user-visible fix.');
    process.exit(2);
  }
  run('npm', ['run', 'typecheck']);
  run('npm', ['run', 'lint']);
  run('npm', ['test']);
  run('npx', [
    '--yes', 'eas-cli@22.4.0', 'env:exec', 'production',
    'node scripts/check-update-config.mjs --environment production',
    '--non-interactive',
  ]);
  run('npx', [
    '--yes', 'eas-cli@22.4.0', 'update',
    '--channel', 'production-candidate',
    '--environment', 'production',
    '--platform', 'all',
    '--message', `${message.trim()} (${sha})`,
    '--non-interactive',
  ]);
  process.exit(0);
}

const group = value('--group');
const rollout = Number(value('--rollout', '10'));
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(group)) {
  console.error('--group must be the candidate update group UUID verified on both platforms.');
  process.exit(2);
}
if (!Number.isInteger(rollout) || rollout < 1 || rollout > 100) {
  console.error('--rollout must be an integer from 1 to 100.');
  process.exit(2);
}
let updates;
try {
  updates = JSON.parse(output('npx', [
    '--yes', 'eas-cli@22.4.0', 'update:view', group, '--json',
  ]));
} catch {
  console.error('Unable to read the candidate update group from EAS.');
  process.exit(1);
}
const groupFailures = validateUpdateGroup({
  updates,
  expectedGroup: group,
  expectedBranch: 'production-candidate',
  isCommitMerged: (hash) => spawnSync(
    'git', ['merge-base', '--is-ancestor', hash, 'refs/remotes/origin/main'],
    { stdio: 'ignore' },
  ).status === 0,
});
if (groupFailures.length) {
  console.error('Refusing to promote this update group:\n');
  for (const failure of groupFailures) console.error(`  - ${failure}`);
  process.exit(1);
}
run('npx', [
  '--yes', 'eas-cli@22.4.0', 'update:republish',
  '--group', group,
  '--destination-channel', 'production',
  '--rollout-percentage', String(rollout),
  '--message', `Promote verified candidate ${group} at ${rollout}%`,
  '--platform', 'all',
  '--non-interactive',
]);
