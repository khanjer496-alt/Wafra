import ExpoModulesCore

public class WafraMessageHistoryModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WafraMessageHistory")

    AsyncFunction("listSessionChunks") { (sessionId: String) -> [Int] in
      try WafraMessageHistoryStore.listSessionChunks(sessionId: sessionId)
    }

    AsyncFunction("readChunk") { (sessionId: String, chunkIndex: Int) -> [String] in
      try WafraMessageHistoryStore.readChunk(sessionId: sessionId, chunkIndex: chunkIndex)
    }

    AsyncFunction("discardSession") { (sessionId: String) in
      try WafraMessageHistoryStore.discardSession(sessionId: sessionId)
    }

    AsyncFunction("purgeExpired") { () -> Int in
      try WafraMessageHistoryStore.purgeExpired()
    }
  }
}
