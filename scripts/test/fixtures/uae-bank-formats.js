/**
 * Named UAE bank-alert corpus.
 *
 * Privacy is part of the fixture format: every customer/card/account/reference
 * value is masked or replaced. `evidence` says what the wording can prove.
 * Synthetic rows are grammar probes only and must never be presented as a
 * verbatim bank message. Source links and evidence notes live beside this file
 * in public-sources.md.
 *
 * Keep expectations structural. A category belongs here only when the bank
 * wording identifies the merchant or biller strongly enough to make it part
 * of parsing accuracy (rather than a product-vocabulary opinion).
 */
module.exports = Object.freeze([
  {
    id: 'enbd-credit-card-purchase',
    bank: 'ENBD',
    channel: 'sms',
    evidence: 'repository-redacted',
    body:
      'Purchase of AED 89.50 with Credit Card ending 4844 at CARREFOUR, DUBAI. ' +
      'Avl Cr. Limit AED 14,671.30',
    expect: {
      kind: 'transaction',
      type: 'expense',
      amountFils: 8950,
      currency: 'AED',
      merchant: 'Carrefour',
      date: null,
      card: { last4: '4844', kind: 'credit' },
      reference: null,
      transferHint: false,
      snapshotFils: 1467130,
      snapshotKind: 'limit',
    },
  },
  {
    // Renamed from 'adcb-salik-card-debit'. "Acc/Cr.Card" is ADCB's explicit
    // credit abbreviation, and "Avl.Limit" corroborates it — so this is a
    // CREDIT card, not the debit the old expectation asserted and not untyped
    // either. Reading it as unknown would leave a real credit card
    // unidentified, the opposite failure to the one `unknown` prevents.
    id: 'adcb-salik-card-credit',
    bank: 'ADCB',
    channel: 'sms',
    evidence: 'repository-redacted',
    body:
      'AED300.00 debited from Acc/Cr.Card XXX7720 for Salik on 11-02-2025 ' +
      '09:03:37 through ADCB Mobile App.Avl.Limit is AED 2508.31',
    expect: {
      kind: 'transaction',
      type: 'expense',
      amountFils: 30000,
      currency: 'AED',
      merchant: 'Salik',
      date: '2025-02-11',
      card: { last4: '7720', kind: 'credit' },
      reference: null,
      transferHint: false,
      snapshotFils: 250831,
      snapshotKind: 'limit',
    },
  },
  {
    id: 'fab-multiline-card-purchase',
    bank: 'FAB',
    channel: 'sms',
    evidence: 'repository-redacted',
    body:
      'Credit Card Purchase\nCard No XXXX4711\nAED 76.50\nTAP*Keeta Dubai ARE\n' +
      '15/12/25 22:34\nAvailable Balance AED 7875.65\n' +
      'Your December statement payment due date is 26/12/2025',
    expect: {
      kind: 'transaction',
      type: 'expense',
      amountFils: 7650,
      currency: 'AED',
      merchant: 'Keeta',
      date: '2025-12-15',
      card: { last4: '4711', kind: 'credit' },
      reference: null,
      transferHint: false,
      snapshotFils: 787565,
      snapshotKind: 'limit',
    },
  },
  {
    id: 'fab-account-credit-with-reference',
    bank: 'FAB',
    channel: 'sms',
    evidence: 'repository-redacted',
    body:
      'AED 15,000.00 has been credited to your account no. 095-XXX11XXX-0001 ' +
      'IPI TT REF: XXOTTXXXX075 RENT PAYMENTS on 25/07/2026',
    expect: {
      kind: 'transaction',
      type: 'income',
      amountFils: 1500000,
      currency: 'AED',
      merchant: 'Incoming transfer',
      date: '2026-07-25',
      card: { last4: '0001', kind: 'account' },
      reference: 'XXOTTXXXX075',
      transferHint: false,
      snapshotFils: null,
      snapshotKind: null,
    },
  },
  {
    id: 'mashreq-foreign-compact-date',
    bank: 'Mashreq',
    channel: 'sms',
    evidence: 'public-redacted',
    body:
      'Please note the details of a recent transaction on your Mashreq Credit Card. ' +
      'Your Etisalat Card ending with 0000 was used for a purchase of USD 24.00 at ' +
      'GOOGLE *Domains g.co/helppay# US on 22Jan18 09:35 AM. ' +
      'Available limit is AED 2207.33.',
    expect: {
      kind: 'transaction',
      type: 'expense',
      amountFils: 8814,
      currency: 'AED',
      originalAmountMinor: 2400,
      originalCurrency: 'USD',
      fxSource: 'fallback',
      merchant: 'Google Domains',
      date: '2018-01-22',
      card: { last4: '0000', kind: 'credit' },
      reference: null,
      transferHint: false,
      snapshotFils: 220733,
      snapshotKind: 'limit',
    },
  },
  {
    id: 'adib-compact-masked-card',
    bank: 'ADIB',
    channel: 'sms',
    evidence: 'public-redacted',
    body: 'XXX456789 was used for AED 42.50 on Jan 17 2023 1:04PM at CARREFOUR,AE.',
    expect: {
      kind: 'transaction',
      type: 'expense',
      amountFils: 4250,
      currency: 'AED',
      merchant: 'Carrefour',
      date: '2023-01-17',
      card: { last4: '6789', kind: 'unknown' },
      reference: null,
      transferHint: false,
      snapshotFils: null,
      snapshotKind: null,
    },
  },
  {
    id: 'rakbank-retail-grammar-probe',
    bank: 'RAKBANK',
    channel: 'sms',
    evidence: 'synthetic-grammar-probe',
    body:
      'Your RAKBANK Credit Card ending 0000 was used for AED 120.00 at CARREFOUR ' +
      'on 31/07/2026. Available credit limit AED 8,700.00',
    expect: {
      kind: 'transaction',
      type: 'expense',
      amountFils: 12000,
      currency: 'AED',
      merchant: 'Carrefour',
      date: '2026-07-31',
      card: { last4: '0000', kind: 'credit' },
      reference: null,
      transferHint: false,
      snapshotFils: 870000,
      snapshotKind: 'limit',
    },
  },
  {
    id: 'liv-debit-card-spend',
    bank: 'Liv',
    channel: 'sms',
    evidence: 'repository-redacted',
    body: 'You spent AED 45.00 on your Liv debit card 1354 at STARBUCKS DIFC on 20/07/2026',
    expect: {
      kind: 'transaction',
      type: 'expense',
      amountFils: 4500,
      currency: 'AED',
      merchant: 'Starbucks Difc',
      date: '2026-07-20',
      card: { last4: '1354', kind: 'debit' },
      reference: null,
      transferHint: false,
      snapshotFils: null,
      snapshotKind: null,
    },
  },
  {
    id: 'wio-foreign-with-local-equivalent',
    bank: 'Wio',
    channel: 'push',
    evidence: 'public-redacted',
    body:
      'Payment of INR 270 (AED 10.96) was done at Craft docs using your ' +
      'Wio Personal card 68XX with Own AED funds',
    expect: {
      kind: 'transaction',
      type: 'expense',
      amountFils: 1096,
      currency: 'AED',
      originalAmountMinor: 27000,
      originalCurrency: 'INR',
      fxSource: 'bank',
      // The body says "at Craft docs". "Craft" was the parser's truncation
      // written down as the expected answer, which froze a defect into the
      // fixture: the merchant grammar stopped at the lowercase second word, so
      // Craft Docs could never group with itself as a subscription.
      merchant: 'Craft Docs',
      date: null,
      card: null,
      reference: null,
      transferHint: false,
      snapshotFils: null,
      snapshotKind: null,
    },
  },
]);
