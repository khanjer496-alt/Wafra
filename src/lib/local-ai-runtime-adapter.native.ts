import { Platform } from 'react-native';
import { initLlama, toggleNativeLog, type LlamaContext } from 'llama.rn';

import {
  LOCAL_AI_JSON_SCHEMA,
  LOCAL_AI_SYSTEM_PROMPT,
  parseLocalAiVerdict,
  type LocalAiVerdict,
} from '@/lib/local-ai-contract';
import {
  ASSISTANT_PLAN_SCHEMA,
  assistantPlanFitsQuestion,
  assistantSystemPrompt,
  parseAssistantPlan,
  type AssistantPlan,
  type AssistantPlanningContext,
} from '@/lib/assistant-contract';
import LocalAiModel from '@/lib/local-ai-model-adapter';
import type { LocalAiRuntimeAdapter, LocalAiRuntimeProgress } from '@/lib/local-ai-runtime';

const MAX_ALERT_CHARS = 4096;
let context: LlamaContext | null = null;
let loading: Promise<LlamaContext> | null = null;
let operationQueue: Promise<void> = Promise.resolve();

const withRuntimeLock = async <T>(operation: () => Promise<T>): Promise<T> => {
  const previous = operationQueue;
  let unlock = () => {};
  operationQueue = new Promise<void>((resolve) => { unlock = resolve; });
  await previous;
  try {
    return await operation();
  } finally {
    unlock();
  }
};

async function getContext(
  onProgress?: (progress: LocalAiRuntimeProgress) => void,
): Promise<LlamaContext> {
  if (context) return context;
  if (loading) return loading;
  loading = (async () => {
    await toggleNativeLog(false);
    const path = await LocalAiModel.verifiedPath((progress) => {
      onProgress?.({ phase: 'verifying', completed: progress.completed, total: progress.total });
    });
    onProgress?.({ phase: 'loading', completed: 0, total: 100 });
    const loaded = await initLlama({
      model: path,
      n_ctx: 2048,
      n_batch: 256,
      n_ubatch: 128,
      n_threads: 4,
      // Metal is mature on iOS. The evaluation build deliberately keeps
      // Android on the compatible CPU path until device-specific GPU coverage
      // exists; no one should trade correct parsing for a fast crash.
      n_gpu_layers: Platform.OS === 'ios' ? 99 : 0,
      use_mmap: true,
      use_mlock: false,
      flash_attn_type: Platform.OS === 'ios' ? 'auto' : 'off',
    }, (progress) => onProgress?.({ phase: 'loading', completed: progress, total: 100 }));
    context = loaded;
    return loaded;
  })();
  try {
    return await loading;
  } finally {
    loading = null;
  }
}

async function classify(
  source: string,
  onProgress?: (progress: LocalAiRuntimeProgress) => void,
): Promise<LocalAiVerdict | null> {
  return withRuntimeLock(async () => {
    const trimmed = source.trim();
    if (!trimmed || trimmed.length > MAX_ALERT_CHARS) return null;
    const llama = await getContext(onProgress);
    await llama.clearCache(true);
    try {
      const result = await llama.completion({
        messages: [
          { role: 'system', content: LOCAL_AI_SYSTEM_PROMPT },
          { role: 'user', content: `Alert: ${trimmed}` },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { strict: true, schema: LOCAL_AI_JSON_SCHEMA },
        },
        n_predict: 96,
        temperature: 0,
        top_k: 1,
        top_p: 1,
        min_p: 0,
        seed: 42,
        enable_thinking: false,
      });
      const raw = result.content || result.text;
      try {
        return parseLocalAiVerdict(JSON.parse(raw));
      } catch {
        return null;
      }
    } finally {
      // Prompt text must not survive in the model's cross-request KV cache.
      await llama.clearCache(true).catch(() => {});
    }
  });
}

async function plan(
  question: string,
  planningContext: AssistantPlanningContext,
  onProgress?: (progress: LocalAiRuntimeProgress) => void,
): Promise<AssistantPlan | null> {
  return withRuntimeLock(async () => {
    const trimmed = question.trim();
    if (!trimmed || trimmed.length > 600) return null;
    const llama = await getContext(onProgress);
    await llama.clearCache(true);
    try {
      const result = await llama.completion({
        messages: [
          {
            role: 'system',
            content: assistantSystemPrompt({
              ...planningContext,
              accounts: planningContext.accounts.slice(0, 40),
            }),
          },
          { role: 'user', content: trimmed },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { strict: true, schema: ASSISTANT_PLAN_SCHEMA },
        },
        n_predict: 220,
        temperature: 0,
        top_k: 1,
        top_p: 1,
        min_p: 0,
        seed: 42,
        enable_thinking: false,
      });
      const raw = result.content || result.text;
      try {
        const parsed = parseAssistantPlan(JSON.parse(raw));
        return parsed && assistantPlanFitsQuestion(parsed, trimmed) ? parsed : null;
      } catch {
        return null;
      }
    } finally {
      // Questions and account display names never survive the request.
      await llama.clearCache(true).catch(() => {});
    }
  });
}

async function release(): Promise<void> {
  await withRuntimeLock(async () => {
    const loaded = context;
    context = null;
    if (loaded) await loaded.release();
  });
}

const LocalAiRuntime: LocalAiRuntimeAdapter = { classify, plan, release };
export default LocalAiRuntime;
