const { inspectMarketAlert } = require('./build/alert-semantics.js');
const { ALERT_MARKET_PACKS } = require('./build/alert-market-packs.js');
const {
  UNIVERSAL_AUTO_IMPORT_GATES,
  evaluateMarketRollout,
} = require('./build/alert-rollout.js');

let pass = 0;
let fail = 0;
const ok = (name, condition, detail) => {
  if (condition) {
    pass += 1;
    console.log(`✓ ${name}`);
  } else {
    fail += 1;
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

ok('all first-wave markets have isolated review packs',
  Object.keys(ALERT_MARKET_PACKS).sort().join(',') ===
    'BH,DE,EG,ES,FR,GB,IN,IT,JO,KW,NL,OM,QA,US');

{
  const result = inspectMarketAlert('Rs. 1,25,000.50 debited through UPI fund transfer to RAVI', 'IN');
  ok('India pack scopes Rs. to INR and preserves Indian grouping',
    result.decision === 'review' && result.family === 'transfer' &&
    result.direction === 'debit' && result.rail === 'upi' &&
    result.draft.candidates[0]?.currency === 'INR' &&
    result.draft.candidates[0]?.minorUnits === '12500050', JSON.stringify(result));

  const lowercase = inspectMarketAlert('rs 500.00 debited through UPI to SHOP', 'IN');
  ok('India-scoped Rs alias outranks the globally ambiguous symbol',
    lowercase.draft.candidates[0]?.currency === 'INR' &&
    lowercase.draft.candidates[0]?.currencyCandidates.join(',') === 'INR',
    JSON.stringify(lowercase));

  const groupedInteger = inspectMarketAlert('Rs. 1,25,000 debited for a purchase', 'IN');
  ok('Indian grouped integers parse without requiring a decimal fraction',
    groupedInteger.draft.candidates[0]?.minorUnits === '12500000',
    JSON.stringify(groupedInteger));
}

{
  const usdFraction = inspectMarketAlert('Card charged USD 10.5 at SHOP', 'US');
  const kwdFraction = inspectMarketAlert('Card charged KWD 1.2 at SHOP', 'KW');
  const scopedDollar = inspectMarketAlert('Card charged $10.50 at SHOP', 'US');
  ok('short decimal fractions pad to the currency exponent',
    usdFraction.draft.candidates[0]?.minorUnits === '1050' &&
    kwdFraction.draft.candidates[0]?.minorUnits === '1200',
    `${JSON.stringify(usdFraction)} | ${JSON.stringify(kwdFraction)}`);
  ok('US market context narrows dollar symbol to USD',
    scopedDollar.draft.candidates[0]?.currency === 'USD', JSON.stringify(scopedDollar));
}

for (const [label, text] of [
  ['UPI collect request', 'UPI collect request for INR 500.00. Amount will be debited if approved.'],
  ['AutoPay pre-debit', 'UPI AutoPay pre-debit notice: INR 299.00 will be debited tomorrow.'],
  ['OTP authorization', 'OTP 445566 approves purchase INR 900.00. Do not share.'],
  ['decline', 'Your AEPS cash withdrawal of INR 500.00 was declined.'],
]) {
  const result = inspectMarketAlert(text, 'IN');
  ok(`${label} is never treated as posted spending`,
    result.decision === 'refuse' && result.status !== 'posted', JSON.stringify(result));
}

{
  const result = inspectMarketAlert('Card purchase KD 1,234.567 was debited at SHOP', 'KW');
  ok('Kuwait pack uses the KWD three-decimal exponent',
    result.decision === 'review' && result.draft.candidates[0]?.currency === 'KWD' &&
    result.draft.candidates[0]?.minorUnits === '1234567', JSON.stringify(result));
  ok('a payment rail alone is not classified as a transfer',
    inspectMarketAlert('Card purchase KD 12.000 was debited through KNET', 'KW').family === 'purchase');
}

{
  const result = inspectMarketAlert(
    'Card purchase USD 20.00 was debited at SHOP. Available balance USD 800.00', 'US',
  );
  ok('a trailing balance does not suppress a posted transaction',
    result.status === 'posted' && result.family === 'purchase' &&
    result.moneyRoles.join(',') === 'transaction,balance' &&
    result.primaryCandidateIndex === 0, JSON.stringify(result));
}

{
  const result = inspectMarketAlert('تم الخصم د.ب ١٢٫٣٤٥ لشراء بالبطاقة', 'BH');
  ok('Bahrain pack grounds Arabic digits and BHD alias',
    result.decision === 'review' && result.direction === 'debit' &&
    result.draft.candidates[0]?.currency === 'BHD', JSON.stringify(result));
}

for (const [market, text, family, direction] of [
  ['FR', 'Paiement par carte débité de EUR 12,34 chez BOUTIQUE', 'purchase', 'debit'],
  ['DE', 'Kartenzahlung EUR 12,34 wurde belastet', 'purchase', 'debit'],
  ['ES', 'Compra con tarjeta por EUR 12,34 cargado', 'purchase', 'debit'],
  ['IT', 'Pagamento con carta EUR 12,34 addebitato', 'purchase', 'debit'],
  ['NL', 'EUR 12,34 afgeschreven voor een pasbetaling', 'purchase', 'debit'],
]) {
  const result = inspectMarketAlert(text, market);
  ok(`${market} localized posted purchase stays review-only`,
    result.decision === 'review' && result.family === family && result.direction === direction,
    JSON.stringify(result));
}

for (const [market, text] of [
  ['FR', 'Paiement par carte EUR 10,00 refusé'],
  ['DE', 'Kartenzahlung EUR 10,00 abgelehnt'],
  ['ES', 'Compra con tarjeta EUR 10,00 rechazado'],
  ['IT', 'Pagamento con carta EUR 10,00 rifiutato'],
  ['NL', 'Pasbetaling EUR 10,00 geweigerd'],
]) {
  const result = inspectMarketAlert(text, market);
  ok(`${market} localized failure is never posted`,
    result.status === 'failed' && result.decision === 'refuse', JSON.stringify(result));
}

for (const [market, text, currency, minorUnits] of [
  ['QA', 'تم الخصم ر.ق ١٢٫٣٤ لشراء بالبطاقة', 'QAR', '1234'],
  ['OM', 'تم الخصم ر.ع ١٢٫٣٤٥ لشراء بالبطاقة', 'OMR', '12345'],
  ['EG', 'تم الخصم ج.م ١٢٫٣٤ لشراء بالبطاقة', 'EGP', '1234'],
  ['JO', 'تم الخصم د.أ ١٢٫٣٤٥ لشراء بالبطاقة', 'JOD', '12345'],
]) {
  const result = inspectMarketAlert(text, market);
  ok(`${market} Arabic alias and exponent stay market-scoped`,
    result.decision === 'review' && result.draft.candidates[0]?.currency === currency &&
    result.draft.candidates[0]?.interpretations.some(
      (item) => item.currency === currency && item.minorUnits === minorUnits,
    ), JSON.stringify(result));
}

for (const [label, market, text, family] of [
  ['fee', 'US', 'Annual fee USD 50.00 was charged', 'fee'],
  ['refund', 'US', 'Refunded USD 12.00 to your card', 'refund'],
  ['utility', 'GB', 'GBP 40.00 was debited for an energy bill', 'utility'],
  ['transfer', 'IN', 'INR 500.00 sent by fund transfer', 'transfer'],
]) {
  const result = inspectMarketAlert(text, market);
  ok(`${label} family requires explicit evidence`,
    result.decision === 'review' && result.family === family, JSON.stringify(result));
}

{
  const outbound = inspectMarketAlert(
    'USD 100.00 was debited from your account and credited to the beneficiary by bank transfer',
    'US',
  );
  ok('outbound transfer direction follows the user account, not the beneficiary',
    outbound.family === 'transfer' && outbound.direction === 'debit', JSON.stringify(outbound));
}

{
  const statement = inspectMarketAlert('Statement amount due USD 50.00', 'US');
  const genericInvoice = inspectMarketAlert('تم الخصم ر.ق ١٢٫٣٤ فاتورة متجر', 'QA');
  const upiMerchant = inspectMarketAlert('Rs 500.00 debited through UPI to SHOP', 'IN');
  ok('statement due amount remains informational and non-importable',
    statement.status === 'informational' && statement.family === 'statement' &&
    statement.decision === 'refuse', JSON.stringify(statement));
  ok('a generic Arabic invoice is not assumed to be a utility',
    genericInvoice.family !== 'utility', JSON.stringify(genericInvoice));
  ok('UPI rail plus debit does not imply a bank transfer',
    upiMerchant.family !== 'transfer', JSON.stringify(upiMerchant));
}

{
  const oneOff = inspectMarketAlert('Card charged USD 19.99 at STREAMCO', 'US');
  const recurring = inspectMarketAlert('Recurring automatic payment USD 19.99 posted to STREAMCO', 'US');
  ok('a single merchant charge is not called a subscription',
    oneOff.family === 'purchase', JSON.stringify(oneOff));
  ok('explicit posted recurrence may be suggested for review',
    recurring.family === 'recurring-payment' && recurring.decision === 'review',
    JSON.stringify(recurring));
}

{
  const synthetic = [{
    id: 'synthetic-1', market: 'IN', institution: 'synthetic', provenance: 'synthetic',
    channel: 'sms', templateVersion: 'synthetic-v1', split: 'authoring',
    expectedStatus: 'posted', expectedMoneyExact: true, expectedFamily: 'purchase',
    actualStatus: 'posted', actualMoneyExact: true, actualFamily: 'purchase',
    duplicate: false, forbiddenImport: false,
  }];
  const report = evaluateMarketRollout('IN', synthetic, 0);
  ok('synthetic fixtures can never unlock automatic import',
    report.stage === 'review' && report.blockers.includes('not-enough-consented-real-fixtures'));
}

{
  const perfectReal = Array.from(
    { length: UNIVERSAL_AUTO_IMPORT_GATES.minimumConsentedRealFixtures },
    (_, index) => {
      const families = [
        'purchase', 'transfer', 'cash-withdrawal', 'refund', 'fee', 'utility',
        'recurring-payment', 'statement', 'balance', 'authentication',
      ];
      const expectedFamily = families[index % families.length];
      const expectedStatus = index < 20
        ? 'failed'
        : index < 40
          ? 'future'
          : ['statement', 'balance', 'authentication'].includes(expectedFamily)
            ? 'informational'
            : 'posted';
      return {
        id: `real-${index}`, market: 'GB', institution: `bank-${index % 5}`,
        channel: 'sms', templateVersion: `held-out-${index}`, split: 'held-out',
        provenance: 'consented-redacted', expectedStatus, expectedMoneyExact: true,
        expectedFamily, actualStatus: expectedStatus, actualMoneyExact: true,
        actualFamily: expectedFamily, duplicate: false, forbiddenImport: false,
      };
    },
  );
  ok('automatic stage requires the complete measured gate, not a feature flag alone',
    evaluateMarketRollout('GB', perfectReal, 0).stage === 'automatic');
  const positiveOnly = perfectReal.map((fixture) => ({
    ...fixture, expectedStatus: 'posted', actualStatus: 'posted',
    expectedFamily: 'purchase', actualFamily: 'purchase',
  }));
  ok('an all-positive purchase corpus cannot unlock a market',
    evaluateMarketRollout('GB', positiveOnly, 0).stage === 'review');
  const lowRecall = perfectReal.map((fixture, index) => ({
    ...fixture,
    actualStatus: fixture.expectedStatus === 'posted' && index % 2 !== 0
      ? 'unknown'
      : fixture.actualStatus,
  }));
  ok('missing most real posted alerts closes the recall gate',
    evaluateMarketRollout('GB', lowRecall, 0).blockers.includes('posted-recall'));
  const noFailed = perfectReal.map((fixture) => ({
    ...fixture,
    expectedStatus: fixture.expectedStatus === 'failed' ? 'informational' : fixture.expectedStatus,
    actualStatus: fixture.actualStatus === 'failed' ? 'informational' : fixture.actualStatus,
  }));
  ok('failed and declined held-out examples are mandatory',
    evaluateMarketRollout('GB', noFailed, 0).blockers.includes('not-enough-failed-fixtures'));
  perfectReal[0].forbiddenImport = true;
  ok('one forbidden import closes the automatic gate',
    evaluateMarketRollout('GB', perfectReal, 0).blockers.includes('forbidden-import'));
  perfectReal[0].forbiddenImport = false;
  ok('one UAE/Saudi regression closes every new-market gate',
    evaluateMarketRollout('GB', perfectReal, 1).blockers.includes('uae-saudi-regression'));

  const contaminated = perfectReal.map((fixture) => ({ ...fixture }));
  contaminated.push({
    ...contaminated[0], id: 'authoring-copy', split: 'authoring',
  });
  ok('a template cannot appear in both authoring and held-out benchmark splits',
    evaluateMarketRollout('GB', contaminated, 0).blockers.includes('template-split-leakage'));

  const badReal = perfectReal.map((fixture) => ({
    ...fixture, actualStatus: 'unknown', actualMoneyExact: false, actualFamily: 'unknown',
  }));
  const syntheticPadding = Array.from({ length: 10_000 }, (_, index) => ({
    ...perfectReal[0], id: `padding-${index}`, institution: 'synthetic',
    templateVersion: `synthetic-${index}`, split: 'authoring', provenance: 'synthetic',
    actualStatus: 'posted',
  }));
  ok('synthetic fixtures cannot dilute failures in the held-out real benchmark',
    evaluateMarketRollout('GB', [...badReal, ...syntheticPadding], 0).stage === 'review');
}

console.log(`\nalert-market-packs: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
