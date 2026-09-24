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
  /** Manual native-action permission check only; does not prove a trigger fired. */
  notificationSetupProofAt?: number | null;
  /** Notification queue receipts in milliseconds, not permission or ledger proof. */
  firstNotificationReceivedAt?: number | null;
  lastNotificationReceivedAt?: number | null;
  /** Wallet setup action and queue receipts only; not payment settlement. */
  applePayPending?: number;
  lastApplePayIncompleteAt?: number | null;
  applePaySetupProofAt?: number | null;
  firstApplePayReceivedAt?: number | null;
  lastApplePayReceivedAt?: number | null;
}

export interface WafraLiveCaptureNativeModule {
  /** Native text intake exists; the Notification automation trigger requires iOS 27. */
  readonly notificationCaptureSupported?: boolean;
  readonly applePayCaptureSupported?: boolean;
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
  /** Legacy reader deliberately exposes message records only. */
  listPendingRecords(limit: number): Promise<string[]>;
  /** Opt in only when notificationCaptureSupported is true and decoder handles both sources. */
  listPendingRecordsIncludingNotifications?(limit: number): Promise<string[]>;
  /** Reads only structured Apple Pay envelopes; older readers deliberately exclude these. */
  listPendingApplePayRecords?(limit: number): Promise<string[]>;
  acknowledgeRecords(ids: string[]): Promise<void>;
  purgeExpired(): Promise<number>;
  getCaptureStatus(): Promise<WafraLiveCaptureStatus>;
  /** Fixed bundled setup Shortcut only. Absent on older binaries; no financial data. */
  getNotificationShortcutURL?(): Promise<string>;
  getApplePayShortcutURL?(): Promise<string>;
  /** Fixed bundled message setup Shortcut. Optional for older native binaries. */
  getMessageShortcutURL?(): Promise<string>;
  /** Fixed bundled history import Shortcut. Optional for older native binaries. */
  getHistoryShortcutURL?(): Promise<string>;
  getAutomationInputProbeAt(): Promise<number | null>;
  acknowledgeCaptureWarning(warningId: string): Promise<boolean>;
  recordFirstCapturedAt(observedAt: number): Promise<void>;
  eraseAll(): Promise<void>;
}
