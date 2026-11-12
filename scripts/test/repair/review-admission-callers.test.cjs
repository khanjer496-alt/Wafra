'use strict';
// Strict 'hold-source' admission defers instead of evicting. It is safe only for
// a caller that keeps its source queued for a retry (withheld ACK, held cursor,
// held native session, thrown hold). Pin every staging call site and its mode so
// a new caller gets the default bounded policy unless it is classified here on
// purpose, and no caller can silently opt into deferral (CEO 4a8b6cee).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../..');

const SOURCES = ['src/app', 'src/hooks', 'src/lib', 'src/components'];
const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel);
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.generated.ts')) files.push(rel);
  }
};
SOURCES.forEach(walk);

const enclosing = (node) => {
  // The nearest NAMED function: anonymous callbacks belong to their owner.
  for (let at = node.parent; at; at = at.parent) {
    if (ts.isFunctionDeclaration(at) || ts.isMethodDeclaration(at)) {
      if (at.name && ts.isIdentifier(at.name)) return at.name.text;
    }
    if (ts.isArrowFunction(at) || ts.isFunctionExpression(at)) {
      let owner = at.parent;
      if (owner && ts.isCallExpression(owner) && owner.parent && ts.isVariableDeclaration(owner.parent) &&
        /^use(Callback|Memo)$/.test(owner.expression.getText())) owner = owner.parent;
      if (owner && (ts.isVariableDeclaration(owner) || ts.isPropertyAssignment(owner)) &&
        owner.name && ts.isIdentifier(owner.name)) return owner.name.text;
    }
  }
  return '<module>';
};
const modeOf = (call, index) => {
  const arg = call.arguments[index];
  if (!arg) return 'bounded';
  return ts.isStringLiteral(arg) ? arg.text : `<${arg.getText()}>`;
};

const sites = [];
for (const file of files) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  if (!/stageReviewAlerts|admitPreparedReviewAlerts?\(|persistIosHistoryReviewCandidates/.test(text)) continue;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf).replace(/!$/, '');
      const name = callee.split('.').pop();
      if (name === 'stageReviewAlerts') sites.push(`${file} ${enclosing(node)} stageReviewAlerts ${modeOf(node, 3)}`);
      if ((name === 'admitPreparedReviewAlerts' || name === 'admitPreparedReviewAlert') && file !== 'src/lib/alert-review-tray.ts') {
        sites.push(`${file} ${enclosing(node)} ${name} ${modeOf(node, 3)}`);
      }
      if (file === 'src/lib/ios-history-import.ts' && callee === 'stage') {
        sites.push(`${file} ${enclosing(node)} stage ${modeOf(node, 3)}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

if (process.env.PRINT_REVIEW_ADMISSION_SITES) console.log(JSON.stringify(sites.sort(), null, 1));

const EXPECTED = [
  // Manual SMS scan: assertReviewRetention throws ReviewImportHold before any commit.
  'src/app/import-sms.tsx runScan stageReviewAlerts hold-source',
  'src/app/import-sms.tsx runScan stageReviewAlerts hold-source',
  // Plan apply and the iOS History secure-save retry: near-match staging throws a
  // hold (WalletNearMatchStagingError) and never commits or discards the source.
  'src/app/import-sms.tsx applyPlan stageReviewAlerts hold-source',
  'src/app/import-sms.tsx load stageReviewAlerts hold-source',
  // Paste: the pasted text is not kept for a retry, so it keeps the bounded policy.
  'src/app/import-sms.tsx runParse stageReviewAlerts bounded',
  // Android History: pauses with 'review-capacity' and keeps its cursor.
  'src/hooks/use-history-import.ts commitPage stageReviewAlerts hold-source',
  'src/hooks/use-history-import.ts commitPage stageReviewAlerts hold-source',
  // Android executor (SMS inbox, push, relay): withholds ACKs / keeps lastScanTs.
  'src/lib/capture-executor.ts executeRoutine stageReviewAlerts hold-source',
  'src/lib/capture-executor.ts executeSetupVerification stageReviewAlerts hold-source',
  'src/lib/capture-executor.ts executeSupplemental stageReviewAlerts hold-source',
  'src/lib/capture-executor.ts stageNearMatches stageReviewAlerts hold-source',
  // iOS History: the native session stays until every row is settled.
  'src/lib/ios-history-import.ts persistIosHistoryReviewCandidates stage hold-source',
  // iOS live capture: a deferred record is never acknowledged in the native queue.
  'src/lib/ios-local-capture.ts performDrain stageReviewAlerts hold-source',
  'src/lib/ios-local-capture.ts performDrain stageReviewAlerts hold-source',
  'src/lib/ios-local-capture.ts performDrain stageReviewAlerts hold-source',
  'src/lib/ios-local-capture.ts performDrain stageReviewAlerts hold-source',
  // The store forwards its caller's mode, defaulting to 'bounded'.
  'src/lib/store.tsx stageReviewAlerts admitPreparedReviewAlerts <mode>',
];

test('every review staging call site is classified with its admission mode', () => {
  const actual = sites.slice().sort();
  const expected = EXPECTED.slice().sort();
  assert.deepEqual(actual, expected,
    'A new or changed staging call site must be classified here. Use hold-source only when the caller keeps its source.');
});
test('paste never uses strict deferral', () => {
  assert.ok(sites.some((site) => site === 'src/app/import-sms.tsx runParse stageReviewAlerts bounded'));
  assert.ok(!sites.some((site) => site.startsWith('src/app/import-sms.tsx runParse ') && site.endsWith(' hold-source')));
});
test('the store and every adapter default to the bounded policy', () => {
  const store = fs.readFileSync(path.join(root, 'src/lib/store.tsx'), 'utf8');
  assert.match(store, /mode: ReviewAdmissionMode = 'bounded',/);
  const trayText = fs.readFileSync(path.join(root, 'src/lib/alert-review-tray.ts'), 'utf8');
  assert.match(trayText, /now: number, mode: ReviewAdmissionMode = 'bounded',/);
  assert.match(trayText, /mode: ReviewAdmissionMode = 'bounded',\n\): \{ state: AlertReviewTrayState; outcomes/);
});
