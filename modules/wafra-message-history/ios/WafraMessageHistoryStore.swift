import Foundation

public enum WafraMessageHistoryStore {
  public static let maxChunkRecords = 50
  public static let maxSessionRecords = 10_000
  public static let maxTextBytes = 16 * 1024
  // JSON escaping plus id/sender/date metadata can make the serialized record
  // larger than its body. The body limit above is the product contract; this
  // is only a defensive envelope around the Shortcuts-to-App-Intent bridge.
  public static let maxRecordBytes = 128 * 1024
  public static let maxSessionBytes = 8 * 1024 * 1024
  public static let maxStoredSessions = 4
  public static let maxStoredBytes = 24 * 1024 * 1024
  public static let sessionTTL: TimeInterval = 60 * 60

  private static let queue = DispatchQueue(label: "app.wafra.message-history-store")
  private static let identifier = try! NSRegularExpression(pattern: "^[A-Za-z0-9_-]{8,128}$")

  private struct ChunkSummary: Codable {
    let count: Int
    let bytes: Int
  }

  private struct SessionManifest: Codable {
    var chunks: [String: ChunkSummary]

    var count: Int { chunks.values.reduce(0) { $0 + $1.count } }
    var bytes: Int { chunks.values.reduce(0) { $0 + $1.bytes } }
  }

  private static func validIdentifier(_ value: String) -> Bool {
    identifier.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)) != nil
  }

  public static func isOversizedRecord(_ record: String) -> Bool {
    guard let data = record.data(using: .utf8), data.count <= maxRecordBytes else {
      return true
    }
    // Malformed small records are staged so the app can count and explain
    // them as invalid. Only an actually oversized body is silently skipped by
    // the App Intent; optional metadata never changes the 16 KiB body limit.
    guard
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let text = object["text"] as? String
    else { return false }
    return text.lengthOfBytes(using: .utf8) > maxTextBytes
  }

  private static func rootDirectory() throws -> URL {
    let base = try FileManager.default.url(
      for: .applicationSupportDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: true
    )
    var root = base.appendingPathComponent("WafraMessageHistory", isDirectory: true)
    try FileManager.default.createDirectory(
      at: root,
      withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.complete]
    )
    var resourceValues = URLResourceValues()
    resourceValues.isExcludedFromBackup = true
    try root.setResourceValues(resourceValues)
    return root
  }

  private static func sessionDirectory(_ sessionId: String, create: Bool) throws -> URL {
    guard validIdentifier(sessionId) else { throw StoreError.invalidSession }
    let directory = try rootDirectory().appendingPathComponent(sessionId, isDirectory: true)
    if create {
      try FileManager.default.createDirectory(
        at: directory,
        withIntermediateDirectories: true,
        attributes: [.protectionKey: FileProtectionType.complete]
      )
    }
    return directory
  }

  public static func stageChunk(
    sessionId: String,
    chunkIndex: Int,
    records: [String]
  ) throws -> Int {
    try queue.sync {
      // Expiry is opportunistic: iOS does not promise a background wake at an
      // exact wall-clock time. Every new stage/access purges abandoned work
      // before handling the requested session.
      _ = try purgeExpiredUnlocked(now: Date())
      guard (0..<1_000).contains(chunkIndex) else { throw StoreError.invalidChunk }
      guard !records.isEmpty, records.count <= maxChunkRecords else {
        throw StoreError.tooManyRecords
      }
      for record in records {
        guard !isOversizedRecord(record) else {
          throw StoreError.recordTooLarge
        }
      }

      let directory = try sessionDirectory(sessionId, create: false)
      let sessionAlreadyExists = FileManager.default.fileExists(atPath: directory.path)
      let usageBeforeSession = try stagedUsage()
      guard sessionAlreadyExists || usageBeforeSession.sessions < maxStoredSessions else {
        throw StoreError.stagingStorageFull
      }
      if !sessionAlreadyExists {
        try FileManager.default.createDirectory(
          at: directory,
          withIntermediateDirectories: true,
          attributes: [.protectionKey: FileProtectionType.complete]
        )
      }
      let filename = String(format: "%04d.json", chunkIndex)
      let data = try JSONEncoder().encode(records)
      let file = directory.appendingPathComponent(filename)
      if FileManager.default.fileExists(atPath: file.path) {
        if try Data(contentsOf: file) == data {
          try touchSession(directory)
          return records.count
        }
        throw StoreError.chunkConflict
      }

      // The manifest turns each additional chunk from a reread of the entire
      // session into a constant-size totals check. If a process stopped after
      // writing a chunk but before its manifest, the filename-set check in
      // loadManifest rebuilds it once from the durable chunks.
      var manifest = try loadManifest(in: directory)
      let incomingBytes = records.reduce(0) { $0 + $1.lengthOfBytes(using: .utf8) }
      guard manifest.count + records.count <= maxSessionRecords else {
        throw StoreError.tooManyRecords
      }
      guard manifest.bytes + incomingBytes <= maxSessionBytes else {
        throw StoreError.sessionTooLarge
      }
      manifest.chunks[filename] = ChunkSummary(count: records.count, bytes: incomingBytes)
      let nextManifestData = try PropertyListEncoder().encode(manifest)
      let global = try stagedUsage()
      let currentManifestBytes = (try? manifestURL(in: directory).resourceValues(
        forKeys: [.fileSizeKey]
      ).fileSize) ?? 0
      let projectedBytes = global.bytes - currentManifestBytes + data.count + nextManifestData.count
      guard projectedBytes <= maxStoredBytes else {
        if !sessionAlreadyExists {
          try? FileManager.default.removeItem(at: directory)
        }
        throw StoreError.stagingStorageFull
      }

      try data.write(to: file, options: [.atomic, .completeFileProtection])
      try writeManifest(nextManifestData, in: directory)
      try touchSession(directory)
      return records.count
    }
  }

  public static func listSessionChunks(sessionId: String) throws -> [Int] {
    try queue.sync {
      _ = try purgeExpiredUnlocked(now: Date())
      let directory = try sessionDirectory(sessionId, create: false)
      guard FileManager.default.fileExists(atPath: directory.path) else { return [] }
      let chunks = try chunkFiles(in: directory).compactMap {
        Int($0.deletingPathExtension().lastPathComponent)
      }
      try touchSession(directory)
      return chunks
    }
  }

  public static func readChunk(sessionId: String, chunkIndex: Int) throws -> [String] {
    try queue.sync {
      _ = try purgeExpiredUnlocked(now: Date())
      guard (0..<1_000).contains(chunkIndex) else { throw StoreError.invalidChunk }
      let directory = try sessionDirectory(sessionId, create: false)
      guard FileManager.default.fileExists(atPath: directory.path) else {
        throw StoreError.sessionExpired
      }
      let file = directory.appendingPathComponent(String(format: "%04d.json", chunkIndex))
      guard FileManager.default.fileExists(atPath: file.path) else {
        throw StoreError.sessionIncomplete
      }
      let records = try JSONDecoder().decode([String].self, from: Data(contentsOf: file))
      guard records.count <= maxChunkRecords else { throw StoreError.tooManyRecords }
      try touchSession(directory)
      return records
    }
  }

  public static func discardSession(sessionId: String) throws {
    try queue.sync {
      let directory = try sessionDirectory(sessionId, create: false)
      if FileManager.default.fileExists(atPath: directory.path) {
        try FileManager.default.removeItem(at: directory)
      }
    }
  }

  @discardableResult
  public static func purgeExpired(now: Date = Date()) throws -> Int {
    try queue.sync {
      try purgeExpiredUnlocked(now: now)
    }
  }

  private static func purgeExpiredUnlocked(now: Date) throws -> Int {
    let root = try rootDirectory()
    let urls = try FileManager.default.contentsOfDirectory(
      at: root,
      includingPropertiesForKeys: [.contentModificationDateKey, .isDirectoryKey],
      options: [.skipsHiddenFiles]
    )
    var removed = 0
    for url in urls {
      let values = try url.resourceValues(forKeys: [.contentModificationDateKey, .isDirectoryKey])
      guard values.isDirectory == true else { continue }
      let modified = values.contentModificationDate ?? .distantPast
      if now.timeIntervalSince(modified) > sessionTTL {
        try FileManager.default.removeItem(at: url)
        removed += 1
      }
    }
    return removed
  }

  private static func chunkFiles(in directory: URL) throws -> [URL] {
    try FileManager.default.contentsOfDirectory(
      at: directory,
      includingPropertiesForKeys: nil,
      options: [.skipsHiddenFiles]
    )
    .filter { $0.pathExtension == "json" }
    .sorted { $0.lastPathComponent < $1.lastPathComponent }
  }

  private static func manifestURL(in directory: URL) -> URL {
    directory.appendingPathComponent("manifest.plist")
  }

  private static func touchSession(_ directory: URL, now: Date = Date()) throws {
    try FileManager.default.setAttributes(
      [.modificationDate: now],
      ofItemAtPath: directory.path
    )
  }

  private static func loadManifest(in directory: URL) throws -> SessionManifest {
    let files = try chunkFiles(in: directory)
    let names = Set(files.map(\.lastPathComponent))
    let url = manifestURL(in: directory)
    if
      let data = try? Data(contentsOf: url),
      let manifest = try? PropertyListDecoder().decode(SessionManifest.self, from: data),
      Set(manifest.chunks.keys) == names
    {
      return manifest
    }

    var chunks: [String: ChunkSummary] = [:]
    for file in files {
      let records = try JSONDecoder().decode([String].self, from: Data(contentsOf: file))
      guard records.count <= maxChunkRecords else { throw StoreError.tooManyRecords }
      let bytes = records.reduce(0) { $0 + $1.lengthOfBytes(using: .utf8) }
      chunks[file.lastPathComponent] = ChunkSummary(count: records.count, bytes: bytes)
    }
    let rebuilt = SessionManifest(chunks: chunks)
    try writeManifest(rebuilt, in: directory)
    return rebuilt
  }

  private static func writeManifest(_ manifest: SessionManifest, in directory: URL) throws {
    let data = try PropertyListEncoder().encode(manifest)
    try writeManifest(data, in: directory)
  }

  private static func writeManifest(_ data: Data, in directory: URL) throws {
    try data.write(to: manifestURL(in: directory), options: [.atomic, .completeFileProtection])
  }

  private static func stagedUsage() throws -> (sessions: Int, bytes: Int) {
    let root = try rootDirectory()
    let sessions = try FileManager.default.contentsOfDirectory(
      at: root,
      includingPropertiesForKeys: [.isDirectoryKey],
      options: [.skipsHiddenFiles]
    ).filter { (try? $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true }
    var bytes = 0
    for session in sessions {
      guard let enumerator = FileManager.default.enumerator(
        at: session,
        includingPropertiesForKeys: [.fileSizeKey, .isRegularFileKey],
        options: [.skipsHiddenFiles]
      ) else { continue }
      for case let file as URL in enumerator {
        let values = try file.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
        if values.isRegularFile == true { bytes += values.fileSize ?? 0 }
      }
    }
    return (sessions.count, bytes)
  }

  public enum StoreError: Error {
    case invalidSession
    case invalidChunk
    case tooManyRecords
    case recordTooLarge
    case sessionTooLarge
    case chunkConflict
    case stagingStorageFull
    case sessionExpired
    case sessionIncomplete
  }
}
