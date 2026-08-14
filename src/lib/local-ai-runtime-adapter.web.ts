import type { LocalAiRuntimeAdapter } from '@/lib/local-ai-runtime';

const LocalAiRuntime: LocalAiRuntimeAdapter = {
  classify: async () => null,
  plan: async () => null,
  release: async () => {},
};

export default LocalAiRuntime;
