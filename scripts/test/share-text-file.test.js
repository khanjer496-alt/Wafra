const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

let pass = 0;
let fail = 0;
const ok = (name, condition, detail = '') => {
  if (condition) {
    pass += 1;
    console.log(`✓ ${name}`);
    return;
  }
  fail += 1;
  console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
};

const root = path.join(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'src/lib/share-text.ts'), 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;

const load = ({ os, fileSystem = {}, sharing = {}, share = {} }) => {
  const loaded = { exports: {} };
  const requireModule = (id) => {
    if (id === 'expo-file-system/legacy') return fileSystem;
    if (id === 'expo-sharing') return sharing;
    if (id === 'react-native') return { Platform: { OS: os }, Share: share };
    throw new Error(`unexpected dependency ${id}`);
  };
  Function('require', 'module', 'exports', output)(requireModule, loaded, loaded.exports);
  return loaded.exports;
};

async function main() {
  const webModule = load({ os: 'web' });
  ok('the file-only export API exists',
    typeof webModule.shareTextFile === 'function' &&
      typeof webModule.TextFileShareError === 'function');

  const priorDocument = global.document;
  const priorUrl = global.URL;
  const priorBlob = global.Blob;
  const priorSetTimeout = global.setTimeout;
  global.document = undefined;
  let webUnavailable = null;
  await webModule.shareTextFile?.('report.json', '{}').catch((error) => {
    webUnavailable = error;
  });
  ok('web without download primitives fails with a named error',
    webUnavailable?.name === 'TextFileShareError' &&
      webUnavailable?.code === 'download_unavailable',
    String(webUnavailable));
  let clicked = false;
  let revoked = '';
  let anchor = null;
  let appended = null;
  let removed = false;
  let revokeDelay = 0;
  let revokeCallback = null;
  global.Blob = class BlobFixture {
    constructor(parts, options) {
      this.parts = parts;
      this.type = options.type;
    }
  };
  global.URL = {
    createObjectURL: () => 'blob:wafra-report',
    revokeObjectURL: (value) => { revoked = value; },
  };
  global.document = {
    createElement: (name) => {
      if (name !== 'a') throw new Error(`unexpected element ${name}`);
      anchor = {
        click: () => { clicked = true; },
        remove: () => { removed = true; },
      };
      return anchor;
    },
    body: { appendChild: (node) => { appended = node; } },
  };
  global.setTimeout = (callback, delay) => {
    revokeCallback = callback;
    revokeDelay = delay;
    return 1;
  };
  try {
    if (typeof webModule.shareTextFile === 'function') {
      await webModule.shareTextFile('wafra-parser-report.json', '{"safe":true}', {
        mimeType: 'application/json',
      });
    }
  } catch (error) {
    ok('web creates a downloadable JSON file', false, String(error));
  }
  ok('web creates a downloadable JSON file',
    clicked && appended === anchor && removed &&
      anchor?.download === 'wafra-parser-report.json' &&
      anchor?.href === 'blob:wafra-report' && revoked === '' &&
      revokeDelay >= 1_000 && typeof revokeCallback === 'function');
  revokeCallback?.();
  ok('web revokes the Blob only after the download grace period',
    revoked === 'blob:wafra-report');
  global.document = priorDocument;
  global.URL = priorUrl;
  global.Blob = priorBlob;
  global.setTimeout = priorSetTimeout;

  const writes = [];
  const shares = [];
  let plainTextShares = 0;
  const nativeModule = load({
    os: 'android',
    fileSystem: {
      cacheDirectory: 'file:///cache/',
      EncodingType: { UTF8: 'utf8' },
      writeAsStringAsync: async (...args) => { writes.push(args); },
    },
    sharing: {
      isAvailableAsync: async () => true,
      shareAsync: async (...args) => { shares.push(args); },
    },
    share: { share: async () => { plainTextShares += 1; } },
  });
  await nativeModule.shareTextFile('wafra-parser-report.json', '{"safe":true}', {
    mimeType: 'application/json',
    dialogTitle: 'Export safe report',
  });
  ok('native writes the exact UTF-8 JSON and shares only its file URI',
    writes.length === 1 && writes[0][0] === 'file:///cache/wafra-parser-report.json' &&
      writes[0][1] === '{"safe":true}' && writes[0][2]?.encoding === 'utf8' &&
      shares.length === 1 && shares[0][0] === 'file:///cache/wafra-parser-report.json' &&
      shares[0][1]?.mimeType === 'application/json' && shares[0][1]?.UTI === 'public.json' &&
      plainTextShares === 0);

  const noCacheModule = load({
    os: 'android',
    fileSystem: { cacheDirectory: null, EncodingType: { UTF8: 'utf8' } },
    sharing: { isAvailableAsync: async () => true },
    share: { share: async () => { plainTextShares += 1; } },
  });
  let noCache = null;
  await noCacheModule.shareTextFile?.('report.json', '{}').catch((error) => {
    noCache = error;
  });
  ok('native missing cache fails visibly instead of sharing text',
    noCache?.name === 'TextFileShareError' && noCache?.code === 'cache_unavailable' &&
      plainTextShares === 0,
    String(noCache));

  const unavailableModule = load({
    os: 'ios',
    fileSystem: {
      cacheDirectory: 'file:///cache/',
      EncodingType: { UTF8: 'utf8' },
      writeAsStringAsync: async () => {},
    },
    sharing: { isAvailableAsync: async () => false },
    share: { share: async () => { plainTextShares += 1; } },
  });
  let unavailable = null;
  await unavailableModule.shareTextFile?.('report.json', '{}').catch((error) => {
    unavailable = error;
  });
  ok('native unavailable sharing fails visibly instead of falling back to text',
    unavailable?.name === 'TextFileShareError' && unavailable?.code === 'share_unavailable' &&
      plainTextShares === 0,
    String(unavailable));

  const availabilityFailureModule = load({
    os: 'android',
    fileSystem: { cacheDirectory: 'file:///cache/', EncodingType: { UTF8: 'utf8' } },
    sharing: { isAvailableAsync: async () => { throw new Error('native unavailable'); } },
    share: { share: async () => { plainTextShares += 1; } },
  });
  let availabilityFailure = null;
  await availabilityFailureModule.shareTextFile?.('report.json', '{}').catch((error) => {
    availabilityFailure = error;
  });
  ok('native availability failure is normalized and never leaks a raw platform error',
    availabilityFailure?.name === 'TextFileShareError' &&
      availabilityFailure?.code === 'share_unavailable' && plainTextShares === 0,
    String(availabilityFailure));

  const writeFailureModule = load({
    os: 'android',
    fileSystem: {
      cacheDirectory: 'file:///cache/',
      EncodingType: { UTF8: 'utf8' },
      writeAsStringAsync: async () => { throw new Error('disk full'); },
    },
    sharing: { isAvailableAsync: async () => true, shareAsync: async () => {} },
    share: { share: async () => { plainTextShares += 1; } },
  });
  let writeFailure = null;
  await writeFailureModule.shareTextFile?.('report.json', '{}').catch((error) => {
    writeFailure = error;
  });
  ok('native write failure is named and never degrades to a text payload',
    writeFailure?.name === 'TextFileShareError' && writeFailure?.code === 'write_failed' &&
      plainTextShares === 0,
    String(writeFailure));

  const shareFailureModule = load({
    os: 'ios',
    fileSystem: {
      cacheDirectory: 'file:///cache/',
      EncodingType: { UTF8: 'utf8' },
      writeAsStringAsync: async () => {},
    },
    sharing: {
      isAvailableAsync: async () => true,
      shareAsync: async () => { throw new Error('sheet failed'); },
    },
    share: { share: async () => { plainTextShares += 1; } },
  });
  let shareFailure = null;
  await shareFailureModule.shareTextFile?.('report.json', '{}').catch((error) => {
    shareFailure = error;
  });
  ok('native share-sheet failure is named and never degrades to text',
    shareFailure?.name === 'TextFileShareError' && shareFailure?.code === 'share_failed' &&
      plainTextShares === 0,
    String(shareFailure));

  console.log(`\nshare-text-file: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
