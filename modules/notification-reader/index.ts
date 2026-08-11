import { requireOptionalNativeModule } from 'expo-modules-core';

export interface CapturedNotification {
  /** Opaque native queue identity used only for durable acknowledgement. */
  id: string;
  /** Package name of the app that posted it (e.g. a bank app). */
  pkg: string;
  title: string;
  text: string;
  /** Epoch milliseconds. */
  ts: number;
}

interface NotificationReaderModule {
  isAvailable(): boolean;
  isEnabled(): boolean;
  openSettings(): void;
  /** Captured money-related notifications with ts >= sinceMs, oldest first. */
  getCaptured(sinceMs: number): Promise<CapturedNotification[]>;
  ackCaptured(ids: string[]): Promise<boolean>;
  clearCaptured(): Promise<boolean>;
}

/** Null on iOS/web and in environments without the native module (e.g. Expo Go). */
export default requireOptionalNativeModule<NotificationReaderModule>('NotificationReader');
