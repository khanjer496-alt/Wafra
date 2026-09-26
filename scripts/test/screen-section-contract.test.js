/**
 * Phase 2A presentation-section boundary.
 *
 * Moving these sections back into their route components would reintroduce
 * the oversized-screen coupling this refactor removes. Rendered behavior is
 * still covered by the screen and end-to-end suites.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const sections = [
  // Design language E: each first-run step is its own section module.
  ['src/components/onboarding/e-welcome.tsx', 'WelcomeStep', 'src/components/onboarding-gate.tsx'],
  ['src/components/onboarding/e-goals.tsx', 'GoalsStep', 'src/components/onboarding-gate.tsx'],
  ['src/components/onboarding/e-watch.tsx', 'WatchStep', 'src/components/onboarding-gate.tsx'],
  ['src/components/onboarding/e-paywall.tsx', 'PaywallStep', 'src/components/onboarding-gate.tsx'],
  ['src/components/bills/payment-agenda.tsx', 'PaymentAgenda', 'src/app/(tabs)/bills.tsx'],
  ['src/components/spending/spending-overview.tsx', 'SpendingOverview', 'src/app/(tabs)/flow.tsx'],
  ['src/components/spending/spending-trends.tsx', 'SpendingTrends', 'src/app/(tabs)/flow.tsx'],
  ['src/components/wallet/account-groups.tsx', 'AccountGroups', 'src/app/(tabs)/wallet.tsx'],
  ['src/components/wallet/balance-overview.tsx', 'BalanceOverview', 'src/app/(tabs)/wallet.tsx'],
];

for (const [relativePath, exportName, ownerPath] of sections) {
  const file = path.join(root, relativePath);
  assert.ok(fs.existsSync(file), `missing extracted section: ${relativePath}`);
  const source = fs.readFileSync(file, 'utf8');
  assert.match(
    source,
    new RegExp(`export\\s+(?:function|const)\\s+${exportName}\\b`),
    `${relativePath} must expose ${exportName}`,
  );
  const owner = fs.readFileSync(path.join(root, ownerPath), 'utf8');
  assert.match(owner, new RegExp(`from '@/components/.+${path.basename(relativePath, '.tsx')}'`));
  assert.match(owner, new RegExp(`<${exportName}\\b`));
}

console.log(`✓ screen section contract: ${sections.length} presentation modules composed`);
