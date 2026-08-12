/**
 * The iOS half of capture.
 *
 * Android reads the inbox directly and never needs a network (src/lib/auto-import.ts).
 * iOS cannot: Apple gives no app access to SMS, and any capture that is not
 * user-initiated fails App Review. What iOS does allow is a Shortcuts personal
 * automation the USER creates — "when I get a message from ENBD, send it to
 * Wafra" — and a Shortcut can only make an HTTP request. So the message goes
 * to the relay (server/src/index.ts), which parses it, drops the text, seals
 * the parsed row to this device's public key, and holds it until the app
 * collects it.
 *
 * The device identity is a keypair this file generates and a bearer token the
 * relay issues once. Both live in expo-secure-store — the Keychain on iOS —
 * and the private half is never transmitted. There is no account, no email and
 * no password. Keychain items can survive an iOS reinstall, so the explicit
 * disconnect path deletes both the relay device and the local credential.
 *
 * The other way a pairing ends is from the outside: the vault owner revokes
 * this phone from another device and this phone is never told. Its only
 * symptom is a 401 on /v1/sync, so that is where the local credential is
 * stamped revoked — see markRelayRevoked() for why it is stamped rather than
 * destroyed, and for what would be lost if a proxy's 401 were believed.
 *
 * Sync deliberately does not delete on read. Rows are acknowledged only after
 * the app has actually written them to the ledger, so a request that dies
 * mid-flight costs a retry rather than a transaction.
 *
 * THE KEY IS GENERATED FROM BYTES THIS FILE SUPPLIES. `relay-crypto.ts` takes
 * its 32 bytes of entropy as an argument and never reaches for a global,
 * because React Native defines no `crypto.getRandomValues` and noble's own key
 * generation throws under Hermes. Pairing was the first thing to call it, so
 * that throw meant iOS could never pair on a real device while every Node test
 * passed. Anything here that stops passing entropy in explicitly brings it back.
 *
 * ONE STAGING INBOX, DELIBERATELY. An earlier relay client was a single-token
 * design with its own AsyncStorage staging inbox, and four modules were built
 * on it: `src/lib/relay-wake.ts`, `src/hooks/use-relay-capture.ts`,
 * `src/components/relay-status.tsx` and `src/app/iphone-setup.tsx`. All four
 * were deleted rather than ported. This file is the four-scope client, and the
 * inbox it pairs with is the encrypted one in
 * `background-relay-storage.native.ts`, read through `background-relay.ts` and
 * `capture.ts`. Do not reconcile the old design by adding a second staging
 * path here: two inboxes would stage and acknowledge the same queue row twice,
 * so one bank alert would be filed as two transactions.
 */
import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import type { ScannedSms } from '@/lib/auto-import';
import { MARKETS, bankFromName, bankFromSender, getActiveMarket } from '@/lib/markets';
import {
  decodeKey,
  deviceKeypair,
  encodeKey,
  openSealed,
  type SealedBlob,
} from '@/lib/relay-crypto';
import { isRelayTestPayload } from '@/lib/relay-protocol';
import type { ParsedSms } from '@/lib/sms-parser';
import {
  parseTrustedDevices,
  validTrustedDeviceName,
  type TrustedDevice,
  type TrustedDeviceInvite,
} from '@/lib/trusted-device-contract';

/**
 * React Native and Expo define this global; the test harness compiles this
 * module in isolation and does not. Declared locally, and as possibly
 * undefined, so the `typeof` guard below stays meaningful in both worlds — a
 * bare reference would fail the suite's build rather than one of its tests.
 */
declare const __DEV__: boolean | undefined;

/**
 * Expo inlines this public build setting. It is intentionally not a fallback:
 * a release with no deployed relay must fail setup visibly, not send financial
 * messages to a domain that merely looks plausible.
 */
export const DEFAULT_RELAY_URL = normalizeRelayBaseUrl(
  process.env.EXPO_PUBLIC_WAFRA_RELAY_URL,
);

/** The published, credential-free Shortcut skeleton. */
export const DEFAULT_SHORTCUT_URL = normalizeShortcutInstallUrl(
  process.env.EXPO_PUBLIC_WAFRA_SHORTCUT_URL,
  process.env.EXPO_PUBLIC_WAFRA_SHORTCUT_FILE_BETA === '1',
);

const KEY = 'wafra.relay.v1';
const BACKGROUND_KEY = 'wafra.relay.background.v1';
const AUTOMATION_PROOF_KEY = 'wafra.relay.automation-proof.v1';
/** What a device paired before market selection existed was parsing under. */
const DEFAULT_MARKET = 'AE';
/** A phone on hotel wifi should fail fast and retry, not hang the sync. */
const TIMEOUT_MS = 15_000;
/** Matches the Worker's `LIMIT 200` page and its `/v1/ack` ceiling. */
const PAGE = 200;

type RandomValuesCrypto = {
  getRandomValues(array: Uint8Array): Uint8Array;
};

/**
 * Hermes does not provide the Web Crypto global that Noble checks internally.
 * Expo Crypto does provide the native CSPRNG, so expose only that one primitive
 * before the first X25519 operation. This is deliberately not a Math.random
 * fallback and does not pretend Hermes implements SubtleCrypto.
 */
function installNativeRandomValuesBridge(): void {
  const runtime = globalThis as unknown as { crypto?: Partial<RandomValuesCrypto> };
  if (typeof runtime.crypto?.getRandomValues === 'function') return;

  const getRandomValues = (array: Uint8Array): Uint8Array => Crypto.getRandomValues(array);
  if (runtime.crypto) {
    Object.defineProperty(runtime.crypto, 'getRandomValues', {
      configurable: true,
      value: getRandomValues,
    });
    return;
  }

  Object.defineProperty(runtime, 'crypto', {
    configurable: true,
    value: { getRandomValues },
    writable: true,
  });
}

function createDeviceKeypair() {
  // Install first: Noble's Hermes build may consult the global while deriving
  // the public key even though the secret bytes themselves came from Expo.
  installNativeRandomValuesBridge();
  return deviceKeypair(Crypto.getRandomValues(new Uint8Array(32)));
}

function openDeviceSealed<T>(secretKey: Uint8Array, blob: SealedBlob): T {
  // A returning device can sync without creating a fresh keypair in this JS
  // session. Install before ECDH as well, so that path never depends on pairing
  // having run first.
  installNativeRandomValuesBridge();
  return openSealed<T>(secretKey, blob);
}

export interface RelayConfig {
  baseUrl: string;
  deviceId: string;
  /** Ingest-only bearer token. The Shortcut carries a copy of this. */
  ingestToken: string;
  /** Foreground-only bearer for device, import, push and vault management. */
  adminToken: string;
  /** Least-privilege bearer used only to read and acknowledge this queue. */
  syncToken: string;
  /** Email-ingest-only token. It is never reused as an app or Shortcut token. */
  emailToken?: string;
  /** Private forwarding destination, present only when the relay routes email. */
  forwardingAddress?: string;
  /** base64 X25519 private key. Never leaves the device. */
  privateKey: string;
  /**
   * Market pack the relay parses this device's messages under ('AE', 'SA').
   *
   * The Worker cannot infer it. `parseSms` reads the ACTIVE pack at call time,
   * and a relay that leaves it at the AE default reads a Saudi user's
   * "SAR 45.00 at PANDA" as no currency it knows: the amount is misread and the
   * row is dropped. The phone is the only side that knows which country the
   * user picked, so the phone tells the relay — at pairing, and afterwards
   * through setRelayMarket() rather than by re-pairing, because re-pairing
   * mints a token the user's Shortcut does not have.
   */
  market: string;
  /** The URL the user's Shortcut POSTs to. */
  ingestUrl: string;
  pairedAt: number;
  /** Paired alone cannot capture; configured means the automation was created. */
  setupState: 'paired' | 'configured' | 'verified';
  verifiedAt?: number;
  /**
   * When the relay last refused this credential outright — see
   * markRelayRevoked(). A stamped credential is no longer a pairing:
   * getRelayConfig() and getBackgroundRelayConfig() both answer null for it,
   * so every screen and every collector reads this phone as unpaired and the
   * user is offered setup again instead of a status line that is not true.
   */
  revokedAt?: number;
}

/** Least-privilege credentials available to a silent wake after first unlock. */
export type BackgroundRelayConfig = Pick<
  RelayConfig,
  'baseUrl' | 'deviceId' | 'syncToken' | 'privateKey' | 'setupState' | 'revokedAt'
>;

type RelaySyncConfig = Pick<RelayConfig, 'baseUrl' | 'syncToken' | 'privateKey'>;

export function normalizeRelayBaseUrl(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    const isLocal =
      typeof __DEV__ !== 'undefined' &&
      __DEV__ &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
      url.protocol === 'http:';
    if (url.protocol !== 'https:' && !isLocal) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    const path = url.pathname.replace(/\/+$/, '');
    return `${url.origin}${path}`;
  } catch {
    return null;
  }
}

export function normalizeShortcutInstallUrl(
  value: string | null | undefined,
  allowSignedFileBeta = false,
): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    const isICloudShortcut =
      (url.hostname === 'www.icloud.com' || url.hostname === 'icloud.com') &&
      /^\/shortcuts\/[A-Za-z0-9_-]+\/?$/.test(url.pathname);
    const isSignedBetaFile =
      allowSignedFileBeta &&
      url.hostname === 'raw.githubusercontent.com' &&
      /^\/khanjer496-alt\/Wafra\/[0-9a-f]{40}\/assets\/shortcuts\/Wafra%20Capture\.shortcut$/.test(
        url.pathname,
      );
    if (
      url.protocol !== 'https:' ||
      (!isICloudShortcut && !isSignedBetaFile) ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

/** iOS is the only platform that needs the relay; Android reads the inbox. */
export function isRelayPlatform(): boolean {
  return Platform.OS === 'ios';
}

/** A market id the app actually ships a pack for, or null. */
export function validRelayMarket(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim().toUpperCase();
  return MARKETS.some((market) => market.id === id) ? id : null;
}

/** A stored blob the relay has cut off, whatever else it still contains. */
function revokedAt(cfg: { revokedAt?: unknown }): number | null {
  return typeof cfg.revokedAt === 'number' && Number.isFinite(cfg.revokedAt) && cfg.revokedAt > 0
    ? cfg.revokedAt
    : null;
}

function decodeStoredRelayConfig(raw: string, includeRevoked = false): RelayConfig | null {
  const cfg = JSON.parse(raw) as Partial<RelayConfig>;
  // Refused by the relay: still on disk, deliberately, but not a pairing.
  // Answering with it would let Home keep claiming capture is live and would
  // send /ios-setup to its "finish the test" step, where the poll can only
  // 401 forever. Null is what puts the pair-again path back in front of the
  // user; getRelayRevokedAt() is how a caller tells this apart from a phone
  // that was never set up.
  if (revokedAt(cfg) !== null && !includeRevoked) return null;
  const baseUrl = normalizeRelayBaseUrl(cfg.baseUrl);
  const setupState =
    cfg.setupState === 'configured' || cfg.setupState === 'verified'
      ? cfg.setupState
      : 'paired';
  const emailToken =
    typeof cfg.emailToken === 'string' && cfg.emailToken.length >= 40 && cfg.emailToken.length <= 128
      ? cfg.emailToken
      : undefined;
  // A device paired before market selection existed has no `market` at all.
  // Defaulting is deliberate: rejecting the config here would read as "not
  // paired", and the app would offer to pair again — minting a token the
  // user's Shortcut does not carry and killing capture on a working setup.
  const market = validRelayMarket(cfg.market) ?? DEFAULT_MARKET;
  const forwardingAddress =
    typeof cfg.forwardingAddress === 'string' &&
    cfg.forwardingAddress.length <= 320 &&
    !/[\s\r\n]/.test(cfg.forwardingAddress) &&
    cfg.forwardingAddress.includes('@')
      ? cfg.forwardingAddress
      : undefined;
  if (
    !baseUrl ||
    typeof cfg.deviceId !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(cfg.deviceId) ||
    typeof cfg.ingestToken !== 'string' ||
    cfg.ingestToken.length < 40 ||
    cfg.ingestToken.length > 128 ||
    typeof cfg.adminToken !== 'string' ||
    cfg.adminToken.length < 40 ||
    cfg.adminToken.length > 128 ||
    typeof cfg.syncToken !== 'string' ||
    cfg.syncToken.length < 40 ||
    cfg.syncToken.length > 128 ||
    typeof cfg.privateKey !== 'string' ||
    decodeKey(cfg.privateKey).length !== 32 ||
    cfg.ingestUrl !== `${baseUrl}/v1/ingest` ||
    typeof cfg.pairedAt !== 'number' ||
    !Number.isFinite(cfg.pairedAt)
  ) {
    throw new Error('Invalid stored relay credentials');
  }
  return { ...cfg, baseUrl, market, setupState, emailToken, forwardingAddress } as RelayConfig;
}

/**
 * Read relay credentials for an irreversible operation.
 *
 * Unlike the ordinary UI accessor below, this distinguishes proven absence
 * from a Keychain/decoding failure. Erase must stop on the latter: otherwise
 * it could delete the local ledger while leaving a live remote queue and
 * Shortcut credential behind.
 */
export async function getRelayConfigStrict(): Promise<RelayConfig | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    // A revocation marker means ordinary capture must stop; it does not prove
    // the remote device was deleted. Destructive callers still need the
    // validated admin credential so they can demand authenticated deletion.
    return decodeStoredRelayConfig(raw, true);
  } catch {
    // Never carry native Keychain text or stored credential material across
    // this interface. Destructive callers need only the closed failure code.
    throw new RelayError(
      'Stored relay credentials could not be verified.',
      true,
      'local_credentials_unavailable',
    );
  }
}

export async function getRelayConfig(): Promise<RelayConfig | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    return decodeStoredRelayConfig(raw);
  } catch {
    // A Keychain read can fail on a locked device. Treat it as "not paired
    // yet" rather than throwing into whatever screen asked.
    return null;
  }
}

let credentialMutationTail: Promise<void> = Promise.resolve();
let credentialPairingGeneration = 0;

const enqueueCredentialMutation = <T,>(task: () => Promise<T>): Promise<T> => {
  const operation = credentialMutationTail.then(task, task);
  credentialMutationTail = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
};

async function writeRelayConfig(cfg: RelayConfig): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(cfg), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  const background: BackgroundRelayConfig = {
    baseUrl: cfg.baseUrl,
    deviceId: cfg.deviceId,
    syncToken: cfg.syncToken,
    privateKey: cfg.privateKey,
    setupState: cfg.setupState,
    // Spread rather than assigned: an absent marker must stay absent in the
    // stored JSON, because the locked-phone item is asserted key-for-key.
    ...(cfg.revokedAt ? { revokedAt: cfg.revokedAt } : {}),
  };
  await SecureStore.setItemAsync(BACKGROUND_KEY, JSON.stringify(background), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

async function publishRelayConfig(
  cfg: RelayConfig,
  pairingGeneration: number,
): Promise<boolean> {
  return enqueueCredentialMutation(async () => {
    if (pairingGeneration !== credentialPairingGeneration) return false;
    await writeRelayConfig(cfg);
    return true;
  });
}

async function updateRelayConfigIfCurrent(
  expected: Pick<RelayConfig, 'deviceId' | 'syncToken'>,
  update: (current: RelayConfig) => RelayConfig,
): Promise<RelayConfig | null> {
  return enqueueCredentialMutation(async () => {
    const current = await getRelayConfig();
    if (
      !current ||
      current.deviceId !== expected.deviceId ||
      current.syncToken !== expected.syncToken
    ) return null;
    const next = update(current);
    await writeRelayConfig(next);
    return next;
  });
}

export async function getBackgroundRelayConfig(): Promise<BackgroundRelayConfig | null> {
  try {
    const raw = await SecureStore.getItemAsync(BACKGROUND_KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw) as Partial<BackgroundRelayConfig>;
    // Same rule as the foreground item: a refused credential is not a pairing,
    // so the headless wake stops re-authenticating against a device the relay
    // has already deleted instead of failing the task on every push.
    if (revokedAt(cfg) !== null) return null;
    const baseUrl = normalizeRelayBaseUrl(cfg.baseUrl);
    if (
      !baseUrl ||
      typeof cfg.deviceId !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(cfg.deviceId) ||
      typeof cfg.syncToken !== 'string' ||
      cfg.syncToken.length < 40 ||
      cfg.syncToken.length > 128 ||
      typeof cfg.privateKey !== 'string' ||
      decodeKey(cfg.privateKey).length !== 32 ||
      (cfg.setupState !== 'paired' &&
        cfg.setupState !== 'configured' &&
        cfg.setupState !== 'verified')
    ) {
      return null;
    }
    return { ...cfg, baseUrl } as BackgroundRelayConfig;
  } catch {
    return null;
  }
}

async function deleteRelayCredentials(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(KEY),
    SecureStore.deleteItemAsync(BACKGROUND_KEY),
    SecureStore.deleteItemAsync(AUTOMATION_PROOF_KEY),
  ]);
}

async function deleteRelayCredentialsIfCurrent(
  expected: Pick<RelayConfig, 'deviceId' | 'syncToken'>,
): Promise<'deleted' | 'replaced' | 'unavailable'> {
  return enqueueCredentialMutation(async () => {
    let current: { deviceId?: unknown; syncToken?: unknown } | null = null;
    try {
      const raw = await SecureStore.getItemAsync(KEY);
      current = raw ? JSON.parse(raw) as { deviceId?: unknown; syncToken?: unknown } : null;
    } catch {
      return 'unavailable';
    }
    if (
      current?.deviceId !== expected.deviceId ||
      current.syncToken !== expected.syncToken
    ) return 'replaced';
    try {
      await deleteRelayCredentials();
      return 'deleted';
    } catch {
      return 'unavailable';
    }
  });
}

async function requireLocalRelayCredentialCleanup(cfg: RelayConfig): Promise<void> {
  const cleanup = await deleteRelayCredentialsIfCurrent(cfg);
  if (cleanup === 'deleted') return;
  throw new RelayError(
    cleanup === 'replaced'
      ? 'A newer relay connection replaced the device being erased.'
      : 'The relay device was erased, but local credentials could not be cleared.',
    cleanup === 'unavailable',
    cleanup === 'replaced' ? 'local_credentials_replaced' : 'local_cleanup_unavailable',
  );
}

/** The relay refused this credential; the pairing is over, not merely stalled. */
export const RELAY_REVOKED = 'device_revoked';

/** True for the one error that means "re-pair", not "try again later". */
export function isRelayRevokedError(error: unknown): boolean {
  return error instanceof RelayError && error.code === RELAY_REVOKED;
}

/**
 * Stamp a stored credential the relay has cut off, rather than destroying it.
 *
 * WHY A MARKER AND NOT deleteRelayCredentials().
 *
 * The vault owner revoking this phone from another device deletes its queue
 * rows along with it (server/src/index.ts, DELETE /v1/devices/:id), so in the
 * true case there is nothing left for the X25519 private key to open and
 * erasing it would cost nothing. The problem is that a 401 is not proof of
 * that case. It is the answer this client gets from anything that can sit in
 * front of the relay — a captive portal or an authenticating corporate proxy —
 * and from any relay-side fault that loses a token row. Under a destructive
 * policy one such answer, on one hostile network, permanently destroys the
 * only copy of the key that can open rows still sealed in the queue AND the
 * admin token that is the only way to delete this device server-side; both are
 * unrecoverable, and the user's Shortcut would then have to be rebuilt for a
 * device that was never actually revoked. So the credential stays exactly
 * where it is and gains one field. The app stops claiming to be paired either
 * way — that is what getRelayConfig() returning null does — and everything
 * needed to open a queued row or to unpair properly is still on disk.
 *
 * A compare-and-swap on the refused sync token, because a 401 can land after
 * the credential it was sent with has already been replaced: a sync started
 * before the user re-paired must never stamp the pairing that replaced it.
 */
export async function markRelayRevoked(syncToken: string, at = Date.now()): Promise<void> {
  await enqueueCredentialMutation(async () => {
    await Promise.all([
      stampRevoked(KEY, syncToken, at, SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY),
      stampRevoked(BACKGROUND_KEY, syncToken, at, SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY),
    ]);
  });
}

async function stampRevoked(
  key: string,
  syncToken: string,
  at: number,
  keychainAccessible: SecureStore.KeychainAccessibilityConstant,
): Promise<void> {
  try {
    const raw = await SecureStore.getItemAsync(key);
    if (!raw) return;
    const cfg = JSON.parse(raw) as { syncToken?: unknown; revokedAt?: unknown };
    if (cfg.syncToken !== syncToken || revokedAt(cfg) !== null) return;
    // Merged into whatever is stored rather than rebuilt from a validated
    // config: a blob this build cannot fully parse is still a blob the user
    // may need, and losing a field here would be the destruction this exists
    // to avoid. The accessibility class is restated per item for the same
    // reason putRelayConfig states it — a write that omits it silently
    // relaxes the class the pairing chose.
    await SecureStore.setItemAsync(key, JSON.stringify({ ...cfg, revokedAt: at }), {
      keychainAccessible,
    });
  } catch {
    // A Keychain that will not answer leaves the app in the state it was
    // already in. The next sync gets the same 401 and tries again.
  }
}

/**
 * When this device was cut off, or null. The one way to tell a revoked phone
 * from one that has never been set up, both of which read as "not paired".
 */
export async function getRelayRevokedAt(): Promise<number | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    return revokedAt(JSON.parse(raw) as { revokedAt?: unknown });
  } catch {
    return null;
  }
}

/**
 * A synthetic setup probe proves only Shortcut → relay → encrypted sync. The
 * stronger proof is written exclusively by the headless notification task
 * after it stages a parsed bank transaction while the UI is not involved.
 */
export async function recordRelayAutomationProof(
  cfg: Pick<BackgroundRelayConfig, 'deviceId' | 'syncToken'>,
  at = Date.now(),
): Promise<void> {
  await enqueueCredentialMutation(async () => {
    const current = await getBackgroundRelayConfig();
    if (
      !current ||
      current.deviceId !== cfg.deviceId ||
      current.syncToken !== cfg.syncToken
    ) return;
    await SecureStore.setItemAsync(
      AUTOMATION_PROOF_KEY,
      JSON.stringify({ deviceId: cfg.deviceId, at }),
      { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY },
    );
  });
}

export async function getRelayAutomationProof(deviceId: string | null): Promise<number | null> {
  if (!deviceId) return null;
  try {
    const raw = await SecureStore.getItemAsync(AUTOMATION_PROOF_KEY);
    const proof = raw ? JSON.parse(raw) as { deviceId?: unknown; at?: unknown } : null;
    return proof?.deviceId === deviceId && Number.isFinite(proof.at) && Number(proof.at) > 0
      ? Number(proof.at)
      : null;
  } catch {
    return null;
  }
}

async function request(url: string, init: RequestInit & { token?: string }): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(init.headers ?? {}),
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

export class RelayError extends Error {
  constructor(
    message: string,
    /** True when retrying later is the right move (offline, 5xx, timeout). */
    readonly retryable: boolean,
    /** Stable relay error name when the server returned one. */
    readonly code?: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'RelayError';
  }
}

async function responseError(res: Response, fallback: string): Promise<RelayError> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  const code = typeof body?.error === 'string' ? body.error : undefined;
  return new RelayError(fallback, res.status >= 500, code, res.status);
}

function validCredentialResponse(
  value: unknown,
): value is { deviceId: string; ingestToken: string; syncToken: string; adminToken: string } {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as {
    deviceId?: unknown;
    ingestToken?: unknown;
    syncToken?: unknown;
    adminToken?: unknown;
  };
  return (
    typeof body.deviceId === 'string' &&
    /^[0-9a-f-]{36}$/i.test(body.deviceId) &&
    typeof body.ingestToken === 'string' &&
    body.ingestToken.length >= 40 &&
    body.ingestToken.length <= 128 &&
    typeof body.syncToken === 'string' &&
    body.syncToken.length >= 40 &&
    body.syncToken.length <= 128 &&
    typeof body.adminToken === 'string' &&
    body.adminToken.length >= 40 &&
    body.adminToken.length <= 128
  );
}

/**
 * Register this device and return the details the onboarding flow bakes into
 * the user's Shortcut. Safe to call again: a second pair issues a second
 * identity, so callers should check getRelayConfig() first.
 */
export async function pairDevice(
  baseUrl: string | null = DEFAULT_RELAY_URL,
  deviceName?: string,
  market: string = getActiveMarket().id,
): Promise<RelayConfig> {
  const base = normalizeRelayBaseUrl(baseUrl);
  if (!base) {
    throw new RelayError('Automatic capture is not configured in this build.', false);
  }
  const keys = createDeviceKeypair();
  const pack = validRelayMarket(market) ?? DEFAULT_MARKET;
  const pairingGeneration = ++credentialPairingGeneration;
  let res: Response;
  try {
    res = await request(`${base}/v1/pair`, {
      method: 'POST',
      body: JSON.stringify({
        publicKey: encodeKey(keys.publicKey),
        market: pack,
        ...(deviceName?.trim() ? { deviceName: deviceName.trim() } : {}),
      }),
    });
  } catch {
    throw new RelayError('Could not reach Wafra. Check your connection.', true);
  }
  if (!res.ok) throw await responseError(res, `Pairing failed (${res.status}).`);
  const body = (await res.json().catch(() => null)) as {
    deviceId?: unknown;
    ingestToken?: unknown;
    syncToken?: unknown;
    adminToken?: unknown;
    market?: unknown;
  } | null;
  if (
    !validCredentialResponse(body)
  ) {
    throw new RelayError('Pairing returned an unexpected response.', false);
  }
  const cfg: RelayConfig = {
    baseUrl: base,
    deviceId: body.deviceId,
    ingestToken: body.ingestToken,
    syncToken: body.syncToken,
    adminToken: body.adminToken,
    privateKey: encodeKey(keys.secretKey),
    // Echoed back by the relay, so what is stored is the pack the relay will
    // actually parse under rather than the one this build asked for.
    market: validRelayMarket((body as { market?: unknown }).market) ?? pack,
    // Do not accept a server-supplied destination for a bearer token. The
    // Shortcut always posts back to the origin the app deliberately paired.
    ingestUrl: `${base}/v1/ingest`,
    pairedAt: Date.now(),
    setupState: 'paired',
  };
  if (!(await publishRelayConfig(cfg, pairingGeneration))) {
    // A newer screen/session started pairing while this request was in flight.
    // Retire the abandoned remote identity without touching the newer local one.
    await unpairDevice(cfg).catch(() => {});
    throw new RelayError('A newer connection replaced this pairing attempt.', false, 'stale_pairing');
  }
  return cfg;
}

/** Enroll this phone into an existing vault with a one-use, ten-minute token. */
export async function joinTrustedVault(
  baseUrl: string,
  inviteToken: string,
  deviceName: string,
  market: string = getActiveMarket().id,
): Promise<RelayConfig> {
  const base = normalizeRelayBaseUrl(baseUrl);
  const name = deviceName.trim();
  if (!base) throw new RelayError('This invite has an invalid relay address.', false, 'bad_invite');
  if (!DEFAULT_RELAY_URL || base !== DEFAULT_RELAY_URL) {
    throw new RelayError('This invite belongs to a different Wafra relay.', false, 'bad_invite');
  }
  if (!/^[A-Za-z0-9_-]{40,128}$/.test(inviteToken)) {
    throw new RelayError('This invite code is invalid or incomplete.', false, 'bad_invite');
  }
  if (!validTrustedDeviceName(name)) {
    throw new RelayError('Enter a device name between 1 and 40 characters.', false, 'bad_device_name');
  }
  const pairingGeneration = ++credentialPairingGeneration;
  if (await getRelayConfig()) {
    throw new RelayError('This phone is already connected to a vault.', false, 'already_paired');
  }

  const keys = createDeviceKeypair();
  const pack = validRelayMarket(market) ?? DEFAULT_MARKET;
  let res: Response;
  try {
    res = await request(`${base}/v1/join`, {
      method: 'POST',
      body: JSON.stringify({
        publicKey: encodeKey(keys.publicKey),
        market: pack,
        inviteToken,
        deviceName: name,
      }),
    });
  } catch {
    throw new RelayError('Could not reach Wafra. Check your connection.', true, 'unavailable');
  }
  if (!res.ok) throw await responseError(res, `Enrollment failed (${res.status}).`);
  const body = (await res.json().catch(() => null)) as unknown;
  if (!validCredentialResponse(body)) {
    throw new RelayError('Enrollment returned an unexpected response.', false, 'bad_response');
  }

  const cfg: RelayConfig = {
    baseUrl: base,
    deviceId: body.deviceId,
    ingestToken: body.ingestToken,
    syncToken: body.syncToken,
    adminToken: body.adminToken,
    privateKey: encodeKey(keys.secretKey),
    market: validRelayMarket((body as { market?: unknown }).market) ?? pack,
    ingestUrl: `${base}/v1/ingest`,
    pairedAt: Date.now(),
    setupState: 'paired',
  };
  // The new phone's long-lived tokens and X25519 private key never touch
  // AsyncStorage. SecureStore maps to Keychain / Android Keystore storage.
  if (!(await publishRelayConfig(cfg, pairingGeneration))) {
    await unpairDevice(cfg).catch(() => {});
    throw new RelayError('A newer connection replaced this enrollment attempt.', false, 'stale_pairing');
  }
  return cfg;
}

/**
 * Change the pack the relay parses this device's messages under.
 *
 * Deliberately not part of pairing: re-pairing would mint a new ingest token,
 * and the old one is baked into the user's Shortcut where no code in this app
 * can reach it. Capture would die while the app looked healthy. Changing
 * country in Settings must therefore be a PATCH, never a re-pair.
 */
export async function setRelayMarket(cfg: RelayConfig, market: string): Promise<RelayConfig> {
  const pack = validRelayMarket(market);
  if (!pack) throw new RelayError('That country is not supported yet.', false, 'bad_market');
  if (pack === cfg.market) return cfg;
  let res: Response;
  try {
    res = await request(`${cfg.baseUrl}/v1/device`, {
      method: 'PATCH',
      token: cfg.adminToken,
      body: JSON.stringify({ market: pack }),
    });
  } catch {
    throw new RelayError('Could not reach Wafra.', true, 'unavailable');
  }
  if (!res.ok) throw await responseError(res, `Country change failed (${res.status}).`);
  // Written only after the relay confirms. Storing it first would leave the app
  // showing a market the relay is not parsing under, which looks like a parser
  // bug and is invisible from either side.
  const next = await updateRelayConfigIfCurrent(cfg, (current) => ({ ...current, market: pack }));
  if (!next) throw new RelayError('This relay pairing was replaced.', false, 'stale_pairing');
  return next;
}

export async function listTrustedDevices(cfg: RelayConfig): Promise<TrustedDevice[]> {
  let res: Response;
  try {
    res = await request(`${cfg.baseUrl}/v1/devices`, {
      method: 'GET',
      token: cfg.adminToken,
    });
  } catch {
    throw new RelayError('Could not reach Wafra.', true, 'unavailable');
  }
  if (!res.ok) throw await responseError(res, `Device list failed (${res.status}).`);
  const body = (await res.json().catch(() => null)) as unknown;
  const devices = parseTrustedDevices(body);
  if (!devices || devices.filter((device) => device.isCurrent).length !== 1) {
    throw new RelayError('Device list returned an unexpected response.', false, 'bad_response');
  }
  return devices;
}

export async function createTrustedDeviceInvite(
  cfg: RelayConfig,
): Promise<TrustedDeviceInvite> {
  let res: Response;
  try {
    res = await request(`${cfg.baseUrl}/v1/device-invites`, {
      method: 'POST',
      token: cfg.adminToken,
    });
  } catch {
    throw new RelayError('Could not reach Wafra.', true, 'unavailable');
  }
  if (!res.ok) throw await responseError(res, `Invite creation failed (${res.status}).`);
  const body = (await res.json().catch(() => null)) as {
    inviteToken?: unknown;
    expiresIn?: unknown;
  } | null;
  if (
    typeof body?.inviteToken !== 'string' ||
    !/^[A-Za-z0-9_-]{40,128}$/.test(body.inviteToken) ||
    typeof body.expiresIn !== 'number' ||
    !Number.isFinite(body.expiresIn) ||
    body.expiresIn <= 0 ||
    body.expiresIn > 600
  ) {
    throw new RelayError('Invite creation returned an unexpected response.', false, 'bad_response');
  }
  return { inviteToken: body.inviteToken, expiresIn: body.expiresIn };
}

export async function renameTrustedDevice(
  cfg: RelayConfig,
  deviceId: string,
  name: string,
): Promise<void> {
  const nextName = name.trim();
  if (!validTrustedDeviceName(nextName)) {
    throw new RelayError('Enter a device name between 1 and 40 characters.', false, 'bad_device_name');
  }
  let res: Response;
  try {
    res = await request(`${cfg.baseUrl}/v1/devices/${encodeURIComponent(deviceId)}`, {
      method: 'PATCH',
      token: cfg.adminToken,
      body: JSON.stringify({ name: nextName }),
    });
  } catch {
    throw new RelayError('Could not reach Wafra.', true, 'unavailable');
  }
  if (!res.ok) throw await responseError(res, `Rename failed (${res.status}).`);
}

export async function revokeTrustedDevice(
  cfg: RelayConfig,
  deviceId: string,
): Promise<void> {
  let res: Response;
  try {
    res = await request(`${cfg.baseUrl}/v1/devices/${encodeURIComponent(deviceId)}`, {
      method: 'DELETE',
      token: cfg.adminToken,
    });
  } catch {
    throw new RelayError('Could not reach Wafra.', true, 'unavailable');
  }
  if (!res.ok) throw await responseError(res, `Device removal failed (${res.status}).`);
  if (deviceId === cfg.deviceId) await requireLocalRelayCredentialCleanup(cfg);
}

/** Owner-only, explicit destruction of every device and queued relay item. */
export async function deleteTrustedVault(cfg: RelayConfig): Promise<void> {
  let res: Response;
  try {
    res = await request(`${cfg.baseUrl}/v1/vault`, {
      method: 'DELETE',
      token: cfg.adminToken,
    });
  } catch {
    throw new RelayError('Could not reach Wafra.', true, 'unavailable');
  }
  if (!res.ok) throw await responseError(res, `Vault deletion failed (${res.status}).`);
  await requireLocalRelayCredentialCleanup(cfg);
}

export async function markRelayConfigured(cfg: RelayConfig): Promise<RelayConfig> {
  const next = await updateRelayConfigIfCurrent(cfg, (current) => ({
    ...current,
    setupState: 'configured' as const,
  }));
  if (!next) throw new RelayError('This relay pairing was replaced.', false, 'stale_pairing');
  return next;
}

export async function markRelayVerified(cfg: RelayConfig): Promise<RelayConfig> {
  const next = await updateRelayConfigIfCurrent(cfg, (current) => ({
    ...current,
    setupState: 'verified' as const,
    verifiedAt: Date.now(),
  }));
  if (!next) throw new RelayError('This relay pairing was replaced.', false, 'stale_pairing');
  return next;
}

/** Persist a separately-issued email-ingest credential in device-only storage. */
export async function saveRelayEmailCredential(
  cfg: RelayConfig,
  emailToken: string,
  forwardingAddress: string,
): Promise<RelayConfig> {
  const next = await updateRelayConfigIfCurrent(cfg, (current) => ({
    ...current,
    emailToken,
    forwardingAddress,
  }));
  if (!next) throw new RelayError('This relay pairing was replaced.', false, 'stale_pairing');
  return next;
}

/** Forget a revoked email address without disturbing Shortcut capture. */
export async function clearRelayEmailCredential(cfg: RelayConfig): Promise<RelayConfig> {
  const next = await updateRelayConfigIfCurrent(cfg, (current) => {
    const { emailToken: _token, forwardingAddress: _address, ...rest } = current;
    return rest as RelayConfig;
  });
  if (!next) throw new RelayError('This relay pairing was replaced.', false, 'stale_pairing');
  return next;
}

/**
 * Give the relay a wake-only Expo push address. The Worker never sends money,
 * merchant names, or queue contents through push; it sends only
 * `{ kind: 'wafra.sync', v: 1 }`, which lets the headless task collect the
 * device-sealed rows over the authenticated relay channel.
 */
export async function registerRelayPush(
  cfg: RelayConfig,
  expoPushToken: string,
  projectId: string,
): Promise<void> {
  let res: Response;
  try {
    res = await request(`${cfg.baseUrl}/v1/push`, {
      method: 'PUT',
      token: cfg.adminToken,
      body: JSON.stringify({ expoPushToken, projectId }),
    });
  } catch {
    throw new RelayError('Could not enable silent capture.', true);
  }
  if (!res.ok) {
    throw new RelayError(`Silent capture setup failed (${res.status}).`, res.status >= 500);
  }
}

export async function unregisterRelayPush(cfg: RelayConfig): Promise<void> {
  let res: Response;
  try {
    res = await request(`${cfg.baseUrl}/v1/push`, {
      method: 'DELETE',
      token: cfg.adminToken,
    });
  } catch {
    throw new RelayError('Could not disable silent capture.', true);
  }
  if (!res.ok && res.status !== 401 && res.status !== 404) {
    throw new RelayError(`Silent capture removal failed (${res.status}).`, res.status >= 500);
  }
}

export interface RelaySyncResult {
  /** Parsed rows, oldest first, shaped exactly like an Android inbox scan. */
  parsed: ScannedSms[];
  /** Queue ids to acknowledge once the rows are safely in the ledger. */
  ids: string[];
  /** Rows the client could not open — a key mismatch, not a transient fault. */
  unreadable: number;
  /** Non-financial probes sent by the manual “Run test” Shortcut action. */
  testReceived: number;
  /** Probe ids are reserved for the foreground setup verifier. */
  testIds: string[];
  /**
   * Shortcut-delivered rows in this page, and how many of them carried enough
   * evidence to name their bank. See `shortcutCaptureHealth`.
   *
   * Counted HERE and nowhere later because neither field survives: a saved
   * Transaction has no `sender` and no `captureSource`, so by the time a row
   * is in the ledger the question cannot be asked any more.
   */
  shortcutRows: number;
  shortcutRowsWithBank: number;
}

/**
 * Collect whatever the Shortcut has pushed since last time. Returns rows in
 * the same shape scanInbox() produces, so buildImportPlan() — deduplication,
 * card mapping, transfer detection, rescan healing — applies unchanged.
 */
/**
 * The iCloud snapshot that does NOT send the bank label.
 *
 * An iCloud Shortcut link is a snapshot, not a channel: editing the Shortcut
 * and re-sharing mints a DIFFERENT link, and everyone who installed the old
 * one keeps the old one forever. This is the id of the first published Wafra
 * Capture, authored on a Mac — where Apple does not expose the iPhone-only
 * `Message → Sender` property, so the graph sends the message body and nothing
 * else.
 *
 * It is pinned here so the warning below can gate itself. Telling someone to
 * reinstall while this is still the only published link sends them to fetch
 * the same broken snapshot, and the prompt becomes a loop that blames the user
 * for the app's problem. When `eas.json` carries a different link, the gate
 * opens by itself — no second commit, and nobody has to remember.
 */
const SENDER_BLIND_SHORTCUT_ID = '85bd1e080e5849b591049eccffb9a3a1';

/**
 * Can this row's bank be named at all?
 *
 * Deliberately NOT "is `sender` non-empty". `docs/ios-shortcut-spec.md` warns
 * that the Sender detail must be converted to Text explicitly, because a
 * Shortcut that lets a Contact object coerce itself sends a person's name or a
 * serialized object — a perfectly non-empty string that identifies no bank.
 * A presence check passes that and reports a broken Shortcut as healthy, which
 * is the one outcome worse than no check at all.
 *
 * The expression is the same one `buildImportPlan` resolves identity with, so
 * "healthy" here means exactly "the planner can place this row", not something
 * adjacent to it that drifts later.
 */
export function relayRowNamesItsBank(row: Pick<ParsedRelayRow, 'bankHint' | 'sender'>): boolean {
  return Boolean((row.bankHint ? bankFromName(row.bankHint) : null) ?? bankFromSender(row.sender));
}

export interface ShortcutCaptureHealth {
  /** Show the "update your Shortcut" prompt. */
  warn: boolean;
  /** Rows seen and rows whose bank could be named, for the counter's own state. */
  seen: number;
  named: number;
}

/**
 * Whether the installed Shortcut looks sender-blind, and whether saying so
 * would help.
 *
 * Three conditions, all required:
 *
 * 1. Enough rows to be a pattern rather than one odd message. A single alert
 *    from a bank this market pack does not carry is not a broken Shortcut.
 * 2. None of them named a bank. One healthy row proves the Shortcut sends the
 *    label, and the count resets — which is what clears the warning after a
 *    user updates, with no separate dismissal to persist.
 * 3. A different Shortcut has actually been published. Otherwise "reinstall"
 *    reinstalls the same snapshot.
 *
 * Counts only. Never the sender, never the body — this decides whether to show
 * a sentence, and it does not need to keep evidence to do that.
 */
export function shortcutCaptureHealth(
  seen: number,
  named: number,
  shortcutUrl: string | null = DEFAULT_SHORTCUT_URL,
  minimumRows = 3,
): ShortcutCaptureHealth {
  const senderAwareLinkExists = Boolean(
    shortcutUrl && !shortcutUrl.includes(SENDER_BLIND_SHORTCUT_ID),
  );
  return {
    warn: senderAwareLinkExists && seen >= minimumRows && named === 0,
    seen,
    named,
  };
}

export async function syncRelay(cfg: RelaySyncConfig): Promise<RelaySyncResult> {
  let res: Response;
  try {
    res = await request(`${cfg.baseUrl}/v1/sync`, { method: 'GET', token: cfg.syncToken });
  } catch {
    throw new RelayError('Could not reach Wafra.', true);
  }
  if (res.status === 401) {
    // Nothing used to consume this. The throw was correct and completely
    // inert: the Keychain kept a 'verified' config with its automation proof,
    // so Home went on reporting live capture for a phone the relay had cut
    // off, and every sync after it failed into a `.catch` that said nothing.
    // Recording the refusal is what makes the rest of the app tell the truth.
    await markRelayRevoked(cfg.syncToken);
    throw new RelayError('This device is no longer paired.', false, RELAY_REVOKED, 401);
  }
  if (!res.ok) throw new RelayError(`Sync failed (${res.status}).`, res.status >= 500);

  const body = (await res.json().catch(() => null)) as { items?: unknown } | null;
  if (!Array.isArray(body?.items) || body.items.length > PAGE) {
    throw new RelayError('Sync returned an unexpected response.', false);
  }
  const items = body.items;
  const parsed: ScannedSms[] = [];
  const ids: string[] = [];
  let unreadable = 0;
  let shortcutRows = 0;
  let shortcutRowsWithBank = 0;
  let testReceived = 0;
  const testIds: string[] = [];
  // Decoded once per sync rather than once per row: a page is up to 200 rows,
  // and this is the one value in the file that must not be re-derived casually.
  const secretKey = decodeKey(cfg.privateKey);

  for (const item of items) {
    if (
      typeof item !== 'object' ||
      item === null ||
      !('id' in item) ||
      typeof item.id !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(item.id) ||
      !('epk' in item) ||
      typeof item.epk !== 'string' ||
      !('iv' in item) ||
      typeof item.iv !== 'string' ||
      !('ct' in item) ||
      typeof item.ct !== 'string'
    ) {
      unreadable += 1;
      continue;
    }
    const sealed = item as SealedBlob & { id: string };
    let row: unknown;
    try {
      row = openDeviceSealed<unknown>(secretKey, sealed);
    } catch {
      // A cleared Keychain or corrupt payload makes this row unrecoverable.
      // Acknowledge it because the missing private key makes it unrecoverable.
      unreadable += 1;
      ids.push(sealed.id);
      continue;
    }
    if (isRelayTestPayload(row)) {
      testReceived += 1;
      ids.push(sealed.id);
      testIds.push(sealed.id);
      continue;
    }
    if (!isParsedRelayRow(row)) {
      unreadable += 1;
      ids.push(sealed.id);
      continue;
    }
    // Only the Shortcut can be unhealthy in this way. Email and PDF capture
    // have no sender by design and must never trip the warning.
    if (row.captureSource === 'shortcut') {
      shortcutRows += 1;
      if (relayRowNamesItsBank(row)) shortcutRowsWithBank += 1;
    }
    parsed.push(relayRowToScannedSms(row));
    ids.push(sealed.id);
  }

  // Oldest first, the order buildImportPlan() expects so that account
  // auto-creation sees a card's earliest appearance first.
  parsed.sort((a, b) => (a.smsTs ?? 0) - (b.smsTs ?? 0));
  return { parsed, ids, unreadable, testReceived, testIds, shortcutRows, shortcutRowsWithBank };
}

export type ParsedRelayRow = Omit<ParsedSms, 'raw'> & {
  /** The Worker discards raw Message Content before sealing the row. */
  raw?: never;
  /**
   * When the MESSAGE arrived, not when the relay received it.
   *
   * This is the app's strong duplicate guard: `smsKey` in import-plan.ts is a
   * fingerprint of the timestamp and the amount. While the relay stamped its
   * own receipt time here, a Shortcut that fired twice produced two different
   * fingerprints for one purchase and the charge was filed twice. The Worker
   * now honours the Shortcut's timestamp, bounded to a sane window, and this
   * field is what carries it — see resolveReceivedAt in server/src/index.ts.
   */
  receivedAt?: string;
  captureSource?: 'shortcut' | 'email' | 'pdf' | 'csv';
  /** Structured sender label only; raw Message Content never reaches sync. */
  sender?: string;
  /** Market pack the relay parsed this row under ('AE', 'SA'). */
  market?: string;
};

const MAX_RELAY_SENDER_LENGTH = 80;
const RELAY_CATEGORIES = new Set([
  'groceries',
  'dining',
  'transport',
  'cash-withdrawal',
  'utilities',
  'telecom',
  'rent',
  'shopping',
  'health',
  'personal-care',
  'home-services',
  'education',
  'travel',
  'entertainment',
  'software',
  'investing',
  'charity',
  'government',
  'loan',
  'salary',
  'business',
  'other',
]);

function validIsoDate(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validParsedCard(value: unknown): value is ParsedRelayRow['card'] {
  if (value === null) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  const card = value as { last4?: unknown; kind?: unknown };
  return (
    typeof card.last4 === 'string' &&
    /^\d{4}$/.test(card.last4) &&
    (card.kind === 'credit' ||
      card.kind === 'debit' ||
      card.kind === 'account' ||
      card.kind === 'unknown')
  );
}

function validNullableSafeFils(value: unknown): value is number | null {
  return value === null || (Number.isSafeInteger(value) && (value as number) >= 0);
}

/**
 * Sender is optional for manual tests and old Shortcut payloads. When present,
 * accept one compact, displayable label only: no surrounding whitespace,
 * control characters, multiline text or bidi overrides that could disguise
 * which bank produced a row.
 */
export function validRelaySender(value: unknown): value is string | undefined {
  return (
    value === undefined ||
    (typeof value === 'string' &&
      value === value.trim() &&
      [...value].length >= 1 &&
      [...value].length <= MAX_RELAY_SENDER_LENGTH &&
      !/[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/u.test(value))
  );
}

export function isParsedRelayRow(
  value: unknown,
): value is ParsedRelayRow {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if ('raw' in row) return false;
  if (
    row.kind !== 'transaction' &&
    row.kind !== 'billDue' &&
    row.kind !== 'cardStatement' &&
    row.kind !== 'cardPayment'
  ) return false;
  if (row.type !== 'expense' && row.type !== 'income') return false;
  if (!Number.isSafeInteger(row.amountFils) || (row.amountFils as number) <= 0) return false;
  if (typeof row.currency !== 'string' || !/^[A-Z]{3}$/.test(row.currency)) return false;
  if (
    typeof row.merchant !== 'string' ||
    row.merchant !== row.merchant.trim() ||
    row.merchant.length < 1 ||
    row.merchant.length > 160 ||
    /[\u0000-\u001F\u007F-\u009F]/u.test(row.merchant)
  ) return false;
  if (!validIsoDate(row.date)) return false;
  if (!validParsedCard(row.card)) return false;
  if (
    row.reference !== null &&
    (typeof row.reference !== 'string' ||
      row.reference !== row.reference.trim() ||
      row.reference.length < 1 ||
      row.reference.length > 128 ||
      /[\u0000-\u001F\u007F-\u009F]/u.test(row.reference))
  ) return false;
  if (typeof row.transferHint !== 'boolean') return false;
  if (
    row.paymentFlowSide !== undefined &&
    row.paymentFlowSide !== 'funding' &&
    row.paymentFlowSide !== 'receipt'
  ) return false;
  if (row.paymentFlowSide !== undefined && row.kind !== 'transaction') return false;
  if (
    row.paymentFlowSide === 'funding' &&
    (row.type !== 'expense' || row.transferHint !== true)
  ) return false;
  if (
    row.paymentFlowSide === 'receipt' &&
    (row.type !== 'expense' || row.transferHint !== false)
  ) return false;
  if (!RELAY_CATEGORIES.has(row.categoryGuess as string)) return false;
  if (row.categoryDeliberate !== undefined && typeof row.categoryDeliberate !== 'boolean') {
    return false;
  }

  const dueKind = row.kind === 'billDue' || row.kind === 'cardStatement';
  if (
    row.dueDay !== null &&
    (!Number.isInteger(row.dueDay) || (row.dueDay as number) < 1 || (row.dueDay as number) > 31)
  ) return false;
  if (!dueKind && row.dueDay !== null) return false;
  if (dueKind && row.date !== null && row.dueDay !== Number(row.date.slice(8))) return false;
  if (!validNullableSafeFils(row.minDueFils)) return false;
  if (row.kind !== 'cardStatement' && row.minDueFils !== null) return false;

  if (!validNullableSafeFils(row.snapshotFils)) return false;
  if (
    row.snapshotKind !== null &&
    row.snapshotKind !== 'balance' &&
    row.snapshotKind !== 'limit' &&
    row.snapshotKind !== 'outstanding'
  ) return false;
  if ((row.snapshotFils === null) !== (row.snapshotKind === null)) return false;

  const fxFields = [row.originalAmountMinor, row.originalCurrency, row.fxRate, row.fxSource];
  const hasFx = fxFields.some((field) => field !== undefined);
  if (
    hasFx &&
    (!Number.isSafeInteger(row.originalAmountMinor) ||
      (row.originalAmountMinor as number) <= 0 ||
      typeof row.originalCurrency !== 'string' ||
      !/^[A-Z]{3}$/.test(row.originalCurrency) ||
      typeof row.fxRate !== 'number' ||
      !Number.isFinite(row.fxRate) ||
      row.fxRate <= 0 ||
      (row.fxSource !== 'bank' && row.fxSource !== 'fallback'))
  ) return false;

  if (
    row.receivedAt !== undefined &&
    (typeof row.receivedAt !== 'string' || !Number.isFinite(Date.parse(row.receivedAt)))
  ) return false;
  if (row.market !== undefined && validRelayMarket(row.market) !== row.market) return false;
  if (
    row.captureSource !== undefined &&
    row.captureSource !== 'shortcut' &&
    row.captureSource !== 'email' &&
    row.captureSource !== 'pdf' &&
    row.captureSource !== 'csv'
  ) return false;
  if (!validRelaySender(row.sender)) return false;

  if (
    row.cardPaymentSide !== undefined &&
    row.cardPaymentSide !== 'debit' &&
    row.cardPaymentSide !== 'receipt'
  ) return false;
  if (row.kind !== 'cardPayment' && row.cardPaymentSide !== undefined) return false;
  if (row.kind === 'cardStatement') {
    const card = row.card as { kind?: unknown } | null;
    if (
      row.type !== 'expense' ||
      (card !== null && card.kind !== 'credit') ||
      row.categoryGuess !== 'other' ||
      row.transferHint
    ) {
      return false;
    }
  }
  if (row.kind === 'cardPayment') {
    const card = row.card as { kind?: unknown } | null;
    if (
      row.type !== 'expense' ||
      card?.kind !== 'credit' ||
      row.categoryGuess !== 'other' ||
      !row.transferHint
    ) {
      return false;
    }
  }
  if (row.kind === 'billDue' && (row.type !== 'expense' || row.transferHint)) return false;

  return true;
}

/**
 * Preserve the validated sender for bank/card identity in buildImportPlan, and
 * the message timestamp for its duplicate fingerprint.
 *
 * `market` is carried so an empty ledger can pin the exact pack that parsed the
 * body and an existing opposite-currency ledger can refuse it. There is
 * deliberately no message digest on this row either—retries are collapsed server-side by the keyed replay
 * receipt in server/src/index.ts, which cannot be searched against a guessed
 * bank alert the way a bare SHA-256 of the text could.
 */
export function relayRowToScannedSms(
  row: ParsedRelayRow,
  fallbackTs = Date.now(),
): ScannedSms {
  const ts = row.receivedAt ? Date.parse(row.receivedAt) : NaN;
  const { receivedAt: _receipt, ...structured } = row;
  const parsedMarket = validRelayMarket(row.market);
  return {
    ...structured,
    market: parsedMarket === 'AE' || parsedMarket === 'SA' ? parsedMarket : undefined,
    smsTs: Number.isFinite(ts) ? ts : fallbackTs,
  };
}

/** Drop collected rows from the queue. Call only after they are persisted. */
export async function ackRelay(
  cfg: Pick<RelayConfig, 'baseUrl' | 'syncToken'>,
  ids: string[],
): Promise<void> {
  for (let i = 0; i < ids.length; i += PAGE) {
    const slice = ids.slice(i, i + PAGE);
    if (slice.length === 0) continue;
    let res: Response;
    try {
      res = await request(`${cfg.baseUrl}/v1/ack`, {
        method: 'POST',
        token: cfg.syncToken,
        body: JSON.stringify({ ids: slice }),
      });
    } catch {
      throw new RelayError('Could not acknowledge captured transactions.', true);
    }
    // An un-acked row is re-delivered and deduplicated on the next sync, but
    // callers still need to know that setup has not completed cleanly.
    if (!res.ok) {
      throw new RelayError(`Acknowledge failed (${res.status}).`, res.status >= 500);
    }
  }
}

/**
 * Forget this device, server-side and locally. The queue goes with it; so does
 * the row carrying `ingest_token_hash`, so the token baked into the user's
 * Shortcut authenticates against nothing and every later POST is answered 401
 * before the Worker reads the body. The Shortcut itself survives — Apple
 * exposes no way to delete it — see `src/lib/shortcut-cleanup.ts`.
 *
 * The relay refuses with 409 `last_owner` when this device owns a vault other
 * trusted devices still depend on. That failure is NOT retryable and must not
 * be reported as one, so the server's error name is carried through rather
 * than flattened into a status string: callers decide between "try again" and
 * "go remove the other devices first" on `error.code`.
 */
export async function unpairDevice(cfg: RelayConfig): Promise<void> {
  let res: Response;
  try {
    res = await request(`${cfg.baseUrl}/v1/device`, {
      method: 'DELETE',
      token: cfg.adminToken,
    });
  } catch {
    // Keep the credential so the user can retry. Clearing it here would make
    // the remote device impossible to delete until its retention timers fire.
    throw new RelayError('Could not reach the relay to erase this device.', true, 'unavailable');
  }
  // Only the authenticated 204 response proves this relay deleted the device,
  // its queue and the row that authenticates the Shortcut. A 401 can come from
  // a proxy or a lost server token row, and this route has no idempotent 404
  // contract. Preserve the only deletion credential on every non-success.
  if (res.status !== 204) {
    throw await responseError(res, `Could not erase the relay device (${res.status}).`);
  }
  await requireLocalRelayCredentialCleanup(cfg);
}

/** Liveness probe for the "send a test message" onboarding step. */
export async function relayHealthy(baseUrl: string | null = DEFAULT_RELAY_URL): Promise<boolean> {
  const base = normalizeRelayBaseUrl(baseUrl);
  if (!base) return false;
  try {
    const res = await request(`${base}/v1/health`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}
