import ExpoModulesCore
import Foundation

private enum WafraMessageHistoryBridgeError: Error {
  case unavailableChunk
}

private struct WafraCompletedHistorySessionRecord: Record {
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
      guard let descriptor = try WafraMessageHistoryStore.shared.completedSession(
        sessionId: sessionId
      ) else {
        return nil
      }
      var record = WafraCompletedHistorySessionRecord()
      record.chunkIndices = descriptor.chunkIndices
      record.found = descriptor.found
      record.attempted = descriptor.attempted
      record.accepted = descriptor.accepted
      record.skipped = descriptor.skipped
      return record
    }

    AsyncFunction("recoverCompletedSession") {
      (startedAfterMs: Double) -> WafraRecoveredHistorySessionRecord? in
      guard let recovered = try WafraMessageHistoryStore.shared.recoverCompletedSession(
        startedAfter: Date(timeIntervalSince1970: startedAfterMs / 1_000)
      ) else {
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
      try WafraHistoryCleanupCoordinator.shared.discardSession(sessionId: sessionId)
    }

    AsyncFunction("purgeExpired") { () -> Int in
      try WafraHistoryCleanupCoordinator.shared.purgeExpired(now: Date())
    }

    AsyncFunction("eraseAll") {
      try WafraHistoryCleanupCoordinator.shared.eraseAll()
    }
  }
}
