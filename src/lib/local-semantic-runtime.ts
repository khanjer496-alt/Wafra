import type {
  LocalOnnxInt8ModelManifest,
  LocalOnnxInt8TextEncoder,
  LocalSemanticPrototypeIndex,
  LocalSemanticRetriever,
} from '@/lib/local-semantic-model';

/** Web/Node fail-closed stub. React Native resolves local-semantic-runtime.native.ts. */
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
  throw new Error('local-semantic-runtime:native-only');
}

export async function createDownloadedSemanticRetriever(
  _index: LocalSemanticPrototypeIndex,
): Promise<LocalSemanticRetriever> {
  throw new Error('local-semantic-runtime:native-only');
}

export function clearLocalSemanticArtifacts(): void { /* native-only */ }

export function purgeLocalSemanticArtifacts(): void { /* native-only */ }
