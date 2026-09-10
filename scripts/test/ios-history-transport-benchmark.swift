// Synthetic host benchmark, not an iPhone or Apple Shortcuts performance claim.
// Compiles the unchanged production stores. Never reads Messages or a real ledger.
import Foundation

@main
struct HistoryTransportBenchmark {
  enum BenchmarkError: Error { case invalidCount, reconciliation }

  static func seconds(_ operation: () throws -> Void) rethrows -> Double {
    let start = ProcessInfo.processInfo.systemUptime
    try operation()
    return ProcessInfo.processInfo.systemUptime - start
  }

  static func main() throws {
    let count = Int(CommandLine.arguments.dropFirst().first ?? "1000") ?? 0
    guard (1...10_000).contains(count) else { throw BenchmarkError.invalidCount }
    let root = Foundation.FileManager.default.temporaryDirectory
      .appendingPathComponent("wafra-synthetic-transport-\(UUID().uuidString)")
    try Foundation.FileManager.default.createDirectory(at: root,
      withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    defer { try? Foundation.FileManager.default.removeItem(at: root) }
    let now = Date(timeIntervalSince1970: 1_788_912_000)
    let prepared = WafraPreparedHistoryStore(root: root.appendingPathComponent("prepared"), now: { now })
    let store = WafraMessageHistoryStore(root: root.appendingPathComponent("staged"), now: { now })
    let importer = WafraMessageHistoryImporter(store: store, preparedStore: prepared, now: { now })
    let body = "Synthetic non-financial transport test: \"quotes\", backslash \\, newline\nنص تجريبي 😀"
    let records = (0..<count).map { index in
      WafraMessageHistoryImporter.preparedRecord(guid: "synthetic-message-\(index)",
        body: body, sender: "TEST", date: now.addingTimeInterval(Double(-index - 100)), now: now)
    }
    var preparedSeconds = 0.0
    var finalizationSeconds = 0.0
    let perMessageSeconds = try seconds {
      preparedSeconds = try seconds {
        for index in 0..<count {
          try prepared.prepareV3(sessionId: "synthetic-per-message", position: index + 1,
            guid: "synthetic-message-\(index)", body: body, sender: "TEST",
            date: now.addingTimeInterval(Double(-index - 100)))
        }
      }
      finalizationSeconds = try seconds {
        try importer.importPreparedV2(sessionId: "synthetic-per-message")
      }
    }
    guard try store.completedSession(sessionId: "synthetic-per-message")?.accepted == count else {
      throw BenchmarkError.reconciliation
    }
    try store.discardSession(sessionId: "synthetic-per-message")
    let batchCalls = (count + 49) / 50
    let batchSeconds = try seconds {
      let secret = try store.beginSession(sessionId: "synthetic-batched")
      var accepted = 0
      for start in stride(from: 0, to: count, by: 50) {
        let batch = Array(records[start..<min(start + 50, count)])
        let result = try store.stageShortcutChunk(sessionId: "synthetic-batched",
          authorizationSecret: secret, chunkIndex: start / 50, records: batch)
        guard result.attempted == batch.count, result.skipped == 0 else {
          throw BenchmarkError.reconciliation
        }
        accepted += result.accepted
      }
      try store.finishSession(sessionId: "synthetic-batched", authorizationSecret: secret,
        totalChunks: batchCalls, found: count, attempted: count, accepted: accepted, skipped: 0)
    }
    guard try store.completedSession(sessionId: "synthetic-batched")?.accepted == count else {
      throw BenchmarkError.reconciliation
    }
    for index in 0..<batchCalls {
      let actual = try store.readChunk(sessionId: "synthetic-batched", chunkIndex: index)
      let expected = Array(records[(index * 50)..<min(index * 50 + 50, count)])
      guard actual == expected else { throw BenchmarkError.reconciliation }
    }
    try store.discardSession(sessionId: "synthetic-batched")
    let result: [String: Any] = [
      "scope": "synthetic macOS host; no Apple Messages query or App Intent IPC",
      "iphoneDataProtectionVerified": false,
      "records": count,
      "perMessagePreparationCalls": count,
      "batchStagingCalls": batchCalls,
      "perMessagePreparationSeconds": preparedSeconds,
      "perMessageFinalizationSeconds": finalizationSeconds,
      "perMessageTotalSeconds": perMessageSeconds,
      "batchTotalSeconds": batchSeconds,
      "recordsReconciledExactly": true,
      "testSessionsDiscarded": true,
    ]
    let data = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
    print(String(decoding: data, as: UTF8.self))
  }
}
