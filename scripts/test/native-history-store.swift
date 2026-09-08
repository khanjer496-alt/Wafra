import CryptoKit
import Foundation

#if canImport(Darwin)
import Darwin
#endif

private enum HarnessError: Error {
  case injectedDeletionFailure
  case injectedWriteFailure
}

private struct SensitiveCleanupError: Error, CustomStringConvertible {
  let description: String
}

@main
struct NativeHistoryStoreTests {
  private static var passed = 0
  private static var failed = 0
  private static let fixedNow = Date(timeIntervalSince1970: 1_777_593_600) // 2026-05-01T00:00:00Z
  private static let eraseMarkerName = ".erase-in-progress"
  private static let maximumJSONContainerDepth = 64

  private static func check(_ name: String, _ condition: @autoclosure () throws -> Bool) {
    do {
      if try condition() {
        passed += 1
        print("✓ \(name)")
      } else {
        failed += 1
        print("✗ \(name)")
      }
    } catch {
      failed += 1
      print("✗ \(name): unexpected \(String(describing: error))")
    }
  }

  private static func run(_ name: String, _ operation: () throws -> Void) {
    do {
      try operation()
    } catch {
      failed += 1
      print("✗ \(name): unexpected \(String(describing: error))")
    }
  }

  private static func expects(
    _ name: String,
    _ expected: WafraMessageHistoryStore.StoreError,
    operation: () throws -> Void
  ) {
    do {
      try operation()
      check(name, false)
    } catch let error as WafraMessageHistoryStore.StoreError {
      check(name, error == expected)
    } catch {
      check(name, false)
    }
  }

  private static func expectsPrepared(
    _ name: String,
    _ expected: WafraPreparedHistoryStore.StoreError,
    operation: () throws -> Void
  ) {
    do {
      try operation()
      check(name, false)
    } catch let error as WafraPreparedHistoryStore.StoreError {
      check(name, error == expected)
    } catch {
      check(name, false)
    }
  }

  private static func expectsCleanup(
    _ name: String,
    operation: () throws -> Void
  ) {
    do {
      try operation()
      check(name, false)
    } catch let error as WafraHistoryCleanupCoordinator.CleanupError {
      check(name, error == .cleanupFailure)
    } catch {
      check(name, false)
    }
  }

  private static func temporaryRoot(_ suffix: String) -> URL {
    FileManager.default.temporaryDirectory
      .appendingPathComponent("wafra-history-\(suffix)-\(UUID().uuidString)", isDirectory: true)
  }

  private static func withRoot(_ suffix: String, _ body: (URL) throws -> Void) throws {
    let root = temporaryRoot(suffix)
    defer { try? FileManager.default.removeItem(at: root) }
    try body(root)
  }

  private static func id(_ seed: String) -> String {
    SHA256.hash(data: Data(seed.utf8)).map { String(format: "%02x", $0) }.joined()
  }

  private static func decodedBase64URL(_ value: String) -> Data {
    var base64 = value
      .replacingOccurrences(of: "-", with: "+")
      .replacingOccurrences(of: "_", with: "/")
    base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
    return Data(base64Encoded: base64)!
  }

  private static func lowBitBase64URLAlias(_ value: String) -> String {
    let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
    var characters = Array(value)
    let index = alphabet.firstIndex(of: characters[characters.count - 1])!
    let aliasIndex = (index & ~3) | ((index + 1) & 3)
    characters[characters.count - 1] = alphabet[aliasIndex]
    return String(characters)
  }

  private static func record(
    id recordId: String = String(repeating: "a", count: 64),
    text: String = "Purchase of AED 12.00 at TEST",
    sender: Any? = "BANK",
    receivedAt: String = "2026-04-30T08:00:00.000Z",
    version: Int = 1,
    extra: [String: Any] = [:]
  ) -> String {
    var object: [String: Any] = [
      "v": version,
      "id": recordId,
      "text": text,
      "receivedAt": receivedAt,
    ]
    if let sender { object["sender"] = sender }
    for (key, value) in extra { object[key] = value }
    let data = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    return String(decoding: data, as: UTF8.self)
  }

  private static func recordWithNestedSender(id recordId: String, depth: Int) -> String {
    let sender = String(repeating: "[", count: depth)
      + "0"
      + String(repeating: "]", count: depth)
    return "{\"v\":1,\"id\":\"\(recordId)\",\"text\":\"nested sender\",\"sender\":\(sender),\"receivedAt\":\"2026-04-30T08:00:00.000Z\"}"
  }

  private static func store(
    root: URL,
    now: @escaping () -> Date = { fixedNow },
    removeItem: @escaping (URL) throws -> Void = { try FileManager.default.removeItem(at: $0) },
    writeData: ((Data, URL) throws -> Void)? = nil,
    lockAcquired: ((String) -> Void)? = nil
  ) -> WafraMessageHistoryStore {
    WafraMessageHistoryStore(
      root: root,
      now: now,
      removeItem: removeItem,
      writeData: writeData,
      lockAcquired: lockAcquired
    )
  }

  private static func preparedStore(
    root: URL,
    now: @escaping () -> Date = { fixedNow }
  ) -> WafraPreparedHistoryStore {
    WafraPreparedHistoryStore(root: root, now: now)
  }

  private static func stageOne(
    _ store: WafraMessageHistoryStore,
    sessionId: String,
    secret: String,
    chunkIndex: Int = 0,
    recordId: String = String(repeating: "a", count: 64)
  ) throws -> WafraHistoryChunkCounts {
    try store.stageChunk(
      sessionId: sessionId,
      authorizationSecret: secret,
      chunkIndex: chunkIndex,
      records: [record(id: recordId)]
    )
  }

  private static func finishOne(
    _ store: WafraMessageHistoryStore,
    sessionId: String,
    secret: String
  ) throws {
    try store.finishSession(
      sessionId: sessionId,
      authorizationSecret: secret,
      totalChunks: 1,
      found: 1,
      attempted: 1,
      accepted: 1,
      skipped: 0
    )
  }

  private static func manifest(_ root: URL, _ sessionId: String) throws -> [String: Any] {
    let data = try Data(contentsOf: root
      .appendingPathComponent(sessionId, isDirectory: true)
      .appendingPathComponent("manifest.plist"))
    return try PropertyListSerialization.propertyList(from: data, format: nil) as! [String: Any]
  }

  private static func writeManifestObject(
    _ object: [String: Any],
    root: URL,
    sessionId: String
  ) throws {
    let data = try PropertyListSerialization.data(
      fromPropertyList: object,
      format: .binary,
      options: 0
    )
    let url = root.appendingPathComponent(sessionId).appendingPathComponent("manifest.plist")
    try data.write(to: url, options: [.atomic, .completeFileProtection])
    try FileManager.default.setAttributes(
      [.protectionKey: FileProtectionType.complete],
      ofItemAtPath: url.path
    )
  }

  private static func writeProtectedForTest(_ data: Data, to url: URL) throws {
    try data.write(to: url, options: [.atomic, .completeFileProtection])
    try FileManager.default.setAttributes(
      [.protectionKey: FileProtectionType.complete],
      ofItemAtPath: url.path
    )
  }

  private static func mutateManifest(
    root: URL,
    sessionId: String,
    _ mutation: (inout [String: Any]) -> Void
  ) throws {
    var object = try manifest(root, sessionId)
    mutation(&object)
    try writeManifestObject(object, root: root, sessionId: sessionId)
  }

  private static func expectsSourceFreeStoreError(
    _ name: String,
    sensitive: [String],
    operation: () throws -> Void
  ) {
    do {
      try operation()
      check(name, false)
    } catch let error as WafraMessageHistoryStore.StoreError {
      let description = String(describing: error)
      check(name, sensitive.allSatisfy { !description.contains($0) })
    } catch {
      check(name, false)
    }
  }

  private static func waitForFile(_ url: URL, timeout: TimeInterval = 5) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if FileManager.default.fileExists(atPath: url.path) { return true }
      usleep(5_000)
    }
    return false
  }

  private static func directoryBytes(_ directory: URL) throws -> Int {
    guard let enumerator = FileManager.default.enumerator(
      at: directory,
      includingPropertiesForKeys: [.fileSizeKey, .isRegularFileKey]
    ) else { return 0 }
    var total = 0
    for case let file as URL in enumerator {
      let values = try file.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
      if values.isRegularFile == true { total += values.fileSize ?? 0 }
    }
    return total
  }

  private static func storedDirectories(_ root: URL) throws -> [URL] {
    let entries = try FileManager.default.contentsOfDirectory(
      at: root,
      includingPropertiesForKeys: [.isDirectoryKey]
    )
    var directories: [URL] = []
    for entry in entries {
      let values = try entry.resourceValues(forKeys: [.isDirectoryKey])
      if values.isDirectory == true { directories.append(entry) }
    }
    return directories
  }

  private static func testCoreProtocol() throws {
    try withRoot("core") { root in
      let store = store(root: root)
      let sessionId = "history-" + UUID().uuidString
      let secret = try store.beginSession(sessionId: sessionId)
      check("Begin returns 32 random bytes as unpadded base64url", secret.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil)

      let counts = try store.stageChunk(
        sessionId: sessionId,
        authorizationSecret: secret,
        chunkIndex: 0,
        records: [record(), "{\"v\":0}"]
      )
      check("stage records attempted count", counts.attempted == 2)
      check("stage records accepted count", counts.accepted == 1)
      check("stage records skipped count", counts.skipped == 1)
      check("open session is hidden", try store.completedSession(sessionId: sessionId) == nil)
      expects("open session chunks cannot be read", .sessionUnavailable) {
        _ = try store.readChunk(sessionId: sessionId, chunkIndex: 0)
      }

      try store.finishSession(
        sessionId: sessionId,
        authorizationSecret: secret,
        totalChunks: 1,
        found: 2,
        attempted: 2,
        accepted: 1,
        skipped: 1
      )
      let completed = try store.completedSession(sessionId: sessionId)
      check("finished session is visible", completed != nil)
      check("completed descriptor is authoritative", completed == WafraCompletedHistorySession(
        chunkIndices: [0], found: 2, attempted: 2, accepted: 1, skipped: 1
      ))
      check("completed chunk contains accepted records only", try store.readChunk(sessionId: sessionId, chunkIndex: 0) == [record()])
      expects("completion clears authorization", .sessionUnavailable) {
        _ = try store.stageChunk(
          sessionId: sessionId,
          authorizationSecret: secret,
          chunkIndex: 1,
          records: [record(id: id("after-finish"))]
        )
      }

      let storedManifest = try manifest(root, sessionId)
      check("manifest state closes as complete", storedManifest["state"] as? String == "complete")
      check("complete manifest stores no secret hash", storedManifest["secretHash"] == nil)
    }
  }

  private static func testAuthorizationAndBegin() throws {
    try withRoot("auth") { root in
      let store = store(root: root)
      let sessionId = "history-auth-session"
      let secret = try store.beginSession(sessionId: sessionId)
      let secretDigest = SHA256.hash(data: decodedBase64URL(secret)).map { String(format: "%02x", $0) }.joined()
      let data = try Data(contentsOf: root.appendingPathComponent(sessionId).appendingPathComponent("manifest.plist"))
      let storedManifest = try manifest(root, sessionId)
      check("open manifest persists SHA-256 of secret", storedManifest["secretHash"] as? String == secretDigest)
      check("open manifest never persists plaintext secret", !data.contains(Data(secret.utf8)))

      expects("duplicate Begin is rejected", .duplicateSession) {
        _ = try store.beginSession(sessionId: sessionId)
      }
      check("duplicate Begin does not destroy the authorized session", try stageOne(store, sessionId: sessionId, secret: secret).accepted == 1)

      let wrongSession = "history-wrong-secret"
      _ = try store.beginSession(sessionId: wrongSession)
      expects("wrong authorization secret is rejected", .unauthorized) {
        _ = try stageOne(store, sessionId: wrongSession, secret: "not-the-secret")
      }
      check("wrong-secret session is hidden", try store.completedSession(sessionId: wrongSession) == nil)
      check("wrong-secret session is deleted after tombstoning", !FileManager.default.fileExists(atPath: root.appendingPathComponent(wrongSession).path))

      let aliasSession = "history-secret-alias"
      let canonicalSecret = try store.beginSession(sessionId: aliasSession)
      let alias = lowBitBase64URLAlias(canonicalSecret)
      check("base64url alias fixture decodes to the same bytes", alias != canonicalSecret && decodedBase64URL(alias) == decodedBase64URL(canonicalSecret))
      expects("noncanonical low-bit base64url alias is rejected", .unauthorized) {
        _ = try stageOne(store, sessionId: aliasSession, secret: alias)
      }
      check("noncanonical secret failure tombstones session", !FileManager.default.fileExists(atPath: root.appendingPathComponent(aliasSession).path))

      expects("path-like session identifiers are rejected", .invalidSession) {
        _ = try store.beginSession(sessionId: "../../escape")
      }
    }
  }

  private static func testValidationAndNormalization() throws {
    try withRoot("validation") { root in
      let store = store(root: root)
      let sessionId = "history-validation"
      let secret = try store.beginSession(sessionId: sessionId)
      let validId = String(repeating: "a", count: 64)
      let invalid: [String] = [
        "{\"v\":0}",
        "not-json",
        record(id: String(repeating: "A", count: 64)),
        record(id: String(repeating: "a", count: 63)),
        record(id: "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo0123456789_-"),
        record(id: "1A2B3C4D-1111-2222-3333-444455556666"),
        record(id: "p:0/1A2B3C4D-1111-2222-3333-444455556666"),
        record(id: id("version"), version: 2),
        record(id: id("extra"), extra: ["unexpected": true]),
        record(id: id("blank"), text: "   "),
        record(id: id("date-offset"), receivedAt: "2026-04-30T08:00:00+00:00"),
        record(id: id("date-impossible"), receivedAt: "2026-02-31T08:00:00.000Z"),
        record(id: id("date-future"), receivedAt: "2026-05-01T00:05:00.001Z"),
        record(id: id("oversized"), text: String(repeating: "x", count: WafraMessageHistoryStore.maxTextBytes + 1)),
        "{\"v\":1,\"id\":\"\(id("duplicate-first"))\",\"id\":\"\(id("duplicate-second"))\",\"text\":\"duplicate key\",\"receivedAt\":\"2026-04-30T08:00:00.000Z\"}",
        "{\"v\":1,\"id\":\"\(id("escaped-first"))\",\"\\u0069d\":\"\(id("escaped-second"))\",\"text\":\"escaped duplicate key\",\"receivedAt\":\"2026-04-30T08:00:00.000Z\"}",
        "{\"v\":1,\"id\":\"\(id("nested-duplicate"))\",\"text\":\"nested duplicate key\",\"sender\":{\"label\":\"one\",\"label\":\"two\"},\"receivedAt\":\"2026-04-30T08:00:00.000Z\"}",
      ]
      let safeSender = record(id: id("safe-sender"), sender: "ADCB")
      let unsafeIds = ["empty-sender", "long-sender", "huge-sender", "control-sender", "bidi-sender", "typed-sender"].map(id)
      let unsafeSenderRecords = [
        record(id: unsafeIds[0], sender: ""),
        record(id: unsafeIds[1], sender: String(repeating: "s", count: 81)),
        record(id: unsafeIds[2], sender: String(repeating: "s", count: WafraMessageHistoryStore.maxRecordBytes + 1)),
        record(id: unsafeIds[3], sender: "BANK\u{0007}"),
        record(id: unsafeIds[4], sender: "BANK\u{202E}"),
        record(id: unsafeIds[5], sender: 123),
      ]
      let inputs = [record(id: validId), safeSender] + unsafeSenderRecords + invalid
      let counts = try store.stageChunk(
        sessionId: sessionId,
        authorizationSecret: secret,
        chunkIndex: 0,
        records: inputs
      )
      check("only exact lowercase SHA-256 IDs and valid records are accepted", counts == WafraHistoryChunkCounts(attempted: inputs.count, accepted: 8, skipped: invalid.count))
      try store.finishSession(
        sessionId: sessionId,
        authorizationSecret: secret,
        totalChunks: 1,
        found: inputs.count,
        attempted: inputs.count,
        accepted: 8,
        skipped: invalid.count
      )
      let accepted = try store.readChunk(sessionId: sessionId, chunkIndex: 0)
      let objects = try accepted.map {
        try JSONSerialization.jsonObject(with: Data($0.utf8)) as! [String: Any]
      }
      check("valid sender remains in normalized record", objects.contains { $0["sender"] as? String == "ADCB" })
      check("unsafe optional senders are omitted without dropping records", objects.filter {
        guard let recordId = $0["id"] as? String else { return false }
        return unsafeIds.contains(recordId)
      }.count == 6 && objects.filter {
        guard let recordId = $0["id"] as? String else { return false }
        return unsafeIds.contains(recordId)
      }.allSatisfy { $0["sender"] == nil })
      check("native reserialization emits exact v1 key set", objects.allSatisfy { object in
        let keys = Set(object.keys)
        return keys == Set(["v", "id", "text", "receivedAt"]) || keys == Set(["v", "id", "text", "sender", "receivedAt"])
      })
    }

    try withRoot("over-fifty") { root in
      let store = store(root: root)
      let sessionId = "history-over-fifty"
      let secret = try store.beginSession(sessionId: sessionId)
      expects("input count over 50 is rejected before sentinel filtering", .tooManyRecords) {
        _ = try store.stageChunk(
          sessionId: sessionId,
          authorizationSecret: secret,
          chunkIndex: 0,
          records: Array(repeating: "{\"v\":0}", count: 51)
        )
      }
      check("over-50 failure tombstones and hides session", try store.completedSession(sessionId: sessionId) == nil)
    }

    try withRoot("all-skipped") { root in
      let store = store(root: root)
      let sessionId = "history-all-skipped"
      let secret = try store.beginSession(sessionId: sessionId)
      let counts = try store.stageChunk(
        sessionId: sessionId,
        authorizationSecret: secret,
        chunkIndex: 0,
        records: ["{\"v\":0}", "malformed"]
      )
      check("all-skipped chunk preserves attempted metadata", counts == WafraHistoryChunkCounts(attempted: 2, accepted: 0, skipped: 2))
      try store.finishSession(sessionId: sessionId, authorizationSecret: secret, totalChunks: 1, found: 2, attempted: 2, accepted: 0, skipped: 2)
      check("all-skipped chunk persists an empty accepted array", try store.readChunk(sessionId: sessionId, chunkIndex: 0).isEmpty)
    }
  }

  private static func testShortcutOffsetRecords() throws {
    let accepted: [(String, String)] = [
      ("2026-04-30T12:00:00.001+04:00", "2026-04-30T08:00:00.001Z"),
      ("2026-04-30T12:00:00.999+04:00", "2026-04-30T08:00:00.999Z"),
      ("2026-04-30T13:30:00.123+05:30", "2026-04-30T08:00:00.123Z"),
      ("2026-04-30T13:45:00.001+05:45", "2026-04-30T08:00:00.001Z"),
      ("2026-04-30T04:30:00.999-03:30", "2026-04-30T08:00:00.999Z"),
      ("2026-05-01T00:00:00.001+14:00", "2026-04-30T10:00:00.001Z"),
      ("2026-04-29T23:00:00.999-14:00", "2026-04-30T13:00:00.999Z"),
      ("2026-01-01T00:00:00.001+04:00", "2025-12-31T20:00:00.001Z"),
      ("2025-12-31T23:30:00.999-01:00", "2026-01-01T00:30:00.999Z"),
      ("2024-03-01T00:00:00.000+01:00", "2024-02-29T23:00:00.000Z"),
      ("2000-02-29T12:00:00Z", "2000-02-29T12:00:00.000Z"),
      ("2024-02-29T12:00:00Z", "2024-02-29T12:00:00.000Z"),
      ("2026-04-30T08:00:00+00:00", "2026-04-30T08:00:00.000Z"),
      ("2026-05-01T04:05:00.000+04:00", "2026-05-01T00:05:00.000Z"),
    ]
    try withRoot("shortcut-offsets") { root in
      let store = store(root: root)
      let sessionId = "history-shortcut-offsets"
      let secret = try store.beginSession(sessionId: sessionId)
      let body = "  Synthetic \"quoted\" \\ path\nدفعة 🧾 e\u{301} é\tAED 12.00  "
      let sender = "بنك TEST"
      let inputs = accepted.enumerated().map { index, sample in
        record(id: id("offset-\(index)"), text: body, sender: sender, receivedAt: sample.0)
      }
      let counts = try store.stageShortcutChunk(sessionId: sessionId, authorizationSecret: secret, chunkIndex: 0, records: inputs)
      check("Shortcut offsets accept every full-field valid record", counts == WafraHistoryChunkCounts(attempted: inputs.count, accepted: inputs.count, skipped: 0))
      check("Shortcut identical retry preserves receipt", try store.stageShortcutChunk(sessionId: sessionId, authorizationSecret: secret, chunkIndex: 0, records: inputs) == counts)
      check("Shortcut staged records remain unavailable before Finish", try store.completedSession(sessionId: sessionId) == nil)
      try store.finishSession(sessionId: sessionId, authorizationSecret: secret, totalChunks: 1, found: inputs.count, attempted: inputs.count, accepted: inputs.count, skipped: 0)
      let stored = try store.readChunk(sessionId: sessionId, chunkIndex: 0)
      check("Shortcut Finish preserves authoritative totals", try store.completedSession(sessionId: sessionId)?.accepted == inputs.count)
      for (index, value) in stored.enumerated() {
        let expected = record(id: id("offset-\(index)"), text: body, sender: sender, receivedAt: accepted[index].1)
        check("Shortcut date case \(index) canonicalizes timestamp with exact body, sender, ID and milliseconds", Data(value.utf8) == Data(expected.utf8))
      }
      check("Shortcut completed manifest keeps existing schema", Set(try manifest(root, sessionId).keys) == Set(["state", "createdAt", "expiresAt", "chunks", "finalTotals"]))
      try store.eraseAll()
      check("Shortcut data uses existing full erase lifecycle", try store.completedSession(sessionId: sessionId) == nil)
    }

    let invalid = [
      "2026-02-29T12:00:00Z", "1900-02-29T12:00:00Z", "2026-04-31T12:00:00Z",
      "2026-13-01T12:00:00Z", "2026-00-01T12:00:00Z", "2026-01-00T12:00:00Z",
      "0000-01-01T00:00:00Z", "0001-01-01T00:00:00+14:00",
      "2026-04-30T24:00:00Z", "2026-04-30T14:60:00Z", "2026-04-30T14:00:60Z",
      "2026-04-30T14:00:00", "2026-04-30T14:00:00.1Z", "2026-04-30T14:00:00.12Z",
      "2026-04-30T14:00:00.9999Z", "2026-04-30T14:00:00-00:00",
      "2026-04-30T14:00:00+14:01", "2026-04-30T14:00:00-14:01",
      "2026-04-30T14:00:00+04:60", "2026-04-30T14:00:00+99:00",
      "2026-04-30T14:00:00+0400", "2026-04-30T14:00:00Z ",
      "2026-05-01T04:05:00.001+04:00", "2026-04-30T14:00:00Z\n",
      "2026-04-30 14:00:00Z", "２０２６-04-30T14:00:00Z", "2026-04-30T14:00:00z",
      "2026-04-30T14:00:00+٠٤:٠٠", "2026-04-30T14:00:00Zsuffix",
    ]
    try withRoot("shortcut-invalid") { root in
      let store = store(root: root)
      let sessionId = "history-shortcut-invalid"
      let secret = try store.beginSession(sessionId: sessionId)
      var inputs = invalid.enumerated().map { index, value in
        record(id: id("invalid-offset-\(index)"), receivedAt: value)
      }
      let offsetRecord = record(id: id("offset-duplicate"), receivedAt: "2026-04-30T12:00:00.001+04:00")
      inputs += [
        offsetRecord.replacingOccurrences(of: "{", with: "{\"receivedAt\":\"2026-04-30T08:00:00Z\","),
        offsetRecord.replacingOccurrences(of: "{", with: "{\"received\\u0041t\":\"2026-04-30T08:00:00Z\","),
        offsetRecord.replacingOccurrences(of: "\"BANK\"", with: "{\"label\":1,\"label\":2}"),
        record(receivedAt: "2026-04-30T12:00:00+04:00", version: 2),
        record(receivedAt: "2026-04-30T12:00:00+04:00", extra: ["unknown": true]),
        record(text: String(repeating: "x", count: WafraMessageHistoryStore.maxTextBytes + 1), receivedAt: "2026-04-30T12:00:00+04:00"),
        record(id: "not-a-hash", receivedAt: "2026-04-30T12:00:00+04:00"),
      ]
      let counts = try store.stageShortcutChunk(sessionId: sessionId, authorizationSecret: secret, chunkIndex: 0, records: inputs)
      check("Shortcut rejects invalid dates, duplicate JSON keys and invalid schema before normalization", counts == WafraHistoryChunkCounts(attempted: inputs.count, accepted: 0, skipped: inputs.count))
    }
  }

  private static func testShortcutAuthenticationAndBounds() throws {
    for reverse in [false, true] {
      try withRoot("shortcut-cross-mode") { root in
        let store = store(root: root)
        let sessionId = "history-shortcut-cross-mode"
        let secret = try store.beginSession(sessionId: sessionId)
        let inputs = [record(receivedAt: "2026-04-30T12:00:00+04:00")]
        let counts = try reverse
          ? store.stageShortcutChunk(sessionId: sessionId, authorizationSecret: secret, chunkIndex: 0, records: inputs)
          : store.stageChunk(sessionId: sessionId, authorizationSecret: secret, chunkIndex: 0, records: inputs)
        check("legacy Stage still skips offsets; Shortcut Stage accepts them (reverse \(reverse))", counts.accepted == (reverse ? 1 : 0))
        expects("cross-mode receipt replay is refused (reverse \(reverse))", .chunkConflict) {
          _ = try reverse
            ? store.stageChunk(sessionId: sessionId, authorizationSecret: secret, chunkIndex: 0, records: inputs)
            : store.stageShortcutChunk(sessionId: sessionId, authorizationSecret: secret, chunkIndex: 0, records: inputs)
        }
        check("cross-mode conflict erases the invalid session", !FileManager.default.fileExists(atPath: root.appendingPathComponent(sessionId).path))
      }
    }
    for shortcut in [false, true] {
      try withRoot("shortcut-hmac") { root in
        let store = store(root: root)
        let sessionId = "history-shortcut-hmac"
        let secret = try store.beginSession(sessionId: sessionId)
        let inputs = [record(receivedAt: "2026-04-30T08:00:00.000Z"), "{\"v\":0}"]
        _ = try shortcut
          ? store.stageShortcutChunk(sessionId: sessionId, authorizationSecret: secret, chunkIndex: 0, records: inputs)
          : store.stageChunk(sessionId: sessionId, authorizationSecret: secret, chunkIndex: 0, records: inputs)
        var requestBytes = Data()
        if shortcut { requestBytes.append(Data("WafraMessageHistoryStore.stageShortcutChunk.v1\u{0}".utf8)) }
        requestBytes.append(try JSONEncoder().encode(inputs))
        let expected = HMAC<SHA256>.authenticationCode(for: requestBytes, using: SymmetricKey(data: decodedBase64URL(secret))).map { String(format: "%02x", $0) }.joined()
        let chunks = try manifest(root, sessionId)["chunks"] as! [String: Any]
        let summary = chunks["0"] as! [String: Any]
        check("request HMAC authenticates original bytes with correct domain (Shortcut \(shortcut))", summary["requestAuthenticationCode"] as? String == expected)
        if shortcut {
          expects("equivalent normalized date does not allow a different original input retry", .chunkConflict) {
            _ = try store.stageShortcutChunk(sessionId: sessionId, authorizationSecret: secret, chunkIndex: 0, records: [record(receivedAt: "2026-04-30T12:00:00.000+04:00"), "{\"v\":0}"])
          }
        }
      }
    }
    try withRoot("shortcut-bounds") { root in
      let store = store(root: root)
      let sessionId = "history-shortcut-bounds"
      let secret = try store.beginSession(sessionId: sessionId)
      let inputs = (0..<50).map { record(id: id("fifty-\($0)"), receivedAt: "2026-04-30T12:00:00+04:00") }
      check("Shortcut Stage accepts exactly 50 records", try store.stageShortcutChunk(sessionId: sessionId, authorizationSecret: secret, chunkIndex: 0, records: inputs).accepted == 50)
      expects("Shortcut Stage rejects more than 50 before decoding", .tooManyRecords) {
        _ = try store.stageShortcutChunk(sessionId: sessionId, authorizationSecret: secret, chunkIndex: 1, records: Array(repeating: "not-json", count: 51))
      }
    }
    try withRoot("shortcut-stored-strict") { root in
      let store = store(root: root)
      let sessionId = "history-shortcut-stored-strict"
      let secret = try store.beginSession(sessionId: sessionId)
      let original = record(receivedAt: "2026-04-30T12:00:00+04:00")
      _ = try store.stageShortcutChunk(sessionId: sessionId, authorizationSecret: secret, chunkIndex: 0, records: [original])
      try finishOne(store, sessionId: sessionId, secret: secret)
      // Update even the digest and byte count: persisted verification must
      // still reject the producer-only offset format after normalization.
      let forgedData = try JSONEncoder().encode([original])
      try writeProtectedForTest(forgedData, to: root.appendingPathComponent(sessionId).appendingPathComponent("chunk-0.json"))
      try mutateManifest(root: root, sessionId: sessionId) { value in
        var chunks = value["chunks"] as! [String: Any]
        var summary = chunks["0"] as! [String: Any]
        summary["contentDigest"] = SHA256.hash(data: forgedData).map { String(format: "%02x", $0) }.joined()
        summary["serializedBytes"] = forgedData.count
        chunks["0"] = summary
        value["chunks"] = chunks
      }
      expects("stored v1 verification never accepts Shortcut offset strings", .storageFailure) {
        _ = try store.readChunk(sessionId: sessionId, chunkIndex: 0)
      }
    }
    try withRoot("shortcut-expiry") { root in
      var now = fixedNow
      let store = store(root: root, now: { now })
      let sessionId = "history-shortcut-expiry"
      let secret = try store.beginSession(sessionId: sessionId)
      _ = try store.stageShortcutChunk(sessionId: sessionId, authorizationSecret: secret, chunkIndex: 0, records: [record()])
      now = fixedNow.addingTimeInterval(WafraMessageHistoryStore.sessionTTL)
      expects("Shortcut Stage preserves fixed session expiry", .sessionUnavailable) {
        _ = try store.stageShortcutChunk(sessionId: sessionId, authorizationSecret: secret, chunkIndex: 1, records: [record(id: id("expired"))])
      }
      check("expired Shortcut session is removed", !FileManager.default.fileExists(atPath: root.appendingPathComponent(sessionId).path))
    }
    try withRoot("shortcut-duplicate-id") { root in
      let store = store(root: root)
      let sessionId = "history-shortcut-duplicate-id"
      let secret = try store.beginSession(sessionId: sessionId)
      expects("Shortcut Stage rejects duplicate IDs after date normalization", .duplicateRecord) {
        _ = try store.stageShortcutChunk(sessionId: sessionId, authorizationSecret: secret, chunkIndex: 0, records: [record(), record(receivedAt: "2026-04-30T12:00:00+04:00")])
      }
    }
    try withRoot("shortcut-auth") { root in
      let store = store(root: root)
      let sessionId = "history-shortcut-auth"
      _ = try store.beginSession(sessionId: sessionId)
      expects("Shortcut Stage requires existing session authorization", .unauthorized) {
        _ = try store.stageShortcutChunk(sessionId: sessionId, authorizationSecret: "wrong", chunkIndex: 0, records: [record()])
      }
    }
  }

  private static func testJSONNestingLimit() throws {
    try withRoot("json-depth-boundary") { root in
      let store = store(root: root)
      let sessionId = "history-json-depth-boundary"
      let secret = try store.beginSession(sessionId: sessionId)

      let boundary = try store.stageChunk(
        sessionId: sessionId,
        authorizationSecret: secret,
        chunkIndex: 0,
        records: [recordWithNestedSender(
          id: id("json-depth-boundary"),
          depth: maximumJSONContainerDepth - 1
        )]
      )
      check(
        "nested non-string sender at the safety boundary is omitted",
        boundary == WafraHistoryChunkCounts(attempted: 1, accepted: 1, skipped: 0)
      )

      let overBoundary = try store.stageChunk(
        sessionId: sessionId,
        authorizationSecret: secret,
        chunkIndex: 1,
        records: [recordWithNestedSender(
          id: id("json-depth-over-boundary"),
          depth: maximumJSONContainerDepth
        )]
      )
      check(
        "record beyond the JSON nesting safety bound is skipped",
        overBoundary == WafraHistoryChunkCounts(attempted: 1, accepted: 0, skipped: 1)
      )
    }

    try withRoot("json-depth-process") { root in
      let process = Process()
      process.executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
      process.arguments = [
        "--child-json-depth",
        root.path,
        "history-json-depth-process",
        "50000",
      ]
      process.standardOutput = FileHandle.nullDevice
      process.standardError = FileHandle.nullDevice
      try process.run()
      process.waitUntilExit()
      check(
        "extreme JSON nesting is skipped without stack exhaustion",
        process.terminationReason == .exit && process.terminationStatus == 0
      )
    }
  }

  private static func testRetriesDigestsAndDuplicates() throws {
    try withRoot("retries") { root in
      let store = store(root: root)
      let sessionId = "history-retries"
      let secret = try store.beginSession(sessionId: sessionId)
      let inputs = [record(id: id("retry")), "{\"v\":0}"]
      let first = try store.stageChunk(sessionId: sessionId, authorizationSecret: secret, chunkIndex: 0, records: inputs)
      let retry = try store.stageChunk(sessionId: sessionId, authorizationSecret: secret, chunkIndex: 0, records: inputs)
      check("identical chunk retry is idempotent", retry == first)
      let storedManifest = try manifest(root, sessionId)
      let chunks = storedManifest["chunks"] as? [String: Any]
      let summary = chunks?["0"] as? [String: Any]
      let chunkData = try Data(contentsOf: root.appendingPathComponent(sessionId).appendingPathComponent("chunk-0.json"))
      let expectedDigest = SHA256.hash(data: chunkData).map { String(format: "%02x", $0) }.joined()
      check("chunk manifest stores content SHA-256", summary?["contentDigest"] as? String == expectedDigest)
      let requestAuthenticationCode = summary?["requestAuthenticationCode"] as? String
      let unkeyedRequestDigest = SHA256.hash(data: try JSONEncoder().encode(inputs))
        .map { String(format: "%02x", $0) }.joined()
      let manifestData = try Data(contentsOf: root.appendingPathComponent(sessionId).appendingPathComponent("manifest.plist"))
      check("manifest stores a keyed exact-input authenticator", requestAuthenticationCode?.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil && requestAuthenticationCode != unkeyedRequestDigest)
      check("exact-input authenticator stores no raw request body", !manifestData.contains(Data("Purchase of AED 12.00 at TEST".utf8)))

      expects("conflicting retry is rejected", .chunkConflict) {
        _ = try store.stageChunk(
          sessionId: sessionId,
          authorizationSecret: secret,
          chunkIndex: 0,
          records: [record(id: id("conflict"))]
        )
      }
      check("conflicting retry is tombstoned and hidden", try store.completedSession(sessionId: sessionId) == nil)
      check("conflicting retry begins best-effort deletion", !FileManager.default.fileExists(atPath: root.appendingPathComponent(sessionId).path))
    }

    try withRoot("duplicates") { root in
      let store = store(root: root)
      let sessionId = "history-duplicate-id"
      let secret = try store.beginSession(sessionId: sessionId)
      _ = try stageOne(store, sessionId: sessionId, secret: secret, chunkIndex: 0, recordId: id("same"))
      expects("duplicate accepted ID across chunks invalidates session", .duplicateRecord) {
        _ = try stageOne(store, sessionId: sessionId, secret: secret, chunkIndex: 1, recordId: id("same"))
      }
      check("duplicate-ID session is hidden", try store.completedSession(sessionId: sessionId) == nil)
    }

    try withRoot("all-skipped-retry-conflict") { root in
      let store = store(root: root)
      let sessionId = "history-skipped-retry"
      let secret = try store.beginSession(sessionId: sessionId)
      _ = try store.stageChunk(
        sessionId: sessionId,
        authorizationSecret: secret,
        chunkIndex: 0,
        records: ["{\"v\":0}"]
      )
      expects("different all-skipped input is a conflicting retry", .chunkConflict) {
        _ = try store.stageChunk(
          sessionId: sessionId,
          authorizationSecret: secret,
          chunkIndex: 0,
          records: ["malformed"]
        )
      }
    }

    try withRoot("unsafe-sender-retry-conflict") { root in
      let store = store(root: root)
      let sessionId = "history-sender-retry"
      let secret = try store.beginSession(sessionId: sessionId)
      let recordId = id("same-normalized-record")
      let first = record(id: recordId, sender: "")
      let second = record(id: recordId, sender: String(repeating: "x", count: 81))
      _ = try store.stageChunk(
        sessionId: sessionId,
        authorizationSecret: secret,
        chunkIndex: 0,
        records: [first]
      )
      expects("different unsafe-sender input is a conflicting retry", .chunkConflict) {
        _ = try store.stageChunk(
          sessionId: sessionId,
          authorizationSecret: secret,
          chunkIndex: 0,
          records: [second]
        )
      }
    }
  }

  private static func testFinishReconciliation() throws {
    func mismatch(
      _ name: String,
      totalChunks: Int = 1,
      found: Int = 2,
      attempted: Int = 2,
      accepted: Int = 1,
      skipped: Int = 1
    ) throws {
      try withRoot("finish") { root in
        let store = store(root: root)
        let sessionId = "history-\(UUID().uuidString)"
        let secret = try store.beginSession(sessionId: sessionId)
        _ = try store.stageChunk(sessionId: sessionId, authorizationSecret: secret, chunkIndex: 0, records: [record(), "{\"v\":0}"])
        expects(name, .countMismatch) {
          try store.finishSession(sessionId: sessionId, authorizationSecret: secret, totalChunks: totalChunks, found: found, attempted: attempted, accepted: accepted, skipped: skipped)
        }
        check("\(name) hides failed finish", try store.completedSession(sessionId: sessionId) == nil)
      }
    }

    try mismatch("totalChunks mismatch", totalChunks: 2)
    try mismatch("found must equal attempted", found: 3)
    try mismatch("attempted must equal persisted sum", found: 3, attempted: 3)
    try mismatch("accepted must equal persisted sum", accepted: 0, skipped: 2)
    try mismatch("skipped must equal persisted sum", accepted: 2, skipped: 0)
    try mismatch("accepted plus skipped must equal attempted", skipped: 0)

    try withRoot("missing-chunk") { root in
      let store = store(root: root)
      let sessionId = "history-missing-chunk"
      let secret = try store.beginSession(sessionId: sessionId)
      _ = try stageOne(store, sessionId: sessionId, secret: secret, chunkIndex: 1)
      expects("missing zero chunk is rejected", .noncontiguousChunks) {
        try store.finishSession(sessionId: sessionId, authorizationSecret: secret, totalChunks: 1, found: 1, attempted: 1, accepted: 1, skipped: 0)
      }
    }

    try withRoot("noncontiguous") { root in
      let store = store(root: root)
      let sessionId = "history-noncontiguous"
      let secret = try store.beginSession(sessionId: sessionId)
      _ = try stageOne(store, sessionId: sessionId, secret: secret, chunkIndex: 0, recordId: id("zero"))
      _ = try stageOne(store, sessionId: sessionId, secret: secret, chunkIndex: 2, recordId: id("two"))
      expects("noncontiguous chunk indices are rejected", .noncontiguousChunks) {
        try store.finishSession(sessionId: sessionId, authorizationSecret: secret, totalChunks: 3, found: 2, attempted: 2, accepted: 2, skipped: 0)
      }
    }
  }

  private static func testFinishVerifiesChunkFiles() throws {
    try withRoot("finish-missing-file") { root in
      let store = store(root: root)
      let sessionId = "history-finish-missing"
      let secret = try store.beginSession(sessionId: sessionId)
      _ = try stageOne(store, sessionId: sessionId, secret: secret)
      try FileManager.default.removeItem(
        at: root.appendingPathComponent(sessionId).appendingPathComponent("chunk-0.json")
      )
      expects("Finish rejects a missing listed chunk file", .storageFailure) {
        try finishOne(store, sessionId: sessionId, secret: secret)
      }
      check("missing-file Finish failure never becomes visible", try store.completedSession(sessionId: sessionId) == nil)
    }

    try withRoot("finish-digest-mismatch") { root in
      let store = store(root: root)
      let sessionId = "history-finish-digest"
      let secret = try store.beginSession(sessionId: sessionId)
      _ = try stageOne(store, sessionId: sessionId, secret: secret)
      let chunk = root.appendingPathComponent(sessionId).appendingPathComponent("chunk-0.json")
      let tampered = try JSONEncoder().encode([record(id: id("tampered"))])
      try tampered.write(to: chunk, options: [.atomic, .completeFileProtection])
      expects("Finish rejects a chunk content-digest mismatch", .storageFailure) {
        try finishOne(store, sessionId: sessionId, secret: secret)
      }
      check("digest-mismatch Finish failure never becomes visible", try store.completedSession(sessionId: sessionId) == nil)
    }

    try withRoot("finish-accepted-count-mismatch") { root in
      let store = store(root: root)
      let sessionId = "history-finish-count"
      let secret = try store.beginSession(sessionId: sessionId)
      _ = try stageOne(store, sessionId: sessionId, secret: secret)
      try mutateManifest(root: root, sessionId: sessionId) { object in
        var chunks = object["chunks"] as! [String: Any]
        var summary = chunks["0"] as! [String: Any]
        summary["attempted"] = 2
        summary["accepted"] = 2
        summary["recordIDs"] = [String(repeating: "a", count: 64), id("phantom")]
        chunks["0"] = summary
        object["chunks"] = chunks
      }
      expects("Finish verifies decoded accepted count against metadata", .storageFailure) {
        try store.finishSession(
          sessionId: sessionId,
          authorizationSecret: secret,
          totalChunks: 1,
          found: 2,
          attempted: 2,
          accepted: 2,
          skipped: 0
        )
      }
      check("accepted-count Finish failure never becomes visible", try store.completedSession(sessionId: sessionId) == nil)
    }
  }

  private static func stageUniqueRecords(
    _ store: WafraMessageHistoryStore,
    sessionId: String,
    secret: String,
    start: Int,
    count: Int,
    chunkIndex: Int,
    text: String = "Purchase of AED 1.00"
  ) throws {
    let records = (start..<(start + count)).map { record(id: id("\(sessionId)-\($0)"), text: text) }
    _ = try store.stageChunk(sessionId: sessionId, authorizationSecret: secret, chunkIndex: chunkIndex, records: records)
  }

  private static func fill(
    _ store: WafraMessageHistoryStore,
    sessionId: String,
    secret: String,
    total: Int,
    text: String
  ) throws {
    var offset = 0
    var chunk = 0
    while offset < total {
      let count = min(WafraMessageHistoryStore.maxChunkRecords, total - offset)
      try stageUniqueRecords(store, sessionId: sessionId, secret: secret, start: offset, count: count, chunkIndex: chunk, text: text)
      offset += count
      chunk += 1
    }
  }

  private static func testLimits() throws {
    try withRoot("record-limit") { root in
      let store = store(root: root)
      let sessionId = "history-record-limit"
      let secret = try store.beginSession(sessionId: sessionId)
      try fill(store, sessionId: sessionId, secret: secret, total: WafraMessageHistoryStore.maxSessionRecords, text: "x")
      expects("session accepted-record limit is enforced", .sessionRecordLimit) {
        try stageUniqueRecords(store, sessionId: sessionId, secret: secret, start: WafraMessageHistoryStore.maxSessionRecords, count: 1, chunkIndex: 200)
      }
    }

    try withRoot("byte-limit") { root in
      let store = store(root: root)
      let sessionId = "history-byte-limit"
      let secret = try store.beginSession(sessionId: sessionId)
      let largeText = String(repeating: "x", count: 16_200)
      try fill(store, sessionId: sessionId, secret: secret, total: 1_500, text: largeText)
      expects("24-MiB session serialized-data limit is enforced", .sessionByteLimit) {
        try stageUniqueRecords(store, sessionId: sessionId, secret: secret, start: 1_500, count: 50, chunkIndex: 30, text: largeText)
      }
    }

    try withRoot("session-count-limit") { root in
      let store = store(root: root)
      for index in 0..<WafraMessageHistoryStore.maxStoredSessions {
        _ = try store.beginSession(sessionId: "history-session-limit-\(index)")
      }
      expects("four-session global limit is enforced", .globalSessionLimit) {
        _ = try store.beginSession(sessionId: "history-session-limit-overflow")
      }
    }

    try withRoot("global-byte-limit") { root in
      let store = store(root: root)
      let largeText = String(repeating: "y", count: 16_000)
      for index in 0..<3 {
        let sessionId = "history-global-bytes-\(index)"
        let secret = try store.beginSession(sessionId: sessionId)
        try fill(store, sessionId: sessionId, secret: secret, total: 1_450, text: largeText)
      }
      let sessionId = "history-global-bytes-overflow"
      let secret = try store.beginSession(sessionId: sessionId)
      var sawGlobalLimit = false
      var offset = 0
      var chunk = 0
      while !sawGlobalLimit && chunk < 50 {
        do {
          try stageUniqueRecords(store, sessionId: sessionId, secret: secret, start: offset, count: 50, chunkIndex: chunk, text: largeText)
          offset += 50
          chunk += 1
        } catch let error as WafraMessageHistoryStore.StoreError {
          sawGlobalLimit = error == .globalByteLimit
        }
      }
      check("72-MiB global storage limit is enforced", sawGlobalLimit)
    }
  }

  private static func testManifestInvariantValidation() throws {
    try withRoot("manifest-expiry-invariant") { root in
      let store = store(root: root)
      let sessionId = "history-corrupt-expiry"
      let secret = try store.beginSession(sessionId: sessionId)
      try mutateManifest(root: root, sessionId: sessionId) { object in
        object["expiresAt"] = fixedNow.addingTimeInterval(2 * WafraMessageHistoryStore.sessionTTL)
      }
      expectsSourceFreeStoreError("non-fixed manifest expiry tombstones instead of staging", sensitive: [sessionId, secret]) {
        _ = try stageOne(store, sessionId: sessionId, secret: secret)
      }
      check("non-fixed expiry manifest is tombstoned", !FileManager.default.fileExists(atPath: root.appendingPathComponent(sessionId).path))
    }

    try withRoot("manifest-secret-invariant") { root in
      let store = store(root: root)
      let sessionId = "history-corrupt-secret"
      let secret = try store.beginSession(sessionId: sessionId)
      try mutateManifest(root: root, sessionId: sessionId) { object in
        object["secretHash"] = "not-a-sha256"
      }
      expectsSourceFreeStoreError("malformed manifest secret hash tombstones safely", sensitive: [sessionId, secret]) {
        _ = try stageOne(store, sessionId: sessionId, secret: secret)
      }
    }

    try withRoot("manifest-complete-invariant") { root in
      let store = store(root: root)
      let sessionId = "history-corrupt-complete"
      let secret = try store.beginSession(sessionId: sessionId)
      _ = try stageOne(store, sessionId: sessionId, secret: secret)
      try finishOne(store, sessionId: sessionId, secret: secret)
      try mutateManifest(root: root, sessionId: sessionId) { object in
        var totals = object["finalTotals"] as! [String: Any]
        totals["found"] = 2
        totals["attempted"] = 2
        totals["accepted"] = 2
        object["finalTotals"] = totals
      }
      check("inconsistent complete totals tombstone safely", try store.completedSession(sessionId: sessionId) == nil)
    }

    try withRoot("manifest-overflow") { root in
      let setup = store(root: root)
      let sessionId = "history-corrupt-overflow"
      let secret = try setup.beginSession(sessionId: sessionId)
      try mutateManifest(root: root, sessionId: sessionId) { object in
        object["chunks"] = [
          "0": [
            "contentDigest": String(repeating: "a", count: 64),
            "requestAuthenticationCode": String(repeating: "b", count: 64),
            "attempted": Int.max,
            "accepted": Int.max,
            "skipped": 0,
            "serializedBytes": Int.max,
            "recordIDs": [id("overflow-existing")],
          ] as [String: Any],
        ]
      }
      let secretFile = root.appendingPathComponent("test-secret")
      try Data(secret.utf8).write(to: secretFile, options: .atomic)
      let process = Process()
      process.executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
      process.arguments = ["--child-overflow", root.path, sessionId, secretFile.path]
      process.standardOutput = FileHandle.nullDevice
      process.standardError = FileHandle.nullDevice
      try process.run()
      process.waitUntilExit()
      check("overflowing corrupt manifest returns StoreError without process trap", process.terminationStatus == 0)
    }
  }

  private static func testFixedExpiryAndVisibility() throws {
    try withRoot("expiry") { root in
      var current = fixedNow
      let store = store(root: root, now: { current })
      let sessionId = "history-fixed-expiry"
      let secret = try store.beginSession(sessionId: sessionId)
      current = fixedNow.addingTimeInterval(30 * 60)
      _ = try stageOne(store, sessionId: sessionId, secret: secret)
      current = fixedNow.addingTimeInterval(59 * 60)
      try finishOne(store, sessionId: sessionId, secret: secret)
      check("operations do not move fixed expiry", try manifest(root, sessionId)["expiresAt"] as? Date == fixedNow.addingTimeInterval(WafraMessageHistoryStore.sessionTTL))
      check("complete session remains visible before fixed expiry", try store.completedSession(sessionId: sessionId) != nil)
      current = fixedNow.addingTimeInterval(WafraMessageHistoryStore.sessionTTL + 1)
      check("complete session is hidden after fixed expiry", try store.completedSession(sessionId: sessionId) == nil)
      check("expired complete directory is removed", !FileManager.default.fileExists(atPath: root.appendingPathComponent(sessionId).path))
    }

    try withRoot("purge-count") { root in
      var current = fixedNow
      let store = store(root: root, now: { current })
      _ = try store.beginSession(sessionId: "history-expired-open")
      current = fixedNow.addingTimeInterval(WafraMessageHistoryStore.sessionTTL + 1)
      check("purgeExpired reports sessions removed by this pass", try store.purgeExpired(now: current) == 1)
      check("second expiry pass does not recount removed session", try store.purgeExpired(now: current) == 0)
    }
  }

  private static func testCompletedSessionRecovery() throws {
    try withRoot("completed-recovery-single") { root in
      var current = fixedNow
      let store = store(root: root, now: { current })

      let olderSessionId = "history-recovery-older"
      let olderSecret = try store.beginSession(sessionId: olderSessionId)
      _ = try stageOne(
        store,
        sessionId: olderSessionId,
        secret: olderSecret,
        recordId: id("recovery-older")
      )
      try finishOne(store, sessionId: olderSessionId, secret: olderSecret)

      let cutoff = fixedNow.addingTimeInterval(10)
      current = cutoff
      let recoveredSessionId = "history-recovery-exact-cutoff"
      let recoveredSecret = try store.beginSession(sessionId: recoveredSessionId)
      _ = try stageOne(
        store,
        sessionId: recoveredSessionId,
        secret: recoveredSecret,
        recordId: id("recovery-exact-cutoff")
      )
      try finishOne(store, sessionId: recoveredSessionId, secret: recoveredSecret)

      current = cutoff.addingTimeInterval(1)
      _ = try store.beginSession(sessionId: "history-recovery-open")

      check(
        "recovery returns the one completed session created exactly at the cutoff",
        try store.recoverCompletedSession(startedAfter: cutoff) ==
          WafraRecoveredHistorySession(
            sessionId: recoveredSessionId,
            chunkIndices: [0],
            found: 1,
            attempted: 1,
            accepted: 1,
            skipped: 0
          )
      )
    }

    try withRoot("completed-recovery-none") { root in
      let store = store(root: root)
      _ = try store.beginSession(sessionId: "history-recovery-none-open")
      check(
        "recovery returns nil when no completed session meets the cutoff",
        try store.recoverCompletedSession(startedAfter: fixedNow) == nil
      )
    }

    try withRoot("completed-recovery-expiry") { root in
      var current = fixedNow
      let store = store(root: root, now: { current })
      let sessionId = "history-recovery-expired"
      let secret = try store.beginSession(sessionId: sessionId)
      _ = try stageOne(store, sessionId: sessionId, secret: secret)
      try finishOne(store, sessionId: sessionId, secret: secret)
      current = fixedNow.addingTimeInterval(WafraMessageHistoryStore.sessionTTL + 1)
      check(
        "recovery purges expired sessions before selecting a result",
        try store.recoverCompletedSession(startedAfter: fixedNow) == nil
      )
      check(
        "recovery physically removes an expired completed session",
        !FileManager.default.fileExists(atPath: root.appendingPathComponent(sessionId).path)
      )
    }

    try withRoot("completed-recovery-ambiguous") { root in
      let store = store(root: root)
      for index in 0..<2 {
        let sessionId = "history-recovery-ambiguous-\(index)"
        let secret = try store.beginSession(sessionId: sessionId)
        _ = try stageOne(
          store,
          sessionId: sessionId,
          secret: secret,
          recordId: id("recovery-ambiguous-\(index)")
        )
        try finishOne(store, sessionId: sessionId, secret: secret)
      }
      expects(
        "recovery fails closed when more than one completed session meets the cutoff",
        .ambiguousCompletedSessions
      ) {
        _ = try store.recoverCompletedSession(startedAfter: fixedNow)
      }
    }

    try withRoot("completed-recovery-corrupt-manifest") { root in
      let store = store(root: root)
      let sessionId = "history-recovery-corrupt-manifest"
      let secret = try store.beginSession(sessionId: sessionId)
      _ = try stageOne(store, sessionId: sessionId, secret: secret)
      try finishOne(store, sessionId: sessionId, secret: secret)
      try mutateManifest(root: root, sessionId: sessionId) { object in
        var totals = object["finalTotals"] as! [String: Any]
        totals["accepted"] = 2
        object["finalTotals"] = totals
      }
      expects("recovery rejects and removes a corrupt matching manifest", .storageFailure) {
        _ = try store.recoverCompletedSession(startedAfter: fixedNow)
      }
      check(
        "corrupt recovery manifest is no longer eligible on retry",
        try store.recoverCompletedSession(startedAfter: fixedNow) == nil
      )
    }

    try withRoot("completed-recovery-corrupt-chunk") { root in
      let store = store(root: root)
      let sessionId = "history-recovery-corrupt-chunk"
      let secret = try store.beginSession(sessionId: sessionId)
      _ = try stageOne(store, sessionId: sessionId, secret: secret)
      try finishOne(store, sessionId: sessionId, secret: secret)
      try writeProtectedForTest(
        Data("[]".utf8),
        to: root.appendingPathComponent(sessionId).appendingPathComponent("chunk-0.json")
      )
      expects("recovery verifies matching chunk bytes before disclosure", .storageFailure) {
        _ = try store.recoverCompletedSession(startedAfter: fixedNow)
      }
    }

    try withRoot("completed-recovery-protection") { root in
      let store = store(root: root)
      let sessionId = "history-recovery-unprotected"
      let secret = try store.beginSession(sessionId: sessionId)
      _ = try stageOne(store, sessionId: sessionId, secret: secret)
      try finishOne(store, sessionId: sessionId, secret: secret)
      let manifestURL = root.appendingPathComponent(sessionId)
        .appendingPathComponent("manifest.plist")
      try FileManager.default.setAttributes(
        [.protectionKey: FileProtectionType.none],
        ofItemAtPath: manifestURL.path
      )
      expects("recovery rejects weakened at-rest protection", .storageFailure) {
        _ = try store.recoverCompletedSession(startedAfter: fixedNow)
      }
    }

    try withRoot("completed-recovery-symlink") { root in
      let outsideRoot = temporaryRoot("completed-recovery-symlink-outside")
      defer { try? FileManager.default.removeItem(at: outsideRoot) }
      let outsideStore = store(root: outsideRoot)
      let sessionId = "history-recovery-symlink"
      let secret = try outsideStore.beginSession(sessionId: sessionId)
      _ = try stageOne(outsideStore, sessionId: sessionId, secret: secret)
      try finishOne(outsideStore, sessionId: sessionId, secret: secret)

      let recoveryStore = store(root: root)
      _ = try recoveryStore.purgeExpired(now: fixedNow)
      try FileManager.default.createSymbolicLink(
        at: root.appendingPathComponent(sessionId),
        withDestinationURL: outsideRoot.appendingPathComponent(sessionId)
      )
      expects("recovery rejects a symlinked session directory", .storageFailure) {
        _ = try recoveryStore.recoverCompletedSession(startedAfter: fixedNow)
      }
      check(
        "rejecting a symlinked session does not mutate its external target",
        try outsideStore.completedSession(sessionId: sessionId) != nil
      )
    }

    try withRoot("completed-recovery-cutoff") { root in
      let store = store(root: root)
      expects("recovery rejects a non-finite cutoff", .invalidRecoveryCutoff) {
        _ = try store.recoverCompletedSession(
          startedAfter: Date(timeIntervalSince1970: .nan)
        )
      }
    }
  }

  private static func testFailedDeletionAndCleanupRetry() throws {
    try withRoot("failed-delete") { root in
      var failuresRemaining = 1
      let flaky = store(root: root, removeItem: { url in
        if failuresRemaining > 0 {
          failuresRemaining -= 1
          throw HarnessError.injectedDeletionFailure
        }
        try FileManager.default.removeItem(at: url)
      })
      let sessionId = "history-failed-delete"
      let secret = try flaky.beginSession(sessionId: sessionId)
      _ = try stageOne(flaky, sessionId: sessionId, secret: secret, recordId: id("first"))
      expects("conflict error survives failed deletion", .chunkConflict) {
        _ = try stageOne(flaky, sessionId: sessionId, secret: secret, recordId: id("other"))
      }
      let tombstone = try manifest(root, sessionId)
      check("failed deletion leaves invalid tombstone", tombstone["state"] as? String == "invalid")
      check("invalid tombstone clears secret hash", tombstone["secretHash"] == nil)
      check("invalid tombstone is never visible", try flaky.completedSession(sessionId: sessionId) == nil)
      check("next public operation retries tombstone deletion", !FileManager.default.fileExists(atPath: root.appendingPathComponent(sessionId).path))
    }


    try withRoot("failed-tombstone-and-delete") { root in
      let setup = store(root: root)
      let sessionId = "history-dual-failure"
      let secret = try setup.beginSession(sessionId: sessionId)
      _ = try stageOne(setup, sessionId: sessionId, secret: secret)
      try finishOne(setup, sessionId: sessionId, secret: secret)
      let doublyFailing = store(
        root: root,
        removeItem: { _ in throw HarnessError.injectedDeletionFailure },
        writeData: { data, url in
          if
            url.lastPathComponent == "manifest.plist",
            let object = try? PropertyListSerialization.propertyList(
              from: data,
              format: nil
            ) as? [String: Any],
            object["state"] as? String == "invalid"
          {
            throw HarnessError.injectedWriteFailure
          }
          try writeProtectedForTest(data, to: url)
        }
      )
      expects("discard reports cleanup failure when deletion is injected", .cleanupFailure) {
        try doublyFailing.discardSession(sessionId: sessionId)
      }
      let independentReader = store(root: root)
      check("tombstone-write plus deletion failure cannot leave complete session visible", try independentReader.completedSession(sessionId: sessionId) == nil)
    }
  }

  private static func testDiscardEraseAndStorageAttributes() throws {
    try withRoot("discard") { root in
      let store = store(root: root)
      let sessionId = "history-discard"
      _ = try store.beginSession(sessionId: sessionId)
      try store.discardSession(sessionId: sessionId)
      try store.discardSession(sessionId: sessionId)
      check("discard is idempotent and removes open session", !FileManager.default.fileExists(atPath: root.appendingPathComponent(sessionId).path))
    }

    try withRoot("erase") { root in
      let store = store(root: root)
      for index in 0..<3 {
        let sessionId = "history-erase-\(index)"
        let secret = try store.beginSession(sessionId: sessionId)
        if index == 1 {
          _ = try stageOne(store, sessionId: sessionId, secret: secret)
          try finishOne(store, sessionId: sessionId, secret: secret)
        }
      }
      try store.eraseAll()
      let remaining = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isDirectoryKey])
        .filter { (try? $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true }
      check("eraseAll removes open and complete sessions", remaining.isEmpty)
    }


    try withRoot("erase-order") { root in
      let setup = store(root: root)
      let sessionIds = (0..<3).map { "history-erase-order-\($0)" }
      for (index, sessionId) in sessionIds.enumerated() {
        let secret = try setup.beginSession(sessionId: sessionId)
        _ = try stageOne(setup, sessionId: sessionId, secret: secret, recordId: id("erase-order-\(index)"))
        try finishOne(setup, sessionId: sessionId, secret: secret)
      }

      var firstDeletionSawEveryTombstone = false
      var deletionAttempts = 0
      let failingErase = store(root: root, removeItem: { _ in
        if deletionAttempts == 0 {
          firstDeletionSawEveryTombstone = sessionIds.allSatisfy {
            (try? manifest(root, $0)["state"] as? String) == "invalid"
          }
        }
        deletionAttempts += 1
        throw HarnessError.injectedDeletionFailure
      })
      expects("eraseAll reports injected deletion failure", .cleanupFailure) {
        try failingErase.eraseAll()
      }
      check("eraseAll tombstones every session before its first deletion", firstDeletionSawEveryTombstone)
      expects("eraseAll deletion failure keeps bridge reads behind the erase fence", .cleanupFailure) {
        _ = try failingErase.completedSession(sessionId: sessionIds[0])
      }
    }

    try withRoot("attributes") { root in
      let store = store(root: root)
      let sessionId = "history-attributes"
      let secret = try store.beginSession(sessionId: sessionId)
      _ = try stageOne(store, sessionId: sessionId, secret: secret)
      try finishOne(store, sessionId: sessionId, secret: secret)
      let session = root.appendingPathComponent(sessionId)
      let manifestURL = session.appendingPathComponent("manifest.plist")
      let chunk = session.appendingPathComponent("chunk-0.json")
      let backup = try root.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup
      check("history root is excluded from backup", backup == true)
      for (label, url) in [("root", root), ("session directory", session), ("manifest", manifestURL), ("chunk", chunk)] {
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        check("\(label) uses FileProtectionType.complete", attributes[.protectionKey] as? FileProtectionType == .complete)
      }
      for (label, url) in [("history root", root), ("history session", session)] {
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        check(
          "\(label) uses owner-only POSIX permissions",
          (attributes[.posixPermissions] as? NSNumber)?.intValue == 0o700
        )
      }
      check("test fixture actually stores protected bytes", try directoryBytes(session) > 0)
    }

    try withRoot("directory-permission-upgrade-direct") { root in
      let setup = store(root: root)
      let sessionId = "history-permission-upgrade-direct"
      let secret = try setup.beginSession(sessionId: sessionId)
      _ = try stageOne(setup, sessionId: sessionId, secret: secret)
      try finishOne(setup, sessionId: sessionId, secret: secret)
      let session = root.appendingPathComponent(sessionId, isDirectory: true)
      try FileManager.default.setAttributes(
        [.posixPermissions: 0o755],
        ofItemAtPath: root.path
      )
      try FileManager.default.setAttributes(
        [.posixPermissions: 0o755],
        ofItemAtPath: session.path
      )

      let reader = store(root: root)
      check(
        "direct completed-session access upgrades a legacy directory",
        try reader.completedSession(sessionId: sessionId) != nil
      )
      for (label, url) in [("direct root", root), ("direct session", session)] {
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        check(
          "\(label) is repaired to owner-only POSIX permissions",
          (attributes[.posixPermissions] as? NSNumber)?.intValue == 0o700
        )
      }
    }

    try withRoot("directory-permission-upgrade-recovery") { root in
      let setup = store(root: root)
      let sessionId = "history-permission-upgrade-recovery"
      let secret = try setup.beginSession(sessionId: sessionId)
      _ = try stageOne(setup, sessionId: sessionId, secret: secret)
      try finishOne(setup, sessionId: sessionId, secret: secret)
      let session = root.appendingPathComponent(sessionId, isDirectory: true)
      try FileManager.default.setAttributes(
        [.posixPermissions: 0o755],
        ofItemAtPath: root.path
      )
      try FileManager.default.setAttributes(
        [.posixPermissions: 0o755],
        ofItemAtPath: session.path
      )

      let recovered = store(root: root)
      check(
        "cold recovery upgrades a legacy completed-session directory",
        try recovered.recoverCompletedSession(startedAfter: fixedNow)?.sessionId == sessionId
      )
      for (label, url) in [("recovery root", root), ("recovery session", session)] {
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        check(
          "\(label) is repaired to owner-only POSIX permissions",
          (attributes[.posixPermissions] as? NSNumber)?.intValue == 0o700
        )
      }
    }
  }

  private static func testEraseDurabilityAndRecovery() throws {
    try withRoot("erase-hidden-failure") { root in
      try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
      let hidden = root.appendingPathComponent(".invalid-preexisting", isDirectory: true)
      try FileManager.default.createDirectory(at: hidden, withIntermediateDirectories: false)
      try Data("tombstone".utf8).write(to: hidden.appendingPathComponent("source"))
      let marker = root.appendingPathComponent(eraseMarkerName)
      var deletionObservedMarker = false
      let failing = store(root: root, removeItem: { url in
        if url.lastPathComponent == hidden.lastPathComponent {
          deletionObservedMarker = FileManager.default.fileExists(atPath: marker.path)
          throw HarnessError.injectedDeletionFailure
        }
        try FileManager.default.removeItem(at: url)
      })

      expects("eraseAll fails while a pre-existing hidden tombstone remains", .cleanupFailure) {
        try failing.eraseAll()
      }
      check("erase marker precedes hidden tombstone deletion", deletionObservedMarker)
      check("failed hidden tombstone deletion retains erase marker", FileManager.default.fileExists(atPath: marker.path))
      check("failed hidden tombstone remains physically stored", FileManager.default.fileExists(atPath: hidden.path))

      try store(root: root).eraseAll()
      check("successful erase retry removes pre-existing hidden tombstone", !FileManager.default.fileExists(atPath: hidden.path))
      check("successful erase retry clears root marker last", !FileManager.default.fileExists(atPath: marker.path))
    }

    try withRoot("erase-marker-crash") { root in
      let setup = store(root: root)
      let sessionIds = ["history-marker-crash-one", "history-marker-crash-two"]
      for (index, sessionId) in sessionIds.enumerated() {
        let secret = try setup.beginSession(sessionId: sessionId)
        _ = try stageOne(setup, sessionId: sessionId, secret: secret, recordId: id("marker-crash-\(index)"))
        try finishOne(setup, sessionId: sessionId, secret: secret)
      }

      let process = Process()
      process.executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
      process.arguments = ["--child-crash-after-erase-marker", root.path]
      process.standardOutput = FileHandle.nullDevice
      process.standardError = FileHandle.nullDevice
      try process.run()
      process.waitUntilExit()

      let marker = root.appendingPathComponent(eraseMarkerName)
      check("erase process can be interrupted immediately after durable marker", process.terminationReason == .exit && process.terminationStatus == 71)
      check("marker survives interruption before per-session mutation", FileManager.default.fileExists(atPath: marker.path))
      check("marker-first interruption leaves the complete fixture on disk", FileManager.default.fileExists(atPath: root.appendingPathComponent(sessionIds[0]).path))

      let blocked = store(root: root, removeItem: { _ in
        throw HarnessError.injectedDeletionFailure
      })
      expects("fresh store cannot reveal completed data behind pending erase", .cleanupFailure) {
        _ = try blocked.completedSession(sessionId: sessionIds[0])
      }
      expects("fresh store cannot read chunks behind pending erase", .cleanupFailure) {
        _ = try blocked.readChunk(sessionId: sessionIds[0], chunkIndex: 0)
      }
      expects("pending erase prevents a fresh Begin while cleanup still fails", .cleanupFailure) {
        _ = try blocked.beginSession(sessionId: "history-marker-blocked-new")
      }
      check("failed fresh-store retries retain the erase marker", FileManager.default.fileExists(atPath: marker.path))
      check("pending erase never creates the requested new session", !FileManager.default.fileExists(atPath: root.appendingPathComponent("history-marker-blocked-new").path))

      let recovered = store(root: root)
      check("ordinary fresh-store read retries and completes pending erase", try recovered.completedSession(sessionId: sessionIds[0]) == nil)
      check("recovered erase removes every source directory", try storedDirectories(root).isEmpty)
      check("recovered erase clears marker only after source removal", !FileManager.default.fileExists(atPath: marker.path))
    }

    try withRoot("erase-midway-crash") { root in
      let setup = store(root: root)
      let sessionIds = (0..<3).map { "history-midway-crash-\($0)" }
      for (index, sessionId) in sessionIds.enumerated() {
        let secret = try setup.beginSession(sessionId: sessionId)
        _ = try stageOne(setup, sessionId: sessionId, secret: secret, recordId: id("midway-crash-\(index)"))
        try finishOne(setup, sessionId: sessionId, secret: secret)
      }

      let process = Process()
      process.executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
      process.arguments = ["--child-crash-midway-erase", root.path]
      process.standardOutput = FileHandle.nullDevice
      process.standardError = FileHandle.nullDevice
      try process.run()
      process.waitUntilExit()

      let marker = root.appendingPathComponent(eraseMarkerName)
      check("erase process can be interrupted after one physical deletion", process.terminationReason == .exit && process.terminationStatus == 72)
      check("midway interruption retains root erase marker", FileManager.default.fileExists(atPath: marker.path))
      check("midway interruption leaves source directories for recovery", try !storedDirectories(root).isEmpty)

      let blocked = store(root: root, removeItem: { _ in
        throw HarnessError.injectedDeletionFailure
      })
      expects("fresh store refuses bridge visibility after midway interruption", .cleanupFailure) {
        _ = try blocked.completedSession(sessionId: sessionIds[2])
      }

      let recovered = store(root: root)
      check("fresh store retries midway erase before bridge lookup", try recovered.completedSession(sessionId: sessionIds[2]) == nil)
      check("midway recovery physically removes all source directories", try storedDirectories(root).isEmpty)
      check("midway recovery clears marker last", !FileManager.default.fileExists(atPath: marker.path))
    }

    try withRoot("hidden-session-limit") { root in
      try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
      for index in 0..<WafraMessageHistoryStore.maxStoredSessions {
        let tombstone = root.appendingPathComponent(".invalid-persistent-\(index)", isDirectory: true)
        try FileManager.default.createDirectory(at: tombstone, withIntermediateDirectories: false)
        try Data([UInt8(index)]).write(to: tombstone.appendingPathComponent("source"))
      }
      let persistentFailure = store(root: root, removeItem: { _ in
        throw HarnessError.injectedDeletionFailure
      })
      expects("hidden tombstones consume the four-session global limit", .globalSessionLimit) {
        _ = try persistentFailure.beginSession(sessionId: "history-hidden-limit-new")
      }
      check(
        "persistent deletion failure cannot create a fifth stored directory",
        try storedDirectories(root).count == WafraMessageHistoryStore.maxStoredSessions
      )
    }
  }

  private static func expectsBulkImportFailure(
    _ name: String,
    sensitive: [String] = [],
    operation: () throws -> Void
  ) {
    do {
      try operation()
      check(name, false)
    } catch {
      let descriptions = String(describing: error) + String(reflecting: error)
      check(name, sensitive.allSatisfy { !descriptions.contains($0) })
    }
  }

  private static func bulkInput(
    count: Int,
    body: (Int) -> String = { "Purchase of AED \($0 + 1).00 at TEST" }
  ) -> (guids: [String], bodies: [String], dates: [Date]) {
    (
      guids: (0..<count).map { "MESSAGE-GUID-\($0)" },
      bodies: (0..<count).map(body),
      dates: (0..<count).map { fixedNow.addingTimeInterval(-Double($0 + 1)) }
    )
  }

  private static func testBulkHistoryImporterCanonicalRecords() throws {
    try withRoot("bulk-canonical") { root in
      let historyStore = store(root: root)
      let importer = WafraMessageHistoryImporter(
        store: historyStore,
        now: { fixedNow }
      )
      let body = "Purchase of AED 12.34 at \"TEST\\SHOP\"\nمرحبا"
      let result = try importer.importMessages(
        sessionId: "history-bulk-valid",
        found: 1,
        messageGUIDs: ["MESSAGE-GUID-1"],
        bodies: [body],
        dates: [fixedNow.addingTimeInterval(-60)]
      )

      check(
        "bulk importer reports canonical successful totals",
        result == WafraBulkHistoryImportResult(
          totalChunks: 1,
          found: 1,
          attempted: 1,
          accepted: 1,
          skipped: 0
        )
      )
      let descriptor = try historyStore.completedSession(sessionId: "history-bulk-valid")
      check("bulk importer completes one visible chunk", descriptor?.chunkIndices == [0])
      check("bulk completed descriptor reconciles found", descriptor?.found == 1)
      let records = try historyStore.readChunk(sessionId: "history-bulk-valid", chunkIndex: 0)
      check("bulk importer stores one accepted record", records.count == 1)
      let object = try JSONSerialization.jsonObject(with: Data(records[0].utf8)) as! [String: Any]
      check(
        "bulk importer hashes raw GUID with a fixed SHA-256 vector",
        object["id"] as? String == "2ab8a9ceeae492fc18e53f245cae765ff19b6991946fd50cb205049b33c9b1b7"
      )
      check("bulk importer preserves Unicode and JSON metacharacters", object["text"] as? String == body)
      check(
        "bulk importer emits canonical UTC milliseconds",
        object["receivedAt"] as? String == "2026-04-30T23:59:00.000Z"
      )
      check("bulk importer emits numeric version one", (object["v"] as? NSNumber)?.intValue == 1)
      check("bulk importer omits sender in the first bulk version", object["sender"] == nil)
      check("bulk importer never persists the raw GUID", !records[0].contains("MESSAGE-GUID-1"))

      check(
        "bulk record encoder emits the exact missing-record sentinel",
        WafraMessageHistoryImporter.preparedRecord(
          guid: "",
          body: "ignored",
          date: fixedNow,
          now: fixedNow
        ) == "{\"v\":0}"
      )
      let sentinelCases: [(String, String, Date)] = [
        (String(repeating: "g", count: 1_025), "valid", fixedNow),
        ("guid-whitespace", " \n\t ", fixedNow),
        (
          "guid-oversized",
          String(repeating: "x", count: WafraMessageHistoryStore.maxTextBytes + 1),
          fixedNow
        ),
        ("guid-epoch", "valid", Date(timeIntervalSince1970: 0)),
        ("guid-future", "valid", fixedNow.addingTimeInterval(5 * 60 + 1)),
      ]
      check(
        "bulk record encoder maps every invalid boundary to the exact sentinel",
        sentinelCases.allSatisfy { guid, text, date in
          WafraMessageHistoryImporter.preparedRecord(
            guid: guid,
            body: text,
            date: date,
            now: fixedNow
          ) == "{\"v\":0}"
        }
      )
    }
  }

  private static func testPreparedHistoryCanonicalImport() throws {
    check(
      "prepared history keeps long-running imports alive for exactly three hours",
      WafraPreparedHistoryStore.sessionTTL == 3 * 60 * 60
    )
    check(
      "history session byte ceiling supports large selected ranges",
      WafraMessageHistoryStore.maxSessionBytes == 24 * 1024 * 1024
    )
    check(
      "history global byte ceiling remains exactly three full sessions",
      WafraMessageHistoryStore.maxStoredBytes == 72 * 1024 * 1024
    )
    try withRoot("prepared-canonical") { root in
      let preparationRoot = root.appendingPathComponent("prepared", isDirectory: true)
      let historyRoot = root.appendingPathComponent("history", isDirectory: true)
      let prepared = preparedStore(root: preparationRoot)
      let history = store(root: historyRoot)
      let importer = WafraMessageHistoryImporter(
        store: history,
        preparedStore: prepared,
        now: { fixedNow }
      )
      let sessionId = "51E80925-88B9-466D-AC85-C3EA694948F3"
      let guid = "prepared-private-guid"
      let body = "Card purchase AED 42.50 at Café 🍵"
      let sender = "EMIRATES NBD"

      try prepared.prepare(
        sessionId: sessionId,
        found: 1,
        position: 1,
        guid: guid,
        body: body,
        sender: sender,
        date: fixedNow.addingTimeInterval(-60)
      )
      try importer.importPrepared(sessionId: sessionId, found: 1)

      let descriptor = try history.completedSession(sessionId: sessionId)
      check(
        "prepared scalar import completes one reconciled record",
        descriptor == WafraCompletedHistorySession(
          chunkIndices: [0], found: 1, attempted: 1, accepted: 1, skipped: 0
        )
      )
      let records = try history.readChunk(sessionId: sessionId, chunkIndex: 0)
      let object = try JSONSerialization.jsonObject(with: Data(records[0].utf8)) as! [String: Any]
      check("prepared scalar import preserves body", object["text"] as? String == body)
      check("prepared scalar import preserves safe sender", object["sender"] as? String == sender)
      check("prepared scalar import hashes GUID immediately", object["id"] as? String == id(guid))
      check(
        "prepared scalar import normalizes Date to UTC milliseconds",
        object["receivedAt"] as? String == "2026-04-30T23:59:00.000Z"
      )
      check(
        "authenticated import deletes prepared source",
        !FileManager.default.fileExists(
          atPath: preparationRoot.appendingPathComponent(sessionId).path
        )
      )
    }
  }

  private static func testPreparedHistoryPrivacyAndSentinels() throws {
    try withRoot("prepared-privacy") { root in
      let prepared = preparedStore(root: root)
      let sessionId = "7F0EE480-3B7C-49EA-A232-63043DE5AB1F"
      let privateGuid = "private-raw-message-guid-never-persist"
      try prepared.prepare(
        sessionId: sessionId,
        found: 2,
        position: 1,
        guid: privateGuid,
        body: "Private bank alert body",
        date: fixedNow.addingTimeInterval(-1)
      )
      try prepared.prepare(
        sessionId: sessionId,
        found: 2,
        position: 2,
        guid: nil,
        body: nil,
        date: nil
      )

      let session = root.appendingPathComponent(sessionId, isDirectory: true)
      let files = try FileManager.default.contentsOfDirectory(
        at: session,
        includingPropertiesForKeys: nil
      )
      let persisted = try files.reduce(into: Data()) { result, file in
        result.append(try Data(contentsOf: file))
      }
      check(
        "prepared storage hashes GUID before the first disk write",
        persisted.range(of: Data(privateGuid.utf8)) == nil &&
          persisted.range(of: Data(id(privateGuid).utf8)) != nil
      )
      check(
        "prepared storage persists the exact missing-record sentinel",
        persisted.range(of: Data("{\"v\":0}".utf8)) != nil
      )
      let unsafeSenderRecord = WafraMessageHistoryImporter.preparedRecord(
        guid: "unsafe-sender-guid",
        body: "Card purchase AED 1.00",
        sender: "BANK\u{202E}",
        date: fixedNow,
        now: fixedNow
      )
      let unsafeSenderObject = try JSONSerialization.jsonObject(
        with: Data(unsafeSenderRecord.utf8)
      ) as! [String: Any]
      check(
        "prepared scalar import omits an unsafe optional sender without dropping the message",
        unsafeSenderObject["v"] as? Int == 1 && unsafeSenderObject["sender"] == nil
      )
      check(
        "prepared root is excluded from backup",
        try root.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true
      )
      for (label, url) in [("root", root), ("session", session)] + files.map({ ($0.lastPathComponent, $0) }) {
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        check(
          "prepared \(label) uses complete file protection",
          attributes[.protectionKey] as? FileProtectionType == .complete
        )
      }
    }
  }

  private static func testPreparedHistoryBoundsAndRetries() throws {
    try withRoot("prepared-bounds") { root in
      let prepared = preparedStore(root: root)
      let invalidSession = "../../private"
      expectsPrepared("prepared rejects path-like session ID", .invalidSession) {
        try prepared.prepare(
          sessionId: invalidSession,
          found: 1,
          position: 1,
          guid: "guid",
          body: "body",
          date: fixedNow
        )
      }
      for found in [0, 10_001] {
        expectsPrepared("prepared rejects found boundary \(found)", .invalidFound) {
          try prepared.prepare(
            sessionId: "C0C53EC6-C903-40DC-BF57-C8D9540C337B",
            found: found,
            position: 1,
            guid: "guid",
            body: "body",
            date: fixedNow
          )
        }
      }

      let sessionId = "A161AC47-E8B3-462B-A3A4-E95AB9022DFD"
      try prepared.prepare(
        sessionId: sessionId,
        found: 2,
        position: 1,
        guid: "retry-guid",
        body: "retry body",
        date: fixedNow.addingTimeInterval(-1)
      )
      for position in [0, 3] {
        expectsPrepared("prepared rejects 1-based position boundary \(position)", .invalidPosition) {
          try prepared.prepare(
            sessionId: sessionId,
            found: 2,
            position: position,
            guid: "retry-guid",
            body: "retry body",
            date: fixedNow.addingTimeInterval(-1)
          )
        }
      }
      try prepared.prepare(
        sessionId: sessionId,
        found: 2,
        position: 1,
        guid: "retry-guid",
        body: "retry body",
        date: fixedNow.addingTimeInterval(-1)
      )
      check(
        "prepared exact retry is idempotent",
        try FileManager.default.contentsOfDirectory(
          atPath: root.appendingPathComponent(sessionId).path
        ).filter { $0.hasPrefix("record-") }.count == 1
      )
      expectsPrepared("prepared mismatched retry is rejected", .retryConflict) {
        try prepared.prepare(
          sessionId: sessionId,
          found: 2,
          position: 1,
          guid: "retry-guid",
          body: "changed private body",
          date: fixedNow.addingTimeInterval(-1)
        )
      }
      check(
        "prepared mismatched retry invalidates its source",
        !FileManager.default.fileExists(atPath: root.appendingPathComponent(sessionId).path)
      )
      let mismatchSession = "9A278B03-24BF-4359-A20B-61D0505681B7"
      try prepared.prepare(
        sessionId: mismatchSession,
        found: 2,
        position: 1,
        guid: "mismatch-guid",
        body: "mismatch body",
        date: fixedNow.addingTimeInterval(-1)
      )
      expectsPrepared("prepared found mismatch is rejected", .countMismatch) {
        try prepared.prepare(
          sessionId: mismatchSession,
          found: 3,
          position: 1,
          guid: "mismatch-guid",
          body: "mismatch body",
          date: fixedNow.addingTimeInterval(-1)
        )
      }
      let gapSession = "1F7BDFB1-D6CA-4BCD-8A18-D7DD7846E437"
      try prepared.prepare(
        sessionId: gapSession,
        found: 3,
        position: 1,
        guid: "first-guid",
        body: "first body",
        date: fixedNow.addingTimeInterval(-1)
      )
      expectsPrepared("prepared skips cannot create a gap", .noncontiguousPosition) {
        try prepared.prepare(
          sessionId: gapSession,
          found: 3,
          position: 3,
          guid: "third-guid",
          body: "third body",
          date: fixedNow.addingTimeInterval(-3)
        )
      }
    }

    try withRoot("prepared-first-gap") { root in
      expectsPrepared("prepared first position must be one", .noncontiguousPosition) {
        try preparedStore(root: root).prepare(
          sessionId: "119920ED-E875-47A8-A2CA-ED624F9E306B",
          found: 2,
          position: 2,
          guid: "guid",
          body: "body",
          date: fixedNow
        )
      }
    }
  }

  private static func testPreparedHistoryTTL() throws {
    try withRoot("prepared-ttl") { root in
      var current = fixedNow
      let prepared = preparedStore(root: root, now: { current })
      let sessionId = "747466C8-0712-4093-92A4-269527CD540B"
      try prepared.prepare(
        sessionId: sessionId,
        found: 1,
        position: 1,
        guid: "ttl-guid",
        body: "ttl body",
        date: fixedNow.addingTimeInterval(-1)
      )
      current = fixedNow.addingTimeInterval(WafraPreparedHistoryStore.sessionTTL - 1)
      try prepared.prepare(
        sessionId: sessionId,
        found: 1,
        position: 1,
        guid: "ttl-guid",
        body: "ttl body",
        date: fixedNow.addingTimeInterval(-1)
      )
      check(
        "prepared exact retry does not renew fixed TTL",
        try prepared.purgeExpired(
          now: fixedNow.addingTimeInterval(WafraPreparedHistoryStore.sessionTTL)
        ) == 1
      )
      check(
        "prepared expiry physically deletes source",
        !FileManager.default.fileExists(atPath: root.appendingPathComponent(sessionId).path)
      )
    }
  }

  private static func prepareHistory(
    _ prepared: WafraPreparedHistoryStore,
    sessionId: String,
    count: Int,
    guid: (Int) -> String = { "prepared-guid-\($0)" },
    body: (Int) -> String = { "Prepared AED \($0 + 1).00" }
  ) throws {
    for index in 0..<count {
      try prepared.prepare(
        sessionId: sessionId,
        found: count,
        position: index + 1,
        guid: guid(index),
        body: body(index),
        date: fixedNow.addingTimeInterval(-Double(index + 1))
      )
    }
  }

  private static func prepareHistoryV2(
    _ prepared: WafraPreparedHistoryStore,
    sessionId: String,
    count: Int,
    guid: (Int) -> String = { "prepared-v2-guid-\($0)" },
    body: (Int) -> String = { "Prepared V2 AED \($0 + 1).00" },
    date: (Int) -> Date = { fixedNow.addingTimeInterval(-Double($0 + 1)) }
  ) throws {
    for index in 0..<count {
      try prepared.prepareV2(
        sessionId: sessionId,
        position: index + 1,
        rangeStart: .distantPast,
        rangeEnd: .distantFuture,
        guid: guid(index),
        body: body(index),
        date: date(index)
      )
    }
  }

  private static func prepareHistoryV3(
    _ prepared: WafraPreparedHistoryStore,
    sessionId: String,
    count: Int,
    guid: (Int) -> String? = { "prepared-v3-guid-\($0)" },
    body: (Int) -> String? = { "Prepared V3 AED \($0 + 1).00" },
    date: (Int) -> Date? = { fixedNow.addingTimeInterval(-Double($0 + 1)) }
  ) throws {
    for index in 0..<count {
      try prepared.prepareV3(
        sessionId: sessionId,
        position: index + 1,
        guid: guid(index),
        body: body(index),
        date: date(index)
      )
    }
  }

  private static func testPreparedHistoryV3DerivedCountAndV1Validation() throws {
    try withRoot("prepared-v3-derived-count") { root in
      let preparedRoot = root.appendingPathComponent("prepared", isDirectory: true)
      let historyRoot = root.appendingPathComponent("history", isDirectory: true)
      let prepared = preparedStore(root: preparedRoot)
      let history = store(root: historyRoot)
      let sessionId = "WAFRA-PREPARED-V3-DERIVED-COUNT-0001"

      try prepareHistoryV3(prepared, sessionId: sessionId, count: 51)
      try WafraMessageHistoryImporter(
        store: history,
        preparedStore: prepared,
        now: { fixedNow }
      ).importPreparedV2(sessionId: sessionId)

      check(
        "prepared V3 derives the exact final count without declared count or range values",
        try history.completedSession(sessionId: sessionId) == WafraCompletedHistorySession(
          chunkIndices: [0, 1],
          found: 51,
          attempted: 51,
          accepted: 51,
          skipped: 0
        )
      )
      check(
        "prepared V3 derived count packs records into exact 50-record chunks",
        try history.readChunk(sessionId: sessionId, chunkIndex: 0).count == 50 &&
          history.readChunk(sessionId: sessionId, chunkIndex: 1).count == 1
      )
      check(
        "prepared V3 authenticated finalization deletes its protected source",
        !FileManager.default.fileExists(
          atPath: preparedRoot.appendingPathComponent(sessionId).path
        )
      )
    }

    try withRoot("prepared-v3-v1-validation") { root in
      let preparedRoot = root.appendingPathComponent("prepared", isDirectory: true)
      let historyRoot = root.appendingPathComponent("history", isDirectory: true)
      let prepared = preparedStore(root: preparedRoot)
      let history = store(root: historyRoot)
      let sessionId = "WAFRA-PREPARED-V3-V1-VALIDATION-0001"
      let cases: [(String?, String?, Date?)] = [
        ("v3-valid-guid", "V3 valid AED 12.34", fixedNow.addingTimeInterval(-1)),
        (
          "v3-old-valid-guid",
          "V3 old valid AED 6.00",
          fixedNow.addingTimeInterval(-365 * 24 * 60 * 60)
        ),
        (nil, "V3 missing GUID AED 2.00", fixedNow.addingTimeInterval(-2)),
        ("v3-blank-body-guid", " \n\t ", fixedNow.addingTimeInterval(-3)),
        ("v3-epoch-date-guid", "V3 epoch AED 4.00", Date(timeIntervalSince1970: 0)),
        (
          "v3-future-date-guid",
          "V3 future AED 5.00",
          fixedNow.addingTimeInterval(5 * 60 + 1)
        ),
      ]
      for (index, value) in cases.enumerated() {
        try prepared.prepareV3(
          sessionId: sessionId,
          position: index + 1,
          guid: value.0,
          body: value.1,
          date: value.2
        )
      }
      try WafraMessageHistoryImporter(
        store: history,
        preparedStore: prepared,
        now: { fixedNow }
      ).importPreparedV2(sessionId: sessionId)

      check(
        "prepared V3 derives count while preserving V1 GUID, body, and Date validation",
        try history.completedSession(sessionId: sessionId) == WafraCompletedHistorySession(
          chunkIndices: [0],
          found: 6,
          attempted: 6,
          accepted: 2,
          skipped: 4
        )
      )
      let records = try history.readChunk(sessionId: sessionId, chunkIndex: 0)
      check(
        "prepared V3 accepts an old valid Date without imposing a hidden selected range",
        records.count == 2 &&
          records.contains { $0.contains("V3 valid AED 12.34") } &&
          records.contains { $0.contains("V3 old valid AED 6.00") } &&
          records.allSatisfy { !$0.contains("v3-valid-guid") }
      )
    }
  }

  private static func testPreparedHistoryV3PositionsAndDiscard() throws {
    try withRoot("prepared-v3-position-discard") { root in
      let prepared = preparedStore(root: root)
      for position in [0, 10_001] {
        expectsPrepared(
          "prepared V3 rejects position boundary \(position)",
          .invalidPosition
        ) {
          try prepared.prepareV3(
            sessionId: "WAFRA-PREPARED-V3-INVALID-POSITION-\(position)",
            position: position,
            guid: "v3-invalid-position-guid-\(position)",
            body: "V3 invalid position body",
            date: fixedNow
          )
        }
      }

      let sessionId = "WAFRA-PREPARED-V3-DISCARD-0001"
      try prepared.prepareV3(
        sessionId: sessionId,
        position: 1,
        guid: "v3-discard-guid",
        body: "V3 partial source to discard",
        date: fixedNow
      )
      check(
        "prepared V3 discard fixture creates protected partial source",
        FileManager.default.fileExists(atPath: root.appendingPathComponent(sessionId).path)
      )
      try prepared.discardPrepared(sessionId: sessionId)
      check(
        "existing prepared discard deletes a partial V3 session",
        !FileManager.default.fileExists(atPath: root.appendingPathComponent(sessionId).path)
      )
    }
  }

  private static func testPreparedHistoryV2DerivedCountAndPacking() throws {
    try withRoot("prepared-v2-derived-count") { root in
      let preparedRoot = root.appendingPathComponent("prepared", isDirectory: true)
      let historyRoot = root.appendingPathComponent("history", isDirectory: true)
      let prepared = preparedStore(root: preparedRoot)
      let history = store(root: historyRoot)
      let sessionId = "WAFRA-PREPARED-V2-DERIVED-COUNT-0001"

      try prepareHistoryV2(prepared, sessionId: sessionId, count: 51)
      try WafraMessageHistoryImporter(
        store: history,
        preparedStore: prepared,
        now: { fixedNow }
      ).importPreparedV2(sessionId: sessionId)

      check(
        "prepared V2 derives the exact final count without a declared found value",
        try history.completedSession(sessionId: sessionId) == WafraCompletedHistorySession(
          chunkIndices: [0, 1],
          found: 51,
          attempted: 51,
          accepted: 51,
          skipped: 0
        )
      )
      check(
        "prepared V2 derived count packs records into exact 50-record chunks",
        try history.readChunk(sessionId: sessionId, chunkIndex: 0).count == 50 &&
          history.readChunk(sessionId: sessionId, chunkIndex: 1).count == 1
      )
      check(
        "prepared V2 authenticated finalization deletes its protected source",
        !FileManager.default.fileExists(
          atPath: preparedRoot.appendingPathComponent(sessionId).path
        )
      )
    }
  }

  private static func testPreparedHistoryV2SelectedRangeGuard() throws {
    try withRoot("prepared-v2-selected-range") { root in
      let preparedRoot = root.appendingPathComponent("prepared", isDirectory: true)
      let historyRoot = root.appendingPathComponent("history", isDirectory: true)
      let prepared = preparedStore(root: preparedRoot)
      let history = store(root: historyRoot)
      let sessionId = "WAFRA-PREPARED-V2-SELECTED-RANGE-0001"
      let rangeStart = fixedNow.addingTimeInterval(-3_600)
      let rangeEnd = fixedNow
      let dates = [
        rangeStart.addingTimeInterval(-0.001),
        rangeStart,
        rangeEnd.addingTimeInterval(-0.001),
        rangeEnd,
      ]

      for (index, date) in dates.enumerated() {
        try prepared.prepareV2(
          sessionId: sessionId,
          position: index + 1,
          rangeStart: rangeStart,
          rangeEnd: rangeEnd,
          guid: "selected-range-guid-\(index)",
          body: "Selected range AED \(index + 1).00",
          date: date
        )
      }
      try WafraMessageHistoryImporter(
        store: history,
        preparedStore: prepared,
        now: { fixedNow }
      ).importPreparedV2(sessionId: sessionId)

      check(
        "prepared V2 keeps the exact inclusive lower and exclusive upper bounds",
        try history.completedSession(sessionId: sessionId) == WafraCompletedHistorySession(
          chunkIndices: [0],
          found: 4,
          attempted: 4,
          accepted: 2,
          skipped: 2
        )
      )
      let records = try history.readChunk(sessionId: sessionId, chunkIndex: 0)
      check(
        "prepared V2 selected-range guard persists only in-range source records",
        records.count == 2 &&
          records.allSatisfy { !$0.contains("selected-range-guid") } &&
          records.contains { $0.contains("Selected range AED 2.00") } &&
          records.contains { $0.contains("Selected range AED 3.00") }
      )
    }
  }

  private static func testPreparedHistoryV2PositionsRetriesAndBounds() throws {
    try withRoot("prepared-v2-position-contract") { root in
      let prepared = preparedStore(root: root)

      for position in [0, 10_001] {
        expectsPrepared(
          "prepared V2 rejects position boundary \(position)",
          .invalidPosition
        ) {
          try prepared.prepareV2(
            sessionId: "WAFRA-PREPARED-V2-INVALID-POSITION-\(position)",
            position: position,
            rangeStart: .distantPast,
            rangeEnd: .distantFuture,
            guid: "invalid-position-guid-\(position)",
            body: "invalid position body",
            date: fixedNow
          )
        }
      }

      let firstGapSession = "WAFRA-PREPARED-V2-FIRST-GAP-0001"
      expectsPrepared(
        "prepared V2 requires the first explicit position to be one",
        .noncontiguousPosition
      ) {
        try prepared.prepareV2(
          sessionId: firstGapSession,
          position: 2,
          rangeStart: .distantPast,
          rangeEnd: .distantFuture,
          guid: "first-gap-guid",
          body: "first gap body",
          date: fixedNow
        )
      }
      check(
        "prepared V2 first-position failure creates no source directory",
        !FileManager.default.fileExists(atPath: root.appendingPathComponent(firstGapSession).path)
      )

      let retrySession = "WAFRA-PREPARED-V2-RETRY-0001"
      try prepared.prepareV2(
        sessionId: retrySession,
        position: 1,
        rangeStart: .distantPast,
        rangeEnd: .distantFuture,
        guid: "retry-v2-guid",
        body: "retry V2 body",
        date: fixedNow.addingTimeInterval(-1)
      )
      try prepared.prepareV2(
        sessionId: retrySession,
        position: 1,
        rangeStart: .distantPast,
        rangeEnd: .distantFuture,
        guid: "retry-v2-guid",
        body: "retry V2 body",
        date: fixedNow.addingTimeInterval(-1)
      )
      check(
        "prepared V2 exact retry is idempotent at the same position",
        try FileManager.default.contentsOfDirectory(
          atPath: root.appendingPathComponent(retrySession).path
        ).filter { $0.hasPrefix("record-") }.count == 1
      )
      expectsPrepared(
        "prepared V2 conflicting retry at the same position is rejected",
        .retryConflict
      ) {
        try prepared.prepareV2(
          sessionId: retrySession,
          position: 1,
          rangeStart: .distantPast,
          rangeEnd: .distantFuture,
          guid: "retry-v2-guid",
          body: "changed retry V2 body",
          date: fixedNow.addingTimeInterval(-1)
        )
      }
      check(
        "prepared V2 conflicting retry invalidates all source",
        !FileManager.default.fileExists(atPath: root.appendingPathComponent(retrySession).path)
      )

      let laterGapSession = "WAFRA-PREPARED-V2-LATER-GAP-0001"
      try prepared.prepareV2(
        sessionId: laterGapSession,
        position: 1,
        rangeStart: .distantPast,
        rangeEnd: .distantFuture,
        guid: "later-gap-one",
        body: "later gap one",
        date: fixedNow.addingTimeInterval(-1)
      )
      expectsPrepared(
        "prepared V2 cannot skip an explicit position",
        .noncontiguousPosition
      ) {
        try prepared.prepareV2(
          sessionId: laterGapSession,
          position: 3,
          rangeStart: .distantPast,
          rangeEnd: .distantFuture,
          guid: "later-gap-three",
          body: "later gap three",
          date: fixedNow.addingTimeInterval(-3)
        )
      }
      check(
        "prepared V2 later gap invalidates all source",
        !FileManager.default.fileExists(atPath: root.appendingPathComponent(laterGapSession).path)
      )

      let discardedSession = "WAFRA-PREPARED-V2-DISCARD-0001"
      try prepared.prepareV2(
        sessionId: discardedSession,
        position: 1,
        rangeStart: .distantPast,
        rangeEnd: .distantFuture,
        guid: "discard-v2-guid",
        body: "discard V2 body",
        date: fixedNow
      )
      try prepared.discardPrepared(sessionId: discardedSession)
      check(
        "prepared V2 explicit discard removes its partial source",
        !FileManager.default.fileExists(atPath: root.appendingPathComponent(discardedSession).path)
      )
    }

    try withRoot("prepared-v2-ten-thousand") { root in
      let preparedRoot = root.appendingPathComponent("prepared", isDirectory: true)
      let historyRoot = root.appendingPathComponent("history", isDirectory: true)
      let prepared = preparedStore(root: preparedRoot)
      let history = store(root: historyRoot)
      let sessionId = "WAFRA-PREPARED-V2-TEN-THOUSAND-0001"

      try prepareHistoryV2(prepared, sessionId: sessionId, count: 10_000)
      expectsPrepared(
        "prepared V2 rejects the first position over ten thousand",
        .invalidPosition
      ) {
        try prepared.prepareV2(
          sessionId: sessionId,
          position: 10_001,
          rangeStart: .distantPast,
          rangeEnd: .distantFuture,
          guid: "over-ten-thousand-guid",
          body: "over ten thousand body",
          date: fixedNow.addingTimeInterval(-10_001)
        )
      }
      try WafraMessageHistoryImporter(
        store: history,
        preparedStore: prepared,
        now: { fixedNow }
      ).importPreparedV2(sessionId: sessionId)
      let completed = try history.completedSession(sessionId: sessionId)
      check(
        "prepared V2 accepts and derives exactly ten thousand positions",
        completed?.found == 10_000 && completed?.attempted == 10_000 &&
          completed?.accepted == 10_000 && completed?.skipped == 0 &&
          completed?.chunkIndices == Array(0..<200)
      )
    }
  }

  private static func testPreparedHistoryV2DuplicateNormalization() throws {
    try withRoot("prepared-v2-adjacent-duplicate") { root in
      let preparedRoot = root.appendingPathComponent("prepared", isDirectory: true)
      let historyRoot = root.appendingPathComponent("history", isDirectory: true)
      let prepared = preparedStore(root: preparedRoot)
      let history = store(root: historyRoot)
      let sessionId = "WAFRA-PREPARED-V2-ADJACENT-DUPLICATE-0001"
      let duplicateDate = fixedNow.addingTimeInterval(-1)

      for position in 1...2 {
        try prepared.prepareV2(
          sessionId: sessionId,
          position: position,
          rangeStart: .distantPast,
          rangeEnd: .distantFuture,
          guid: "adjacent-boundary-guid",
          body: "identical adjacent boundary body",
          sender: "BANK",
          date: duplicateDate
        )
      }
      try WafraMessageHistoryImporter(
        store: history,
        preparedStore: prepared,
        now: { fixedNow }
      ).importPreparedV2(sessionId: sessionId)

      check(
        "prepared V2 converts an adjacent identical GUID replay to one skipped sentinel",
        try history.completedSession(sessionId: sessionId) == WafraCompletedHistorySession(
          chunkIndices: [0],
          found: 2,
          attempted: 2,
          accepted: 1,
          skipped: 1
        ) && history.readChunk(sessionId: sessionId, chunkIndex: 0).count == 1
      )
    }

    try withRoot("prepared-v2-cross-chunk-duplicate") { root in
      let preparedRoot = root.appendingPathComponent("prepared", isDirectory: true)
      let historyRoot = root.appendingPathComponent("history", isDirectory: true)
      let prepared = preparedStore(root: preparedRoot)
      let history = store(root: historyRoot)
      let sessionId = "WAFRA-PREPARED-V2-CROSS-CHUNK-DUPLICATE-0001"
      let duplicateDate = fixedNow.addingTimeInterval(-1)

      try prepareHistoryV2(
        prepared,
        sessionId: sessionId,
        count: 51,
        guid: { $0 == 50 ? "cross-chunk-boundary-guid" :
          ($0 == 0 ? "cross-chunk-boundary-guid" : "cross-chunk-guid-\($0)") },
        body: { $0 == 50 ? "identical cross-chunk boundary body" :
          ($0 == 0 ? "identical cross-chunk boundary body" : "cross chunk body \($0)") },
        date: { $0 == 50 || $0 == 0 ? duplicateDate :
          fixedNow.addingTimeInterval(-Double($0 + 1)) }
      )
      try WafraMessageHistoryImporter(
        store: history,
        preparedStore: prepared,
        now: { fixedNow }
      ).importPreparedV2(sessionId: sessionId)

      let completed = try history.completedSession(sessionId: sessionId)
      check(
        "prepared V2 normalizes an identical GUID replay across chunk boundaries",
        completed == WafraCompletedHistorySession(
          chunkIndices: [0, 1],
          found: 51,
          attempted: 51,
          accepted: 50,
          skipped: 1
        )
      )
      check(
        "prepared V2 cross-chunk duplicate persists no second accepted record",
        try history.readChunk(sessionId: sessionId, chunkIndex: 0).count == 50 &&
          history.readChunk(sessionId: sessionId, chunkIndex: 1).isEmpty
      )
    }

    try withRoot("prepared-v2-conflicting-guid") { root in
      let preparedRoot = root.appendingPathComponent("prepared", isDirectory: true)
      let historyRoot = root.appendingPathComponent("history", isDirectory: true)
      let prepared = preparedStore(root: preparedRoot)
      let history = store(root: historyRoot)
      let sessionId = "WAFRA-PREPARED-V2-CONFLICTING-GUID-0001"

      try prepareHistoryV2(
        prepared,
        sessionId: sessionId,
        count: 51,
        guid: { $0 == 50 ? "conflicting-cross-chunk-guid" :
          ($0 == 0 ? "conflicting-cross-chunk-guid" : "conflict-guid-\($0)") },
        body: { $0 == 50 ? "changed body for the same GUID" :
          ($0 == 0 ? "original body for the same GUID" : "conflict body \($0)") }
      )
      do {
        try WafraMessageHistoryImporter(
          store: history,
          preparedStore: prepared,
          now: { fixedNow }
        ).importPreparedV2(sessionId: sessionId)
        check("prepared V2 conflicting GUID reuse fails", false)
      } catch {
        check("prepared V2 conflicting GUID reuse fails", true)
      }
      check(
        "prepared V2 conflicting GUID reuse deletes prepared and completed partial sessions",
        !FileManager.default.fileExists(atPath: preparedRoot.appendingPathComponent(sessionId).path) &&
          !FileManager.default.fileExists(atPath: historyRoot.appendingPathComponent(sessionId).path)
      )
    }
  }

  private static func testPreparedHistoryPackingAndRollback() throws {
    let sessions = [
      49: "74DC76C9-15B0-4706-855E-B5916E5F1629",
      50: "7498562C-2674-48F6-9B4E-2622817220DA",
      51: "65908D90-247D-4693-8501-E46D6B83574C",
    ]
    for count in [49, 50, 51] {
      try withRoot("prepared-pack-\(count)") { root in
        let preparedRoot = root.appendingPathComponent("prepared", isDirectory: true)
        let historyRoot = root.appendingPathComponent("history", isDirectory: true)
        let prepared = preparedStore(root: preparedRoot)
        let history = store(root: historyRoot)
        let sessionId = sessions[count]!
        try prepareHistory(prepared, sessionId: sessionId, count: count)
        try WafraMessageHistoryImporter(
          store: history,
          preparedStore: prepared,
          now: { fixedNow }
        ).importPrepared(sessionId: sessionId, found: count)
        let descriptor = try history.completedSession(sessionId: sessionId)
        check(
          "prepared \(count) records pack into exact 50-record chunks",
          descriptor?.chunkIndices == Array(0..<((count + 49) / 50)) &&
            descriptor?.attempted == count && descriptor?.accepted == count
        )
      }
    }

    try withRoot("prepared-incomplete") { root in
      let preparedRoot = root.appendingPathComponent("prepared", isDirectory: true)
      let historyRoot = root.appendingPathComponent("history", isDirectory: true)
      let prepared = preparedStore(root: preparedRoot)
      let history = store(root: historyRoot)
      let sessionId = "CFE2AFB4-82CF-450A-84CA-5568CFF61343"
      try prepared.prepare(
        sessionId: sessionId,
        found: 2,
        position: 1,
        guid: "only-guid",
        body: "only body",
        date: fixedNow
      )
      expectsPrepared("prepared import rejects a missing final position", .incompleteSession) {
        try WafraMessageHistoryImporter(
          store: history,
          preparedStore: prepared,
          now: { fixedNow }
        ).importPrepared(sessionId: sessionId, found: 2)
      }
      check(
        "failed prepared import deletes incomplete source and output",
        !FileManager.default.fileExists(atPath: preparedRoot.appendingPathComponent(sessionId).path) &&
          !FileManager.default.fileExists(atPath: historyRoot.appendingPathComponent(sessionId).path)
      )
    }

    try withRoot("prepared-duplicate") { root in
      let preparedRoot = root.appendingPathComponent("prepared", isDirectory: true)
      let historyRoot = root.appendingPathComponent("history", isDirectory: true)
      let prepared = preparedStore(root: preparedRoot)
      let history = store(root: historyRoot)
      let sessionId = "71D2228F-E92A-4D39-BA01-2A7EF661DD06"
      try prepareHistory(
        prepared,
        sessionId: sessionId,
        count: 51,
        guid: { $0 == 50 ? "duplicate-guid" : ($0 == 0 ? "duplicate-guid" : "guid-\($0)") }
      )
      do {
        try WafraMessageHistoryImporter(
          store: history,
          preparedStore: prepared,
          now: { fixedNow }
        ).importPrepared(sessionId: sessionId, found: 51)
        check("prepared duplicate import throws", false)
      } catch {
        check("prepared duplicate import throws", true)
      }
      check(
        "prepared duplicate in chunk one rolls back chunk zero and source",
        !FileManager.default.fileExists(atPath: preparedRoot.appendingPathComponent(sessionId).path) &&
          !FileManager.default.fileExists(atPath: historyRoot.appendingPathComponent(sessionId).path)
      )
    }
  }

  private static func testPreparedHistoryConcurrency() throws {
    try withRoot("prepared-concurrency") { root in
      let prepared = preparedStore(root: root)
      let sessionId = "2A5FAAD7-C9C9-42DE-B91E-B050EC8D8F48"
      let errorLock = NSLock()
      var errors: [Error] = []
      DispatchQueue.concurrentPerform(iterations: 32) { _ in
        do {
          try prepared.prepare(
            sessionId: sessionId,
            found: 1,
            position: 1,
            guid: "concurrent-guid",
            body: "concurrent body",
            date: fixedNow.addingTimeInterval(-1)
          )
        } catch {
          errorLock.lock()
          errors.append(error)
          errorLock.unlock()
        }
      }
      check("prepared concurrent exact retries all succeed", errors.isEmpty)
      check(
        "prepared concurrent exact retries create one record",
        try FileManager.default.contentsOfDirectory(
          atPath: root.appendingPathComponent(sessionId).path
        ).filter { $0.hasPrefix("record-") }.count == 1
      )
    }
  }

  private static func testPreparedHistoryStorageLimits() throws {
    try withRoot("prepared-session-limit") { root in
      let setup = preparedStore(root: root)
      let sessionId = "WAFRA-PREPARED-SESSION-LIMIT-0001"
      try setup.prepare(
        sessionId: sessionId,
        found: 2,
        position: 1,
        guid: "limit-guid-one",
        body: String(repeating: "x", count: 1_024),
        date: fixedNow.addingTimeInterval(-1)
      )
      let recordFile = root.appendingPathComponent(sessionId)
        .appendingPathComponent("record-00001.plist")
      let exactBytes = try FileManager.default.attributesOfItem(
        atPath: recordFile.path
      )[.size] as! Int
      let limited = WafraPreparedHistoryStore(
        root: root,
        now: { fixedNow },
        maxSessionBytes: exactBytes,
        maxStoredBytes: WafraMessageHistoryStore.maxStoredBytes
      )
      try limited.prepare(
        sessionId: sessionId,
        found: 2,
        position: 1,
        guid: "limit-guid-one",
        body: String(repeating: "x", count: 1_024),
        date: fixedNow.addingTimeInterval(-1)
      )
      expectsPrepared("prepared session accepts its exact byte limit", .sessionByteLimit) {
        try limited.prepare(
          sessionId: sessionId,
          found: 2,
          position: 2,
          guid: "limit-guid-two",
          body: "over",
          date: fixedNow.addingTimeInterval(-2)
        )
      }
      check(
        "prepared session-byte overflow rolls back all source",
        !FileManager.default.fileExists(atPath: root.appendingPathComponent(sessionId).path)
      )
    }

    try withRoot("prepared-global-limit") { root in
      let setup = preparedStore(root: root)
      let first = "WAFRA-PREPARED-GLOBAL-LIMIT-0001"
      try setup.prepare(
        sessionId: first,
        found: 1,
        position: 1,
        guid: "global-guid-one",
        body: "global one",
        date: fixedNow.addingTimeInterval(-1)
      )
      let exactBytes = try directoryBytes(root.appendingPathComponent(first))
      let limited = WafraPreparedHistoryStore(
        root: root,
        now: { fixedNow },
        maxSessionBytes: WafraMessageHistoryStore.maxSessionBytes,
        maxStoredBytes: exactBytes
      )
      try limited.prepare(
        sessionId: first,
        found: 1,
        position: 1,
        guid: "global-guid-one",
        body: "global one",
        date: fixedNow.addingTimeInterval(-1)
      )
      let second = "WAFRA-PREPARED-GLOBAL-LIMIT-0002"
      expectsPrepared("prepared global storage rejects the first byte over limit", .globalByteLimit) {
        try limited.prepare(
          sessionId: second,
          found: 1,
          position: 1,
          guid: "global-guid-two",
          body: "global two",
          date: fixedNow.addingTimeInterval(-2)
        )
      }
      check(
        "prepared global overflow creates no second source directory",
        !FileManager.default.fileExists(atPath: root.appendingPathComponent(second).path)
      )
    }
  }

  private static func testPreparedHistoryFilesystemHardening() throws {
    try withRoot("prepared-permissions") { root in
      let prepared = preparedStore(root: root)
      let sessionId = "WAFRA-PREPARED-PERMISSIONS-0001"
      try prepared.prepare(
        sessionId: sessionId,
        found: 1,
        position: 1,
        guid: "permissions-guid",
        body: "permissions body",
        date: fixedNow
      )
      let session = root.appendingPathComponent(sessionId)
      let manifest = session.appendingPathComponent("manifest.plist")
      let recordFile = session.appendingPathComponent("record-00001.plist")
      for (label, url, expected) in [
        ("root", root, 0o700),
        ("session", session, 0o700),
        ("manifest", manifest, 0o600),
        ("record", recordFile, 0o600),
      ] {
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        check(
          "prepared \(label) uses owner-only POSIX permissions",
          (attributes[.posixPermissions] as? NSNumber)?.intValue == expected
        )
      }
    }

    try withRoot("prepared-symlink") { root in
      let prepared = preparedStore(root: root)
      let sessionId = "WAFRA-PREPARED-SYMLINK-0001"
      try prepared.prepare(
        sessionId: sessionId,
        found: 1,
        position: 1,
        guid: "symlink-guid",
        body: "symlink body",
        date: fixedNow
      )
      let session = root.appendingPathComponent(sessionId)
      let recordFile = session.appendingPathComponent("record-00001.plist")
      let outside = root.appendingPathComponent("outside.plist")
      try FileManager.default.copyItem(at: recordFile, to: outside)
      try FileManager.default.removeItem(at: recordFile)
      try FileManager.default.createSymbolicLink(at: recordFile, withDestinationURL: outside)
      expectsPrepared("prepared retry rejects a symlinked record", .storageFailure) {
        try prepared.prepare(
          sessionId: sessionId,
          found: 1,
          position: 1,
          guid: "symlink-guid",
          body: "symlink body",
          date: fixedNow
        )
      }
    }

    try withRoot("prepared-hardlink") { root in
      let prepared = preparedStore(root: root)
      let sessionId = "WAFRA-PREPARED-HARDLINK-0001"
      try prepared.prepare(
        sessionId: sessionId,
        found: 1,
        position: 1,
        guid: "hardlink-guid",
        body: "hardlink body",
        date: fixedNow
      )
      let recordFile = root.appendingPathComponent(sessionId)
        .appendingPathComponent("record-00001.plist")
      try FileManager.default.linkItem(
        at: recordFile,
        to: root.appendingPathComponent("outside-hardlink.plist")
      )
      expectsPrepared("prepared retry rejects a multiply-linked record", .storageFailure) {
        try prepared.prepare(
          sessionId: sessionId,
          found: 1,
          position: 1,
          guid: "hardlink-guid",
          body: "hardlink body",
          date: fixedNow
        )
      }
    }

    try withRoot("prepared-protection-tamper") { root in
      let prepared = preparedStore(root: root)
      let sessionId = "WAFRA-PREPARED-PROTECTION-0001"
      try prepared.prepare(
        sessionId: sessionId,
        found: 1,
        position: 1,
        guid: "protection-guid",
        body: "protection body",
        date: fixedNow
      )
      let recordFile = root.appendingPathComponent(sessionId)
        .appendingPathComponent("record-00001.plist")
      try FileManager.default.setAttributes(
        [.protectionKey: FileProtectionType.none],
        ofItemAtPath: recordFile.path
      )
      expectsPrepared("prepared retry rejects weakened file protection", .storageFailure) {
        try prepared.prepare(
          sessionId: sessionId,
          found: 1,
          position: 1,
          guid: "protection-guid",
          body: "protection body",
          date: fixedNow
        )
      }
    }
  }

  private static func testPreparedHistoryDeletionRollback() throws {
    try withRoot("prepared-deletion-rollback") { root in
      let preparedRoot = root.appendingPathComponent("prepared", isDirectory: true)
      let historyRoot = root.appendingPathComponent("history", isDirectory: true)
      let prepared = WafraPreparedHistoryStore(
        root: preparedRoot,
        now: { fixedNow },
        maxSessionBytes: WafraMessageHistoryStore.maxSessionBytes,
        maxStoredBytes: WafraMessageHistoryStore.maxStoredBytes,
        removeItem: { _ in throw HarnessError.injectedDeletionFailure }
      )
      let history = store(root: historyRoot)
      let sessionId = "WAFRA-PREPARED-DELETE-ROLLBACK-0001"
      try prepared.prepare(
        sessionId: sessionId,
        found: 1,
        position: 1,
        guid: "delete-private-guid",
        body: "delete private body",
        date: fixedNow
      )
      do {
        try WafraMessageHistoryImporter(
          store: history,
          preparedStore: prepared,
          now: { fixedNow }
        ).importPrepared(sessionId: sessionId, found: 1)
        check("prepared cleanup failure throws", false)
      } catch {
        check("prepared cleanup failure throws", true)
      }
      let directories = try storedDirectories(preparedRoot)
      check(
        "prepared cleanup failure removes the keyed source immediately",
        !FileManager.default.fileExists(atPath: preparedRoot.appendingPathComponent(sessionId).path)
      )
      check(
        "prepared cleanup failure leaves one hidden protected tombstone",
        directories.count == 1 && directories[0].lastPathComponent.hasPrefix(".invalid-")
      )
      check(
        "prepared cleanup failure rolls back completed output",
        !FileManager.default.fileExists(atPath: historyRoot.appendingPathComponent(sessionId).path)
      )
      _ = try preparedStore(root: preparedRoot).purgeExpired(now: fixedNow)
      check(
        "next prepared operation retries hidden tombstone deletion",
        try storedDirectories(preparedRoot).isEmpty
      )
    }
  }

  private static func testPreparedHistoryAuthenticatedFailureCleanup() throws {
    try withRoot("prepared-invalid-final-count") { root in
      let preparedRoot = root.appendingPathComponent("prepared", isDirectory: true)
      let prepared = preparedStore(root: preparedRoot)
      let sessionId = "WAFRA-PREPARED-INVALID-FINAL-COUNT-0001"
      try prepared.prepare(
        sessionId: sessionId,
        found: 1,
        position: 1,
        guid: "invalid-final-guid",
        body: "invalid final body",
        date: fixedNow
      )
      do {
        try WafraMessageHistoryImporter(
          store: store(root: root.appendingPathComponent("history")),
          preparedStore: prepared,
          now: { fixedNow }
        ).importPrepared(sessionId: sessionId, found: 0)
        check("prepared authenticated invalid final count throws", false)
      } catch WafraMessageHistoryImporter.ImportError.invalidInput {
        check("prepared authenticated invalid final count throws", true)
      }
      check(
        "prepared authenticated invalid final count deletes source",
        !FileManager.default.fileExists(atPath: preparedRoot.appendingPathComponent(sessionId).path)
      )
    }

    try withRoot("prepared-existing-output") { root in
      let preparedRoot = root.appendingPathComponent("prepared", isDirectory: true)
      let historyRoot = root.appendingPathComponent("history", isDirectory: true)
      let prepared = preparedStore(root: preparedRoot)
      let history = store(root: historyRoot)
      let sessionId = "WAFRA-PREPARED-EXISTING-OUTPUT-0001"
      let secret = try history.beginSession(sessionId: sessionId)
      _ = try history.stageChunk(
        sessionId: sessionId,
        authorizationSecret: secret,
        chunkIndex: 0,
        records: [record(id: id("existing-output"), text: "existing output")]
      )
      try history.finishSession(
        sessionId: sessionId,
        authorizationSecret: secret,
        totalChunks: 1,
        found: 1,
        attempted: 1,
        accepted: 1,
        skipped: 0
      )
      try prepared.prepare(
        sessionId: sessionId,
        found: 1,
        position: 1,
        guid: "new-guid",
        body: "new body",
        date: fixedNow
      )
      do {
        try WafraMessageHistoryImporter(
          store: history,
          preparedStore: prepared,
          now: { fixedNow }
        ).importPrepared(sessionId: sessionId, found: 1)
        check("prepared existing-output collision throws", false)
      } catch {
        check("prepared existing-output collision throws", true)
      }
      check(
        "prepared collision preserves pre-existing completed output",
        try history.completedSession(sessionId: sessionId)?.accepted == 1 &&
          history.readChunk(sessionId: sessionId, chunkIndex: 0)[0].contains("existing output")
      )
      check(
        "prepared collision still deletes its separate source",
        !FileManager.default.fileExists(atPath: preparedRoot.appendingPathComponent(sessionId).path)
      )
    }
  }

  private static func testPreparedHistoryEraseFence() throws {
    try withRoot("prepared-erase-idempotent") { root in
      let prepared = preparedStore(root: root)
      for index in 0..<2 {
        try prepared.prepare(
          sessionId: "WAFRA-PREPARED-ERASE-IDEMPOTENT-000\(index)",
          found: 1,
          position: 1,
          guid: "erase-guid-\(index)",
          body: "erase private body \(index)",
          date: fixedNow
        )
      }
      try prepared.eraseAll()
      try prepared.eraseAll()
      check("prepared eraseAll is idempotent", try storedDirectories(root).isEmpty)
      check(
        "prepared successful erase clears its durable marker last",
        !FileManager.default.fileExists(atPath: root.appendingPathComponent(eraseMarkerName).path)
      )
    }

    try withRoot("prepared-erase-failure") { root in
      let setup = preparedStore(root: root)
      let sessionIds = [
        "WAFRA-PREPARED-ERASE-FAILURE-0001",
        "WAFRA-PREPARED-ERASE-FAILURE-0002",
      ]
      for (index, sessionId) in sessionIds.enumerated() {
        try setup.prepare(
          sessionId: sessionId,
          found: 1,
          position: 1,
          guid: "erase-failure-guid-\(index)",
          body: "erase failure private body \(index)",
          date: fixedNow
        )
      }
      let marker = root.appendingPathComponent(eraseMarkerName)
      var firstDeletionSawFence = false
      var deletionAttempts = 0
      let failing = WafraPreparedHistoryStore(
        root: root,
        now: { fixedNow },
        maxSessionBytes: WafraMessageHistoryStore.maxSessionBytes,
        maxStoredBytes: WafraMessageHistoryStore.maxStoredBytes,
        removeItem: { _ in
          if deletionAttempts == 0 {
            firstDeletionSawFence = FileManager.default.fileExists(atPath: marker.path) &&
              sessionIds.allSatisfy {
                !FileManager.default.fileExists(atPath: root.appendingPathComponent($0).path)
              }
          }
          deletionAttempts += 1
          throw HarnessError.injectedDeletionFailure
        }
      )
      expectsPrepared("prepared eraseAll reports deletion failure", .cleanupFailure) {
        try failing.eraseAll()
      }
      check("prepared erase marker precedes every deletion", firstDeletionSawFence)
      check("prepared failed erase retains durable marker", FileManager.default.fileExists(atPath: marker.path))
      check(
        "prepared failed erase hides every keyed raw-body source",
        try sessionIds.allSatisfy {
          !FileManager.default.fileExists(atPath: root.appendingPathComponent($0).path)
        } && storedDirectories(root).count == sessionIds.count &&
          storedDirectories(root).allSatisfy { $0.lastPathComponent.hasPrefix(".invalid-") }
      )
      let blockedSession = "WAFRA-PREPARED-ERASE-BLOCKED-0001"
      expectsPrepared("prepared erase fence blocks new preparation while cleanup fails", .cleanupFailure) {
        try failing.prepare(
          sessionId: blockedSession,
          found: 1,
          position: 1,
          guid: "blocked-guid",
          body: "blocked private body",
          date: fixedNow
        )
      }
      check(
        "prepared erase fence never creates the blocked session",
        !FileManager.default.fileExists(atPath: root.appendingPathComponent(blockedSession).path)
      )
      let recovered = preparedStore(root: root)
      check("prepared ordinary cleanup resumes interrupted erase", try recovered.purgeExpired(now: fixedNow) == 0)
      check("prepared recovered erase removes every raw-body tombstone", try storedDirectories(root).isEmpty)
      check("prepared recovered erase clears marker after sources", !FileManager.default.fileExists(atPath: marker.path))
    }

    try withRoot("prepared-marker-interruption") { root in
      let prepared = preparedStore(root: root)
      let original = "WAFRA-PREPARED-MARKER-INTERRUPTION-0001"
      try prepared.prepare(
        sessionId: original,
        found: 1,
        position: 1,
        guid: "marker-guid",
        body: "marker private body",
        date: fixedNow
      )
      let marker = root.appendingPathComponent(eraseMarkerName)
      try writeProtectedForTest(Data([1]), to: marker)
      try FileManager.default.setAttributes(
        [.posixPermissions: 0o600],
        ofItemAtPath: marker.path
      )
      let replacement = "WAFRA-PREPARED-MARKER-INTERRUPTION-0002"
      try prepared.prepare(
        sessionId: replacement,
        found: 1,
        position: 1,
        guid: "replacement-guid",
        body: "replacement body",
        date: fixedNow
      )
      check(
        "prepared fresh operation completes marker-only interrupted erase first",
        !FileManager.default.fileExists(atPath: root.appendingPathComponent(original).path) &&
          FileManager.default.fileExists(atPath: root.appendingPathComponent(replacement).path)
      )
      check("prepared marker-only recovery clears marker", !FileManager.default.fileExists(atPath: marker.path))
    }

    try withRoot("prepared-marker-blocks-read") { root in
      let sessionId = "WAFRA-PREPARED-MARKER-BLOCKS-READ-0001"
      try preparedStore(root: root).prepare(
        sessionId: sessionId,
        found: 1,
        position: 1,
        guid: "blocked-read-guid",
        body: "private body must never reach the callback",
        date: fixedNow
      )
      let marker = root.appendingPathComponent(eraseMarkerName)
      try writeProtectedForTest(Data([1]), to: marker)
      try FileManager.default.setAttributes(
        [.posixPermissions: 0o600],
        ofItemAtPath: marker.path
      )
      let blocked = WafraPreparedHistoryStore(
        root: root,
        now: { fixedNow },
        maxSessionBytes: WafraMessageHistoryStore.maxSessionBytes,
        maxStoredBytes: WafraMessageHistoryStore.maxStoredBytes,
        removeItem: { _ in throw HarnessError.injectedDeletionFailure }
      )
      var callbackRan = false
      expectsPrepared("prepared erase fence blocks raw-body consumption", .cleanupFailure) {
        try blocked.consumePreparedChunks(sessionId: sessionId, found: 1) { _ in
          callbackRan = true
        }
      }
      check("prepared erase fence prevents the raw-body callback", !callbackRan)
      check(
        "prepared blocked read hides the keyed raw-body directory",
        try !FileManager.default.fileExists(atPath: root.appendingPathComponent(sessionId).path) &&
          storedDirectories(root).allSatisfy {
            $0.lastPathComponent.hasPrefix(".invalid-")
          }
      )
      check("prepared blocked read retains its durable marker", FileManager.default.fileExists(atPath: marker.path))
      check("prepared blocked read recovers on a clean retry", try preparedStore(root: root).purgeExpired(now: fixedNow) == 0)
      check(
        "prepared blocked read recovery removes every raw source and marker",
        try storedDirectories(root).isEmpty &&
          !FileManager.default.fileExists(atPath: marker.path)
      )
    }
  }

  private static func testBridgeCleanupCoordinator() throws {
    let sensitiveSessionId = "WAFRA-PRIVATE-CLEANUP-SESSION-0001"

    do {
      var attempts: [String] = []
      let coordinator = WafraHistoryCleanupCoordinator(
        discardCompleted: { _ in
          attempts.append("completed")
          throw SensitiveCleanupError(description: sensitiveSessionId)
        },
        discardPrepared: { _ in attempts.append("prepared") },
        purgeCompleted: { _ in 0 },
        purgePrepared: { _ in 0 },
        eraseCompleted: {},
        erasePrepared: {}
      )
      expectsCleanup("bridge discard reports a first-store failure") {
        try coordinator.discardSession(sessionId: sensitiveSessionId)
      }
      check(
        "bridge discard attempts prepared cleanup after completed cleanup fails",
        attempts == ["completed", "prepared"]
      )
      do {
        try coordinator.discardSession(sessionId: sensitiveSessionId)
        check("bridge discard cleanup error stays source-free", false)
      } catch {
        check(
          "bridge discard cleanup error stays source-free",
          !String(describing: error).contains(sensitiveSessionId)
        )
      }
    }

    do {
      var attempts: [String] = []
      let coordinator = WafraHistoryCleanupCoordinator(
        discardCompleted: { _ in },
        discardPrepared: { _ in },
        purgeCompleted: { _ in
          attempts.append("completed")
          return 2
        },
        purgePrepared: { _ in
          attempts.append("prepared")
          throw HarnessError.injectedDeletionFailure
        },
        eraseCompleted: {},
        erasePrepared: {}
      )
      expectsCleanup("bridge purge reports a second-store failure") {
        _ = try coordinator.purgeExpired(now: fixedNow)
      }
      check(
        "bridge purge attempts both stores before reporting failure",
        attempts == ["completed", "prepared"]
      )
    }

    do {
      var attempts: [String] = []
      let coordinator = WafraHistoryCleanupCoordinator(
        discardCompleted: { _ in },
        discardPrepared: { _ in },
        purgeCompleted: { _ in
          attempts.append("completed")
          throw HarnessError.injectedDeletionFailure
        },
        purgePrepared: { _ in
          attempts.append("prepared")
          return 3
        },
        eraseCompleted: {},
        erasePrepared: {}
      )
      expectsCleanup("bridge purge reports a first-store failure") {
        _ = try coordinator.purgeExpired(now: fixedNow)
      }
      check(
        "bridge purge attempts prepared cleanup after completed cleanup fails",
        attempts == ["completed", "prepared"]
      )
    }

    do {
      var attempts: [String] = []
      let coordinator = WafraHistoryCleanupCoordinator(
        discardCompleted: { _ in },
        discardPrepared: { _ in },
        purgeCompleted: { _ in 0 },
        purgePrepared: { _ in 0 },
        eraseCompleted: {
          attempts.append("completed")
          throw HarnessError.injectedDeletionFailure
        },
        erasePrepared: {
          attempts.append("prepared")
          throw HarnessError.injectedDeletionFailure
        }
      )
      expectsCleanup("bridge erase reports cleanup failure") {
        try coordinator.eraseAll()
      }
      check(
        "bridge erase attempts prepared cleanup after completed cleanup fails",
        attempts == ["completed", "prepared"]
      )
    }

    do {
      var attempts = 0
      let coordinator = WafraHistoryCleanupCoordinator(
        discardCompleted: { _ in },
        discardPrepared: { _ in },
        purgeCompleted: { _ in
          attempts += 1
          return Int.max
        },
        purgePrepared: { _ in
          attempts += 1
          return 1
        },
        eraseCompleted: {},
        erasePrepared: {}
      )
      expectsCleanup("bridge purge rejects a combined count overflow") {
        _ = try coordinator.purgeExpired(now: fixedNow)
      }
      check("bridge purge computes overflow only after both stores answer", attempts == 2)
    }

    let successful = WafraHistoryCleanupCoordinator(
      discardCompleted: { _ in },
      discardPrepared: { _ in },
      purgeCompleted: { _ in 3 },
      purgePrepared: { _ in 4 },
      eraseCompleted: {},
      erasePrepared: {}
    )
    check(
      "bridge purge safely sums completed and prepared removal counts",
      try successful.purgeExpired(now: fixedNow) == 7
    )
  }

  private static func testBulkHistoryImporterValidationAndPacking() throws {
    try withRoot("bulk-preflight") { root in
      let importer = WafraMessageHistoryImporter(store: store(root: root), now: { fixedNow })
      let sensitive = ["private-guid", "private body"]
      expectsBulkImportFailure("bulk rejects zero before Begin", sensitive: sensitive) {
        _ = try importer.importMessages(
          sessionId: "history-bulk-zero",
          found: 0,
          messageGUIDs: [],
          bodies: [],
          dates: []
        )
      }
      expectsBulkImportFailure("bulk rejects over 10,000 before Begin", sensitive: sensitive) {
        _ = try importer.importMessages(
          sessionId: "history-bulk-over-limit",
          found: 10_001,
          messageGUIDs: [],
          bodies: [],
          dates: []
        )
      }
      expectsBulkImportFailure("bulk rejects GUID cardinality mismatch", sensitive: sensitive) {
        _ = try importer.importMessages(
          sessionId: "history-bulk-guid-mismatch",
          found: 1,
          messageGUIDs: [],
          bodies: ["private body"],
          dates: [fixedNow]
        )
      }
      expectsBulkImportFailure("bulk rejects Body cardinality mismatch", sensitive: sensitive) {
        _ = try importer.importMessages(
          sessionId: "history-bulk-body-mismatch",
          found: 1,
          messageGUIDs: ["private-guid"],
          bodies: [],
          dates: [fixedNow]
        )
      }
      expectsBulkImportFailure("bulk rejects Date cardinality mismatch", sensitive: sensitive) {
        _ = try importer.importMessages(
          sessionId: "history-bulk-date-mismatch",
          found: 1,
          messageGUIDs: ["private-guid"],
          bodies: ["private body"],
          dates: []
        )
      }
      check(
        "bulk preflight failures create no session directories",
        !FileManager.default.fileExists(atPath: root.path)
      )
    }

    for count in [49, 50, 51, 10_000] {
      try withRoot("bulk-pack-\(count)") { root in
        let historyStore = store(root: root)
        let importer = WafraMessageHistoryImporter(store: historyStore, now: { fixedNow })
        let input = bulkInput(count: count, body: { _ in "x" })
        let sessionId = "history-bulk-pack-\(count)"
        let result = try importer.importMessages(
          sessionId: sessionId,
          found: count,
          messageGUIDs: input.guids,
          bodies: input.bodies,
          dates: input.dates
        )
        let expectedChunks = (count + WafraMessageHistoryStore.maxChunkRecords - 1)
          / WafraMessageHistoryStore.maxChunkRecords
        check("bulk packs \(count) inputs into exact chunks", result.totalChunks == expectedChunks)
        check("bulk attempts every one of \(count) inputs", result.attempted == count)
        check("bulk accepts every valid one of \(count) inputs", result.accepted == count)
        check("bulk skips no valid one of \(count) inputs", result.skipped == 0)
        let descriptor = try historyStore.completedSession(sessionId: sessionId)
        check(
          "bulk descriptor has contiguous chunks for \(count) inputs",
          descriptor?.chunkIndices == Array(0..<expectedChunks)
        )
        var everyChunkPackedExactly = true
        for chunkIndex in 0..<expectedChunks {
          let chunk = try historyStore.readChunk(sessionId: sessionId, chunkIndex: chunkIndex)
          let expectedCount = min(
            WafraMessageHistoryStore.maxChunkRecords,
            count - chunkIndex * WafraMessageHistoryStore.maxChunkRecords
          )
          everyChunkPackedExactly = everyChunkPackedExactly && chunk.count == expectedCount
        }
        check(
          "every bulk chunk has exact attempted packing for \(count)",
          everyChunkPackedExactly
        )
      }
    }
  }

  private static func testBulkHistoryImporterSentinelsAndCleanup() throws {
    try withRoot("bulk-sentinels") { root in
      let historyStore = store(root: root)
      let importer = WafraMessageHistoryImporter(store: historyStore, now: { fixedNow })
      let oversized = String(repeating: "x", count: WafraMessageHistoryStore.maxTextBytes + 1)
      let result = try importer.importMessages(
        sessionId: "history-bulk-sentinels",
        found: 5,
        messageGUIDs: ["", "guid-space", "guid-epoch", "guid-future", "guid-oversized"],
        bodies: ["valid", "   \n", "valid", "valid", oversized],
        dates: [
          fixedNow,
          fixedNow,
          Date(timeIntervalSince1970: 0),
          fixedNow.addingTimeInterval(5 * 60 + 1),
          fixedNow,
        ]
      )
      check(
        "bulk invalid aligned items remain attempted but skipped",
        result == WafraBulkHistoryImportResult(
          totalChunks: 1,
          found: 5,
          attempted: 5,
          accepted: 0,
          skipped: 5
        )
      )
      check(
        "bulk all-sentinel chunk exposes no source records",
        try historyStore.readChunk(sessionId: "history-bulk-sentinels", chunkIndex: 0).isEmpty
      )
      check(
        "bulk all-sentinel session remains a reconciled completed descriptor",
        try historyStore.completedSession(sessionId: "history-bulk-sentinels")?.skipped == 5
      )
    }

    try withRoot("bulk-duplicate") { root in
      let historyStore = store(root: root)
      let importer = WafraMessageHistoryImporter(store: historyStore, now: { fixedNow })
      expectsBulkImportFailure(
        "bulk duplicate GUID invalidates and deletes the partial session",
        sensitive: ["duplicate-private-guid", "private one", "private two"]
      ) {
        _ = try importer.importMessages(
          sessionId: "history-bulk-duplicate",
          found: 2,
          messageGUIDs: ["duplicate-private-guid", "duplicate-private-guid"],
          bodies: ["private one", "private two"],
          dates: [fixedNow.addingTimeInterval(-2), fixedNow.addingTimeInterval(-1)]
        )
      }
      check(
        "bulk duplicate failure leaves no visible session",
        try historyStore.completedSession(sessionId: "history-bulk-duplicate") == nil
      )
      check(
        "bulk duplicate failure removes its directory",
        !FileManager.default.fileExists(atPath: root.appendingPathComponent("history-bulk-duplicate").path)
      )
    }

    try withRoot("bulk-partial-duplicate") { root in
      var wroteFirstChunk = false
      let historyStore = store(root: root, writeData: { data, url in
        if url.lastPathComponent == "chunk-0.json" { wroteFirstChunk = true }
        try writeProtectedForTest(data, to: url)
      })
      let importer = WafraMessageHistoryImporter(store: historyStore, now: { fixedNow })
      var input = bulkInput(count: 51, body: { _ in "x" })
      input.guids[50] = input.guids[0]
      expectsBulkImportFailure("bulk duplicate in chunk one rolls back chunk zero") {
        _ = try importer.importMessages(
          sessionId: "history-bulk-partial-duplicate",
          found: 51,
          messageGUIDs: input.guids,
          bodies: input.bodies,
          dates: input.dates
        )
      }
      check("bulk partial-duplicate fixture staged its first chunk", wroteFirstChunk)
      check(
        "bulk cross-chunk duplicate removes all partial source",
        !FileManager.default.fileExists(
          atPath: root.appendingPathComponent("history-bulk-partial-duplicate").path
        )
      )
    }

    try withRoot("bulk-mixed-order") { root in
      let historyStore = store(root: root)
      let importer = WafraMessageHistoryImporter(store: historyStore, now: { fixedNow })
      var guids = Array(repeating: "", count: 51)
      var bodies = Array(repeating: "", count: 51)
      guids[0] = "mixed-first"
      bodies[0] = "first"
      guids[50] = "mixed-last"
      bodies[50] = "last"
      let dates = (0..<51).map { fixedNow.addingTimeInterval(-Double($0 + 1)) }
      let result = try importer.importMessages(
        sessionId: "history-bulk-mixed-order",
        found: 51,
        messageGUIDs: guids,
        bodies: bodies,
        dates: dates
      )
      check(
        "bulk mixed 51-item import reconciles both chunks",
        result == WafraBulkHistoryImportResult(
          totalChunks: 2,
          found: 51,
          attempted: 51,
          accepted: 2,
          skipped: 49
        )
      )
      let firstChunk = try historyStore.readChunk(
        sessionId: "history-bulk-mixed-order",
        chunkIndex: 0
      )
      let lastChunk = try historyStore.readChunk(
        sessionId: "history-bulk-mixed-order",
        chunkIndex: 1
      )
      check(
        "bulk mixed import preserves first-to-last accepted order",
        firstChunk.count == 1 && lastChunk.count == 1 &&
          firstChunk[0].contains(id("mixed-first")) &&
          lastChunk[0].contains(id("mixed-last"))
      )
    }

    try withRoot("bulk-write-failure") { root in
      var wroteFirstChunk = false
      let failingStore = store(root: root, writeData: { data, url in
        if url.lastPathComponent == "chunk-0.json" { wroteFirstChunk = true }
        if url.lastPathComponent == "chunk-1.json" {
          throw HarnessError.injectedWriteFailure
        }
        try writeProtectedForTest(data, to: url)
      })
      let importer = WafraMessageHistoryImporter(store: failingStore, now: { fixedNow })
      let input = bulkInput(count: 51, body: { _ in "private write body" })
      expectsBulkImportFailure(
        "bulk normalizes an injected stage-write failure",
        sensitive: [
          "history-bulk-write-failure",
          "MESSAGE-GUID-0",
          "private write body",
          "2026-04-30T23:59:59.000Z",
          "\"v\":1",
        ]
      ) {
        _ = try importer.importMessages(
          sessionId: "history-bulk-write-failure",
          found: 51,
          messageGUIDs: input.guids,
          bodies: input.bodies,
          dates: input.dates
        )
      }
      check("bulk injected-write fixture staged its first chunk", wroteFirstChunk)
      check(
        "bulk stage-write failure leaves no visible session",
        try failingStore.completedSession(sessionId: "history-bulk-write-failure") == nil
      )
    }

    try withRoot("bulk-session-byte-limit") { root in
      var wroteFirstChunk = false
      let historyStore = store(root: root, writeData: { data, url in
        if url.lastPathComponent == "chunk-0.json" { wroteFirstChunk = true }
        try writeProtectedForTest(data, to: url)
      })
      let importer = WafraMessageHistoryImporter(store: historyStore, now: { fixedNow })
      let input = bulkInput(
        count: 1_600,
        body: { _ in String(repeating: "x", count: WafraMessageHistoryStore.maxTextBytes) }
      )
      expectsBulkImportFailure("bulk enforces the 24-MiB store boundary after staging") {
        _ = try importer.importMessages(
          sessionId: "history-bulk-session-byte-limit",
          found: 1_600,
          messageGUIDs: input.guids,
          bodies: input.bodies,
          dates: input.dates
        )
      }
      check("bulk byte-limit fixture staged at least one chunk", wroteFirstChunk)
      check(
        "bulk byte-limit failure removes every partial chunk",
        !FileManager.default.fileExists(
          atPath: root.appendingPathComponent("history-bulk-session-byte-limit").path
        )
      )
    }

    try withRoot("bulk-tombstone") { root in
      let flakyStore = store(root: root, removeItem: { _ in
        throw HarnessError.injectedDeletionFailure
      })
      let importer = WafraMessageHistoryImporter(store: flakyStore, now: { fixedNow })
      expectsBulkImportFailure(
        "bulk cleanup failure remains source-free",
        sensitive: ["private-tombstone-guid", "private tombstone body"]
      ) {
        _ = try importer.importMessages(
          sessionId: "history-bulk-tombstone",
          found: 2,
          messageGUIDs: ["private-tombstone-guid", "private-tombstone-guid"],
          bodies: ["private tombstone body", "private tombstone body"],
          dates: [fixedNow.addingTimeInterval(-2), fixedNow.addingTimeInterval(-1)]
        )
      }
      check(
        "bulk failed deletion leaves an invalid tombstone",
        try manifest(root, "history-bulk-tombstone")["state"] as? String == "invalid"
      )
      check(
        "bulk next clean operation retries tombstone deletion",
        try store(root: root).purgeExpired(now: fixedNow) == 0 &&
          !FileManager.default.fileExists(atPath: root.appendingPathComponent("history-bulk-tombstone").path)
      )
    }
  }

  private static func testSourceFreeErrors() throws {
    try withRoot("error-redaction") { root in
      let store = store(root: root)
      let sessionId = "history-sensitive-session"
      let secret = try store.beginSession(sessionId: sessionId)
      let sensitiveRecord = record(id: id("sensitive-guid"), text: "sensitive message body")
      do {
        _ = try store.stageChunk(sessionId: sessionId, authorizationSecret: secret + "wrong", chunkIndex: 0, records: [sensitiveRecord])
        check("source-free error fixture throws", false)
      } catch {
        let description = String(describing: error)
        check("errors omit session identifier", !description.contains(sessionId))
        check("errors omit authorization secret", !description.contains(secret))
        check("errors omit record content", !description.contains("sensitive message body"))
        check("errors omit record identifier", !description.contains(id("sensitive-guid")))
      }
    }
  }

  private static func testEveryPublicErrorIsSourceFreeStoreError() throws {
    let root = temporaryRoot("sensitive-filesystem-root")
    defer { try? FileManager.default.removeItem(at: root) }
    try Data("not a directory".utf8).write(to: root)
    let store = store(root: root)
    let sessionId = "history-sensitive-filesystem-session"
    let secret = "sensitive-authorization-secret"
    let sensitive = [root.path, sessionId, secret]

    expectsSourceFreeStoreError("Begin normalizes root filesystem error", sensitive: sensitive) {
      _ = try store.beginSession(sessionId: sessionId)
    }
    expectsSourceFreeStoreError("Stage normalizes root filesystem error", sensitive: sensitive) {
      _ = try store.stageChunk(sessionId: sessionId, authorizationSecret: secret, chunkIndex: 0, records: [record()])
    }
    expectsSourceFreeStoreError("Finish normalizes root filesystem error", sensitive: sensitive) {
      try store.finishSession(sessionId: sessionId, authorizationSecret: secret, totalChunks: 0, found: 0, attempted: 0, accepted: 0, skipped: 0)
    }
    expectsSourceFreeStoreError("completedSession normalizes root filesystem error", sensitive: sensitive) {
      _ = try store.completedSession(sessionId: sessionId)
    }
    expectsSourceFreeStoreError("recoverCompletedSession normalizes root filesystem error", sensitive: sensitive) {
      _ = try store.recoverCompletedSession(startedAfter: fixedNow)
    }
    expectsSourceFreeStoreError("readChunk normalizes root filesystem error", sensitive: sensitive) {
      _ = try store.readChunk(sessionId: sessionId, chunkIndex: 0)
    }
    expectsSourceFreeStoreError("discard normalizes root filesystem error", sensitive: sensitive) {
      try store.discardSession(sessionId: sessionId)
    }
    expectsSourceFreeStoreError("purgeExpired normalizes root filesystem error", sensitive: sensitive) {
      _ = try store.purgeExpired(now: fixedNow)
    }
    expectsSourceFreeStoreError("eraseAll normalizes root filesystem error", sensitive: sensitive) {
      try store.eraseAll()
    }
  }

  private static func runChildLifecycle(arguments: [String]) throws {
    guard arguments.count == 5 else { Foundation.exit(64) }
    let root = URL(fileURLWithPath: arguments[2], isDirectory: true)
    let sessionId = arguments[3]
    let holdMicros = UInt32(arguments[4]) ?? 0
    let store = store(root: root, lockAcquired: { _ in usleep(holdMicros) })
    let secret = try store.beginSession(sessionId: sessionId)
    _ = try stageOne(store, sessionId: sessionId, secret: secret, recordId: id(sessionId))
    try finishOne(store, sessionId: sessionId, secret: secret)
    try store.discardSession(sessionId: sessionId)
  }

  private static func runChildOverflow(arguments: [String]) throws {
    guard arguments.count == 5 else { Foundation.exit(64) }
    let root = URL(fileURLWithPath: arguments[2], isDirectory: true)
    let sessionId = arguments[3]
    let secret = String(decoding: try Data(contentsOf: URL(fileURLWithPath: arguments[4])), as: UTF8.self)
    do {
      _ = try stageOne(
        store(root: root),
        sessionId: sessionId,
        secret: secret,
        chunkIndex: 1,
        recordId: id("overflow-child")
      )
      Foundation.exit(2)
    } catch is WafraMessageHistoryStore.StoreError {
      Foundation.exit(0)
    } catch {
      Foundation.exit(3)
    }
  }

  private static func runChildJSONDepth(arguments: [String]) throws {
    guard arguments.count == 5, let depth = Int(arguments[4]) else {
      Foundation.exit(64)
    }
    let root = URL(fileURLWithPath: arguments[2], isDirectory: true)
    let sessionId = arguments[3]
    let store = store(root: root)
    let secret = try store.beginSession(sessionId: sessionId)
    let counts = try store.stageChunk(
      sessionId: sessionId,
      authorizationSecret: secret,
      chunkIndex: 0,
      records: [recordWithNestedSender(id: id("extreme-json-depth"), depth: depth)]
    )
    Foundation.exit(
      counts == WafraHistoryChunkCounts(attempted: 1, accepted: 0, skipped: 1)
        ? 0
        : 2
    )
  }

  private static func runChildCrashAfterEraseMarker(arguments: [String]) throws {
    guard arguments.count == 3 else { Foundation.exit(64) }
    let root = URL(fileURLWithPath: arguments[2], isDirectory: true)
    let crashing = store(root: root, writeData: { data, url in
      try writeProtectedForTest(data, to: url)
      if url.lastPathComponent == eraseMarkerName {
        Foundation.exit(71)
      }
    })
    try crashing.eraseAll()
    Foundation.exit(2)
  }

  private static func runChildCrashMidwayErase(arguments: [String]) throws {
    guard arguments.count == 3 else { Foundation.exit(64) }
    let root = URL(fileURLWithPath: arguments[2], isDirectory: true)
    var sourceDeletionCount = 0
    let crashing = store(root: root, removeItem: { url in
      try FileManager.default.removeItem(at: url)
      if url.lastPathComponent != eraseMarkerName {
        sourceDeletionCount += 1
        if sourceDeletionCount == 1 { Foundation.exit(72) }
      }
    })
    try crashing.eraseAll()
    Foundation.exit(2)
  }

  private static func runChildLockProbe(arguments: [String]) throws {
    guard arguments.count == 6 else { Foundation.exit(64) }
    let root = URL(fileURLWithPath: arguments[2], isDirectory: true)
    let sessionId = arguments[3]
    let acquired = URL(fileURLWithPath: arguments[4])
    let release = URL(fileURLWithPath: arguments[5])
    let store = store(root: root, lockAcquired: { _ in
      try! Data("acquired".utf8).write(to: acquired, options: .atomic)
      while !FileManager.default.fileExists(atPath: release.path) {
        usleep(5_000)
      }
    })
    _ = try store.beginSession(sessionId: sessionId)
  }

  private static func testCrossProcessLock() throws {
    try withRoot("cross-process") { root in
      try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
      let executable = URL(fileURLWithPath: CommandLine.arguments[0])
      let holderAcquired = root.appendingPathComponent("holder-acquired")
      let holderRelease = root.appendingPathComponent("holder-release")
      let contenderAcquired = root.appendingPathComponent("contender-acquired")
      let contenderRelease = root.appendingPathComponent("contender-release")
      try Data().write(to: contenderRelease)

      func probe(_ suffix: String, acquired: URL, release: URL) -> Process {
        let process = Process()
        process.executableURL = executable
        process.arguments = ["--child-lock-probe", root.path, "history-probe-\(suffix)", acquired.path, release.path]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        return process
      }
      let holder = probe("holder", acquired: holderAcquired, release: holderRelease)
      try holder.run()
      check("holder child acquires the store lock", waitForFile(holderAcquired))

      let descriptor = Darwin.open(root.appendingPathComponent(".lock").path, O_RDWR)
      let nonblockingResult = flock(descriptor, LOCK_EX | LOCK_NB)
      let lockErrno = errno
      if nonblockingResult == 0 { flock(descriptor, LOCK_UN) }
      Darwin.close(descriptor)
      check("kernel reports the child-held flock as unavailable", nonblockingResult == -1 && (lockErrno == EWOULDBLOCK || lockErrno == EAGAIN))

      let contender = probe("contender", acquired: contenderAcquired, release: contenderRelease)
      try contender.run()
      usleep(50_000)
      check("second child has not crossed the held store lock", !FileManager.default.fileExists(atPath: contenderAcquired.path))
      try Data().write(to: holderRelease)
      holder.waitUntilExit()
      contender.waitUntilExit()
      check("both lock-contending child operations succeed", holder.terminationStatus == 0 && contender.terminationStatus == 0)
      check("contender acquires only after release", FileManager.default.fileExists(atPath: contenderAcquired.path))

      let lifecycleOne = Process()
      lifecycleOne.executableURL = executable
      lifecycleOne.arguments = ["--child-lifecycle", root.path, "history-child-one", "0"]
      lifecycleOne.standardOutput = FileHandle.nullDevice
      lifecycleOne.standardError = FileHandle.nullDevice
      let lifecycleTwo = Process()
      lifecycleTwo.executableURL = executable
      lifecycleTwo.arguments = ["--child-lifecycle", root.path, "history-child-two", "0"]
      lifecycleTwo.standardOutput = FileHandle.nullDevice
      lifecycleTwo.standardError = FileHandle.nullDevice
      try lifecycleOne.run()
      try lifecycleTwo.run()
      lifecycleOne.waitUntilExit()
      lifecycleTwo.waitUntilExit()
      check("Begin/Stage/Finish/discard lifecycles survive two-process contention", lifecycleOne.terminationStatus == 0 && lifecycleTwo.terminationStatus == 0)
    }
  }

  static func main() throws {
    if CommandLine.arguments.count > 1, CommandLine.arguments[1] == "--child-lifecycle" {
      try runChildLifecycle(arguments: CommandLine.arguments)
      return
    }
    if CommandLine.arguments.count > 1, CommandLine.arguments[1] == "--child-overflow" {
      try runChildOverflow(arguments: CommandLine.arguments)
      return
    }
    if CommandLine.arguments.count > 1, CommandLine.arguments[1] == "--child-json-depth" {
      try runChildJSONDepth(arguments: CommandLine.arguments)
      return
    }
    if CommandLine.arguments.count > 1, CommandLine.arguments[1] == "--child-crash-after-erase-marker" {
      try runChildCrashAfterEraseMarker(arguments: CommandLine.arguments)
      return
    }
    if CommandLine.arguments.count > 1, CommandLine.arguments[1] == "--child-crash-midway-erase" {
      try runChildCrashMidwayErase(arguments: CommandLine.arguments)
      return
    }
    if CommandLine.arguments.count > 1, CommandLine.arguments[1] == "--child-lock-probe" {
      try runChildLockProbe(arguments: CommandLine.arguments)
      return
    }

    run("core Begin/Stage/Finish protocol", testCoreProtocol)
    run("authorization and duplicate Begin", testAuthorizationAndBegin)
    run("record validation and sender normalization", testValidationAndNormalization)
    run("Shortcut timestamp adapter", testShortcutOffsetRecords)
    run("Shortcut authentication and bounds", testShortcutAuthenticationAndBounds)
    run("bounded JSON member scanning", testJSONNestingLimit)
    run("retry, digest, and duplicate-ID handling", testRetriesDigestsAndDuplicates)
    run("finish reconciliation", testFinishReconciliation)
    run("Finish chunk-file integrity", testFinishVerifiesChunkFiles)
    run("record, session, and global limits", testLimits)
    run("decoded manifest invariant validation", testManifestInvariantValidation)
    run("fixed expiry and visibility", testFixedExpiryAndVisibility)
    run("completed-session recovery", testCompletedSessionRecovery)
    run("failed deletion and cleanup retry", testFailedDeletionAndCleanupRetry)
    run("discard, full erase, protection, and backup exclusion", testDiscardEraseAndStorageAttributes)
    run("crash-atomic erase recovery", testEraseDurabilityAndRecovery)
    run("bulk importer canonical records", testBulkHistoryImporterCanonicalRecords)
    run("prepared scalar canonical import", testPreparedHistoryCanonicalImport)
    run("prepared privacy and exact sentinels", testPreparedHistoryPrivacyAndSentinels)
    run("prepared 1-based bounds and retries", testPreparedHistoryBoundsAndRetries)
    run("prepared fixed TTL", testPreparedHistoryTTL)
    run("prepared packing and rollback", testPreparedHistoryPackingAndRollback)
    run("prepared V2 derived count and packing", testPreparedHistoryV2DerivedCountAndPacking)
    run("prepared V2 selected range guard", testPreparedHistoryV2SelectedRangeGuard)
    run("prepared V2 positions, retries, and bounds", testPreparedHistoryV2PositionsRetriesAndBounds)
    run("prepared V2 duplicate normalization", testPreparedHistoryV2DuplicateNormalization)
    run("prepared V3 derived count and V1 validation", testPreparedHistoryV3DerivedCountAndV1Validation)
    run("prepared V3 positions and V2 discard compatibility", testPreparedHistoryV3PositionsAndDiscard)
    run("prepared concurrency", testPreparedHistoryConcurrency)
    run("prepared session and global byte limits", testPreparedHistoryStorageLimits)
    run("prepared filesystem hardening", testPreparedHistoryFilesystemHardening)
    run("prepared deletion rollback", testPreparedHistoryDeletionRollback)
    run("prepared authenticated failure cleanup", testPreparedHistoryAuthenticatedFailureCleanup)
    run("prepared durable erase fence", testPreparedHistoryEraseFence)
    run("bridge cleanup coordinator", testBridgeCleanupCoordinator)
    run("bulk importer validation and packing", testBulkHistoryImporterValidationAndPacking)
    run("bulk importer sentinels and cleanup", testBulkHistoryImporterSentinelsAndCleanup)
    run("source-free errors", testSourceFreeErrors)
    run("all public filesystem errors are source-free", testEveryPublicErrorIsSourceFreeStoreError)
    run("cross-process lock contention", testCrossProcessLock)

    print("\nNative history store: \(passed) passed, \(failed) failed")
    if failed > 0 { Foundation.exit(1) }
  }
}
