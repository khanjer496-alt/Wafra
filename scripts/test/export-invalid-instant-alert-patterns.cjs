'use strict';
// Test-only malformed patterns exercise independent queue privacy and preview failure.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
async function main() {
  const [dir, mode] = process.argv.slice(2);
  if (!dir || !['preview', 'credential'].includes(mode)) throw Error('Expected output directory and preview/credential');
  const generator = await import(pathToFileURL(path.join(__dirname, '../generate-ios-instant-alert.mjs')).href);
  const patterns = generator.instantAlertPatternSources();
  patterns[mode === 'preview' ? 'amount' : 'credential'] = '[';
  fs.writeFileSync(path.join(dir, `${mode}-patterns.swift`), generator.swiftSource(patterns));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
