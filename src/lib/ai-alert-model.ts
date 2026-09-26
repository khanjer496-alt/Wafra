/**
 * Web/Node stub of the on-device alert tagger (React Native resolves
 * ai-alert-model.native.ts). It never has a model, so every caller behaves
 * exactly as it did before the AI reader existed.
 */
import type { AiAlertPrediction } from '@/lib/ai-alert-extractor';
import {
  AI_ALERT_MODEL_MANIFEST,
  type AiAlertModelStatus,
  type AiAlertNetworkType,
} from '@/lib/ai-alert-model-manifest';

export { AI_ALERT_MODEL_MANIFEST } from '@/lib/ai-alert-model-manifest';
export type { AiAlertModelStatus, AiAlertNetworkType } from '@/lib/ai-alert-model-manifest';

export function aiAlertModelStatus(): AiAlertModelStatus {
  return {
    state: 'not-downloaded',
    version: AI_ALERT_MODEL_MANIFEST.version,
    downloadBytes: AI_ALERT_MODEL_MANIFEST.artifacts.reduce((sum, a) => sum + a.bytes, 0),
    error: null,
  };
}

export async function downloadAiAlertModel(_options: { networkType: AiAlertNetworkType; allowCellular?: boolean }): Promise<AiAlertModelStatus> {
  return { ...aiAlertModelStatus(), error: 'native-only' };
}

export async function deleteAiAlertModel(): Promise<void> { /* native-only */ }

export async function readAlertWithModel(_source: string): Promise<AiAlertPrediction | null> {
  return null;
}
