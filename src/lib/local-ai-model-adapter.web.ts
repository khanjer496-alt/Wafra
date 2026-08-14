import type { LocalAiModelAdapter } from '@/lib/local-ai-model';

const unsupported = async (): Promise<never> => {
  throw new Error('local-ai-unsupported');
};

const LocalAiModel: LocalAiModelAdapter = {
  status: async () => ({ state: 'unsupported' }),
  download: unsupported,
  verifiedPath: unsupported,
  remove: async () => {},
};

export default LocalAiModel;
