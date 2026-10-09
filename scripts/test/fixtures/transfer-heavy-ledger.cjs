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

/**
 * Named counterparties as banks write them: forty people and businesses, each
 * name in the spellings different alerts use for it (capitals, a trailing dot,
 * a hyphen for a space), so "Transfers grouped by person" meets the variants a
 * real inbox holds. Synthetic names only.
 */
const NAMED_PEOPLE = ['MARIAM S', 'MOHAMMED AL HASHIMI', 'AHMED KHAN', 'SARA ALI', 'FATIMA NOOR', 'OMAR SAEED', 'RAVI KUMAR',
  'JOHN MATHEW', 'LAYLA H', 'YOUSEF A', 'KHALID R', 'HASSAN M', 'AISHA B', 'PRIYA N', 'ABDULLAH K', 'NASER TRADING LLC',
  'AL FUTTAIM', 'EMAAR PROPERTIES', 'DUBAI SCHOOL', 'MAID AGENCY', 'NOURA T', 'SALEM BIN ALI', 'REEM K', 'TARIQ J', 'HIND M',
  'ZAYED O', 'MAHA Q', 'ANIL VARGHESE', 'GRACE P', 'ARJUN DAS', 'LINA F', 'KAREEM W', 'DANA E', 'SAMIR Y', 'HUDA Z',
  'VIKRAM S', 'MEERA I', 'BILAL U', 'RANIA V', 'FAISAL X'];
const spelling = (name, roll) => roll < 0.6 ? name : roll < 0.75 ? `${name}.`
  : roll < 0.9 ? name.toLowerCase().replace(/\b\p{L}/gu, (letter) => letter.toUpperCase()) : name.replace(/ /, '-');

/**
 * `named` gives every named candidate one of NAMED_PEOPLE in a bank's
 * spelling and a "Transfer to/from NAME" title, and names 60% of candidates
 * (the owner's phone: most transfers name the other person). Off by default,
 * so the pinned graphs of the plain and decided ledgers are unchanged.
 *
 * `decided` adds the person's own answers to every seventh candidate: own
 * (half of them naming another candidate as the other side, with no stored
 * link yet), someone else, and not a transfer. Plain stored data, so the
 * graph's handling of decisions is pinned without building them through the
 * code under test.
 */
function transferHeavyLedger(count = 15000, candidates = 3000, seed = 7, { decided = false, named = false } = {}) {
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
    const counterpartyName = named
      ? random() < 0.6 ? spelling(NAMED_PEOPLE[Math.floor(random() ** 1.6 * NAMED_PEOPLE.length)], random()) : undefined
      : random() < 0.5 ? people[Math.floor(random() * people.length)] : undefined;
    const evidence = { version: 1, currency: 'AED', attribution: 'source', sourceBank: account.bankName,
      ...(counterpartyName ? { counterpartyName } : {}),
      ...(random() < 0.3 ? { counterparty: { last4: String(1000 + Math.floor(random() * 9000)), kind: 'account' } } : {}) };
    const title = named && counterpartyName ? `Transfer ${income ? 'from' : 'to'} ${counterpartyName}`
      : income ? 'Incoming transfer' : 'Outgoing transfer';
    rows.push({ id: `th-${i}`, type: income ? 'income' : 'expense', amountFils, category: 'other',
      title, accountId: account.id,
      date: new Date(at).toISOString().slice(0, 10), ts: at, source: 'sms', smsKey: `s${at}-${amountFils}-th${i}`,
      transferEvidence: evidence });
  }
  if (decided) {
    const byId = new Map(base.accounts.map((a) => [a.id, a]));
    const fab = byId.get('bank-1');
    const enbd = byId.get('bank-0');
    const own = (account) => ({ last4: account.last4, kind: 'account', bankIdentity: account.bankName });
    for (let k = 0; k < 30; k += 1) {
      const at = NOW - (k + 2) * 3 * DAY - 7_200_000;
      const card = byId.get(`card-${k % 10}`);
      const amountFils = 150_000 + k * 1_000;
      // A debit naming a known own credit card (ownership by observation).
      rows.push({ id: `th-known-${k}`, type: 'expense', amountFils, category: 'other', title: 'Outgoing transfer',
        accountId: enbd.id, date: new Date(at).toISOString().slice(0, 10), ts: at, source: 'sms', smsKey: `s${at}-${amountFils}-known${k}`,
        captureInstrument: own(enbd), transferEvidence: { version: 1, currency: 'AED', attribution: 'source', sourceBank: enbd.bankName,
          endpointProof: 'explicit-transfer', counterparty: { last4: card.last4, kind: 'credit', bankIdentity: card.bankName } } });
      // A debit naming a card tail only, and that card's own payment receipt.
      const paidAt = at + DAY / 2;
      const paid = 90_000 + k * 1_000;
      rows.push({ id: `th-repay-${k}`, type: 'expense', amountFils: paid, category: 'other', title: 'Outgoing transfer',
        accountId: enbd.id, date: new Date(paidAt).toISOString().slice(0, 10), ts: paidAt, source: 'sms', smsKey: `s${paidAt}-${paid}-repay${k}`,
        captureInstrument: own(enbd), transferEvidence: { version: 1, currency: 'AED', attribution: 'source', sourceBank: enbd.bankName,
          endpointProof: 'explicit-transfer', counterparty: { last4: card.last4, kind: 'credit' } } });
      rows.push({ id: `th-receipt-${k}`, type: 'income', amountFils: paid, category: 'other', title: 'Payment received',
        accountId: card.id, date: new Date(paidAt + 600_000).toISOString().slice(0, 10), ts: paidAt + 600_000, source: 'sms',
        smsKey: `s${paidAt + 600_000}-${paid}-receipt${k}`, cardPaymentSide: 'receipt', isTransfer: true,
        captureInstrument: { last4: card.last4, kind: 'credit', bankIdentity: card.bankName } });
      // One FAB transfer reported twice: transfer detail, then remittance debit.
      const fabAt = at - DAY;
      const sent = 40_000 + k * 1_000;
      for (const [form, offset] of [['transfer-detail', 0], ['remittance-debit', 45_000]]) {
        rows.push({ id: `th-fab-${form}-${k}`, type: 'expense', amountFils: sent, category: 'other', title: 'Outgoing transfer',
          accountId: fab.id, date: new Date(fabAt + offset).toISOString().slice(0, 10), ts: fabAt + offset, source: 'sms',
          smsKey: `s${fabAt + offset}-${sent}-${form}${k}`, captureInstrument: own(fab),
          transferEvidence: { version: 1, currency: 'AED', attribution: 'source', sourceBank: fab.bankName, postingForm: form } });
      }
    }
    for (let i = 0; i < rows.length; i += 7) {
      const k = i / 7;
      const ownership = ['own', 'external', 'none'][k % 3];
      const partner = ownership === 'own' && k % 2 === 1 ? rows[i + 3] : undefined;
      rows[i] = { ...rows[i], transferDecision: { version: 1, ownership, decidedAt: NOW - k * 60_000,
        ...(partner ? { counterpartId: partner.id } : {}) } };
    }
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

module.exports = { transferHeavyLedger, NAMED_PEOPLE, NOW, DAY };
