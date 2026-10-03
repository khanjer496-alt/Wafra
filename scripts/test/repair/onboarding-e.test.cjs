'use strict';
// Design language E first run: the pure decisions (goals → Home order, watch →
// budgets, capture choice → alert answer, trial timeline, first payment), the
// copy's parity and truth rules, and the gate wiring that uses them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const types = load(path.join(root, 'src/lib/types.ts'));
const splits = load(path.join(root, 'src/lib/splits.ts'));
const prefs = load(path.join(root, 'src/lib/home-widget-preferences.ts'));
const source = load(path.join(root, 'src/lib/transaction-source.ts'));
// Results cross a vm realm; every function's result is compared as plain JSON.
const e = Object.fromEntries(Object.entries(load(path.join(root, 'src/lib/onboarding-e.ts'), {
  '@/lib/types': types, '@/lib/splits': splits, '@/lib/home-widget-preferences': prefs,
  '@/lib/transaction-source': source,
})).map(([name, value]) => [name, typeof value === 'function'
  ? (...args) => { const out = value(...args); return out === undefined ? out : JSON.parse(JSON.stringify(out)); }
  : JSON.parse(JSON.stringify(value))]));
const onboarding = load(path.join(root, 'src/lib/onboarding.ts'), {
  '@/lib/i18n': { t: (key) => key }, '@/lib/ledger': { isIncome: () => false },
});
const settingsCopy = load(path.join(root, 'src/lib/settings-copy.ts'));
const { ONBOARDING_E_COPY, onboardingECopy } = load(path.join(root, 'src/lib/onboarding-e-copy.ts'), {
  '@/lib/settings-copy': settingsCopy,
});
const ARABIC = /[؀-ۿ]/;
/** Source without its comments, for assertions about code. */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const DEFAULT = ['due', 'assistant', 'insight', 'activity', 'upcoming'];
const TOP = ['greeting', 'overview', 'today', 'week'];
// What the band draws: the month line (overview) right under Today (splitHomeWidgetLayout).
const BAND = ['greeting', 'today', 'overview', 'week'];
const EXPANDED_DEFAULT = [...TOP, ...DEFAULT, 'capture'];

/* ── copy ─────────────────────────────────────────────────────────────── */

const shape = (value) => typeof value === 'function' ? `function/${value.length}`
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, shape(value[key])]))
    : typeof value;
const sample = (fn) => fn.length === 2 ? fn(3, 'Ali') : fn(3);

test('E copy: English and Arabic carry the same keys, kinds and arity', () => {
  assert.deepEqual(shape(ONBOARDING_E_COPY.ar), shape(ONBOARDING_E_COPY.en));
  assert.equal(onboardingECopy('ar'), ONBOARDING_E_COPY.ar);
  assert.equal(onboardingECopy('fr'), ONBOARDING_E_COPY.en);
});

test('E copy: every Arabic line is Arabic and every English line is not', () => {
  const walk = (en, ar, key) => {
    if (typeof en === 'object') {
      for (const k of Object.keys(en)) walk(en[k], ar[k], `${key}.${k}`);
      return;
    }
    const english = typeof en === 'function' ? sample(en) : en;
    const arabic = typeof ar === 'function' ? sample(ar) : ar;
    assert.ok(String(english).trim() && !ARABIC.test(String(english)), `${key} en`);
    // A pure join of its arguments ("Dining · AED 600") has no words of its own.
    if (key === 'copy.watchLimitSummary') return;
    assert.ok(ARABIC.test(String(arabic)), `${key} ar: ${arabic}`);
  };
  walk(ONBOARDING_E_COPY.en, ONBOARDING_E_COPY.ar, 'copy');
});

test('E copy: Arabic counts agree with their nouns', () => {
  const { ar, en } = ONBOARDING_E_COPY;
  assert.equal(en.startFree(3), 'Start the free 3 days');
  assert.equal(en.startFree(1), 'Start the free day');
  assert.equal(en.trialEnd(3), 'Within 3 days', 'trialDaysLeft rounds up, so never an exact count');
  assert.equal(ar.startFree(3), 'ابدأ 3 أيام مجانية');
  assert.equal(ar.startFree(2), 'ابدأ اليومين المجانيين');
  assert.equal(ar.trialEnd(2), 'خلال يومين');
  assert.equal(ar.trialEnd(3), 'خلال 3 أيام');
  assert.equal(ar.trialEnd(11), 'خلال 11 يوماً');
});

test('E copy: the greeting is Home\'s own, with or without a name', () => {
  const { en, ar } = ONBOARDING_E_COPY;
  assert.equal(en.greeting(9, 'Sara'), 'Good morning, Sara');
  assert.equal(en.greeting(14, null), 'Good afternoon');
  assert.equal(en.greeting(20, 'Sara'), 'Good evening, Sara');
  assert.equal(ar.greeting(9, 'سارة'), 'صباح الخير، سارة');
  assert.equal(ar.greeting(20, null), 'مساء الخير');
  const home = read('src/screens/journal-home-screen.tsx');
  assert.match(home, /now\.getHours\(\) < 12 \? 'Good morning' : now\.getHours\(\) < 18 \? 'Good afternoon' : 'Good evening'/);
});

test('trial copy promises no reminder and states what happens when it ends', () => {
  for (const lang of ['en', 'ar']) {
    const copy = ONBOARDING_E_COPY[lang];
    // The paywall body may name the person's own reminders; the trial lines may not promise one.
    const trial = [copy.trialToday, copy.trialTodayBody, copy.trialTodayBodyOff, copy.trialEnd(3), copy.trialEndBody, copy.startFree(3),
      copy.startFree(1), copy.continueFree, copy.trialTimelineLabel, copy.paywallTitle].join(' ');
    assert.doesNotMatch(trial, /remind|تذكير|نذكّر|سنذكر/i, `${lang}: no trial-ending reminder is claimed`);
  }
  assert.match(ONBOARDING_E_COPY.en.trialEndBody, /pauses/);
  assert.match(ONBOARDING_E_COPY.en.trialEndBody, /Nothing is charged/);
  assert.match(ONBOARDING_E_COPY.en.trialEndBody, /ledger stays/);
  assert.match(ONBOARDING_E_COPY.en.trialTodayBody, /No card/);
  // There is really no trial reminder: the only scheduled notifications are
  // the payment reminders, the daily summary and the relay's charge banner.
  const scheduled = ['src/lib/notifications.ts', 'src/lib/background-relay.ts']
    .map((file) => read(file)).join('\n');
  assert.doesNotMatch(scheduled, /trial/i);
  // And the local trial is still TRIAL_DAYS from first launch with no store trial.
  assert.match(read('src/lib/purchases.ts'), /export const TRIAL_DAYS = 3;/);
});

test('reminders name only what Wafra sends; the daily summary time matches SUMMARY_HOUR', () => {
  assert.match(read('src/lib/notifications.ts'), /export const SUMMARY_HOUR = 21;/);
  assert.match(ONBOARDING_E_COPY.en.remindDailyWhen, /9 pm/);
  assert.match(ONBOARDING_E_COPY.ar.remindDailyWhen, /9 مساءً/);
  const reminders = read('src/lib/reminders.ts');
  assert.match(reminders, /\[-1, t\('tomorrow'\)\], \[0, todayWord\]/, 'bills: the day before and on the day');
  assert.match(reminders, /\[-3, tf\('inDaysPhrase', \{ days: 3 \}\)\],\s*\[0, todayWord\]/, 'cards: three days before and on the day');
  const step = code(read('src/components/onboarding/e-reminders.tsx'));
  // No monthly recap is offered: the app has no such notification.
  assert.doesNotMatch(step, /recap/i);
  assert.doesNotMatch(JSON.stringify(ONBOARDING_E_COPY), /recap|ملخص شهري/i);
  // Bills and cards are not switchable in the app, so they carry no switch.
  assert.equal((step.match(/<Switch\b/g) ?? []).length, 1, 'only the daily summary has a switch');
});

/* ── goals → Home order ───────────────────────────────────────────────── */

test('goals reorder Home through the Customize Home preference', () => {
  const base = { order: [...DEFAULT], hidden: [] };
  assert.deepEqual(e.homeOrderForGoals(['bills'], base).order, [...TOP, 'due', 'upcoming', 'assistant', 'insight', 'activity', 'capture']);
  assert.deepEqual(e.homeOrderForGoals(['subscriptions'], base).order, [...TOP, 'upcoming', 'due', 'assistant', 'insight', 'activity', 'capture']);
  assert.deepEqual(e.homeOrderForGoals(['spend-less'], base).order, [...TOP, 'insight', 'due', 'assistant', 'upcoming', 'activity', 'capture']);
  assert.deepEqual(e.homeOrderForGoals(['salary'], base).order, [...TOP, 'due', 'upcoming', 'activity', 'insight', 'assistant', 'capture']);
  assert.deepEqual(e.homeOrderForGoals(['cash-cards'], base).order, [...TOP, 'due', 'upcoming', 'activity', 'assistant', 'insight', 'capture']);
  assert.deepEqual(e.homeOrderForGoals(['salary', 'bills'], base).order,
    [...TOP, 'due', 'upcoming', 'activity', 'insight', 'assistant', 'capture'], 'precedence, not tap order: bills before salary');
  assert.deepEqual(e.homeOrderForGoals(['bills', 'salary'], base), e.homeOrderForGoals(['salary', 'bills'], base));
});

test('goals reorder the sheet and never take the band away', () => {
  for (const goals of [['bills'], ['subscriptions'], ['spend-less'], ['salary'], ['cash-cards'], ['bills', 'salary', 'spend-less']]) {
    const next = e.homeOrderForGoals(goals, { order: [...DEFAULT], hidden: [] });
    assert.deepEqual(JSON.parse(JSON.stringify(prefs.splitHomeWidgetLayout(next).band)), BAND, goals.join());
  }
  // A Home whose owner already moved a band section down keeps that choice.
  const moved = { order: ['greeting', 'due', 'overview', 'today', 'week', 'upcoming', 'activity', 'assistant', 'insight', 'capture'], hidden: [] };
  assert.deepEqual(e.homeOrderForGoals(['subscriptions'], moved).order,
    ['greeting', 'upcoming', 'due', 'overview', 'today', 'week', 'activity', 'assistant', 'insight', 'capture']);
  // A hidden section ahead of the band is invisible to the split, so it does not end the band either.
  const hiddenFirst = { order: ['due', ...TOP, 'upcoming', 'activity', 'assistant', 'insight', 'capture'], hidden: ['due'] };
  const next = e.homeOrderForGoals(['subscriptions'], hiddenFirst);
  assert.deepEqual(JSON.parse(JSON.stringify(prefs.splitHomeWidgetLayout(next).band)), BAND);
  assert.deepEqual(next.order, ['due', ...TOP, 'upcoming', 'activity', 'assistant', 'insight', 'capture']);
});

test('goals never hide a section and no goals leaves the order alone', () => {
  const custom = { order: ['activity', 'assistant', 'upcoming', 'insight', 'due'], hidden: ['assistant'] };
  assert.deepEqual(e.homeOrderForGoals([], custom), { order: [...TOP, ...custom.order, 'capture'], hidden: custom.hidden });
  assert.deepEqual(e.homeOrderForGoals(['nonsense'], custom), { order: [...TOP, ...custom.order, 'capture'], hidden: custom.hidden });
  const expanded = { order: [...EXPANDED_DEFAULT].reverse(), hidden: ['greeting', 'today'] };
  assert.deepEqual(e.homeOrderForGoals([], expanded), expanded, 'existing whole-Home choices remain unchanged');
  const next = e.homeOrderForGoals(['bills'], custom);
  assert.deepEqual(next.hidden, ['assistant']);
  assert.deepEqual(next.order, [...TOP, 'due', 'upcoming', 'activity', 'assistant', 'insight', 'capture']);
  assert.deepEqual([...next.order].sort(), [...EXPANDED_DEFAULT].sort(), 'all ten sections, each once');
  // A preference the reader would normalise is normalised first.
  assert.deepEqual(e.homeOrderForGoals(['bills'], { order: ['bogus'], hidden: 'x' }).order.slice(TOP.length, TOP.length + 2), ['due', 'upcoming']);
});

test('the Goals hint names the section that really goes first', () => {
  assert.equal(e.firstHomeSectionForGoals([]), null);
  assert.equal(e.firstHomeSectionForGoals(['salary', 'bills']), 'due');
  assert.equal(e.firstHomeSectionForGoals(['subscriptions']), 'upcoming');
  for (const goals of [['bills'], ['subscriptions'], ['spend-less'], ['salary'], ['cash-cards'], ['salary', 'spend-less']]) {
    const first = e.firstHomeSectionForGoals(goals);
    // Due and upcoming payments may still draw ahead of it (paymentsBeforeActivity); the activity hint says so.
    const sheet = e.homeOrderForGoals(goals, { order: [...DEFAULT], hidden: [] }).order.slice(TOP.length);
    const promoted = goals.flatMap((goal) => e.GOAL_HOME_SECTIONS[goal]);
    assert.equal(sheet.find((id) => promoted.includes(id) || !['due', 'upcoming'].includes(id)), first, goals.join());
    assert.ok(ONBOARDING_E_COPY.en.goalsHint[first] && ONBOARDING_E_COPY.ar.goalsHint[first]);
  }
  assert.deepEqual(e.toggleGoal(['salary'], 'bills'), ['salary', 'bills'], 'canonical order');
  assert.deepEqual(e.toggleGoal(['salary', 'bills'], 'salary'), ['bills']);
  assert.deepEqual([...types.sanitizeGoalIds(e.toggleGoal([], 'spend-less'))], ['spend-less']);
});

test('the gate saves goals with setGoals and the order through saveHomeWidgetPreferences', () => {
  const gate = read('src/components/onboarding-gate.tsx');
  assert.match(gate, /const saveGoals = \(\) => \{[\s\S]{0,300}if \(!previewMode\) \{[\s\S]{0,80}setGoals\(goalsDraft\)[\s\S]{0,200}saveHomeWidgetPreferences\(homeOrderForGoals\(chosen, current\)\)/);
});

/* ── watch → budgets ──────────────────────────────────────────────────── */

test('watched categories with a limit become budgets; unpicked limits are removed', () => {
  const existing = [{ category: 'dining', limitFils: 60000 }, { category: 'rent', limitFils: 500000 },
    { category: 'health', limitFils: 20000 }];
  const draft = [{ category: 'dining', limitFils: 0, limitMinor: 90000 }, { category: 'groceries', limitMinor: 120000 },
    { category: 'transport', limitMinor: 0 }];
  const { upsert, remove } = e.watchBudgetChanges(draft, existing);
  assert.deepEqual(upsert, [{ category: 'dining', limitFils: 90000 }, { category: 'groceries', limitFils: 120000 }]);
  assert.deepEqual(remove, ['health'], 'health was unpicked; rent is not a Watch category and is untouched');
  assert.deepEqual(e.watchBudgetChanges([{ category: 'dining', limitMinor: 60000 }], existing),
    { upsert: [], remove: ['health'] }, 'an unchanged limit is not rewritten');
  assert.deepEqual(e.watchBudgetChanges([{ category: 'dining', limitMinor: 1.5 }], []), { upsert: [], remove: [] },
    'only whole minor units are money');
});

test('watch drafts round-trip the ledger and keep the Watch order', () => {
  const budgets = [{ category: 'shopping', limitFils: 10000 }, { category: 'dining', limitFils: 5000 }, { category: 'rent', limitFils: 1 }];
  assert.deepEqual(e.watchDraftFromBudgets(budgets), [{ category: 'dining', limitMinor: 5000 }, { category: 'shopping', limitMinor: 10000 }]);
  let draft = e.toggleWatch([], 'health');
  draft = e.toggleWatch(draft, 'dining');
  assert.deepEqual(draft.map((item) => item.category), ['dining', 'health']);
  assert.deepEqual(draft.map((item) => item.limitMinor), [0, 0], 'a picked category starts with no limit');
  draft = e.setWatchLimit(draft, 'dining', 25000);
  assert.deepEqual(e.toggleWatch(draft, 'health'), [{ category: 'dining', limitMinor: 25000 }]);
  assert.equal(e.setWatchLimit(draft, 'dining', -5)[0].limitMinor, 0);
});

test('the gate pins the ledger currency before it writes a budget', () => {
  const gate = read('src/components/onboarding-gate.tsx');
  const save = gate.slice(gate.indexOf('const saveWatch'), gate.indexOf('const finishNotificationChoice'));
  assert.ok(save.includes('watchBudgetChanges(watchDraft, state.budgets)'));
  assert.ok(save.indexOf('setLedgerMoney(shownCurrency)') < save.indexOf('upsertBudget(budget)'));
  assert.match(save, /if \(save && !previewMode\)/, 'Not now and the preview write nothing');
  // The dial is the foundation's, with currency-scaled steps for the shown currency.
  const step = read('src/components/onboarding/e-watch.tsx');
  assert.match(step, /<DialLimit[\s\S]{0,300}stepMinor=\{step\}/);
  assert.match(step, /typicalMinorAmount\(moneySpec, 25\)/);
  // It starts at nothing: no invented starting limit.
  assert.doesNotMatch(read('src/lib/onboarding-e.ts'), /limitMinor: [1-9]/);
});

/* ── capture choice → the alert answer ───────────────────────────────── */

test('the first-payment choice sets the alert answer so the history gap and Settings stay true', () => {
  const answer = e.alertsAnswerForCaptureChoice;
  assert.equal(answer('sms'), 'sms');
  assert.equal(answer('notifications'), 'notifications');
  assert.equal(answer('statements'), 'unsure');
  assert.equal(answer('manual'), 'neither');
  // What the offer and Settings then say.
  assert.equal(onboarding.onboardingHistoryGap(answer('sms')), false, 'an SMS inbox is its own archive');
  assert.equal(onboarding.onboardingHistoryGap(answer('notifications')), true);
  assert.equal(onboarding.onboardingHistoryGap(answer('statements')), true);
  assert.equal(onboarding.onboardingNoAutomaticCapture(answer('manual')), true, 'by hand promises no automatic capture');
  assert.equal(onboarding.onboardingNoAutomaticCapture(answer('statements')), false);
  // Every answer is one Settings can show and change.
  for (const choice of ['sms', 'notifications', 'statements', 'manual']) {
    assert.ok(onboarding.ALERT_DELIVERY_PRESETS.some((preset) => preset.id === answer(choice)), choice);
  }
});

test('after iPhone setup, the answer follows the source it recorded, or the opt-out', () => {
  assert.equal(e.alertsAnswerForIosSetup(true, 'message'), 'neither');
  assert.equal(e.alertsAnswerForIosSetup(false, 'message'), 'sms');
  assert.equal(e.alertsAnswerForIosSetup(false, 'notification'), 'notifications');
  assert.equal(e.alertsAnswerForIosSetup(false, 'apple-pay'), 'unsure', 'Apple Pay says nothing about the bank');
  assert.equal(e.alertsAnswerForIosSetup(false, undefined), 'unsure');
});

test('the Settings preview never opens an import, and the paywall claims capture only when it is on', () => {
  const gate = read('src/components/onboarding-gate.tsx');
  assert.match(gate, /if \(Platform\.OS === 'web' \|\| previewMode \|\| !beginStepTransition\(\)\) return;/);
  assert.match(gate, /const showHistoryGapOffer = activeStep === 'complete' &&\s*Platform\.OS === 'android' &&\s*!previewMode &&/);
  assert.match(gate, /const captureOn = !state\.captureOptOut && Platform\.OS !== 'web' && automaticCompletion;/);
  assert.match(read('src/components/onboarding/e-paywall.tsx'), /captureOn \? words\.trialTodayBody : words\.trialTodayBodyOff/);
  // After Watch, the pattern and the paywall read only saved limits.
  assert.match(gate, /const budgets = activeStep === 'watch' \? \[[\s\S]{0,300}\] : state\.budgets;/);
});

test('each capture path records its answer before the stage it saves', () => {
  const gate = read('src/components/onboarding-gate.tsx');
  const body = (name, end) => gate.slice(gate.indexOf(`const ${name} = `), gate.indexOf(end, gate.indexOf(`const ${name} = `)));
  assert.match(body('startScan', 'const enableAndroidNotificationAdmission'), /recordCaptureChoice\('sms'\);\s*saveJourney\('capture'\);\s*await ensureDurable\(\)/);
  assert.match(body('connectAndroidNotifications', 'const finishAndroidCapture'), /if \(!androidSmsReady\) \{\s*recordCaptureChoice\('notifications'\);\s*saveJourney\('capture'\);/);
  assert.match(body('finishAndroidCapture', 'const beginCapture'), /recordCaptureChoice\(androidSmsReady \? 'sms' : 'notifications'\);\s*saveJourney\('complete'\)/);
  // iPhone: Shortcuts setup chooses the source, so launching it guesses nothing;
  // the answer is recorded from what setup saved when it returns.
  assert.doesNotMatch(body('beginCapture', 'const openStatementImport'), /recordCaptureChoice/);
  assert.match(gate, /alertsAnswerForIosSetup\(optedOut, progress\?\.futureCaptureSource\)/);
  assert.match(body('openStatementImport', '// The iPhone checklist'), /recordCaptureChoice\('statements'\)/);
  assert.match(body('continueManually', 'const goBack'), /await setCaptureOptOut\(true\)[\s\S]*recordCaptureChoice\('manual'\);\s*setCompletionOutcome\('manual'\);\s*saveJourney\('complete'\)/);
  // The saved profile carries the latest answer, not a stale render's.
  assert.match(gate, /alerts: alertsRef\.current \?\? alerts \?\? current\?\.alerts \?\? null/);
});

/* ── first payment ───────────────────────────────────────────────────── */

test('the arrived payment is the newest live capture, never a statement row or a hand entry', () => {
  const spend = (tx) => tx.type === 'expense';
  const rows = [
    { id: 'a', type: 'expense', source: 'sms', date: '2026-09-01', ts: 10, category: 'dining', amountFils: 2400 },
    { id: 'b', type: 'expense', source: 'sms', captureSource: 'pdf', date: '2026-09-20', ts: 30, category: 'groceries', amountFils: 9000 },
    { id: 'c', type: 'expense', source: 'manual', date: '2026-09-21', ts: 40, category: 'dining', amountFils: 100 },
    { id: 'd', type: 'expense', source: 'sms', viaPush: true, date: '2026-09-05', ts: 20, category: 'dining', amountFils: 1500 },
    { id: 'e', type: 'income', source: 'sms', date: '2026-09-25', ts: 50, category: 'salary', amountFils: 900000 },
  ];
  assert.equal(e.arrivedPayment(rows, spend).id, 'd');
  assert.equal(e.arrivedPayment(rows.filter((tx) => tx.id === 'b' || tx.id === 'c'), spend), null);
});

test('the watched bar is this month\'s real spending against that limit', () => {
  const spend = (tx) => tx.type === 'expense';
  const inSeptember = (date) => date.startsWith('2026-09');
  const rows = [
    { id: 'a', type: 'expense', source: 'sms', date: '2026-09-02', category: 'dining', amountFils: 2400 },
    { id: 'b', type: 'expense', source: 'sms', date: '2026-08-30', category: 'dining', amountFils: 9999 },
    { id: 'c', type: 'expense', source: 'manual', date: '2026-09-03', category: 'groceries', amountFils: 3000,
      splits: [{ category: 'groceries', amountFils: 2000 }, { category: 'dining', amountFils: 1000 }] },
  ];
  const budgets = [{ category: 'groceries', limitFils: 50000 }, { category: 'dining', limitFils: 120000 }];
  assert.deepEqual(e.watchedProgress(rows[0], budgets, rows, spend, inSeptember),
    { category: 'dining', spentMinor: 3400, limitMinor: 120000 }, 'its own category, split parts included');
  assert.deepEqual(e.watchedProgress({ ...rows[0], category: 'transport' }, budgets, rows, spend, inSeptember),
    { category: 'dining', spentMinor: 3400, limitMinor: 120000 }, 'else the first watched category in Watch order');
  assert.equal(e.watchedProgress(rows[0], [], rows, spend, inSeptember), null, 'no limit, no bar');
});

/* ── steps, stages and the trial ─────────────────────────────────────── */

test('five numbered steps, and every stage resumes where it was saved', () => {
  const steps = ['welcome', 'name', 'goals', 'watch', 'reminders', 'capture', 'live', 'complete', 'pattern', 'paywall'];
  assert.deepEqual(steps.map(e.onboardingEStepNumber), [null, 1, 2, 3, 4, 5, 5, 5, null, null]);
  assert.equal(e.ONBOARDING_E_TOTAL_STEPS, 5);
  for (const step of ['welcome', 'goals', 'watch', 'reminders']) {
    assert.equal(e.onboardingEResumeStep(e.onboardingEStage(step), 'android'), step);
  }
  assert.equal(e.onboardingEResumeStep(e.onboardingEStage('capture'), 'android'), 'capture');
  assert.equal(e.onboardingEResumeStep(e.onboardingEStage('live'), 'ios'), 'live');
  assert.equal(e.onboardingEResumeStep('remote-handoff', 'ios'), 'name');
  for (const legacy of ['intention', 'preview', 'privacy']) assert.equal(e.onboardingEResumeStep(legacy, 'ios'), 'reminders');
  // Every stage written is one older builds and the store already accept.
  const known = ['welcome', 'focus', 'tracking', 'alerts', 'intention', 'preview', 'remote-handoff', 'privacy', 'capture', 'complete'];
  for (const step of steps) assert.ok(known.includes(e.onboardingEStage(step)), step);
  // Colours: ink, clay, green, sand, ochre, green; the reveal and paywall ink.
  assert.deepEqual(steps.map((step) => e.ONBOARDING_E_BANDS[step]),
    ['home', 'spending', 'flow', 'settings', 'bills', 'flow', 'flow', 'flow', 'home', 'home']);
});

test('the trial timeline follows the days actually left', () => {
  assert.deepEqual(e.trialTimeline(3), [{ key: 'today', day: 0 }, { key: 'end', day: 3 }]);
  assert.deepEqual(e.trialTimeline(1), [{ key: 'today', day: 0 }, { key: 'end', day: 1 }]);
  assert.deepEqual(e.trialTimeline(0), []);
  assert.deepEqual(e.trialTimeline(Number.NaN), []);
  const paywall = read('src/components/onboarding/e-paywall.tsx');
  assert.match(paywall, /trialDays > 0 \? words\.startFree\(trialDays\) : words\.continueFree/);
  const gate = read('src/components/onboarding-gate.tsx');
  assert.match(gate, /trialDays=\{trialDaysLeft\(state\)\}/, 'the paywall counts what is left, not a constant');
});

test('the paywall sells through the real billing layer and never writes a price', () => {
  const paywall = read('src/components/onboarding/e-paywall.tsx');
  assert.match(paywall, /useWafraBilling\(\)/);
  assert.match(paywall, /fetchProOffers\(\)/);
  assert.match(paywall, /billing\.purchasePro\(selected\.productId\)/);
  assert.match(paywall, /billing\.restorePro\(\)/);
  assert.match(paywall, /offer\.priceString/);
  assert.doesNotMatch(paywall, /PRO_REFERENCE_PRICE_STRINGS|PRO_PRICES|(?:US\$|\$|€|£|AED|SAR)\s?\d/);
  assert.match(paywall, /configuredPublicUrl\('privacyPolicyUrl'\)[\s\S]{0,120}configuredPublicUrl\('termsOfUseUrl'\)/);
  assert.match(paywall, /if \(!legalReady\) \{ setNotice\(\{ title: t\('purchaseUnavailable'\), body: t\('purchaseLegalMissingBody'\) \}\)/);
  assert.match(paywall, /if \(outcome === 'cancelled'\) return;/);
  assert.match(paywall, /if \(outcome === 'pending'\)/);
  // The free way on is always there and needs no store.
  assert.match(paywall, /testID="onboarding-paywall-free"/);
  // An entitled person never sees it.
  assert.match(read('src/components/onboarding-gate.tsx'), /const showPaywall = previewMode \|\| !entitled/);
});

/* ── repair for Homes saved by the earlier Goals step ─────────────────── */

// The earlier step: promoted sections in front of whatever was saved before.
const earlierGoals = (goals, current) => {
  const base = JSON.parse(JSON.stringify(prefs.normalizeHomeWidgetPreferences(current)));
  const promotedIds = [];
  for (const goal of e.GOAL_HOME_PRECEDENCE) if (goals.includes(goal)) for (const id of e.GOAL_HOME_SECTIONS[goal]) if (!promotedIds.includes(id)) promotedIds.push(id);
  return { order: [...promotedIds, ...base.order.filter((id) => !promotedIds.includes(id))], hidden: base.hidden };
};
const shown = (layout) => JSON.parse(JSON.stringify(prefs.splitHomeWidgetLayout(layout)));

test('a Home saved by the earlier goal-first Goals step gets its band back', () => {
  const cases = [['bills'], ['subscriptions'], ['spend-less'], ['salary'], ['cash-cards'], ['salary', 'bills'], ['bills', 'spend-less', 'cash-cards']];
  for (const goals of cases) {
    const saved = earlierGoals(goals, { order: [...DEFAULT], hidden: ['assistant'] });
    assert.deepEqual(shown(saved).band, [], `${goals.join()}: the earlier step emptied the band`);
    const repaired = e.repairGoalOrderedHome(saved);
    assert.deepEqual(repaired, e.homeOrderForGoals(goals, { order: [...DEFAULT], hidden: ['assistant'] }), `${goals.join()}: same as today's Goals step`);
    assert.deepEqual(shown(repaired).band, BAND);
    assert.equal(e.repairGoalOrderedHome(repaired), null, 'a repaired Home is left alone');
  }
});

test('going Back and choosing again stacked the runs; the repair still restores the band', () => {
  const once = earlierGoals(['bills'], { order: [...DEFAULT], hidden: [] });
  for (const second of [['salary'], ['bills', 'salary'], ['subscriptions']]) {
    const twice = earlierGoals(second, once);
    const repaired = e.repairGoalOrderedHome(twice);
    assert.deepEqual(shown(repaired).band, BAND, second.join());
    const goalRun = twice.order.slice(0, twice.order.indexOf('greeting'));
    const payments = goalRun.filter((id, index) => ['due', 'upcoming'].includes(id) && index > goalRun.indexOf('activity') && goalRun.includes('activity'));
    const expected = goalRun.filter((id) => !payments.includes(id));
    if (payments.length) expected.splice(expected.indexOf('activity'), 0, ...payments);
    assert.deepEqual(repaired.order.slice(TOP.length, goalRun.length + TOP.length), expected,
      'the goal sections keep their order under the band, payments before activity');
    assert.deepEqual([...repaired.order].sort(), [...EXPANDED_DEFAULT].sort());
  }
});

test('the repair leaves every other layout alone', () => {
  const rest = ['assistant', 'insight', 'activity', 'capture'];
  // A non-goal section first, or something other than the band after the goal run.
  assert.equal(e.repairGoalOrderedHome({ order: ['assistant', ...TOP, 'due', 'upcoming', 'insight', 'activity', 'capture'], hidden: [] }), null);
  assert.equal(e.repairGoalOrderedHome({ order: ['due', 'assistant', ...TOP, 'upcoming', 'insight', 'activity', 'capture'], hidden: [] }), null);
  assert.equal(e.repairGoalOrderedHome({ order: ['due', 'upcoming', 'capture', ...TOP, ...rest.slice(0, 3)], hidden: [] }), null);
  // Today's default and today's Goals output.
  assert.equal(e.repairGoalOrderedHome({ order: [...EXPANDED_DEFAULT], hidden: [] }), null);
  assert.equal(e.repairGoalOrderedHome(e.homeOrderForGoals(['bills'], { order: [...DEFAULT], hidden: [] })), null);
  // Accepted: a Customize Home layout with only goal sections above the band
  // is indistinguishable from the earlier step's output and is repaired once.
  assert.deepEqual(shown(e.repairGoalOrderedHome({ order: ['insight', ...TOP, 'due', 'upcoming', 'assistant', 'activity', 'capture'], hidden: [] })).band, BAND);
});
