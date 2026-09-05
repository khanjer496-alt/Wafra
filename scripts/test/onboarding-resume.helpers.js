const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const root = require('path').join(__dirname, '../..');
const ts = require(root + '/node_modules/typescript');
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
    this.input = { state: { hydrated: true, onboarded: false, onboardingPlan: null }, pathname: '/',
      params: {}, hydrationFailed: false, resumeAttempt: 0 };
    this.ui = { ready: false, failed: false, step: 'welcome', plan: null, personalizing: false };
    this.resumeHandled = { current: false }; this.previouslyOnboarded = { current: false };
    this.routes = []; this.reads = 0; this.loader = async () => ({ returnToOnboarding: false });
    this.router = { replace: path => this.routes.push(path) };
  }
  render(update = {}) {
    Object.assign(this.input, update);
    const context = { ...this.input, Platform: { OS: 'ios' }, router: this.router,
      resumeHandled: this.resumeHandled, previouslyOnboarded: this.previouslyOnboarded,
      DEFAULT_ONBOARDING_PLAN, onboardingResumeDestination,
      setPlan: value => { this.ui.plan = value; },
      setPersonalizing: value => { this.ui.personalizing = value; },
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
  const erase = new EffectHarness(); erase.ui.step = 'complete'; erase.ui.personalizing = true;
  erase.render({ state: { hydrated: true, onboarded: true, onboardingPlan: null } });
  erase.render({ state: { hydrated: true, onboarded: false, onboardingPlan: null } }); await flush();
  assert.equal(erase.ui.step, 'welcome'); assert.equal(erase.ui.personalizing, false);
  assert.deepEqual(JSON.parse(JSON.stringify(erase.ui.plan)), DEFAULT_ONBOARDING_PLAN); ok('erase in same mounted gate clears completion and preferences');
  const canceled = new EffectHarness(); let release;
  canceled.loader = () => new Promise(resolve => { release = resolve; });
  canceled.render(); canceled.render({ pathname: '/import-sms' });
  release({ returnToOnboarding: true }); await flush();
  assert.deepEqual(canceled.routes, []); assert.equal(canceled.resumeHandled.current, false); ok('canceled root read cannot redirect over manual import');
  const recovery = new EffectHarness(); recovery.render({ hydrationFailed: true }); await flush();
  assert.equal(recovery.reads, 0); assert.equal(recovery.ui.ready, false); ok('storage recovery prevents onboarding reads');
  console.log(`${pass} lifecycle scenarios passed; actual source-extracted effect and dependency array; no device UI claim.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
