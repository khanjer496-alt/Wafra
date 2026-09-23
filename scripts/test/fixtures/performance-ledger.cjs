'use strict';

// Synthetic, reproducible mixed ledger. Contains no real bank messages or people.
const now = new Date('2026-09-23T12:00:00Z');
const categories = ['groceries', 'dining', 'transport', 'shopping', 'utilities', 'entertainment'];
function performanceLedger(count = 15000) {
  const accounts = Array.from({ length: 44 }, (_, i) => ({
    id: `perf-account-${i}`, name: `Sample account ${i}`, kind: i < 8 ? 'card' : 'bank',
    ...(i < 8 ? { cardType: 'credit', last4: String(1000 + i), creditLimitFils: 2000000 } : {}),
    openingFils: 0, color: '#1F6B52', archived: i >= 42,
  }));
  const transactions = Array.from({ length: count }, (_, i) => {
    const ts = now.getTime() - Math.floor(i / 40) * 86400000 - (i % 40) * 60000;
    const income = i % 97 === 0;
    const amountFils = income ? 1000000 : 1000 + i % 50000;
    const category = income ? 'salary' : categories[i % categories.length];
    return { id: `perf-row-${i}`, type: income ? 'income' : 'expense', amountFils,
      title: income ? 'Sample salary' : `Sample merchant ${i % 320}`, category,
      accountId: accounts[i % accounts.length].id, date: new Date(ts).toISOString().slice(0, 10), ts, source: 'manual',
      ...(!income && i % 13 === 0 ? { splits: [
        { category: 'groceries', amountFils: Math.floor(amountFils / 2) },
        { category: 'dining', amountFils: amountFils - Math.floor(amountFils / 2) },
      ] } : {}),
    };
  });
  return { hydrated: true, onboarded: true, language: 'en', languagePreference: 'en',
    transactions, accounts, budgets: [], bills: [], cardDues: [], goals: [],
    notSubscriptions: [], merchantOverrides: {}, billAliases: {}, captureOptOut: true,
    privateMode: true, monthStartDay: 1, marketId: 'AE',
    ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 },
    reviewTray: { pending: [], tombstones: [], templateRules: [] },
  };
}
module.exports = { performanceLedger, now };
