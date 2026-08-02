const {
  RELAY_SHORTCUT_NAME,
  RELAY_TEST_MESSAGE,
  isRelayTestPayload,
  shortcutSetupCode,
  shortcutTestUrl,
} = require('./build/relay-protocol');

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
