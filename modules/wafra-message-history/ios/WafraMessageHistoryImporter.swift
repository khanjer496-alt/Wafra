import CryptoKit
import Foundation

public struct WafraBulkHistoryImportResult: Equatable {
  public let totalChunks: Int
  public let found: Int
  public let attempted: Int
  public let accepted: Int
  public let skipped: Int

  public init(
    totalChunks: Int,
    found: Int,
    attempted: Int,
    accepted: Int,
    skipped: Int
  ) {
    self.totalChunks = totalChunks
    self.found = found
    self.attempted = attempted
    self.accepted = accepted
    self.skipped = skipped
  }
}

public final class WafraMessageHistoryImporter {
  public enum ImportError: Error, Equatable {
    case invalidInput
    case countMismatch
    case conflictingRecordIdentifier
  }

  public static let shared = WafraMessageHistoryImporter()

  private static let missingRecord = "{\"v\":0}"
  private static let maximumRawGUIDBytes = 1_024
  private static let futureClockSkew: TimeInterval = 5 * 60

  private let store: WafraMessageHistoryStore
  private let preparedStore: WafraPreparedHistoryStore
  private let nowProvider: () -> Date

  public init(
    store: WafraMessageHistoryStore = .shared,
    preparedStore: WafraPreparedHistoryStore = .shared,
    now: @escaping () -> Date = Date.init
  ) {
    self.store = store
    self.preparedStore = preparedStore
    self.nowProvider = now
  }

  public func importMessages(
    sessionId: String,
    found: Int,
    messageGUIDs: [String],
    bodies: [String],
    dates: [Date]
  ) throws -> WafraBulkHistoryImportResult {
    guard
      found > 0,
      found <= WafraMessageHistoryStore.maxSessionRecords,
      messageGUIDs.count == found,
      bodies.count == found,
      dates.count == found
    else { throw ImportError.invalidInput }

    let now = nowProvider()
    let formatter = Self.utcFormatter()
    var recordIndex = 0
    return try importRecordChunks(sessionId: sessionId, found: found) {
      guard recordIndex < found else { return nil }
      let end = min(recordIndex + WafraMessageHistoryStore.maxChunkRecords, found)
      let records = (recordIndex..<end).map { index in
        Self.preparedRecord(
          guid: messageGUIDs[index],
          body: bodies[index],
          sender: nil,
          date: dates[index],
          now: now,
          formatter: formatter
        )
      }
      recordIndex = end
      return records
    }
  }

  public func importPrepared(sessionId: String, found: Int) throws {
    guard found > 0, found <= WafraMessageHistoryStore.maxSessionRecords else {
      try? preparedStore.discardPrepared(sessionId: sessionId)
      throw ImportError.invalidInput
    }
    var imported = false
    do {
      try preparedStore.consumePreparedChunks(sessionId: sessionId, found: found) { nextChunk in
        _ = try importRecordChunks(sessionId: sessionId, found: found, nextChunk: nextChunk)
        imported = true
      }
    } catch {
      if imported { try? store.discardSession(sessionId: sessionId) }
      throw error
    }
  }

  public func importPreparedV2(sessionId: String) throws {
    var imported = false
    do {
      try preparedStore.consumePreparedChunksV2(sessionId: sessionId) {
        found,
        nextPreparedChunk in
        var seenFingerprints: [String: Data] = [:]
        _ = try importRecordChunks(sessionId: sessionId, found: found) {
          guard let records = try nextPreparedChunk() else { return nil }
          return try Self.normalizingExactDuplicates(
            records,
            seenFingerprints: &seenFingerprints
          )
        }
        imported = true
      }
    } catch {
      if imported { try? store.discardSession(sessionId: sessionId) }
      throw error
    }
  }

  private func importRecordChunks(
    sessionId: String,
    found: Int,
    nextChunk: () throws -> [String]?
  ) throws -> WafraBulkHistoryImportResult {
    let authorizationSecret = try store.beginSession(sessionId: sessionId)
    var completed = false
    defer {
      if !completed { try? store.discardSession(sessionId: sessionId) }
    }

    var attempted = 0
    var accepted = 0
    var skipped = 0
    var chunkIndex = 0
    while let records = try nextChunk() {
      let counts = try store.stageChunk(
        sessionId: sessionId,
        authorizationSecret: authorizationSecret,
        chunkIndex: chunkIndex,
        records: records
      )
      attempted += counts.attempted
      accepted += counts.accepted
      skipped += counts.skipped
      chunkIndex += 1
    }

    guard attempted == found, accepted + skipped == attempted else {
      throw ImportError.countMismatch
    }
    try store.finishSession(
      sessionId: sessionId,
      authorizationSecret: authorizationSecret,
      totalChunks: chunkIndex,
      found: found,
      attempted: attempted,
      accepted: accepted,
      skipped: skipped
    )
    completed = true
    return WafraBulkHistoryImportResult(
      totalChunks: chunkIndex,
      found: found,
      attempted: attempted,
      accepted: accepted,
      skipped: skipped
    )
  }

  private static func normalizingExactDuplicates(
    _ records: [String],
    seenFingerprints: inout [String: Data]
  ) throws -> [String] {
    try records.map { record in
      if record == missingRecord { return record }
      guard
        let data = record.data(using: .utf8),
        let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let identifier = object["id"] as? String
      else { throw ImportError.invalidInput }

      let fingerprint = Data(SHA256.hash(data: data))
      guard let previous = seenFingerprints[identifier] else {
        seenFingerprints[identifier] = fingerprint
        return record
      }
      guard previous == fingerprint else {
        throw ImportError.conflictingRecordIdentifier
      }
      return missingRecord
    }
  }

  static func preparedRecord(
    guid: String?,
    body: String?,
    sender: String? = nil,
    date: Date?,
    now: Date
  ) -> String {
    preparedRecord(
      guid: guid,
      body: body,
      sender: sender,
      date: date,
      now: now,
      formatter: utcFormatter()
    )
  }

  static func preparedRecordV2(
    guid: String?,
    body: String?,
    sender: String? = nil,
    date: Date?,
    rangeStart: Date,
    rangeEnd: Date,
    now: Date
  ) -> String {
    guard
      rangeStart.timeIntervalSince1970.isFinite,
      rangeEnd.timeIntervalSince1970.isFinite,
      rangeStart < rangeEnd,
      let date,
      date >= rangeStart,
      date < rangeEnd
    else { return missingRecord }
    return preparedRecord(
      guid: guid,
      body: body,
      sender: sender,
      date: date,
      now: now,
      formatter: utcFormatter()
    )
  }

  static func isCanonicalPreparedRecord(_ record: String, now: Date) -> Bool {
    if record == missingRecord { return true }
    guard
      let data = record.data(using: .utf8),
      data.count <= WafraMessageHistoryStore.maxRecordBytes,
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      Set(["v", "id", "text", "receivedAt"]).isSubset(of: Set(object.keys)),
      Set(object.keys).isSubset(of: Set(["v", "id", "text", "sender", "receivedAt"])),
      let version = object["v"] as? NSNumber,
      String(cString: version.objCType) != "c",
      version.intValue == 1,
      version.doubleValue == 1,
      let identifier = object["id"] as? String,
      identifier.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil,
      let text = object["text"] as? String,
      !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
      Data(text.utf8).count <= WafraMessageHistoryStore.maxTextBytes,
      let receivedAt = object["receivedAt"] as? String
    else { return false }

    if let senderValue = object["sender"] {
      guard let sender = senderValue as? String,
            WafraMessageHistoryStore.safeSender(sender) else { return false }
    }

    let formatter = utcFormatter()
    guard
      let date = formatter.date(from: receivedAt),
      canonicalInstant(date, now: now, formatter: formatter) == receivedAt,
      let canonical = try? JSONSerialization.data(
        withJSONObject: object,
        options: [.sortedKeys]
      )
    else { return false }
    return canonical == data
  }

  private static func preparedRecord(
    guid: String?,
    body: String?,
    sender: String?,
    date: Date?,
    now: Date,
    formatter: ISO8601DateFormatter
  ) -> String {
    guard let guid, let body, let date else { return missingRecord }
    let guidData = Data(guid.utf8)
    let bodyData = Data(body.utf8)
    guard
      !guidData.isEmpty,
      guidData.count <= maximumRawGUIDBytes,
      !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
      bodyData.count <= WafraMessageHistoryStore.maxTextBytes,
      let receivedAt = canonicalInstant(date, now: now, formatter: formatter)
    else { return missingRecord }

    let object: [String: Any] = [
      "v": 1,
      "id": sha256Hex(guidData),
      "text": body,
      "receivedAt": receivedAt,
    ]
    var record = object
    if let sender, WafraMessageHistoryStore.safeSender(sender) {
      record["sender"] = sender
    }
    guard
      let data = try? JSONSerialization.data(withJSONObject: record, options: [.sortedKeys])
    else { return missingRecord }
    return String(decoding: data, as: UTF8.self)
  }

  private static func canonicalInstant(
    _ date: Date,
    now: Date,
    formatter: ISO8601DateFormatter
  ) -> String? {
    let seconds = date.timeIntervalSince1970
    guard
      seconds.isFinite,
      seconds > 0,
      date <= now.addingTimeInterval(futureClockSkew)
    else { return nil }

    return formatter.string(from: date)
  }

  private static func utcFormatter() -> ISO8601DateFormatter {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    return formatter
  }

  private static func sha256Hex(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }
}
