const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

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

const filename = path.resolve(__dirname, '../../src/lib/alert-institution-grammars.ts');
const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: filename,
}).outputText;
const loaded = { exports: {} };
Function('require', 'module', 'exports', output)(require, loaded, loaded.exports);
const { inspectAlertInstitutionGrammar } = loaded.exports;

// Original synthetic grammar probes only. These are invented shapes, not bank
// messages, third-party fixtures, or evidence that any institution is covered.
const firstWave = [
  ['IN', 'HDFC-BK', 'Card purchase INR 42.10 was debited. HDFC Bank notice.', 'hdfc-bank', 'card-activity'],
  ['US', 'WELLSFARGO', 'Wells Fargo card charged USD 18.25 at SAMPLE SHOP.', 'wells-fargo', 'card-activity'],
  ['GB', 'NATWEST', 'NatWest card payment GBP 7.40 at SAMPLE CAFE.', 'natwest', 'card-activity'],
  ['FR', 'BNPPARIBAS', 'BNP Paribas: paiement par carte EUR 12,30 chez EXEMPLE.', 'bnp-paribas-fr', 'card-activity'],
  ['DE', 'COMMERZBANK', 'Commerzbank Kartenzahlung EUR 9,80 bei BEISPIEL.', 'commerzbank-de', 'card-activity'],
  ['ES', 'BBVA', 'BBVA compra con tarjeta EUR 14,20 en EJEMPLO.', 'bbva-es', 'card-activity'],
  ['IT', 'UNICREDIT', 'UniCredit pagamento con carta EUR 11,60 presso ESEMPIO.', 'unicredit-it', 'card-activity'],
  ['NL', 'ABNAMRO', 'ABN AMRO pasbetaling EUR 6,75 bij VOORBEELD.', 'abn-amro-nl', 'card-activity'],
  ['QA', 'QIB', 'مصرف قطر الإسلامي: تم الخصم ر.ق ١٢٫٣٤ لشراء بالبطاقة.', 'qatar-islamic-bank', 'card-activity'],
  ['KW', 'BOUBYANBANK', 'بنك بوبيان: تم الخصم د.ك ١٫٢٣٤ لشراء بالبطاقة.', 'boubyan-bank', 'card-activity'],
  ['BH', 'BBKBANK', 'بنك البحرين والكويت: تم الخصم د.ب ٢٫٣٤٥ لشراء بالبطاقة.', 'bank-of-bahrain-and-kuwait', 'card-activity'],
  ['OM', 'BANKMUSCAT', 'بنك مسقط: تم الخصم ر.ع ٣٫٤٥٦ لشراء بالبطاقة.', 'bank-muscat', 'card-activity'],
  ['EG', 'CIBEGYPT', 'البنك التجاري الدولي: تم الخصم ج.م ٤٥٫٦٧ لشراء بالبطاقة.', 'cib-egypt', 'card-activity'],
  ['JO', 'HBTF', 'بنك الإسكان: تم الخصم د.أ ٥٫٦٧٨ لشراء بالبطاقة.', 'housing-bank-jordan', 'card-activity'],
];

for (const [market, sender, source, institution, template] of firstWave) {
  const result = inspectAlertInstitutionGrammar(source, market, sender);
  ok(`${market}: representative institution and template evidence is reviewable`,
    result.decision === 'identified' && result.institution === institution &&
      result.template?.template === template && result.candidates[0]?.evidence.includes('sender') &&
      result.candidates[0]?.evidence.includes('body') &&
      result.candidates[0]?.grammar.status === 'experimental', JSON.stringify(result));
}

{
  const result = inspectAlertInstitutionGrammar(
    'State Bank of India fund transfer through UPI for INR 500.00.', 'IN',
  );
  ok('body-only evidence remains a routing candidate, never verified issuer evidence',
    result.decision === 'identified' && result.institution === 'state-bank-of-india' &&
      result.candidates[0]?.evidence.join(',') === 'body' &&
      result.template?.template === 'fund-transfer', JSON.stringify(result));
}

for (const suffix of ['', '-S', '-T', '-G']) {
  const result = inspectAlertInstitutionGrammar(
    'Card purchase INR 10.00 was debited.', 'IN', `VM-HDFCBK${suffix}`,
  );
  ok(`Indian DLT ${suffix || 'legacy'} route identifies the exact issuer header`,
    result.decision === 'identified' && result.institution === 'hdfc-bank' &&
      result.candidates[0]?.evidence.join(',') === 'sender', JSON.stringify(result));
}

{
  const result = inspectAlertInstitutionGrammar(
    'HDFC Bank: Card purchase INR 999.00 completed. Get cashback.', 'IN', 'VM-HDFCBK-P',
  );
  ok('Indian promotional DLT routes are refused even when the body looks transactional',
    result.decision === 'unknown' && result.institution === null &&
      result.reasons.includes('promotional-sender-route') && result.candidates.length === 0,
    JSON.stringify(result));
}

for (const sender of ['VM-HDFCBK-X', 'VM-HDFCBK-T-S', 'VM-HDFC']) {
  const result = inspectAlertInstitutionGrammar('Card purchase INR 10.00 was debited.', 'IN', sender);
  ok(`malformed or partial Indian header ${sender} stays unknown`,
    result.decision === 'unknown', JSON.stringify(result));
}

{
  const result = inspectAlertInstitutionGrammar(
    'Bank of America card charged USD 5.00.', 'US', 'WELLSFARGO',
  );
  ok('conflicting sender and body identities remain ambiguous',
    result.decision === 'ambiguous' && result.institution === null &&
      result.reasons.includes('sender-body-conflict') && result.candidates.length === 2,
    JSON.stringify(result));
}

{
  const result = inspectAlertInstitutionGrammar(
    'Transfer reference names Barclays and Lloyds Bank. GBP 10.00 sent.', 'GB',
  );
  ok('multiple body identities remain ambiguous without a sender',
    result.decision === 'ambiguous' && result.reasons.includes('multiple-institution-evidence') &&
      result.candidates.length === 2, JSON.stringify(result));
}

{
  const result = inspectAlertInstitutionGrammar(
    'Card purchase EUR 3,20 was debited at SAMPLE SHOP.', 'DE', 'UNKNOWN-BANK',
  );
  ok('a known template never invents an institution',
    result.decision === 'unknown' && result.institution === null &&
      result.template?.template === 'card-activity' && result.candidates.length === 0,
    JSON.stringify(result));
}

{
  const result = inspectAlertInstitutionGrammar(
    'Bank of America card charged USD 8.90.', 'GB', 'BANKOFAMERICA',
  );
  ok('institution aliases are scoped to their market',
    result.decision === 'unknown' && result.institution === null, JSON.stringify(result));
}

{
  const source = 'N26 verification code 123456. Never share this private synthetic sentence.';
  const sender = 'N26';
  const result = inspectAlertInstitutionGrammar(source, 'DE', sender);
  const serialized = JSON.stringify(result);
  ok('authentication is template evidence, never a transaction claim',
    result.institution === 'n26-de' && result.template?.template === 'authentication');
  ok('results never retain raw source or sender',
    !serialized.includes(source) && !serialized.includes(sender) &&
      !serialized.includes('123456') && !Object.hasOwn(result, 'source') &&
      !Object.hasOwn(result, 'sender'), serialized);
}

{
  const exact = inspectAlertInstitutionGrammar('Card charged USD 1.00.', 'US', 'CITI');
  const partial = inspectAlertInstitutionGrammar('Card charged USD 1.00.', 'US', 'CITIZEN');
  ok('sender aliases are exact after punctuation normalization, never substrings',
    exact.institution === 'citi-us' && partial.decision === 'unknown',
    `${JSON.stringify(exact)} | ${JSON.stringify(partial)}`);
}

{
  const result = inspectAlertInstitutionGrammar(
    'HDFC Bank card purchase INR 1.00 was debited.', 'IN', 'VM-HDFCBK',
  );
  ok('Indian DLT route prefixes are stripped without enabling substring matches',
    result.decision === 'identified' && result.institution === 'hdfc-bank' &&
      result.candidates[0]?.evidence.includes('sender'), JSON.stringify(result));
}

{
  const result = inspectAlertInstitutionGrammar('Rabobank service notice.', 'NL', 'RABOBANK');
  ok('institution evidence can survive an unknown alert template without guessing one',
    result.decision === 'identified' && result.institution === 'rabobank-nl' &&
      result.template === null && result.reasons.includes('no-template-evidence'),
    JSON.stringify(result));
}

console.log(`\nalert-institution-grammars: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
