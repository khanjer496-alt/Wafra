import {
  authenticatePrivateAlertFormat,
  createPrivateAlertFormat,
  emptyPrivateAlertFormatStore,
  matchPrivateAlertFormat,
  normalizePrivateAlertFormatStore,
  validatePrivateAlertFormat,
  type PrivateAlertFormat,
  type PrivateAlertFormatStore,
  type PrivateAlertMatchOptions,
} from '@/lib/private-alert-formats';
import type { LearnInput, LearnedFields } from '@/lib/learned-alert-formats';
import { privateAlertSourceDateContext } from '@/lib/private-alert-teaching';
import { inspectUniversalBankEvent } from '@/lib/universal-parser';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/** An opaque device secret; it never travels through ledger state or backups. */
const SECRET_NAME = 'wafra.private-alert-format.key.v1';
interface DeviceSecretAdapter {
  isNative(): boolean | Promise<boolean>;
  readSecret(): Promise<string | null>;
  writeSecret(value: string): Promise<void>;
  removeSecret(): Promise<void>;
  randomBytes(): Promise<Uint8Array>;
}
const nativeSecrets: DeviceSecretAdapter = {
  async isNative() { return (await import('react-native')).Platform.OS !== 'web'; },
  async readSecret() { return (await import('expo-secure-store')).getItemAsync(SECRET_NAME); },
  async writeSecret(value) {
    const secure = await import('expo-secure-store');
    await secure.setItemAsync(SECRET_NAME, value, {
      keychainAccessible: secure.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },
  async removeSecret() { await (await import('expo-secure-store')).deleteItemAsync(SECRET_NAME); },
  async randomBytes() { return (await import('expo-crypto')).getRandomValues(new Uint8Array(32)); },
};
export interface PrivateFormatMatch {
  kind: 'prefill';
  fields: LearnedFields;
  /** Ephemeral only: capture must not persist this device-keyed identifier. */
  templateId: string;
}
export interface PrivateAlertFormatSessionOptions extends PrivateAlertMatchOptions {
  enabled?: boolean;
  cancelled?: () => boolean;
  historyRepair?: boolean;
}
export interface PrivateAlertFormatSource {
  source: string;
  sender: string | null | undefined;
  observedAt: number;
}
const issuedMatches = new WeakMap<object, (source: string, sender: string | null | undefined, observedAt: number) => boolean>();
const matchSignature = (key: Uint8Array, source: string, sender: string | null | undefined, observedAt: number) =>
  bytesToHex(hmac(sha256, key, utf8ToBytes(JSON.stringify(['wafra-private-format-match-v1', source, sender ?? null, observedAt]))));
/** Process-local capability: a copied, changed, or retired match is untrusted. */
export function isTrustedPrivateAlertFormatMatch(value: unknown, source: string, sender: string | null | undefined, observedAt: number): value is PrivateFormatMatch {
  if (!value || typeof value !== 'object') return false;
  try { return issuedMatches.get(value)?.(source, sender, observedAt) === true; }
  catch { return false; }
}
const decodeSecret = (value: string): Uint8Array | null => /^[a-f0-9]{64}$/.test(value)
  ? Uint8Array.from(value.match(/../g)!, (pair) => Number.parseInt(pair, 16)) : null;
const encodeSecret = (value: Uint8Array): string => Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('');
/** Native scheduling controls are never part of the core's closed parse schema. */
const coreMatchOptions = (value: PrivateAlertMatchOptions, observedAt?: number): PrivateAlertMatchOptions => ({
  ...(value.country !== undefined ? { country: value.country } : {}),
  ...(value.dateOrder !== undefined ? { dateOrder: value.dateOrder } : {}),
  ...(value.routedMarket !== undefined ? { routedMarket: value.routedMarket } : {}),
  ...(value.launchRoute !== undefined ? { launchRoute: value.launchRoute } : {}),
  ...(value.postThreshold !== undefined ? { postThreshold: value.postThreshold } : {}),
  ...(observedAt !== undefined ? { now: observedAt } : value.now !== undefined ? { now: value.now } : {}),
});
const unambiguousSourceDate = (source: string, sender: string | null | undefined, expected: string | undefined) => {
  if (!expected) return true;
  const field = inspectUniversalBankEvent(source, { sender: sender ?? undefined }).transactionDate;
  return field.evidence === 'explicit' && field.value === expected;
};

/** Injectable secure boundary; construction and hydration perform no native IO. */
export function createPrivateAlertFormatRuntime(secrets: DeviceSecretAdapter = nativeSecrets) {
  let generation = 0;
  let ready = false;
  let formats: PrivateAlertFormatStore = emptyPrivateAlertFormatStore();
  let cachedKey: Uint8Array | null = null;
  let keyQueue: Promise<unknown> = Promise.resolve();
  const serialized = <T,>(work: () => Promise<T>): Promise<T> => {
    const operation = keyQueue.then(work, work);
    keyQueue = operation.then(() => undefined, () => undefined);
    return operation;
  };
  const invalidate = () => {
    generation++;
    ready = false;
    formats = emptyPrivateAlertFormatStore();
    cachedKey?.fill(0);
    cachedKey = null;
  };
  const activate = (value: unknown) => {
    // A new store view retires every pending match against the previous view.
    invalidate();
    formats = normalizePrivateAlertFormatStore(value);
    ready = true;
  };
  const keyFor = async (create: boolean, run: number): Promise<Uint8Array | null> => {
    if (!ready || run !== generation) return null;
    if (cachedKey) return cachedKey;
    return serialized(async () => {
      if (!ready || run !== generation) return null;
      if (cachedKey) return cachedKey;
      if (!(await secrets.isNative()) || run !== generation) return null;
      const existing = await secrets.readSecret();
      if (!ready || run !== generation) return null;
      if (existing !== null) {
        const decoded = decodeSecret(existing);
        // Corrupt or restored keys must never silently become a new identity.
        if (!decoded) return null;
        cachedKey = decoded;
        return cachedKey;
      }
      if (!create) return null;
      const generated = await secrets.randomBytes();
      if (generated.length !== 32 || !ready || run !== generation) { generated.fill(0); return null; }
      await secrets.writeSecret(encodeSecret(generated));
      if (!ready || run !== generation) { generated.fill(0); return null; }
      cachedKey = generated;
      return cachedKey;
    });
  };
  const prepareFromInput = async (readInput: () => LearnInput | null, cancelled: () => boolean = () => false) => {
    const run = generation;
    try {
      if (cancelled()) return { ok: false as const, reason: 'cancelled' };
      const key = await keyFor(true, run);
      if (cancelled()) return { ok: false as const, reason: 'cancelled' };
      if (!key || run !== generation) return { ok: false as const, reason: 'device-key-unavailable' };
      const input = readInput();
      if (!input) return { ok: false as const, reason: 'cancelled' };
      const scoped = privateAlertSourceDateContext(input.source, input.sender, input.context);
      return createPrivateAlertFormat({ ...input,
        context: { ...input.context, country: scoped.country, dateOrder: scoped.dateOrder } }, key);
    } catch { return { ok: false as const, reason: 'device-key-unavailable' }; }
  };
  const prepare = (input: LearnInput) => prepareFromInput(() => input);
  const validateFromSample = async (template: PrivateAlertFormat,
    readSample: () => { source: string; sender: string | null } | null,
    options: PrivateAlertMatchOptions = {}, cancelled: () => boolean = () => false) => {
    const run = generation;
    try {
      if (cancelled()) return { ok: false as const, reason: 'cancelled' };
      const key = await keyFor(false, run);
      if (cancelled()) return { ok: false as const, reason: 'cancelled' };
      if (!key || run !== generation) return { ok: false as const, reason: 'device-key-unavailable' };
      const sample = readSample();
      if (!sample) return { ok: false as const, reason: 'cancelled' };
      const scoped = privateAlertSourceDateContext(sample.source, sample.sender, options);
      const result = validatePrivateAlertFormat(template, sample.source, sample.sender, key, coreMatchOptions({ ...options, ...scoped }));
      if (result.ok && scoped.issuerConflict && !unambiguousSourceDate(sample.source, sample.sender, result.fields.date)) {
        return { ok: false as const, reason: 'format-mismatch' };
      }
      return result;
    } catch { return { ok: false as const, reason: 'device-key-unavailable' }; }
  };
  const validate = (template: PrivateAlertFormat, source: string, sender: string | null | undefined, options: PrivateAlertMatchOptions = {}) =>
    validateFromSample(template, () => ({ source, sender: sender ?? null }), options);
  const canSave = async (template: PrivateAlertFormat): Promise<boolean> => {
    const run = generation;
    try {
      const key = await keyFor(false, run);
      return !!key && run === generation && authenticatePrivateAlertFormat(template, key) && template.status === 'validated';
    } catch { return false; }
  };
  /** Read transient source only after secure IO, so a cancelled form can release it. */
  const readFromSource = async (readSource: () => PrivateAlertFormatSource | null,
    context: PrivateAlertMatchOptions = {}, cancelled: () => boolean = () => false): Promise<PrivateFormatMatch | null> => {
    const run = generation;
    if (cancelled() || !ready || formats.templates.length === 0 || context.launchRoute || context.routedMarket === 'AE' || context.routedMarket === 'SA') return null;
    try {
      const key = await keyFor(false, run);
      if (cancelled() || !key || !ready || run !== generation) return null;
      const input = readSource();
      if (!input || cancelled() || run !== generation) return null;
      const { source, sender, observedAt } = input;
      const scoped = privateAlertSourceDateContext(source, sender, context);
      const match = matchPrivateAlertFormat(source, sender, formats, key,
        coreMatchOptions({ ...context, ...scoped }, observedAt));
      if (match.kind !== 'prefill') return null;
      if (scoped.issuerConflict && !unambiguousSourceDate(source, sender, match.fields.date)) return null;
      const issued: PrivateFormatMatch = Object.freeze({ ...match, fields: Object.freeze({ ...match.fields }) });
      const signature = matchSignature(key, source, sender, observedAt);
      issuedMatches.set(issued, (candidateSource, candidateSender, candidateTime) =>
        ready && run === generation && signature === matchSignature(key, candidateSource, candidateSender, candidateTime));
      return issued;
    } catch { return null; }
  };
  const read = (source: string, sender: string | null | undefined, observedAt: number, context: PrivateAlertMatchOptions = {}) =>
    readFromSource(() => ({ source, sender, observedAt }), context);
  const session = (options: PrivateAlertFormatSessionOptions = {}) => {
    const run = generation;
    const isCurrent = () => options.enabled !== false && !options.historyRepair && !options.cancelled?.() && run === generation;
    const readSessionSource = async (readSource: () => PrivateAlertFormatSource | null, context: PrivateAlertMatchOptions = {}) => {
      if (!isCurrent()) return null;
      const result = await readFromSource(readSource, { ...options, ...context }, () => !isCurrent());
      return isCurrent() ? result : null;
    };
    return { isCurrent, readFromSource: readSessionSource,
      read: (source: string, sender: string | null | undefined, observedAt: number, context: PrivateAlertMatchOptions = {}) =>
        readSessionSource(() => ({ source, sender, observedAt }), context) };
  };
  const eraseKey = async (): Promise<void> => {
    invalidate();
    await serialized(async () => {
      if (await secrets.isNative()) await secrets.removeSecret();
    });
  };
  return { activate, invalidate, prepare, prepareFromInput, validate, validateFromSample, canSave, read, readFromSource, session, eraseKey };
}

const runtime = createPrivateAlertFormatRuntime();
export const activatePrivateAlertFormats = runtime.activate;
export const invalidatePrivateAlertFormats = runtime.invalidate;
export const preparePrivateAlertFormat = runtime.prepare;
export const validatePrivateAlertFormatSample = runtime.validate;
export const preparePrivateAlertFormatFromInput = runtime.prepareFromInput;
export const validatePrivateAlertFormatFromSample = runtime.validateFromSample;
export const canSavePrivateAlertFormat = runtime.canSave;
export const readPrivateAlertFormat = runtime.read;
export const createPrivateAlertFormatSession = runtime.session;
export const erasePrivateAlertFormatKey = runtime.eraseKey;
