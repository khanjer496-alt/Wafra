const { assessUniversalEventConfidence, confidenceForUniversalField } = require('./build/universal-confidence');
const { inspectUniversalBankEvent } = require('./build/universal-parser');

let pass = 0;
let fail = 0;
const ok = (name, condition, detail = '') => {
  if (condition) { pass += 1; console.log(`✓ ${name}`); }
  else { fail += 1; console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

ok('explicit fields receive high deterministic confidence',
  confidenceForUniversalField({ value: 'x', evidence: 'explicit', spans: [{ start: 0, end: 1 }], alternatives: [], issues: [] }) >= 0.95);
ok('ambiguous fields are never treated as high confidence',
  confidenceForUniversalField({ value: null, evidence: 'ambiguous', spans: [{ start: 0, end: 1 }], alternatives: ['a', 'b'], issues: [] }) < 0.5);
ok('missing fields have zero confidence',
  confidenceForUniversalField({ value: null, evidence: 'missing', spans: [], alternatives: [], issues: [] }) === 0);

const posted = inspectUniversalBankEvent(
  'Chase Bank: Card purchase USD 42.10 was debited at SAMPLE SHOP.',
  { market: 'US', sender: 'CHASE' },
);
const postedConfidence = assessUniversalEventConfidence(posted);
ok('a clean posted purchase has strong core confidence',
  postedConfidence.status >= 0.9 && postedConfidence.family >= 0.9 &&
  postedConfidence.direction >= 0.9 && postedConfidence.fields.amount >= 0.9,
  JSON.stringify(postedConfidence));

const ambiguous = inspectUniversalBankEvent(
  'Card purchases USD 10.00 and USD 20.00 were debited.',
  { market: 'US' },
);
const ambiguousConfidence = assessUniversalEventConfidence(ambiguous);
ok('multiple principal amounts cannot be automation-safe',
  ambiguousConfidence.automationSafe === false && ambiguousConfidence.overall < 0.8,
  JSON.stringify(ambiguousConfidence));

const future = inspectUniversalBankEvent(
  'N26: Dauerauftrag EUR 510,00 wird morgen abgebucht.',
  { market: 'DE', sender: 'N26' },
);
const futureConfidence = assessUniversalEventConfidence(future);
ok('known future lifecycle can be confident without becoming automation-safe',
  future.status === 'future' && futureConfidence.status >= 0.9 &&
  futureConfidence.automationSafe === false,
  JSON.stringify({ event: future, confidence: futureConfidence }));

console.log(`\nuniversal-confidence: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
