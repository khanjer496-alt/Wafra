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
  admissionCounts: Record<string, number>;
  adcbAdmissionCounts: Record<string, number>;
}

export interface CapturedNotification {
  /** Opaque native queue identity used only for durable acknowledgement. */
  id: string;
  /** Package name of the app that posted it (e.g. a bank app). */
  pkg: string;
  title: string;
  text: string;
  /** Epoch milliseconds. */
  ts: number;
  /** Native source provenance. JS still requires issuer/parser evidence before auto-import. */
  sourceClass: 'trusted-bank' | 'financial-candidate';
}

interface NotificationReaderModule {
  isAvailable(): boolean;
  isEnabled(): boolean;
  hasSystemAccess(): boolean;
  /** Persist the app's tracking choice; disabling also erases queued alerts. */
  setCaptureEnabled(enabled: boolean, expiresAtMs: number): Promise<boolean>;
  openSettings(): boolean;
  /** Source-free local diagnostics; never returns notification text. */
  getDiagnostics(): Promise<NotificationReaderDiagnostics>;
  /** Explicit heavy recovery pass over notifications still visible in the shade. */
  sweepVisible(): Promise<boolean>;
  /** Captured money-related notifications with ts >= sinceMs, oldest first. */
  getCaptured(sinceMs: number): Promise<CapturedNotification[]>;
  ackCaptured(ids: string[]): Promise<boolean>;
  clearCaptured(): Promise<boolean>;
}

/** Null on iOS/web and in environments without the native module (e.g. Expo Go). */
export default requireOptionalNativeModule<NotificationReaderModule>('NotificationReader');