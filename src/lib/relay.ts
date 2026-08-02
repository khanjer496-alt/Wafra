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
 * Sync deliberately does not delete on read. Rows are acknowledged only after
 * the app has actually written them to the ledger, so a request that dies
 * mid-flight costs a retry rather than a transaction.
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import type { ScannedSms } from '@/lib/auto-import';
import {
  b64decode,
  openSealed,
  generateKeypair,
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
);

const KEY = 'wafra.relay.v1';
const BACKGROUND_KEY = 'wafra.relay.background.v1';
const AUTOMATION_PROOF_KEY = 'wafra.relay.automation-proof.v1';
/** A phone on hotel wifi should fail fast and retry, not hang the sync. */
const TIMEOUT_MS = 15_000;
/** Matches the Worker's `LIMIT 200` page and its `/v1/ack` ceiling. */
const PAGE = 200;

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
  /** The URL the user's Shortcut POSTs to. */
  ingestUrl: string;
  pairedAt: number;
  /** Paired alone cannot capture; configured means the automation was created. */
  setupState: 'paired' | 'configured' | 'verified';
  verifiedAt?: number;
}

/** Least-privilege credentials available to a silent wake after first unlock. */
export type BackgroundRelayConfig = Pick<
  RelayConfig,
  'baseUrl' | 'deviceId' | 'syncToken' | 'privateKey' | 'setupState'
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

export function normalizeShortcutInstallUrl(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== 'https:' ||
      (url.hostname !== 'www.icloud.com' && url.hostname !== 'icloud.com') ||
      !/^\/shortcuts\/[A-Za-z0-9_-]+\/?$/.test(url.pathname) ||
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

export async function getRelayConfig(): Promise<RelayConfig | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw) as Partial<RelayConfig>;
    const baseUrl = normalizeRelayBaseUrl(cfg.baseUrl);
    const setupState =
      cfg.setupState === 'configured' || cfg.setupState === 'verified'
        ? cfg.setupState
        : 'paired';
    const emailToken =
      typeof cfg.emailToken === 'string' && cfg.emailToken.length >= 40 && cfg.emailToken.length <= 128
        ? cfg.emailToken
        : undefined;
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
      b64decode(cfg.privateKey).length !== 32 ||
      cfg.ingestUrl !== `${baseUrl}/v1/ingest` ||
      typeof cfg.pairedAt !== 'number' ||
      !Number.isFinite(cfg.pairedAt)
    ) {
      return null;
    }
    return { ...cfg, baseUrl, setupState, emailToken, forwardingAddress } as RelayConfig;
  } catch {
    // A Keychain read can fail on a locked device. Treat it as "not paired
    // yet" rather than throwing into whatever screen asked.
    return null;
  }
}

async function putRelayConfig(cfg: RelayConfig): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(cfg), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  const background: BackgroundRelayConfig = {
    baseUrl: cfg.baseUrl,
    deviceId: cfg.deviceId,
    syncToken: cfg.syncToken,
    privateKey: cfg.privateKey,
    setupState: cfg.setupState,
  };
  await SecureStore.setItemAsync(BACKGROUND_KEY, JSON.stringify(background), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

export async function getBackgroundRelayConfig(): Promise<BackgroundRelayConfig | null> {
  try {
    const raw = await SecureStore.getItemAsync(BACKGROUND_KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw) as Partial<BackgroundRelayConfig>;
    const baseUrl = normalizeRelayBaseUrl(cfg.baseUrl);
    if (
      !baseUrl ||
      typeof cfg.deviceId !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(cfg.deviceId) ||
      typeof cfg.syncToken !== 'string' ||
      cfg.syncToken.length < 40 ||
      cfg.syncToken.length > 128 ||
      typeof cfg.privateKey !== 'string' ||
      b64decode(cfg.privateKey).length !== 32 ||
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

/**
 * A synthetic setup probe proves only Shortcut → relay → encrypted sync. The
 * stronger proof is written exclusively by the headless notification task
 * after it stages a parsed bank transaction while the UI is not involved.
 */
export async function recordRelayAutomationProof(at = Date.now()): Promise<void> {
  await SecureStore.setItemAsync(AUTOMATION_PROOF_KEY, String(at), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

export async function getRelayAutomationProof(): Promise<number | null> {
  try {
    const raw = await SecureStore.getItemAsync(AUTOMATION_PROOF_KEY);
    const at = raw ? Number(raw) : NaN;
    return Number.isFinite(at) && at > 0 ? at : null;
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
): Promise<RelayConfig> {
  const base = normalizeRelayBaseUrl(baseUrl);
  if (!base) {
    throw new RelayError('Automatic capture is not configured in this build.', false);
  }
  const keys = generateKeypair();
  let res: Response;
  try {
    res = await request(`${base}/v1/pair`, {
      method: 'POST',
      body: JSON.stringify({
        publicKey: keys.publicKey,
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
    privateKey: keys.privateKey,
    // Do not accept a server-supplied destination for a bearer token. The
    // Shortcut always posts back to the origin the app deliberately paired.
    ingestUrl: `${base}/v1/ingest`,
    pairedAt: Date.now(),
    setupState: 'paired',
  };
  await putRelayConfig(cfg);
  return cfg;
}

/** Enroll this phone into an existing vault with a one-use, ten-minute token. */
export async function joinTrustedVault(
  baseUrl: string,
  inviteToken: string,
  deviceName: string,
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
  if (await getRelayConfig()) {
    throw new RelayError('This phone is already connected to a vault.', false, 'already_paired');
  }

  const keys = generateKeypair();
  let res: Response;
  try {
    res = await request(`${base}/v1/join`, {
      method: 'POST',
      body: JSON.stringify({ publicKey: keys.publicKey, inviteToken, deviceName: name }),
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
    privateKey: keys.privateKey,
    ingestUrl: `${base}/v1/ingest`,
    pairedAt: Date.now(),
    setupState: 'paired',
  };
  // The new phone's long-lived tokens and X25519 private key never touch
  // AsyncStorage. SecureStore maps to Keychain / Android Keystore storage.
  await putRelayConfig(cfg);
  return cfg;
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
  if (deviceId === cfg.deviceId) await deleteRelayCredentials();
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
  await deleteRelayCredentials();
}

export async function markRelayConfigured(cfg: RelayConfig): Promise<RelayConfig> {
  const next = { ...cfg, setupState: 'configured' as const };
  await putRelayConfig(next);
  return next;
}

export async function markRelayVerified(cfg: RelayConfig): Promise<RelayConfig> {
  const next = {
    ...cfg,
    setupState: 'verified' as const,
    verifiedAt: Date.now(),
  };
  await putRelayConfig(next);
  return next;
}

/** Persist a separately-issued email-ingest credential in device-only storage. */
export async function saveRelayEmailCredential(
  cfg: RelayConfig,
  emailToken: string,
  forwardingAddress: string,
): Promise<RelayConfig> {
  const next = { ...cfg, emailToken, forwardingAddress };
  await putRelayConfig(next);
  return next;
}

/** Forget a revoked email address without disturbing Shortcut capture. */
export async function clearRelayEmailCredential(cfg: RelayConfig): Promise<RelayConfig> {
  const { emailToken: _token, forwardingAddress: _address, ...rest } = cfg;
  const next = rest as RelayConfig;
  await putRelayConfig(next);
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
}

/**
 * Collect whatever the Shortcut has pushed since last time. Returns rows in
 * the same shape scanInbox() produces, so buildImportPlan() — deduplication,
 * card mapping, transfer detection, rescan healing — applies unchanged.
 */
export async function syncRelay(cfg: RelaySyncConfig): Promise<RelaySyncResult> {
  let res: Response;
  try {
    res = await request(`${cfg.baseUrl}/v1/sync`, { method: 'GET', token: cfg.syncToken });
  } catch {
    throw new RelayError('Could not reach Wafra.', true);
  }
  if (res.status === 401) throw new RelayError('This device is no longer paired.', false);
  if (!res.ok) throw new RelayError(`Sync failed (${res.status}).`, res.status >= 500);

  const body = (await res.json().catch(() => null)) as { items?: unknown } | null;
  if (!Array.isArray(body?.items) || body.items.length > PAGE) {
    throw new RelayError('Sync returned an unexpected response.', false);
  }
  const items = body.items;
  const parsed: ScannedSms[] = [];
  const ids: string[] = [];
  let unreadable = 0;
  let testReceived = 0;
  const testIds: string[] = [];

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
      row = openSealed<unknown>(cfg.privateKey, sealed);
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
    parsed.push(relayRowToScannedSms(row));
    ids.push(sealed.id);
  }

  // Oldest first, the order buildImportPlan() expects so that account
  // auto-creation sees a card's earliest appearance first.
  parsed.sort((a, b) => (a.smsTs ?? 0) - (b.smsTs ?? 0));
  return { parsed, ids, unreadable, testReceived, testIds };
}

export type ParsedRelayRow = Omit<ParsedSms, 'raw'> & {
  /** The Worker discards raw Message Content before sealing the row. */
  raw?: never;
  receivedAt?: string;
  captureSource?: 'shortcut' | 'email' | 'pdf';
  /** Structured sender label only; raw Message Content never reaches sync. */
  sender?: string;
};

const MAX_RELAY_SENDER_LENGTH = 80;
const RELAY_CATEGORIES = new Set([
  'groceries',
  'dining',
  'transport',
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
  if (
    row.captureSource !== undefined &&
    row.captureSource !== 'shortcut' &&
    row.captureSource !== 'email' &&
    row.captureSource !== 'pdf'
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

/** Preserve the validated sender for bank/card identity in buildImportPlan. */
export function relayRowToScannedSms(
  row: ParsedRelayRow,
  fallbackTs = Date.now(),
): ScannedSms {
  const ts = row.receivedAt ? Date.parse(row.receivedAt) : NaN;
  const { receivedAt: _receipt, ...structured } = row;
  return { ...structured, smsTs: Number.isFinite(ts) ? ts : fallbackTs };
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
 * the public key, so anything the Shortcut sends afterwards is rejected.
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
    throw new RelayError('Could not reach the relay to erase this device.', true);
  }
  if (!res.ok && res.status !== 401 && res.status !== 404) {
    throw new RelayError(`Could not erase the relay device (${res.status}).`, res.status >= 500);
  }
  await deleteRelayCredentials();
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
