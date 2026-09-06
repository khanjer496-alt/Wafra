export interface CompletedHistorySession {
  chunkIndices: number[];
  found: number;
  attempted: number;
  accepted: number;
  skipped: number;
}

export interface WafraHistoryNativeModule {
  getCompletedSession(sessionId: string): Promise<CompletedHistorySession | null>;
  recoverCompletedSession(startedAfterMs: number): Promise<(CompletedHistorySession & { sessionId: string }) | null>;
  readChunk(sessionId: string, chunkIndex: number): Promise<string[]>;
  discardSession(sessionId: string): Promise<void>;
  purgeExpired(): Promise<number>;
  eraseAll(): Promise<void>;
}
