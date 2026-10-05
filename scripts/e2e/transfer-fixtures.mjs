// Synthetic Transfers fixtures shared by the browser suites: never a private export.
// A Liv account whose six transfers each match a payment received on an ADCB
// credit card (same amount, ten minutes apart): the reconciler suggests a card
// repayment for each and groups them as "Liv Account → ?, 6 entries".

/** Accounts and rows for the card-repayment group, dated back from `now`. */
export function cardRepaymentGroup(now = Date.now(), count = 6) {
  const accounts = [
    { id: 'liv', name: 'Liv Account', kind: 'bank', bankName: 'Liv', last4: '3301', openingFils: 500000, color: '#367A61' },
    { id: 'adcb-card', name: 'ADCB Credit Card', kind: 'card', cardType: 'credit', bankName: 'ADCB', last4: '7720', openingFils: 0, color: '#8C2F39' },
  ];
  const dubaiDate = ts => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(ts);
  const transactions = [];
  for (let i = 0; i < count; i++) {
    const ts = now - (i + 1) * 3 * 86400000, amountFils = 50000 + i * 1250;
    transactions.push({ id: `liv-${i}`, type: 'expense', amountFils, accountId: 'liv', category: 'other', title: 'Transfer',
      date: dubaiDate(ts), ts, source: 'sms', smsKey: `s${ts}-liv-${i}`,
      transferEvidence: { version: 1, currency: 'AED', attribution: 'source', sourceBank: 'Liv' } });
    transactions.push({ id: `card-${i}`, type: 'income', amountFils, accountId: 'adcb-card', category: 'other', title: 'Payment received',
      date: dubaiDate(ts + 600000), ts: ts + 600000, source: 'sms', smsKey: `s${ts + 600000}-card-${i}`, cardPaymentSide: 'receipt',
      captureInstrument: { last4: '7720', kind: 'credit', bankIdentity: 'adcb' } });
  }
  return { accounts, transactions };
}
