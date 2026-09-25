/**
 * On-device alert tagger runtime (download-on-demand; never bundled).
 *
 * DELIVERY
 *  - Nothing downloads on install, launch, capture or import. The person
 *    starts the download in Settings (downloadAiAlertModel). Wi-Fi only by
 *    default: the caller must pass the current network type; 'unknown' is
 *    treated as NOT Wi-Fi, so without an explicit "use mobile data" choice
 *    nothing is fetched.
 *  - Every artifact is pinned by exact byte size and SHA-256 in this file
 *    (AI_ALERT_MODEL_MANIFEST). A file whose size/hash differs is deleted and
 *    never loaded. The download URL base may be overridden at build time
 *    (EXPO_PUBLIC_WAFRA_AI_ALERT_MODEL_BASE_URL) without changing the hashes.
 *  - Hard ceiling: MAX_TOTAL_BYTES; a manifest above it is rejected.
 *  - deleteAiAlertModel removes the whole folder (model files only).
 *
 * RUNTIME
 *  - onnxruntime-react-native is imported lazily inside the failure boundary
 *    (same pattern as local-semantic-runtime.native.ts), so a missing native
 *    runtime becomes state 'failed', never a launch crash.
 *  - Words come from ai-alert-words.ts (identical to training); each word is
 *    encoded separately and its first piece is read, so spans are exact
 *    UTF-16 offsets into the source. Probabilities are temperature-calibrated
 *    with the manifest's per-head temperatures.
 *  - No text, spans or predictions are logged or persisted.
 */
import { Directory, File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import type { InferenceSession as InferenceSessionType } from 'onnxruntime-react-native';
import { Tokenizer } from '@huggingface/tokenizers';

import { alertWords } from '@/lib/ai-alert-words';
import type { AiAlertPrediction, AiSpan, AiSpanLabel } from '@/lib/ai-alert-extractor';
import {
  AI_ALERT_MODEL_MANIFEST,
  MAX_TOTAL_BYTES,
  type AiAlertModelStatus,
  type AiAlertNetworkType,
} from '@/lib/ai-alert-model-manifest';

export { AI_ALERT_MODEL_MANIFEST } from '@/lib/ai-alert-model-manifest';
export type { AiAlertModelStatus, AiAlertNetworkType } from '@/lib/ai-alert-model-manifest';

const baseUrl = (): string =>
  (process.env.EXPO_PUBLIC_WAFRA_AI_ALERT_MODEL_BASE_URL ?? AI_ALERT_MODEL_MANIFEST.defaultBaseUrl).replace(/\/$/u, '');

const folder = (): Directory => new Directory(Paths.document, 'ai-alert-model', AI_ALERT_MODEL_MANIFEST.version);

const sha256 = async (file: File): Promise<string> => {
  const digest = new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, await file.bytes()));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
};

let state: AiAlertModelStatus['state'] = 'not-downloaded';
let lastError: string | null = null;
let session: InferenceSessionType | null = null;
let tokenizer: Tokenizer | null = null;
let loading: Promise<boolean> | null = null;
let downloading: Promise<AiAlertModelStatus> | null = null;

const artifactsPresent = (): boolean => {
  const dir = folder();
  if (!dir.exists) return false;
  return AI_ALERT_MODEL_MANIFEST.artifacts.every((a) => {
    const f = new File(dir, a.name);
    return f.exists && f.size === a.bytes;
  });
};

// Probe the disk once per process (and after download/delete), not per alert.
let probed = false;

export function aiAlertModelStatus(): AiAlertModelStatus {
  if (state === 'not-downloaded' && !probed) {
    probed = true;
    if (artifactsPresent()) state = 'downloaded';
  }
  return {
    state,
    version: AI_ALERT_MODEL_MANIFEST.version,
    downloadBytes: AI_ALERT_MODEL_MANIFEST.artifacts.reduce((sum, a) => sum + a.bytes, 0),
    error: lastError,
  };
}

/**
 * Person-initiated download. Wi-Fi only unless allowCellular is true.
 * Returns the resulting status; never throws.
 */
export function downloadAiAlertModel(options: { networkType: AiAlertNetworkType; allowCellular?: boolean }): Promise<AiAlertModelStatus> {
  if (options.networkType !== 'wifi' && !(options.allowCellular && options.networkType === 'cellular')) {
    return Promise.resolve({ ...aiAlertModelStatus(), error: 'wifi-required' });
  }
  downloading ??= (async () => {
    const total = AI_ALERT_MODEL_MANIFEST.artifacts.reduce((sum, a) => sum + a.bytes, 0);
    if (total > MAX_TOTAL_BYTES) {
      lastError = 'manifest-too-large';
      state = 'failed';
      return aiAlertModelStatus();
    }
    state = 'downloading';
    lastError = null;
    try {
      const dir = folder();
      if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
      for (const artifact of AI_ALERT_MODEL_MANIFEST.artifacts) {
        const target = new File(dir, artifact.name);
        if (target.exists && target.size === artifact.bytes && (await sha256(target)) === artifact.sha256) continue;
        if (target.exists) target.delete();
        const file = await File.downloadFileAsync(`${baseUrl()}/${artifact.name}`, target, { idempotent: true });
        if (file.size !== artifact.bytes || (await sha256(file)) !== artifact.sha256) {
          if (file.exists) file.delete();
          throw new Error(`ai-alert-model:verification-failed:${artifact.name}`);
        }
      }
      state = 'downloaded';
    } catch (error) {
      state = 'failed';
      lastError = error instanceof Error ? error.message.slice(0, 120) : 'unknown';
    }
    probed = true;
    return aiAlertModelStatus();
  })().finally(() => { downloading = null; });
  return downloading;
}

/** Remove the model (files only; no user data lives there). */
export async function deleteAiAlertModel(): Promise<void> {
  const released = session;
  session = null;
  tokenizer = null;
  loading = null;
  state = 'not-downloaded';
  lastError = null;
  probed = true;
  try { await released?.release(); } catch { /* already released */ }
  const root = new Directory(Paths.document, 'ai-alert-model');
  if (root.exists) root.delete();
}

type OnnxModule = typeof import('onnxruntime-react-native');
let onnx: OnnxModule | null = null;

async function ensureLoaded(): Promise<boolean> {
  if (session && tokenizer) return true;
  // A failed load is not retried per alert (that would re-hash 30+ MB each
  // time); a new download or an app restart retries.
  if (state === 'failed' || state === 'downloading' || !artifactsPresent()) return false;
  loading ??= (async () => {
    try {
      const dir = folder();
      // Re-verify hashes once per process before the first load.
      for (const artifact of AI_ALERT_MODEL_MANIFEST.artifacts) {
        if ((await sha256(new File(dir, artifact.name))) !== artifact.sha256) {
          await deleteAiAlertModel();
          throw new Error('ai-alert-model:hash-mismatch');
        }
      }
      onnx ??= await import('onnxruntime-react-native');
      const tokenizerJson = JSON.parse(await new File(dir, 'tokenizer.json').text());
      const tokenizerConfig = JSON.parse(await new File(dir, 'tokenizer_config.json').text());
      tokenizer = new Tokenizer(tokenizerJson, tokenizerConfig);
      session = await onnx.InferenceSession.create(new File(dir, 'tagger.int8.onnx').uri, {
        graphOptimizationLevel: 'all', executionMode: 'sequential', intraOpNumThreads: 1,
      });
      state = 'ready';
      return true;
    } catch (error) {
      state = 'failed';
      lastError = error instanceof Error ? error.message.slice(0, 120) : 'unknown';
      session = null;
      tokenizer = null;
      return false;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

const softmax = (row: Float32Array | number[], temperature: number): number[] => {
  let max = -Infinity;
  for (const v of row) max = Math.max(max, v / temperature);
  const exps = Array.from(row, (v) => Math.exp(v / temperature - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((v) => v / sum);
};
const argmax = (p: number[]): number => p.reduce((best, v, i) => (v > p[best] ? i : best), 0);

/**
 * Read one alert. Resolves null when the model is not downloaded/ready or
 * anything fails; never throws, never downloads.
 */
export async function readAlertWithModel(source: string): Promise<AiAlertPrediction | null> {
  try {
    if (typeof source !== 'string' || !source.trim() || source.length > 1200) return null;
    if (!(await ensureLoaded()) || !session || !tokenizer || !onnx) return null;
    const m = AI_ALERT_MODEL_MANIFEST.labels;
    const ids: number[] = [m.clsId];
    const first: number[] = [];
    const words = [] as { start: number; end: number }[];
    for (const word of alertWords(source)) {
      const pieces = tokenizer.encode(word.text, { add_special_tokens: false }).ids;
      const use = pieces.length ? pieces : [m.unkId];
      if (ids.length + use.length + 1 > m.maxTokens) break;
      first.push(ids.length);
      ids.push(...use);
      words.push({ start: word.start, end: word.end });
    }
    ids.push(m.sepId);
    const tensor = (values: number[]) => new onnx!.Tensor('int64', values.map((v) => BigInt(v)), [1, values.length]);
    const out = await session.run({ input_ids: tensor(ids), attention_mask: tensor(ids.map(() => 1)) });
    const T = AI_ALERT_MODEL_MANIFEST.temperatures;
    const tags = out.tags.data as Float32Array;
    const nTags = m.tags.length;
    const spans: AiSpan[] = [];
    let current: AiSpan | null = null;
    first.forEach((tokenIndex, w) => {
      const p = softmax(tags.subarray(tokenIndex * nTags, (tokenIndex + 1) * nTags), T.tags);
      const k = argmax(p);
      const name = m.tags[k];
      if (name === 'O') { current = null; return; }
      const [bio, label] = name.split('-') as ['B' | 'I', AiSpanLabel];
      if (current && current.label === label && bio === 'I') {
        current.end = words[w].end;
        current.p = Math.min(current.p, p[k]);
      } else {
        current = { label, start: words[w].start, end: words[w].end, p: p[k] };
        spans.push(current);
      }
    });
    const head = (name: 'status' | 'family' | 'direction') => softmax(out[name].data as Float32Array, T[name]);
    const status = head('status');
    const family = head('family');
    const direction = head('direction');
    if (![...status, ...family, ...direction].every(Number.isFinite) || spans.some((s) => !Number.isFinite(s.p))) return null;
    return {
      engine: 'tagger',
      modelVersion: AI_ALERT_MODEL_MANIFEST.version,
      status: m.statuses[argmax(status)],
      statusP: status[argmax(status)],
      family: m.families[argmax(family)],
      familyP: family[argmax(family)],
      direction: m.directions[argmax(direction)],
      directionP: direction[argmax(direction)],
      spans,
    };
  } catch {
    return null;
  }
}
