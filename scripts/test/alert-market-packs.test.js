const { inspectMarketAlert } = require('./build/alert-semantics.js');
const {
  runMarketBenchmark,
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

const firstWaveMarkets = ['BH', 'DE', 'EG', 'ES', 'FR', 'GB', 'IN', 'IT', 'JO', 'KW', 'NL', 'OM', 'QA', 'US'];
ok('all first-wave markets are reachable through the review interface',
  firstWaveMarkets.every((market) => inspectMarketAlert('Bank notice', market).market === market));

{
  const identified = inspectMarketAlert(
    'HDFC Bank card purchase INR 42.10 was debited at SAMPLE SHOP',
    'IN',
    { sender: 'HDFC-BK' },
  );
  const conflict = inspectMarketAlert(
    'Bank of America card charged USD 5.00 at SAMPLE SHOP',
    'US',
    { sender: 'WELLSFARGO' },
  );
  ok('sender and content can identify an institution without bypassing review safety',
    identified.institution.decision === 'identified' &&
    identified.institution.institution === 'hdfc-bank' &&
    identified.decision === 'review', JSON.stringify(identified.institution));
  ok('conflicting institution evidence remains ambiguous',
    conflict.institution.decision === 'ambiguous' &&
    conflict.institution.institution === null &&
    conflict.institution.reasons.includes('sender-body-conflict'),
    JSON.stringify(conflict.institution));
  ok('institution evidence never retains the raw alert or sender',
    !JSON.stringify(identified.institution).includes('SAMPLE SHOP') &&
    !JSON.stringify(identified.institution).includes('HDFC-BK'),
    JSON.stringify(identified.institution));
}

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

  const hindiPurchase = inspectMarketAlert('कार्ड खरीद INR 1,250.50 डेबिट किया गया', 'IN');
  const hindiDecline = inspectMarketAlert('कार्ड भुगतान INR 500.00 अस्वीकृत', 'IN');
  ok('Hindi posted card activity is reviewable with exact INR money',
    hindiPurchase.decision === 'review' && hindiPurchase.status === 'posted' &&
    hindiPurchase.family === 'purchase' && hindiPurchase.direction === 'debit' &&
    hindiPurchase.draft.candidates[0]?.minorUnits === '125050',
    JSON.stringify(hindiPurchase));
  ok('Hindi failed activity is never posted',
    hindiDecline.status === 'failed' && hindiDecline.decision === 'refuse',
    JSON.stringify(hindiDecline));
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

{
  const directDebit = inspectMarketAlert('Lastschrift EUR 25,00 wurde abgebucht', 'DE');
  ok('one German direct debit is evidence, not automatically a subscription',
    directDebit.status === 'posted' && directDebit.family !== 'recurring-payment' &&
    directDebit.eventEvidence.scheduledDebit?.scheme === 'sepa-direct-debit',
    JSON.stringify(directDebit));
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
  const mandate = inspectMarketAlert(
    'UPI AutoPay mandate registered for INR 299.00. UMN XX-REDACTED. Next debit tomorrow.',
    'IN',
  );
  ok('an explicit mandate becomes structured subscription evidence without posting spending',
    mandate.status === 'informational' && mandate.family !== 'recurring-payment' &&
    mandate.decision === 'refuse' &&
    mandate.eventEvidence.scheduledDebit?.subject === 'mandate' &&
    mandate.eventEvidence.scheduledDebit.scheme === 'upi-autopay' &&
    mandate.eventEvidence.scheduledDebit.event === 'created' &&
    mandate.eventEvidence.scheduledDebit.amountRole === 'maximum' &&
    mandate.eventEvidence.scheduledDebit.amountCandidateIndex === 0 &&
    mandate.eventEvidence.scheduledDebit.hasReference === true,
    JSON.stringify(mandate));

  const successfulSetup = inspectMarketAlert(
    'UPI AutoPay e-mandate setup successful for INR 299.00',
    'IN',
  );
  ok('successful mandate setup is lifecycle evidence, never posted money',
    successfulSetup.status === 'informational' &&
      successfulSetup.decision === 'refuse' &&
      successfulSetup.family !== 'recurring-payment' &&
      successfulSetup.eventEvidence.scheduledDebit?.event === 'created',
    JSON.stringify(successfulSetup));

  const bareExecution = inspectMarketAlert(
    'UPI AutoPay mandate executed for INR 299.00. UMN XX-REDACTED.',
    'IN',
  );
  ok('a bare executed lifecycle notice is not proof that money moved',
    bareExecution.status === 'informational' && bareExecution.decision === 'refuse' &&
      bareExecution.eventEvidence.scheduledDebit?.event === 'executed' &&
      bareExecution.eventEvidence.scheduledDebit.amountRole === 'none',
    JSON.stringify(bareExecution));

  const postedExecution = inspectMarketAlert(
    'UPI AutoPay mandate executed and INR 299.00 was debited from your account.',
    'IN',
  );
  ok('an executed mandate needs independent debit evidence before review',
    postedExecution.status === 'posted' && postedExecution.decision === 'review' &&
      postedExecution.eventEvidence.scheduledDebit?.event === 'executed' &&
      postedExecution.eventEvidence.scheduledDebit.amountRole === 'posted',
    JSON.stringify(postedExecution));

  const fundsReleased = inspectMarketAlert(
    'UPI mandate funds unblocked for INR 299.00.',
    'IN',
  );
  ok('released mandate funds are informational and never spending',
    fundsReleased.status === 'informational' && fundsReleased.decision === 'refuse' &&
      fundsReleased.eventEvidence.scheduledDebit?.event === 'funds-released' &&
      fundsReleased.eventEvidence.scheduledDebit.amountRole === 'none',
    JSON.stringify(fundsReleased));

  const cancelled = inspectMarketAlert(
    'Your standing order for GBP 25.00 has been cancelled. Reference REDACTED.',
    'GB',
  );
  ok('a cancelled standing order is evidence only and never a transaction',
    cancelled.status === 'informational' && cancelled.decision === 'refuse' &&
    cancelled.family !== 'recurring-payment' &&
    cancelled.eventEvidence.scheduledDebit?.subject === 'standing-instruction' &&
    cancelled.eventEvidence.scheduledDebit.event === 'cancelled' &&
    cancelled.eventEvidence.scheduledDebit.amountRole === 'none' &&
    cancelled.eventEvidence.scheduledDebit.amountCandidateIndex === null,
    JSON.stringify(cancelled));

  const directDebit = inspectMarketAlert(
    'Direct debit USD 40.00 was debited from account ending 4321 to MERCHANT',
    'US',
  );
  ok('one direct debit is recorded as commitment evidence but not called a subscription',
    directDebit.decision === 'review' && directDebit.family !== 'recurring-payment' &&
    directDebit.eventEvidence.scheduledDebit?.subject === 'direct-debit' &&
    directDebit.eventEvidence.instrument?.kind === 'account' &&
    directDebit.eventEvidence.instrument.last4 === '4321',
    JSON.stringify(directDebit));

  const utilityDebit = inspectMarketAlert(
    'Direct debit GBP 40.00 was debited for an energy bill',
    'GB',
  );
  ok('payment scheme stays separate from the economic utility family',
    utilityDebit.family === 'utility' &&
    utilityDebit.eventEvidence.utility?.event === 'posted' &&
    utilityDebit.eventEvidence.scheduledDebit?.subject === 'direct-debit',
    JSON.stringify(utilityDebit));
}

{
  const cardFee = inspectMarketAlert(
    'Annual card fee USD 50.00 was charged to card ending 9876',
    'US',
  );
  const accountFee = inspectMarketAlert(
    'Monthly account maintenance fee USD 8.00 was debited from account ending 2468',
    'US',
  );
  ok('card fees carry scoped instrument evidence',
    cardFee.family === 'fee' && cardFee.eventEvidence.fee?.scope === 'card' &&
    cardFee.eventEvidence.instrument?.kind === 'card' &&
    cardFee.eventEvidence.instrument.last4 === '9876',
    JSON.stringify(cardFee));
  ok('account fees carry scoped instrument evidence',
    accountFee.family === 'fee' &&
    accountFee.eventEvidence.fee?.scope === 'account' &&
    accountFee.eventEvidence.instrument?.kind === 'account' &&
    accountFee.eventEvidence.instrument.last4 === '2468',
    JSON.stringify(accountFee));

  const scheduledFee = inspectMarketAlert(
    'Annual card fee USD 50.00 will be charged to card ending 9876 next month',
    'US',
  );
  ok('a scheduled fee is evidence but never posted spending',
    scheduledFee.status === 'future' && scheduledFee.decision === 'refuse' &&
    scheduledFee.eventEvidence.fee?.event === 'scheduled',
    JSON.stringify(scheduledFee));
}

{
  const synthetic = [{
    id: 'synthetic-1', market: 'IN', institution: 'synthetic', provenance: 'synthetic',
    channel: 'sms', templateVersion: 'synthetic-v1', split: 'authoring',
    source: 'Card purchase INR 10.00 was debited at SHOP',
    expected: {
      decision: 'review', status: 'posted', family: 'purchase',
      money: { currency: 'INR', minorUnits: '1000', direction: 'debit' },
    },
  }];
  const report = runMarketBenchmark('IN', synthetic);
  ok('synthetic fixtures can never unlock automatic import',
    report.stage === 'review' && report.blockers.includes('not-enough-consented-real-fixtures'));
}

{
  const postedCases = {
    purchase: ['Card purchase GBP 10.00 was debited at SHOP', 'debit'],
    transfer: ['GBP 10.00 was debited by bank transfer to RAVI', 'debit'],
    'cash-withdrawal': ['Cash withdrawal GBP 10.00 was debited at an ATM', 'debit'],
    refund: ['Refunded GBP 10.00 to your card', 'credit'],
    fee: ['Annual fee GBP 10.00 was charged', 'debit'],
    utility: ['GBP 10.00 was debited for an energy bill', 'debit'],
    'recurring-payment': [
      'Recurring automatic payment GBP 10.00 was debited to STREAMCO', 'debit',
    ],
  };
  const informationalCases = {
    statement: 'Statement amount due GBP 10.00',
    balance: 'Available balance GBP 10.00',
    authentication: 'OTP 445566 is your verification code. Do not share.',
  };
  const expectedFor = (family) => {
    if (postedCases[family]) {
      const [source, direction] = postedCases[family];
      return {
        source,
        expected: {
          decision: 'review', status: 'posted', family,
          money: { currency: 'GBP', minorUnits: '1000', direction },
        },
      };
    }
    return {
      source: informationalCases[family],
      expected: { decision: 'refuse', status: 'informational', family, money: null },
    };
  };
  const families = [
    'purchase', 'transfer', 'cash-withdrawal', 'refund', 'fee', 'utility',
    'recurring-payment', 'statement', 'balance', 'authentication',
  ];
  const outcomes = [
    ...Array.from({ length: 20 }, () => ({
      source: 'Card purchase GBP 10.00 was declined',
      expected: { decision: 'refuse', status: 'failed', family: 'purchase', money: null },
    })),
    ...Array.from({ length: 20 }, () => ({
      source: 'Card payment GBP 10.00 will be debited tomorrow',
      expected: { decision: 'refuse', status: 'future', family: 'purchase', money: null },
    })),
    ...Array.from({ length: 260 }, (_, index) => expectedFor(families[index % families.length])),
  ];
  const perfectReal = outcomes.map((outcome, index) => ({
    id: `real-${index}`, market: 'GB', institution: `bank-${index % 5}`,
    channel: 'sms', templateVersion: `held-out-${index}`, split: 'held-out',
    provenance: 'consented-redacted', ...outcome,
    source: `${outcome.source} Ref case-${index}`,
  }));
  const measured = runMarketBenchmark('GB', perfectReal);
  ok('a complete corpus is measured by the shipping inspector, not caller-authored actuals',
    measured.metrics.postedPrecision.ratio === 1 &&
    measured.metrics.postedRecall.ratio === 1 &&
    measured.metrics.statusAccuracy.ratio === 1 &&
    measured.metrics.reviewDecisionRecall.ratio === 1 &&
    measured.metrics.exactMoneyAndDirection.ratio === 1 &&
    measured.metrics.familyPrecision.ratio === 1 &&
    measured.metrics.recurringAlertRecall.ratio === 1 &&
    Object.values(measured.metrics.familyRecall).every((result) => result.ratio === 1),
    JSON.stringify(measured));
  ok('automatic import remains closed until the real dedupe path is benchmarked',
    measured.stage === 'review' && measured.blockers.includes('duplicate-rate-unmeasured'));
  const positiveOnly = perfectReal.map((fixture) => ({
    ...fixture,
    source: `Card purchase GBP 10.00 was debited at SHOP Ref ${fixture.id}`,
    expected: {
      decision: 'review', status: 'posted', family: 'purchase',
      money: { currency: 'GBP', minorUnits: '1000', direction: 'debit' },
    },
  }));
  ok('an all-positive purchase corpus cannot unlock a market',
    runMarketBenchmark('GB', positiveOnly).blockers.includes('not-enough-non-posted-fixtures'));
  const lowRecall = perfectReal.map((fixture, index) => ({
    ...fixture,
    source: fixture.expected.status === 'posted' && index % 2 !== 0
      ? `Bank notice GBP 10.00 Ref ${index}`
      : fixture.source,
  }));
  const lowRecallReport = runMarketBenchmark('GB', lowRecall);
  ok('source text, not a supplied actual field, can close the recall gate',
    lowRecallReport.blockers.includes('posted-recall') &&
    lowRecallReport.failures.some((failure) => failure.reasons.includes('status')));
  const refusedReviews = perfectReal.map((fixture, index) =>
    fixture.expected.decision === 'review'
      ? {
          ...fixture,
          source: `Card charged GBP 10.00 at SHOP. Available balance GBP 800.00 Ref refuse-${index}`,
        }
      : fixture);
  const refusedReviewReport = runMarketBenchmark('GB', refusedReviews);
  ok('legitimate alerts cannot pass rollout while the reviewer refuses them',
    refusedReviewReport.blockers.includes('review-decision-recall') &&
      refusedReviewReport.metrics.reviewDecisionRecall.ratio < 0.95,
    JSON.stringify(refusedReviewReport.metrics.reviewDecisionRecall));
  const noFailed = perfectReal.map((fixture) => ({
    ...fixture,
    expected: fixture.expected.status === 'failed'
      ? { ...fixture.expected, status: 'informational' }
      : fixture.expected,
  }));
  ok('failed and declined held-out examples are mandatory',
    runMarketBenchmark('GB', noFailed).blockers.includes('not-enough-failed-fixtures'));
  const forbidden = perfectReal.map((fixture, index) => index === 40 ? {
    ...fixture,
    expected: { ...fixture.expected, decision: 'refuse' },
  } : fixture);
  const forbiddenReport = runMarketBenchmark('GB', forbidden);
  ok('forbidden review decisions are derived from the inspector result',
    forbiddenReport.blockers.includes('forbidden-import') &&
    forbiddenReport.failures.some((failure) =>
      failure.fixtureRef === 'case-41' && failure.reasons.includes('forbidden-import')));

  const missedRecurring = perfectReal.map((fixture, index) =>
    fixture.expected.family === 'recurring-payment'
      ? {
          ...fixture,
          source: `Card purchase GBP 10.00 was debited at SHOP Ref miss-${index}`,
        }
      : fixture);
  const missedRecurringReport = runMarketBenchmark('GB', missedRecurring);
  ok('recurring alerts need recall as well as precision',
    missedRecurringReport.blockers.includes('recurring-alert-recall') &&
      missedRecurringReport.blockers.includes('family-recall:recurring-payment'),
    JSON.stringify({ blockers: missedRecurringReport.blockers,
      recall: missedRecurringReport.metrics.recurringAlertRecall }));

  const contaminated = perfectReal.map((fixture) => ({ ...fixture }));
  contaminated.push({
    ...contaminated[0], id: 'authoring-copy', split: 'authoring',
  });
  ok('a template cannot appear in both authoring and held-out benchmark splits',
    runMarketBenchmark('GB', contaminated).blockers.includes('template-split-leakage') &&
      runMarketBenchmark('GB', contaminated).blockers.includes('source-split-leakage'));

  const duplicated = [...perfectReal, { ...perfectReal[0] }];
  const duplicateReport = runMarketBenchmark('GB', duplicated);
  ok('duplicate ids and evidence cannot pad benchmark counts',
    duplicateReport.blockers.includes('duplicate-fixture-id') &&
      duplicateReport.blockers.includes('duplicate-fixture-source') &&
      duplicateReport.heldOutRealFixtureCount === perfectReal.length);

  const badReal = perfectReal.map((fixture) => ({
    ...fixture, source: `Private bank notice GBP 10.00 marker-never-echo-this ${fixture.id}`,
  }));
  const syntheticPadding = Array.from({ length: 200 }, (_, index) => ({
    ...perfectReal[0], id: `padding-${index}`, institution: 'synthetic',
    templateVersion: `synthetic-${index}`, split: 'authoring', provenance: 'synthetic',
  }));
  const badReport = runMarketBenchmark('GB', [...badReal, ...syntheticPadding]);
  ok('synthetic fixtures cannot dilute failures in the held-out real benchmark',
    badReport.blockers.includes('posted-recall') && badReport.metrics.postedRecall.ratio === 0);
  ok('auditable reports identify failed fixtures without echoing financial source text',
    badReport.failures.length > 0 &&
    !JSON.stringify(badReport).includes('marker-never-echo-this') &&
    !JSON.stringify(badReport).includes('real-'));
}

console.log(`\nalert-market-packs: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
