const fs = require('node:fs');
const path = require('node:path');

const {
  buildCapabilityRows,
  renderCapabilityMarkdown,
} = require('../parser-capabilities.cjs');

const uae = require('./fixtures/uae-bank-formats.js');
const saudi = require('./fixtures/saudi-bank-formats.js');

let pass = 0;
let fail = 0;
const ok = (name, condition, detail = '') => {
  if (condition) {
    pass += 1;
    console.log(`✓ ${name}`);
  } else {
    fail += 1;
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const rows = buildCapabilityRows([...uae, ...saudi]);
ok('capability rows exclude synthetic grammar probes',
  rows.every((row) => row.evidence.every((value) => value !== 'synthetic-grammar-probe')));
ok('coverage is grouped by market and institution, not one global percentage',
  rows.some((row) => row.market === 'AE' && row.institution === 'ENBD') &&
    rows.some((row) => row.market === 'SA' && row.institution === 'Bank Albilad'));
ok('each row publishes language and event-family evidence',
  rows.every((row) => row.languages.length > 0 && row.eventFamilies.length > 0 && row.formatCount > 0));
ok('currency codes and redaction placeholders do not overclaim English Saudi alerts',
  rows.filter((row) => row.market === 'SA')
    .every((row) => row.languages.length === 1 && row.languages[0] === 'Arabic'));

const markdown = renderCapabilityMarkdown(rows);
ok('the report separates worldwide manual tracking from limited bank imports',
  markdown.includes('Manual tracking is available regardless of country') &&
    markdown.includes('Automatic bank-alert import is not worldwide bank coverage'));
ok('the report avoids a misleading global parser percentage',
  !/%/.test(markdown) && !/global coverage/i.test(markdown));

const committed = fs.readFileSync(path.join(__dirname, '../../docs/parser-capabilities.md'), 'utf8');
ok('the committed capability document is generated from the reviewed fixtures',
  committed === markdown, 'run: node scripts/generate-parser-capabilities.mjs');

console.log(`\nparser-capabilities: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
