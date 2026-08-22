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
    /FileSystem\.writeAsStringAsync/.test(adapter) &&
      /Sharing\.shareAsync/.test(adapter) &&
      !/\bfetch\s*\(|XMLHttpRequest|uploadAsync|feedback-transport|relay/i.test(adapter));
  ok('the full corpus never falls back to an Android intent text payload',
    !/Share\.share\s*\(/.test(adapter));
  ok('the raw full-inbox share control is no longer exposed in Settings',
    !/isSmsCorpusExportAvailable|shareSmsCorpus|smsCorpusExportTitle/.test(settings));
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
