const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
const ok = (name, condition, detail) => {
  if (condition) { pass += 1; console.log(`✓ ${name}`); }
  else { fail += 1; console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const eq = (name, actual, expected) => ok(
  name,
  JSON.stringify(actual) === JSON.stringify(expected),
  `got ${JSON.stringify(actual)}; want ${JSON.stringify(expected)}`,
);

const builtPath = path.join(__dirname, 'build/history-import.js');
const history = fs.existsSync(builtPath) ? require(builtPath) : {};
const storeSource = fs.readFileSync(path.join(__dirname, '../../src/lib/store.tsx'), 'utf8');
const autoImportSource = fs.readFileSync(path.join(__dirname, '../../src/hooks/use-auto-import.ts'), 'utf8');
const homeSource = fs.readFileSync(path.join(__dirname, '../../src/screens/ledger-home-screen.tsx'), 'utf8');
const settingsSource = fs.readFileSync(path.join(__dirname, '../../src/app/settings.tsx'), 'utf8');
const historyHookSource = fs.readFileSync(path.join(__dirname, '../../src/hooks/use-history-import.ts'), 'utf8');

(async () => {
  const apiExists =
    typeof history.createHistoryImportProgress === 'function' &&
    typeof history.normalizeHistoryImportProgress === 'function' &&
    typeof history.createHistoryImportCoordinator === 'function';
  ok('resumable history import exposes one tested state-machine boundary', apiExists);
  if (!apiExists) {
    console.log(`\nhistory-import: ${pass} passed, ${fail} failed`);
    process.exit(1);
  }

  ok(
    'the store exposes durable status transitions without advancing a page cursor',
    /setHistoryImportProgress: \(progress: HistoryImportProgress\) => Promise<void>/.test(storeSource) &&
      /const setHistoryImportProgress = useCallback\(async \(progress: HistoryImportProgress\)/.test(storeSource),
  );
  ok(
    'starting history import is durable and preserves unfinished progress',
    /beginHistoryImport: \(\) => Promise<void>/.test(storeSource) &&
      /authoritativeState\.current\.historyImport/.test(storeSource) &&
      /createHistoryImportProgress\(Date\.now\(\)\)/.test(storeSource),
  );
  ok(
    'routine capture cannot race an unfinished first-history import',
    /state\.historyImport && state\.historyImport\.status !== 'complete'[\s\S]*?return 'history-import-running'/.test(
      autoImportSource,
    ),
  );
  ok(
    'Home exposes live, saved, and failed history progress with retry',
    /HistoryImportNotice/.test(homeSource) &&
      /state\.historyImport/.test(homeSource) &&
      /beginHistoryImport/.test(homeSource) &&
      /accessibilityRole="progressbar"/.test(homeSource),
  );
  ok(
    'Settings exposes the same durable history state and retry control',
    /historyImportSettingsTitle/.test(settingsSource) &&
      /state\.historyImport/.test(settingsSource) &&
      /beginHistoryImport/.test(settingsSource),
  );
  ok(
    'every history page plans against the store authoritative snapshot',
    /getStateSnapshot/.test(storeSource) &&
      /getStateSnapshot\(\)/.test(historyHookSource) &&
      !/buildImportPlan\(page\.parsed, stateRef\.current/.test(historyHookSource),
  );
  ok(
    'history progress counts every inbox or notification row it can find money in',
    /scanned: page\.scannedCount/.test(historyHookSource) &&
      /found: page\.parsed\.length \+ page\.reviewCandidates\.length/.test(historyHookSource),
  );

  eq('a new import starts paused with no provider cursor',
    history.createHistoryImportProgress(100), {
      status: 'paused',
      cursor: null,
      scanned: 0,
      found: 0,
      startedAt: 100,
      updatedAt: 100,
      error: null,
    });
  eq('a process death turns persisted running work into resumable paused work',
    history.normalizeHistoryImportProgress({
      status: 'running',
      cursor: { beforeDateMs: 900, beforeId: 90 },
      scanned: 1000,
      found: 4,
      startedAt: 100,
      updatedAt: 200,
      error: null,
    }), {
      status: 'paused',
      cursor: { beforeDateMs: 900, beforeId: 90 },
      scanned: 1000,
      found: 4,
      startedAt: 100,
      updatedAt: 200,
      error: null,
    });

  {
    let now = 100;
    let progress = history.createHistoryImportProgress(now);
    const events = [];
    const pages = [
      {
        scanned: 1000,
        found: 3,
        complete: false,
        nextCursor: { beforeDateMs: 900, beforeId: 90 },
      },
      { scanned: 2, found: 0, complete: true, nextCursor: null },
    ];
    const coordinator = history.createHistoryImportCoordinator({
      getProgress: () => progress,
      shouldContinue: () => true,
      now: () => ++now,
      scanPage: async (cursor) => {
        events.push(['scan', cursor]);
        return pages.shift();
      },
      commitPage: async (_page, next) => {
        events.push(['commit', next.cursor, next.status]);
        progress = next;
      },
      persistProgress: async (next) => {
        events.push(['persist', next.status]);
        progress = next;
      },
    });
    const firstRun = coordinator.run();
    const joinedRun = coordinator.run();
    ok('concurrent resume requests join one history import', firstRun === joinedRun);
    await firstRun;
    eq('bounded pages advance only through their durable commit boundary', events, [
      ['persist', 'running'],
      ['scan', null],
      ['commit', { beforeDateMs: 900, beforeId: 90 }, 'running'],
      ['scan', { beforeDateMs: 900, beforeId: 90 }],
      ['commit', null, 'complete'],
    ]);
    eq('history completion keeps cumulative progress and clears its cursor', progress, {
      status: 'complete',
      cursor: null,
      scanned: 1002,
      found: 3,
      startedAt: 100,
      updatedAt: 103,
      error: null,
    });
  }

  {
    const committedCursor = { beforeDateMs: 700, beforeId: 70 };
    let progress = {
      status: 'paused', cursor: committedCursor, scanned: 1000, found: 2,
      startedAt: 10, updatedAt: 20, error: null,
    };
    const events = [];
    const coordinator = history.createHistoryImportCoordinator({
      getProgress: () => progress,
      shouldContinue: () => true,
      now: () => 30,
      scanPage: async () => ({
        scanned: 1000,
        found: 5,
        complete: false,
        nextCursor: { beforeDateMs: 500, beforeId: 50 },
      }),
      commitPage: async () => {
        events.push('commit-failed');
        throw new Error('encrypted write failed');
      },
      persistProgress: async (next) => {
        events.push(next.status);
        progress = next;
      },
    });
    let rejected = false;
    try { await coordinator.run(); } catch { rejected = true; }
    ok('a failed page commit rejects visibly', rejected);
    eq('failure preserves the last committed cursor and counts for a safe retry', progress, {
      status: 'failed',
      cursor: committedCursor,
      scanned: 1000,
      found: 2,
      startedAt: 10,
      updatedAt: 30,
      error: 'page-failed',
    });
    eq('failure is persisted only after the durable page write rejects', events, [
      'running', 'commit-failed', 'failed',
    ]);
  }

  {
    let progress = history.createHistoryImportProgress(1);
    let scans = 0;
    const coordinator = history.createHistoryImportCoordinator({
      getProgress: () => progress,
      shouldContinue: () => false,
      now: () => 2,
      scanPage: async () => { scans += 1; throw new Error('must not scan'); },
      commitPage: async () => {},
      persistProgress: async (next) => { progress = next; },
    });
    await coordinator.run();
    ok('backgrounded work pauses without reading another provider page',
      scans === 0 && progress.status === 'paused');
  }

  {
    let generation = 1;
    let progress = history.createHistoryImportProgress(10);
    let commits = 0;
    const restored = {
      ...history.createHistoryImportProgress(50),
      cursor: { beforeDateMs: 400, beforeId: 40 },
    };
    const coordinator = history.createHistoryImportCoordinator({
      getProgress: () => progress,
      getGeneration: () => generation,
      shouldContinue: () => true,
      now: () => 60,
      scanPage: async () => {
        generation += 1;
        progress = restored;
        return { scanned: 1000, found: 4, complete: false, nextCursor: { beforeDateMs: 1, beforeId: 1 } };
      },
      commitPage: async () => { commits += 1; },
      persistProgress: async (next) => { progress = next; },
    });
    await coordinator.run();
    ok('restoring a ledger during provider read discards the old page and cursor',
      commits === 0 && progress === restored);
  }

  {
    let allowed = true;
    let progress = history.createHistoryImportProgress(10);
    let commits = 0;
    const coordinator = history.createHistoryImportCoordinator({
      getProgress: () => progress,
      shouldContinue: () => allowed,
      now: () => 20,
      scanPage: async () => {
        allowed = false;
        return { scanned: 1000, found: 4, complete: false, nextCursor: { beforeDateMs: 1, beforeId: 1 } };
      },
      commitPage: async () => { commits += 1; },
      persistProgress: async (next) => { progress = next; },
    });
    await coordinator.run();
    ok('opting out or backgrounding during provider read discards the page',
      commits === 0 && progress.status === 'paused' && progress.cursor === null);
  }

  {
    let progress = history.createHistoryImportProgress(10);
    const coordinator = history.createHistoryImportCoordinator({
      getProgress: () => progress,
      shouldContinue: () => true,
      now: () => 20,
      scanPage: async () => { throw new Error('restricted'); },
      classifyError: () => 'inbox-access',
      commitPage: async () => {},
      persistProgress: async (next) => { progress = next; },
    });
    try { await coordinator.run(); } catch {}
    ok('restricted inbox access is persisted as a safe recoverable status',
      progress.status === 'failed' && progress.error === 'inbox-access');
  }

  ok('persisted progress contains no raw message or parsed-row field',
    !/raw|body|message|parsed|rows/i.test(
      JSON.stringify(history.createHistoryImportProgress(1)),
    ));

  console.log(`\nhistory-import: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
