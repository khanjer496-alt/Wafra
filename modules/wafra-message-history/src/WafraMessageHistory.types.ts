export interface WafraHistoryNativeModule {
  listSessionChunks(sessionId: string): Promise<number[]>;
  readChunk(sessionId: string, chunkIndex: number): Promise<string[]>;
  discardSession(sessionId: string): Promise<void>;
  purgeExpired(): Promise<number>;
}
