import type { WafraHistoryNativeModule } from './WafraMessageHistory.types';

const unavailable: WafraHistoryNativeModule = {
  async listSessionChunks() {
    return [];
  },
  async readChunk() {
    return [];
  },
  async discardSession() {},
  async purgeExpired() {
    return 0;
  },
};

export default unavailable;
