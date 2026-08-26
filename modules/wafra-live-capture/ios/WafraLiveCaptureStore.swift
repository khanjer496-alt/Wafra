import Darwin
import Foundation

// Darwin's Swift overlay exposes `struct flock` but not the BSD `flock(2)`
// function. Bind the libc symbol directly so the App Intent and Expo bridge
// coordinate through the same advisory file lock across processes.
@_silgen_name("flock")
private func wafraDarwinFlock(_ descriptor: Int32, _ operation: Int32) -> Int32

public enum WafraLiveStageResult: String, Codable {
  case accepted
  case ignored
  case invalid
  case capacityReached
  case disabled
}

public struct WafraLiveCaptureStatus: Codable {
  public let enabled: Bool
  public let entitled: Bool
  public let pending: Int
  public let dropped: Int
  public let corrupt: Bool
  public let warningId: String?
  public let setupProofVersion: Int?
  public let setupProofAt: TimeInterval?
  public let firstCapturedAt: TimeInterval?
}

public final class WafraLiveCaptureStore {
  public static let shared = WafraLiveCaptureStore()

  public static let maxBodyBytes = 16 * 1024
  public static let maxSenderCharacters = 80
  public static let maxRecords = 2_000
  public static let maxRecordBytes = 8 * 1024 * 1024
  public static let maxBridgeRecords = 50
  public static let maxAcknowledgedIds = 10_000
  public static let recordTTL: TimeInterval = 30 * 24 * 60 * 60
  public static let maxFutureSkew: TimeInterval = 5 * 60

  public enum StoreError: Error {
    case lockUnavailable
    case invalidAcknowledgement
    case invalidSetupProof
    case invalidMilestone
    case invalidManifest
    case invalidEntitlementLease
    case entitlementRequired
    case reentrantOperation
  }

  private struct StoredRecord: Codable {
    let v: Int
    let id: String
    let text: String
    let sender: String
    let observedAt: String
    let source: String
  }

  private struct RecordSummary: Codable {
    let observedAt: TimeInterval
    let bytes: Int
  }

  private struct AcknowledgedSummary: Codable {
    let digest: String
    let expiresAt: TimeInterval
  }

  private struct Manifest: Codable {
    var v: Int = 1
    var enabled: Bool = false
    var localEntitlementLifetime: Bool = false
    var localEntitlementExpiresAt: TimeInterval?
    var storeEntitlementLifetime: Bool = false
    var storeEntitlementExpiresAt: TimeInterval?
    var storeEntitlementVerifiedAt: TimeInterval?
    var records: [String: RecordSummary] = [:]
    var acknowledged: [String: AcknowledgedSummary] = [:]
    var dropped: Int = 0
    var corrupt: Bool = false
    var warningId: String?
    var setupProofVersion: Int?
    var setupProofAt: TimeInterval?
    var firstCapturedAt: TimeInterval?

    private enum CodingKeys: String, CodingKey {
      case v, enabled, records, acknowledged, dropped, corrupt, warningId
      case localEntitlementLifetime, localEntitlementExpiresAt
      case storeEntitlementLifetime, storeEntitlementExpiresAt, storeEntitlementVerifiedAt
      case setupProofVersion, setupProofAt, firstCapturedAt
    }

    init() {}

    init(from decoder: Decoder) throws {
      let values = try decoder.container(keyedBy: CodingKeys.self)
      v = try values.decode(Int.self, forKey: .v)
      enabled = try values.decode(Bool.self, forKey: .enabled)
      // Builds predating native entitlement enforcement contain none of these
      // keys. Missing grants migrate to an inactive state while preserving the
      // user's independent capture consent and any protected pending records.
      localEntitlementLifetime = try values.decodeIfPresent(
        Bool.self,
        forKey: .localEntitlementLifetime
      ) ?? false
      localEntitlementExpiresAt = try values.decodeIfPresent(
        TimeInterval.self,
        forKey: .localEntitlementExpiresAt
      )
      storeEntitlementLifetime = try values.decodeIfPresent(
        Bool.self,
        forKey: .storeEntitlementLifetime
      ) ?? false
      storeEntitlementExpiresAt = try values.decodeIfPresent(
        TimeInterval.self,
        forKey: .storeEntitlementExpiresAt
      )
      storeEntitlementVerifiedAt = try values.decodeIfPresent(
        TimeInterval.self,
        forKey: .storeEntitlementVerifiedAt
      )
      records = try values.decode([String: RecordSummary].self, forKey: .records)
      acknowledged = try values.decodeIfPresent(
        [String: AcknowledgedSummary].self,
        forKey: .acknowledged
      ) ?? [:]
      dropped = try values.decode(Int.self, forKey: .dropped)
      corrupt = try values.decode(Bool.self, forKey: .corrupt)
      warningId = try values.decodeIfPresent(String.self, forKey: .warningId)
      setupProofVersion = try values.decodeIfPresent(Int.self, forKey: .setupProofVersion)
      setupProofAt = try values.decodeIfPresent(TimeInterval.self, forKey: .setupProofAt)
      firstCapturedAt = try values.decodeIfPresent(TimeInterval.self, forKey: .firstCapturedAt)
    }

    var recordBytes: Int {
      records.values.reduce(0) { partial, summary in
        let (sum, overflow) = partial.addingReportingOverflow(summary.bytes)
        return overflow ? Int.max : sum
      }
    }
  }

  private static let coordinatorKey = DispatchSpecificKey<UInt8>()
  private static let coordinator: DispatchQueue = {
    let queue = DispatchQueue(label: "app.wafra.live-capture-store")
    queue.setSpecific(key: coordinatorKey, value: 1)
    return queue
  }()
  private static let protection = FileProtectionType.completeUntilFirstUserAuthentication
  private static let writeOptions: Data.WritingOptions = [
    .atomic,
    .completeFileProtectionUntilFirstUserAuthentication,
  ]

  private let rootOverride: URL?
  private let clock: () -> Date
  private let senderIdentity: (String) -> WafraBankSenderIdentity?
  private let acknowledgementRemoveItem: (URL) throws -> Void

  public init(
    root: URL? = nil,
    now: @escaping () -> Date = Date.init,
    senderIdentity: @escaping (String) -> WafraBankSenderIdentity? = WafraBankSenderRegistry.identity,
    acknowledgementRemoveItem: @escaping (URL) throws -> Void = {
      try FileManager.default.removeItem(at: $0)
    }
  ) {
    rootOverride = root
    clock = now
    self.senderIdentity = senderIdentity
    self.acknowledgementRemoveItem = acknowledgementRemoveItem
  }

  public func stage(
    sender: String,
    body: String,
    eventId: String,
    observedAt: Date
  ) throws -> WafraLiveStageResult {
    try withExclusiveLock { root in
      var manifest = try loadManifest(in: root)
      let receiptTime = clock()
      _ = try purgeExpiredUnlocked(manifest: &manifest, in: root, now: receiptTime)
      guard manifest.enabled, isEntitled(manifest, at: receiptTime) else {
        return .disabled
      }

      guard
        let id = canonicalEventId(eventId),
        validAdmissionDate(observedAt, now: receiptTime),
        validSender(sender),
        validBody(body)
      else { return .invalid }

      guard senderIdentity(sender) != nil else { return .ignored }

      let observedAtString = Self.iso8601(observedAt)
      guard let serializedDate = Self.parseISO8601(observedAtString) else { return .invalid }
      let record = StoredRecord(
        v: 1,
        id: id,
        text: body,
        sender: sender,
        observedAt: observedAtString,
        source: "message"
      )
      let data = try Self.encodeRecord(record)

      if let existing = manifest.records[id] {
        let file = recordURL(id: id, in: root)
        guard
          let existingData = try? Data(contentsOf: file),
          existingData.count == existing.bytes,
          let existingRecord = try? JSONDecoder().decode(StoredRecord.self, from: existingData),
          validStoredRecord(existingRecord, id: id, summary: existing)
        else {
          try tombstoneRecord(id: id, manifest: &manifest, in: root)
          return .invalid
        }
        return existingData == data ? .accepted : .invalid
      }

      if let acknowledged = manifest.acknowledged[id] {
        return acknowledged.digest == Self.sha256(data) ? .accepted : .invalid
      }

      let projectedBytes = manifest.recordBytes.addingReportingOverflow(data.count)
      guard
        manifest.records.count < Self.maxRecords,
        !projectedBytes.overflow,
        projectedBytes.partialValue <= Self.maxRecordBytes
      else {
        if manifest.dropped < Int.max { manifest.dropped += 1 }
        rotateWarning(in: &manifest)
        try writeManifest(manifest, in: root)
        return .capacityReached
      }

      let records = try recordsDirectory(in: root, create: true)
      let file = records.appendingPathComponent(id + ".json", isDirectory: false)
      try data.write(to: file, options: Self.writeOptions)
      manifest.records[id] = RecordSummary(
        observedAt: serializedDate.timeIntervalSince1970,
        bytes: data.count
      )
      do {
        try writeManifest(manifest, in: root)
      } catch {
        try? FileManager.default.removeItem(at: file)
        throw error
      }
      return .accepted
    }
  }

  public func setCaptureEnabled(_ enabled: Bool) throws {
    try withExclusiveLock { root in
      var manifest = try loadManifest(in: root)
      if enabled {
        let now = clock()
        guard validDate(now) else { throw StoreError.invalidEntitlementLease }
        guard isEntitled(manifest, at: now) else { throw StoreError.entitlementRequired }
      }
      manifest.enabled = enabled
      try writeManifest(manifest, in: root)
    }
  }

  /**
   Persist the on-device trial/founder lease. A finite local lease is a
   non-renewable boundary: later writes may tighten it but can never extend it.
   Founder lifetime may irreversibly upgrade it until eraseAll().
   */
  @discardableResult
  public func setLocalEntitlementLease(expiresAt: Date?, lifetime: Bool) throws -> Bool {
    try withExclusiveLock { root in
      guard lifetime != (expiresAt != nil) else {
        throw StoreError.invalidEntitlementLease
      }
      let expiry = expiresAt?.timeIntervalSince1970
      guard expiry.map(validEntitlementTimestamp) ?? true else {
        throw StoreError.invalidEntitlementLease
      }

      var manifest = try loadManifest(in: root)
      if manifest.localEntitlementLifetime { return false }
      if lifetime {
        manifest.localEntitlementLifetime = true
        manifest.localEntitlementExpiresAt = nil
        try writeManifest(manifest, in: root)
        return true
      }

      guard let expiry else { throw StoreError.invalidEntitlementLease }
      if let persisted = manifest.localEntitlementExpiresAt, expiry >= persisted {
        return false
      }
      manifest.localEntitlementExpiresAt = expiry
      try writeManifest(manifest, in: root)
      return true
    }
  }

  /**
   Persist a RevenueCat-derived lease only when its verification revision is
   newer. `lifetime == false && expiresAt == nil` is the explicit inactive
   snapshot and clears the store grant while retaining the revision.
   */
  @discardableResult
  public func setStoreEntitlementLease(
    expiresAt: Date?,
    lifetime: Bool,
    verifiedAt: Date
  ) throws -> Bool {
    try withExclusiveLock { root in
      let verification = verifiedAt.timeIntervalSince1970
      let expiry = expiresAt?.timeIntervalSince1970
      guard
        validEntitlementTimestamp(verification),
        validLeaseShape(lifetime: lifetime, expiresAt: expiry),
        expiry.map(validEntitlementTimestamp) ?? true
      else { throw StoreError.invalidEntitlementLease }

      var manifest = try loadManifest(in: root)
      if let persisted = manifest.storeEntitlementVerifiedAt {
        if verification < persisted { return false }
        if verification == persisted {
          // Idempotent replays are accepted so the same confirmed snapshot can
          // repair JS state after a persistence race. A conflicting payload at
          // the same revision still fails closed.
          return manifest.storeEntitlementLifetime == lifetime
            && manifest.storeEntitlementExpiresAt == expiry
        }
      }
      manifest.storeEntitlementLifetime = lifetime
      manifest.storeEntitlementExpiresAt = expiry
      manifest.storeEntitlementVerifiedAt = verification
      try writeManifest(manifest, in: root)
      return true
    }
  }

  public func listPendingRecords(limit: Int) throws -> [String] {
    try withExclusiveLock { root in
      var manifest = try loadManifest(in: root)
      _ = try purgeExpiredUnlocked(manifest: &manifest, in: root, now: clock())
      try tombstoneOrphanedRecordFiles(manifest: &manifest, in: root)

      let boundedLimit = min(max(limit, 0), Self.maxBridgeRecords)
      guard boundedLimit > 0 else { return [] }

      let snapshot = manifest.records.sorted { left, right in
        if left.value.observedAt == right.value.observedAt {
          return left.key < right.key
        }
        return left.value.observedAt < right.value.observedAt
      }
      var rows: [String] = []
      rows.reserveCapacity(min(snapshot.count, boundedLimit))

      for (id, summary) in snapshot {
        guard rows.count < boundedLimit else { break }
        let file = recordURL(id: id, in: root)
        guard
          let data = try? Data(contentsOf: file),
          data.count == summary.bytes,
          let record = try? JSONDecoder().decode(StoredRecord.self, from: data),
          validStoredRecord(record, id: id, summary: summary)
        else {
          try tombstoneRecord(id: id, manifest: &manifest, in: root)
          continue
        }
        rows.append(String(decoding: data, as: UTF8.self))
      }
      return rows
    }
  }

  public func acknowledgeRecords(ids: [String]) throws {
    try withExclusiveLock { root in
      guard ids.count <= Self.maxBridgeRecords else {
        throw StoreError.invalidAcknowledgement
      }
      var canonicalIds: [String] = []
      canonicalIds.reserveCapacity(ids.count)
      for id in ids {
        guard let canonical = canonicalEventId(id) else {
          throw StoreError.invalidAcknowledgement
        }
        canonicalIds.append(canonical)
      }

      var manifest = try loadManifest(in: root)
      let acknowledgementDate = clock()
      guard validDate(acknowledgementDate) else { throw StoreError.invalidMilestone }
      let prunedAcknowledgements = pruneAcknowledged(
        manifest: &manifest,
        now: acknowledgementDate
      )
      var removed: Set<String> = []
      var verified: [(id: String, data: Data)] = []
      for id in Set(canonicalIds) {
        guard let summary = manifest.records[id] else { continue }
        let file = recordURL(id: id, in: root)
        guard
          let data = try? Data(contentsOf: file),
          data.count == summary.bytes,
          let record = try? JSONDecoder().decode(StoredRecord.self, from: data),
          validStoredRecord(record, id: id, summary: summary)
        else {
          manifest.records.removeValue(forKey: id)
          markCorrupt(in: &manifest)
          removed.insert(id)
          continue
        }
        verified.append((id: id, data: data))
      }
      // Source deletion is the acknowledgement boundary. Never publish a
      // successful ACK while recoverable Message bytes remain on disk.
      for item in verified {
        try acknowledgementRemoveItem(recordURL(id: item.id, in: root))
      }
      for item in verified {
        let id = item.id
        manifest.records.removeValue(forKey: id)
        manifest.acknowledged[id] = AcknowledgedSummary(
          digest: Self.sha256(item.data),
          expiresAt: acknowledgementDate.timeIntervalSince1970 + Self.recordTTL
        )
        removed.insert(id)
      }
      enforceAcknowledgedBound(manifest: &manifest)
      guard !removed.isEmpty else {
        if prunedAcknowledgements > 0 { try writeManifest(manifest, in: root) }
        return
      }
      try writeManifest(manifest, in: root)
      for id in removed where !verified.contains(where: { $0.id == id }) {
        try? FileManager.default.removeItem(at: recordURL(id: id, in: root))
      }
    }
  }

  public func purgeExpired() throws -> Int {
    try withExclusiveLock { root in
      var manifest = try loadManifest(in: root)
      return try purgeExpiredUnlocked(manifest: &manifest, in: root, now: clock())
    }
  }

  public func status() throws -> WafraLiveCaptureStatus {
    try withExclusiveLock { root in
      var manifest = try loadManifest(in: root)
      let now = clock()
      _ = try purgeExpiredUnlocked(manifest: &manifest, in: root, now: now)
      try tombstoneOrphanedRecordFiles(manifest: &manifest, in: root)
      return WafraLiveCaptureStatus(
        enabled: manifest.enabled,
        entitled: isEntitled(manifest, at: now),
        pending: manifest.records.count,
        dropped: manifest.dropped,
        corrupt: manifest.corrupt,
        warningId: manifest.warningId,
        setupProofVersion: manifest.setupProofVersion,
        setupProofAt: manifest.setupProofAt,
        firstCapturedAt: manifest.firstCapturedAt
      )
    }
  }

  public func recordSetupProof(version: Int, at: Date) throws {
    try withExclusiveLock { root in
      guard version > 0, validDate(at) else { throw StoreError.invalidSetupProof }
      var manifest = try loadManifest(in: root)
      manifest.setupProofVersion = version
      manifest.setupProofAt = at.timeIntervalSince1970
      try writeManifest(manifest, in: root)
    }
  }

  public func recordFirstCapturedAt(_ date: Date) throws {
    try withExclusiveLock { root in
      guard validDate(date) else { throw StoreError.invalidMilestone }
      var manifest = try loadManifest(in: root)
      let value = date.timeIntervalSince1970
      manifest.firstCapturedAt = min(manifest.firstCapturedAt ?? value, value)
      try writeManifest(manifest, in: root)
    }
  }

  /** Clear only the exact warning generation the caller durably observed. */
  public func acknowledgeCaptureWarning(id: String) throws -> Bool {
    try withExclusiveLock { root in
      guard let canonical = canonicalWarningId(id) else { return false }
      var manifest = try loadManifest(in: root)
      guard manifest.warningId == canonical else { return false }
      manifest.dropped = 0
      manifest.corrupt = false
      manifest.warningId = nil
      try writeManifest(manifest, in: root)
      return true
    }
  }

  public func eraseAll() throws {
    try withExclusiveLock { root in
      var tombstone = Manifest()
      tombstone.enabled = false
      tombstone.corrupt = true
      try writeManifest(tombstone, in: root)

      let records = try recordsDirectory(in: root, create: false)
      if FileManager.default.fileExists(atPath: records.path) {
        try FileManager.default.removeItem(at: records)
      }

      let clean = Manifest()
      try writeManifest(clean, in: root)
    }
  }

  private func withExclusiveLock<T>(_ operation: (URL) throws -> T) throws -> T {
    guard DispatchQueue.getSpecific(key: Self.coordinatorKey) == nil else {
      throw StoreError.reentrantOperation
    }
    return try Self.coordinator.sync {
      let root = try rootDirectory()
      let lock = root.appendingPathComponent(".lock", isDirectory: false)
      let descriptor = Darwin.open(lock.path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
      guard descriptor >= 0 else { throw StoreError.lockUnavailable }
      defer { Darwin.close(descriptor) }
      try FileManager.default.setAttributes(
        [.protectionKey: Self.protection],
        ofItemAtPath: lock.path
      )
      guard wafraDarwinFlock(descriptor, LOCK_EX) == 0 else {
        throw StoreError.lockUnavailable
      }
      defer { _ = wafraDarwinFlock(descriptor, LOCK_UN) }
      return try operation(root)
    }
  }

  private func rootDirectory() throws -> URL {
    let root: URL
    if let rootOverride {
      root = rootOverride
    } else {
      let applicationSupport = try FileManager.default.url(
        for: .applicationSupportDirectory,
        in: .userDomainMask,
        appropriateFor: nil,
        create: true
      )
      root = applicationSupport.appendingPathComponent("WafraLiveCapture", isDirectory: true)
    }
    try FileManager.default.createDirectory(
      at: root,
      withIntermediateDirectories: true,
      attributes: [.protectionKey: Self.protection]
    )
    var resourceValues = URLResourceValues()
    resourceValues.isExcludedFromBackup = true
    var mutableRoot = root
    try mutableRoot.setResourceValues(resourceValues)
    return root
  }

  private func loadManifest(in root: URL) throws -> Manifest {
    let url = manifestURL(in: root)
    guard FileManager.default.fileExists(atPath: url.path) else {
      let records = try recordsDirectory(in: root, create: false)
      if FileManager.default.fileExists(atPath: records.path) {
        return try recoverCorruptManifest(in: root)
      }
      let manifest = Manifest()
      try writeManifest(manifest, in: root)
      return manifest
    }

    do {
      var manifest = try PropertyListDecoder().decode(Manifest.self, from: Data(contentsOf: url))
      guard validManifest(manifest) else { throw StoreError.invalidManifest }
      let hasWarning = manifest.dropped > 0 || manifest.corrupt
      if hasWarning && manifest.warningId == nil {
        // Upgrade warning metadata written by the first local-capture build.
        // The opaque ID contains no Message data and makes later recovery a
        // compare-and-clear operation instead of a race-prone blanket ACK.
        rotateWarning(in: &manifest)
        try writeManifest(manifest, in: root)
      } else if !hasWarning && manifest.warningId != nil {
        manifest.warningId = nil
        try writeManifest(manifest, in: root)
      }
      return manifest
    } catch {
      return try recoverCorruptManifest(in: root)
    }
  }

  private func validManifest(_ manifest: Manifest) -> Bool {
    guard
      manifest.v == 1,
      manifest.records.count <= Self.maxRecords,
      manifest.acknowledged.count <= Self.maxAcknowledgedIds,
      manifest.recordBytes <= Self.maxRecordBytes,
      manifest.dropped >= 0,
      manifest.warningId.map({ canonicalWarningId($0) == $0 }) ?? true,
      manifest.setupProofVersion.map({ $0 > 0 }) ?? true,
      manifest.setupProofAt.map({ $0.isFinite }) ?? true,
      manifest.firstCapturedAt.map({ $0.isFinite }) ?? true,
      validLeaseShape(
        lifetime: manifest.localEntitlementLifetime,
        expiresAt: manifest.localEntitlementExpiresAt
      ),
      manifest.localEntitlementExpiresAt.map(validEntitlementTimestamp) ?? true,
      validLeaseShape(
        lifetime: manifest.storeEntitlementLifetime,
        expiresAt: manifest.storeEntitlementExpiresAt
      ),
      manifest.storeEntitlementExpiresAt.map(validEntitlementTimestamp) ?? true,
      manifest.storeEntitlementVerifiedAt.map(validEntitlementTimestamp) ?? true,
      !(manifest.storeEntitlementLifetime || manifest.storeEntitlementExpiresAt != nil)
        || manifest.storeEntitlementVerifiedAt != nil
    else { return false }
    guard manifest.records.allSatisfy({ id, summary in
      canonicalEventId(id) == id && summary.bytes > 0 && summary.observedAt.isFinite
    }) else { return false }
    return manifest.acknowledged.allSatisfy { id, summary in
      canonicalEventId(id) == id
        && summary.digest.utf8.count == 64
        && summary.digest.utf8.allSatisfy {
          (0x30...0x39).contains($0) || (0x61...0x66).contains($0)
        }
        && summary.expiresAt.isFinite
    }
  }

  private func recoverCorruptManifest(in root: URL) throws -> Manifest {
    var tombstone = Manifest()
    tombstone.enabled = false
    markCorrupt(in: &tombstone)
    try writeManifest(tombstone, in: root)
    let records = try recordsDirectory(in: root, create: false)
    if FileManager.default.fileExists(atPath: records.path) {
      try? FileManager.default.removeItem(at: records)
    }
    return tombstone
  }

  private func writeManifest(_ manifest: Manifest, in root: URL) throws {
    let encoder = PropertyListEncoder()
    encoder.outputFormat = .binary
    let data = try encoder.encode(manifest)
    try data.write(to: manifestURL(in: root), options: Self.writeOptions)
  }

  private func purgeExpiredUnlocked(
    manifest: inout Manifest,
    in root: URL,
    now: Date
  ) throws -> Int {
    guard validDate(now) else { throw StoreError.invalidMilestone }
    let timestamp = now.timeIntervalSince1970
    let prunedAcknowledgements = pruneAcknowledged(manifest: &manifest, now: now)
    let expired = manifest.records.compactMap { id, summary in
      timestamp - summary.observedAt > Self.recordTTL ? id : nil
    }
    guard !expired.isEmpty || prunedAcknowledgements > 0 else { return 0 }
    // Delete source bytes before dropping their durable index. If deletion
    // fails, retain the manifest reference and throw so the next stage/status
    // access retries instead of turning private raw data into an invisible
    // orphan. A crash after deletion but before the manifest write is safe:
    // the next pass treats the already-missing file as successfully removed.
    for id in expired {
      let file = recordURL(id: id, in: root)
      do {
        try FileManager.default.removeItem(at: file)
      } catch {
        let cocoa = error as NSError
        guard cocoa.domain == NSCocoaErrorDomain && cocoa.code == NSFileNoSuchFileError else {
          throw error
        }
      }
    }
    for id in expired { manifest.records.removeValue(forKey: id) }
    try writeManifest(manifest, in: root)
    return expired.count
  }

  private func pruneAcknowledged(manifest: inout Manifest, now: Date) -> Int {
    let timestamp = now.timeIntervalSince1970
    let expired = manifest.acknowledged.compactMap { id, summary in
      timestamp > summary.expiresAt ? id : nil
    }
    for id in expired { manifest.acknowledged.removeValue(forKey: id) }
    return expired.count
  }

  private func enforceAcknowledgedBound(manifest: inout Manifest) {
    let overflow = manifest.acknowledged.count - Self.maxAcknowledgedIds
    guard overflow > 0 else { return }
    let oldest = manifest.acknowledged.sorted { left, right in
      if left.value.expiresAt == right.value.expiresAt { return left.key < right.key }
      return left.value.expiresAt < right.value.expiresAt
    }.prefix(overflow)
    for (id, _) in oldest { manifest.acknowledged.removeValue(forKey: id) }
  }

  private func tombstoneRecord(id: String, manifest: inout Manifest, in root: URL) throws {
    manifest.records.removeValue(forKey: id)
    markCorrupt(in: &manifest)
    try writeManifest(manifest, in: root)
    try? FileManager.default.removeItem(at: recordURL(id: id, in: root))
  }

  private func tombstoneOrphanedRecordFiles(
    manifest: inout Manifest,
    in root: URL
  ) throws {
    let records = try recordsDirectory(in: root, create: false)
    guard FileManager.default.fileExists(atPath: records.path) else { return }
    let files = try FileManager.default.contentsOfDirectory(
      at: records,
      includingPropertiesForKeys: nil,
      options: []
    )
    let orphans = files.filter {
      $0.pathExtension != "json"
        || manifest.records[$0.deletingPathExtension().lastPathComponent] == nil
    }
    guard !orphans.isEmpty else { return }
    markCorrupt(in: &manifest)
    try writeManifest(manifest, in: root)
    for file in orphans { try? FileManager.default.removeItem(at: file) }
  }

  private func validStoredRecord(
    _ record: StoredRecord,
    id: String,
    summary: RecordSummary
  ) -> Bool {
    guard
      record.v == 1,
      record.id == id,
      record.source == "message",
      validSender(record.sender),
      validBody(record.text),
      let date = Self.parseISO8601(record.observedAt),
      date.timeIntervalSince1970 == summary.observedAt
    else { return false }
    return true
  }

  private func canonicalEventId(_ value: String) -> String? {
    guard value.utf8.count == 36, let uuid = UUID(uuidString: value) else { return nil }
    return uuid.uuidString.uppercased()
  }

  private func canonicalWarningId(_ value: String) -> String? {
    guard value.utf8.count == 36, let uuid = UUID(uuidString: value) else { return nil }
    return uuid.uuidString.uppercased()
  }

  private func rotateWarning(in manifest: inout Manifest) {
    manifest.warningId = UUID().uuidString.uppercased()
  }

  private func markCorrupt(in manifest: inout Manifest) {
    manifest.corrupt = true
    rotateWarning(in: &manifest)
  }

  private func validDate(_ date: Date) -> Bool {
    date.timeIntervalSince1970.isFinite
  }

  private func validEntitlementTimestamp(_ timestamp: TimeInterval) -> Bool {
    timestamp.isFinite && timestamp >= 0
  }

  private func validLeaseShape(lifetime: Bool, expiresAt: TimeInterval?) -> Bool {
    !lifetime || expiresAt == nil
  }

  private func isEntitled(_ manifest: Manifest, at date: Date) -> Bool {
    let timestamp = date.timeIntervalSince1970
    guard validEntitlementTimestamp(timestamp) else { return false }
    let local = manifest.localEntitlementLifetime
      || manifest.localEntitlementExpiresAt.map { timestamp < $0 } == true
    let store = manifest.storeEntitlementLifetime
      || manifest.storeEntitlementExpiresAt.map { timestamp < $0 } == true
    return local || store
  }

  private func validAdmissionDate(_ date: Date, now: Date) -> Bool {
    let timestamp = date.timeIntervalSince1970
    let receiptTimestamp = now.timeIntervalSince1970
    guard timestamp.isFinite, receiptTimestamp.isFinite, timestamp >= 0 else { return false }
    return receiptTimestamp - timestamp <= Self.recordTTL
      && timestamp - receiptTimestamp <= Self.maxFutureSkew
  }

  private func validBody(_ body: String) -> Bool {
    let bytes = body.lengthOfBytes(using: .utf8)
    return bytes > 0 && bytes <= Self.maxBodyBytes
  }

  private func validSender(_ sender: String) -> Bool {
    guard !sender.isEmpty, sender.utf16.count <= Self.maxSenderCharacters else { return false }
    return !sender.unicodeScalars.contains { scalar in
      switch scalar.value {
      case 0x0000...0x001F, 0x007F...0x009F, 0x061C, 0x200B...0x200F,
           0x202A...0x202E, 0x2066...0x2069, 0xFEFF:
        return true
      default:
        return false
      }
    }
  }

  private func manifestURL(in root: URL) -> URL {
    root.appendingPathComponent("manifest.plist", isDirectory: false)
  }

  private func recordsDirectory(in root: URL, create: Bool) throws -> URL {
    let records = root.appendingPathComponent("records", isDirectory: true)
    if create {
      try FileManager.default.createDirectory(
        at: records,
        withIntermediateDirectories: true,
        attributes: [.protectionKey: Self.protection]
      )
    }
    return records
  }

  private func recordURL(id: String, in root: URL) -> URL {
    root
      .appendingPathComponent("records", isDirectory: true)
      .appendingPathComponent(id + ".json", isDirectory: false)
  }

  private static func encodeRecord(_ record: StoredRecord) throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return try encoder.encode(record)
  }

  private static func iso8601(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    return formatter.string(from: date)
  }

  private static func parseISO8601(_ value: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    return formatter.date(from: value)
  }

  private static func sha256(_ data: Data) -> String {
    var message = [UInt8](data)
    let bitLength = UInt64(message.count) * 8
    message.append(0x80)
    while message.count % 64 != 56 { message.append(0) }
    message.append(contentsOf: withUnsafeBytes(of: bitLength.bigEndian, Array.init))

    var hash: [UInt32] = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]
    let constants: [UInt32] = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
      0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
      0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
      0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
      0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
      0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
      0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
      0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
      0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ]

    for offset in stride(from: 0, to: message.count, by: 64) {
      var words = [UInt32](repeating: 0, count: 64)
      for index in 0..<16 {
        let start = offset + index * 4
        words[index] = UInt32(message[start]) << 24
          | UInt32(message[start + 1]) << 16
          | UInt32(message[start + 2]) << 8
          | UInt32(message[start + 3])
      }
      for index in 16..<64 {
        let s0 = rotateRight(words[index - 15], by: 7)
          ^ rotateRight(words[index - 15], by: 18)
          ^ (words[index - 15] >> 3)
        let s1 = rotateRight(words[index - 2], by: 17)
          ^ rotateRight(words[index - 2], by: 19)
          ^ (words[index - 2] >> 10)
        words[index] = words[index - 16] &+ s0 &+ words[index - 7] &+ s1
      }

      var a = hash[0]
      var b = hash[1]
      var c = hash[2]
      var d = hash[3]
      var e = hash[4]
      var f = hash[5]
      var g = hash[6]
      var h = hash[7]
      for index in 0..<64 {
        let sum1 = rotateRight(e, by: 6) ^ rotateRight(e, by: 11) ^ rotateRight(e, by: 25)
        let choice = (e & f) ^ ((~e) & g)
        let temporary1 = h &+ sum1 &+ choice &+ constants[index] &+ words[index]
        let sum0 = rotateRight(a, by: 2) ^ rotateRight(a, by: 13) ^ rotateRight(a, by: 22)
        let majority = (a & b) ^ (a & c) ^ (b & c)
        let temporary2 = sum0 &+ majority
        h = g
        g = f
        f = e
        e = d &+ temporary1
        d = c
        c = b
        b = a
        a = temporary1 &+ temporary2
      }
      hash[0] &+= a
      hash[1] &+= b
      hash[2] &+= c
      hash[3] &+= d
      hash[4] &+= e
      hash[5] &+= f
      hash[6] &+= g
      hash[7] &+= h
    }

    return hash.flatMap { word in
      withUnsafeBytes(of: word.bigEndian, Array.init)
    }.map { String(format: "%02x", $0) }.joined()
  }

  private static func rotateRight(_ value: UInt32, by amount: UInt32) -> UInt32 {
    (value >> amount) | (value << (32 - amount))
  }
}
