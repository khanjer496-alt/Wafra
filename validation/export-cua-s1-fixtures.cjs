'use strict';

const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const globalRows = require(path.join(ROOT, 'scripts/test/fixtures/global-alert-formats'));
const uaeRows = require(path.join(ROOT, 'scripts/test/fixtures/uae-bank-formats'));
const saudiRows = require(path.join(ROOT, 'scripts/test/fixtures/saudi-bank-formats'));
const {
  formattingMutations,
  postedFooterMutations,
} = require(path.join(ROOT, 'scripts/test/fixtures/global-alert-adversarial'));

function normalizeGlobal(row, idSuffix = '', body = row.body) {
  return {
    id: idSuffix ? row.id + ':' + idSuffix : row.id,
    market: row.market,
    institution: row.institution,
    sender: row.sender,
    channel: row.channel,
    provenance: row.provenance,
    body,
    familyGroundTruth: true,
    expected: {
      decision: row.expected.decision,
      status: row.expected.status,
      family: row.expected.family,
      direction: row.expected.direction,
      currency: row.expected.currency,
      minorUnits: row.expected.minorUnits,
    },
  };
}

function normalizeLaunch(row) {
  const sourceCurrency = row.expect.originalCurrency || row.expect.currency;
  const sourceMinorUnits = row.expect.originalAmountMinor != null
    ? String(row.expect.originalAmountMinor)
    : String(row.expect.amountFils);

  return {
    id: row.id,
    market: row.market,
    institution: row.bank,
    sender: row.bank,
    channel: row.channel,
    provenance: row.evidence,
    body: row.body,
    familyGroundTruth: false,
    expected: {
      decision: 'review',
      status: 'posted',
      family: null,
      direction: row.expect.type === 'income' ? 'credit' : 'debit',
      currency: row.expect.currency,
      minorUnits: String(row.expect.amountFils),
      sourceCurrency,
      sourceMinorUnits,
    },
  };
}

const output = [];

for (const row of globalRows) {
  output.push(normalizeGlobal(row));

  for (const mutation of formattingMutations) {
    output.push(normalizeGlobal(
      row,
      'format-' + mutation.id,
      mutation.apply(row.body, row),
    ));
  }

  if (row.expected.status === 'posted') {
    for (const mutation of postedFooterMutations) {
      output.push(normalizeGlobal(
        row,
        'footer-' + mutation.id,
        mutation.apply(row.body, row),
      ));
    }
  }
}

for (const row of [...uaeRows, ...saudiRows]) {
  output.push(normalizeLaunch(row));
}

process.stdout.write(JSON.stringify(output, null, 2) + '\n');
