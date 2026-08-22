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
  ['src/components/onboarding/money-preview.tsx', 'MoneyPreview', 'src/components/onboarding-gate.tsx'],
  ['src/components/settings/status-facts.tsx', 'StatusFacts', 'src/app/settings.tsx'],
  ['src/components/bills/bills-segment-control.tsx', 'BillsSegmentControl', 'src/app/(tabs)/bills.tsx'],
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
