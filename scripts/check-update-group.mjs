import { spawnSync } from 'node:child_process';
import { validateUpdateGroup } from './lib/update-group.mjs';

const value = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const expectedGroup = value('--group');
const expectedBranch = value('--branch');
if (!expectedGroup || !expectedBranch) {
  console.error('Usage: eas update:view GROUP --json | node scripts/check-update-group.mjs --group GROUP --branch BRANCH');
  process.exit(2);
}

let input = '';
for await (const chunk of process.stdin) input += chunk;
let updates;
try {
  updates = JSON.parse(input);
} catch {
  console.error('EAS update:view did not return valid JSON.');
  process.exit(1);
}

const failures = validateUpdateGroup({
  updates,
  expectedGroup,
  expectedBranch,
  isCommitMerged: (hash) => spawnSync(
    'git', ['merge-base', '--is-ancestor', hash, 'HEAD'], { stdio: 'ignore' },
  ).status === 0,
});
if (failures.length) {
  console.error('Refusing to mutate production with this update group:\n');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`Update group ${expectedGroup} is a merged, two-platform ${expectedBranch} artifact.`);
