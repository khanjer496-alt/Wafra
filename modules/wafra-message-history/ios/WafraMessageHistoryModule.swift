import ExpoModulesCore
import Foundation

private enum WafraMessageHistoryBridgeError: Error {
  case unavailableChunk
  case cleanupFailed
}

private struct WafraCompletedHistorySessionRecord: Record {
  @Field var paged: Bool = false
  @Field var chunkIndices: [Int] = []
  @Field var found: Int = 0
  @Field var attempted: Int = 0
  @Field var accepted: Int = 0
  @Field var skipped: Int = 0
}

private struct WafraRecoveredHistorySessionRecord: Record {
  @Field var sessionId: String = ""
  @Field var chunkIndices: [Int] = []
  @Field var found: Int = 0
  @Field var attempted: Int = 0
  @Field var accepted: Int = 0
  @Field var skipped: Int = 0
}

public class WafraMessageHistoryModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WafraMessageHistory")

    AsyncFunction("getCompletedSession") {
      (sessionId: String) -> WafraCompletedHistorySessionRecord? in
      let paged = sessionId.hasPrefix("PAGED-")
      let descriptor = try paged
        ? WafraPagedHistoryStore.shared.completedSession(sessionId: sessionId)
        : WafraMessageHistoryStore.shared.completedSession(sessionId: sessionId)
      guard let descriptor else {
        return nil
      }
      var record = WafraCompletedHistorySessionRecord()
      record.paged = paged
      record.chunkIndices = descriptor.chunkIndices
      record.found = descriptor.found
      record.attempted = descriptor.attempted
      record.accepted = descriptor.accepted
      record.skipped = descriptor.skipped
      return record
    }

    AsyncFunction("recoverCompletedSession") {
      (startedAfterMs: Double) -> WafraRecoveredHistorySessionRecord? in
      let cutoff = Date(timeIntervalSince1970: startedAfterMs / 1_000)
      let legacy = try WafraMessageHistoryStore.shared.recoverCompletedSession(startedAfter: cutoff)
      let paged = try WafraPagedHistoryStore.shared.recoverCompletedSession(startedAfter: cutoff)
      // Preserve legacy precedence if both sessions remain; never discard either.
      guard let recovered = legacy ?? paged else {
        return nil
      }
      var record = WafraRecoveredHistorySessionRecord()
      record.sessionId = recovered.sessionId
      record.chunkIndices = recovered.chunkIndices
      record.found = recovered.found
      record.attempted = recovered.attempted
      record.accepted = recovered.accepted
      record.skipped = recovered.skipped
      return record
    }

    AsyncFunction("readChunk") { (sessionId: String, chunkIndex: Int) -> [String] in
      if sessionId.hasPrefix("PAGED-") {
        // readChunk checks completion and the chunk-to-journal mapping under
        // the store lock. Do not re-read every page before each single chunk.
        return try WafraPagedHistoryStore.shared.readChunk(sessionId: sessionId, chunkIndex: chunkIndex)
      }
      guard
        let descriptor = try WafraMessageHistoryStore.shared.completedSession(
          sessionId: sessionId
        ),
        descriptor.chunkIndices.contains(chunkIndex)
      else {
        throw WafraMessageHistoryBridgeError.unavailableChunk
      }
      return try WafraMessageHistoryStore.shared.readChunk(
        sessionId: sessionId,
        chunkIndex: chunkIndex
      )
    }

    AsyncFunction("discardSession") { (sessionId: String) in
      if sessionId.hasPrefix("PAGED-") {
        try WafraPagedHistoryStore.shared.discard(sessionId: sessionId)
        return
      }
      try WafraHistoryCleanupCoordinator.shared.discardSession(sessionId: sessionId)
    }

    AsyncFunction("purgeExpired") { () -> Int in
      var failed = false
      var count = 0
      do { count += try WafraHistoryCleanupCoordinator.shared.purgeExpired(now: Date()) } catch { failed = true }
      do { count += try WafraPagedHistoryStore.shared.purgeExpired() } catch { failed = true }
      if failed { throw WafraMessageHistoryBridgeError.cleanupFailed }
      return count
    }

    AsyncFunction("eraseAll") {
      var failed = false
      do { try WafraHistoryCleanupCoordinator.shared.eraseAll() } catch { failed = true }
      do { try WafraPagedHistoryStore.shared.eraseAll() } catch { failed = true }
      if failed { throw WafraMessageHistoryBridgeError.cleanupFailed }
    }

    AsyncFunction("getPagedStatus") { () -> String? in
      try WafraPagedHistoryStore.shared.status()
    }

    AsyncFunction("discardPagedHistory") {
      try WafraPagedHistoryStore.shared.eraseAll()
    }
  }
}
