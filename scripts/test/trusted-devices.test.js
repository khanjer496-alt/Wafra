const {
  MAX_TRUSTED_DEVICES,
  parseTrustedDeviceInvite,
  parseTrustedDevices,
  trustedDeviceInviteLink,
  validTrustedDeviceName,
} = require('./build/trusted-device-contract');
const fs = require('fs');
const path = require('path');

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

const token = 'A'.repeat(48);
const relay = 'https://relay.wafra.example';
const link = trustedDeviceInviteLink(relay, token);
const parsedLink = parseTrustedDeviceInvite(link, null);
ok('invite link round-trips relay and one-use token',
  parsedLink?.relayUrl === relay && parsedLink?.inviteToken === token);

const inviteUrl = new URL(link);
ok('invite has only enrollment coordinates, no financial fields',
  [...inviteUrl.searchParams.keys()].sort().join(',') === 'invite,relay' &&
  !/amount|balance|merchant|account|transaction/i.test(link));

const parsedJson = parseTrustedDeviceInvite(
  JSON.stringify({ v: 1, relay, invite: token }),
  null,
);
ok('versioned JSON invite is accepted', parsedJson?.inviteToken === token);
ok('raw token needs and uses the configured relay',
  parseTrustedDeviceInvite(token, relay)?.relayUrl === relay &&
  parseTrustedDeviceInvite(token, null) === null);
ok('malformed and short invites are rejected',
  parseTrustedDeviceInvite('wafra://trusted-devices?relay=x&invite=short', relay) === null &&
  parseTrustedDeviceInvite('{"v":2}', relay) === null);

ok('Unicode device names enforce 1–40 code points',
  validTrustedDeviceName('هاتف العائلة') &&
  validTrustedDeviceName('😀'.repeat(40)) &&
  !validTrustedDeviceName('😀'.repeat(41)) &&
  !validTrustedDeviceName('bad\nname'));

const device = (index) => ({
  id: `12345678-1234-4abc-8abc-${String(index).padStart(12, '0')}`,
  name: index === 0 ? null : `Phone ${index}`,
  role: index === 0 ? 'owner' : 'member',
  isCurrent: index === 0,
  joinedAt: 1_700_000_000,
  lastSeenAt: 1_700_000_100,
  emailForwardingEnabled: false,
});
ok('device list accepts the exact max-8 response shape',
  parseTrustedDevices({ devices: Array.from({ length: MAX_TRUSTED_DEVICES }, (_, i) => device(i)) })?.length === 8);
ok('device list rejects a ninth device and malformed roles',
  parseTrustedDevices({ devices: Array.from({ length: 9 }, (_, i) => device(i)) }) === null &&
  parseTrustedDevices({ devices: [{ ...device(0), role: 'admin' }] }) === null);

const root = path.join(__dirname, '../..');
const relaySource = fs.readFileSync(path.join(root, 'src/lib/relay.ts'), 'utf8');
const screenSource = fs.readFileSync(path.join(root, 'src/app/trusted-devices.tsx'), 'utf8');
const settingsSource = fs.readFileSync(path.join(root, 'src/app/settings.tsx'), 'utf8');
ok('client covers every trusted-device management endpoint',
  ['/v1/device-invites', '/v1/join', '/v1/devices', '/v1/vault']
    .every((endpoint) => relaySource.includes(endpoint)) &&
  /method: 'PATCH'/.test(relaySource) && /method: 'DELETE'/.test(relaySource));
ok('joined credentials use device-only SecureStore persistence',
  /WHEN_UNLOCKED_THIS_DEVICE_ONLY/.test(relaySource) &&
  relaySource.indexOf('const cfg: RelayConfig', relaySource.indexOf('joinTrustedVault')) <
    relaySource.indexOf('await putRelayConfig(cfg)', relaySource.indexOf('joinTrustedVault')));
ok('Settings links the real route and the screen exposes explicit vault deletion',
  /router\.push\('\/trusted-devices'\)/.test(settingsSource) &&
  /deleteTrustedVault\(config\)/.test(screenSource));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
