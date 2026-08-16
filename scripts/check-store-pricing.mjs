import { readFile } from 'node:fs/promises';

import { validateStorePricing } from './lib/store-pricing.mjs';

const readJson = async (relative) => JSON.parse(
  await readFile(new URL(relative, import.meta.url), 'utf8'),
);

const [pricing, metadata] = await Promise.all([
  readJson('../docs/store-pricing.json'),
  readJson('../docs/store-metadata.json'),
]);
const errors = validateStorePricing(pricing, metadata);

if (errors.length > 0) {
  console.error('Store pricing is invalid:\n');
  errors.forEach((error) => console.error(`  - ${error}`));
  process.exit(1);
}

const approval = pricing.approvalStatus === 'approved'
  ? 'approved storefront prices and read-back evidence are structurally complete'
  : 'live pricing remains blocked pending commercial approval';
console.log(`Store pricing rules and product identifiers are valid; ${approval}.`);
