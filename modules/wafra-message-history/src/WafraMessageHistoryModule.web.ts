import type { WafraHistoryNativeModule } from './WafraMessageHistory.types';

const unavailable: WafraHistoryNativeModule = {
  async getCompletedSession() {
    return null;
  },
  async recoverCompletedSession() {
    return null;
  },
  async readChunk() {
    return [];
  },
  async discardSession() {},
  async purgeExpired() {
    return 0;
  },
  async eraseAll() {},
};

export default unavailable;
