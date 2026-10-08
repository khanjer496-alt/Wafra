'use strict';

/**
 * The hot-path ledger reshaped like the owner's phone (diagnostic export,
 * build 376): ~15k rows over 44 accounts with about 3,000 transfer candidates
 * that nobody has answered (incoming and outgoing transfers to and from
 * people, many of them round amounts), 17 card dues and 3 bills.
 *
 * Synthetic: no real messages, people or amounts. Rows are newest-first, as
 * the store keeps them.
 */
const { hotPathLedger, NOW, DAY } = require('./hot-path-ledger.cjs');

function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function transferHeavyLedger(count = 15000, candidates = 3000, seed = 7) {
  const base = hotPathLedger(count - candidates);
  const random = lcg(seed);
  const banks = base.accounts.filter((a) => a.kind === 'bank' && !a.archived);
  const people = Array.from({ length: 120 }, (_, i) => `PERSON ${i}`);
  const rows = [];
  for (let i = 0; i < candidates; i += 1) {
    const at = NOW - Math.floor(random() * 420) * DAY - Math.floor(random() * DAY);
    const income = random() < 0.55;
    const amountFils = random() < 0.45 ? (1 + Math.floor(random() * 30)) * 10_000 : 1_000 + Math.floor(random() * 400_000);
    const account = banks[Math.floor(random() * banks.length)];
    const evidence = { version: 1, currency: 'AED', attribution: 'source', sourceBank: account.bankName,
      ...(random() < 0.5 ? { counterpartyName: people[Math.floor(random() * people.length)] } : {}),
      ...(random() < 0.3 ? { counterparty: { last4: String(1000 + Math.floor(random() * 9000)), kind: 'account' } } : {}) };
    rows.push({ id: `th-${i}`, type: income ? 'income' : 'expense', amountFils, category: 'other',
      title: income ? 'Incoming transfer' : 'Outgoing transfer', accountId: account.id,
      date: new Date(at).toISOString().slice(0, 10), ts: at, source: 'sms', smsKey: `s${at}-${amountFils}-th${i}`,
      transferEvidence: evidence });
  }
  const transactions = [...base.transactions, ...rows].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const credit = base.accounts.filter((a) => a.kind === 'card' && a.cardType === 'credit');
  const cardDues = Array.from({ length: 17 }, (_, i) => ({ id: `due-${i}`, accountId: credit[i % credit.length].id,
    totalDueFils: 250_000 + i * 1_000, minDueFils: 12_500, paidFils: i % 3 === 0 ? 250_000 + i * 1_000 : 0,
    dueDate: new Date(NOW + (i - 10) * 7 * DAY).toISOString().slice(0, 10) }));
  const bills = [
    { id: 'bill-rent', title: 'Rent', category: 'rent', amountFils: 850_000, dueDay: 1, paidMonths: [] },
    { id: 'bill-gym', title: 'Gym', category: 'health', amountFils: 35_000, dueDay: 12, paidMonths: [] },
    { id: 'bill-school', title: 'School', category: 'education', amountFils: 400_000, dueDay: 20, paidMonths: [] },
  ];
  return { ...base, transactions, cardDues, bills };
}

module.exports = { transferHeavyLedger, NOW, DAY };
