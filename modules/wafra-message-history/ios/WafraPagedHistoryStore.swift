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
    /// A column-framed page whose per-field item counts disagree with the
    /// page count. The producer falls back to per-message framing for it.
    case columnMismatch = "frame-columns"
    /// Row-frame refusals that name the failing check. The Shortcut shows the
    /// raw value in its "History paused safely" alert, so a real-device
    /// failure can be attributed without a rebuild: the frame's line count
    /// disagreed with the page count, a field was not canonical Base64/UTF-8,
    /// or a date was not the producer's exact instant format.
    case fieldEncoding = "invalid-input-field"
    case fieldDate = "invalid-input-date"
  }
  /// A frame whose record structure could not be reconciled with the page
  /// count. Carries the observed shape (counts only, never Message text) so
  /// the Shortcut's "History paused safely" alert names it.
  public struct FrameRefusal: Error, CustomStringConvertible {
    public let reason: String
    public var description: String { reason }
  }
  /// Joins one column of a page in the Shortcut's list-wide Combine Text.
  /// Printable and absent from real SMS; disagreement is refused, not guessed.
  public static let columnSeparator: Character = "\u{241E}"
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

  /// `nil` means the field decoded but is longer than `maximum`; the caller
  /// decides whether that skips the row or refuses it. Malformed transport
  /// (non-canonical Base64, invalid UTF-8) always throws.
  private func decodeBase64Field(_ value: Substring, maximum: Int) throws -> String? {
    // Shortcuts can hand an App Intent text scalar a trailing CR/space even
    // when Base64 Encode itself is configured with no line breaks. Treat only
    // surrounding ASCII whitespace as transport noise; never ignore characters
    // inside the encoded value. The frame is already bounded to 8 MiB, so no
    // field can be inflated beyond it before this check runs.
    let encoded = String(value).trimmingCharacters(in: .whitespacesAndNewlines)
    guard let data = Data(base64Encoded: encoded),
          data.base64EncodedString() == encoded,
          let text = String(data: data, encoding: .utf8) else {
      throw Failure.fieldEncoding
    }
    return data.count <= maximum ? text : nil
  }

  private func preparedRow(_ line: Substring) throws -> PreparedRow {
    let guid: String
    /// `nil` is a Message whose body exceeds the record bound. Bank alerts
    /// are short, so the parser could never use it; keep the row's identity
    /// and date so the cursor stays exact, and stage it as skipped instead of
    /// refusing the whole page and every page behind it.
    let body: String?
    let sender: String
    let dateText: String
    let fields = line.split(separator: "|", omittingEmptySubsequences: false)
    if fields.count == 4 {
      guard let decodedGuid = try decodeBase64Field(fields[0], maximum: 1_024),
            let decodedDate = try decodeBase64Field(fields[3], maximum: 128) else {
        throw Failure.fieldEncoding
      }
      guid = decodedGuid
      dateText = decodedDate
      body = try decodeBase64Field(fields[1], maximum: 16 * 1_024)
      sender = try decodeBase64Field(fields[2], maximum: 1_024) ?? ""
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
    // MessageEntity has returned a blank GUID for individual real-device rows
    // even when the oldest/newest boundary rows expose one. Do not throw away
    // the whole page for that Apple metadata gap. Build a local, deterministic
    // identifier from the other immutable row fields; only its hash is ever
    // persisted. The normal GUID remains preferred whenever Apple supplies it.
    // An oversized body contributes its transport form so the identity stays
    // deterministic without holding the decoded text.
    let bodyIdentity = body ?? (fields.count == 4 ? String(fields[1]) : "")
    let stableGuid = guid.isEmpty
      ? "wafra-fallback-\(Self.hash(Data("\(dateText)\u{0}\(sender)\u{0}\(bodyIdentity)".utf8)))"
      : guid
    let instant = try date(dateText, diagnostic: true)
    let ref = try reference(guid: stableGuid, instant: instant)
    guard let body else { return PreparedRow(reference: ref, record: nil) }
    let record = WafraMessageHistoryImporter.preparedRecord(guid: stableGuid, body: body,
      sender: sender, date: instant, now: now())
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
  private func date(_ value: String, diagnostic: Bool = false) throws -> Date {
    guard let normalized = WafraMessageHistoryStore.normalizeShortcutProducedInstant(value, now: now()) else {
      if diagnostic {
        let scalarCount = value.unicodeScalars.count
        let whitespaceCount = value.unicodeScalars.filter {
          $0.value == 0x00A0 || $0.value == 0x202F || CharacterSet.whitespacesAndNewlines.contains($0)
        }.count
        let nonASCII = value.unicodeScalars.filter { $0.value > 0x7F }.count
        throw FrameRefusal(reason: "invalid-input-date bytes=\(value.utf8.count) scalars=\(scalarCount) spaces=\(whitespaceCount) nonascii=\(nonASCII)")
      }
      throw Failure.fieldDate
    }
    let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let result = f.date(from: normalized) else {
      if diagnostic { throw FrameRefusal(reason: "invalid-input-date normalized") }
      throw Failure.fieldDate
    }
    return result
  }
  private func reference(guid: String, dateText: String) throws -> WafraHistoryCursor.Reference {
    guard !guid.isEmpty, guid.utf8.count <= 1_024 else { throw Failure.invalidInput }
    let instant = try date(dateText)
    return try reference(guid: guid, instant: instant)
  }
  private func reference(guid: String, instant: Date) throws -> WafraHistoryCursor.Reference {
    guard !guid.isEmpty, guid.utf8.count <= 1_024 else { throw Failure.invalidInput }
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
    // Exclusive lower bound of the next Messages query; absent once complete.
    if let windowStart = head.checkpoint.windowStart { object["after"] = Self.utc(windowStart) }
    let bytes = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    return String(decoding: bytes, as: UTF8.self)
  }

  /// Called only by the locally authenticated Begin/Resume App Intent.
  /// A resume rotates the capability, fencing a previously suspended runner.
  public func begin(oldestGUID: String, oldestDate: String,
                    newestGUID: String, newestDate: String) throws -> String {
    try begin(oldest: try reference(guid: oldestGUID, dateText: oldestDate),
              newest: try reference(guid: newestGUID, dateText: newestDate))
  }
  /// Typed-date variant. Shortcuts hands the Message `date` property to a
  /// `Date` App Intent parameter exactly (the binding the legacy per-message
  /// graph proved on-device), so no Shortcuts date formatting is parsed here.
  public func begin(oldestGUID: String, oldestInstant: Date,
                    newestGUID: String, newestInstant: Date) throws -> String {
    try begin(oldest: try reference(guid: oldestGUID, instant: oldestInstant),
              newest: try reference(guid: newestGUID, instant: newestInstant))
  }
  private func begin(oldest: WafraHistoryCursor.Reference,
                     newest: WafraHistoryCursor.Reference) throws -> String {
    return try locked { directory in
      // Every run starts its page from an empty row buffer.
      try clearRowBuffers(directory)
      var head: Head
      if FileManager.default.fileExists(atPath: directory.appendingPathComponent("head.json").path) {
        head = try load(directory)
        guard head.checkpoint.oldest == oldest else { throw Failure.sourceChanged }
        // Sessions saved before windows existed resume with a window.
        if head.checkpoint.windowStart == nil { head.checkpoint = WafraHistoryCursor.windowed(head.checkpoint) }
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

  /// Typed rows for the page at `revision`; the file name carries the revision
  /// so a buffer left behind by an interrupted commit can never be mistaken
  /// for the next page's rows.
  static func rowsFile(_ revision: Int) -> String { "rows-\(revision).txt" }
  static let rowRefusalFile = "row-refusal.txt"
  static let maximumRowBufferBytes = 6 * 1024 * 1024
  /// One typed row of the current page, staged by the per-message App Intent.
  /// The date arrives as an exact `Date`, never as Shortcuts-formatted text.
  /// Rows are buffered in the framed form `stage` already validates so the
  /// commit reuses every cursor, size and journal rule unchanged. A row whose
  /// GUID was already staged for this page is ignored, so a Shortcut retry of
  /// the same page cannot double-count. Returns a JSON status. Any refusal is
  /// remembered so the page commit can name it: the Shortcut ignores per-row
  /// results and only sees the commit's alert.
  public func stageRow(sessionId: String, authorizationSecret: String, revision: Int,
                       guid: String, body: String, sender: String, instant: Date) throws -> String {
    do {
      return try stageRowUnrecorded(sessionId: sessionId, authorizationSecret: authorizationSecret,
        revision: revision, guid: guid, body: body, sender: sender, instant: instant)
    } catch {
      let reason: String
      if let error = error as? Failure { reason = error.rawValue }
      else if let error = error as? FrameRefusal { reason = error.reason }
      else if let error = error as? WafraHistoryCursor.Failure { reason = error.rawValue }
      else { reason = "storage-or-device-interruption" }
      try? locked { directory in
        try write(Data(reason.utf8), to: directory.appendingPathComponent(Self.rowRefusalFile))
      }
      throw error
    }
  }
  private func stageRowUnrecorded(sessionId: String, authorizationSecret: String, revision: Int,
                                  guid: String, body: String, sender: String, instant: Date) throws -> String {
    guard Self.validSession(sessionId), revision >= 0, guid.utf8.count <= 1_024,
          body.utf8.count <= 1024 * 1024, sender.utf8.count <= 64 * 1024,
          let secret = Data(base64Encoded: authorizationSecret), secret.count == 32,
          secret.base64EncodedString() == authorizationSecret else { throw Failure.invalidInput }
    let milliseconds = Int64((instant.timeIntervalSince1970 * 1_000).rounded())
    guard milliseconds > 0 else { throw Failure.fieldDate }
    let dateText = Self.utc(milliseconds)
    // MessageEntity returns a blank GUID for some real-device rows. Use the
    // same deterministic local identity `preparedRow` derives from the framed
    // fields, so the row is neither dropped nor counted twice.
    let senderIdentity = sender.utf8.count <= 1_024 ? sender : ""
    let bodyIdentity = body.utf8.count <= 16 * 1_024 ? body : Data(body.utf8).base64EncodedString()
    let stableGuid = guid.isEmpty
      ? "wafra-fallback-\(Self.hash(Data("\(dateText)\u{0}\(senderIdentity)\u{0}\(bodyIdentity)".utf8)))"
      : guid
    let encodedGuid = Data(stableGuid.utf8).base64EncodedString()
    let line = [encodedGuid, Data(body.utf8).base64EncodedString(),
                Data(sender.utf8).base64EncodedString(),
                Data(dateText.utf8).base64EncodedString()].joined(separator: "|")
    return try locked { directory in
      let head = try load(directory)
      guard head.sessionId == sessionId, head.tokenHash == Self.hash(secret) else {
        throw Failure.unauthorized
      }
      // The page this row belongs to was already committed; the runner's
      // request is one revision behind and will be refreshed by its commit.
      if revision == head.checkpoint.revision - 1 { return try Self.rowStatus(staged: 0, stale: true) }
      guard revision == head.checkpoint.revision else { throw Failure.staleRequest }
      var lines = try stagedRows(directory, revision: revision)
      if lines.contains(where: { $0.hasPrefix(encodedGuid + "|") }) {
        return try Self.rowStatus(staged: lines.count, stale: false)
      }
      guard lines.count < WafraHistoryCursor.maximumLimit else {
        throw FrameRefusal(reason: "invalid-input-rows staged=\(lines.count) limit=\(WafraHistoryCursor.maximumLimit)")
      }
      let bytes = lines.reduce(0) { $0 + $1.utf8.count + 1 } + line.utf8.count
      guard bytes <= Self.maximumRowBufferBytes else {
        throw FrameRefusal(reason: "invalid-input-rows-bytes staged=\(lines.count) bytes=\(bytes)")
      }
      lines.append(line)
      try write(Data(lines.joined(separator: "\n").utf8), to: directory.appendingPathComponent(Self.rowsFile(revision)))
      return try Self.rowStatus(staged: lines.count, stale: false)
    }
  }
  /// Commits the rows staged for the current page as one bounded page.
  /// `found` is Shortcuts' own count of the Messages query, so a dropped or
  /// duplicated row is refused before any cursor arithmetic.
  public func commitRows(sessionId: String, authorizationSecret: String,
                         revision: Int, found: Int) throws -> String {
    guard Self.validSession(sessionId), revision >= 0, found >= 0,
          found <= WafraHistoryCursor.maximumLimit,
          let secret = Data(base64Encoded: authorizationSecret), secret.count == 32,
          secret.base64EncodedString() == authorizationSecret else { throw Failure.invalidInput }
    let frame: String? = try locked { directory in
      let head = try load(directory)
      guard head.sessionId == sessionId, head.tokenHash == Self.hash(secret) else {
        throw Failure.unauthorized
      }
      if revision == head.checkpoint.revision - 1 { return nil }
      guard revision == head.checkpoint.revision else { throw Failure.staleRequest }
      let lines = try stagedRows(directory, revision: revision)
      guard lines.count == found else {
        var reason = "invalid-input-rows staged=\(lines.count) found=\(found)"
        let refusal = directory.appendingPathComponent(Self.rowRefusalFile)
        if FileManager.default.fileExists(atPath: refusal.path),
           let last = try? String(decoding: read(refusal, maximum: 1_024), as: UTF8.self) {
          reason += " last-row=\(last)"
        }
        throw FrameRefusal(reason: reason)
      }
      return lines.joined(separator: "\n")
    }
    guard let frame else {
      // Lost acknowledgement of an already committed page: answer with the
      // current cursor without advancing.
      return try locked { directory in try response(try load(directory), token: authorizationSecret) }
    }
    let result = try stage(sessionId: sessionId, authorizationSecret: authorizationSecret,
                           revision: revision, found: found, frame: frame)
    try locked { directory in try clearRowBuffers(directory) }
    return result
  }
  private func stagedRows(_ directory: URL, revision: Int) throws -> [String] {
    let url = directory.appendingPathComponent(Self.rowsFile(revision))
    guard FileManager.default.fileExists(atPath: url.path) else { return [] }
    let text = String(decoding: try read(url, maximum: 8 * 1024 * 1024), as: UTF8.self)
    return text.split(separator: "\n", omittingEmptySubsequences: true).map(String.init)
  }
  private func clearRowBuffers(_ directory: URL) throws {
    for entry in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
      where entry.lastPathComponent.hasPrefix("rows-") || entry.lastPathComponent == Self.rowRefusalFile {
      try FileManager.default.removeItem(at: entry)
    }
  }
  private static func rowStatus(staged: Int, stale: Bool) throws -> String {
    let object: [String: Any] = ["status": stale ? "stale" : "staged", "rows": staged]
    let bytes = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    return String(decoding: bytes, as: UTF8.self)
  }

  /// Each line is an unwrapped base64 JSON object produced by Shortcuts.
  /// Scalar framing avoids Apple's entity-property-array binding bug.
  public func stage(sessionId: String, authorizationSecret: String,
                    revision: Int, found: Int, frame: String) throws -> String {
    guard Self.validSession(sessionId), frame.utf8.count <= 8 * 1024 * 1024,
          revision >= 0, found >= 0, found <= WafraHistoryCursor.maximumLimit,
          // An empty page is only the empty-window case; a text frame with 0 found is malformed.
          found > 0 || frame.isEmpty,
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
      let framedRecords = try Self.frameRecords(frame, found: found)
      var prepared: [PreparedRow] = []
      for framedRecord in framedRecords {
        prepared.append(try preparedRow(Substring(framedRecord)))
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

  /// Splits the transported frame into one record per Message.
  ///
  /// The producer joins records with newlines, but the transport has shown
  /// CRLF, trailing newlines and, on a real iPhone, Base64 fields wrapped
  /// onto several lines even with Base64 Encode's line breaks set to none
  /// (build 135 refused its first page with a line count that disagreed with
  /// the 51 Messages found). Base64 and the producer's `|` separators contain
  /// no whitespace, so whitespace can only ever split a record into
  /// fragments: a record is complete exactly when its three separators have
  /// been seen. Records that run together without any separator, or a
  /// dangling partial record, are refused with the observed counts.
  static func frameRecords(_ frame: String, found: Int) throws -> [String] {
    let fragments = frame.split(omittingEmptySubsequences: true, whereSeparator: { $0.isWhitespace || $0.isNewline })
    // The first beta graph carried one Base64 JSON object per line and no
    // separators; its reader is kept only for that exact shape.
    if fragments.count == found, fragments.allSatisfy({ !$0.contains("|" as Character) }) {
      return fragments.map(String.init)
    }
    var records: [String] = []
    var current = ""
    var pipes = 0
    var separators = 0
    for fragment in fragments {
      let count = fragment.reduce(0) { $1 == "|" ? $0 + 1 : $0 }
      separators += count
      current += fragment
      pipes += count
      if pipes == 3 {
        records.append(current)
        current = ""
        pipes = 0
      } else if pipes > 3 {
        throw FrameRefusal(reason: "invalid-input-lines merged fragments=\(fragments.count) separators=\(separators) found=\(found)")
      }
    }
    guard current.isEmpty, records.count == found else {
      throw FrameRefusal(reason: "invalid-input-lines fragments=\(fragments.count) separators=\(separators) records=\(records.count) partial=\(current.isEmpty ? 0 : 1) found=\(found)")
    }
    return records
  }

  /// Column framing: the Shortcut builds one string per field for the whole
  /// page with list-wide Apple actions instead of a per-message loop. The
  /// columns are rebuilt into the line frame that `stage` already validates,
  /// so every cursor, journal, retry and record rule applies unchanged. All
  /// four columns must line up exactly with the page count; a body containing
  /// the sentinel or a dropped nil property therefore refuses the page as
  /// `frame-columns` rather than committing misaligned records. That includes
  /// the sender column: the sender is the bank identity downstream, and a page
  /// of alerts with no sender would import "successfully" as unattributable
  /// rows, so the producer's per-message fallback handles such a page instead.
  public func stageColumns(sessionId: String, authorizationSecret: String, revision: Int, found: Int,
                           guids: String, bodies: String, senders: String, dates: String) throws -> String {
    // Bound each column by what `found` records may legitimately carry before
    // anything is split or Base64-inflated; `stage` re-checks the frame.
    let separators = max(found - 1, 0)
    guard found > 0, found <= WafraHistoryCursor.maximumLimit,
          guids.utf8.count <= found * 1_024 + separators * 3,
          bodies.utf8.count <= found * 16 * 1_024 + separators * 3,
          senders.utf8.count <= found * 1_024 + separators * 3,
          dates.utf8.count <= found * 128 + separators * 3 else {
      throw Failure.invalidInput
    }
    func column(_ value: String) -> [Substring] {
      value.split(separator: Self.columnSeparator, omittingEmptySubsequences: false)
    }
    let guidColumn = column(guids)
    let bodyColumn = column(bodies)
    let senderColumn = column(senders)
    let dateColumn = column(dates)
    guard guidColumn.count == found, bodyColumn.count == found,
          senderColumn.count == found, dateColumn.count == found else {
      throw Failure.columnMismatch
    }
    let lines = (0..<found).map { index in
      [guidColumn[index], bodyColumn[index], senderColumn[index], dateColumn[index]]
        .map { Data($0.utf8).base64EncodedString() }
        .joined(separator: "|")
    }
    return try stage(sessionId: sessionId, authorizationSecret: authorizationSecret,
                     revision: revision, found: found, frame: lines.joined(separator: "\n"))
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
