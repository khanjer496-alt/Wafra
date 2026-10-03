'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');

function reader(os, fileSystem = {}) {
  return load(path.resolve(__dirname, '../../../src/lib/share-text.ts'), {
    'expo-clipboard': {}, 'expo-sharing': {},
    'expo-file-system/legacy': fileSystem,
    'react-native': { Platform: { OS: os } },
  }, { URL }).readBackupPickerCopy;
}

test('web reads the selected local File without a native filesystem or network request', async () => {
  const contents = JSON.stringify({ app: 'wafra', data: { title: 'قهوة', amountFils: 1234 } });
  const selected = new File([contents], 'wafra-backup.json', { type: 'application/json' });
  const uri = URL.createObjectURL(selected);
  const read = reader('web', { readAsStringAsync: () => { throw new Error('native filesystem unavailable on web'); } });
  assert.equal(await read(uri, selected), contents);
  await assert.rejects(fetch(uri), 'the consumed picker blob is released');
});

test('web rejects a missing selected File rather than fetching an arbitrary URI', async () => {
  const read = reader('web');
  await assert.rejects(read('https://example.invalid/backup.json'), /selected backup file/i);
});

test('web propagates a failed local read and releases the picker blob', async () => {
  const uri = URL.createObjectURL(new Blob(['invalid']));
  await assert.rejects(reader('web')(uri, { text: async () => { throw new Error('read failed'); } }), /read failed/);
  await assert.rejects(fetch(uri));
});

test('native reads and removes only the owned picker cache copy', async () => {
  const events = [];
  const read = reader('ios', {
    cacheDirectory: 'file:///cache/',
    readAsStringAsync: async uri => { events.push(['read', uri]); return 'backup'; },
    deleteAsync: async uri => events.push(['delete', uri]),
  });
  const local = 'file:///cache/DocumentPicker/backup.json';
  assert.equal(await read(local, { text: () => { throw new Error('web only'); } }), 'backup');
  const external = 'file:///Documents/backup.json';
  assert.equal(await read(external), 'backup');
  assert.deepEqual(events, [['read', local], ['delete', local], ['read', external]]);
});
