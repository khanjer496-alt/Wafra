import Foundation

// Synthetic host-only transport experiment. Never reads a Messages database,
// uses a production store root, or writes transactions into the Wafra ledger.
@main
enum HistoryBatchBenchmark {
  enum Failure: Error { case mismatch(String) }

  static func require(_ value: Bool, _ label: String) throws {
    guard value else { throw Failure.mismatch(label) }
  }

  static func main() throws {
    let arguments = Array(CommandLine.arguments.dropFirst())
    let batchOnly = arguments.contains("--batch-only")
    let requested = arguments.first(where: { !$0.hasPrefix("--") }).flatMap(Int.init) ?? 300
    guard arguments.allSatisfy({ Int($0) != nil || $0 == "--batch-only" }),
          (1...10_000).contains(requested) else {
      throw Failure.mismatch("use a synthetic record count between 1 and 10000, optionally --batch-only")
    }
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent("wafra-batch-benchmark-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let now = Date(timeIntervalSince1970: 1_783_000_000)
    let date = Date(timeIntervalSince1970: 1_780_272_000)
    let session = "WAFRA-SYNTHETIC-BENCHMARK"
    let scalar = WafraMessageHistoryStore(root: root.appendingPathComponent("scalar"), now: { now })
    let prepared = WafraPreparedHistoryStore(root: root.appendingPathComponent("prepared"), now: { now })
    let batched = WafraMessageHistoryStore(root: root.appendingPathComponent("batched"), now: { now })
    let importer = WafraMessageHistoryImporter(store: scalar, preparedStore: prepared, now: { now })

    func fixture(_ index: Int) -> (String, String, String) {
      ("SYNTHETIC-\(index)", "Synthetic test \(index): العربية, quotes \" and newline\nonly", "TEST-NOT-A-BANK")
    }

    func record(_ index: Int) -> String {
      let row = fixture(index)
      return WafraMessageHistoryImporter.preparedRecord(
        guid: row.0, body: row.1, sender: row.2, date: date, now: now)
    }

    var scalarSeconds: Double?
    if !batchOnly {
      let scalarStart = ProcessInfo.processInfo.systemUptime
      for index in 0..<requested {
        let row = fixture(index)
        try prepared.prepareV3(sessionId: session, position: index + 1,
          guid: row.0, body: row.1, sender: row.2, date: date)
      }
      try importer.importPreparedV2(sessionId: session)
      scalarSeconds = ProcessInfo.processInfo.systemUptime - scalarStart
    }

    let batchStart = ProcessInfo.processInfo.systemUptime
    let secret = try batched.beginSession(sessionId: session)
    var chunks = 0
    for start in stride(from: 0, to: requested, by: 50) {
      let rows = (start..<min(start + 50, requested)).map(record)
      let counts = try batched.stageShortcutChunk(sessionId: session,
        authorizationSecret: secret, chunkIndex: chunks, records: rows)
      try require(counts.accepted == rows.count && counts.skipped == 0, "batch acceptance")
      chunks += 1
    }
    try batched.finishSession(sessionId: session, authorizationSecret: secret,
      totalChunks: chunks, found: requested, attempted: requested,
      accepted: requested, skipped: 0)
    let batchSeconds = ProcessInfo.processInfo.systemUptime - batchStart

    guard let new = try batched.completedSession(sessionId: session) else {
      throw Failure.mismatch("completed stores unavailable")
    }
    try require(new.accepted == requested && new.skipped == 0 && new.found == requested,
      "complete batch counts")
    if !batchOnly {
      let old = try scalar.completedSession(sessionId: session)
      try require(old == new, "complete counts and chunk boundaries")
    }
    for index in new.chunkIndices {
      let left = batchOnly
        ? ((index * 50)..<min(index * 50 + 50, requested)).map(record)
        : try scalar.readChunk(sessionId: session, chunkIndex: index)
      let right = try batched.readChunk(sessionId: session, chunkIndex: index)
      try require(left == right, "record identity, body, sender and date parity")
    }

    // The new producer must preserve retries, timezone offsets and rejection
    // boundaries. Exercise the real adapter, not a separate JavaScript model.
    let probe = WafraMessageHistoryStore(root: root.appendingPathComponent("probe"), now: { now })
    let probeSession = "WAFRA-SYNTHETIC-OFFSET"
    let probeSecret = try probe.beginSession(sessionId: probeSession)
    var offsetRow = try JSONSerialization.jsonObject(with: Data(record(0).utf8)) as! [String: Any]
    let canonicalDate = offsetRow["receivedAt"] as! String
    let formatter = ISO8601DateFormatter()
    formatter.timeZone = TimeZone(secondsFromGMT: 4 * 3600)
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    offsetRow["receivedAt"] = formatter.string(from: date)
    let encoded = String(decoding: try JSONSerialization.data(withJSONObject: offsetRow, options: [.sortedKeys]), as: UTF8.self)
    let first = try probe.stageShortcutChunk(sessionId: probeSession,
      authorizationSecret: probeSecret, chunkIndex: 0, records: [encoded])
    let replay = try probe.stageShortcutChunk(sessionId: probeSession,
      authorizationSecret: probeSecret, chunkIndex: 0, records: [encoded])
    try require(first == replay && first.accepted == 1, "exact retry is idempotent")
    try probe.finishSession(sessionId: probeSession, authorizationSecret: probeSecret,
      totalChunks: 1, found: 1, attempted: 1, accepted: 1, skipped: 0)
    let stored = try probe.readChunk(sessionId: probeSession, chunkIndex: 0)
    let normalized = try JSONSerialization.jsonObject(with: Data(stored[0].utf8)) as! [String: Any]
    try require(normalized["receivedAt"] as? String == canonicalDate, "offset normalized without changing instant")
    try probe.discardSession(sessionId: probeSession)

    let oversized = "WAFRA-SYNTHETIC-OVERSIZE"
    let oversizedSecret = try probe.beginSession(sessionId: oversized)
    var refused = false
    do {
      _ = try probe.stageShortcutChunk(sessionId: oversized,
        authorizationSecret: oversizedSecret, chunkIndex: 0, records: (0..<51).map(record))
    } catch { refused = true }
    try require(refused, "51-record native batch refused")

    let result: [String: Any] = [
      "scope": "synthetic macOS native transport only; not iPhone or Shortcuts throughput",
      "file_protection": "host metadata adapter; iPhone encryption not certified",
      "records": requested,
      "batch_size": 50,
      "mode": batchOnly ? "native batch capacity" : "native transport comparison",
      "scalar_prepare_calls": batchOnly ? 0 : requested,
      "batch_stage_calls": chunks,
      "scalar_native_seconds": scalarSeconds.map { $0 as Any } ?? NSNull(),
      "batch_native_seconds": batchSeconds,
      "exact_record_parity": true,
      "offset_normalization": true,
      "idempotent_retry": true,
      "oversize_rejected": true,
      "production_data_accessed": false,
      "sms_acquisition_or_pagination_tested": false
    ]
    print(String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]), as: UTF8.self))
  }
}
