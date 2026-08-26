export interface WafraLiveCaptureStatus {
  enabled: boolean;
  entitled: boolean;
  pending: number;
  dropped: number;
  corrupt: boolean;
  warningId: string | null;
  setupProofVersion: number | null;
  setupProofAt: number | null;
  firstCapturedAt: number | null;
}

export interface WafraLiveCaptureNativeModule {
  setLocalCaptureEntitlementLease(expiresAtMs: number | null, lifetime: boolean): Promise<boolean>;
  setStoreCaptureEntitlementLease(
    expiresAtMs: number | null,
    lifetime: boolean,
    verifiedAtMs: number,
  ): Promise<boolean>;
  setCaptureEnabled(enabled: boolean): Promise<void>;
  listPendingRecords(limit: number): Promise<string[]>;
  acknowledgeRecords(ids: string[]): Promise<void>;
  purgeExpired(): Promise<number>;
  getCaptureStatus(): Promise<WafraLiveCaptureStatus>;
  acknowledgeCaptureWarning(warningId: string): Promise<boolean>;
  recordFirstCapturedAt(observedAt: number): Promise<void>;
  eraseAll(): Promise<void>;
}
