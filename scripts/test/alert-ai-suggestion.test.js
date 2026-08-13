const {
  constrainAlertAiProposal,
  suggestAlertOnDevice,
} = require('./build/alert-ai-suggestion.js');

let pass = 0;
let fail = 0;
const ok = (name, condition, detail = '') => {
  if (condition) { pass += 1; console.log(`✓ ${name}`); }
  else { fail += 1; console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

const item = (over = {}) => ({
  id: 'opaque_review_id_000001', sourceKey: 'opaque_source_key_00001',
  templateKey: 'opaque_template_key_0001', observedAt: Date.now(), expiresAt: Date.now() + 1000,
  channel: 'inbox', parserVersion: 1, market: 'AE', institution: 'first-abu-dhabi-bank',
  grammar: { id: 'ae-fab-review-v1', version: 1, channel: 'bank-alert', status: 'experimental', provenance: 'launch-registry' },
  amount: { currency: 'AED', minorUnits: '850000', exponent: 2 },
  direction: 'credit', family: 'transfer', rail: null,
  instrument: { kind: 'account', last4: '1234' },
  ...over,
});

{
  const result = constrainAlertAiProposal(item(), {
    title: 'Salary', category: 'salary', betweenOwnAccounts: false, confidence: 0.91,
  });
  ok('a high-confidence label suggestion is accepted without copying money fields',
    result?.type === 'income' && result.category === 'salary' &&
      !Object.prototype.hasOwnProperty.call(result, 'amount'), JSON.stringify(result));
}

for (const [name, proposal] of [
  ['money mutation', { title: 'Salary', category: 'salary', confidence: 0.99, amount: 1 }],
  ['direction mismatch', { title: 'Groceries', category: 'groceries', confidence: 0.99 }],
  ['low confidence', { title: 'Salary', category: 'salary', confidence: 0.4 }],
]) {
  ok(`${name} is refused`, constrainAlertAiProposal(item(), proposal) === null,
    JSON.stringify(proposal));
}

{
  const source = 'PRIVATE SALARY BODY AED 8,500.00';
  let received = '';
  suggestAlertOnDevice(source, item(), async (request) => {
    received = request.source;
    return { title: 'Salary', category: 'salary', confidence: 0.9 };
  }).then((result) => {
    ok('the optional model runs in the supplied adapter and raw text never enters its result',
      received === source && result?.category === 'salary' &&
        !JSON.stringify(result).includes('PRIVATE SALARY BODY'), JSON.stringify(result));
    console.log(`\nalert-ai-suggestion: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
}
