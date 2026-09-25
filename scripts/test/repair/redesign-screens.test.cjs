'use strict';
// Redesigned Pro, Trusted devices, statements, first run, Ask and Feedback:
// copy parity and the truth rules each screen is held to.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const shape = (value) => {
  if (typeof value === 'function') return 'function';
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, shape(value[key])]));
  }
  return typeof value;
};
const assertParity = (en, ar) => {
  assert.deepEqual(shape(ar), shape(en));
  const walk = (value, key) => {
    if (typeof value === 'string') {
      assert.ok(value.trim().length > 0, key);
      return;
    }
    if (typeof value === 'function') return;
    for (const [k, v] of Object.entries(value)) walk(v, `${key}.${k}`);
  };
  walk(ar, 'ar');
  walk(en, 'en');
};

test('Pro copy is paired and sells only what Pro gates', () => {
  const { PRO_COPY } = load(path.join(root, 'src/lib/pro-copy.ts'));
  assertParity(PRO_COPY.en, PRO_COPY.ar);
  const pro = read('src/app/pro.tsx');
  // No saving badge: the store returns display strings, not numeric prices.
  assert.doesNotMatch(pro, /proSavePercent|SAVE|save\s*\{/i);
  // Insights and subscriptions are free, so they are not a Pro benefit.
  assert.doesNotMatch(pro, /featInsights/);
  // Android-only rows are the notification reader and past-SMS import, both
  // of which isProActive/requiresPro actually gate.
  assert.match(pro, /autoCaptureMethod\(\) === 'inboxScan'[\s\S]{0,200}copy\.notificationsTitle[\s\S]{0,200}copy\.historyTitle/);
  assert.match(read('src/lib/purchases.ts'), /export function requiresPro\(method: CaptureMethod\): boolean \{\s*return method !== 'manual';/);
  assert.match(pro, /accessibilityRole="radio"/);
  assert.match(pro, /t\('proOutcomeTitle'\)/);
});

test('statement date note follows the selected country, and the privacy line stays truthful', () => {
  const names = load(path.join(root, 'src/lib/country-names.ts'));
  const country = load(path.join(root, 'src/lib/country.ts'), { '@/lib/country-names': names });
  const copy = load(path.join(root, 'src/lib/supplement-copy.ts'), { '@/lib/country': country });
  const { en, ar } = copy.SUPPLEMENT_COPY;
  assert.deepEqual(Object.keys(ar).sort(), Object.keys(en).sort());
  const us = copy.statementDateNote('US', 'en');
  assert.match(us, /04\/09 is April 9\./);
  const ae = copy.statementDateNote('AE', 'en');
  assert.match(ae, /04\/09 is 4 September\./);
  assert.match(copy.statementDateNote('JP', 'en'), /year first/);
  assert.match(copy.statementDateNote('CA', 'en'), /won’t guess/);
  assert.equal(copy.statementDateNote(null, 'en'), en.dateNoteUnknown);
  assert.equal(copy.statementDateNote('ZZ', 'en'), en.dateNoteUnknown);
  assert.match(copy.statementDateNote('AE', 'ar'), /04\/09/);
  // Statements are read by Wafra's import service, never "on this phone".
  for (const lang of [en, ar]) {
    assert.doesNotMatch(Object.values(lang).join('\n'), /read on this phone|files are read on this phone/i);
  }
  assert.match(en.uploadDisclosure, /Wafra’s import service/);
  const screen = read('src/components/supplement-imports.tsx');
  assert.match(screen, /testID="statement-date-note"[\s\S]{0,300}statementDateNote\(state\.country, language\)/);
  assert.match(screen, /testID="statement-file-status"/);
  // No pre-import confirmation step and no per-file duplicate counts.
  assert.doesNotMatch(screen, /already captured|not duplicated/);
});

test('first-run copy is paired and the SMS explainer is truthful', () => {
  const kind = load(path.join(root, 'src/lib/biometric-kind.ts'));
  const settings = load(path.join(root, 'src/lib/settings-copy.ts'), { '@/lib/biometric-kind': kind });
  const { ONBOARDING_COPY } = load(path.join(root, 'src/lib/onboarding-copy.ts'), { '@/lib/settings-copy': settings });
  assertParity(ONBOARDING_COPY.en, ONBOARDING_COPY.ar);
  const en = ONBOARDING_COPY.en;
  assert.match(en.smsExplainerSystemName, /send and view/);
  assert.match(en.smsExplainerNever, /never sends/);
  assert.equal(en.foundRecurring(4, 2), 'Repeating payments found: 4 subscriptions and 2 bills. They are in Bills.');
  assert.equal(en.foundRecurring(1, 0), 'Repeating payments found: 1 subscription. They are in Bills.');
  assert.equal(en.foundRecurring(0, 1), 'Repeating payments found: 1 bill. They are in Bills.');
  assert.equal(ONBOARDING_COPY.ar.readyMonths(2), 'شهران');
  assert.equal(ONBOARDING_COPY.ar.readyMonths(3), '3 أشهر');
  // The gate asks before Android's prompt and never restores without a confirmation.
  const gate = read('src/components/onboarding-gate.tsx');
  assert.match(gate, /else setSmsExplainerVisible\(true\)/);
  assert.match(gate, /onContinue=\{\(\) => \{\s*setSmsExplainerVisible\(false\);\s*void runSetupAction\(startScan\);/);
  assert.match(gate, /visible=\{pendingRestore !== null\}[\s\S]{0,900}setRestoreFailed\(!restoreBackup\(content\)\)/);
  // Country and ledger currency stay separate: no "Continue with <currency>".
  assert.doesNotMatch(gate, /Continue with/);
});

test('ready summary counts real spending only and splits by allocation', () => {
  const splits = load(path.join(root, 'src/lib/splits.ts'));
  const { onboardingReadySummary } = load(path.join(root, 'src/lib/onboarding-ready.ts'), { '@/lib/splits': splits });
  const tx = (overrides) => ({ id: Math.random().toString(36), type: 'expense', amountFils: 1000, category: 'dining',
    accountId: 'a', title: 'Cafe', date: '2026-07-03', ...overrides });
  const rows = [
    tx({}),
    tx({ title: 'Grocer', category: 'groceries', amountFils: 5000, date: '2026-08-10' }),
    tx({ title: 'Split shop', amountFils: 3000, category: 'groceries', date: '2026-09-01',
      splits: [{ category: 'groceries', amountFils: 2000 }, { category: 'dining', amountFils: 1000 }] }),
    tx({ title: 'Own transfer', amountFils: 90000, category: 'transfers', internal: true }),
    tx({ title: 'Salary', type: 'income', amountFils: 500000, category: 'income' }),
  ];
  const summary = onboardingReadySummary({
    transactions: rows,
    isSpending: (t) => t.type === 'expense' && !t.internal,
    subscriptions: [
      { group: 'subscription', status: 'active' }, { group: 'subscription', status: 'stopped' },
      { group: 'utility', status: 'active' }, { group: 'housing', status: 'active' },
    ],
    limit: 1,
  });
  assert.equal(summary.months, 3);
  assert.equal(summary.transactions, 5);
  assert.equal(summary.merchants, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(summary.categories)), [{ category: 'groceries', amountMinor: 7000 }]);
  assert.equal(summary.otherMinor, 2000, 'the transfer never counts as spending');
  assert.equal(summary.subscriptions, 1);
  assert.equal(summary.bills, 2);
  assert.equal(summary.firstMonth, '2026-07');
  assert.equal(summary.lastMonth, '2026-09');
});

test('iPhone checklist marks a step done only from recorded evidence', () => {
  const { iosCaptureChecklist } = load(path.join(root, 'src/lib/ios-capture-checklist.ts'));
  const done = (evidence) => JSON.parse(JSON.stringify(iosCaptureChecklist(evidence).map((row) => row.done)));
  assert.deepEqual(done(null), [false, false, false, false]);
  const base = { shortcutConfirmed: false, automationConfirmed: false, setupProofVersion: null, requiredProofVersion: 3, firstCapturedAt: null };
  assert.deepEqual(done(base), [false, false, false, false]);
  assert.deepEqual(done({ ...base, shortcutConfirmed: true }), [true, false, false, false]);
  assert.deepEqual(done({ ...base, setupProofVersion: 1 }), [false, false, false, false], 'an older proof is not this shortcut');
  assert.deepEqual(done({ ...base, setupProofVersion: 3 }), [true, true, false, false]);
  assert.deepEqual(done({ ...base, setupProofVersion: 3, automationConfirmed: true }), [true, true, true, false]);
  assert.deepEqual(done({ ...base, firstCapturedAt: Date.UTC(2026, 8, 25) }), [true, true, true, true]);
});

test('Trusted devices shows the invite countdown as its hero and says what is relayed', () => {
  const screen = read('src/app/trusted-devices.tsx');
  const i18n = read('src/lib/i18n.ts');
  assert.match(screen, /testID="trusted-invite-countdown"[\s\S]{0,900}type="display"[\s\S]{0,200}secondsLeft \/ 60/);
  assert.match(screen, /t\('trustedRelayOnly', language\)/);
  assert.match(i18n, /trustedRelayOnly: \{\s*en: 'The phone that joins receives only new items relayed after it joins\. Older transactions are not copied\.'/);
  // The board's "Share one ledger" promise is not made anywhere.
  assert.doesNotMatch(i18n, /Share one ledger/);
});
