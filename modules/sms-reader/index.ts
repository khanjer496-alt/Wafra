import { requireOptionalNativeModule } from 'expo-modules-core';

export interface RawSms {
  address: string;
  body: string;
  /** Epoch milliseconds. */
  date: number;
}

export interface CorpusSms extends RawSms {
  /** Android inbox row id, used only as a lossless pagination cursor. */
  id: number;
}

interface SmsReaderModule {
  /** Newest-first messages with sinceMs <= date < untilMs, up to max. */
  getInboxSms(sinceMs: number, untilMs: number, max: number): Promise<RawSms[]>;
  /** Present in every binary but returns true only in the temporary corpus build. */
  isCorpusExportEnabled?(): boolean;
  /** Unfiltered received SMS page. Throws unless the native corpus flag is enabled. */
  getInboxCorpusPage?(
    beforeDateMs: number,
    beforeId: number,
    max: number,
  ): Promise<CorpusSms[]>;
  /** Retired delivery-buffer compatibility seam; returns no message bodies. */
  getReceived?(sinceMs: number): Promise<RawSms[]>;
  /** Purge the retired delivery buffer during cryptographic erase. */
  clearCaptured?(): Promise<boolean>;
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
