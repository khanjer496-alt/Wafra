import { Directory, File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { InferenceSession, Tensor } from 'onnxruntime-react-native';
import { Tokenizer } from '@huggingface/tokenizers';

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

const verified = async (file: File, spec: ArtifactSpec): Promise<boolean> => {
  if (!file.exists) return false;
  if (spec.exactBytes !== undefined && file.size !== spec.exactBytes) return false;
  if (spec.sha256 !== undefined) return (await sha256Bytes(file)).toLowerCase() === spec.sha256;
  return file.size > 0;
};

async function ensureArtifact(spec: ArtifactSpec): Promise<File> {
  const directory = runtimeDirectory();
  const target = new File(directory, spec.name);
  try {
    if (await verified(target, spec)) return target;
  } catch { /* replace corrupt/unverifiable files below */ }
  if (target.exists) target.delete();
  const downloaded = await File.downloadFileAsync(spec.url, target, { idempotent: true });
  if (!(await verified(downloaded, spec))) {
    if (downloaded.exists) downloaded.delete();
    throw new Error(`local-semantic-runtime:artifact-verification-failed:${spec.name}`);
  }
  return downloaded;
}

export interface LocalSemanticRuntimeStatus {
  state: 'not-downloaded' | 'downloading' | 'ready' | 'failed';
  modelVersion: string;
  error: string | null;
}

let status: LocalSemanticRuntimeStatus = {
  state: 'not-downloaded', modelVersion: MODEL_VERSION, error: null,
};
let encoderPromise: Promise<LocalOnnxInt8TextEncoder> | null = null;

export const localSemanticRuntimeStatus = (): LocalSemanticRuntimeStatus => ({ ...status });

const int64Tensor = (values: readonly number[], sequenceLength: number): Tensor =>
  new Tensor('int64', values.map((value) => BigInt(value)), [1, sequenceLength]);

async function createEncoder(): Promise<LocalOnnxInt8TextEncoder> {
  status = { state: 'downloading', modelVersion: MODEL_VERSION, error: null };
  try {
    const [modelFile, tokenizerFile, tokenizerConfigFile] = await Promise.all(
      ARTIFACTS.map((artifact) => ensureArtifact(artifact)),
    );
    const [tokenizerJson, tokenizerConfig] = await Promise.all([
      tokenizerFile.text().then(JSON.parse), tokenizerConfigFile.text().then(JSON.parse),
    ]);
    const tokenizer = new Tokenizer(tokenizerJson, tokenizerConfig);
    const session = await InferenceSession.create(modelFile.uri, {
      graphOptimizationLevel: 'all', executionMode: 'sequential',
    });
    const encoder: LocalOnnxInt8TextEncoder = Object.freeze({
      manifest: LOCAL_SEMANTIC_RUNTIME_MANIFEST,
      async encode(text: string) {
        const clean = text.trim().slice(0, LOCAL_SEMANTIC_RUNTIME_MANIFEST.maximumCharacters);
        if (!clean) throw new Error('local-semantic-runtime:empty-input');
        const encoded = tokenizer.encode(clean, { return_token_type_ids: true });
        const ids = encoded.ids.slice(0, MAX_TOKENS);
        if (ids.length === 0) throw new Error('local-semantic-runtime:empty-tokens');
        const attention = encoded.attention_mask.slice(0, ids.length);
        const types = (encoded.token_type_ids ?? new Array(ids.length).fill(0)).slice(0, ids.length);
        const outputs = await session.run({
          input_ids: int64Tensor(ids, ids.length),
          attention_mask: int64Tensor(attention, ids.length),
          token_type_ids: int64Tensor(types, ids.length),
        });
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
        return pooled;
      },
    });
    status = { state: 'ready', modelVersion: MODEL_VERSION, error: null };
    return encoder;
  } catch (error) {
    status = {
      state: 'failed', modelVersion: MODEL_VERSION,
      error: error instanceof Error ? error.message.slice(0, 160) : 'unknown',
    };
    throw error;
  }
}

export function getLocalSemanticEncoder(): Promise<LocalOnnxInt8TextEncoder> {
  encoderPromise ??= createEncoder().catch((error) => {
    encoderPromise = null;
    throw error;
  });
  return encoderPromise;
}

export async function createDownloadedSemanticRetriever(
  index: LocalSemanticPrototypeIndex,
): Promise<LocalSemanticRetriever> {
  return createLocalSemanticRetriever(await getLocalSemanticEncoder(), index);
}

/** Development/test cleanup only; user data is never stored in this directory. */
export function clearLocalSemanticArtifacts(): void {
  const directory = runtimeDirectory();
  if (directory.exists) directory.delete();
  encoderPromise = null;
  status = { state: 'not-downloaded', modelVersion: MODEL_VERSION, error: null };
}
