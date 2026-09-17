import { requireOptionalNativeModule } from 'expo-modules-core';

export interface NotificationReaderDiagnostics {
  available: boolean;
  systemAccess: boolean;
  admissionActive: boolean;
  listenerConnected: boolean;
  activeNotificationCount: number;
  trustedBankVisibleCount: number;
  adcbVisible: boolean;
  adcbActiveCount: number;
  queuedCandidateCount: number;
  /** Exact queued package+postTime identities that are still visible in Android. */
  queuedVisibleMatchCount: number;
  admissionCounts: Record<string, number>;
  adcbAdmissionCounts: Record<string, number>;
}

export interface CapturedNotification {
  /** Opaque native queue identity used only for durable acknowledgement. */
  id: string;
  /** Package name of the app that posted it (e.g. a bank app). */
  pkg: string;
  /** Android application label for package-identity verification; never notification text. */
  appLabel: string;
  title: string;
  text: string;
  /** Epoch milliseconds. */
  ts: number;
  /** Native source provenance. JS still requires issuer/parser evidence before auto-import. */
  sourceClass: 'trusted-bank' | 'play-finance' | 'financial-candidate';
}

interface NotificationReaderModule {
  /** Source-free hint that the encrypted native queue changed while JS is alive. */
  addListener?(event: 'onQueueChanged', listener: () => void): { remove(): void };
  isAvailable(): boolean;
  isEnabled(): boolean;
  /** Source-free entitlement/admission lease, independent of Android Notification access. */
  isAdmissionActive?(): boolean;
  hasSystemAccess(): boolean;
  /** Persist the app's tracking choice; disabling also erases queued alerts. */
  setCaptureEnabled(enabled: boolean, expiresAtMs: number): Promise<boolean>;
  /** Shared entitlement lease + independently selected bank-notification source. */
  setSourceConfiguration?(notificationEnabled: boolean, expiresAtMs: number): Promise<boolean>;
  /** Cheap foreground self-heal: request an Android listener rebind only when disconnected. */
  ensureListenerConnected?(): Promise<boolean>;
  /** Source-free queue count that never decrypts AndroidKeyStore-backed rows. */
  getPendingCount?(): Promise<number>;
  openSettings(): boolean;
  /** Source-free local diagnostics; never returns notification text. */
  getDiagnostics(): Promise<NotificationReaderDiagnostics>;
  /** Explicit heavy recovery pass over notifications still visible in the shade. */
  sweepVisible(): Promise<boolean>;
  /** Visible Wafra confirmation after a parsed notification is durably stored. */
  postImportNotice?(title: string, body: string): boolean;
  /** Captured money-related notifications with ts >= sinceMs, oldest first. */
  getCaptured(sinceMs: number): Promise<CapturedNotification[]>;
  ackCaptured(ids: string[]): Promise<boolean>;
  clearCaptured(): Promise<boolean>;
}

/** Null on iOS/web and in environments without the native module (e.g. Expo Go). */
export default requireOptionalNativeModule<NotificationReaderModule>('NotificationReader');
