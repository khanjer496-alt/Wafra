import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { prepareStorePackage } from './lib/store-package.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputFlag = process.argv.indexOf('--output');
const output = outputFlag >= 0 && process.argv[outputFlag + 1]
  ? path.resolve(process.argv[outputFlag + 1])
  : path.join(root, 'artifacts', 'store-package');
const includeAssets = process.argv.includes('--include-assets');

try {
  const manifest = await prepareStorePackage({ root, output, includeAssets });
  console.log(
    `Prepared Apple (${manifest.appleLocales.join(', ')}) and Google Play ` +
    `(${manifest.googleLocales.join(', ')}) store metadata at ${output}.`,
  );
  if (!includeAssets) {
    console.log('Screenshots were not included; run npm run store:prepare:assets after native captures pass.');
  }
} catch (error) {
  console.error(`Store package preparation failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
