import type { LocalAiVerdict } from '@/lib/local-ai-contract';
import type {
  AssistantPlan,
  AssistantPlanningContext,
} from '@/lib/assistant-contract';

export interface LocalAiRuntimeProgress {
  phase: 'verifying' | 'loading';
  completed: number;
  total: number;
}

export interface LocalAiRuntimeAdapter {
  classify(
    source: string,
    onProgress?: (progress: LocalAiRuntimeProgress) => void,
  ): Promise<LocalAiVerdict | null>;
  /** Interpret a question into one closed, read-only ledger query. */
  plan(
    question: string,
    context: AssistantPlanningContext,
    onProgress?: (progress: LocalAiRuntimeProgress) => void,
  ): Promise<AssistantPlan | null>;
  release(): Promise<void>;
}
