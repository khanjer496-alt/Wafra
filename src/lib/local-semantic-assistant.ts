import type { Period } from '@/lib/period';
import type { AssistantToolRequest } from '@/lib/wafra-assistant';

/** Web/Node fail-closed stub. Native implementation is selected on device. */
export async function improveAssistantRequestLocally(input: {
  question: string;
  deterministicRequest: AssistantToolRequest;
  previousRequest?: AssistantToolRequest | null;
  defaultPeriod: Period;
  currentPeriod: Period;
  cancelled?: () => boolean;
}): Promise<AssistantToolRequest> {
  return input.deterministicRequest;
}

