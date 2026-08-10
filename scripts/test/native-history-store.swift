import Foundation

@main
struct NativeHistoryStoreTests {
  private static var passed = 0
  private static var failed = 0

  private static func check(_ name: String, _ condition: @autoclosure () -> Bool) {
    if condition() {
      passed += 1
      print("✓ \(name)")
    } else {
      failed += 1
      print("✗ \(name)")
    }
  }

  private static func expects(
    _ name: String,
    _ expected: (WafraMessageHistoryStore.StoreError) -> Bool,
    operation: () throws -> Void
  ) {
    do {
      try operation()
      check(name, false)
    } catch let error as WafraMessageHistoryStore.StoreError {
      check(name, expected(error))
    } catch {
      check(name, false)
    }
  }

  private static func session(_ suffix: String) -> String {
    "native-test-\(UUID().uuidString)-\(suffix)"
  }

  private static func record(text: String = "Purchase of AED 12.00 at TEST") -> String {
    let object: [String: Any] = [
      "v": 1,
      "id": UUID().uuidString.replacingOccurrences(of: "-", with: ""),
      "text": text,
      "sender": "BANK",
      "receivedAt": "2026-08-10T08:00:00.000Z",
    ]
    let data = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    return String(decoding: data, as: UTF8.self)
  }

  static func main() throws {
    let basic = session("basic")
    let expiry = session("expiry")
    let readExpiry = session("read-expiry")
    let boundary = session("boundary")
    let incomplete = session("incomplete")
    defer {
      try? WafraMessageHistoryStore.discardSession(sessionId: basic)
      try? WafraMessageHistoryStore.discardSession(sessionId: expiry)
      try? WafraMessageHistoryStore.discardSession(sessionId: readExpiry)
      try? WafraMessageHistoryStore.discardSession(sessionId: boundary)
      try? WafraMessageHistoryStore.discardSession(sessionId: incomplete)
    }

    let rows = [record(), record()]
    let accepted = try WafraMessageHistoryStore.stageChunk(
      sessionId: basic,
      chunkIndex: 0,
      records: rows
    )
    check("native store stages the complete chunk", accepted == rows.count)
    let stagedChunks = try WafraMessageHistoryStore.listSessionChunks(sessionId: basic)
    let stagedRows = try WafraMessageHistoryStore.readChunk(sessionId: basic, chunkIndex: 0)
    check("native store lists the staged chunk", stagedChunks == [0])
    check("native store reads the original records", stagedRows == rows)

    let replay = try WafraMessageHistoryStore.stageChunk(
      sessionId: basic,
      chunkIndex: 0,
      records: rows
    )
    check("identical Shortcut retries are idempotent", replay == rows.count)

    expects("conflicting chunk retries are rejected", { error in
      if case .chunkConflict = error { return true }
      return false
    }) {
      _ = try WafraMessageHistoryStore.stageChunk(
        sessionId: basic,
        chunkIndex: 0,
        records: [record(text: "Purchase of AED 99.00 at OTHER")]
      )
    }

    expects("path-like session identifiers are rejected", { error in
      if case .invalidSession = error { return true }
      return false
    }) {
      _ = try WafraMessageHistoryStore.listSessionChunks(sessionId: "../../escape")
    }

    let oversizedBody = String(repeating: "x", count: WafraMessageHistoryStore.maxTextBytes + 1)
    check("oversized message bodies are detected before staging", WafraMessageHistoryStore.isOversizedRecord(record(text: oversizedBody)))

    expects("invalid chunk indices are rejected", { error in
      if case .invalidChunk = error { return true }
      return false
    }) {
      _ = try WafraMessageHistoryStore.stageChunk(
        sessionId: basic,
        chunkIndex: -1,
        records: [record()]
      )
    }

    expects("empty chunks are rejected", { error in
      if case .tooManyRecords = error { return true }
      return false
    }) {
      _ = try WafraMessageHistoryStore.stageChunk(
        sessionId: basic,
        chunkIndex: 1,
        records: []
      )
    }

    expects("chunks above the 50-record bridge limit are rejected", { error in
      if case .tooManyRecords = error { return true }
      return false
    }) {
      _ = try WafraMessageHistoryStore.stageChunk(
        sessionId: basic,
        chunkIndex: 1,
        records: (0...WafraMessageHistoryStore.maxChunkRecords).map { _ in record() }
      )
    }

    expects("oversized records are rejected by staging", { error in
      if case .recordTooLarge = error { return true }
      return false
    }) {
      _ = try WafraMessageHistoryStore.stageChunk(
        sessionId: basic,
        chunkIndex: 1,
        records: [record(text: oversizedBody)]
      )
    }

    try WafraMessageHistoryStore.discardSession(sessionId: basic)
    let chunksAfterCancel = try WafraMessageHistoryStore.listSessionChunks(sessionId: basic)
    check("explicit cancellation removes every staged chunk", chunksAfterCancel.isEmpty)

    _ = try WafraMessageHistoryStore.stageChunk(
      sessionId: expiry,
      chunkIndex: 0,
      records: [record()]
    )
    let applicationSupport = try FileManager.default.url(
      for: .applicationSupportDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: true
    )
    let expiryDirectory = applicationSupport
      .appendingPathComponent("WafraMessageHistory", isDirectory: true)
      .appendingPathComponent(expiry, isDirectory: true)
    try FileManager.default.setAttributes(
      [.modificationDate: Date(timeIntervalSinceNow: -(WafraMessageHistoryStore.sessionTTL + 1))],
      ofItemAtPath: expiryDirectory.path
    )
    let purged = try WafraMessageHistoryStore.purgeExpired(now: Date())
    let chunksAfterExpiry = try WafraMessageHistoryStore.listSessionChunks(sessionId: expiry)
    check("abandoned protected sessions expire opportunistically", purged >= 1)
    check("expired session data is no longer readable", chunksAfterExpiry.isEmpty)

    _ = try WafraMessageHistoryStore.stageChunk(
      sessionId: readExpiry,
      chunkIndex: 0,
      records: [record()]
    )
    let readExpiryDirectory = applicationSupport
      .appendingPathComponent("WafraMessageHistory", isDirectory: true)
      .appendingPathComponent(readExpiry, isDirectory: true)
    try FileManager.default.setAttributes(
      [.modificationDate: Date(timeIntervalSinceNow: -(WafraMessageHistoryStore.sessionTTL + 1))],
      ofItemAtPath: readExpiryDirectory.path
    )
    expects("direct reads cannot bypass session expiry", { error in
      if case .sessionExpired = error { return true }
      return false
    }) {
      _ = try WafraMessageHistoryStore.readChunk(sessionId: readExpiry, chunkIndex: 0)
    }

    _ = try WafraMessageHistoryStore.stageChunk(
      sessionId: boundary,
      chunkIndex: 0,
      records: [record()]
    )
    _ = try WafraMessageHistoryStore.stageChunk(
      sessionId: boundary,
      chunkIndex: 1,
      records: [record()]
    )
    let boundaryDirectory = applicationSupport
      .appendingPathComponent("WafraMessageHistory", isDirectory: true)
      .appendingPathComponent(boundary, isDirectory: true)
    try FileManager.default.setAttributes(
      [.modificationDate: Date(timeIntervalSinceNow: -(WafraMessageHistoryStore.sessionTTL - 1))],
      ofItemAtPath: boundaryDirectory.path
    )
    let boundaryChunks = try WafraMessageHistoryStore.listSessionChunks(sessionId: boundary)
    _ = try WafraMessageHistoryStore.purgeExpired(
      now: Date(timeIntervalSinceNow: 2)
    )
    let boundaryRows = try boundaryChunks.flatMap {
      try WafraMessageHistoryStore.readChunk(sessionId: boundary, chunkIndex: $0)
    }
    check(
      "listing renews the session lease across the TTL boundary",
      FileManager.default.fileExists(atPath: boundaryDirectory.path)
    )
    check("a renewed multi-chunk session remains complete", boundaryRows.count == 2)

    _ = try WafraMessageHistoryStore.stageChunk(
      sessionId: incomplete,
      chunkIndex: 0,
      records: [record()]
    )
    let incompleteDirectory = applicationSupport
      .appendingPathComponent("WafraMessageHistory", isDirectory: true)
      .appendingPathComponent(incomplete, isDirectory: true)
    let missingChunk = incompleteDirectory.appendingPathComponent("0000.json")
    try FileManager.default.removeItem(at: missingChunk)
    expects("a disappeared listed chunk fails instead of importing a prefix", { error in
      if case .sessionIncomplete = error { return true }
      return false
    }) {
      _ = try WafraMessageHistoryStore.readChunk(sessionId: incomplete, chunkIndex: 0)
    }

    print("\nNative history store: \(passed) passed, \(failed) failed")
    if failed > 0 { Foundation.exit(1) }
  }
}
