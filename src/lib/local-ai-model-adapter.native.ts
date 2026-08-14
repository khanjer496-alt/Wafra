import { Directory, File, Paths } from 'expo-file-system';
import { sha256 } from '@noble/hashes/sha2.js';

import {
  LOCAL_AI_EVALUATION_ENABLED,
  LOCAL_AI_MODEL,
  type LocalAiModelAdapter,
  type LocalAiModelProgress,
  type LocalAiModelStatus,
} from '@/lib/local-ai-model';

const DIRECTORY_NAME = 'wafra-local-ai';
const MODEL_NAME = `${LOCAL_AI_MODEL.id}.gguf`;
const PART_NAME = `${MODEL_NAME}.part`;
const RECEIPT_NAME = `${MODEL_NAME}.verified`;
const HASH_CHUNK_BYTES = 4 * 1024 * 1024;
const REQUIRED_HEADROOM_BYTES = 512 * 1024 * 1024;

let verifiedThisProcess = false;

const directory = () => new Directory(Paths.cache, DIRECTORY_NAME);
const modelFile = () => new File(directory(), MODEL_NAME);
const partFile = () => new File(directory(), PART_NAME);
const receiptFile = () => new File(directory(), RECEIPT_NAME);
const receiptValue = () => [
  LOCAL_AI_MODEL.id,
  LOCAL_AI_MODEL.version,
  LOCAL_AI_MODEL.bytes,
  LOCAL_AI_MODEL.sha256,
].join('\n');

function ensureDirectory(): void {
  directory().create({ intermediates: true, idempotent: true });
}

function removeIfPresent(file: File): void {
  if (file.exists) file.delete();
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

async function yieldToUi(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function verifyFile(
  file: File,
  onProgress?: (progress: LocalAiModelProgress) => void,
): Promise<boolean> {
  if (!file.exists || file.size !== LOCAL_AI_MODEL.bytes) return false;
  const digest = sha256.create();
  const handle = file.open();
  let completed = 0;
  try {
    while (completed < LOCAL_AI_MODEL.bytes) {
      const chunk = handle.readBytes(Math.min(HASH_CHUNK_BYTES, LOCAL_AI_MODEL.bytes - completed));
      if (chunk.length === 0) return false;
      digest.update(chunk);
      completed += chunk.length;
      onProgress?.({ phase: 'verifying', completed, total: LOCAL_AI_MODEL.bytes });
      // Hashing a gigabyte synchronously would freeze navigation and can make
      // Android report an ANR. FileHandle keeps memory bounded; yielding keeps
      // the screen responsive without weakening the final digest.
      if ((completed / HASH_CHUNK_BYTES) % 8 === 0) await yieldToUi();
    }
  } finally {
    handle.close();
  }
  return bytesToHex(digest.digest()) === LOCAL_AI_MODEL.sha256;
}

async function status(): Promise<LocalAiModelStatus> {
  if (!LOCAL_AI_EVALUATION_ENABLED) return { state: 'disabled' };
  const file = modelFile();
  if (!file.exists) return { state: 'missing' };
  if (file.size !== LOCAL_AI_MODEL.bytes) return { state: 'invalid', reason: 'size' };
  const receipt = receiptFile();
  if (!receipt.exists || receipt.textSync() !== receiptValue()) {
    return { state: 'invalid', reason: 'metadata' };
  }
  return { state: 'installed', bytes: file.size, verifiedThisProcess };
}

async function verifiedPath(
  onProgress?: (progress: LocalAiModelProgress) => void,
): Promise<string> {
  if (!LOCAL_AI_EVALUATION_ENABLED) throw new Error('local-ai-disabled');
  const current = await status();
  if (current.state !== 'installed') throw new Error('local-ai-model-missing');
  if (!verifiedThisProcess) {
    const valid = await verifyFile(modelFile(), onProgress);
    if (!valid) {
      removeIfPresent(receiptFile());
      throw new Error('local-ai-model-integrity');
    }
    verifiedThisProcess = true;
  }
  return modelFile().uri;
}

async function download(
  onProgress?: (progress: LocalAiModelProgress) => void,
): Promise<string> {
  if (!LOCAL_AI_EVALUATION_ENABLED) throw new Error('local-ai-disabled');
  ensureDirectory();
  removeIfPresent(partFile());
  if (Paths.availableDiskSpace < LOCAL_AI_MODEL.bytes + REQUIRED_HEADROOM_BYTES) {
    throw new Error('local-ai-storage');
  }
  onProgress?.({ phase: 'downloading', completed: 0, total: LOCAL_AI_MODEL.bytes });
  try {
    await File.downloadFileAsync(LOCAL_AI_MODEL.url, partFile(), { idempotent: true });
    if (partFile().size !== LOCAL_AI_MODEL.bytes) throw new Error('local-ai-model-size');
    if (!(await verifyFile(partFile(), onProgress))) throw new Error('local-ai-model-integrity');
    removeIfPresent(modelFile());
    partFile().move(modelFile());
    removeIfPresent(receiptFile());
    receiptFile().create();
    receiptFile().write(receiptValue());
    verifiedThisProcess = true;
    return modelFile().uri;
  } catch (error) {
    removeIfPresent(partFile());
    throw error;
  }
}

async function remove(): Promise<void> {
  verifiedThisProcess = false;
  removeIfPresent(partFile());
  removeIfPresent(modelFile());
  removeIfPresent(receiptFile());
}

const LocalAiModel: LocalAiModelAdapter = { status, download, verifiedPath, remove };
export default LocalAiModel;
