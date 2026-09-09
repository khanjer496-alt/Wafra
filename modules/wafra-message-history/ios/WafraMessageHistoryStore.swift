import CryptoKit
import Foundation
import Security

#if canImport(Darwin)
import Darwin
#endif

public struct WafraHistoryChunkCounts: Codable, Equatable {
  public let attempted: Int
  public let accepted: Int
  public let skipped: Int

  public init(attempted: Int, accepted: Int, skipped: Int) {
    self.attempted = attempted
    self.accepted = accepted
    self.skipped = skipped
  }
}

public struct WafraCompletedHistorySession: Codable, Equatable {
  public let chunkIndices: [Int]
  public let found: Int
  public let attempted: Int
  public let accepted: Int
  public let skipped: Int

  public init(
    chunkIndices: [Int],
    found: Int,
    attempted: Int,
    accepted: Int,
    skipped: Int
  ) {
    self.chunkIndices = chunkIndices
    self.found = found
    self.attempted = attempted
    self.accepted = accepted
    self.skipped = skipped
  }
}

public struct WafraRecoveredHistorySession: Equatable {
  public let sessionId: String
  public let chunkIndices: [Int]
  public let found: Int
  public let attempted: Int
  public let accepted: Int
  public let skipped: Int

  public init(
    sessionId: String,
    chunkIndices: [Int],
    found: Int,
    attempted: Int,
    accepted: Int,
    skipped: Int
  ) {
    self.sessionId = sessionId
    self.chunkIndices = chunkIndices
    self.found = found
    self.attempted = attempted
    self.accepted = accepted
    self.skipped = skipped
  }
}

public final class WafraMessageHistoryStore {
  public static let shared = WafraMessageHistoryStore()

  public static let maxChunkRecords = 50
  public static let maxSessionRecords = 10_000
  public static let maxTextBytes = 16 * 1024
  public static let maxRecordBytes = 128 * 1024
  public static let maxSessionBytes = 24 * 1024 * 1024
  public static let maxStoredSessions = 4
  public static let maxStoredBytes = 72 * 1024 * 1024
  public static let sessionTTL: TimeInterval = 60 * 60
  private static let maximumJSONContainerDepth = 64

  private static let queue = DispatchQueue(label: "app.wafra.message-history-store")
  private static let sessionIdentifier = try! NSRegularExpression(
    pattern: "^[A-Za-z0-9_-]{8,128}$"
  )
  private static let recordIdentifier = try! NSRegularExpression(
    pattern: "^[0-9a-f]{64}$"
  )
  private static let authorizationSecret = try! NSRegularExpression(
    pattern: "^[A-Za-z0-9_-]{43}$"
  )
  private static let eraseMarkerName = ".erase-in-progress"
  private static let utcInstant = try! NSRegularExpression(
    pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$"
  )

  // This is an explicit producer adapter, never the stored-record validator.
  private static let shortcutInstant = try! NSRegularExpression(
    pattern: #"\A([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]{3}))?(Z|[+-][0-9]{2}:[0-9]{2})\z"#
  )

  private enum RecordInputMode {
    case strictUTC
    case shortcutOffset
  }

  private enum ManifestState: String, Codable {
    case open
    case complete
    case invalid
  }

  private struct ChunkSummary: Codable {
    let contentDigest: String
    let requestAuthenticationCode: String
    let attempted: Int
    let accepted: Int
    let skipped: Int
    let serializedBytes: Int
    let recordIDs: [String]

    var counts: WafraHistoryChunkCounts {
      WafraHistoryChunkCounts(
        attempted: attempted,
        accepted: accepted,
        skipped: skipped
      )
    }
  }

  private struct SessionManifest: Codable {
    var state: ManifestState
    let createdAt: Date
    let expiresAt: Date
    var secretHash: String?
    var chunks: [String: ChunkSummary]
    var finalTotals: WafraCompletedHistorySession?
  }

  private struct StagedCandidate {
    let recordIDs: [String]
    let counts: WafraHistoryChunkCounts
    let chunkData: Data
    let requestAuthenticationCode: String
  }

  private struct ManifestTotals {
    let attempted: Int
    let accepted: Int
    let skipped: Int
    let serializedBytes: Int
  }

  private let configuredRoot: URL?
  private let nowProvider: () -> Date
  private let removeItemHandler: (URL) throws -> Void
  private let writeDataHandler: ((Data, URL) throws -> Void)?
  private let lockAcquiredHandler: ((String) -> Void)?

  public init(root: URL? = nil, now: @escaping () -> Date = Date.init) {
    self.configuredRoot = root
    self.nowProvider = now
    self.removeItemHandler = { try FileManager.default.removeItem(at: $0) }
    self.writeDataHandler = nil
    self.lockAcquiredHandler = nil
  }

  // The command-line harness compiles in the same module and uses these
  // injectable boundaries to prove failed-deletion recovery and Darwin-lock
  // contention without weakening the public store API.
  init(
    root: URL?,
    now: @escaping () -> Date,
    removeItem: @escaping (URL) throws -> Void,
    writeData: ((Data, URL) throws -> Void)?,
    lockAcquired: ((String) -> Void)?
  ) {
    self.configuredRoot = root
    self.nowProvider = now
    self.removeItemHandler = removeItem
    self.writeDataHandler = writeData
    self.lockAcquiredHandler = lockAcquired
  }

  public func beginSession(sessionId: String) throws -> String {
    try coordinated(operation: "begin") { root in
      _ = try cleanupUnlocked(root: root, at: nowProvider())
      guard Self.validSessionIdentifier(sessionId) else { throw StoreError.invalidSession }

      let directory = sessionDirectory(root: root, sessionId: sessionId)
      guard !FileManager.default.fileExists(atPath: directory.path) else {
        throw StoreError.duplicateSession
      }

      let usage = try storageUsage(root: root)
      guard usage.sessions < Self.maxStoredSessions else {
        throw StoreError.globalSessionLimit
      }

      var secretBytes = [UInt8](repeating: 0, count: 32)
      guard SecRandomCopyBytes(kSecRandomDefault, secretBytes.count, &secretBytes) == errSecSuccess else {
        throw StoreError.storageFailure
      }
      let secret = Self.encodeBase64URL(Data(secretBytes))
      let createdAt = nowProvider()
      let manifest = SessionManifest(
        state: .open,
        createdAt: createdAt,
        expiresAt: createdAt.addingTimeInterval(Self.sessionTTL),
        secretHash: Self.sha256(Data(secretBytes)),
        chunks: [:],
        finalTotals: nil
      )

      do {
        try createProtectedDirectory(directory)
        let data = try Self.encodeManifest(manifest)
        guard
          let projected = Self.safeAdd(usage.bytes, data.count),
          projected <= Self.maxStoredBytes
        else {
          throw StoreError.globalByteLimit
        }
        try writeProtected(data, to: manifestURL(directory))
        return secret
      } catch let error as StoreError {
        _ = try invalidateAndDelete(directory: directory, manifest: manifest)
        throw error
      } catch {
        _ = try invalidateAndDelete(directory: directory, manifest: manifest)
        throw StoreError.storageFailure
      }
    }
  }

  public func stageChunk(
    sessionId: String,
    authorizationSecret: String,
    chunkIndex: Int,
    records: [String]
  ) throws -> WafraHistoryChunkCounts {
    try stageRecords(sessionId: sessionId, authorizationSecret: authorizationSecret,
      chunkIndex: chunkIndex, records: records, inputMode: .strictUTC)
  }

  /// Accepts explicit ISO 8601 offsets produced by Shortcuts. Stored records
  /// remain strict v1 UTC; this does not finish or open an import for review.
  public func stageShortcutChunk(
    sessionId: String,
    authorizationSecret: String,
    chunkIndex: Int,
    records: [String]
  ) throws -> WafraHistoryChunkCounts {
    try stageRecords(sessionId: sessionId, authorizationSecret: authorizationSecret,
      chunkIndex: chunkIndex, records: records, inputMode: .shortcutOffset)
  }

  private func stageRecords(
    sessionId: String,
    authorizationSecret: String,
    chunkIndex: Int,
    records: [String],
    inputMode: RecordInputMode
  ) throws -> WafraHistoryChunkCounts {
    try coordinated(operation: "stage") { root in
      _ = try cleanupUnlocked(root: root, at: nowProvider())
      guard Self.validSessionIdentifier(sessionId) else { throw StoreError.invalidSession }
      let directory = sessionDirectory(root: root, sessionId: sessionId)
      guard FileManager.default.fileExists(atPath: directory.path) else {
        throw StoreError.sessionUnavailable
      }

      var manifest: SessionManifest
      do {
        manifest = try loadManifest(in: directory)
      } catch {
        _ = try invalidateAndDelete(directory: directory, manifest: nil)
        throw StoreError.storageFailure
      }
      guard manifest.state == .open else { throw StoreError.sessionUnavailable }

      do {
        guard let secretData = Self.authorizedSecretData(
          authorizationSecret,
          manifest.secretHash
        ) else {
          throw StoreError.unauthorized
        }
        guard chunkIndex >= 0 else { throw StoreError.invalidChunk }
        // This check deliberately precedes all per-record JSON decoding.
        guard records.count <= Self.maxChunkRecords else { throw StoreError.tooManyRecords }

        let candidate = try makeCandidate(records: records, secretData: secretData, inputMode: inputMode)
        let key = String(chunkIndex)
        if let existing = manifest.chunks[key] {
          guard existing.requestAuthenticationCode == candidate.requestAuthenticationCode else {
            throw StoreError.chunkConflict
          }
          _ = try verifiedChunk(in: directory, chunkIndex: chunkIndex, summary: existing)
          return existing.counts
        }

        let existingIDs = Set(manifest.chunks.values.flatMap(\.recordIDs))
        guard existingIDs.isDisjoint(with: candidate.recordIDs) else {
          throw StoreError.duplicateRecord
        }

        let totals = try manifestTotals(manifest)
        guard
          let projectedAccepted = Self.safeAdd(totals.accepted, candidate.counts.accepted),
          projectedAccepted <= Self.maxSessionRecords
        else {
          throw StoreError.sessionRecordLimit
        }
        guard
          let projectedSessionBytes = Self.safeAdd(
            totals.serializedBytes,
            candidate.chunkData.count
          ),
          projectedSessionBytes <= Self.maxSessionBytes
        else {
          throw StoreError.sessionByteLimit
        }

        let summary = ChunkSummary(
          contentDigest: Self.sha256(candidate.chunkData),
          requestAuthenticationCode: candidate.requestAuthenticationCode,
          attempted: candidate.counts.attempted,
          accepted: candidate.counts.accepted,
          skipped: candidate.counts.skipped,
          serializedBytes: candidate.chunkData.count,
          recordIDs: candidate.recordIDs
        )
        manifest.chunks[key] = summary
        let nextManifestData = try Self.encodeManifest(manifest)
        let currentManifestValues = try manifestURL(directory).resourceValues(
          forKeys: [.fileSizeKey]
        )
        guard let currentManifestSize = currentManifestValues.fileSize else {
          throw StoreError.storageFailure
        }
        let global = try storageUsage(root: root)
        guard
          let withoutManifest = Self.safeSubtract(global.bytes, currentManifestSize),
          let withChunk = Self.safeAdd(withoutManifest, candidate.chunkData.count),
          let projected = Self.safeAdd(withChunk, nextManifestData.count)
        else { throw StoreError.storageFailure }
        guard projected <= Self.maxStoredBytes else { throw StoreError.globalByteLimit }

        try writeProtected(candidate.chunkData, to: chunkURL(directory, chunkIndex))
        try writeProtected(nextManifestData, to: manifestURL(directory))
        return candidate.counts
      } catch let error as StoreError {
        _ = try invalidateAndDelete(directory: directory, manifest: manifest)
        throw error
      } catch {
        _ = try invalidateAndDelete(directory: directory, manifest: manifest)
        throw StoreError.storageFailure
      }
    }
  }

  public func finishSession(
    sessionId: String,
    authorizationSecret: String,
    totalChunks: Int,
    found: Int,
    attempted: Int,
    accepted: Int,
    skipped: Int
  ) throws {
    try coordinated(operation: "finish") { root in
      _ = try cleanupUnlocked(root: root, at: nowProvider())
      guard Self.validSessionIdentifier(sessionId) else { throw StoreError.invalidSession }
      let directory = sessionDirectory(root: root, sessionId: sessionId)
      guard FileManager.default.fileExists(atPath: directory.path) else {
        throw StoreError.sessionUnavailable
      }

      var manifest: SessionManifest
      do {
        manifest = try loadManifest(in: directory)
      } catch {
        _ = try invalidateAndDelete(directory: directory, manifest: nil)
        throw StoreError.storageFailure
      }
      guard manifest.state == .open else { throw StoreError.sessionUnavailable }

      do {
        guard Self.authorizedSecretData(authorizationSecret, manifest.secretHash) != nil else {
          throw StoreError.unauthorized
        }
        guard totalChunks >= 0, found >= 0, attempted >= 0, accepted >= 0, skipped >= 0 else {
          throw StoreError.countMismatch
        }
        let indices = manifest.chunks.keys.compactMap(Int.init).sorted()
        guard indices == Array(0..<indices.count) else {
          throw StoreError.noncontiguousChunks
        }
        guard totalChunks == indices.count else { throw StoreError.countMismatch }

        let totals = try manifestTotals(manifest)
        let (reconciled, overflow) = accepted.addingReportingOverflow(skipped)
        guard
          !overflow,
          found == attempted,
          reconciled == attempted,
          attempted == totals.attempted,
          accepted == totals.accepted,
          skipped == totals.skipped
        else {
          throw StoreError.countMismatch
        }

        for index in indices {
          guard let summary = manifest.chunks[String(index)] else {
            throw StoreError.storageFailure
          }
          _ = try verifiedChunk(in: directory, chunkIndex: index, summary: summary)
        }

        let descriptor = WafraCompletedHistorySession(
          chunkIndices: indices,
          found: found,
          attempted: attempted,
          accepted: accepted,
          skipped: skipped
        )
        manifest.state = .complete
        manifest.secretHash = nil
        manifest.finalTotals = descriptor
        try writeProtected(Self.encodeManifest(manifest), to: manifestURL(directory))
      } catch let error as StoreError {
        _ = try invalidateAndDelete(directory: directory, manifest: manifest)
        throw error
      } catch {
        _ = try invalidateAndDelete(directory: directory, manifest: manifest)
        throw StoreError.storageFailure
      }
    }
  }

  public func completedSession(sessionId: String) throws -> WafraCompletedHistorySession? {
    try coordinated(operation: "completed") { root in
      _ = try cleanupUnlocked(root: root, at: nowProvider())
      guard Self.validSessionIdentifier(sessionId) else { throw StoreError.invalidSession }
      let directory = sessionDirectory(root: root, sessionId: sessionId)
      guard FileManager.default.fileExists(atPath: directory.path) else { return nil }
      do {
        let manifest = try loadManifest(in: directory)
        guard manifest.state == .complete else { return nil }
        guard
          let descriptor = manifest.finalTotals,
          descriptor.chunkIndices == manifest.chunks.keys.compactMap(Int.init).sorted()
        else {
          throw StoreError.storageFailure
        }
        return descriptor
      } catch {
        _ = try invalidateAndDelete(directory: directory, manifest: nil)
        throw StoreError.storageFailure
      }
    }
  }

  public func recoverCompletedSession(
    startedAfter: Date
  ) throws -> WafraRecoveredHistorySession? {
    try coordinated(operation: "recover") { root in
      guard startedAfter.timeIntervalSince1970.isFinite else {
        throw StoreError.invalidRecoveryCutoff
      }
      _ = try cleanupUnlocked(
        root: root,
        at: nowProvider(),
        rejectCorruption: true
      )

      var matches: [WafraRecoveredHistorySession] = []
      for directory in try recoverySessionDirectories(root: root) {
        do {
          let sessionId = directory.lastPathComponent
          guard Self.validSessionIdentifier(sessionId) else {
            throw StoreError.storageFailure
          }
          try validateProtectedDirectory(directory)
          _ = try protectedRegularFileSize(manifestURL(directory))

          let manifest = try loadManifest(in: directory)
          guard
            manifest.state == .complete,
            manifest.createdAt >= startedAfter,
            let descriptor = manifest.finalTotals
          else { continue }

          try verifyRecoverableSession(
            in: directory,
            manifest: manifest,
            descriptor: descriptor
          )
          matches.append(
            WafraRecoveredHistorySession(
              sessionId: sessionId,
              chunkIndices: descriptor.chunkIndices,
              found: descriptor.found,
              attempted: descriptor.attempted,
              accepted: descriptor.accepted,
              skipped: descriptor.skipped
            )
          )
        } catch {
          _ = try? invalidateAndDelete(directory: directory, manifest: nil)
          throw StoreError.storageFailure
        }
      }

      guard matches.count <= 1 else {
        throw StoreError.ambiguousCompletedSessions
      }
      return matches.first
    }
  }

  public func readChunk(sessionId: String, chunkIndex: Int) throws -> [String] {
    try coordinated(operation: "read") { root in
      _ = try cleanupUnlocked(root: root, at: nowProvider())
      guard Self.validSessionIdentifier(sessionId) else { throw StoreError.invalidSession }
      guard chunkIndex >= 0 else { throw StoreError.invalidChunk }
      let directory = sessionDirectory(root: root, sessionId: sessionId)
      guard FileManager.default.fileExists(atPath: directory.path) else {
        throw StoreError.sessionUnavailable
      }

      var manifest: SessionManifest
      do {
        manifest = try loadManifest(in: directory)
      } catch {
        _ = try invalidateAndDelete(directory: directory, manifest: nil)
        throw StoreError.storageFailure
      }
      guard
        manifest.state == .complete,
        let summary = manifest.chunks[String(chunkIndex)],
        manifest.finalTotals?.chunkIndices.contains(chunkIndex) == true
      else {
        throw StoreError.sessionUnavailable
      }

      do {
        return try verifiedChunk(in: directory, chunkIndex: chunkIndex, summary: summary)
      } catch {
        _ = try invalidateAndDelete(directory: directory, manifest: manifest)
        throw StoreError.storageFailure
      }
    }
  }

  public func discardSession(sessionId: String) throws {
    try coordinated(operation: "discard") { root in
      _ = try cleanupUnlocked(root: root, at: nowProvider())
      guard Self.validSessionIdentifier(sessionId) else { throw StoreError.invalidSession }
      let directory = sessionDirectory(root: root, sessionId: sessionId)
      guard FileManager.default.fileExists(atPath: directory.path) else { return }
      let loaded = try? loadManifest(in: directory)
      let removed = try invalidateAndDelete(directory: directory, manifest: loaded)
      if !removed { throw StoreError.cleanupFailure }
    }
  }

  @discardableResult
  public func purgeExpired(now: Date) throws -> Int {
    try coordinated(operation: "purge") { root in
      try cleanupUnlocked(root: root, at: now)
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
        let descriptor = Darwin.open(lockURL.path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else { throw StoreError.storageFailure }
        defer { Darwin.close(descriptor) }
        guard flock(descriptor, LOCK_EX) == 0 else { throw StoreError.storageFailure }
        defer { flock(descriptor, LOCK_UN) }
        try FileManager.default.setAttributes(
          [.protectionKey: FileProtectionType.complete],
          ofItemAtPath: lockURL.path
        )
        lockAcquiredHandler?(operation)
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
      root = base.appendingPathComponent("WafraMessageHistory", isDirectory: true)
    }
    try createProtectedDirectory(root)
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    var mutableRoot = root
    try mutableRoot.setResourceValues(values)
    return root
  }

  private func createProtectedDirectory(_ directory: URL) throws {
    if FileManager.default.fileExists(atPath: directory.path) {
      let attributes = try FileManager.default.attributesOfItem(atPath: directory.path)
      guard attributes[.type] as? FileAttributeType == .typeDirectory else {
        throw StoreError.storageFailure
      }
    } else {
      try FileManager.default.createDirectory(
        at: directory,
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
      ofItemAtPath: directory.path
    )
    try validateProtectedDirectory(directory)
  }

  private func validateProtectedDirectory(_ directory: URL) throws {
    let attributes = try FileManager.default.attributesOfItem(atPath: directory.path)
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
      let size = attributes[.size] as? NSNumber,
      size.intValue >= 0
    else { throw StoreError.storageFailure }
    return size.intValue
  }

  private func writeProtected(_ data: Data, to url: URL) throws {
    if let writeDataHandler {
      try writeDataHandler(data, url)
      return
    }
    try data.write(to: url, options: [.atomic, .completeFileProtection])
    try FileManager.default.setAttributes(
      [.protectionKey: FileProtectionType.complete],
      ofItemAtPath: url.path
    )
  }

  private func sessionDirectory(root: URL, sessionId: String) -> URL {
    root.appendingPathComponent(sessionId, isDirectory: true)
  }

  private func manifestURL(_ directory: URL) -> URL {
    directory.appendingPathComponent("manifest.plist")
  }

  private func chunkURL(_ directory: URL, _ chunkIndex: Int) -> URL {
    directory.appendingPathComponent("chunk-\(chunkIndex).json")
  }

  private func eraseMarkerURL(root: URL) -> URL {
    root.appendingPathComponent(Self.eraseMarkerName)
  }

  private func beginEraseIfNeeded(root: URL) throws {
    let marker = eraseMarkerURL(root: root)
    guard !FileManager.default.fileExists(atPath: marker.path) else { return }
    try writeProtected(Data([1]), to: marker)
  }

  private func completePendingErase(root: URL) throws {
    let marker = eraseMarkerURL(root: root)
    guard FileManager.default.fileExists(atPath: marker.path) else {
      throw StoreError.storageFailure
    }

    let liveDirectories = try sessionDirectories(root: root)
    var deletionCandidates = try tombstoneDirectories(root: root)
    for directory in liveDirectories {
      let loaded = try? loadManifest(in: directory)
      deletionCandidates.append(
        try durablyInvalidate(directory: directory, manifest: loaded)
      )
    }

    var attempted = Set<String>()
    for directory in deletionCandidates where attempted.insert(directory.path).inserted {
      guard FileManager.default.fileExists(atPath: directory.path) else { continue }
      try? removeItemHandler(directory)
    }

    let remaining = try sessionDirectories(root: root) + tombstoneDirectories(root: root)
    guard remaining.isEmpty else { throw StoreError.cleanupFailure }

    do {
      try removeItemHandler(marker)
    } catch {
      throw StoreError.cleanupFailure
    }
    guard !FileManager.default.fileExists(atPath: marker.path) else {
      throw StoreError.cleanupFailure
    }
  }

  private func loadManifest(in directory: URL) throws -> SessionManifest {
    // Older app builds created valid protected session directories without
    // pinning their POSIX mode. Repair those directories before every access
    // so direct deep links and cold recovery enforce the same 0700 boundary.
    try createProtectedDirectory(directory)
    let manifest = try PropertyListDecoder().decode(
      SessionManifest.self,
      from: Data(contentsOf: manifestURL(directory))
    )
    try validateManifest(manifest)
    return manifest
  }

  private func writeInvalidManifest(
    in directory: URL,
    preserving manifest: SessionManifest?
  ) throws {
    guard FileManager.default.fileExists(atPath: directory.path) else { return }
    let timestamp = nowProvider()
    var invalid = manifest ?? SessionManifest(
      state: .invalid,
      createdAt: timestamp,
      expiresAt: timestamp.addingTimeInterval(Self.sessionTTL),
      secretHash: nil,
      chunks: [:],
      finalTotals: nil
    )
    invalid.state = .invalid
    invalid.secretHash = nil
    invalid.chunks = [:]
    invalid.finalTotals = nil
    try writeProtected(Self.encodeManifest(invalid), to: manifestURL(directory))
  }

  private func durablyInvalidate(
    directory: URL,
    manifest: SessionManifest?
  ) throws -> URL {
    guard FileManager.default.fileExists(atPath: directory.path) else { return directory }
    do {
      try writeInvalidManifest(in: directory, preserving: manifest)
      return directory
    } catch {
      let hidden = directory.deletingLastPathComponent().appendingPathComponent(
        ".invalid-\(UUID().uuidString)",
        isDirectory: true
      )
      do {
        try FileManager.default.moveItem(at: directory, to: hidden)
        return hidden
      } catch {
        throw StoreError.storageFailure
      }
    }
  }

  @discardableResult
  private func invalidateAndDelete(
    directory: URL,
    manifest: SessionManifest?
  ) throws -> Bool {
    let tombstone = try durablyInvalidate(directory: directory, manifest: manifest)
    guard FileManager.default.fileExists(atPath: tombstone.path) else { return true }
    do {
      try removeItemHandler(tombstone)
      return true
    } catch {
      return false
    }
  }

  @discardableResult
  private func cleanupUnlocked(
    root: URL,
    at now: Date,
    rejectCorruption: Bool = false
  ) throws -> Int {
    for tombstone in try tombstoneDirectories(root: root) {
      try? removeItemHandler(tombstone)
    }

    let directories = try sessionDirectories(root: root)
    var expiredRemoved = 0
    var foundCorruption = false
    for directory in directories {
      let manifest: SessionManifest
      do {
        manifest = try loadManifest(in: directory)
      } catch {
        _ = try invalidateAndDelete(directory: directory, manifest: nil)
        foundCorruption = foundCorruption || rejectCorruption
        continue
      }
      if manifest.state == .invalid {
        try? removeItemHandler(directory)
        continue
      }
      if now >= manifest.expiresAt {
        if try invalidateAndDelete(directory: directory, manifest: manifest) {
          expiredRemoved += 1
        }
      }
    }
    if foundCorruption { throw StoreError.storageFailure }
    return expiredRemoved
  }

  private func sessionDirectories(root: URL) throws -> [URL] {
    let entries = try FileManager.default.contentsOfDirectory(
      at: root,
      includingPropertiesForKeys: [.isDirectoryKey],
      options: []
    )
    var directories: [URL] = []
    for entry in entries where !entry.lastPathComponent.hasPrefix(".invalid-") {
      let values = try entry.resourceValues(forKeys: [.isDirectoryKey])
      if values.isDirectory == true { directories.append(entry) }
    }
    return directories
  }

  private func tombstoneDirectories(root: URL) throws -> [URL] {
    let entries = try FileManager.default.contentsOfDirectory(
      at: root,
      includingPropertiesForKeys: [.isDirectoryKey],
      options: []
    )
    var directories: [URL] = []
    for entry in entries where entry.lastPathComponent.hasPrefix(".invalid-") {
      let values = try entry.resourceValues(forKeys: [.isDirectoryKey])
      if values.isDirectory == true { directories.append(entry) }
    }
    return directories
  }

  private func recoverySessionDirectories(root: URL) throws -> [URL] {
    let entries = try FileManager.default.contentsOfDirectory(
      at: root,
      includingPropertiesForKeys: nil,
      options: []
    )
    var directories: [URL] = []
    for entry in entries {
      let name = entry.lastPathComponent
      if
        name == ".lock" ||
        name == Self.eraseMarkerName ||
        name.hasPrefix(".invalid-")
      {
        continue
      }
      let attributes = try FileManager.default.attributesOfItem(atPath: entry.path)
      guard
        Self.validSessionIdentifier(name),
        attributes[.type] as? FileAttributeType == .typeDirectory
      else { throw StoreError.storageFailure }
      directories.append(entry)
    }
    return directories
  }

  private func storageUsage(root: URL) throws -> (sessions: Int, bytes: Int) {
    let directories = try sessionDirectories(root: root)
    let storedDirectories = directories + (try tombstoneDirectories(root: root))
    var bytes = 0
    for directory in storedDirectories {
      guard let enumerator = FileManager.default.enumerator(
        at: directory,
        includingPropertiesForKeys: [.fileSizeKey, .isRegularFileKey],
        options: [.skipsHiddenFiles]
      ) else { throw StoreError.storageFailure }
      for case let file as URL in enumerator {
        let values = try file.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
        if values.isRegularFile == true {
          guard
            let fileSize = values.fileSize,
            fileSize >= 0,
            let next = Self.safeAdd(bytes, fileSize)
          else { throw StoreError.storageFailure }
          bytes = next
        }
      }
    }
    return (storedDirectories.count, bytes)
  }

  private func makeCandidate(
    records: [String], secretData: Data, inputMode: RecordInputMode
  ) throws -> StagedCandidate {
    // Authenticate every original input string, including rejected records,
    // before normalization. Preserve the exact legacy strict-mode HMAC bytes.
    var requestData = Data()
    if inputMode == .shortcutOffset {
      requestData.append(Data("WafraMessageHistoryStore.stageShortcutChunk.v1\u{0}".utf8))
    }
    requestData.append(try JSONEncoder().encode(records))
    let authenticationCode = HMAC<SHA256>.authenticationCode(
      for: requestData,
      using: SymmetricKey(data: secretData)
    )
    var normalized: [String] = []
    var recordIDs: [String] = []
    var seen = Set<String>()
    for input in records {
      let decodedRecord = inputMode == .strictUTC
        ? decodeRecord(input) : decodeShortcutRecord(input)
      guard let decoded = decodedRecord else { continue }
      guard seen.insert(decoded.id).inserted else { throw StoreError.duplicateRecord }
      let data = try JSONSerialization.data(
        withJSONObject: decoded.object,
        options: [.sortedKeys]
      )
      normalized.append(String(decoding: data, as: UTF8.self))
      recordIDs.append(decoded.id)
    }
    let chunkData = try JSONEncoder().encode(normalized)
    return StagedCandidate(
      recordIDs: recordIDs,
      counts: WafraHistoryChunkCounts(
        attempted: records.count,
        accepted: normalized.count,
        skipped: records.count - normalized.count
      ),
      chunkData: chunkData,
      requestAuthenticationCode: Self.hex(authenticationCode)
    )
  }

  private func decodeRecord(_ input: String) -> (id: String, object: [String: Any])? {
    guard
      let decoded = decodeRecordFields(input),
      let receivedAt = decoded.object["receivedAt"] as? String,
      Self.validInstant(receivedAt, now: nowProvider())
    else { return nil }
    return decoded
  }

  private func decodeShortcutRecord(_ input: String) -> (id: String, object: [String: Any])? {
    // Duplicate member names and the entire v1 schema are checked on the
    // original JSON, before an offset timestamp can be replaced.
    guard
      var decoded = decodeRecordFields(input),
      let receivedAt = decoded.object["receivedAt"] as? String,
      let canonical = Self.normalizeShortcutInstant(receivedAt, now: nowProvider())
    else { return nil }
    decoded.object["receivedAt"] = canonical
    return decoded
  }

  private func decodeRecordFields(_ input: String) -> (id: String, object: [String: Any])? {
    guard
      let data = input.data(using: .utf8),
      Self.hasUniqueJSONMemberNames(data),
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return nil }

    let keys = Set(object.keys)
    let required = Set(["v", "id", "text", "receivedAt"])
    let allowed = required.union(["sender"])
    guard required.isSubset(of: keys), keys.isSubset(of: allowed) else { return nil }
    guard
      let version = object["v"] as? NSNumber,
      String(cString: version.objCType) != "c",
      version.intValue == 1,
      version.doubleValue == 1,
      let recordId = object["id"] as? String,
      Self.matches(Self.recordIdentifier, recordId),
      let text = object["text"] as? String,
      !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
      let textData = text.data(using: .utf8),
      textData.count <= Self.maxTextBytes,
      let receivedAt = object["receivedAt"] as? String
    else { return nil }

    var normalized: [String: Any] = [
      "v": 1,
      "id": recordId,
      "text": text,
      "receivedAt": receivedAt,
    ]
    if let sender = object["sender"] as? String, Self.safeSender(sender) {
      normalized["sender"] = sender
    }
    return (recordId, normalized)
  }

  private func validateManifest(_ manifest: SessionManifest) throws {
    guard
      manifest.createdAt.timeIntervalSince1970.isFinite,
      manifest.expiresAt.timeIntervalSince1970.isFinite,
      manifest.expiresAt.timeIntervalSince(manifest.createdAt) == Self.sessionTTL
    else { throw StoreError.storageFailure }

    var indices: [Int] = []
    var allRecordIDs = Set<String>()
    for (key, summary) in manifest.chunks {
      guard
        let index = Int(key),
        index >= 0,
        key == String(index),
        Self.matches(Self.recordIdentifier, summary.contentDigest),
        Self.matches(Self.recordIdentifier, summary.requestAuthenticationCode),
        summary.attempted >= 0,
        summary.accepted >= 0,
        summary.skipped >= 0,
        summary.attempted <= Self.maxChunkRecords,
        summary.accepted <= summary.attempted,
        summary.skipped <= summary.attempted,
        Self.safeAdd(summary.accepted, summary.skipped) == summary.attempted,
        summary.serializedBytes >= 2,
        summary.serializedBytes <= Self.maxSessionBytes,
        summary.recordIDs.count == summary.accepted,
        summary.recordIDs.allSatisfy({ Self.matches(Self.recordIdentifier, $0) }),
        Set(summary.recordIDs).count == summary.recordIDs.count
      else { throw StoreError.storageFailure }
      guard allRecordIDs.isDisjoint(with: summary.recordIDs) else {
        throw StoreError.storageFailure
      }
      allRecordIDs.formUnion(summary.recordIDs)
      indices.append(index)
    }
    indices.sort()

    let totals = try manifestTotals(manifest)
    guard
      totals.accepted <= Self.maxSessionRecords,
      totals.serializedBytes <= Self.maxSessionBytes
    else { throw StoreError.storageFailure }

    switch manifest.state {
    case .open:
      guard
        let secretHash = manifest.secretHash,
        Self.matches(Self.recordIdentifier, secretHash),
        manifest.finalTotals == nil
      else { throw StoreError.storageFailure }
    case .complete:
      guard
        manifest.secretHash == nil,
        let descriptor = manifest.finalTotals,
        indices == Array(0..<indices.count),
        descriptor.chunkIndices == indices,
        descriptor.found >= 0,
        descriptor.attempted >= 0,
        descriptor.accepted >= 0,
        descriptor.skipped >= 0,
        descriptor.found == descriptor.attempted,
        Self.safeAdd(descriptor.accepted, descriptor.skipped) == descriptor.attempted,
        descriptor.attempted == totals.attempted,
        descriptor.accepted == totals.accepted,
        descriptor.skipped == totals.skipped
      else { throw StoreError.storageFailure }
    case .invalid:
      guard
        manifest.secretHash == nil,
        manifest.chunks.isEmpty,
        manifest.finalTotals == nil
      else { throw StoreError.storageFailure }
    }
  }

  private func manifestTotals(_ manifest: SessionManifest) throws -> ManifestTotals {
    var attempted = 0
    var accepted = 0
    var skipped = 0
    var serializedBytes = 0
    for summary in manifest.chunks.values {
      guard
        let nextAttempted = Self.safeAdd(attempted, summary.attempted),
        let nextAccepted = Self.safeAdd(accepted, summary.accepted),
        let nextSkipped = Self.safeAdd(skipped, summary.skipped),
        let nextBytes = Self.safeAdd(serializedBytes, summary.serializedBytes)
      else { throw StoreError.storageFailure }
      attempted = nextAttempted
      accepted = nextAccepted
      skipped = nextSkipped
      serializedBytes = nextBytes
    }
    return ManifestTotals(
      attempted: attempted,
      accepted: accepted,
      skipped: skipped,
      serializedBytes: serializedBytes
    )
  }

  private func verifiedChunk(
    in directory: URL,
    chunkIndex: Int,
    summary: ChunkSummary
  ) throws -> [String] {
    let data = try Data(contentsOf: chunkURL(directory, chunkIndex))
    guard
      data.count == summary.serializedBytes,
      Self.sha256(data) == summary.contentDigest
    else { throw StoreError.storageFailure }
    let records = try JSONDecoder().decode([String].self, from: data)
    guard
      records.count == summary.accepted,
      records.count <= Self.maxChunkRecords
    else { throw StoreError.storageFailure }

    var ids: [String] = []
    for record in records {
      guard let decoded = decodeRecord(record) else { throw StoreError.storageFailure }
      let normalizedData = try JSONSerialization.data(
        withJSONObject: decoded.object,
        options: [.sortedKeys]
      )
      guard String(decoding: normalizedData, as: UTF8.self) == record else {
        throw StoreError.storageFailure
      }
      ids.append(decoded.id)
    }
    guard ids == summary.recordIDs else { throw StoreError.storageFailure }
    return records
  }

  private func verifyRecoverableSession(
    in directory: URL,
    manifest: SessionManifest,
    descriptor: WafraCompletedHistorySession
  ) throws {
    let actualFiles = try Set(
      FileManager.default.contentsOfDirectory(atPath: directory.path)
    )
    let expectedFiles = Set(
      ["manifest.plist"] + descriptor.chunkIndices.map { "chunk-\($0).json" }
    )
    guard actualFiles == expectedFiles else { throw StoreError.storageFailure }

    for chunkIndex in descriptor.chunkIndices {
      guard let summary = manifest.chunks[String(chunkIndex)] else {
        throw StoreError.storageFailure
      }
      _ = try protectedRegularFileSize(chunkURL(directory, chunkIndex))
      _ = try verifiedChunk(
        in: directory,
        chunkIndex: chunkIndex,
        summary: summary
      )
    }
  }

  private struct JSONMemberScanner {
    let bytes: [UInt8]
    var index = 0

    mutating func parseDocument() -> Bool {
      guard parseValue(containerDepth: 0) else { return false }
      skipWhitespace()
      return index == bytes.count
    }

    private mutating func parseValue(containerDepth: Int) -> Bool {
      skipWhitespace()
      guard index < bytes.count else { return false }
      switch bytes[index] {
      case 0x7B:
        guard containerDepth < WafraMessageHistoryStore.maximumJSONContainerDepth else {
          return false
        }
        return parseObject(containerDepth: containerDepth + 1)
      case 0x5B:
        guard containerDepth < WafraMessageHistoryStore.maximumJSONContainerDepth else {
          return false
        }
        return parseArray(containerDepth: containerDepth + 1)
      case 0x22:
        return parseString() != nil
      default:
        let start = index
        while index < bytes.count,
              ![0x09, 0x0A, 0x0D, 0x20, 0x2C, 0x5D, 0x7D].contains(bytes[index]) {
          index += 1
        }
        return index > start
      }
    }

    private mutating func parseObject(containerDepth: Int) -> Bool {
      guard index < bytes.count, bytes[index] == 0x7B else { return false }
      index += 1
      skipWhitespace()
      if consume(0x7D) { return true }

      var names = Set<String>()
      while index < bytes.count {
        skipWhitespace()
        guard
          let name = parseString(),
          names.insert(name).inserted
        else { return false }
        skipWhitespace()
        guard consume(0x3A), parseValue(containerDepth: containerDepth) else {
          return false
        }
        skipWhitespace()
        if consume(0x7D) { return true }
        guard consume(0x2C) else { return false }
      }
      return false
    }

    private mutating func parseArray(containerDepth: Int) -> Bool {
      guard index < bytes.count, bytes[index] == 0x5B else { return false }
      index += 1
      skipWhitespace()
      if consume(0x5D) { return true }

      while index < bytes.count {
        guard parseValue(containerDepth: containerDepth) else { return false }
        skipWhitespace()
        if consume(0x5D) { return true }
        guard consume(0x2C) else { return false }
      }
      return false
    }

    private mutating func parseString() -> String? {
      guard index < bytes.count, bytes[index] == 0x22 else { return nil }
      let start = index
      index += 1
      while index < bytes.count {
        if bytes[index] == 0x22 {
          index += 1
          let literal = Data(bytes[start..<index])
          var wrapped = Data([0x5B])
          wrapped.append(literal)
          wrapped.append(0x5D)
          return (try? JSONSerialization.jsonObject(with: wrapped) as? [String])?.first
        }
        if bytes[index] == 0x5C {
          index += 2
        } else {
          index += 1
        }
      }
      return nil
    }

    private mutating func skipWhitespace() {
      while index < bytes.count, [0x09, 0x0A, 0x0D, 0x20].contains(bytes[index]) {
        index += 1
      }
    }

    private mutating func consume(_ byte: UInt8) -> Bool {
      guard index < bytes.count, bytes[index] == byte else { return false }
      index += 1
      return true
    }
  }

  /// Pure source validation shared with the scalar paged-import adapter.
  public static func hasUniqueJSONMemberNames(_ data: Data) -> Bool {
    var scanner = JSONMemberScanner(bytes: Array(data))
    return scanner.parseDocument()
  }

  private static func validSessionIdentifier(_ value: String) -> Bool {
    matches(sessionIdentifier, value)
  }

  private static func matches(_ expression: NSRegularExpression, _ value: String) -> Bool {
    expression.firstMatch(
      in: value,
      range: NSRange(value.startIndex..., in: value)
    ) != nil
  }

  /// Pure timestamp validation; this method does not read or mutate a session.
  public static func normalizeShortcutInstant(_ value: String, now: Date) -> String? {
    let range = NSRange(value.startIndex..., in: value)
    guard let match = shortcutInstant.firstMatch(in: value, range: range) else { return nil }
    func part(_ index: Int) -> String? {
      guard let range = Range(match.range(at: index), in: value) else { return nil }
      return String(value[range])
    }
    guard
      let year = part(1).flatMap(Int.init), year > 0,
      let month = part(2).flatMap(Int.init), (1...12).contains(month),
      let day = part(3).flatMap(Int.init),
      let hour = part(4).flatMap(Int.init), (0...23).contains(hour),
      let minute = part(5).flatMap(Int.init), (0...59).contains(minute),
      let second = part(6).flatMap(Int.init), (0...59).contains(second),
      let zone = part(8)
    else { return nil }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
    let daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    guard (1...daysInMonth[month - 1]).contains(day) else { return nil }

    var offsetSeconds = 0
    if zone != "Z" {
      // RFC 3339 -00:00 denotes an unknown offset, not a known UTC instant.
      // The producer contract supports civil offsets through +/-14:00.
      guard zone != "-00:00" else { return nil }
      let bytes = Array(zone.utf8)
      let hours = Int(bytes[1] - 48) * 10 + Int(bytes[2] - 48)
      let minutes = Int(bytes[4] - 48) * 10 + Int(bytes[5] - 48)
      guard hours <= 14, minutes <= 59, hours < 14 || minutes == 0 else { return nil }
      offsetSeconds = (hours * 3600 + minutes * 60) * (bytes[0] == 45 ? -1 : 1)
    }

    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    let fields = DateComponents(year: year, month: month, day: day,
      hour: hour, minute: minute, second: second)
    guard let wallDate = calendar.date(from: fields) else { return nil }
    let back = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: wallDate)
    guard back.year == year, back.month == month, back.day == day,
      back.hour == hour, back.minute == minute, back.second == second else { return nil }
    let instant = wallDate.addingTimeInterval(-Double(offsetSeconds))
    let utcFields = calendar.dateComponents([.era, .year], from: instant)
    guard utcFields.era == 1, let utcYear = utcFields.year, (1...9999).contains(utcYear) else { return nil }
    let formatter = ISO8601DateFormatter()
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.formatOptions = [.withInternetDateTime]
    let wholeSeconds = formatter.string(from: instant)
    guard wholeSeconds.hasSuffix("Z") else { return nil }
    // Carry the exact fraction as text: Date/formatter floating-point rounding
    // must never turn .001 into .000 or .999 into the following second.
    let canonical = String(wholeSeconds.dropLast()) + "." + (part(7) ?? "000") + "Z"
    return validInstant(canonical, now: now) ? canonical : nil
  }

  private static func validInstant(_ value: String, now: Date) -> Bool {
    guard matches(utcInstant, value) else { return false }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = value.contains(".")
      ? [.withInternetDateTime, .withFractionalSeconds]
      : [.withInternetDateTime]
    guard let date = formatter.date(from: value) else { return false }
    let canonical = formatter.string(from: date)
    guard canonical == value else { return false }
    return date <= now.addingTimeInterval(5 * 60)
  }

  static func safeSender(_ value: String) -> Bool {
    guard !value.isEmpty, value.utf16.count <= 80 else { return false }
    return !value.unicodeScalars.contains { scalar in
      switch scalar.value {
      case 0x0000...0x001F, 0x007F...0x009F, 0x061C,
           0x200B...0x200F, 0x202A...0x202E, 0x2066...0x2069, 0xFEFF:
        return true
      default:
        return false
      }
    }
  }

  private static func authorizedSecretData(_ secret: String, _ storedHash: String?) -> Data? {
    guard
      let storedHash,
      matches(authorizationSecret, secret),
      let secretData = decodeBase64URL(secret),
      secretData.count == 32,
      encodeBase64URL(secretData) == secret
    else { return nil }
    let supplied = Array(sha256(secretData).utf8)
    let expected = Array(storedHash.utf8)
    guard supplied.count == expected.count else { return nil }
    var difference: UInt8 = 0
    for index in supplied.indices { difference |= supplied[index] ^ expected[index] }
    return difference == 0 ? secretData : nil
  }

  private static func decodeBase64URL(_ value: String) -> Data? {
    var base64 = value
      .replacingOccurrences(of: "-", with: "+")
      .replacingOccurrences(of: "_", with: "/")
    base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
    return Data(base64Encoded: base64)
  }

  private static func encodeBase64URL(_ data: Data) -> String {
    data.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  private static func safeAdd(_ lhs: Int, _ rhs: Int) -> Int? {
    let (result, overflow) = lhs.addingReportingOverflow(rhs)
    return overflow ? nil : result
  }

  private static func safeSubtract(_ lhs: Int, _ rhs: Int) -> Int? {
    let (result, overflow) = lhs.subtractingReportingOverflow(rhs)
    return overflow || result < 0 ? nil : result
  }

  private static func hex<S: Sequence>(_ bytes: S) -> String where S.Element == UInt8 {
    bytes.map { String(format: "%02x", $0) }.joined()
  }

  private static func sha256(_ data: Data) -> String {
    hex(SHA256.hash(data: data))
  }

  private static func encodeManifest(_ manifest: SessionManifest) throws -> Data {
    let encoder = PropertyListEncoder()
    encoder.outputFormat = .binary
    return try encoder.encode(manifest)
  }

  public enum StoreError: Error, Equatable {
    case invalidSession
    case invalidChunk
    case duplicateSession
    case unauthorized
    case tooManyRecords
    case chunkConflict
    case duplicateRecord
    case sessionRecordLimit
    case sessionByteLimit
    case globalSessionLimit
    case globalByteLimit
    case noncontiguousChunks
    case countMismatch
    case sessionUnavailable
    case invalidRecoveryCutoff
    case ambiguousCompletedSessions
    case storageFailure
    case cleanupFailure
  }
}
