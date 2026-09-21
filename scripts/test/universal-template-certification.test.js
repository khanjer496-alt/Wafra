const { inspectUniversalBankEvent } = require('./build/universal-parser');
const {
  certifyUniversalTemplate,
  certifiedUniversalTemplateIds,
} = require('./build/universal-template-certification');
const { transferOwnership } = require('./build/transfer-reconciliation');
const { countsInTotals, countsInCashflowTotals } = require('./build/ledger');

let pass = 0;
let fail = 0;
const ok = (name, condition, detail = '') => {
  if (condition) { pass += 1; console.log(`✓ ${name}`); }
  else { fail += 1; console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

const certify = (source, market, institution, allowSemanticGeneralization = false) => certifyUniversalTemplate({
  source, market, institution,
  event: inspectUniversalBankEvent(source, { market }),
  allowSemanticGeneralization,
});

const chase = certify('Chase Bank: Card purchase USD 42.10 was charged at SAMPLE SHOP.', 'US', 'jpmorgan-chase');
ok('official-derived Chase purchase grammar is automatic',
  chase.decision === 'automatic' && chase.templateId === 'us-chase-purchase-v1', JSON.stringify(chase));

const zelle = certify('Bank of America: Zelle payment USD 95.00 to SAMPLE PERSON is paid.', 'US', 'bank-of-america');
// The shipped generic reader still classifies "Zelle ... is paid" as a
// purchase, so the certified transfer grammar cannot match and the alert stays
// in Review. That is the fail-closed direction; it flips to automatic only
// once the semantic layer reads Zelle settlement as a transfer.
ok('a Zelle settlement the parser reads as a purchase stays in Review, never automatic',
  zelle.decision === 'review' && zelle.templateId === null &&
    zelle.reason === 'uncertified-template', JSON.stringify(zelle));

const pending = certify('Bank of America: Zelle payment USD 125.00 is pending acceptance by the recipient.', 'US', 'bank-of-america');
ok('pending Zelle can never post even at a certified institution',
  pending.decision === 'never-post', JSON.stringify(pending));

const statement = certify('Chase Bank credit card statement: Minimum amount due USD 75.00.', 'US', 'jpmorgan-chase');
ok('statements can never enter the automatic transaction path',
  statement.decision === 'never-post', JSON.stringify(statement));

const repayment = certify('Chase Bank: Payment USD 500.00 was credited to your credit card account.', 'US', 'jpmorgan-chase');
ok('card repayment stays behind its dedicated settlement adapter',
  repayment.decision === 'adapter-required', JSON.stringify(repayment));

const unknownInstitution = certify('Card purchase USD 42.10 was charged at SAMPLE SHOP.', 'US', null);
ok('semantically obvious money without issuer proof stays review-only',
  unknownInstitution.decision === 'review' && unknownInstitution.reason === 'unidentified-institution',
  JSON.stringify(unknownInstitution));

const newChaseWording = certify('Chase Bank: Merchant activity USD 42.10 was debited from your account.', 'US', 'jpmorgan-chase');
ok('a new bank wording does not inherit trust from its institution',
  newChaseWording.decision === 'review', JSON.stringify(newChaseWording));

const unseenChaseSource = 'Chase Bank: USD 42.10 spent at SAMPLE SHOP using your card.';
const unseenChaseWithoutTrust = certify(unseenChaseSource, 'US', 'jpmorgan-chase');
const unseenChaseWithTrust = certify(unseenChaseSource, 'US', 'jpmorgan-chase', true);
ok('unseen but strongly understood wording remains Review without verified-app authorization',
  unseenChaseWithoutTrust.decision === 'review', JSON.stringify(unseenChaseWithoutTrust));
ok('verified-app authorization can generalize unseen high-confidence accounting semantics',
  unseenChaseWithTrust.decision === 'semantic-generalized' &&
    unseenChaseWithTrust.reason === 'semantic-generalization', JSON.stringify(unseenChaseWithTrust));

const foreignCurrencyGeneralized = certify(
  'Chase Bank: EUR 42.10 spent at SAMPLE SHOP using your card.',
  'US', 'jpmorgan-chase', true,
);
ok('semantic generalization refuses a market-inconsistent currency',
  foreignCurrencyGeneralized.decision === 'review' &&
    foreignCurrencyGeneralized.reason === 'semantic-guard-failed',
  JSON.stringify(foreignCurrencyGeneralized));

const genericDebitGeneralized = certify(
  'Chase Bank: USD 42.10 was debited from your account.',
  'US', 'jpmorgan-chase', true,
);
ok('a generic debit with unresolved event family cannot use semantic generalization',
  genericDebitGeneralized.decision === 'review', JSON.stringify(genericDebitGeneralized));

for (const [market, institution, source, currency, minorUnits] of [
  ['QA', 'qnb-qatar', 'بنك قطر الوطني: تم الخصم ر.ق ١٢٤٫٥٠ لشراء بالبطاقة لدى متجر النور.', 'QAR', '12450'],
  ['KW', 'national-bank-of-kuwait', 'بنك الكويت الوطني: تم الخصم د.ك ١٢٫٣٤٥ لشراء بالبطاقة لدى سوق المدينة.', 'KWD', '12345'],
  ['BH', 'national-bank-of-bahrain', 'بنك البحرين الوطني: تم الخصم د.ب ٢١٫٣٠٠ لشراء بالبطاقة لدى متجر الواحة.', 'BHD', '21300'],
  ['OM', 'bank-muscat', 'بنك مسقط: تم الخصم ر.ع ١٨٫٤٥٠ لشراء بالبطاقة لدى سوق الشاطئ.', 'OMR', '18450'],
  ['EG', 'national-bank-of-egypt', 'البنك الأهلي المصري: تم الخصم ج.م ١٤٥٫٧٥ لشراء بالبطاقة لدى متجر النيل.', 'EGP', '14575'],
  ['JO', 'arab-bank-jordan', 'البنك العربي: تم الخصم د.أ ٢٤٫٥٠٠ لشراء بالبطاقة لدى متجر الساحة.', 'JOD', '24500'],
]) {
  const event = inspectUniversalBankEvent(source, { market });
  const decision = certifyUniversalTemplate({
    source, market, institution, event, allowSemanticGeneralization: true,
  });
  ok(`${market}: market currency alias reaches universal money extraction automatically`,
    event.amount.evidence === 'explicit' && event.amount.value?.currency === currency &&
      event.amount.value?.minorUnits === minorUnits && event.status === 'posted' &&
      event.family === 'purchase' && event.direction === 'debit' &&
      decision.decision === 'semantic-generalized',
    JSON.stringify({ event, decision }));
}

const bnp = certify('BNP Paribas: Paiement par carte débité de EUR 9,99 chez PRIVATE-CAFE', 'FR', 'bnp-paribas-fr');
ok('existing trusted BNP purchase path is preserved under explicit certification',
  bnp.decision === 'automatic' && bnp.templateId === 'fr-bnp-card-purchase-v1', JSON.stringify(bnp));

const barclays = certify('Barclays: Your card ending 1234 was charged GBP 12.34 at TESCO.', 'GB', 'barclays-uk');
ok('existing trusted Barclays purchase path is preserved under explicit certification',
  barclays.decision === 'automatic' && barclays.templateId === 'gb-barclays-card-purchase-v1', JSON.stringify(barclays));

const hdfc = certify('HDFC Bank: INR 1,249.50 debited on card ending 7312 for purchase at NORTH MART.', 'IN', 'hdfc-bank');
ok('existing trusted HDFC purchase path is preserved under explicit certification',
  hdfc.decision === 'automatic' && hdfc.templateId === 'in-hdfc-card-purchase-v1', JSON.stringify(hdfc));

ok('certification registry exposes only stable ids to diagnostics',
  certifiedUniversalTemplateIds().length >= 16 &&
    certifiedUniversalTemplateIds().every((id) => /^[a-z0-9-]+-v\d+$/.test(id)));

const unresolvedCertifiedTransfer = {
  id: 'certified-us-transfer',
  type: 'expense',
  amountFils: 9500,
  category: 'other',
  accountId: 'us-bank-account',
  title: 'Outgoing transfer',
  date: '2026-09-18',
  ts: 1_800_000_000_000,
  source: 'sms',
  isTransfer: true,
};
const live = new Set(['us-bank-account']);
ok('certified unresolved transfers cannot swing exact totals before ownership reconciliation',
  transferOwnership(unresolvedCertifiedTransfer) === 'unknown' &&
    countsInTotals(unresolvedCertifiedTransfer, live, new Set()) === false &&
    countsInCashflowTotals(unresolvedCertifiedTransfer, live, new Set()) === true,
  JSON.stringify({ ownership: transferOwnership(unresolvedCertifiedTransfer) }));

console.log(`\nuniversal-template-certification: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
