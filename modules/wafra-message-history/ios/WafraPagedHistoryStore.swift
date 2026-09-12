import CryptoKit
import Foundation
import Security
import Darwin

/// Beta producer store. One protected journal entry commits a page and its cursor.
/// The head is updated second; a crash in between is rolled forward on reopen.
/// Raw Messages never leave this private, backup-excluded, expiring staging area.
public final class WafraPagedHistoryStore {
  public static let shared = WafraPagedHistoryStore()
  public static let lifetime: TimeInterval = 24 * 60 * 60
  public static let maximumBytes = 72 * 1024 * 1024
  private static let queue = DispatchQueue(label: "app.wafra.paged-history")

  public enum Failure: String, Error {
    case invalidInput = "invalid-input"
    case unavailable = "unavailable"
    case unauthorized = "unauthorized"
    case staleRequest = "stale-request"
    case sourceChanged = "source-changed"
    case capacity = "staging-full"
    case corrupt = "corrupt-staging"
    case expired = "expired"
    case cleanup = "cleanup-failed"
  }
  private struct PageInfo: Codable {
    let digest: String
    let chunks: Int
    let accepted: Int
    let bytes: Int
  }
  private struct Head: Codable {
    let sessionId: String
    let createdAt: Date
    let expiresAt: Date
    var tokenHash: String
    var checkpoint: WafraHistoryCursor.Checkpoint
    var pages: [PageInfo]
    var lastRequestMAC: String?
  }
  private struct Entry: Codable {
    let previousCheckpoint: String
    let next: WafraHistoryCursor.Checkpoint
    let chunks: [[String]]
    let requestMAC: String
  }
  private struct JournalBlob: Codable {
    let payload: Data
    let digest: String
  }
  private struct PreparedRow {
    let reference: WafraHistoryCursor.Reference
    let record: String?
  }

  private func decodeBase64Field(_ value: Substring, maximum: Int) throws -> String {
    guard value.utf8.count <= ((maximum + 2) / 3) * 4 + 8,
          let data = Data(base64Encoded: String(value)),
          data.base64EncodedString() == value,
          data.count <= maximum,
          let text = String(data: data, encoding: .utf8) else {
      throw Failure.invalidInput
    }
    return text
  }

  private func preparedRow(_ line: Substring) throws -> PreparedRow {
    let guid: String
    let body: String
    let sender: String
    let dateText: String
    let fields = line.split(separator: "|", omittingEmptySubsequences: false)
    if fields.count == 4 {
      guid = try decodeBase64Field(fields[0], maximum: 1_024)
      body = try decodeBase64Field(fields[1], maximum: 16 * 1_024)
      sender = try decodeBase64Field(fields[2], maximum: 1_024)
      dateText = try decodeBase64Field(fields[3], maximum: 64)
    } else {
      // Backward-compatible reader for the first beta graph. New graphs never
      // depend on Shortcuts' Dictionary-to-Text representation.
      guard line.utf8.count <= 128 * 1_024,
            let data = Data(base64Encoded: String(line)),
            data.base64EncodedString() == line,
            WafraMessageHistoryStore.hasUniqueJSONMemberNames(data),
            let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            Set(object.keys) == Set(["guid", "body", "sender", "date"]),
            let parsedGuid = object["guid"] as? String,
            let parsedBody = object["body"] as? String, parsedBody.utf8.count <= 16 * 1024,
            let parsedSender = object["sender"] as? String, parsedSender.utf8.count <= 1_024,
            let parsedDate = object["date"] as? String, parsedDate.utf8.count <= 64 else {
        throw Failure.invalidInput
      }
      guid = parsedGuid; body = parsedBody; sender = parsedSender; dateText = parsedDate
    }
    let ref = try reference(guid: guid, dateText: dateText)
    let record = WafraMessageHistoryImporter.preparedRecord(guid: guid, body: body,
      sender: sender, date: try date(dateText), now: now())
    return PreparedRow(reference: ref, record: record == "{\"v\":0}" ? nil : record)
  }

  private let configuredRoot: URL?
  private let now: () -> Date
  private let byteLimit: Int
  private let beforeHeadWrite: (() throws -> Void)?

  public init(root: URL? = nil, now: @escaping () -> Date = Date.init) {
    configuredRoot = root; self.now = now; byteLimit = Self.maximumBytes
    beforeHeadWrite = nil
  }
  // Fault injection is internal to the host tests, never a Shortcut parameter.
  init(root: URL, now: @escaping () -> Date, byteLimit: Int,
       beforeHeadWrite: (() throws -> Void)?) {
    configuredRoot = root; self.now = now; self.byteLimit = byteLimit
    self.beforeHeadWrite = beforeHeadWrite
  }

  private static func hash(_ bytes: Data) -> String {
    SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
  }
  private static func encoded<T: Encodable>(_ value: T) throws -> Data {
    let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
    return try encoder.encode(value)
  }
  private static func journalBytes(_ entry: Entry) throws -> Data {
    let payload = try encoded(entry)
    return try encoded(JournalBlob(payload: payload, digest: hash(payload)))
  }
  private static func journalEntry(_ bytes: Data) throws -> Entry {
    let blob = try JSONDecoder().decode(JournalBlob.self, from: bytes)
    guard hash(blob.payload) == blob.digest else { throw Failure.corrupt }
    return try JSONDecoder().decode(Entry.self, from: blob.payload)
  }
  private static func utc(_ ms: Int64) -> String {
    let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f.string(from: Date(timeIntervalSince1970: Double(ms) / 1_000))
  }
  private func date(_ value: String) throws -> Date {
    guard let normalized = WafraMessageHistoryStore.normalizeShortcutInstant(value, now: now()) else {
      throw Failure.invalidInput
    }
    let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let result = f.date(from: normalized) else { throw Failure.invalidInput }
    return result
  }
  private func reference(guid: String, dateText: String) throws -> WafraHistoryCursor.Reference {
    guard !guid.isEmpty, guid.utf8.count <= 1_024 else { throw Failure.invalidInput }
    let instant = try date(dateText)
    return .init(id: Self.hash(Data(guid.utf8)),
      milliseconds: Int64((instant.timeIntervalSince1970 * 1_000).rounded()))
  }
  private static func validSession(_ id: String) -> Bool {
    id.range(of: "\\APAGED-[A-F0-9-]{36}\\z", options: .regularExpression) != nil
  }
  private func response(_ head: Head, token: String? = nil) throws -> String {
    let accepted = head.pages.reduce(0) { $0 + $1.accepted }
    var object: [String: Any] = [
      "sessionId": head.sessionId, "revision": head.checkpoint.revision,
      "before": Self.utc(head.checkpoint.before), "limit": head.checkpoint.limit,
      "status": head.checkpoint.complete ? "complete" : "continue",
      "checked": head.checkpoint.checked, "accepted": accepted,
      "skipped": head.checkpoint.checked - accepted,
      "createdAtMs": head.createdAt.timeIntervalSince1970 * 1_000,
      "expiresAtMs": head.expiresAt.timeIntervalSince1970 * 1_000,
    ]
    if let token { object["authorizationSecret"] = token }
    let bytes = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    return String(decoding: bytes, as: UTF8.self)
  }

  /// Called only by the locally authenticated Begin/Resume App Intent.
  /// A resume rotates the capability, fencing a previously suspended runner.
  public func begin(oldestGUID: String, oldestDate: String,
                    newestGUID: String, newestDate: String) throws -> String {
    let oldest = try reference(guid: oldestGUID, dateText: oldestDate)
    let newest = try reference(guid: newestGUID, dateText: newestDate)
    return try locked { directory in
      var head: Head
      if FileManager.default.fileExists(atPath: directory.appendingPathComponent("head.json").path) {
        head = try load(directory)
        guard head.checkpoint.oldest == oldest else { throw Failure.sourceChanged }
      } else {
        let created = now()
        head = Head(sessionId: "PAGED-\(UUID().uuidString)", createdAt: created,
          expiresAt: created.addingTimeInterval(Self.lifetime), tokenHash: "",
          checkpoint: try WafraHistoryCursor.begin(oldest: oldest, newest: newest),
          pages: [], lastRequestMAC: nil)
      }
      var bytes = [UInt8](repeating: 0, count: 32)
      guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
        throw Failure.unavailable
      }
      let token = Data(bytes).base64EncodedString()
      head.tokenHash = Self.hash(Data(bytes)); head.lastRequestMAC = nil
      try write(Self.encoded(head), to: directory.appendingPathComponent("head.json"))
      return try response(head, token: token)
    }
  }

  /// Each line is an unwrapped base64 JSON object produced by Shortcuts.
  /// Scalar framing avoids Apple's entity-property-array binding bug.
  public func stage(sessionId: String, authorizationSecret: String,
                    revision: Int, found: Int, frame: String) throws -> String {
    guard Self.validSession(sessionId), frame.utf8.count <= 8 * 1024 * 1024,
          revision >= 0, found > 0, found <= WafraHistoryCursor.maximumLimit,
          let secret = Data(base64Encoded: authorizationSecret), secret.count == 32,
          secret.base64EncodedString() == authorizationSecret else { throw Failure.invalidInput }
    let payload = Data("wafra.paged.v1\u{0}\(sessionId)\u{0}\(revision)\u{0}\(found)\u{0}\(frame)".utf8)
    let mac = Data(HMAC<SHA256>.authenticationCode(for: payload, using: SymmetricKey(data: secret)))
      .base64EncodedString()
    return try locked { directory in
      var head = try load(directory)
      guard head.sessionId == sessionId, head.tokenHash == Self.hash(secret) else {
        throw Failure.unauthorized
      }
      if revision == head.checkpoint.revision - 1, head.lastRequestMAC == mac {
        return try response(head, token: authorizationSecret)
      }
      guard revision == head.checkpoint.revision else { throw Failure.staleRequest }
      let lines = frame.split(separator: "\n", omittingEmptySubsequences: false)
      guard lines.count == found else { throw Failure.invalidInput }
      var prepared: [PreparedRow] = []
      for line in lines {
        prepared.append(try preparedRow(line))
      }
      let decision = try WafraHistoryCursor.advance(head.checkpoint,
        records: prepared.map(\.reference))
      guard decision.next.checked <= WafraHistoryCursor.maximumRecords else { throw Failure.capacity }
      let records = prepared.prefix(decision.commitCount).compactMap(\.record)
      let chunks = stride(from: 0, to: records.count, by: 50).map {
        Array(records[$0..<min($0 + 50, records.count)])
      }
      let entry = Entry(previousCheckpoint: Self.hash(try Self.encoded(head.checkpoint)),
        next: decision.next, chunks: chunks, requestMAC: mac)
      let bytes = try Self.journalBytes(entry)
      guard head.pages.reduce(0, { $0 + $1.bytes }) + bytes.count <= byteLimit else {
        // Retain previously committed pages and cursor. Never erase on capacity.
        throw Failure.capacity
      }
      try write(bytes, to: pageURL(directory, revision))
      head.checkpoint = decision.next
      head.pages.append(PageInfo(digest: Self.hash(bytes), chunks: chunks.count,
        accepted: records.count, bytes: bytes.count))
      head.lastRequestMAC = mac
      try beforeHeadWrite?()
      try write(Self.encoded(head), to: directory.appendingPathComponent("head.json"))
      return try response(head, token: authorizationSecret)
    }
  }

  public func status() throws -> String? {
    try locked { directory in
      guard FileManager.default.fileExists(atPath: directory.appendingPathComponent("head.json").path) else { return nil }
      return try response(load(directory))
    }
  }
  /// Recovery exposes only a source-free descriptor for this durable session.
  /// It cannot begin or complete acquisition from an app URL parameter.
  public func recoverCompletedSession(startedAfter: Date) throws -> WafraRecoveredHistorySession? {
    let snapshot: (String, Date)? = try locked { directory in
      guard FileManager.default.fileExists(atPath: directory.appendingPathComponent("head.json").path) else { return nil }
      let head = try load(directory)
      guard head.checkpoint.complete, head.createdAt >= startedAfter else { return nil }
      return (head.sessionId, head.createdAt)
    }
    guard let snapshot, let descriptor = try completedSession(sessionId: snapshot.0) else { return nil }
    return WafraRecoveredHistorySession(sessionId: snapshot.0,
      chunkIndices: descriptor.chunkIndices, found: descriptor.found, attempted: descriptor.attempted,
      accepted: descriptor.accepted, skipped: descriptor.skipped)
  }
  public func completedSession(sessionId: String) throws -> WafraCompletedHistorySession? {
    guard Self.validSession(sessionId) else { throw Failure.invalidInput }
    return try locked { directory in
      let head = try load(directory)
      guard head.sessionId == sessionId else { throw Failure.unavailable }
      guard head.checkpoint.complete else { return nil }
      for index in head.pages.indices { _ = try readEntry(directory, index: index, head: head) }
      let accepted = head.pages.reduce(0) { $0 + $1.accepted }
      let chunks = head.pages.reduce(0) { $0 + $1.chunks }
      return WafraCompletedHistorySession(chunkIndices: Array(0..<chunks),
        found: head.checkpoint.checked, attempted: head.checkpoint.checked,
        accepted: accepted, skipped: head.checkpoint.checked - accepted)
    }
  }
  public func readChunk(sessionId: String, chunkIndex: Int) throws -> [String] {
    guard Self.validSession(sessionId), chunkIndex >= 0 else { throw Failure.invalidInput }
    return try locked { directory in
      let head = try load(directory)
      guard head.sessionId == sessionId, head.checkpoint.complete else { throw Failure.unavailable }
      var offset = chunkIndex
      for index in head.pages.indices {
        if offset < head.pages[index].chunks {
          return try readEntry(directory, index: index, head: head).chunks[offset]
        }
        offset -= head.pages[index].chunks
      }
      throw Failure.invalidInput
    }
  }
  public func discard(sessionId: String) throws {
    guard Self.validSession(sessionId) else { throw Failure.invalidInput }
    try locked { directory in
      guard FileManager.default.fileExists(atPath: directory.appendingPathComponent("head.json").path) else { return }
      let head = try load(directory)
      guard head.sessionId == sessionId else { throw Failure.unavailable }
      try eraseDirectory(directory)
    }
  }
  public func eraseAll() throws { try locked { try eraseDirectory($0) } }

  public func purgeExpired() throws -> Int {
    try locked { directory in
      guard FileManager.default.fileExists(atPath: directory.appendingPathComponent("head.json").path) else { return 0 }
      do { _ = try load(directory); return 0 }
      catch Failure.expired { return 1 }
    }
  }

  private func pageURL(_ root: URL, _ index: Int) -> URL {
    root.appendingPathComponent(String(format: "page-%08d.json", index))
  }
  private func load(_ directory: URL) throws -> Head {
    var head = try JSONDecoder().decode(Head.self,
      from: read(directory.appendingPathComponent("head.json"), maximum: 4 * 1024 * 1024))
    guard Self.validSession(head.sessionId), head.tokenHash.count == 64,
          head.expiresAt.timeIntervalSince(head.createdAt) == Self.lifetime,
          head.pages.count == head.checkpoint.revision,
          head.pages.count <= 200_000,
          head.pages.allSatisfy({ $0.bytes > 0 && $0.bytes <= 8 * 1024 * 1024 && $0.chunks >= 0 && $0.chunks <= 9 &&
            $0.accepted >= 0 && $0.accepted <= 408 && $0.digest.count == 64 }),
          head.pages.reduce(0, { $0 + $1.accepted }) <= head.checkpoint.checked else {
      throw Failure.corrupt
    }
    guard now() < head.expiresAt else { try eraseDirectory(directory); throw Failure.expired }
    try WafraHistoryCursor.validate(head.checkpoint)
    if !head.pages.isEmpty {
      let previous = try readEntry(directory, index: head.pages.count - 1, head: head)
      guard previous.next == head.checkpoint else { throw Failure.corrupt }
    }
    let orphan = pageURL(directory, head.pages.count)
    if FileManager.default.fileExists(atPath: orphan.path) {
      let bytes = try read(orphan, maximum: 8 * 1024 * 1024)
      let entry = try Self.journalEntry(bytes)
      guard entry.previousCheckpoint == Self.hash(try Self.encoded(head.checkpoint)),
            entry.next.revision == head.checkpoint.revision + 1,
            entry.next.oldest == head.checkpoint.oldest,
            entry.next.newest == head.checkpoint.newest,
            entry.next.frozenBefore == head.checkpoint.frozenBefore,
            entry.next.checked >= head.checkpoint.checked,
            entry.next.checked - head.checkpoint.checked <= head.checkpoint.limit,
            entry.next.before <= head.checkpoint.before,
            entry.chunks.allSatisfy({ !$0.isEmpty && $0.count <= 50 }),
            bytes.count + head.pages.reduce(0, { $0 + $1.bytes }) <= byteLimit else { throw Failure.corrupt }
      try WafraHistoryCursor.validate(entry.next)
      head.checkpoint = entry.next
      head.pages.append(PageInfo(digest: Self.hash(bytes), chunks: entry.chunks.count,
        accepted: entry.chunks.reduce(0, { $0 + $1.count }), bytes: bytes.count))
      head.lastRequestMAC = entry.requestMAC
      try write(Self.encoded(head), to: directory.appendingPathComponent("head.json"))
    }
    return head
  }
  private func readEntry(_ directory: URL, index: Int, head: Head) throws -> Entry {
    let info = head.pages[index]
    let bytes = try read(pageURL(directory, index), maximum: 8 * 1024 * 1024)
    guard bytes.count == info.bytes, Self.hash(bytes) == info.digest else { throw Failure.corrupt }
    let entry = try Self.journalEntry(bytes)
    guard entry.next.revision == index + 1, entry.chunks.count == info.chunks,
          entry.chunks.reduce(0, { $0 + $1.count }) == info.accepted,
          entry.chunks.allSatisfy({ !$0.isEmpty && $0.count <= 50 && $0.allSatisfy {
            WafraMessageHistoryImporter.isCanonicalPreparedRecord($0, now: now()) && $0 != "{\"v\":0}"
          } }) else { throw Failure.corrupt }
    return entry
  }
  private func read(_ url: URL, maximum: Int) throws -> Data {
    let attrs = try FileManager.default.attributesOfItem(atPath: url.path)
    guard attrs[.type] as? FileAttributeType == .typeRegular,
          (attrs[.referenceCount] as? NSNumber)?.intValue == 1,
          (attrs[.posixPermissions] as? NSNumber)?.intValue == 0o600,
          attrs[.protectionKey] as? FileProtectionType == .complete,
          let size = attrs[.size] as? NSNumber, size.intValue > 0,
          size.intValue <= maximum else { throw Failure.corrupt }
    return try Data(contentsOf: url)
  }
  private func write(_ data: Data, to url: URL) throws {
    if FileManager.default.fileExists(atPath: url.path) { _ = try read(url, maximum: 8 * 1024 * 1024) }
    try data.write(to: url, options: [.atomic, .completeFileProtection])
    try FileManager.default.setAttributes([.posixPermissions: 0o600,
      .protectionKey: FileProtectionType.complete], ofItemAtPath: url.path)
    let handle = try FileHandle(forWritingTo: url); defer { try? handle.close() }
    try handle.synchronize()
  }
  private func protect(_ directory: URL) throws {
    if FileManager.default.fileExists(atPath: directory.path) {
      let attrs = try FileManager.default.attributesOfItem(atPath: directory.path)
      guard attrs[.type] as? FileAttributeType == .typeDirectory else { throw Failure.corrupt }
    } else {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
        attributes: [.posixPermissions: 0o700, .protectionKey: FileProtectionType.complete])
    }
    try FileManager.default.setAttributes([.posixPermissions: 0o700,
      .protectionKey: FileProtectionType.complete], ofItemAtPath: directory.path)
    var values = URLResourceValues(); values.isExcludedFromBackup = true
    var mutable = directory; try mutable.setResourceValues(values)
  }
  private func eraseDirectory(_ directory: URL) throws {
    let tombstone = directory.deletingLastPathComponent().appendingPathComponent(".discarded-\(UUID().uuidString)")
    try FileManager.default.moveItem(at: directory, to: tombstone)
    do { try FileManager.default.removeItem(at: tombstone) } catch { throw Failure.cleanup }
  }
  private func locked<T>(_ operation: (URL) throws -> T) throws -> T {
    try Self.queue.sync {
      let root = configuredRoot ?? FileManager.default.urls(for: .applicationSupportDirectory,
        in: .userDomainMask)[0].appendingPathComponent("WafraPagedHistory", isDirectory: true)
      try protect(root)
      let lock = root.appendingPathComponent(".lock")
      let fd = Darwin.open(lock.path, O_CREAT | O_RDWR | O_NOFOLLOW, 0o600)
      guard fd >= 0 else { throw Failure.unavailable }
      defer { Darwin.close(fd) }
      var lockInfo = stat()
      guard fstat(fd, &lockInfo) == 0, lockInfo.st_nlink == 1,
            lockInfo.st_mode & S_IFMT == S_IFREG else { throw Failure.corrupt }
      guard flock(fd, LOCK_EX) == 0 else { throw Failure.unavailable }
      defer { flock(fd, LOCK_UN) }
      try FileManager.default.setAttributes([.posixPermissions: 0o600,
        .protectionKey: FileProtectionType.complete], ofItemAtPath: lock.path)
      for entry in try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
        where entry.lastPathComponent.hasPrefix(".discarded-") {
        do { try FileManager.default.removeItem(at: entry) } catch { throw Failure.cleanup }
      }
      let active = root.appendingPathComponent("active", isDirectory: true)
      try protect(active)
      return try operation(active)
    }
  }
}
