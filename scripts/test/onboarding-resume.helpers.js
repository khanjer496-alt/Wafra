const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const root = require('path').join(__dirname, '../..');
const ts = require(require.resolve('typescript', {
  paths: [root, require('path').resolve(root, '../..')],
}));
const { onboardingResumeDestination, DEFAULT_ONBOARDING_PLAN, normalizePreferredName } = require('./build/onboarding');
// The E journey's pure resume/draft helpers, executed from source.
const loadTs = require('./repair/load-typescript.cjs');
const srcLib = (name, deps = {}) => loadTs(`${root}/src/lib/${name}.ts`, deps);
const typesModule = srcLib('types');
const { sanitizeGoalIds } = typesModule;
const { onboardingEResumeStep, watchDraftFromBudgets } = srcLib('onboarding-e', {
  '@/lib/types': typesModule, '@/lib/splits': srcLib('splits'),
  '@/lib/home-widget-preferences': srcLib('home-widget-preferences'),
  '@/lib/transaction-source': srcLib('transaction-source'),
});
const source = fs.readFileSync(root + '/src/components/onboarding-gate.tsx', 'utf8');
const tree = ts.createSourceFile('gate.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback, dependencies, resetJourney;
const visit = node => {
  if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect' &&
      node.arguments[0]?.getText(tree).includes('resumeHandled.current')) {
    assert.equal(callback, undefined, 'one resume effect owns the lifecycle');
    callback = node.arguments[0].getText(tree);
    dependencies = node.arguments[1].getText(tree);
  }
  // The shipping reset the erase path calls, executed as written.
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'resetJourneyState') {
    resetJourney = node.initializer.getText(tree);
  }
  ts.forEachChild(node, visit);
};
visit(tree); assert.ok(callback); assert.ok(resetJourney, 'the gate has one journey reset');
const actualEffect = ts.transpileModule(`({ effect: ${callback}, dependencies: () => ${dependencies}, reset: ${resetJourney} })`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
class EffectHarness {
  constructor() {
    this.input = { state: { hydrated: true, onboarded: false, onboardingPlan: null, onboardingProfile: null,
      userName: 'there', budgets: [], wafraGoals: undefined }, pathname: '/',
      params: {}, hydrationFailed: false, resumeAttempt: 0 };
    this.ui = { ready: false, failed: false, step: 'welcome', alerts: null, country: null,
      nameDraft: '', nameSaving: false, nameSaveFailed: false, goals: [], watch: [], watchActive: null,
      smsReady: false, notificationReady: false, awaitingNotification: false, reveal: false };
    this.resumeHandled = { current: false }; this.previouslyOnboarded = { current: false };
    this.alertsRef = { current: null }; this.iosSetupLaunched = { current: false }; this.resumeAtResult = { current: false };
    this.routes = []; this.reads = 0; this.loader = async () => ({ returnToOnboarding: false });
    this.router = { replace: path => this.routes.push(path) };
  }
  render(update = {}) {
    Object.assign(this.input, update);
    const ui = this.ui;
    const context = { ...this.input, Platform: { OS: 'ios' }, router: this.router,
      resumeHandled: this.resumeHandled, previouslyOnboarded: this.previouslyOnboarded,
      alertsRef: this.alertsRef, iosSetupLaunched: this.iosSetupLaunched, resumeAtResult: this.resumeAtResult,
      DEFAULT_ONBOARDING_PLAN, onboardingResumeDestination, onboardingEResumeStep,
      normalizePreferredName, sanitizeGoalIds, watchDraftFromBudgets,
      setAlerts: value => { ui.alerts = value; },
      setCountry: value => { ui.country = value; },
      normalizeOnboardingCountry: value => (typeof value === 'string' &&
        /^[A-Z]{2}$/.test(value.trim().toUpperCase()) ? value.trim().toUpperCase() : null),
      setNameDraft: value => { ui.nameDraft = value; },
      setNameSaving: value => { ui.nameSaving = value; },
      setNameSaveFailed: value => { ui.nameSaveFailed = value; },
      setGoalsDraft: value => { ui.goals = value; },
      setWatchDraft: value => { ui.watch = value; },
      setWatchActive: value => { ui.watchActive = value; },
      setDailySummaryDraft: () => {}, setNotificationsAllowed: () => {}, setCurrencyDraft: () => {},
      setResult: () => {}, setSmsDenied: () => {}, setCompletionOutcome: value => { ui.outcome = value; },
      setAndroidSmsReady: value => { ui.smsReady = value; },
      setAndroidNotificationReady: value => { ui.notificationReady = value; },
      setAwaitingNotificationAccess: value => { ui.awaitingNotification = value; },
      setRevealAfterSetup: value => { ui.reveal = value; },
      setStep: value => { ui.step = value; },
      setResumeReady: value => { ui.ready = value; },
      setResumeFailed: value => { ui.failed = value; },
      loadIosMessageSetupProgress: () => { this.reads++; return this.loader(); },
      // The shipping effect reads this from render scope. Statement import owns
      // its handoff; existing resume cases are never on that authorized route.
      isOnboardingStatementRoute: this.input.pathname === '/statement-import' &&
        this.input.params?.statementSession != null,
    };
    const compiled = vm.runInNewContext(actualEffect, context);
    context.resetJourneyState = compiled.reset;
    const actual = compiled;
    const deps = actual.dependencies();
    if (this.deps && deps.every((value, index) => Object.is(value, this.deps[index]))) return;
    if (this.cleanup) this.cleanup();
    this.deps = deps; this.cleanup = actual.effect();
  }
}
const flush = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  let pass = 0; const ok = name => { console.log('PASS ' + name); pass++; };
  const pending = new EffectHarness();
  pending.loader = async () => ({ returnToOnboarding: true });
  pending.render({ pathname: '/ios-setup' }); assert.equal(pending.ui.ready, true);
  pending.render({ pathname: '/' }); assert.equal(pending.ui.ready, false); await flush();
  assert.deepEqual(pending.routes, ['/ios-setup?fromOnboarding=1']); ok('native setup to ordinary root re-reads pending setup');
  const completed = new EffectHarness(); completed.loader = async () => ({ returnToOnboarding: true });
  completed.render({ params: { onboarding: 'complete' } }); await flush();
  assert.equal(completed.ui.step, 'complete'); assert.deepEqual(completed.routes, []); ok('completion callback reaches completion without redirecting back');
  const retry = new EffectHarness(); retry.loader = async () => { throw new Error('private read failure'); };
  retry.render(); await flush(); assert.equal(retry.ui.failed, true); assert.equal(retry.ui.ready, false);
  retry.loader = async () => ({ returnToOnboarding: true }); retry.render({ resumeAttempt: 1 }); await flush();
  assert.equal(retry.ui.failed, false); assert.deepEqual(retry.routes, ['/ios-setup?fromOnboarding=1']); ok('read failure holds gate and retry resumes');
  // Every ledger below carries the fields the E resume reads (name, goals, budgets).
  const ledger = (extra) => ({ hydrated: true, onboarded: false, onboardingPlan: null, onboardingProfile: null,
    userName: 'there', budgets: [], wafraGoals: undefined, ...extra });
  const erase = new EffectHarness(); erase.ui.step = 'complete'; erase.ui.goals = ['bills'];
  erase.ui.alerts = 'notifications'; erase.ui.country = 'GB'; erase.ui.watch = [{ category: 'dining', limitMinor: 100 }];
  erase.render({ state: ledger({ onboarded: true }) });
  erase.render({ state: ledger({}) }); await flush();
  assert.equal(erase.ui.step, 'welcome');
  assert.deepEqual([...erase.ui.goals], []); assert.deepEqual([...erase.ui.watch], []);
  assert.equal(erase.ui.alerts, null); assert.equal(erase.ui.country, null);
  assert.equal(erase.ui.smsReady, false); assert.equal(erase.ui.notificationReady, false);
  assert.equal(erase.ui.reveal, false); assert.equal(erase.iosSetupLaunched.current, false);
  ok('erase in same mounted gate clears completion and integrated preferences');
  // Design language E: a saved stage resumes on its E step, with the name,
  // goals and watched limits already durable in the ledger as the drafts.
  const staged = new EffectHarness();
  staged.render({ state: ledger({ userName: 'Sara', wafraGoals: ['bills', 'nonsense', 'salary'],
    budgets: [{ category: 'dining', limitFils: 60000 }, { category: 'rent', limitFils: 1 }],
    onboardingProfile: { v: 1, stage: 'tracking', focus: 'bills', tracking: null, intention: 'stay-ahead',
      alerts: 'notifications', country: 'AE', startedAt: 123 } }) });
  await flush();
  assert.equal(staged.ui.step, 'watch');
  assert.equal(staged.ui.nameDraft, 'Sara');
  assert.deepEqual([...staged.ui.goals], ['salary', 'bills']);
  assert.deepEqual(JSON.parse(JSON.stringify(staged.ui.watch)), [{ category: 'dining', limitMinor: 60000 }]);
  assert.equal(staged.ui.watchActive, 'dining');
  assert.equal(staged.ui.alerts, 'notifications'); assert.equal(staged.ui.country, 'AE');
  assert.equal(staged.alertsRef.current, 'notifications');
  ok('a saved stage resumes on its step with the durable name, goals and limits');
  for (const [stage, step] of [['welcome', 'welcome'], ['focus', 'goals'], ['alerts', 'reminders'], ['intention', 'reminders'],
    ['preview', 'reminders'], ['privacy', 'reminders']]) {
    const h = new EffectHarness();
    h.render({ state: ledger({ onboardingProfile: { v: 1, stage, focus: null, tracking: null, startedAt: 1 } }) }); await flush();
    assert.equal(h.ui.step, step, stage);
  }
  ok('older journeys\' stages resume on the first E step not yet answered');
  // A corrected country is the whole point of the control: it cannot be the one
  // answer a resume drops, or the wrong country returns on the next launch.
  const legacy = new EffectHarness();
  legacy.render({ state: ledger({ onboardingProfile: { v: 1, stage: 'focus', focus: null, tracking: null, startedAt: 9 } }) });
  await flush();
  assert.equal(legacy.ui.country, null); assert.equal(legacy.ui.alerts, null);
  ok('a profile saved before either answer existed resumes with neither invented');
  const canceled = new EffectHarness(); let release;
  canceled.loader = () => new Promise(resolve => { release = resolve; });
  canceled.render(); canceled.render({ pathname: '/import-sms' });
  release({ returnToOnboarding: true }); await flush();
  assert.deepEqual(canceled.routes, []); assert.equal(canceled.resumeHandled.current, false); ok('canceled root read cannot redirect over manual import');
  // iPhone: step 5 is live capture. Returning from Messages setup or the
  // statement importer, and a cold launch at the capture stage, both land there.
  const captureProfile = { v: 1, stage: 'capture', focus: 'bills', tracking: null, startedAt: 7 };
  const back = new EffectHarness();
  back.render({ pathname: '/ios-setup', state: ledger({ onboardingProfile: captureProfile }) });
  back.render({ pathname: '/' }); await flush();
  assert.equal(back.ui.step, 'live'); assert.deepEqual(back.routes, []);
  const cold = new EffectHarness();
  cold.render({ state: ledger({ onboardingProfile: captureProfile }) }); await flush();
  assert.equal(cold.ui.step, 'live');
  const done = new EffectHarness();
  done.render({ state: ledger({ onboardingProfile: { ...captureProfile, stage: 'complete' } }) }); await flush();
  assert.equal(done.ui.step, 'live', 'a saved completion returns to the choice that led to it, never claiming success');
  ok('returning from iPhone setup and a cold launch both resume at live capture');
  const recovery = new EffectHarness(); recovery.render({ hydrationFailed: true }); await flush();
  assert.equal(recovery.reads, 0); assert.equal(recovery.ui.ready, false); ok('storage recovery prevents onboarding reads');
  console.log(`${pass} lifecycle scenarios passed; actual source-extracted effect and dependency array; no device UI claim.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
