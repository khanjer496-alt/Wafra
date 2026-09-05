import Foundation

#if canImport(Darwin)
import Darwin
#endif

public final class WafraPreparedHistoryStore {
  public static let shared = WafraPreparedHistoryStore()

  public static let sessionTTL: TimeInterval = 3 * 60 * 60
  public static let maxStoredSessions = WafraMessageHistoryStore.maxStoredSessions
  public static let maxSessionBytes = WafraMessageHistoryStore.maxSessionBytes
  public static let maxStoredBytes = WafraMessageHistoryStore.maxStoredBytes
  private static let queue = DispatchQueue(label: "app.wafra.prepared-history-store")
  private static let sessionIdentifier = try! NSRegularExpression(
    pattern: "^[A-Za-z0-9_-]{8,128}$"
  )
  private static let eraseMarkerName = ".erase-in-progress"

  private struct Manifest: Codable {
    let createdAt: Date
    let expiresAt: Date
    let found: Int
    var nextPosition: Int
    var storedBytes: Int
  }

  private struct Envelope: Codable {
    let position: Int
    let record: String
  }

  private let configuredRoot: URL?
  private let nowProvider: () -> Date
  private let configuredMaxSessionBytes: Int
  private let configuredMaxStoredBytes: Int
  private let removeItemHandler: (URL) throws -> Void

  public init(root: URL? = nil, now: @escaping () -> Date = Date.init) {
    self.configuredRoot = root
    self.nowProvider = now
    self.configuredMaxSessionBytes = Self.maxSessionBytes
    self.configuredMaxStoredBytes = Self.maxStoredBytes
    self.removeItemHandler = { try FileManager.default.removeItem(at: $0) }
  }

  init(
    root: URL?,
    now: @escaping () -> Date,
    maxSessionBytes: Int,
    maxStoredBytes: Int,
    removeItem: @escaping (URL) throws -> Void = { try FileManager.default.removeItem(at: $0) }
  ) {
    self.configuredRoot = root
    self.nowProvider = now
    self.configuredMaxSessionBytes = maxSessionBytes
    self.configuredMaxStoredBytes = maxStoredBytes
    self.removeItemHandler = removeItem
  }

  public func prepare(
    sessionId: String,
    found: Int,
    position: Int,
    guid: String?,
    body: String?,
    sender: String? = nil,
    date: Date?
  ) throws {
    guard found > 0, found <= WafraMessageHistoryStore.maxSessionRecords else {
      throw StoreError.invalidFound
    }
    guard position > 0, position <= found else { throw StoreError.invalidPosition }
    try prepareRecord(
      sessionId: sessionId,
      declaredFound: found,
      position: position,
      rangeStart: nil,
      rangeEnd: nil,
      guid: guid,
      body: body,
      sender: sender,
      date: date
    )
  }

  public func prepareV2(
    sessionId: String,
    position: Int,
    rangeStart: Date,
    rangeEnd: Date,
    guid: String?,
    body: String?,
    sender: String? = nil,
    date: Date?
  ) throws {
    guard
      position > 0,
      position <= WafraMessageHistoryStore.maxSessionRecords
    else { throw StoreError.invalidPosition }
    try prepareRecord(
      sessionId: sessionId,
      declaredFound: 0,
      position: position,
      rangeStart: rangeStart,
      rangeEnd: rangeEnd,
      guid: guid,
      body: body,
      sender: sender,
      date: date
    )
  }

  public func prepareV3(
    sessionId: String,
    position: Int,
    guid: String?,
    body: String?,
    sender: String? = nil,
    date: Date?
  ) throws {
    guard
      position > 0,
      position <= WafraMessageHistoryStore.maxSessionRecords
    else { throw StoreError.invalidPosition }
    try prepareRecord(
      sessionId: sessionId,
      declaredFound: 0,
      position: position,
      rangeStart: nil,
      rangeEnd: nil,
      guid: guid,
      body: body,
      sender: sender,
      date: date
    )
  }

  private func prepareRecord(
    sessionId: String,
    declaredFound: Int,
    position: Int,
    rangeStart: Date?,
    rangeEnd: Date?,
    guid: String?,
    body: String?,
    sender: String?,
    date: Date?
  ) throws {
    let invocationNow = nowProvider()
    let record: String
    if let rangeStart, let rangeEnd {
      record = WafraMessageHistoryImporter.preparedRecordV2(
        guid: guid,
        body: body,
        sender: sender,
        date: date,
        rangeStart: rangeStart,
        rangeEnd: rangeEnd,
        now: invocationNow
      )
    } else {
      record = WafraMessageHistoryImporter.preparedRecord(
        guid: guid,
        body: body,
        sender: sender,
        date: date,
        now: invocationNow
      )
    }
    guard Data(record.utf8).count <= WafraMessageHistoryStore.maxRecordBytes else {
      throw StoreError.storageFailure
    }
    try coordinated(operation: "prepare") { root in
      guard Self.validSessionId(sessionId) else { throw StoreError.invalidSession }
      _ = try cleanupExpired(root: root, now: invocationNow)

      let directory = root.appendingPathComponent(sessionId, isDirectory: true)
      let existed = FileManager.default.fileExists(atPath: directory.path)
      let usage = try storageUsage(root: root)
      var manifest: Manifest
      if existed {
        try validateProtectedDirectory(directory)
        manifest = try loadManifest(directory)
      } else {
        guard position == 1 else { throw StoreError.noncontiguousPosition }
        guard usage.sessions < Self.maxStoredSessions else {
          throw StoreError.globalSessionLimit
        }
        manifest = Manifest(
          createdAt: invocationNow,
          expiresAt: invocationNow.addingTimeInterval(Self.sessionTTL),
          found: declaredFound,
          nextPosition: 1,
          storedBytes: 0
        )
      }

      guard manifest.found == declaredFound else {
        _ = try? invalidateAndDelete(root: root, directory: directory)
        throw StoreError.countMismatch
      }
      if position < manifest.nextPosition {
        let existing = try loadEnvelope(directory, position: position)
        guard existing.record == record else {
          _ = try? invalidateAndDelete(root: root, directory: directory)
          throw StoreError.retryConflict
        }
        return
      }
      guard position == manifest.nextPosition else {
        _ = try? invalidateAndDelete(root: root, directory: directory)
        throw StoreError.noncontiguousPosition
      }

      let envelope = Envelope(position: position, record: record)
      let recordData = try encode(envelope)
      guard recordData.count <= WafraMessageHistoryStore.maxRecordBytes else {
        throw StoreError.storageFailure
      }
      guard
        let projectedSessionBytes = Self.safeAdd(manifest.storedBytes, recordData.count),
        projectedSessionBytes <= configuredMaxSessionBytes
      else {
        if existed { _ = try? invalidateAndDelete(root: root, directory: directory) }
        throw StoreError.sessionByteLimit
      }
      manifest.nextPosition += 1
      manifest.storedBytes = projectedSessionBytes
      let manifestData = try encode(manifest)
      let replacedManifestBytes: Int
      if existed {
        replacedManifestBytes = try protectedRegularFileSize(manifestURL(directory))
      } else {
        replacedManifestBytes = 0
      }
      guard
        let withoutOldManifest = Self.safeSubtract(usage.bytes, replacedManifestBytes),
        let withRecord = Self.safeAdd(withoutOldManifest, recordData.count),
        let projectedGlobalBytes = Self.safeAdd(withRecord, manifestData.count),
        projectedGlobalBytes <= configuredMaxStoredBytes
      else {
        throw StoreError.globalByteLimit
      }

      do {
        if !existed { try createProtectedDirectory(directory) }
        let destination = recordURL(directory, position: position)
        guard !FileManager.default.fileExists(atPath: destination.path) else {
          throw StoreError.storageFailure
        }
        try writeProtected(recordData, to: destination)
        try writeProtected(manifestData, to: manifestURL(directory))
      } catch {
        _ = try? invalidateAndDelete(root: root, directory: directory)
        throw error
      }
    }
  }

  func consumePreparedChunks<T>(
    sessionId: String,
    found: Int,
    _ body: (_ nextChunk: () throws -> [String]?) throws -> T
  ) throws -> T {
    try coordinated(operation: "consume") { root in
      guard Self.validSessionId(sessionId) else { throw StoreError.invalidSession }
      guard found > 0, found <= WafraMessageHistoryStore.maxSessionRecords else {
        throw StoreError.invalidFound
      }
      _ = try cleanupExpired(root: root, now: nowProvider())
      let directory = root.appendingPathComponent(sessionId, isDirectory: true)
      guard FileManager.default.fileExists(atPath: directory.path) else {
        throw StoreError.sessionUnavailable
      }

      do {
        let manifest = try loadManifest(directory)
        guard manifest.found == found else { throw StoreError.countMismatch }
        guard manifest.nextPosition == found + 1 else { throw StoreError.incompleteSession }
        try verifyExactFiles(directory, manifest: manifest, recordCount: found)

        var nextPosition = 1
        let result = try body {
          guard nextPosition <= found else { return nil }
          let end = min(
            nextPosition + WafraMessageHistoryStore.maxChunkRecords,
            found + 1
          )
          let records = try (nextPosition..<end).map {
            try self.loadEnvelope(directory, position: $0).record
          }
          nextPosition = end
          return records
        }
        guard try invalidateAndDelete(root: root, directory: directory) else {
          throw StoreError.cleanupFailure
        }
        return result
      } catch {
        _ = try? invalidateAndDelete(root: root, directory: directory)
        throw error
      }
    }
  }

  func consumePreparedChunksV2<T>(
    sessionId: String,
    _ body: (
      _ found: Int,
      _ nextChunk: () throws -> [String]?
    ) throws -> T
  ) throws -> T {
    try coordinated(operation: "consume-v2") { root in
      guard Self.validSessionId(sessionId) else { throw StoreError.invalidSession }
      _ = try cleanupExpired(root: root, now: nowProvider())
      let directory = root.appendingPathComponent(sessionId, isDirectory: true)
      guard FileManager.default.fileExists(atPath: directory.path) else {
        throw StoreError.sessionUnavailable
      }

      do {
        let manifest = try loadManifest(directory)
        guard manifest.found == 0 else { throw StoreError.countMismatch }
        let found = manifest.nextPosition - 1
        guard
          found > 0,
          found <= WafraMessageHistoryStore.maxSessionRecords
        else { throw StoreError.invalidFound }
        try verifyExactFiles(directory, manifest: manifest, recordCount: found)

        var nextPosition = 1
        let result = try body(found) {
          guard nextPosition <= found else { return nil }
          let end = min(
            nextPosition + WafraMessageHistoryStore.maxChunkRecords,
            found + 1
          )
          let records = try (nextPosition..<end).map {
            try self.loadEnvelope(directory, position: $0).record
          }
          nextPosition = end
          return records
        }
        guard try invalidateAndDelete(root: root, directory: directory) else {
          throw StoreError.cleanupFailure
        }
        return result
      } catch {
        _ = try? invalidateAndDelete(root: root, directory: directory)
        throw error
      }
    }
  }

  @discardableResult
  public func purgeExpired(now: Date) throws -> Int {
    try coordinated(operation: "purge") { root in
      try cleanupExpired(root: root, now: now)
    }
  }

  public func discardPrepared(sessionId: String) throws {
    guard Self.validSessionId(sessionId) else { return }
    try coordinated(operation: "discard") { root in
      let directory = root.appendingPathComponent(sessionId, isDirectory: true)
      guard FileManager.default.fileExists(atPath: directory.path) else { return }
      guard try invalidateAndDelete(root: root, directory: directory) else {
        throw StoreError.cleanupFailure
      }
    }
  }

  public func eraseAll() throws {
    try coordinated(operation: "erase") { root in
      try beginEraseIfNeeded(root: root)
      try completePendingErase(root: root)
    }
  }

  private func coordinated<T>(
    operation: String,
    _ body: (URL) throws -> T
  ) throws -> T {
    do {
      return try Self.queue.sync {
        let root = try rootDirectory()
        let lockURL = root.appendingPathComponent(".lock")
        let descriptor = Darwin.open(
          lockURL.path,
          O_CREAT | O_RDWR | O_NOFOLLOW | O_CLOEXEC,
          S_IRUSR | S_IWUSR
        )
        guard descriptor >= 0 else { throw StoreError.storageFailure }
        defer { Darwin.close(descriptor) }
        var status = stat()
        guard
          fstat(descriptor, &status) == 0,
          (status.st_mode & S_IFMT) == S_IFREG,
          status.st_nlink == 1,
          fchmod(descriptor, S_IRUSR | S_IWUSR) == 0
        else { throw StoreError.storageFailure }
        guard flock(descriptor, LOCK_EX) == 0 else { throw StoreError.storageFailure }
        defer { flock(descriptor, LOCK_UN) }
        try FileManager.default.setAttributes(
          [
            .protectionKey: FileProtectionType.complete,
            .posixPermissions: 0o600,
          ],
          ofItemAtPath: lockURL.path
        )
        if
          operation != "erase",
          FileManager.default.fileExists(atPath: eraseMarkerURL(root: root).path)
        {
          try completePendingErase(root: root)
        }
        return try body(root)
      }
    } catch let error as StoreError {
      throw error
    } catch {
      throw StoreError.storageFailure
    }
  }

  private func rootDirectory() throws -> URL {
    let root: URL
    if let configuredRoot {
      root = configuredRoot
    } else {
      let base = try FileManager.default.url(
        for: .applicationSupportDirectory,
        in: .userDomainMask,
        appropriateFor: nil,
        create: true
      )
      root = base.appendingPathComponent("WafraPreparedMessageHistory", isDirectory: true)
    }
    try createProtectedDirectory(root)
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    var mutableRoot = root
    try mutableRoot.setResourceValues(values)
    return root
  }

  private func createProtectedDirectory(_ url: URL) throws {
    if FileManager.default.fileExists(atPath: url.path) {
      let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
      guard attributes[.type] as? FileAttributeType == .typeDirectory else {
        throw StoreError.storageFailure
      }
    } else {
      try FileManager.default.createDirectory(
        at: url,
        withIntermediateDirectories: true,
        attributes: [
          .protectionKey: FileProtectionType.complete,
          .posixPermissions: 0o700,
        ]
      )
    }
    try FileManager.default.setAttributes(
      [
        .protectionKey: FileProtectionType.complete,
        .posixPermissions: 0o700,
      ],
      ofItemAtPath: url.path
    )
    try validateProtectedDirectory(url)
  }

  private func writeProtected(_ data: Data, to url: URL) throws {
    try data.write(to: url, options: [.atomic, .completeFileProtection])
    try FileManager.default.setAttributes(
      [
        .protectionKey: FileProtectionType.complete,
        .posixPermissions: 0o600,
      ],
      ofItemAtPath: url.path
    )
    _ = try protectedRegularFileSize(url)
  }

  private func encode<T: Encodable>(_ value: T) throws -> Data {
    let encoder = PropertyListEncoder()
    encoder.outputFormat = .binary
    return try encoder.encode(value)
  }

  private func loadManifest(_ directory: URL) throws -> Manifest {
    try validateProtectedDirectory(directory)
    let url = manifestURL(directory)
    let size = try protectedRegularFileSize(url)
    guard size > 0, size <= 16 * 1024 else { throw StoreError.storageFailure }
    let manifest = try PropertyListDecoder().decode(
      Manifest.self,
      from: Data(contentsOf: url, options: [.mappedIfSafe])
    )
    let maximumNextPosition = manifest.found == 0
      ? WafraMessageHistoryStore.maxSessionRecords + 1
      : manifest.found + 1
    guard
      manifest.createdAt.timeIntervalSince1970.isFinite,
      manifest.expiresAt.timeIntervalSince1970.isFinite,
      manifest.found >= 0,
      manifest.found <= WafraMessageHistoryStore.maxSessionRecords,
      manifest.nextPosition > 0,
      manifest.nextPosition <= maximumNextPosition,
      manifest.storedBytes >= 0,
      manifest.storedBytes <= configuredMaxSessionBytes,
      manifest.expiresAt.timeIntervalSince(manifest.createdAt) == Self.sessionTTL
    else { throw StoreError.storageFailure }
    return manifest
  }

  private func loadEnvelope(_ directory: URL, position: Int) throws -> Envelope {
    let url = recordURL(directory, position: position)
    let size = try protectedRegularFileSize(url)
    guard size > 0, size <= WafraMessageHistoryStore.maxRecordBytes else {
      throw StoreError.storageFailure
    }
    let envelope = try PropertyListDecoder().decode(
      Envelope.self,
      from: Data(contentsOf: url, options: [.mappedIfSafe])
    )
    guard
      envelope.position == position,
      WafraMessageHistoryImporter.isCanonicalPreparedRecord(
        envelope.record,
        now: nowProvider()
      )
    else { throw StoreError.storageFailure }
    return envelope
  }

  private func verifyExactFiles(
    _ directory: URL,
    manifest: Manifest,
    recordCount: Int
  ) throws {
    guard
      recordCount > 0,
      recordCount <= WafraMessageHistoryStore.maxSessionRecords,
      manifest.nextPosition == recordCount + 1
    else { throw StoreError.incompleteSession }
    let actual = try Set(FileManager.default.contentsOfDirectory(atPath: directory.path))
    var expected = Set(["manifest.plist"])
    for position in 1...recordCount {
      expected.insert(recordURL(directory, position: position).lastPathComponent)
    }
    guard actual == expected else { throw StoreError.incompleteSession }

    var storedBytes = 0
    for position in 1...recordCount {
      let url = recordURL(directory, position: position)
      _ = try loadEnvelope(directory, position: position)
      guard let next = Self.safeAdd(storedBytes, try protectedRegularFileSize(url)) else {
        throw StoreError.storageFailure
      }
      storedBytes = next
    }
    guard storedBytes == manifest.storedBytes else { throw StoreError.storageFailure }
  }

  private func validateProtectedDirectory(_ url: URL) throws {
    let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
    guard
      attributes[.type] as? FileAttributeType == .typeDirectory,
      attributes[.protectionKey] as? FileProtectionType == .complete,
      (attributes[.posixPermissions] as? NSNumber)?.intValue == 0o700
    else { throw StoreError.storageFailure }
  }

  private func protectedRegularFileSize(_ url: URL) throws -> Int {
    let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
    guard
      attributes[.type] as? FileAttributeType == .typeRegular,
      (attributes[.referenceCount] as? NSNumber)?.intValue == 1,
      attributes[.protectionKey] as? FileProtectionType == .complete,
      (attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600,
      let size = attributes[.size] as? NSNumber,
      size.intValue >= 0
    else { throw StoreError.storageFailure }
    return size.intValue
  }

  private func cleanupExpired(root: URL, now: Date) throws -> Int {
    let entries = try FileManager.default.contentsOfDirectory(
      at: root,
      includingPropertiesForKeys: [.isDirectoryKey]
    )
    var removed = 0
    for entry in entries {
      let values = try entry.resourceValues(forKeys: [.isDirectoryKey])
      guard values.isDirectory == true else { continue }
      if entry.lastPathComponent.hasPrefix(".invalid-") {
        try? removeItemHandler(entry)
        continue
      }
      guard let manifest = try? loadManifest(entry) else {
        _ = try? invalidateAndDelete(root: root, directory: entry)
        continue
      }
      if now >= manifest.expiresAt {
        if try invalidateAndDelete(root: root, directory: entry) { removed += 1 }
      }
    }
    return removed
  }

  private func invalidateAndDelete(root: URL, directory: URL) throws -> Bool {
    guard FileManager.default.fileExists(atPath: directory.path) else { return true }
    let tombstone = try durablyInvalidate(root: root, directory: directory)
    do {
      try removeItemHandler(tombstone)
      return true
    } catch {
      return false
    }
  }

  private func durablyInvalidate(root: URL, directory: URL) throws -> URL {
    if directory.lastPathComponent.hasPrefix(".invalid-") { return directory }
    let tombstone = root.appendingPathComponent(
      ".invalid-\(UUID().uuidString)",
      isDirectory: true
    )
    do {
      try FileManager.default.moveItem(at: directory, to: tombstone)
      return tombstone
    } catch {
      throw StoreError.storageFailure
    }
  }

  private func storageUsage(root: URL) throws -> (sessions: Int, bytes: Int) {
    let entries = try FileManager.default.contentsOfDirectory(
      at: root,
      includingPropertiesForKeys: [.isDirectoryKey]
    )
    var sessions = 0
    var bytes = 0
    for entry in entries {
      let attributes = try FileManager.default.attributesOfItem(atPath: entry.path)
      guard attributes[.type] as? FileAttributeType == .typeDirectory else { continue }
      let manifest = try loadManifest(entry)
      let manifestBytes = try protectedRegularFileSize(manifestURL(entry))
      guard
        let sessionBytes = Self.safeAdd(manifest.storedBytes, manifestBytes),
        let nextBytes = Self.safeAdd(bytes, sessionBytes)
      else { throw StoreError.storageFailure }
      sessions += 1
      bytes = nextBytes
    }
    return (sessions, bytes)
  }

  private func manifestURL(_ directory: URL) -> URL {
    directory.appendingPathComponent("manifest.plist")
  }

  private func recordURL(_ directory: URL, position: Int) -> URL {
    directory.appendingPathComponent(String(format: "record-%05d.plist", position))
  }

  private func eraseMarkerURL(root: URL) -> URL {
    root.appendingPathComponent(Self.eraseMarkerName)
  }

  private func beginEraseIfNeeded(root: URL) throws {
    let marker = eraseMarkerURL(root: root)
    if FileManager.default.fileExists(atPath: marker.path) {
      guard try protectedRegularFileSize(marker) == 1 else {
        throw StoreError.storageFailure
      }
      return
    }
    try writeProtected(Data([1]), to: marker)
  }

  private func completePendingErase(root: URL) throws {
    let marker = eraseMarkerURL(root: root)
    guard
      FileManager.default.fileExists(atPath: marker.path),
      try protectedRegularFileSize(marker) == 1
    else { throw StoreError.storageFailure }

    var deletionCandidates = try tombstoneDirectories(root: root)
    for directory in try sessionDirectories(root: root) {
      deletionCandidates.append(
        try durablyInvalidate(root: root, directory: directory)
      )
    }

    var attempted = Set<String>()
    for directory in deletionCandidates where attempted.insert(directory.path).inserted {
      guard FileManager.default.fileExists(atPath: directory.path) else { continue }
      try? removeItemHandler(directory)
    }

    guard
      try sessionDirectories(root: root).isEmpty,
      try tombstoneDirectories(root: root).isEmpty
    else { throw StoreError.cleanupFailure }

    do {
      try removeItemHandler(marker)
    } catch {
      throw StoreError.cleanupFailure
    }
    guard !FileManager.default.fileExists(atPath: marker.path) else {
      throw StoreError.cleanupFailure
    }
  }

  private func sessionDirectories(root: URL) throws -> [URL] {
    try directories(root: root) { !$0.hasPrefix(".invalid-") }
  }

  private func tombstoneDirectories(root: URL) throws -> [URL] {
    try directories(root: root) { $0.hasPrefix(".invalid-") }
  }

  private func directories(
    root: URL,
    matching predicate: (String) -> Bool
  ) throws -> [URL] {
    let entries = try FileManager.default.contentsOfDirectory(
      at: root,
      includingPropertiesForKeys: [.isDirectoryKey]
    )
    var result: [URL] = []
    for entry in entries where predicate(entry.lastPathComponent) {
      let values = try entry.resourceValues(forKeys: [.isDirectoryKey])
      if values.isDirectory == true { result.append(entry) }
    }
    return result
  }

  private static func validSessionId(_ value: String) -> Bool {
    sessionIdentifier.firstMatch(
      in: value,
      range: NSRange(value.startIndex..., in: value)
    ) != nil
  }

  private static func safeAdd(_ lhs: Int, _ rhs: Int) -> Int? {
    let (result, overflow) = lhs.addingReportingOverflow(rhs)
    return overflow ? nil : result
  }

  private static func safeSubtract(_ lhs: Int, _ rhs: Int) -> Int? {
    let (result, overflow) = lhs.subtractingReportingOverflow(rhs)
    return overflow || result < 0 ? nil : result
  }

  public enum StoreError: Error, Equatable {
    case invalidSession
    case invalidFound
    case invalidPosition
    case noncontiguousPosition
    case countMismatch
    case retryConflict
    case incompleteSession
    case sessionUnavailable
    case sessionByteLimit
    case globalSessionLimit
    case globalByteLimit
    case cleanupFailure
    case storageFailure
  }
}

struct WafraHistoryCleanupCoordinator {
  enum CleanupError: Error, Equatable {
    case cleanupFailure
  }

  static let shared = WafraHistoryCleanupCoordinator(
    discardCompleted: {
      try WafraMessageHistoryStore.shared.discardSession(sessionId: $0)
    },
    discardPrepared: {
      try WafraPreparedHistoryStore.shared.discardPrepared(sessionId: $0)
    },
    purgeCompleted: {
      try WafraMessageHistoryStore.shared.purgeExpired(now: $0)
    },
    purgePrepared: {
      try WafraPreparedHistoryStore.shared.purgeExpired(now: $0)
    },
    eraseCompleted: {
      try WafraMessageHistoryStore.shared.eraseAll()
    },
    erasePrepared: {
      try WafraPreparedHistoryStore.shared.eraseAll()
    }
  )

  private let discardCompleted: (String) throws -> Void
  private let discardPrepared: (String) throws -> Void
  private let purgeCompleted: (Date) throws -> Int
  private let purgePrepared: (Date) throws -> Int
  private let eraseCompleted: () throws -> Void
  private let erasePrepared: () throws -> Void

  init(
    discardCompleted: @escaping (String) throws -> Void,
    discardPrepared: @escaping (String) throws -> Void,
    purgeCompleted: @escaping (Date) throws -> Int,
    purgePrepared: @escaping (Date) throws -> Int,
    eraseCompleted: @escaping () throws -> Void,
    erasePrepared: @escaping () throws -> Void
  ) {
    self.discardCompleted = discardCompleted
    self.discardPrepared = discardPrepared
    self.purgeCompleted = purgeCompleted
    self.purgePrepared = purgePrepared
    self.eraseCompleted = eraseCompleted
    self.erasePrepared = erasePrepared
  }

  func discardSession(sessionId: String) throws {
    try attemptBoth(
      { try discardCompleted(sessionId) },
      { try discardPrepared(sessionId) }
    )
  }

  func purgeExpired(now: Date) throws -> Int {
    var completedCount: Int?
    var preparedCount: Int?
    var failed = false
    do {
      completedCount = try purgeCompleted(now)
    } catch {
      failed = true
    }
    do {
      preparedCount = try purgePrepared(now)
    } catch {
      failed = true
    }
    guard
      !failed,
      let completedCount,
      let preparedCount,
      completedCount >= 0,
      preparedCount >= 0
    else { throw CleanupError.cleanupFailure }
    let (total, overflow) = completedCount.addingReportingOverflow(preparedCount)
    guard !overflow else { throw CleanupError.cleanupFailure }
    return total
  }

  func eraseAll() throws {
    try attemptBoth(eraseCompleted, erasePrepared)
  }

  private func attemptBoth(
    _ first: () throws -> Void,
    _ second: () throws -> Void
  ) throws {
    var failed = false
    do {
      try first()
    } catch {
      failed = true
    }
    do {
      try second()
    } catch {
      failed = true
    }
    if failed { throw CleanupError.cleanupFailure }
  }
}
