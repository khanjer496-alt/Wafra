const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const root = require('path').join(__dirname, '../..');
const ts = require(require.resolve('typescript', {
  paths: [root, require('path').resolve(root, '../..')],
}));
const { onboardingResumeDestination, DEFAULT_ONBOARDING_PLAN } = require('./build/onboarding');
const source = fs.readFileSync(root + '/src/components/onboarding-gate.tsx', 'utf8');
const tree = ts.createSourceFile('gate.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback, dependencies;
const visit = node => {
  if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect' &&
      node.arguments[0]?.getText(tree).includes('resumeHandled.current')) {
    assert.equal(callback, undefined, 'one resume effect owns the lifecycle');
    callback = node.arguments[0].getText(tree);
    dependencies = node.arguments[1].getText(tree);
  }
  ts.forEachChild(node, visit);
};
visit(tree); assert.ok(callback);
const actualEffect = ts.transpileModule(`({ effect: ${callback}, dependencies: () => ${dependencies} })`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
class EffectHarness {
  constructor() {
    this.input = { state: { hydrated: true, onboarded: false, onboardingPlan: null, onboardingProfile: null }, pathname: '/',
      params: {}, hydrationFailed: false, resumeAttempt: 0 };
    this.ui = { ready: false, failed: false, step: 'welcome', focus: null, tracking: null, intention: null, alerts: null, country: null,
      collectingName: false, nameDraft: '', nameSaving: false, nameSaveFailed: false,
      smsReady: false, notificationReady: false, awaitingNotification: false };
    this.resumeHandled = { current: false }; this.previouslyOnboarded = { current: false };
    this.notificationDecisionMade = { current: false };
    this.routes = []; this.reads = 0; this.loader = async () => ({ returnToOnboarding: false });
    this.router = { replace: path => this.routes.push(path) };
  }
  render(update = {}) {
    Object.assign(this.input, update);
    const context = { ...this.input, Platform: { OS: 'ios' }, router: this.router,
      resumeHandled: this.resumeHandled, previouslyOnboarded: this.previouslyOnboarded,
      notificationDecisionMade: this.notificationDecisionMade,
      DEFAULT_ONBOARDING_PLAN, onboardingResumeDestination,
      setFocus: value => { this.ui.focus = value; },
      setTracking: value => { this.ui.tracking = value; },
      setIntention: value => { this.ui.intention = value; },
      setAlerts: value => { this.ui.alerts = value; },
      setCountry: value => { this.ui.country = value; },
      normalizeOnboardingCountry: value => (typeof value === 'string' &&
        /^[A-Z]{2}$/.test(value.trim().toUpperCase()) ? value.trim().toUpperCase() : null),
      setCollectingName: value => { this.ui.collectingName = value; },
      setNameDraft: value => { this.ui.nameDraft = value; },
      setNameSaving: value => { this.ui.nameSaving = value; },
      setNameSaveFailed: value => { this.ui.nameSaveFailed = value; },
      setAndroidSmsReady: value => { this.ui.smsReady = value; },
      setAndroidNotificationReady: value => { this.ui.notificationReady = value; },
      setAwaitingNotificationAccess: value => { this.ui.awaitingNotification = value; },
      setPendingOpen: () => {},
      setStep: value => { this.ui.step = value; },
      setResumeReady: value => { this.ui.ready = value; },
      setResumeFailed: value => { this.ui.failed = value; },
      loadIosMessageSetupProgress: () => { this.reads++; return this.loader(); },
    };
    const actual = vm.runInNewContext(actualEffect, context);
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
  const erase = new EffectHarness(); erase.ui.step = 'complete'; erase.ui.intention = 'stay-ahead';
  erase.ui.alerts = 'notifications'; erase.ui.country = 'GB';
  erase.render({ state: { hydrated: true, onboarded: true, onboardingPlan: null, onboardingProfile: null } });
  erase.render({ state: { hydrated: true, onboarded: false, onboardingPlan: null, onboardingProfile: null } }); await flush();
  assert.equal(erase.ui.step, 'welcome');
  assert.equal(erase.ui.focus, null); assert.equal(erase.ui.tracking, null); assert.equal(erase.ui.intention, null);
  assert.equal(erase.ui.alerts, null); assert.equal(erase.ui.country, null);
  assert.equal(erase.ui.smsReady, false); assert.equal(erase.ui.notificationReady, false);
  ok('erase in same mounted gate clears completion and integrated preferences');
  const staged = new EffectHarness();
  staged.render({ state: { hydrated: true, onboarded: false, onboardingPlan: null,
    onboardingProfile: { v: 1, stage: 'tracking', focus: 'bills', tracking: null, intention: 'stay-ahead',
      alerts: 'notifications', country: 'AE', startedAt: 123 } } });
  await flush();
  assert.equal(staged.ui.step, 'tracking'); assert.equal(staged.ui.focus, 'bills');
  assert.equal(staged.ui.tracking, null); assert.equal(staged.ui.intention, 'stay-ahead');
  assert.equal(staged.ui.alerts, 'notifications'); assert.equal(staged.ui.country, 'AE');
  ok('saved integrated stage, focus and intention resume without restarting');
  // A corrected country is the whole point of the control: it cannot be the one
  // answer a resume drops, or the wrong country returns on the next launch.
  const legacy = new EffectHarness();
  legacy.render({ state: { hydrated: true, onboarded: false, onboardingPlan: null,
    onboardingProfile: { v: 1, stage: 'focus', focus: null, tracking: null, startedAt: 9 } } });
  await flush();
  assert.equal(legacy.ui.country, null); assert.equal(legacy.ui.alerts, null);
  ok('a profile saved before either answer existed resumes with neither invented');
  const canceled = new EffectHarness(); let release;
  canceled.loader = () => new Promise(resolve => { release = resolve; });
  canceled.render(); canceled.render({ pathname: '/import-sms' });
  release({ returnToOnboarding: true }); await flush();
  assert.deepEqual(canceled.routes, []); assert.equal(canceled.resumeHandled.current, false); ok('canceled root read cannot redirect over manual import');
  const recovery = new EffectHarness(); recovery.render({ hydrationFailed: true }); await flush();
  assert.equal(recovery.reads, 0); assert.equal(recovery.ui.ready, false); ok('storage recovery prevents onboarding reads');
  console.log(`${pass} lifecycle scenarios passed; actual source-extracted effect and dependency array; no device UI claim.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
