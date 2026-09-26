import { Directory, Paths } from 'expo-file-system';

import type {
  LocalOnnxInt8ModelManifest,
  LocalOnnxInt8TextEncoder,
  LocalSemanticPrototypeIndex,
  LocalSemanticRetriever,
} from '@/lib/local-semantic-model';

/**
 * The downloaded E5 encoder and its ONNX Runtime were removed from the app
 * (docs/local-semantic-runtime.md). Native builds now fail closed exactly like
 * the web stub in local-semantic-runtime.ts, so every shadow, review and Ask
 * path stays on its deterministic route. The only native work left is
 * deleting model files that older installs downloaded.
 */
export const LOCAL_SEMANTIC_RUNTIME_MANIFEST: LocalOnnxInt8ModelManifest = Object.freeze({
  schemaVersion: 1,
  modelVersion: 'e5-arb-32768@e1b3907e6c83#int8-70fd5ee627d2',
  backend: 'onnxruntime-react-native',
  graphFormat: 'onnx',
  quantization: 'dynamic-int8',
  embeddingDimensions: 384,
  maximumCharacters: 1_000,
});

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
  retryAfter: number | null;
}

export const localSemanticRuntimeStatus = (): LocalSemanticRuntimeStatus => ({
  state: 'not-downloaded',
  modelVersion: LOCAL_SEMANTIC_RUNTIME_MANIFEST.modelVersion,
  error: null,
  metrics: { downloadMs: 0, prepareMs: 0, sessionMs: 0, encodeCount: 0, encodeTotalMs: 0, encodeMaxMs: 0, failures: 0 },
  retryAfter: null,
});

export async function getLocalSemanticEncoder(_options?: { background?: boolean }): Promise<LocalOnnxInt8TextEncoder> {
  throw new Error('local-semantic-runtime:removed');
}

export async function createDownloadedSemanticRetriever(
  _index: LocalSemanticPrototypeIndex,
): Promise<LocalSemanticRetriever> {
  throw new Error('local-semantic-runtime:removed');
}

/**
 * Installs that downloaded E5 before keep ~37 MB of model files; remove the
 * whole `local-ai/` folder (model artifacts only, never user data) without
 * first creating it.
 */
export function purgeLocalSemanticArtifacts(): void {
  const directory = new Directory(Paths.document, 'local-ai');
  if (directory.exists) directory.delete();
}

export function clearLocalSemanticArtifacts(): void {
  purgeLocalSemanticArtifacts();
}
