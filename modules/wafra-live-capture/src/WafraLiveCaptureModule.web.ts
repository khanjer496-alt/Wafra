import type { WafraLiveCaptureNativeModule } from './WafraLiveCapture.types';

const unavailable = (): never => {
  throw new Error('Wafra live capture is unavailable on this platform.');
};

const WafraLiveCaptureModule: WafraLiveCaptureNativeModule = {
  async setLocalCaptureEntitlementLease() {
    return unavailable();
  },
  async setStoreCaptureEntitlementLease() {
    return unavailable();
  },
  async setCaptureEnabled() {
    unavailable();
  },
  async listPendingRecords() {
    return unavailable();
  },
  async acknowledgeRecords() {
    unavailable();
  },
  async purgeExpired() {
    return unavailable();
  },
  async getCaptureStatus() {
    return unavailable();
  },
  async acknowledgeCaptureWarning() {
    return unavailable();
  },
  async recordFirstCapturedAt() {
    unavailable();
  },
  async eraseAll() {
    unavailable();
  },
};

export default WafraLiveCaptureModule;
