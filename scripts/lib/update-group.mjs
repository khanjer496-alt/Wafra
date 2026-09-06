export const validatePublishRevision = ({ branch, head, remoteMain }) => {
  const failures = [];
  if (branch !== 'main') failures.push('OTA publishing is allowed only from main.');
  if (!/^[0-9a-f]{40}$/i.test(head) || head !== remoteMain) {
    failures.push('The checked-out revision must exactly match fetched origin/main.');
  }
  return failures;
};

export const validateUpdateGroup = ({
  updates,
  expectedGroup,
  expectedBranch,
  isCommitMerged = () => true,
}) => {
  const failures = [];
  if (!Array.isArray(updates) || updates.length === 0) {
    return ['EAS returned no platform updates for this group.'];
  }

  const branches = new Set(updates.map((update) => update?.branch));
  if (branches.size !== 1 || !branches.has(expectedBranch)) {
    failures.push(`Update group must belong only to the "${expectedBranch}" branch.`);
  }
  const groups = new Set(updates.map((update) => update?.group));
  if (groups.size !== 1 || !groups.has(expectedGroup)) {
    failures.push('EAS response does not match the requested update group UUID.');
  }
  const platforms = new Set(updates.map((update) => update?.platform));
  if (platforms.size !== 2 || !platforms.has('ios') || !platforms.has('android')) {
    failures.push('Update group must contain both iOS and Android bundles.');
  }
  if (updates.some((update) =>
    typeof update?.runtimeVersion !== 'string' || update.runtimeVersion.length === 0)) {
    failures.push('Every platform bundle must use an explicit runtime version.');
  }

  for (const hash of new Set(updates.map((update) => update?.gitCommitHash))) {
    if (typeof hash !== 'string' || !/^[0-9a-f]{40}$/i.test(hash)) {
      failures.push('Every update must record its immutable 40-character Git commit hash.');
    } else if (!isCommitMerged(hash)) {
      failures.push(`Update source ${hash} is not an ancestor of the checked-out main branch.`);
    }
  }
  return failures;
};
