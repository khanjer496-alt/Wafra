import { requireOptionalNativeModule } from 'expo-modules-core';

export interface RawSms {
  address: string;
  body: string;
  /** Epoch milliseconds. */
  date: number;
}

interface SmsReaderModule {
  /** Newest-first messages with sinceMs <= date < untilMs, up to max. */
  getInboxSms(sinceMs: number, untilMs: number, max: number): Promise<RawSms[]>;
  /**
   * Bank alerts captured by the delivery receiver (RECEIVE_SMS), oldest
   * first. Drains entries older than sinceMs as it reads. Present only on
   * builds carrying the receiver, so callers must guard on it.
   */
  getReceived?(sinceMs: number): Promise<RawSms[]>;
  /**
   * Whether to post a banner the moment a bank SMS is delivered.
   *
   * Stored natively, not in app state: the receiver that reads this runs in a
   * process with no JavaScript engine and cannot see AsyncStorage. Present
   * only on builds carrying the receiver, so callers must guard on it.
   */
  setInstantAlerts?(enabled: boolean): boolean;
  getInstantAlerts?(): boolean;
}

/** Null on iOS/web and in environments without the native module (e.g. Expo Go). */
export default requireOptionalNativeModule<SmsReaderModule>('SmsReader');
