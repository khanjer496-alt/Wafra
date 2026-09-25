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

// Second-wave certified grammars (standard-derived public evidence).
{
  const anz = certify('ANZ: AUD 320.00 received via Osko into your account.', 'AU', 'anz-australia');
  ok('AU: the documented ANZ Osko credit uses the same certification mechanism',
    anz.decision === 'automatic' && anz.templateId === 'au-anz-osko-credit-v1', JSON.stringify(anz));
}
// Heading-style templates carry no completion verb, so the semantic layer does
// not prove them posted and their anchored rules stay inert (never automatic).
for (const [source, market, institution] of [
  ['Itaú: compra com cartão BRL 89,90 em MERCADO TESTE.', 'BR', 'itau-brasil'],
  ['Banorte: 18/09 compra MXN 1,250.00 SUPERMERCADO. Tarjeta terminación 1234.', 'MX', 'banorte-mexico'],
  ['Banorte: 18/09 cargo recurrente MXN 299.00 VIDEO CASA. Tarjeta terminación 1234.', 'MX', 'banorte-mexico'],
  ['Banorte: 18/09 devolución MXN 350.00 COMERCIO TESTE. Tarjeta terminación 1234.', 'MX', 'banorte-mexico'],
  ['DBS Bank: PayNow outgoing SGD 88.00 to SAMPLE PAYEE.', 'SG', 'dbs-singapore'],
]) {
  for (const allow of [false, true]) {
    const result = certify(source, market, institution, allow);
    ok(`${market}: a heading-only template is not automatic (generalization ${allow}) — ${source}`,
      result.decision !== 'automatic' && result.decision !== 'semantic-generalized', JSON.stringify(result));
  }
}

// Adversarial alerts that reuse the certified headings are never automatic,
// even for a verified installed app.
for (const [source, market, institution] of [
  ['Banorte: Solicitud de compra por MXN 250.00 en OXXO tarjeta 1234', 'MX', 'banorte-mexico'],
  ['Banorte: ¿Reconoces la compra por MXN 250.00 en OXXO con tarjeta 1234?', 'MX', 'banorte-mexico'],
  ['Banorte: Promoción: compra a meses sin intereses con tu tarjeta desde MXN 250.00', 'MX', 'banorte-mexico'],
  ['Banorte: Compra por MXN 250.00 en OXXO con tarjeta terminación 1234 se cargará mañana', 'MX', 'banorte-mexico'],
  ['Banorte: Devolución por MXN 250.00 será abonada en 5 días', 'MX', 'banorte-mexico'],
  ['Banorte: Cargo recurrente por MXN 199.00 de NETFLIX se aplicará el 15/10', 'MX', 'banorte-mexico'],
  ['DBS: PayNow outgoing limit changed to SGD 5,000.00', 'SG', 'dbs-singapore'],
  ['DBS: PayNow outgoing SGD 50.00 to JOHN on hold for review', 'SG', 'dbs-singapore'],
  ['DBS: Online card transaction limit set to SGD 500.00', 'SG', 'dbs-singapore'],
  ['DBS: Online card transaction of SGD 45.00 at AMAZON requires your approval in digibank app', 'SG', 'dbs-singapore'],
  ['DBS: Did you make this online card transaction of SGD 45.00 at AMAZON? Reply Y/N', 'SG', 'dbs-singapore'],
  ['DBS: Local card transaction SGD 45.00 at SHELL is being authorised', 'SG', 'dbs-singapore'],
  ['Itau: Compra com cartão final 1234 de R$ 50,00 em MERCADO foi estornada', 'BR', 'itau-brasil'],
  ['Itau: Compra com cartão final 1234 de R$ 50,00 em MERCADO será debitada', 'BR', 'itau-brasil'],
  ['Itau: Compra com cartão final 1234 de R$ 50,00 em MERCADO aguarda aprovação', 'BR', 'itau-brasil'],
  ['Osko: AUD 50.00 from John has not been received', 'AU', 'anz-australia'],
]) {
  for (const allow of [false, true]) {
    const result = certify(source, market, institution, allow);
    // A completed reversal may generalize as a refund credit, never as a purchase.
    const reversal = /estornada/.test(source);
    const event = inspectUniversalBankEvent(source, { market });
    ok(`${market}: heading reuse is never automatic (generalization ${allow}) — ${source}`,
      result.decision !== 'automatic' &&
        (result.decision !== 'semantic-generalized' ||
          (reversal && event.family === 'refund' && event.direction === 'credit')),
      JSON.stringify({ result, family: event.family, direction: event.direction }));
  }
}

// Never-post lifecycle in the second-wave languages, even at a certified
// institution and with the certified wording inside the message.
for (const [source, market, institution] of [
  ['TD Canada Trust: Interac e-Transfer request for CAD 50.00 received. Accept the request to pay.', 'CA', 'td-canada-trust'],
  ['Itaú: compra com cartão BRL 89,90 em MERCADO TESTE pendente.', 'BR', 'itau-brasil'],
  ['Banorte: compra MXN 1,250.00 SUPERMERCADO pendiente de autorización. Tarjeta terminación 1234.', 'MX', 'banorte-mexico'],
  ['Banorte: compra MXN 1,250.00 SUPERMERCADO rechazada. Tarjeta terminación 1234.', 'MX', 'banorte-mexico'],
  ['ANZ: Osko payment AUD 75.00 failed. We may attempt another payment channel.', 'AU', 'anz-australia'],
  ['DBS Bank: Future-dated funds transfer SGD 150.00 is scheduled for tomorrow.', 'SG', 'dbs-singapore'],
]) {
  const result = certify(source, market, institution, true);
  ok(`${market}: non-posted lifecycle stays never-post — ${source}`,
    result.decision === 'never-post', JSON.stringify(result));
}

// A certified rule never crosses markets or institutions.
{
  const wrongInstitution = certify('Itaú: compra com cartão BRL 89,90 em MERCADO TESTE.', 'BR', 'bradesco-brasil');
  const wrongMarket = certify('Banorte: 18/09 compra MXN 1,250.00 SUPERMERCADO. Tarjeta terminación 1234.', 'ES', 'banorte-mexico');
  ok('a second-wave certified grammar does not transfer to another issuer or market',
    wrongInstitution.decision !== 'automatic' && wrongMarket.decision !== 'automatic',
    JSON.stringify({ wrongInstitution, wrongMarket }));
}

// The anchored ANZ rule refuses outgoing and split-sentence pending Osko
// wording. (The separate verified-app semantic-generalization path reads the
// same English shapes as a credit in every market, e.g. US/GB "bank transfer
// ... received ... Pending until processed"; that pre-existing generic
// behaviour is outside the market packs and is not changed here.)
for (const source of [
  'Your Osko payment of AUD 50.00 to Jane was received by her bank on 12/09/2026',
  'Osko payment of AUD 50.00 received from John. Pending until processed',
]) {
  const result = certify(source, 'AU', 'anz-australia');
  ok(`AU: the certified Osko template does not match — ${source}`,
    result.decision !== 'automatic' && result.templateId === null, JSON.stringify(result));
}

ok('certification registry exposes only stable ids to diagnostics',
  certifiedUniversalTemplateIds().length === 22 &&
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
