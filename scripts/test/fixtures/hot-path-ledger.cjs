'use strict';

/**
 * Synthetic large ledger shaped like a real multi-year Android history.
 *
 * Contains no real messages, merchants' customers or people. Its shape is what
 * matters to the hot-path budgets: ~1,500 merchants with a long tail, 44
 * accounts (credit cards, debit cards, bank accounts, archived ones), card
 * purchases that carry the captured card instrument (the rows that take the
 * canonical import path), evidenced own-account transfer pairs, card-payment
 * debit/receipt pairs, registered bill-payment funding/receipt pairs, monthly
 * subscriptions and utilities, salaries, a sprinkle of bank-app push copies,
 * card statements and one manual bill. Rows are newest-first, as the store
 * keeps them.
 */
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 24, 12);

const BANKS = ['ENBD', 'FAB', 'ADCB', 'Mashreq', 'ADIB'];
const SUBSCRIPTIONS = [
  ['Netflix.com', 5600, 'entertainment'], ['Spotify', 2199, 'entertainment'], ['Apple.com/bill', 1499, 'software'],
  ['Google One', 3699, 'software'], ['OpenAI ChatGPT', 7400, 'software'], ['Anghami', 1999, 'entertainment'],
];
const UTILITIES = [['DEWA', 42000, 'utilities'], ['Etisalat', 38900, 'telecom'], ['du', 21000, 'telecom']];
const CATEGORIES = ['groceries', 'dining', 'transport', 'shopping', 'entertainment', 'health', 'other'];

function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function hotPathLedger(count = 15000, seed = 20260924) {
  const random = lcg(seed);
  const accounts = [];
  for (let i = 0; i < 12; i += 1) {
    accounts.push({ id: `card-${i}`, name: `Credit card ${i}`, kind: 'card', cardType: 'credit',
      bankName: BANKS[i % BANKS.length], last4: String(4100 + i), openingFils: 0, color: '#1F6B52',
      snapshotFils: 2_000_000, snapshotKind: 'limit', snapshotTs: NOW - DAY, ...(i >= 10 ? { archived: true } : {}) });
  }
  for (let i = 0; i < 8; i += 1) {
    accounts.push({ id: `debit-${i}`, name: `Debit card ${i}`, kind: 'card', cardType: 'debit',
      bankName: BANKS[i % BANKS.length], last4: String(5200 + i), openingFils: 0, color: '#1F6B52' });
  }
  for (let i = 0; i < 24; i += 1) {
    accounts.push({ id: `bank-${i}`, name: `Account ${i}`, kind: 'bank', bankName: BANKS[i % BANKS.length],
      last4: String(6300 + i), openingFils: 0, color: '#1F6B52', snapshotFils: 5_000_000, snapshotKind: 'balance',
      snapshotTs: NOW - DAY, ...(i >= 22 ? { archived: true } : {}) });
  }
  const liveCards = accounts.filter((a) => a.kind === 'card' && !a.archived);
  const merchants = Array.from({ length: 1500 }, (_, i) => `Sample merchant ${i}`);
  const transactions = [];
  let n = 0;
  const push = (row) => { transactions.push({ id: `hp-${n}`, ...row }); n += 1; };
  const sms = (at, amountFils, extra) => ({ date: new Date(at).toISOString().slice(0, 10), ts: at, source: 'sms',
    smsKey: `s${at}-${amountFils}`, amountFils, ...extra });
  const days = Math.ceil(count / 12);
  for (let day = 0; day < days && transactions.length < count; day += 1) {
    const dayStart = NOW - day * DAY;
    const date = new Date(dayStart);
    const dom = date.getUTCDate();
    if (dom === 25) {
      push(sms(dayStart - 3_600_000, 2_500_000, { type: 'income', category: 'salary', title: 'Salary', accountId: 'bank-0' }));
    }
    for (const [index, [title, amountFils, category]] of SUBSCRIPTIONS.entries()) {
      if (dom !== 3 + index * 4) continue;
      const card = liveCards[index % liveCards.length];
      push(sms(dayStart - 7_200_000, amountFils, { type: 'expense', category, title, accountId: card.id,
        captureInstrument: { last4: card.last4, kind: card.cardType, bankIdentity: card.bankName } }));
    }
    for (const [index, [title, base, category]] of UTILITIES.entries()) {
      if (dom !== 10 + index * 5) continue;
      const amountFils = base + Math.floor(random() * 9000);
      const at = dayStart - 5_000_000;
      push(sms(at, amountFils, { type: 'expense', category: 'other', title: 'Outgoing transfer', accountId: 'bank-1',
        isTransfer: true, paymentFlowSide: 'funding' }));
      push(sms(at + 90_000, amountFils, { type: 'expense', category, title, accountId: 'bank-1',
        paymentFlowSide: 'receipt', billIdentity: `bill-${index}` }));
    }
    if (day % 3 === 1) {
      // Registered-payee receipts filed as everyday spending (toll top-ups,
      // wallet loads): the bill-bundle repair compares every one of them with
      // every ordinary purchase in the same category.
      const amountFils = 5_000 + Math.floor(random() * 20_000);
      push(sms(dayStart - 6_000_000, amountFils, { type: 'expense', category: 'other',
        title: day % 2 ? 'Salik top-up' : 'Wallet load', accountId: 'bank-3', paymentFlowSide: 'receipt',
        billIdentity: day % 2 ? 'salik' : 'wallet' }));
    }
    if (day % 9 === 4) {
      // An evidenced own-account transfer pair.
      const amountFils = 100_000 + Math.floor(random() * 400_000);
      const at = dayStart - 9_000_000;
      const evidence = { version: 1, currency: 'AED', attribution: 'source', sourceBank: 'ENBD',
        reference: `REF${day}` };
      push(sms(at, amountFils, { type: 'expense', category: 'other', title: 'Outgoing transfer', accountId: 'bank-0',
        isTransfer: true, transferEvidence: evidence, captureInstrument: { last4: '6300', kind: 'account', bankIdentity: 'ENBD' } }));
      push(sms(at + 60_000, amountFils, { type: 'income', category: 'other', title: 'Incoming transfer', accountId: 'bank-5',
        isTransfer: true, transferEvidence: evidence, captureInstrument: { last4: '6305', kind: 'account', bankIdentity: 'ENBD' } }));
    }
    if (dom === 20) {
      // A card repayment: the bank debit and the card-side receipt.
      const card = liveCards[day % liveCards.length];
      const amountFils = 300_000 + Math.floor(random() * 500_000);
      const at = dayStart - 4_000_000;
      push(sms(at, amountFils, { type: 'expense', category: 'other', title: 'Card payment', accountId: 'bank-2',
        isTransfer: true, cardPaymentSide: 'debit' }));
      push(sms(at + 120_000, amountFils, { type: 'income', category: 'other', title: 'Card payment received',
        accountId: card.id, isTransfer: true, cardPaymentSide: 'receipt' }));
    }
    const purchases = Math.max(0, 12 - (transactions.length % 3));
    for (let k = 0; k < purchases && transactions.length < count; k += 1) {
      // Zipf-like: a few merchants dominate, most appear a handful of times.
      const merchant = merchants[Math.floor(merchants.length * random() ** 2.2)];
      const card = liveCards[Math.floor(random() * liveCards.length)];
      const amountFils = 500 + Math.floor(random() * 60_000);
      const at = dayStart - (k + 1) * 3_000_000 - Math.floor(random() * 1_000_000);
      const instrumented = random() < 0.7;
      push(sms(at, amountFils, { type: 'expense', category: CATEGORIES[Math.floor(random() * CATEGORIES.length)],
        title: merchant, accountId: card.id,
        ...(instrumented ? { captureInstrument: { last4: card.last4, kind: card.cardType, bankIdentity: card.bankName } } : {}) }));
      if (random() < 0.02) {
        push({ ...sms(at + 20_000, amountFils, { type: 'expense', category: 'other', title: 'Card purchase',
          accountId: card.id }), smsKey: `s${at + 20_000}-${amountFils}-push`, viaPush: true });
      }
    }
  }
  transactions.length = Math.min(transactions.length, count);
  transactions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const cardDues = liveCards.filter((card) => card.cardType === 'credit').slice(0, 11).map((card, i) => ({
    id: `due-${i}`, accountId: card.id, totalDueFils: 250_000 + i * 1_000, minDueFils: 12_500,
    paidFils: 0, dueDate: new Date(NOW + (i - 4) * 3 * DAY).toISOString().slice(0, 10),
  }));
  const bills = [{ id: 'bill-rent', title: 'Rent', category: 'rent', amountFils: 850_000, dueDay: 1, paidMonths: [] }];
  return {
    hydrated: true, onboarded: true, language: 'en', languagePreference: 'en', marketId: 'AE', country: 'AE',
    ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 },
    transactions, accounts, cardDues, bills, budgets: [], goals: [], notSubscriptions: [],
    merchantOverrides: {}, billAliases: {}, accountHints: {}, knownBanks: [], monthStartDay: 1,
    historyImport: { status: 'complete', scanned: count, found: count, cursor: null, startedAt: NOW - DAY, updatedAt: NOW - DAY, error: null },
    reviewTray: { schemaVersion: 1, pending: [], tombstones: [], templateRules: [] },
    localCaptureQualifications: [], statementCoverage: [], trustedNotificationPackages: [],
    privateMode: false, captureOptOut: false, dailySummary: true, lastScanTs: NOW,
  };
}

module.exports = { hotPathLedger, NOW, DAY };
