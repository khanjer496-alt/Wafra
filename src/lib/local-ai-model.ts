export const LOCAL_AI_EVALUATION_ENABLED =
  process.env.EXPO_PUBLIC_WAFRA_LOCAL_AI_EVAL === '1';

/**
 * Pinned public artifact. The model is not bundled with Wafra and is not
 * considered accurate enough for ledger use; it exists to evaluate the local
 * runtime on real iOS/Android hardware.
 */
export const LOCAL_AI_MODEL = {
  id: 'qwen2.5-1.5b-instruct-q4-k-m',
  displayName: 'Qwen2.5 1.5B · Q4_K_M',
  version: 1,
  bytes: 1_117_320_736,
  sha256: '6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e',
  url: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/91cad51170dc346986eccefdc2dd33a9da36ead9/qwen2.5-1.5b-instruct-q4_k_m.gguf?download=true',
  license: 'Apache-2.0',
  evaluationOnly: true,
} as const;

export type LocalAiModelPhase = 'checking' | 'downloading' | 'verifying';

export interface LocalAiModelProgress {
  phase: LocalAiModelPhase;
  completed: number;
  total: number;
}

export type LocalAiModelStatus =
  | { state: 'disabled' | 'unsupported' | 'missing' }
  | { state: 'installed'; bytes: number; verifiedThisProcess: boolean }
  | { state: 'invalid'; reason: 'size' | 'integrity' | 'metadata' };

export interface LocalAiModelAdapter {
  status(): Promise<LocalAiModelStatus>;
  download(onProgress?: (progress: LocalAiModelProgress) => void): Promise<string>;
  verifiedPath(onProgress?: (progress: LocalAiModelProgress) => void): Promise<string>;
  remove(): Promise<void>;
}
