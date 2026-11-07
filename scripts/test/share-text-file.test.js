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

const load = ({ os, fileSystem = {}, sharing = {}, clipboard = {}, share = {} }) => {
  const loaded = { exports: {} };
  const requireModule = (id) => {
    if (id === 'expo-file-system/legacy') return { makeDirectoryAsync: async () => {}, deleteAsync: async () => {},
      getInfoAsync: async () => ({ exists: false }), readDirectoryAsync: async () => [], ...fileSystem };
    if (id === 'expo-sharing') return sharing;
    if (id === 'expo-clipboard') return clipboard;
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
  const clipboardWrites = [];
  let plainTextShares = 0;
  const nativeModule = load({
    os: 'android',
    clipboard: {
      setStringAsync: async (value) => { clipboardWrites.push(value); },
    },
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
    writes.length === 1 && writes[0][0].startsWith('file:///cache/wafra-generated-exports/') && writes[0][0].endsWith('/wafra-parser-report.json') &&
      writes[0][1] === '{"safe":true}' && writes[0][2]?.encoding === 'utf8' &&
      shares.length === 1 && shares[0][0] === writes[0][0] &&
      shares[0][1]?.mimeType === 'application/json' && shares[0][1]?.UTI === 'public.json' &&
      plainTextShares === 0);

  const iosShares = [];
  const iosModule = load({
    os: 'ios',
    fileSystem: {
      cacheDirectory: 'file:///cache/', EncodingType: { UTF8: 'utf8' },
      writeAsStringAsync: async () => {},
    },
    sharing: {
      isAvailableAsync: async () => true,
      shareAsync: async (...args) => { iosShares.push(args); },
    },
  });
  for (const [filename, mimeType, uti] of [
    ['transactions.csv', 'text/csv', 'public.comma-separated-values-text'],
    ['backup.json', 'application/json', 'public.json'],
    ['notes.txt', 'text/plain', 'public.plain-text'],
  ]) {
    await iosModule.shareTextFile(filename, 'synthetic contents', { mimeType });
    const [uri, options] = iosShares.at(-1);
    ok(`iOS ${mimeType} advertises its matching document type`,
      uri.endsWith(`/${filename}`) && options.mimeType === mimeType && options.UTI === uti);
  }

  for (const cancellation of ['before-start', 'during-availability', 'during-directory', 'during-write']) {
    let allowed = cancellation !== 'before-start';
    const created = []; const deleted = []; const files = []; const delivered = [];
    const guardedModule = load({
      os: 'android',
      fileSystem: {
        cacheDirectory: 'file:///cache/', EncodingType: { UTF8: 'utf8' },
        makeDirectoryAsync: async uri => {
          created.push(uri);
          if (cancellation === 'during-directory') allowed = false;
        },
        writeAsStringAsync: async uri => {
          files.push(uri);
          if (cancellation === 'during-write') allowed = false;
        },
        deleteAsync: async uri => { deleted.push(uri); },
      },
      sharing: {
        isAvailableAsync: async () => {
          if (cancellation === 'during-availability') allowed = false;
          return true;
        },
        shareAsync: async uri => { delivered.push(uri); },
      },
    });
    let failure;
    await guardedModule.shareTextFile('wafra-personal-review-2026-09-08.json', '{"personal":true}', {
      mimeType: 'application/json', shouldContinue: () => allowed,
    }).catch(error => { failure = error; });
    ok(`withdrawn export consent ${cancellation} never opens a share sheet`,
      failure?.name === 'TextFileShareError' && delivered.length === 0);
    ok(`withdrawn export consent ${cancellation} leaves no owned plaintext file`,
      cancellation === 'during-write'
        ? files.length === 1 && created.length === 1 && deleted.includes(created[0])
        : cancellation === 'during-directory'
          ? files.length === 0 && created.length === 1 && deleted.includes(created[0])
          : files.length === 0 && created.length === 0);
  }
  if (typeof nativeModule.copyTextToClipboard === 'function') {
    await nativeModule.copyTextToClipboard('{"safe":true}');
  }
  ok('clipboard export copies the exact already-redacted report text',
    clipboardWrites.length === 1 && clipboardWrites[0] === '{"safe":true}');
  let oversizedClipboard = null;
  await nativeModule.copyTextToClipboard?.('x'.repeat(128 * 1024 + 1)).catch((error) => {
    oversizedClipboard = error;
  });
  ok('an oversized report is refused before Android receives a clipboard payload',
    oversizedClipboard?.name === 'TextClipboardError' &&
      oversizedClipboard?.code === 'too_large' && clipboardWrites.length === 1,
    String(oversizedClipboard));

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

  // A completed iOS sheet no longer needs the app's plaintext temporary file.
  {
    const files = new Map();
    const deleted = [];
    let finishShare;
    const pendingShare = new Promise((resolve) => { finishShare = resolve; });
    const module = load({ os: 'ios', fileSystem: {
      cacheDirectory: 'file:///cache/', EncodingType: { UTF8: 'utf8' },
      makeDirectoryAsync: async () => {},
      writeAsStringAsync: async (uri, body) => { files.set(uri, body); },
      deleteAsync: async (uri) => { deleted.push(uri); for (const key of files.keys()) if (key === uri || key.startsWith(uri + '/')) files.delete(key); },
      readDirectoryAsync: async () => [],
      getInfoAsync: async () => ({ exists: true, modificationTime: Date.now() / 1000 }),
    }, sharing: { isAvailableAsync: async () => true, shareAsync: () => pendingShare } });
    const sharing = module.shareTextFile('wafra-backup.json', '{"private":true}');
    await new Promise((resolve) => setImmediate(resolve));
    ok('active share keeps its readable attachment', files.size === 1 && deleted.length === 0);
    finishShare();
    await sharing;
    ok('completed or canceled iOS share deletes its plaintext attachment', files.size === 0 && deleted.length > 0);
  }
  {
    const deleted = [];
    const module = load({ os: 'android', fileSystem: {
      cacheDirectory: 'file:///cache/',
      readDirectoryAsync: async (uri) => uri.endsWith('wafra-generated-exports/') ? ['old', 'fresh'] : ['wafra-sms-corpus-2026-09-05.json', 'wafra-sms-corpus-private-copy.json'],
      getInfoAsync: async (uri) => ({ exists: true,
        modificationTime: (Date.now() - (uri.endsWith('old') ? 48 * 3600000 : 0)) / 1000 }),
      deleteAsync: async (uri) => { deleted.push(uri); },
    } });
    await module.cleanupGeneratedExports?.();
    ok('startup cleanup removes stale generated exports but preserves recent Android attachments',
      deleted.some((uri) => uri.endsWith('/old')) && !deleted.some((uri) => uri.endsWith('/fresh')));
    deleted.length = 0;
    await module.cleanupGeneratedExports?.({ eraseAll: true });
    ok('explicit erase removes generated exports and known legacy backups only',
      deleted.includes('file:///cache/wafra-generated-exports/fresh') &&
      deleted.includes('file:///cache/wafra-backup.json') &&
      deleted.includes('file:///cache/wafra-sms-corpus-2026-09-05.json') &&
      !deleted.includes('file:///cache/wafra-sms-corpus-private-copy.json') &&
      !deleted.includes('file:///cache/'));
  }

  {
    const deleted = [];
    const module = load({ os: 'ios', fileSystem: {
      cacheDirectory: 'file:///cache/',
      readAsStringAsync: async (uri) => { if (uri.endsWith('broken.json')) throw new Error('read failed'); return 'backup'; },
      deleteAsync: async (uri) => { deleted.push(uri); },
    } });
    const content = await module.readBackupPickerCopy?.('file:///cache/DocumentPicker/backup.json');
    ok('reading a backup removes its app-owned picker copy before confirmation or cancellation',
      content === 'backup' && deleted.includes('file:///cache/DocumentPicker/backup.json'));
    try { await module.readBackupPickerCopy?.('file:///cache/DocumentPicker/broken.json'); } catch {}
    ok('a failed backup read also removes its app-owned picker copy',
      deleted.includes('file:///cache/DocumentPicker/broken.json'));
    for (const uri of ['file:///Documents/original.json', 'content://provider/original.json', 'file:///cache/%2e%2e/Documents/original.json']) {
      await module.readBackupPickerCopy?.(uri);
      ok(`backup cleanup preserves external original ${uri}`, !deleted.includes(uri));
    }
  }

  // Expo Print writes UUID PDFs to its own cache folder, outside text exports.
  {
    const old = '11111111-1111-4111-8111-111111111111.pdf';
    const fresh = '22222222-2222-4222-8222-222222222222.pdf';
    const deleted = [];
    const module = load({ os: 'android', fileSystem: {
      cacheDirectory: 'file:///cache/',
      readDirectoryAsync: async uri => uri === 'file:///cache/Print/' ? [old, fresh, 'keep.pdf', '../other.pdf'] : [],
      getInfoAsync: async uri => ({ exists: true, modificationTime: (Date.now() - (uri.endsWith(old) ? 48 * 3600000 : 0)) / 1000 }),
      deleteAsync: async uri => { deleted.push(uri); },
    } });
    await module.cleanupGeneratedExports();
    ok('stale Expo Print PDFs are cleaned without deleting recent attachments',
      deleted.includes(`file:///cache/Print/${old}`) && !deleted.includes(`file:///cache/Print/${fresh}`));
    await module.cleanupGeneratedExports({ eraseAll: true });
    ok('erase includes recent Print PDFs but never unrelated names or parent paths',
      deleted.includes(`file:///cache/Print/${fresh}`) && !deleted.some(uri => /keep\.pdf|other\.pdf/.test(uri)));
  }
  {
    const uri = 'file:///cache/Print/33333333-3333-4333-8333-333333333333.pdf';
    for (const os of ['ios', 'android']) {
      const deleted = [], shares = [];
      const module = load({ os, fileSystem: { cacheDirectory: 'file:///cache/', deleteAsync: async value => { deleted.push(value); } },
        sharing: { isAvailableAsync: async () => true, shareAsync: async (...args) => { shares.push(args); } } });
      ok(`${os} has managed PDF sharing`, typeof module.shareGeneratedPdf === 'function');
      if (module.shareGeneratedPdf) {
        await module.shareGeneratedPdf(async () => ({ uri }), { dialogTitle: 'Expense report' });
        ok(`${os} PDF sharing preserves MIME and receiving-app lifetime`, shares.length === 1 &&
          shares[0][0] === uri && shares[0][1].mimeType === 'application/pdf' &&
          shares[0][1].UTI === 'com.adobe.pdf' && (os === 'ios' ? deleted.includes(uri) : deleted.length === 0));
      }
    }
    const deleted = []; let shares = 0, current = true, releasePrint;
    const module = load({ os: 'android', fileSystem: { cacheDirectory: 'file:///cache/', deleteAsync: async value => { deleted.push(value); },
      getInfoAsync: async () => ({ exists: false }), readDirectoryAsync: async () => [] },
      sharing: { isAvailableAsync: async () => true, shareAsync: async () => { shares++; } } });
    if (module.shareGeneratedPdf) {
      const pending = module.shareGeneratedPdf(() => new Promise(resolve => { releasePrint = resolve; }), { shouldContinue: () => current });
      await new Promise(resolve => setImmediate(resolve));
      let blocked = false;
      await module.cleanupGeneratedExports({ eraseAll: true }).catch(() => { blocked = true; });
      ok('erase waits while a PDF is still being generated', blocked);
      current = false; releasePrint({ uri });
      await pending.catch(() => {});
      ok('a stale PDF never opens sharing and its temporary file is deleted', shares === 0 && deleted.includes(uri));
      // A rejected generator must release its pending-export guard.
      await module.shareGeneratedPdf(async () => { throw new Error('render failed'); }).catch(() => {});
      let guardReleased = false;
      await module.cleanupGeneratedExports({ eraseAll: true }).then(() => { guardReleased = true; });
      ok('PDF rendering failure releases the in-flight erase guard', guardReleased);
    }
    for (const target of ['file:///Documents/original.pdf', 'file:///cache/Print/%2e%2e/original.pdf', 'content://provider/original.pdf']) {
      const rejected = [], sent = [];
      const module = load({ os: 'android', fileSystem: { cacheDirectory: 'file:///cache/', deleteAsync: async value => { rejected.push(value); } },
        sharing: { isAvailableAsync: async () => true, shareAsync: async value => { sent.push(value); } } });
      if (module.shareGeneratedPdf) {
        await module.shareGeneratedPdf(async () => ({ uri: target })).catch(() => {});
        ok('PDF helper never shares or deletes an external/unrecognized URI', sent.length === 0 && rejected.length === 0);
      }
    }
    for (const available of [false, true]) {
      let renders = 0; const deleted = [];
      const module = load({ os: 'android', fileSystem: {
        cacheDirectory: 'file:///cache/', deleteAsync: async value => { deleted.push(value); },
        getInfoAsync: async () => ({ exists: false }), readDirectoryAsync: async () => [],
      }, sharing: { isAvailableAsync: async () => available, shareAsync: async () => { throw new Error('share failed'); } } });
      if (module.shareGeneratedPdf) {
        await module.shareGeneratedPdf(async () => { renders++; return { uri }; }).catch(() => {});
        ok(available ? 'a failed PDF share deletes its private temporary file' : 'an unavailable share sheet never creates a PDF',
          available ? renders === 1 && deleted.includes(uri) : renders === 0 && deleted.length === 0);
        await module.cleanupGeneratedExports({ eraseAll: true });
        ok('share availability/failure leaves no in-flight PDF erase guard', true);
      }
    }
    {
      let finishShare; const deleted = [];
      const module = load({ os: 'ios', fileSystem: {
        cacheDirectory: 'file:///cache/', deleteAsync: async value => { deleted.push(value); },
        getInfoAsync: async () => ({ exists: false }), readDirectoryAsync: async () => [],
      }, sharing: { isAvailableAsync: async () => true, shareAsync: () => new Promise(resolve => { finishShare = resolve; }) } });
      if (module.shareGeneratedPdf) {
        const pending = module.shareGeneratedPdf(async () => ({ uri }));
        await new Promise(resolve => setImmediate(resolve));
        let blocked = false;
        await module.cleanupGeneratedExports({ eraseAll: true }).catch(() => { blocked = true; });
        ok('an open PDF share sheet keeps its file readable and blocks erase completion', blocked && deleted.length === 0);
        finishShare(); await pending;
        await module.cleanupGeneratedExports({ eraseAll: true });
        ok('closing the PDF share sheet deletes the iOS file and permits erase cleanup', deleted.includes(uri));
      }
    }
  }

  {
    let releaseInfo, enteredInfo; let first = true, renders = 0, writes = 0;
    const entered = new Promise(resolve => { enteredInfo = resolve; });
    const module = load({ os: 'android', fileSystem: {
      cacheDirectory: 'file:///cache/', EncodingType: { UTF8: 'utf8' },
      getInfoAsync: async () => {
        if (first) { first = false; enteredInfo(); await new Promise(resolve => { releaseInfo = resolve; }); }
        return { exists: false };
      },
      writeAsStringAsync: async () => { writes++; },
    }, sharing: { isAvailableAsync: async () => true, shareAsync: async () => {} } });
    const cleanup = module.cleanupGeneratedExports({ eraseAll: true }); await entered;
    let pdfRejected = false, textRejected = false;
    await module.shareGeneratedPdf(async () => { renders++; return { uri: 'unused' }; }).catch(() => { pdfRejected = true; });
    await module.shareTextFile('wafra-export.csv', 'private').catch(() => { textRejected = true; });
    ok('erase claims export admission before its first filesystem await', pdfRejected && textRejected && renders === 0 && writes === 0);
    releaseInfo(); await cleanup;
    await module.shareGeneratedPdf(async () => ({ uri: 'file:///cache/Print/44444444-4444-4444-8444-444444444444.pdf' }));
    ok('completed erase cleanup releases its export admission claim', true);
  }
  {
    let releaseAvailability, enteredAvailability;
    const entered = new Promise(resolve => { enteredAvailability = resolve; });
    const module = load({ os: 'android', fileSystem: {
      cacheDirectory: 'file:///cache/', EncodingType: { UTF8: 'utf8' }, writeAsStringAsync: async () => {},
    }, sharing: { isAvailableAsync: async () => { enteredAvailability(); return new Promise(resolve => { releaseAvailability = resolve; }); },
      shareAsync: async () => {} } });
    const pending = module.shareTextFile('wafra-backup.json', '{}'); await entered;
    let rejected = false;
    await module.cleanupGeneratedExports({ eraseAll: true }).catch(() => { rejected = true; });
    ok('text sharing also blocks erase while native availability is pending', rejected);
    releaseAvailability(true); await pending;
    await module.cleanupGeneratedExports({ eraseAll: true });
    ok('completed text preflight releases its erase guard', true);
  }
  {
    const old = '55555555-5555-4555-8555-555555555555.pdf', partial = '66666666-6666-4666-8666-666666666666.pdf';
    const names = new Set([old]); const deleted = [];
    const module = load({ os: 'android', fileSystem: { cacheDirectory: 'file:///cache/',
      getInfoAsync: async uri => ({ exists: uri === 'file:///cache/Print/' }),
      readDirectoryAsync: async uri => uri === 'file:///cache/Print/' ? [...names] : [],
      deleteAsync: async uri => { deleted.push(uri); names.delete(uri.split('/').pop()); },
    }, sharing: { isAvailableAsync: async () => true, shareAsync: async () => {} } });
    await module.shareGeneratedPdf(async () => { names.add(partial); throw new Error('native render failed after creating a file'); }).catch(() => {});
    ok('native render rejection cleans new orphan PDFs without deleting previous exports',
      !names.has(partial) && names.has(old) && deleted.length === 1);
  }
  {
    // Execute the screen's actual handlers against an authoritative store that
    // differs from its last React render; no component/source-regex assertion.
    const screen = ts.createSourceFile('settings-data.tsx', fs.readFileSync(path.join(root, 'src/app/settings-data.tsx'), 'utf8'),
      ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const handler = (name, env) => {
      let initializer;
      const visit = node => { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) initializer = node.initializer;
        ts.forEachChild(node, visit); };
      visit(screen); if (!initializer) throw new Error('Missing export handler ' + name);
      const compiled = ts.transpileModule('module.exports = ' + initializer.getText(screen),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
      const module = { exports: {} }; Function('module', ...Object.keys(env), compiled)(module, ...Object.values(env)); return module.exports;
    };
    let generation = 1, snapshot = { hydrated: true, transactions: [{ id: 'current', date: '2026-11-07' }], accounts: [],
      ledgerMoney: { currency: 'AED', exponent: 2 }, language: 'en' };
    const shares = []; let csvRows, pdfRows, pdfOptions, printed = 0;
    const env = { getStateSnapshot: () => snapshot, getStateGeneration: () => generation,
      state: { transactions: [{ id: 'stale' }] }, buildLedgerCsv: rows => { csvRows = rows; return 'csv'; },
      exportBackup: () => JSON.stringify(snapshot), shareTextFile: async (...args) => { shares.push(args); },
      liveAccountIds: () => new Set(), internalTransferIdsForState: () => new Set(), isSpending: () => true,
      monthKey: () => '2026-11', monthStartISO: () => '2026-11-01', monthEndISO: () => '2026-11-30',
      reportExpenses: rows => rows, buildExpenseReportHtml: options => { pdfRows = options.transactions; return '<html>'; },
      marketCurrencyCode: () => 'AED', displayRegion: () => 'AE', Platform: { OS: 'android' },
      Print: { printToFileAsync: async () => { printed++; return { uri: 'pdf' }; } },
      shareGeneratedPdf: async (create, options) => { pdfOptions = options; await create(); },
      TextFileShareError: class extends Error {}, Alert: { alert: () => {} }, t: key => key,
    };
    const csv = handler('exportCsv', env), backup = handler('backupJson', env), pdf = handler('createExpenseReport', env);
    csv(); backup(); await pdf('all');
    ok('CSV and PDF use the current authoritative snapshot rather than a stale render', csvRows === snapshot.transactions && pdfRows === snapshot.transactions);
    ok('all public file exports retain a generation check until sharing', shares.length === 2 && shares.every(args => args[2].shouldContinue()) && pdfOptions.shouldContinue());
    generation++;
    ok('a restore or erase invalidates every pending public file export', shares.every(args => !args[2].shouldContinue()) && !pdfOptions.shouldContinue());
    snapshot = { ...snapshot, hydrated: false }; const previousPrints = printed;
    csv(); backup(); await pdf('all');
    ok('an unhydrated/erasing store cannot start a public file export', shares.length === 2 && printed === previousPrints);
    snapshot.hydrated = true; env.Platform.OS = 'web'; pdfOptions = null; await pdf('all');
    ok('web expense reports retain the browser print path', printed === previousPrints + 1 && pdfOptions === null);
  }

  console.log(`\nshare-text-file: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
