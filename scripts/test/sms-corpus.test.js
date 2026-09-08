const fs = require('node:fs');
const path = require('node:path');

const {
  collectSmsCorpus,
  serializeSmsCorpus,
} = require('./build/sms-corpus.js');

let pass = 0;
let fail = 0;
const ok = (name, condition, detail = '') => {
  if (condition) {
    pass += 1;
    console.log(`✓ ${name}`);
    return;
  }
  fail += 1;
  console.log(`✗ ${name}\n    ${detail}`);
};

const rejects = async (name, run, code) => {
  try {
    await run();
    ok(name, false, `expected ${code}`);
  } catch (error) {
    ok(name, error instanceof Error && error.message === code, String(error));
  }
};

(async () => {
  const sameTimestamp = Array.from({ length: 501 }, (_, index) => ({
    id: 900 - index,
    address: index % 2 ? 'BANK-A' : 'BANK-B',
    body: `exact body ${index}`,
    date: 1_800_000_000_000,
  }));
  const cursors = [];
  const messages = await collectSmsCorpus(async (beforeDateMs, beforeId, max) => {
    cursors.push([beforeDateMs, beforeId, max]);
    return sameTimestamp
      .filter((row) => row.date < beforeDateMs || (row.date === beforeDateMs && row.id < beforeId))
      .slice(0, max);
  });
  ok('date plus row-id pagination exports every same-millisecond SMS',
    messages.length === 501 && messages[500].body === 'exact body 500',
    `count=${messages.length}`);
  ok('the second native page continues below the final row id',
    cursors.length === 2 && cursors[1][0] === sameTimestamp[499].date &&
      cursors[1][1] === sameTimestamp[499].id && cursors[0][2] === 500,
    JSON.stringify(cursors));

  let keepCollecting = true;
  let cancelledPageReads = 0;
  await rejects(
    'leaving parser research cancels inbox collection between native pages',
    () => collectSmsCorpus(
      async () => {
        cancelledPageReads += 1;
        return sameTimestamp.slice(0, 500);
      },
      () => { keepCollecting = false; },
      { shouldContinue: () => keepCollecting },
    ),
    'sms_corpus_cancelled',
  );
  ok('cancellation prevents a second native inbox page read',
    cancelledPageReads === 1,
    `page reads=${cancelledPageReads}`);

  await rejects(
    'a native page that does not advance the cursor fails closed',
    () => collectSmsCorpus(async () => [{ id: Number.MAX_SAFE_INTEGER, address: 'B', body: 'x', date: Number.MAX_SAFE_INTEGER }]),
    'non_progressing_sms_corpus_page',
  );
  await rejects(
    'malformed native rows never enter the shared file',
    () => collectSmsCorpus(async () => [{ id: 1.5, address: 'B', body: 'x', date: 1 }]),
    'invalid_sms_corpus_page',
  );

  const serialized = serializeSmsCorpus([
    { sender: 'BANK', body: 'full\nmessage "text"', receivedAtMs: 1234 },
  ], Date.UTC(2026, 7, 11));
  const document = JSON.parse(serialized);
  ok('the corpus document preserves exact sender, body and timestamp',
    document.schema === 'wafra-sms-corpus-v1' &&
      document.exportedAt === '2026-08-11T00:00:00.000Z' &&
      document.messages[0].sender === 'BANK' &&
      document.messages[0].body === 'full\nmessage "text"' &&
      document.messages[0].receivedAtMs === 1234);
  ok('the Android database id is cursor-only and never leaves the phone',
    !serialized.includes('"id"'));

  const root = path.join(__dirname, '../..');
  const native = fs.readFileSync(path.join(
    root,
    'modules/sms-reader/android/src/main/java/expo/modules/smsreader/SmsReaderModule.kt',
  ), 'utf8');
  const gradle = fs.readFileSync(path.join(root, 'modules/sms-reader/android/build.gradle'), 'utf8');
  const adapter = fs.readFileSync(path.join(root, 'src/lib/sms-corpus-export.ts'), 'utf8');
  const ts = require('typescript');
  const compiled = ts.transpileModule(adapter, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const loadAdapter = ({ platform = 'android', flag = '1', native, readPage } = {}) => {
    const shared = [];
    const reads = [];
    const loaded = { exports: {} };
    const reader = native === undefined ? {
      isCorpusExportEnabled: () => true,
      getInboxCorpusPage: async (...args) => {
        reads.push(args);
        return readPage ? readPage(...args) : [];
      },
    } : native;
    Function('require', 'module', 'exports', 'process', compiled)((name) => {
      if (name === 'react-native') return { Platform: { OS: platform } };
      if (name === '../../modules/sms-reader') return reader;
      if (name === '@/lib/sms-corpus') return { collectSmsCorpus, serializeSmsCorpus };
      if (name === '@/lib/share-text') return { shareTextFile: async (...args) => { shared.push(args); } };
      throw new Error(`unexpected dependency ${name}`);
    }, loaded, loaded.exports, {
      env: flag == null ? {} : { EXPO_PUBLIC_WAFRA_SMS_CORPUS_EXPORT: flag },
    });
    return { api: loaded.exports, shared, reads };
  };
  const legacy = loadAdapter();
  await legacy.api.shareSmsCorpus();
  ok('raw corpus shares through the same owned temporary-file lifecycle',
    legacy.shared.length === 1 && /^wafra-sms-corpus-\d{4}-\d{2}-\d{2}\.json$/.test(legacy.shared[0][0]) &&
    JSON.parse(legacy.shared[0][1]).schema === 'wafra-sms-corpus-v1' &&
    legacy.shared[0][2].mimeType === 'application/json');

  const fullExportOptions = {
    getBackup: () => '{"transactions":[]}',
    shouldContinue: () => true,
  };
  for (const [name, config] of [
    ['Android JavaScript gate disabled', { flag: '0' }],
    ['Android JavaScript gate missing', { flag: null }],
    ['Android JavaScript gate not explicitly one', { flag: 'true' }],
    ['Android native gate disabled', { native: { isCorpusExportEnabled: () => false, getInboxCorpusPage: async () => [] } }],
    ['Android native module missing', { native: null }],
    ['Android native page reader missing', { native: { isCorpusExportEnabled: () => true } }],
    ['Android native capability throws', { native: { isCorpusExportEnabled: () => { throw new Error('missing_native'); } } }],
    ['iOS with both flags enabled', { platform: 'ios' }],
    ['web with both flags enabled', { platform: 'web' }],
  ]) {
    const disabled = loadAdapter(config);
    let backupReads = 0;
    ok(`${name} hides personal export`, disabled.api.isSmsCorpusExportAvailable() === false);
    await rejects(`${name} rejects direct personal export`, () => disabled.api.sharePersonalDataForReview({
      ...fullExportOptions,
      getBackup: () => { backupReads += 1; return '{}'; },
    }), 'sms_corpus_export_unavailable');
    ok(`${name} never collects or shares data`,
      disabled.reads.length === 0 && disabled.shared.length === 0 && backupReads === 0);
  }

  const rawRows = [
    { id: 3, address: 'ENBD', body: 'AED 45.75 at CARREFOUR\nRef "90881723004"', date: 1_800_000_000_003 },
    { id: 2, address: '+971501234567', body: 'Your OTP is 458213. Do not share.', date: 1_800_000_000_002 },
    { id: 1, address: 'أحمد', body: 'Dinner at eight. مرحبا 👋', date: 1_800_000_000_001 },
  ];
  const savedBackup = {
    version: 1,
    transactions: [{ id: 'saved-transaction', merchant: 'CARREFOUR', amount: 45.75, category: 'groceries', categorySource: 'user' }],
    accounts: [{ id: 'saved-account', last4: '3644' }],
    categoryRules: [{ merchant: 'CARREFOUR', category: 'groceries' }],
  };
  const personal = loadAdapter({ readPage: async () => rawRows });
  const personalProgress = [];
  const personalShouldContinue = () => true;
  ok('personal export is available only when Android and both gates agree',
    personal.api.isSmsCorpusExportAvailable() === true);
  await personal.api.sharePersonalDataForReview({
    getBackup: () => JSON.stringify(savedBackup),
    shouldContinue: personalShouldContinue,
    onProgress: (count) => personalProgress.push(count),
    dialogTitle: 'Export my data for review',
  });
  const personalDocument = JSON.parse(personal.shared[0][1]);
  ok('personal review file explicitly identifies the complete received inbox',
    personalDocument.schema === 'wafra-personal-review-v1' &&
      personalDocument.sms.scope === 'all-received' &&
      Number.isFinite(Date.parse(personalDocument.exportedAt)));
  ok('personal review preserves exact bank, security and personal SMS content',
    JSON.stringify(personalDocument.sms.messages) === JSON.stringify(rawRows.map((row) => ({
      sender: row.address, body: row.body, receivedAtMs: row.date,
    }))));
  ok('personal review includes saved categories, corrections and app backup without flattening',
    JSON.stringify(personalDocument.backup) === JSON.stringify(savedBackup));
  ok('personal review forwards collection progress and shares one local JSON file',
    JSON.stringify(personalProgress) === '[3]' && personal.shared.length === 1 &&
      /^wafra-personal-review-\d{4}-\d{2}-\d{2}\.json$/.test(personal.shared[0][0]) &&
      personal.shared[0][2].mimeType === 'application/json' &&
      personal.shared[0][2].dialogTitle === 'Export my data for review');
  ok('personal review keeps cancellation active through the final file-share boundary',
    personal.shared[0][2].shouldContinue === personalShouldContinue);

  for (const stage of ['before-read', 'during-read', 'after-progress', 'after-backup']) {
    let active = stage !== 'before-read';
    let backupReads = 0;
    const cancelled = loadAdapter({ readPage: async () => {
      if (stage === 'during-read') active = false;
      return rawRows;
    } });
    await rejects(`personal export cancels ${stage}`, () => cancelled.api.sharePersonalDataForReview({
      shouldContinue: () => active,
      onProgress: () => { if (stage === 'after-progress') active = false; },
      getBackup: () => {
        backupReads += 1;
        if (stage === 'after-backup') active = false;
        return JSON.stringify(savedBackup);
      },
    }), 'sms_corpus_cancelled');
    ok(`personal export shares no file when cancelled ${stage}`,
      cancelled.shared.length === 0 &&
        (stage !== 'before-read' || cancelled.reads.length === 0) &&
        (stage === 'after-backup' || backupReads === 0));
  }

  let successfulPages = 0;
  const readFailure = loadAdapter({ readPage: async () => {
    if (successfulPages++ === 0) return sameTimestamp.slice(0, 500);
    throw new Error('sms_permission_lost');
  } });
  await rejects('permission loss after a successful inbox page aborts personal export',
    () => readFailure.api.sharePersonalDataForReview(fullExportOptions), 'sms_permission_lost');
  ok('native inbox failure shares no partial personal file',
    readFailure.reads.length === 2 && readFailure.shared.length === 0);
  const malformedBackup = loadAdapter();
  await rejects('malformed app backup aborts personal export', async () => {
    try {
      await malformedBackup.api.sharePersonalDataForReview({ ...fullExportOptions, getBackup: () => '{' });
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error('invalid_backup');
      throw error;
    }
  }, 'invalid_backup');
  ok('malformed app backup is never shared', malformedBackup.shared.length === 0);
  const settings = fs.readFileSync(path.join(root, 'src/app/settings.tsx'), 'utf8');
  const githubBuild = fs.readFileSync(path.join(
    root,
    '.github/workflows/build-apk.yml',
  ), 'utf8');
  const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8'));

  ok('native raw access is compiled closed without the private build flag',
    /BuildConfig\.WAFRA_SMS_CORPUS_EXPORT/.test(native) &&
      /buildConfigField 'boolean', 'WAFRA_SMS_CORPUS_EXPORT'/.test(gradle));
  ok('the corpus query uses a lossless date and row-id cursor',
    /Telephony\.Sms\._ID/.test(native) &&
      /DATE} = \? AND \$\{Telephony\.Sms\._ID} < \?/.test(native) &&
      /DATE} DESC, \$\{Telephony\.Sms\._ID} DESC/.test(native));
  ok('the temporary raw path does not reuse the normal sensitive-message filter',
    !/getInboxCorpusPage[\s\S]{0,3000}SensitiveMessageFilter\.shouldReject/.test(native));
  ok('permission loss fails the export instead of sharing a partial corpus',
    /getInboxCorpusPage[\s\S]{0,5000}catch \(error: SecurityException\)[\s\S]{0,500}throw IllegalStateException/.test(native));
  ok('a missing provider cursor fails instead of sharing a partial corpus',
    /SMS inbox query returned no cursor/.test(native));
  ok('a later app start deliberately erases previous plaintext corpus files',
    /OnCreate[\s\S]{0,1000}clearStaleCorpusFiles\(context\)/.test(native) &&
      /startsWith\("wafra-sms-corpus-"\)/.test(native) &&
      /\.all \{ it\.delete\(\) \}/.test(native));
  ok('JavaScript also requires the explicit flag and native capability',
    /EXPO_PUBLIC_WAFRA_SMS_CORPUS_EXPORT === '1'/.test(adapter) &&
      /isCorpusExportEnabled\?\.\(\) === true/.test(adapter));
  ok('the exporter has no upload or network transport',
    /shareTextFile/.test(adapter) &&
      /@\/lib\/share-text/.test(adapter) &&
      !/\bfetch\s*\(|XMLHttpRequest|uploadAsync|feedback-transport|relay/i.test(adapter));
  ok('the full corpus never falls back to an Android intent text payload',
    !/Share\.share\s*\(/.test(adapter));
  ok('Settings exposes personal review only through its internal-build availability gate',
    /\{isSmsCorpusExportAvailable\(\) && \(/.test(settings) &&
      /sharePersonalDataForReview\(/.test(settings) &&
      /personalReviewExportTitle/.test(settings) &&
      /onPress=\{confirmPersonalReviewExport\}/.test(settings) &&
      /disabled=\{personalReviewBusy \|\| state\.privateMode\}/.test(settings));
  const ordinaryProfiles = Object.entries(eas.build)
    .filter(([name]) => name !== 'corpus-preview');
  ok('only the dedicated internal APK profile enables both corpus gates',
    eas.build['corpus-preview']?.distribution === 'internal' &&
      eas.build['corpus-preview']?.android?.buildType === 'apk' &&
      eas.build['corpus-preview']?.env?.EXPO_PUBLIC_WAFRA_SMS_CORPUS_EXPORT === '1' &&
      eas.build['corpus-preview']?.env?.WAFRA_SMS_CORPUS_EXPORT === '1' &&
      ordinaryProfiles.every(([, profile]) =>
        profile.env?.EXPO_PUBLIC_WAFRA_SMS_CORPUS_EXPORT === '0' &&
        profile.env?.WAFRA_SMS_CORPUS_EXPORT === '0'));
  ok('GitHub requires an explicit manual corpus input and labels its artifact',
    /workflow_dispatch:[\s\S]{0,500}corpus:[\s\S]{0,200}type: boolean/.test(githubBuild) &&
      /EXPO_PUBLIC_WAFRA_SMS_CORPUS_EXPORT: \$\{\{ github\.event\.inputs\.corpus == 'true' && '1' \|\| '0' \}\}/.test(githubBuild) &&
      /WAFRA_SMS_CORPUS_EXPORT: \$\{\{ github\.event\.inputs\.corpus == 'true' && '1' \|\| '0' \}\}/.test(githubBuild) &&
      /github\.event\.inputs\.corpus == 'true' && 'wafra-sms-corpus-apk' \|\| 'wafra-apk'/.test(githubBuild));
  ok('the manual corpus artifact targets the phone CPU architecture',
    /CORPUS_BUILD[\s\S]{0,500}reactNativeArchitectures=arm64-v8a/.test(githubBuild));
  ok('a manual corpus build never spends time producing a Play bundle',
    (githubBuild.match(/github\.event\.inputs\.corpus != 'true'/g) ?? []).length === 2);

  console.log(`\nsms-corpus: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
