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
  /** Optional on older binaries. Milliseconds of durable native queue activity. */
  lastReceivedAt?: number | null;
  /** Includes duplicates and non-financial messages, NOT last transaction time. */
  lastHandledAt?: number | null;
}

export interface WafraLiveCaptureNativeModule {
  /** Absent on older binaries; launch/resume reconciliation still works there. */
  readonly queueChangeEventsSupported?: boolean;
  /** Source-free, best-effort hint. Read the protected queue for actual records. */
  addListener?(
    eventName: 'onQueueChanged',
    listener: () => void,
  ): { remove(): void };
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
  getAutomationInputProbeAt(): Promise<number | null>;
  acknowledgeCaptureWarning(warningId: string): Promise<boolean>;
  recordFirstCapturedAt(observedAt: number): Promise<void>;
  eraseAll(): Promise<void>;
}
