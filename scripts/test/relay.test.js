const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function executeTypeScript(filename, requireModule) {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const loaded = { exports: {} };
  Function('require', 'module', 'exports', '__filename', '__dirname', output)(
    requireModule,
    loaded,
    loaded.exports,
    filename,
    path.dirname(filename),
  );
  return loaded.exports;
}

const root = path.join(__dirname, '../..');
const relayProtocol = executeTypeScript(
  path.join(root, 'src/lib/relay-protocol.ts'),
  (id) => { throw new Error(`unexpected relay-protocol dependency ${id}`); },
);
const {
  RELAY_SHORTCUT_NAME,
  RELAY_TEST_MESSAGE,
  isRelayTestPayload,
  shortcutSetupCode,
  shortcutTestUrl,
} = relayProtocol;

let pass = 0;
let fail = 0;

function ok(name, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`✓ ${name}`);
  } else {
    fail += 1;
    console.log(`✗ ${name}${detail ? ` · ${detail}` : ''}`);
  }
}

const setup = JSON.parse(shortcutSetupCode('https://relay.example/v1/ingest', 'secret-token'));
ok(
  'shortcut: setup is one versioned JSON paste',
  setup.v === 1 &&
    setup.url === 'https://relay.example/v1/ingest' &&
    setup.token === 'secret-token',
);

const runUrl = new URL(shortcutTestUrl());
ok('shortcut: test opens Apple Shortcuts', runUrl.protocol === 'shortcuts:');
ok(
  'shortcut: test targets the stable Shortcut name',
  runUrl.searchParams.get('name') === RELAY_SHORTCUT_NAME,
);
ok(
  'shortcut: test carries the non-financial protocol marker',
  runUrl.searchParams.get('text') === RELAY_TEST_MESSAGE,
);
ok('relay: exact test payload is recognized', isRelayTestPayload({ relayTest: true }));
ok('relay: truthy lookalikes are not test payloads', !isRelayTestPayload({ relayTest: 1 }));

/** Execute relay.ts itself with platform imports replaced by inert doubles. */
function loadRelayValidation() {
  const filename = path.join(root, 'src/lib/relay.ts');
  const modules = {
    'react-native': { Platform: { OS: 'ios' } },
    'expo-secure-store': {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked',
      AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'after-first-unlock',
    },
    '@/lib/relay-crypto': {
      b64decode: () => new Uint8Array(32),
      openSealed: () => null,
      generateKeypair: () => ({ publicKey: '', privateKey: '' }),
    },
    '@/lib/relay-protocol': { isRelayTestPayload },
    '@/lib/trusted-device-contract': {
      parseTrustedDevices: () => null,
      validTrustedDeviceName: () => true,
    },
  };
  return executeTypeScript(
    filename,
    (id) => {
      if (Object.hasOwn(modules, id)) return modules[id];
      throw new Error(`unexpected relay dependency ${id}`);
    },
  );
}

const relay = loadRelayValidation();
const row = {
  kind: 'transaction',
  type: 'expense',
  merchant: 'Coffee shop',
  amountFils: 2500,
  currency: 'AED',
  date: '2026-08-03',
  dueDay: null,
  minDueFils: null,
  card: { last4: '1234', kind: 'debit' },
  reference: null,
  transferHint: false,
  snapshotFils: null,
  snapshotKind: null,
  categoryGuess: 'dining',
  categoryDeliberate: true,
  sender: 'EmiratesNBD',
  receivedAt: '2026-08-03T09:10:11.000Z',
  captureSource: 'shortcut',
};
ok('relay: structured English and Arabic sender labels are accepted',
  relay.validRelaySender(row.sender) && relay.validRelaySender('بنك أبوظبي الأول'));
ok('relay: sender remains optional for the plain-text manual Shortcut test',
  relay.validRelaySender(undefined) && relay.isParsedRelayRow({ ...row, sender: undefined }));
ok('relay: sender rejects padding, multiline/control text, bidi overrides and oversized labels',
  !relay.validRelaySender(' EmiratesNBD') &&
    !relay.validRelaySender('ENBD\nFAB') &&
    !relay.validRelaySender(`ENBD\u202E${'x'.repeat(5)}`) &&
    !relay.validRelaySender('x'.repeat(81)));
ok('relay: a valid sender survives conversion into ScannedSms',
  relay.isParsedRelayRow(row) &&
    relay.relayRowToScannedSms(row).sender === row.sender &&
    relay.relayRowToScannedSms(row).smsTs === Date.parse(row.receivedAt) &&
    relay.relayRowToScannedSms(row).receivedAt === undefined &&
    !('raw' in relay.relayRowToScannedSms(row)));
ok('relay: an invalid sender invalidates the sealed structured row',
  !relay.isParsedRelayRow({ ...row, sender: 'ENBD\nforged' }));
ok('relay: a legitimate rawless structured row is accepted',
  !('raw' in row) && relay.isParsedRelayRow(row));
ok('relay: raw Message Content is forbidden even when empty',
  !relay.isParsedRelayRow({ ...row, raw: 'full bank SMS' }) &&
    !relay.isParsedRelayRow({ ...row, raw: '' }) &&
    !relay.isParsedRelayRow({ ...row, raw: undefined }));
const paymentRow = {
  ...row,
  kind: 'cardPayment',
  merchant: 'Card •1234 payment',
  card: { last4: '1234', kind: 'credit' },
  transferHint: true,
  categoryGuess: 'other',
};
ok('relay: card-payment side accepts only the two accounting values',
  relay.isParsedRelayRow({ ...paymentRow, cardPaymentSide: undefined }) &&
    relay.isParsedRelayRow({ ...paymentRow, cardPaymentSide: 'debit' }) &&
    relay.isParsedRelayRow({ ...paymentRow, cardPaymentSide: 'receipt' }) &&
    !relay.isParsedRelayRow({ ...paymentRow, cardPaymentSide: 'forged' }) &&
    !relay.isParsedRelayRow({ ...row, cardPaymentSide: 'debit' }));

ok('relay: every required parser field must be present',
  [
    'kind', 'type', 'amountFils', 'currency', 'merchant', 'date', 'dueDay',
    'minDueFils', 'card', 'reference', 'transferHint', 'snapshotFils',
    'snapshotKind', 'categoryGuess',
  ].every((field) => {
    const incomplete = { ...row };
    delete incomplete[field];
    return !relay.isParsedRelayRow(incomplete);
  }));
ok('relay: money, currency, category and snapshot values fail closed',
  !relay.isParsedRelayRow({ ...row, amountFils: 0 }) &&
    !relay.isParsedRelayRow({ ...row, amountFils: -1 }) &&
    !relay.isParsedRelayRow({ ...row, amountFils: 1.5 }) &&
    !relay.isParsedRelayRow({ ...row, currency: 'aed' }) &&
    !relay.isParsedRelayRow({ ...row, currency: 'AED 100' }) &&
    !relay.isParsedRelayRow({ ...row, categoryGuess: 'forged' }) &&
    !relay.isParsedRelayRow({ ...row, snapshotFils: 5000, snapshotKind: null }) &&
    !relay.isParsedRelayRow({ ...row, snapshotFils: null, snapshotKind: 'balance' }) &&
    !relay.isParsedRelayRow({ ...row, snapshotFils: 5000, snapshotKind: 'forged' }));
ok('relay: card identity and kind are validated structurally',
  !relay.isParsedRelayRow({ ...row, card: { last4: '123', kind: 'debit' } }) &&
    !relay.isParsedRelayRow({ ...row, card: { last4: '1234', kind: 'forged' } }) &&
    !relay.isParsedRelayRow({ ...row, card: { kind: 'debit' } }) &&
    !relay.isParsedRelayRow({ ...paymentRow, card: null }) &&
    !relay.isParsedRelayRow({ ...paymentRow, card: { last4: '1234', kind: 'debit' } }));
const statementRow = {
  ...row,
  kind: 'cardStatement',
  merchant: 'Credit card statement',
  dueDay: 3,
  minDueFils: 500,
  card: null,
  categoryGuess: 'other',
};
ok('relay: a complete no-PAN card statement remains valid for sender-bank resolution',
  relay.isParsedRelayRow(statementRow) &&
    relay.isParsedRelayRow({ ...statementRow, card: { last4: '1234', kind: 'credit' } }));
ok('relay: kind-specific due, card and transfer invariants fail closed',
  !relay.isParsedRelayRow({ ...row, dueDay: 3 }) &&
    !relay.isParsedRelayRow({ ...statementRow, dueDay: 4 }) &&
    !relay.isParsedRelayRow({ ...statementRow, card: { last4: '1234', kind: 'debit' } }) &&
    !relay.isParsedRelayRow({ ...statementRow, transferHint: true }) &&
    !relay.isParsedRelayRow({ ...paymentRow, transferHint: false }) &&
    !relay.isParsedRelayRow({ ...paymentRow, minDueFils: 500 }) &&
    !relay.isParsedRelayRow({ ...row, kind: 'billDue', dueDay: 3, transferHint: true }));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
