import { LOCAL_ASSISTANT_PROTOTYPE_INDEX } from '@/lib/local-semantic-bundle';
import { chooseLocalSemanticAssistantPlan, createLocalSemanticRetriever } from '@/lib/local-semantic-model';
import { getLocalSemanticEncoder, localSemanticRuntimeStatus } from '@/lib/local-semantic-runtime';
import type { Period } from '@/lib/period';
import type { AssistantToolRequest } from '@/lib/wafra-assistant';

/**
 * Ask Wafra uses E5 only when the deterministic planner fell all the way back
 * to plain Help. Existing deterministic parses and conversation follow-ups stay
 * authoritative. The model chooses a closed local tool; ledger math remains in
 * Wafra's deterministic executor.
 */
export async function improveAssistantRequestLocally(input: {
  question: string;
  deterministicRequest: AssistantToolRequest;
  previousRequest?: AssistantToolRequest | null;
  defaultPeriod: Period;
  currentPeriod: Period;
  cancelled?: () => boolean;
  groundRequest?: (candidate: AssistantToolRequest) => AssistantToolRequest;
}): Promise<AssistantToolRequest> {
  if (input.deterministicRequest.tool !== 'help' || input.previousRequest || input.cancelled?.()) {
    return input.deterministicRequest;
  }
  if (localSemanticRuntimeStatus().state !== 'ready') {
    void getLocalSemanticEncoder().catch(() => undefined);
    return input.deterministicRequest;
  }
  try {
    const encoder = await getLocalSemanticEncoder();
    const retriever = createLocalSemanticRetriever(encoder, LOCAL_ASSISTANT_PROTOTYPE_INDEX);
    const plan = await chooseLocalSemanticAssistantPlan({
      question: input.question,
      deterministicRequest: input.deterministicRequest,
      previousRequest: input.previousRequest,
      defaultPeriod: input.defaultPeriod,
      currentPeriod: input.currentPeriod,
      retriever,
      cancelled: input.cancelled,
      groundRequest: input.groundRequest,
    });
    return plan.request;
  } catch {
    return input.deterministicRequest;
  }
}

