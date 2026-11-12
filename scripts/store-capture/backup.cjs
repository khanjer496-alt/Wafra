'use strict';

// Ordinary portable backups, never a privileged app fixture or entitlement.
const fs = require('node:fs');
const path = require('node:path');

function backup(language, day) {
  if (!['en', 'ar'].includes(language) || !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) !== day) throw new Error('Invalid fixture date/language');
  const now = new Date(`${day}T12:00:00Z`);
  const ar = language === 'ar';
  const transactions = [];
  let serial = 0;
  function add(type, amountFils, category, title, date, accountId = 'capture-bank') {
    transactions.push({ id: `capture-${++serial}`, type, amountFils, category, title, date,
      accountId, source: 'manual', ts: Date.parse(`${date}T09:00:00Z`) });
  }
  const recurringDay = Math.min(14, now.getUTCDate());
  for (let back = 5; back >= 0; back--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1, 12));
    const month = d.toISOString().slice(0, 7);
    const date = n => `${month}-${String(n).padStart(2, '0')}`;
    add('income', 1450000, 'salary', ar ? 'الراتب الشهري' : 'Monthly salary', date(1));
    add('expense', 4900, 'entertainment', 'Netflix', date(recurringDay), 'capture-card');
    add('expense', 2199, 'entertainment', 'Spotify', date(recurringDay), 'capture-card');
    for (let n = 1; n <= (back ? 27 : now.getUTCDate()); n += 3) {
      add('expense', 12340 + n * 173, 'groceries', ar ? 'سوق النخيل' : 'Palm Market', date(n));
      add('expense', 2800 + n * 11, 'dining', ar ? 'مقهى الصباح' : 'Morning Cafe', date(n));
      add('expense', 6200, 'transport', ar ? 'وقود الرياض' : 'Dubai Fuel', date(n), 'capture-card');
    }
  }
  return { app: 'wafra', version: 1, exportedAt: `${day}T12:00:00.000Z`, data: {
    ledgerMoney: { schemaVersion: 2, currency: ar ? 'SAR' : 'AED', exponent: 2 },
    onboarded: true, userName: ar ? 'لين' : 'Leen', language, languagePreference: language,
    country: ar ? 'SA' : 'AE', marketId: ar ? 'SA' : 'AE', themePreference: 'dark', monthStartDay: 1,
    appLock: false, privateMode: false, onlineLogosEnabled: false, dailySummary: false,
    accounts: [
      { id: 'capture-bank', name: ar ? 'الحساب اليومي' : 'Everyday account', kind: 'bank', openingFils: 2200000, color: '#5C7966', last4: '0001' },
      { id: 'capture-card', name: ar ? 'بطاقة المشتريات' : 'Everyday card', kind: 'card', cardType: 'credit', openingFils: 0, creditLimitFils: 2500000, color: '#88623C', last4: '0002' },
    ], transactions,
    budgets: [{ category: 'groceries', limitFils: 220000 }, { category: 'dining', limitFils: 85000 }],
    bills: [{ id: 'capture-rent', title: ar ? 'إيجار المنزل' : 'Home rent', category: 'rent', amountFils: 450000, dueDay: Math.min(28, now.getUTCDate() + 3), paidMonths: [], accountId: 'capture-bank' }],
    cardDues: [{ id: 'capture-card-due', accountId: 'capture-card', totalDueFils: 184500, minDueFils: 9250, paidFils: 0,
      dueDate: new Date(now.getTime() + 5 * 86400000).toISOString().slice(0, 10) }],
    goals: [], customCategories: [], wafraGoals: ['salary', 'bills', 'subscriptions', 'spend-less'],
  } };
}

if (require.main === module) {
  const [out, day] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  for (const language of ['en', 'ar']) fs.writeFileSync(path.join(out, `wafra-capture-${language}.json`), JSON.stringify(backup(language, day)));
}
module.exports = { backup };
