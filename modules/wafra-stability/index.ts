import { requireOptionalNativeModule } from 'expo-modules-core';

export interface AndroidHistoricalExit {
  timestamp: number;
  reason: string;
  importance: number;
  status: number;
  pssBytes: number;
  rssBytes: number;
}

interface WafraStabilityModule {
  /** Android 11+ source-free process-exit history; empty on older Android. */
  getHistoricalExits(limit: number): Promise<AndroidHistoricalExit[]>;
}

export default requireOptionalNativeModule<WafraStabilityModule>('WafraStability');
