import { foregroundHistoryBlockedFor, waitForForegroundHistoryIdle } from '@/lib/foreground-history-priority';
import { localSemanticBackgroundCancellation, createLocalSemanticPreparationFlight, settleLocalSemanticArtifacts, isLocalSemanticPreparationCancelled, type LocalSemanticPreparationController } from '@/lib/local-semantic-background-policy';
import { Directory, File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import type { InferenceSession as InferenceSessionType, Tensor as TensorType } from 'onnxruntime-react-native';
import { Tokenizer } from '@huggingface/tokenizers';
import { createLocalSemanticScheduler, type LocalSemanticEncodeOptions } from '@/lib/local-semantic-scheduler';

import {
  createLocalSemanticRetriever,
  type LocalOnnxInt8ModelManifest,
  type LocalOnnxInt8TextEncoder,
  type LocalSemanticPrototypeIndex,
  type LocalSemanticRetriever,
} from '@/lib/local-semantic-model';

const MODEL_VERSION = 'e5-arb-32768@e1b3907e6c83#int8-70fd5ee627d2';
const MODEL_SHA256 = '70fd5ee627d2392c1f201c4045ca1c37991db28e80eab3401ebc34b540c4f9a1';
const MODEL_BYTES = 34_825_743;
const MAX_TOKENS = 128;

/**
 * Runtime artifacts are deliberately remote/downloaded rather than bundled in
 * the base APK. Production can point this at a pinned first-party/CDN mirror;
 * tests/dev builds may override the base URL without changing the artifact
 * hashes. Never accept an unpinned model or tokenizer.
 */
const DEFAULT_BASE_URL = 'https://github.com/khanjer496-alt/Wafra/releases/download/local-ai-e5-v1';
const baseUrl = () => (process.env.EXPO_PUBLIC_WAFRA_LOCAL_AI_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/u, '');

export const LOCAL_SEMANTIC_RUNTIME_MANIFEST: LocalOnnxInt8ModelManifest = Object.freeze({
  schemaVersion: 1,
  modelVersion: MODEL_VERSION,
  backend: 'onnxruntime-react-native',
  graphFormat: 'onnx',
  quantization: 'dynamic-int8',
  embeddingDimensions: 384,
  maximumCharacters: 1_000,
});

interface ArtifactSpec {
  name: string;
  url: string;
  sha256?: string;
  exactBytes?: number;
}

const ARTIFACTS: readonly ArtifactSpec[] = Object.freeze([
  { name: 'model.int8.onnx', url: `${baseUrl()}/model.int8.onnx`, sha256: MODEL_SHA256, exactBytes: MODEL_BYTES },
  { name: 'tokenizer.json', url: `${baseUrl()}/tokenizer.json`, sha256: '40b7d6f2e0b8b58a8ac14294b122a41560c61db46515a5f05871811892fc5f60', exactBytes: 2_406_512 },
  { name: 'tokenizer_config.json', url: `${baseUrl()}/tokenizer_config.json`, sha256: '606031684b9ac91d380bf254ee9027976904a22e0aa32423cf254f049bb957b2', exactBytes: 1_206 },
]);

const runtimeDirectory = () => {
  const directory = new Directory(Paths.document, 'local-ai', MODEL_VERSION.replace(/[^a-z0-9._-]/giu, '_'));
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  return directory;
};

const sha256Bytes = async (file: File): Promise<string> => {
  const bytes = await file.bytes();
  const digest = new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes));
  return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
};

/**
 * A full SHA-256 of the 34.8 MiB encoder means reading it into JS on every
 * cold launch. After one successful verification a marker next to the file
 * records the hash that was verified; later launches trust exact size plus
 * that marker. The marker is only ever written after a full hash match, and
 * a missing/mismatched marker or size falls back to hashing (then re-download).
 */
const markerFile = (directory: Directory, spec: ArtifactSpec): File =>
  new File(directory, `${spec.name}.verified`);

const verified = async (file: File, spec: ArtifactSpec, marker?: File): Promise<boolean> => {
  if (!file.exists) return false;
  if (spec.exactBytes !== undefined && file.size !== spec.exactBytes) return false;
  if (spec.sha256 === undefined) return file.size > 0;
  if (marker?.exists) {
    try {
      if ((await marker.text()).trim().toLowerCase() === spec.sha256) return true;
    } catch { /* unreadable marker: hash below */ }
  }
  const matches = (await sha256Bytes(file)).toLowerCase() === spec.sha256;
  if (matches && marker) {
    try { marker.write(spec.sha256); } catch { /* marker is an optimization only */ }
  }
  return matches;
};

async function ensureArtifact(spec: ArtifactSpec, checkpoint: () => Promise<void> = () => Promise.resolve()): Promise<File> {
  const directory = runtimeDirectory();
  const target = new File(directory, spec.name);
  const marker = markerFile(directory, spec);
  await checkpoint();
  try {
    if (await verified(target, spec, marker)) return target;
  } catch { /* replace corrupt/unverifiable files below */ }
  if (marker.exists) marker.delete();
  if (target.exists) target.delete();
  const startedAt = Date.now();
  const downloaded = await File.downloadFileAsync(spec.url, target, { idempotent: true });
  metrics.downloadMs += Date.now() - startedAt;
  await checkpoint();
  if (!(await verified(downloaded, spec, marker))) {
    if (downloaded.exists) downloaded.delete();
    throw new Error(`local-semantic-runtime:artifact-verification-failed:${spec.name}`);
  }
  return downloaded;
}

/** Source-free timings: no text, embeddings, amounts or identifiers. */
export interface LocalSemanticRuntimeMetrics {
  downloadMs: number;
  prepareMs: number;
  sessionMs: number;
  encodeCount: number;
  encodeTotalMs: number;
  encodeMaxMs: number;
  failures: number;
}

export interface LocalSemanticRuntimeStatus {
  state: 'not-downloaded' | 'downloading' | 'ready' | 'failed';
  modelVersion: string;
  error: string | null;
  metrics: LocalSemanticRuntimeMetrics;
  /** Epoch ms before which a failed runtime is not retried; null when retryable. */
  retryAfter: number | null;
}

const freshMetrics = (): LocalSemanticRuntimeMetrics => ({
  downloadMs: 0, prepareMs: 0, sessionMs: 0, encodeCount: 0, encodeTotalMs: 0, encodeMaxMs: 0, failures: 0,
});

let metrics = freshMetrics();
let status: Omit<LocalSemanticRuntimeStatus, 'metrics'> = {
  state: 'not-downloaded', modelVersion: MODEL_VERSION, error: null, retryAfter: null,
};
let session: InferenceSessionType | null = null;
const scheduleInference = createLocalSemanticScheduler(32, { backgroundBlockedFor: foregroundHistoryBlockedFor, backgroundGapMs: 40 });

/**
 * A failed download/verification/session must not be retried by every scanned
 * notification or Ask question. Retries back off 1 min → 5 min → 30 min → 2 h.
 */
const RETRY_BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000] as const;
const retryDelay = (failures: number): number =>
  RETRY_BACKOFF_MS[Math.min(failures, RETRY_BACKOFF_MS.length) - 1];

export const localSemanticRuntimeStatus = (): LocalSemanticRuntimeStatus => ({ ...status, metrics: { ...metrics } });

/**
 * `onnxruntime-react-native` calls `install()` on its native module the moment
 * its JavaScript is evaluated. Importing it at the top of this file would make
 * a missing or mis-linked native runtime a launch crash for every user. It is
 * loaded here instead, inside the encoder's failure boundary, so a broken
 * runtime becomes `state: 'failed'` in diagnostics and nothing else.
 */
type OnnxModule = typeof import('onnxruntime-react-native');
let onnxModule: OnnxModule | null = null;
const loadOnnx = async (): Promise<OnnxModule> => {
  onnxModule ??= await import('onnxruntime-react-native');
  return onnxModule;
};

const int64Tensor = (
  Tensor: OnnxModule['Tensor'],
  values: readonly number[],
  sequenceLength: number,
): TensorType => new Tensor('int64', values.map((value) => BigInt(value)), [1, sequenceLength]);

async function createEncoder(controller: LocalSemanticPreparationController): Promise<LocalOnnxInt8TextEncoder> {
  const { cancelled, checkpoint } = controller;
  status = { state: 'downloading', modelVersion: MODEL_VERSION, error: null, retryAfter: null };
  try {
    await checkpoint();
    const { InferenceSession, Tensor } = await loadOnnx();
    const prepareStartedAt = Date.now();
    const [modelFile, tokenizerFile, tokenizerConfigFile] = await settleLocalSemanticArtifacts(
      ARTIFACTS.map((artifact) => ensureArtifact(artifact, checkpoint)),
    );
    await checkpoint();
    const [tokenizerText, tokenizerConfigText] = await Promise.all([tokenizerFile.text(), tokenizerConfigFile.text()]);
    await checkpoint();
    const tokenizer = new Tokenizer(JSON.parse(tokenizerText), JSON.parse(tokenizerConfigText));
    metrics.prepareMs = Date.now() - prepareStartedAt;
    await checkpoint();
    const sessionStartedAt = Date.now();
    const created = await InferenceSession.create(modelFile.uri, {
      graphOptimizationLevel: 'all', executionMode: 'sequential',
    });
    if (cancelled()) {
      await created.release();
      throw new Error('local-semantic-runtime:cancelled');
    }
    session = created;
    metrics.sessionMs = Date.now() - sessionStartedAt;
    const encoder: LocalOnnxInt8TextEncoder = Object.freeze({
      manifest: LOCAL_SEMANTIC_RUNTIME_MANIFEST,
      encode(text: string, options?: LocalSemanticEncodeOptions) {
        const backgroundCancelled = options?.priority === 'background' ? localSemanticBackgroundCancellation() : () => false;
        const cancelled = () => backgroundCancelled() || (options?.cancelled?.() ?? false);
        return scheduleInference(async () => {
          const clean = text.trim().slice(0, LOCAL_SEMANTIC_RUNTIME_MANIFEST.maximumCharacters);
          if (!clean) throw new Error('local-semantic-runtime:empty-input');
          const encodeStartedAt = Date.now();
          const encoded = tokenizer.encode(clean, { return_token_type_ids: true });
          const ids = encoded.ids.slice(0, MAX_TOKENS);
          if (ids.length === 0) throw new Error('local-semantic-runtime:empty-tokens');
          const attention = encoded.attention_mask.slice(0, ids.length);
          const types = (encoded.token_type_ids ?? new Array(ids.length).fill(0)).slice(0, ids.length);
          const outputs = await created.run({
            input_ids: int64Tensor(Tensor, ids, ids.length),
            attention_mask: int64Tensor(Tensor, attention, ids.length),
            token_type_ids: int64Tensor(Tensor, types, ids.length),
          });
          if (cancelled()) throw new Error('local-semantic-runtime:cancelled');
          const hidden = outputs.last_hidden_state;
          if (!hidden || hidden.type !== 'float32' || hidden.dims.length !== 3 ||
              hidden.dims[0] !== 1 || hidden.dims[2] !== 384) {
            throw new Error('local-semantic-runtime:unexpected-output');
          }
          const data = hidden.data as Float32Array;
          const pooled = new Float32Array(384);
          let count = 0;
          for (let token = 0; token < ids.length; token += 1) {
            if (attention[token] !== 1) continue;
            count += 1;
            const offset = token * 384;
            for (let dim = 0; dim < 384; dim += 1) pooled[dim] += data[offset + dim];
          }
          if (count === 0) throw new Error('local-semantic-runtime:empty-mask');
          let norm = 0;
          for (let dim = 0; dim < 384; dim += 1) {
            pooled[dim] /= count;
            norm += pooled[dim] * pooled[dim];
          }
          norm = Math.sqrt(norm);
          if (!Number.isFinite(norm) || norm <= 1e-12) throw new Error('local-semantic-runtime:invalid-embedding');
          for (let dim = 0; dim < 384; dim += 1) pooled[dim] /= norm;
          const elapsed = Date.now() - encodeStartedAt;
          metrics.encodeCount += 1;
          metrics.encodeTotalMs += elapsed;
          if (elapsed > metrics.encodeMaxMs) metrics.encodeMaxMs = elapsed;
          return pooled;
        }, { ...options, cancelled });
      },
    });
    status = { state: 'ready', modelVersion: MODEL_VERSION, error: null, retryAfter: null };
    return encoder;
  } catch (error) {
    if (cancelled() || isLocalSemanticPreparationCancelled(error)) {
      status = { state: 'not-downloaded', modelVersion: MODEL_VERSION, error: null, retryAfter: null };
      throw error;
    }
    metrics.failures += 1;
    status = {
      state: 'failed', modelVersion: MODEL_VERSION,
      error: error instanceof Error ? error.message.slice(0, 160) : 'unknown',
      retryAfter: Date.now() + retryDelay(metrics.failures),
    };
    throw error;
  }
}

const encoderFlight = createLocalSemanticPreparationFlight((controller) => {
  if (status.state === 'failed' && status.retryAfter !== null && Date.now() < status.retryAfter) {
    return Promise.reject(new Error('local-semantic-runtime:retry-backoff'));
  }
  return createEncoder(controller);
}, waitForForegroundHistoryIdle);

export function getLocalSemanticEncoder(options?: { background?: boolean }): Promise<LocalOnnxInt8TextEncoder> {
  return encoderFlight.get(options?.background ?? false);
}

export async function createDownloadedSemanticRetriever(
  index: LocalSemanticPrototypeIndex,
): Promise<LocalSemanticRetriever> {
  return createLocalSemanticRetriever(await getLocalSemanticEncoder(), index);
}

/**
 * E5 is off by default. Installs that downloaded it before keep ~37 MB of
 * model files; remove the whole `local-ai/` folder (model artifacts only, never
 * user data) without first creating it. Never touches an active session.
 */
export function purgeLocalSemanticArtifacts(): void {
  if (session) return;
  const directory = new Directory(Paths.document, 'local-ai');
  if (directory.exists) directory.delete();
}

/** Development/test cleanup only; user data is never stored in this directory. */
export function clearLocalSemanticArtifacts(): void {
  const directory = runtimeDirectory();
  if (directory.exists) directory.delete();
  const released = session;
  session = null;
  encoderFlight.clear();
  metrics = freshMetrics();
  status = { state: 'not-downloaded', modelVersion: MODEL_VERSION, error: null, retryAfter: null };
  void released?.release().catch(() => undefined);
}
