import Darwin
import Foundation

@_silgen_name("flock")
private func wafraTestFlock(_ descriptor: Int32, _ operation: Int32) -> Int32

@main
struct NativeLiveCaptureStoreTests {
  private static var passed = 0
  private static var failed = 0
  private static let knownSender = "KNOWN"
  private static let messageBody = "test-message-content"
  private static let fixedClock = Date(timeIntervalSince1970: 1_787_587_200)

  private static func check(_ name: String, _ condition: @autoclosure () throws -> Bool) {
    do {
      if try condition() {
        passed += 1
        print("✓ \(name)")
        return
      }
    } catch {
      // Source values and thrown error descriptions are intentionally omitted.
    }
    failed += 1
    print("✗ \(name)")
  }

  private static func expectsThrow(_ name: String, operation: () throws -> Void) {
    do {
      try operation()
      check(name, false)
    } catch {
      check(name, true)
    }
  }

  private static func expectsEntitlementRequired(
    _ name: String,
    operation: () throws -> Void
  ) {
    do {
      try operation()
      check(name, false)
    } catch WafraLiveCaptureStore.StoreError.entitlementRequired {
      check(name, true)
    } catch {
      check(name, false)
    }
  }

  private static func grantLifetimeAndEnable(_ store: WafraLiveCaptureStore) throws {
    _ = try store.setLocalEntitlementLease(expiresAt: nil, lifetime: true)
    try store.setCaptureEnabled(true)
  }

  private static func root(_ suffix: String) -> URL {
    FileManager.default.temporaryDirectory
      .appendingPathComponent("wafra-live-\(UUID().uuidString)-\(suffix)", isDirectory: true)
  }

  private static func store(
    root: URL,
    now: @escaping () -> Date = { fixedClock },
    senderIdentity: @escaping (String) -> WafraBankSenderIdentity? = { sender in
      sender == knownSender
        ? WafraBankSenderIdentity(market: "AE", bankId: "test-bank")
        : nil
    },
    acknowledgementRemoveItem: @escaping (URL) throws -> Void = {
      try FileManager.default.removeItem(at: $0)
    }
  ) -> WafraLiveCaptureStore {
    WafraLiveCaptureStore(
      root: root,
      now: now,
      senderIdentity: senderIdentity,
      acknowledgementRemoveItem: acknowledgementRemoveItem
    )
  }

  private static func eventId(_ value: Int) -> String {
    String(format: "00000000-0000-4000-8000-%012d", value)
  }

  private static func decoded(_ row: String) -> [String: Any]? {
    guard let data = row.data(using: .utf8) else { return nil }
    return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
  }

  private static func rowId(_ row: String) -> String? {
    decoded(row)?["id"] as? String
  }

  private static func remove(_ roots: [URL]) {
    for root in roots { try? FileManager.default.removeItem(at: root) }
  }

  private static func launchChild(_ arguments: [String]) throws -> Process {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
    process.arguments = arguments
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    try process.run()
    return process
  }

  private static func waitForExit(_ process: Process, timeout: TimeInterval) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while process.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.01) }
    guard process.isRunning else { return true }
    process.terminate()
    process.waitUntilExit()
    return false
  }

  private static func waitForFiles(_ files: [URL], timeout: TimeInterval) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if files.allSatisfy({ FileManager.default.fileExists(atPath: $0.path) }) { return true }
      Thread.sleep(forTimeInterval: 0.01)
    }
    return false
  }

  private static func runChildIfRequested() throws -> Bool {
    guard CommandLine.arguments.count >= 3 else { return false }
    let mode = CommandLine.arguments[1]
    let childRoot = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
    let childStore = store(root: childRoot)

    switch mode {
    case "child-stage":
      guard CommandLine.arguments.count == 4 else { Foundation.exit(90) }
      let result = try childStore.stage(
        sender: knownSender,
        body: messageBody,
        eventId: CommandLine.arguments[3],
        observedAt: fixedClock
      )
      Foundation.exit(result == .accepted ? 0 : 91)
    case "child-race-stage":
      guard CommandLine.arguments.count == 6 else { Foundation.exit(92) }
      try "ready".write(
        to: URL(fileURLWithPath: CommandLine.arguments[4]),
        atomically: true,
        encoding: .utf8
      )
      let result = try childStore.stage(
        sender: knownSender,
        body: messageBody,
        eventId: CommandLine.arguments[5],
        observedAt: fixedClock
      )
      try result.rawValue.write(
        to: URL(fileURLWithPath: CommandLine.arguments[3]),
        atomically: true,
        encoding: .utf8
      )
      Foundation.exit(0)
    case "child-race-disable":
      guard CommandLine.arguments.count == 5 else { Foundation.exit(93) }
      try "ready".write(
        to: URL(fileURLWithPath: CommandLine.arguments[4]),
        atomically: true,
        encoding: .utf8
      )
      try childStore.setCaptureEnabled(false)
      try "disabled".write(
        to: URL(fileURLWithPath: CommandLine.arguments[3]),
        atomically: true,
        encoding: .utf8
      )
      Foundation.exit(0)
    case "child-reentrant-now":
      var nestedRejected = false
      var reentrantStore: WafraLiveCaptureStore!
      reentrantStore = store(root: childRoot, now: {
        do {
          _ = try reentrantStore.status()
        } catch {
          nestedRejected = error is WafraLiveCaptureStore.StoreError
        }
        return fixedClock
      })
      try grantLifetimeAndEnable(reentrantStore)
      let result = try reentrantStore.stage(
        sender: knownSender,
        body: messageBody,
        eventId: eventId(60_000),
        observedAt: fixedClock
      )
      Foundation.exit(nestedRejected && result == .accepted ? 0 : 94)
    case "child-reentrant-sender":
      var nestedRejected = false
      var reentrantStore: WafraLiveCaptureStore!
      reentrantStore = store(root: childRoot, senderIdentity: { sender in
        do {
          _ = try reentrantStore.status()
        } catch {
          nestedRejected = error is WafraLiveCaptureStore.StoreError
        }
        return sender == knownSender
          ? WafraBankSenderIdentity(market: "AE", bankId: "test-bank")
          : nil
      })
      try grantLifetimeAndEnable(reentrantStore)
      let result = try reentrantStore.stage(
        sender: knownSender,
        body: messageBody,
        eventId: eventId(60_001),
        observedAt: fixedClock
      )
      Foundation.exit(nestedRejected && result == .accepted ? 0 : 95)
    default:
      return false
    }
  }

  static func main() throws {
    if try runChildIfRequested() { return }

    let basicRoot = root("basic")
    let validationRoot = root("validation")
    let orderingRoot = root("ordering")
    let precisionRoot = root("precision")
    let processRoot = root("process")
    let raceRoot = root("race")
    let reentrantNowRoot = root("reentrant-now")
    let reentrantSenderRoot = root("reentrant-sender")
    let expiryRoot = root("expiry")
    let expiryDeletionFailureRoot = root("expiry-deletion-failure")
    let countRoot = root("count-capacity")
    let byteRoot = root("byte-capacity")
    let corruptionRoot = root("corruption")
    let manifestCorruptionRoot = root("manifest-corruption")
    let regularOrphanRoot = root("regular-orphan")
    let hiddenOrphanRoot = root("hidden-orphan")
    let deletionFailureRoot = root("deletion-failure")
    let acknowledgementDeletionFailureRoot = root("ack-deletion-failure")
    let acknowledgedRetryRoot = root("acknowledged-retry")
    let partialManifestRoot = root("partial-manifest")
    let unicodeDigestRoot = root("unicode-digest")
    let milestoneRoot = root("milestones")
    let eraseRoot = root("erase")
    let localLeaseRoot = root("local-lease")
    let storeLeaseRoot = root("store-lease")
    let combinedLeaseRoot = root("combined-lease")
    let disabledPurgeRoot = root("disabled-purge")
    let oldManifestRoot = root("old-manifest")
    let malformedLeaseRoot = root("malformed-lease")
    let roots = [
      basicRoot, validationRoot, orderingRoot, precisionRoot, processRoot, raceRoot,
      reentrantNowRoot, reentrantSenderRoot, expiryRoot, expiryDeletionFailureRoot,
      countRoot, byteRoot, corruptionRoot, manifestCorruptionRoot, regularOrphanRoot,
      hiddenOrphanRoot, deletionFailureRoot, acknowledgementDeletionFailureRoot,
      acknowledgedRetryRoot, milestoneRoot, eraseRoot,
      partialManifestRoot, unicodeDigestRoot,
      localLeaseRoot, storeLeaseRoot, combinedLeaseRoot, disabledPurgeRoot,
      oldManifestRoot, malformedLeaseRoot,
    ]
    defer { remove(roots) }

    let basic = store(root: basicRoot)
    check("capture starts disabled", try basic.status().enabled == false)
    check("disabled-by-default state persists", try store(root: basicRoot).status().enabled == false)
    check(
      "disabled staging writes nothing",
      try basic.stage(
        sender: knownSender,
        body: messageBody,
        eventId: eventId(1),
        observedAt: fixedClock
      ) == .disabled
    )
    check("disabled staging leaves the queue empty", try basic.status().pending == 0)
    try basic.setCaptureEnabled(false)
    check("explicit disable always works without an entitlement lease", try !basic.status().enabled)
    expectsEntitlementRequired("capture cannot be enabled without a valid entitlement lease") {
      try basic.setCaptureEnabled(true)
    }
    check(
      "failed enablement preserves raw consent as disabled",
      try !basic.status().enabled && !basic.status().entitled
    )
    try grantLifetimeAndEnable(basic)
    check(
      "lifetime local entitlement survives a fresh store instance",
      try store(root: basicRoot).status().entitled
    )
    check(
      "known sender is staged",
      try basic.stage(
        sender: knownSender,
        body: messageBody,
        eventId: eventId(1),
        observedAt: fixedClock
      ) == .accepted
    )
    let basicRows = try basic.listPendingRecords(limit: 50)
    check("stable listing returns one record", basicRows.count == 1)
    let basicObject = basicRows.first.flatMap(decoded)
    check(
      "serialized record has the exact live-message shape",
      basicObject?["v"] as? Int == 1
        && basicObject?["id"] as? String == eventId(1)
        && basicObject?["text"] as? String == messageBody
        && basicObject?["sender"] as? String == knownSender
        && basicObject?["observedAt"] as? String == "2026-08-24T16:00:00.000Z"
        && basicObject?["source"] as? String == "message"
        && basicObject?.count == 6
    )
    check(
      "identical retry is idempotent",
      try basic.stage(
        sender: knownSender,
        body: messageBody,
        eventId: eventId(1),
        observedAt: fixedClock
      ) == .accepted && basic.status().pending == 1
    )
    let conflictResult = try basic.stage(
      sender: knownSender,
      body: messageBody + "-different",
      eventId: eventId(1),
      observedAt: fixedClock
    )
    let rowsAfterConflict = try basic.listPendingRecords(limit: 50)
    check(
      "conflicting event ID reuse is rejected",
      conflictResult == .invalid && rowsAfterConflict.count == 1
    )
    check(
      "conflicting event ID reuse leaves original serialized bytes unchanged",
      rowsAfterConflict == basicRows && decoded(rowsAfterConflict[0])?["text"] as? String == messageBody
    )
    try basic.acknowledgeRecords(ids: [eventId(1)])
    check("ack removes only the named snapshot row", try basic.status().pending == 0)
    try basic.acknowledgeRecords(ids: [eventId(1)])
    check("ack is idempotent for missing IDs", try basic.status().pending == 0)
    check("capture enablement persists", try store(root: basicRoot).status().enabled)

    var localLeaseClock = fixedClock
    let localLease = store(root: localLeaseRoot, now: { localLeaseClock })
    let localExpiry = fixedClock.addingTimeInterval(120)
    check(
      "first finite local lease is persisted",
      try localLease.setLocalEntitlementLease(expiresAt: localExpiry, lifetime: false)
    )
    try localLease.setCaptureEnabled(true)
    check(
      "finite local lease is entitled strictly before expiry",
      try localLease.status().enabled && localLease.status().entitled
    )
    check(
      "a later local lease cannot extend the persisted trial boundary",
      try !localLease.setLocalEntitlementLease(
        expiresAt: localExpiry.addingTimeInterval(120),
        lifetime: false
      )
    )
    check(
      "a shorter local lease can tighten the persisted trial boundary",
      try localLease.setLocalEntitlementLease(
        expiresAt: localExpiry.addingTimeInterval(-30),
        lifetime: false
      )
    )
    localLeaseClock = localExpiry.addingTimeInterval(-30)
    check(
      "finite local lease is denied at its exact expiry while consent remains enabled",
      try localLease.status().enabled && !localLease.status().entitled
    )
    check(
      "an expired lease makes staging fail closed without changing consent",
      try localLease.stage(
        sender: knownSender,
        body: messageBody,
        eventId: eventId(70_000),
        observedAt: localLeaseClock
      ) == .disabled && localLease.status().enabled
    )
    expectsEntitlementRequired("expired local lease cannot re-enable capture") {
      try localLease.setCaptureEnabled(true)
    }
    check(
      "founder lifetime can upgrade an expired finite local lease",
      try localLease.setLocalEntitlementLease(expiresAt: nil, lifetime: true)
        && localLease.status().entitled
    )
    check(
      "finite local input cannot downgrade founder lifetime",
      try !localLease.setLocalEntitlementLease(
        expiresAt: localLeaseClock.addingTimeInterval(300),
        lifetime: false
      ) && localLease.status().entitled
    )
    expectsThrow("local lease rejects the inactive nil shape") {
      _ = try localLease.setLocalEntitlementLease(expiresAt: nil, lifetime: false)
    }
    expectsThrow("local lease rejects lifetime plus an expiry") {
      _ = try localLease.setLocalEntitlementLease(expiresAt: localExpiry, lifetime: true)
    }
    expectsThrow("local lease rejects a non-finite expiry") {
      _ = try localLease.setLocalEntitlementLease(
        expiresAt: Date(timeIntervalSince1970: .nan),
        lifetime: false
      )
    }
    expectsThrow("local lease rejects a pre-epoch expiry") {
      _ = try localLease.setLocalEntitlementLease(
        expiresAt: Date(timeIntervalSince1970: -1),
        lifetime: false
      )
    }

    var storeLeaseClock = fixedClock
    let storeLease = store(root: storeLeaseRoot, now: { storeLeaseClock })
    let storeExpiry = fixedClock.addingTimeInterval(180)
    check(
      "newer finite store lease is persisted",
      try storeLease.setStoreEntitlementLease(
        expiresAt: storeExpiry,
        lifetime: false,
        verifiedAt: fixedClock
      )
    )
    check("finite store lease grants entitlement", try storeLease.status().entitled)
    check(
      "an identical store snapshot at the same revision is accepted idempotently",
      try storeLease.setStoreEntitlementLease(
        expiresAt: storeExpiry,
        lifetime: false,
        verifiedAt: fixedClock
      )
    )
    check(
      "a conflicting store snapshot at the same revision is ignored",
      try !storeLease.setStoreEntitlementLease(
        expiresAt: storeExpiry.addingTimeInterval(180),
        lifetime: false,
        verifiedAt: fixedClock
      )
    )
    check(
      "older inactive store snapshot is ignored",
      try !storeLease.setStoreEntitlementLease(
        expiresAt: nil,
        lifetime: false,
        verifiedAt: fixedClock.addingTimeInterval(-1)
      ) && storeLease.status().entitled
    )
    let renewedStoreExpiry = storeExpiry.addingTimeInterval(180)
    check(
      "newer store renewal replaces the expiry",
      try storeLease.setStoreEntitlementLease(
        expiresAt: renewedStoreExpiry,
        lifetime: false,
        verifiedAt: fixedClock.addingTimeInterval(1)
      )
    )
    storeLeaseClock = storeExpiry
    check("store renewal remains active beyond the prior expiry", try storeLease.status().entitled)
    check(
      "newer inactive store snapshot clears the grant and persists its revision",
      try storeLease.setStoreEntitlementLease(
        expiresAt: nil,
        lifetime: false,
        verifiedAt: fixedClock.addingTimeInterval(2)
      ) && !storeLease.status().entitled
    )
    check(
      "snapshot at the inactive revision cannot restore a store grant",
      try !storeLease.setStoreEntitlementLease(
        expiresAt: renewedStoreExpiry,
        lifetime: false,
        verifiedAt: fixedClock.addingTimeInterval(2)
      ) && !storeLease.status().entitled
    )
    check(
      "newer lifetime store lease grants entitlement",
      try storeLease.setStoreEntitlementLease(
        expiresAt: nil,
        lifetime: true,
        verifiedAt: fixedClock.addingTimeInterval(3)
      ) && storeLease.status().entitled
    )
    expectsThrow("store lease rejects lifetime plus an expiry") {
      _ = try storeLease.setStoreEntitlementLease(
        expiresAt: renewedStoreExpiry,
        lifetime: true,
        verifiedAt: fixedClock.addingTimeInterval(4)
      )
    }
    expectsThrow("store lease rejects a non-finite verification time") {
      _ = try storeLease.setStoreEntitlementLease(
        expiresAt: nil,
        lifetime: false,
        verifiedAt: Date(timeIntervalSince1970: .infinity)
      )
    }
    expectsThrow("store lease rejects a non-finite expiry") {
      _ = try storeLease.setStoreEntitlementLease(
        expiresAt: Date(timeIntervalSince1970: .nan),
        lifetime: false,
        verifiedAt: fixedClock.addingTimeInterval(4)
      )
    }
    expectsThrow("store lease rejects a pre-epoch verification time") {
      _ = try storeLease.setStoreEntitlementLease(
        expiresAt: nil,
        lifetime: false,
        verifiedAt: Date(timeIntervalSince1970: -1)
      )
    }

    var combinedLeaseClock = fixedClock
    let combinedLease = store(root: combinedLeaseRoot, now: { combinedLeaseClock })
    _ = try combinedLease.setLocalEntitlementLease(
      expiresAt: fixedClock.addingTimeInterval(60),
      lifetime: false
    )
    _ = try combinedLease.setStoreEntitlementLease(
      expiresAt: fixedClock.addingTimeInterval(120),
      lifetime: false,
      verifiedAt: fixedClock
    )
    combinedLeaseClock = fixedClock.addingTimeInterval(60)
    check(
      "effective entitlement uses the later valid local-or-store boundary",
      try combinedLease.status().entitled
    )
    combinedLeaseClock = fixedClock.addingTimeInterval(120)
    check(
      "effective entitlement is denied at the maximum exact expiry",
      try !combinedLease.status().entitled
    )

    var disabledPurgeClock = fixedClock
    let disabledPurge = store(root: disabledPurgeRoot, now: { disabledPurgeClock })
    try grantLifetimeAndEnable(disabledPurge)
    let disabledPurgeId = eventId(71_000)
    _ = try disabledPurge.stage(
      sender: knownSender,
      body: messageBody,
      eventId: disabledPurgeId,
      observedAt: disabledPurgeClock
    )
    let disabledPurgeFile = disabledPurgeRoot
      .appendingPathComponent("records", isDirectory: true)
      .appendingPathComponent(disabledPurgeId + ".json", isDirectory: false)
    try disabledPurge.setCaptureEnabled(false)
    disabledPurgeClock = fixedClock.addingTimeInterval(WafraLiveCaptureStore.recordTTL + 1)
    let disabledPurgeResult = try disabledPurge.stage(
      sender: knownSender,
      body: messageBody,
      eventId: eventId(71_001),
      observedAt: disabledPurgeClock
    )
    check(
      "disabled staging physically purges expired source before denying admission",
      try disabledPurgeResult == .disabled
        && !FileManager.default.fileExists(atPath: disabledPurgeFile.path)
        && disabledPurge.status().pending == 0
    )

    let oldManifestSeed = store(root: oldManifestRoot)
    try grantLifetimeAndEnable(oldManifestSeed)
    _ = try oldManifestSeed.stage(
      sender: knownSender,
      body: messageBody,
      eventId: eventId(72_000),
      observedAt: fixedClock
    )
    let oldManifestURL = oldManifestRoot.appendingPathComponent("manifest.plist")
    var oldManifest = try PropertyListSerialization.propertyList(
      from: Data(contentsOf: oldManifestURL),
      format: nil
    ) as! [String: Any]
    for key in [
      "localEntitlementLifetime", "localEntitlementExpiresAt",
      "storeEntitlementLifetime", "storeEntitlementExpiresAt", "storeEntitlementVerifiedAt",
    ] {
      oldManifest.removeValue(forKey: key)
    }
    try PropertyListSerialization.data(
      fromPropertyList: oldManifest,
      format: .binary,
      options: 0
    ).write(to: oldManifestURL, options: .atomic)
    let migratedOldManifest = store(root: oldManifestRoot)
    let oldManifestStage = try migratedOldManifest.stage(
      sender: knownSender,
      body: messageBody,
      eventId: eventId(72_001),
      observedAt: fixedClock
    )
    let oldManifestStatus = try migratedOldManifest.status()
    check(
      "old enabled manifest without lease migrates fail closed without deleting pending source",
      oldManifestStage == .disabled
        && oldManifestStatus.enabled
        && !oldManifestStatus.entitled
        && oldManifestStatus.pending == 1
    )

    let malformedLeaseSeed = store(root: malformedLeaseRoot)
    try grantLifetimeAndEnable(malformedLeaseSeed)
    _ = try malformedLeaseSeed.stage(
      sender: knownSender,
      body: messageBody,
      eventId: eventId(73_000),
      observedAt: fixedClock
    )
    let malformedLeaseURL = malformedLeaseRoot.appendingPathComponent("manifest.plist")
    var malformedLease = try PropertyListSerialization.propertyList(
      from: Data(contentsOf: malformedLeaseURL),
      format: nil
    ) as! [String: Any]
    malformedLease["localEntitlementLifetime"] = true
    malformedLease["localEntitlementExpiresAt"] = fixedClock.addingTimeInterval(60)
      .timeIntervalSince1970
    try PropertyListSerialization.data(
      fromPropertyList: malformedLease,
      format: .binary,
      options: 0
    ).write(to: malformedLeaseURL, options: .atomic)
    let malformedLeaseStatus = try store(root: malformedLeaseRoot).status()
    check(
      "malformed entitlement metadata fails closed through the corruption tombstone",
      !malformedLeaseStatus.enabled
        && !malformedLeaseStatus.entitled
        && malformedLeaseStatus.pending == 0
        && malformedLeaseStatus.corrupt
    )

    var identityInput: String?
    let validation = store(root: validationRoot, senderIdentity: { sender in
      identityInput = sender
      return sender == knownSender
        ? WafraBankSenderIdentity(market: "AE", bankId: "test-bank")
        : nil
    })
    var identityCalls = 0
    let disabledIdentityRoot = root("disabled-identity")
    let disabledIdentityStore = store(root: disabledIdentityRoot, senderIdentity: { _ in
      identityCalls += 1
      return WafraBankSenderIdentity(market: "AE", bankId: "test-bank")
    })
    defer { remove([disabledIdentityRoot]) }
    _ = try disabledIdentityStore.stage(
      sender: knownSender,
      body: messageBody,
      eventId: eventId(2),
      observedAt: fixedClock
    )
    check("disabled admission fails before sender inspection", identityCalls == 0)
    try grantLifetimeAndEnable(validation)
    check(
      "unknown sender is ignored",
      try validation.stage(
        sender: "UNKNOWN",
        body: messageBody,
        eventId: eventId(3),
        observedAt: fixedClock
      ) == .ignored
    )
    check(
      "substring sender is ignored",
      try validation.stage(
        sender: knownSender + "-suffix",
        body: messageBody,
        eventId: eventId(4),
        observedAt: fixedClock
      ) == .ignored
    )
    check(
      "sender identity injection receives the exact input",
      try validation.stage(
        sender: knownSender,
        body: messageBody,
        eventId: eventId(5),
        observedAt: fixedClock
      ) == .accepted && identityInput == knownSender
    )
    check(
      "invalid UUID is rejected",
      try validation.stage(
        sender: knownSender,
        body: messageBody,
        eventId: "not-an-id",
        observedAt: fixedClock
      ) == .invalid
    )
    check(
      "invalid date is rejected",
      try validation.stage(
        sender: knownSender,
        body: messageBody,
        eventId: eventId(6),
        observedAt: Date(timeIntervalSince1970: .nan)
      ) == .invalid
    )
    check(
      "negative observed date is rejected at native admission",
      try validation.stage(
        sender: knownSender,
        body: messageBody,
        eventId: eventId(61),
        observedAt: Date(timeIntervalSince1970: -0.001)
      ) == .invalid
    )
    check(
      "record at the native 30-day admission boundary is accepted",
      try validation.stage(
        sender: knownSender,
        body: messageBody,
        eventId: eventId(62),
        observedAt: fixedClock.addingTimeInterval(-WafraLiveCaptureStore.recordTTL)
      ) == .accepted
    )
    check(
      "already-expired record is rejected at native admission",
      try validation.stage(
        sender: knownSender,
        body: messageBody,
        eventId: eventId(63),
        observedAt: fixedClock.addingTimeInterval(-WafraLiveCaptureStore.recordTTL - 0.001)
      ) == .invalid
    )
    check(
      "record at the native future-skew boundary is accepted",
      try validation.stage(
        sender: knownSender,
        body: messageBody,
        eventId: eventId(64),
        observedAt: fixedClock.addingTimeInterval(WafraLiveCaptureStore.maxFutureSkew)
      ) == .accepted
    )
    check(
      "record beyond native future skew is rejected",
      try validation.stage(
        sender: knownSender,
        body: messageBody,
        eventId: eventId(65),
        observedAt: fixedClock.addingTimeInterval(WafraLiveCaptureStore.maxFutureSkew + 0.001)
      ) == .invalid
    )
    check(
      "empty body is rejected",
      try validation.stage(
        sender: knownSender,
        body: "",
        eventId: eventId(7),
        observedAt: fixedClock
      ) == .invalid
    )
    check(
      "oversized body is rejected",
      try validation.stage(
        sender: knownSender,
        body: String(repeating: "x", count: 16 * 1024 + 1),
        eventId: eventId(8),
        observedAt: fixedClock
      ) == .invalid
    )
    for (index, sender) in ["", String(repeating: "x", count: 81), "KNOWN\u{202E}", "KNOWN\u{0000}"]
      .enumerated()
    {
      check(
        "invalid sender case \(index + 1) is rejected",
        try validation.stage(
          sender: sender,
          body: messageBody,
          eventId: eventId(20 + index),
          observedAt: fixedClock
        ) == .invalid
      )
    }

    let ordering = store(root: orderingRoot)
    try grantLifetimeAndEnable(ordering)
    _ = try ordering.stage(
      sender: knownSender,
      body: messageBody,
      eventId: eventId(102),
      observedAt: fixedClock.addingTimeInterval(10)
    )
    _ = try ordering.stage(
      sender: knownSender,
      body: messageBody,
      eventId: eventId(101),
      observedAt: fixedClock
    )
    _ = try ordering.stage(
      sender: knownSender,
      body: messageBody,
      eventId: eventId(100),
      observedAt: fixedClock
    )
    let ordered = try ordering.listPendingRecords(limit: 50)
    check(
      "listing sorts by observed date and then ID",
      ordered.compactMap(rowId) == [eventId(100), eventId(101), eventId(102)]
    )
    check("negative list limit is empty", try ordering.listPendingRecords(limit: -1).isEmpty)
    check("listing is capped at 50", try ordering.listPendingRecords(limit: 500).count == 3)
    let snapshot = try ordering.listPendingRecords(limit: 2)
    _ = try ordering.stage(
      sender: knownSender,
      body: messageBody,
      eventId: eventId(103),
      observedAt: fixedClock.addingTimeInterval(20)
    )
    try ordering.acknowledgeRecords(ids: snapshot.compactMap(rowId))
    check(
      "acknowledgement cannot remove an append after the snapshot",
      try ordering.listPendingRecords(limit: 50).compactMap(rowId) == [eventId(102), eventId(103)]
    )
    expectsThrow("acknowledgement rejects more than 50 IDs") {
      try ordering.acknowledgeRecords(ids: (0...50).map(eventId))
    }
    expectsThrow("acknowledgement rejects a non-UUID ID") {
      try ordering.acknowledgeRecords(ids: ["not-an-id"])
    }
    try ordering.acknowledgeRecords(ids: (1...50).map { eventId(1_000 + $0) })
    check("acknowledgement accepts exactly 50 missing IDs", try ordering.status().pending == 2)

    var refuseAcknowledgementDeletion = true
    let acknowledgementDeletionFailure = store(
      root: acknowledgementDeletionFailureRoot,
      acknowledgementRemoveItem: { url in
        if refuseAcknowledgementDeletion { throw CocoaError(.fileWriteNoPermission) }
        try FileManager.default.removeItem(at: url)
      }
    )
    try grantLifetimeAndEnable(acknowledgementDeletionFailure)
    let acknowledgementDeletionFailureId = eventId(104)
    _ = try acknowledgementDeletionFailure.stage(
      sender: knownSender,
      body: messageBody,
      eventId: acknowledgementDeletionFailureId,
      observedAt: fixedClock
    )
    expectsThrow("acknowledgement fails while source bytes cannot be deleted") {
      try acknowledgementDeletionFailure.acknowledgeRecords(
        ids: [acknowledgementDeletionFailureId]
      )
    }
    check(
      "failed source deletion leaves the record durably pending for retry",
      try acknowledgementDeletionFailure.status().pending == 1
    )
    refuseAcknowledgementDeletion = false
    try acknowledgementDeletionFailure.acknowledgeRecords(
      ids: [acknowledgementDeletionFailureId]
    )
    check(
      "acknowledgement succeeds after source deletion becomes possible",
      try acknowledgementDeletionFailure.status().pending == 0
    )

    let precision = store(root: precisionRoot)
    try grantLifetimeAndEnable(precision)
    let submillisecondDate = Date(timeIntervalSince1970: fixedClock.timeIntervalSince1970 + 0.123456)
    _ = try precision.stage(
      sender: knownSender,
      body: messageBody,
      eventId: eventId(1_500),
      observedAt: submillisecondDate
    )
    check(
      "submillisecond observed dates remain readable",
      try precision.listPendingRecords(limit: 1).count == 1 && !precision.status().corrupt
    )

    let processStore = store(root: processRoot)
    try grantLifetimeAndEnable(processStore)
    let children = try (0..<24).map {
      try launchChild(["child-stage", processRoot.path, eventId(2_000 + $0)])
    }
    for child in children { child.waitUntilExit() }
    check("child processes serialize without lost appends", children.allSatisfy { $0.terminationStatus == 0 })
    check("interprocess contention preserves every append", try processStore.status().pending == 24)

    let raceStore = store(root: raceRoot)
    try grantLifetimeAndEnable(raceStore)
    let stageResultURL = raceRoot.appendingPathComponent("stage-result")
    let disableResultURL = raceRoot.appendingPathComponent("disable-result")
    let stageReadyURL = raceRoot.appendingPathComponent("stage-ready")
    let disableReadyURL = raceRoot.appendingPathComponent("disable-ready")
    let heldLockDescriptor = Darwin.open(
      raceRoot.appendingPathComponent(".lock").path,
      O_RDWR
    )
    guard heldLockDescriptor >= 0, wafraTestFlock(heldLockDescriptor, LOCK_EX) == 0 else {
      Foundation.exit(96)
    }
    let stageChild = try launchChild([
      "child-race-stage", raceRoot.path, stageResultURL.path, stageReadyURL.path,
      eventId(3_000),
    ])
    let disableChild = try launchChild([
      "child-race-disable", raceRoot.path, disableResultURL.path, disableReadyURL.path,
    ])
    let childrenReachedHeldLock = waitForFiles(
      [stageReadyURL, disableReadyURL],
      timeout: 2
    ) && stageChild.isRunning && disableChild.isRunning
    _ = wafraTestFlock(heldLockDescriptor, LOCK_UN)
    Darwin.close(heldLockDescriptor)
    stageChild.waitUntilExit()
    disableChild.waitUntilExit()
    let raceStageResult = try String(contentsOf: stageResultURL, encoding: .utf8)
    let raceStatus = try raceStore.status()
    check("disable and stage children overlap behind a held lock", childrenReachedHeldLock)
    check("disable and stage children both complete", stageChild.terminationStatus == 0 && disableChild.terminationStatus == 0)
    check("disable-versus-stage leaves admission disabled", raceStatus.enabled == false)
    check(
      "disable-versus-stage is ordered without a partial write",
      (raceStageResult == WafraLiveStageResult.accepted.rawValue && raceStatus.pending == 1)
        || (raceStageResult == WafraLiveStageResult.disabled.rawValue && raceStatus.pending == 0)
    )

    let reentrantNowChild = try launchChild(["child-reentrant-now", reentrantNowRoot.path])
    let reentrantNowCompleted = waitForExit(reentrantNowChild, timeout: 2)
    check(
      "reentrant now callback fails promptly without deadlocking",
      reentrantNowCompleted && reentrantNowChild.terminationStatus == 0
    )
    let reentrantSenderChild = try launchChild([
      "child-reentrant-sender", reentrantSenderRoot.path,
    ])
    let reentrantSenderCompleted = waitForExit(reentrantSenderChild, timeout: 2)
    check(
      "reentrant sender callback fails promptly without deadlocking",
      reentrantSenderCompleted && reentrantSenderChild.terminationStatus == 0
    )

    var expiryClock = fixedClock
    let expiry = store(root: expiryRoot, now: { expiryClock })
    try grantLifetimeAndEnable(expiry)
    _ = try expiry.stage(
      sender: knownSender,
      body: messageBody,
      eventId: eventId(4_000),
      observedAt: expiryClock
    )
    expiryClock = expiryClock.addingTimeInterval(30 * 24 * 60 * 60)
    check("record at the 30-day boundary is retained", try expiry.purgeExpired() == 0)
    expiryClock = expiryClock.addingTimeInterval(1)
    check("record older than 30 days expires", try expiry.purgeExpired() == 1)
    check("expired record is absent", try expiry.status().pending == 0)
    _ = try expiry.stage(
      sender: knownSender,
      body: messageBody,
      eventId: eventId(4_001),
      observedAt: expiryClock
    )
    expiryClock = expiryClock.addingTimeInterval((30 * 24 * 60 * 60) + 1)
    check(
      "status access physically removes logically expired source records",
      try expiry.status().pending == 0
    )
    let missingExpiryId = eventId(4_050)
    _ = try expiry.stage(
      sender: knownSender,
      body: messageBody,
      eventId: missingExpiryId,
      observedAt: expiryClock
    )
    try expiry.setCaptureEnabled(false)
    expiryClock = expiryClock.addingTimeInterval(WafraLiveCaptureStore.recordTTL + 1)
    try FileManager.default.removeItem(
      at: expiryRoot
        .appendingPathComponent("records", isDirectory: true)
        .appendingPathComponent(missingExpiryId + ".json")
    )
    check(
      "disabled-stage expiry treats a crash-deleted source file as completed cleanup",
      try expiry.stage(
        sender: knownSender,
        body: messageBody,
        eventId: eventId(4_051),
        observedAt: expiryClock
      ) == .disabled && expiry.status().pending == 0
    )

    var expiryDeletionClock = fixedClock
    let expiryDeletionFailure = store(
      root: expiryDeletionFailureRoot,
      now: { expiryDeletionClock }
    )
    try grantLifetimeAndEnable(expiryDeletionFailure)
    let expiryDeletionId = eventId(4_002)
    _ = try expiryDeletionFailure.stage(
      sender: knownSender,
      body: messageBody,
      eventId: expiryDeletionId,
      observedAt: expiryDeletionClock
    )
    try expiryDeletionFailure.setCaptureEnabled(false)
    expiryDeletionClock = expiryDeletionClock.addingTimeInterval(
      WafraLiveCaptureStore.recordTTL + 1
    )
    let expiryDeletionDirectory = expiryDeletionFailureRoot.appendingPathComponent(
      "records",
      isDirectory: true
    )
    let expiryDeletionFile = expiryDeletionDirectory.appendingPathComponent(
      expiryDeletionId + ".json"
    )
    try FileManager.default.setAttributes(
      [.posixPermissions: 0o500],
      ofItemAtPath: expiryDeletionDirectory.path
    )
    expectsThrow("failed expiry deletion keeps the disabled-stage retry durable") {
      _ = try expiryDeletionFailure.stage(
        sender: knownSender,
        body: messageBody,
        eventId: eventId(4_003),
        observedAt: expiryDeletionClock
      )
    }
    let expiryDeletionManifest = try PropertyListSerialization.propertyList(
      from: Data(contentsOf: expiryDeletionFailureRoot.appendingPathComponent("manifest.plist")),
      options: [],
      format: nil
    ) as! [String: Any]
    let retainedExpiryRecords = expiryDeletionManifest["records"] as! [String: Any]
    check(
      "failed expiry deletion retains its manifest reference and raw file for retry",
      retainedExpiryRecords[expiryDeletionId] != nil
        && FileManager.default.fileExists(atPath: expiryDeletionFile.path)
    )
    try FileManager.default.setAttributes(
      [.posixPermissions: 0o700],
      ofItemAtPath: expiryDeletionDirectory.path
    )
    check(
      "the next disabled stage physically completes the promised expiry deletion",
      try expiryDeletionFailure.stage(
        sender: knownSender,
        body: messageBody,
        eventId: eventId(4_004),
        observedAt: expiryDeletionClock
      ) == .disabled
        && !FileManager.default.fileExists(atPath: expiryDeletionFile.path)
        && expiryDeletionFailure.status().pending == 0
    )

    let countCapacity = store(root: countRoot)
    try grantLifetimeAndEnable(countCapacity)
    var countAccepted = true
    for index in 0..<2_000 {
      if try countCapacity.stage(
        sender: knownSender,
        body: "x",
        eventId: eventId(10_000 + index),
        observedAt: fixedClock
      ) != .accepted { countAccepted = false; break }
    }
    let countCapacityStatus = try countCapacity.status()
    check(
      "record capacity accepts 2,000 records",
      countAccepted && countCapacityStatus.pending == 2_000
    )
    check(
      "record capacity rejects the next record",
      try countCapacity.stage(
        sender: knownSender,
        body: "x",
        eventId: eventId(12_001),
        observedAt: fixedClock
      ) == .capacityReached
    )
    let firstCapacityWarning = try countCapacity.status()
    check(
      "record capacity increments a source-free dropped count with an opaque warning ID",
      firstCapacityWarning.dropped == 1 && firstCapacityWarning.warningId != nil
    )
    check(
      "an unrelated warning ID cannot clear dropped evidence",
      try !countCapacity.acknowledgeCaptureWarning(
        id: "00000000-0000-0000-0000-000000000001"
      ) && countCapacity.status().dropped == 1
    )
    _ = try countCapacity.stage(
      sender: knownSender,
      body: "x",
      eventId: eventId(12_002),
      observedAt: fixedClock
    )
    let newerCapacityWarning = try countCapacity.status()
    check(
      "a new drop rotates the warning ID and refuses a stale acknowledgement",
      try newerCapacityWarning.warningId != firstCapacityWarning.warningId
        && !countCapacity.acknowledgeCaptureWarning(id: firstCapacityWarning.warningId!)
        && countCapacity.status().dropped == 2
    )
    try countCapacity.recordSetupProof(version: 1, at: fixedClock)
    check(
      "matching warning acknowledgement preserves pending records, proof, and enablement",
      try countCapacity.acknowledgeCaptureWarning(id: newerCapacityWarning.warningId!)
        && countCapacity.status().dropped == 0
        && countCapacity.status().pending == 2_000
        && countCapacity.status().setupProofVersion == 1
        && countCapacity.status().enabled
    )

    let byteCapacity = store(root: byteRoot)
    try grantLifetimeAndEnable(byteCapacity)
    let largeBody = String(repeating: "x", count: 16 * 1024)
    var byteResult = WafraLiveStageResult.accepted
    var byteIndex = 0
    while byteResult == .accepted && byteIndex < 2_000 {
      byteResult = try byteCapacity.stage(
        sender: knownSender,
        body: largeBody,
        eventId: eventId(20_000 + byteIndex),
        observedAt: fixedClock
      )
      byteIndex += 1
    }
    let storedRecordFiles = try FileManager.default.contentsOfDirectory(
      at: byteRoot.appendingPathComponent("records", isDirectory: true),
      includingPropertiesForKeys: [.fileSizeKey]
    ).filter { $0.pathExtension == "json" }
    let storedRecordBytes = try storedRecordFiles.reduce(0) { total, file in
      total + (try file.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0)
    }
    let oneSerializedRecordBytes = try storedRecordFiles[0]
      .resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
    check(
      "serialized byte capacity uses the exact 8 MiB threshold",
      byteResult == .capacityReached
        && byteIndex < 2_000
        && storedRecordBytes <= 8 * 1024 * 1024
        && storedRecordBytes + oneSerializedRecordBytes > 8 * 1024 * 1024
    )
    let byteManifest = byteRoot.appendingPathComponent("manifest.plist")
    let byteMetadata = try String(decoding: Data(contentsOf: byteManifest), as: UTF8.self)
    check("persistent status metadata contains no message source", !byteMetadata.contains(knownSender) && !byteMetadata.contains(largeBody))

    let corrupt = store(root: corruptionRoot)
    try grantLifetimeAndEnable(corrupt)
    _ = try corrupt.stage(
      sender: knownSender,
      body: messageBody,
      eventId: eventId(30_000),
      observedAt: fixedClock
    )
    let recordsDirectory = corruptionRoot.appendingPathComponent("records", isDirectory: true)
    let corruptFile = try FileManager.default.contentsOfDirectory(
      at: recordsDirectory,
      includingPropertiesForKeys: nil
    ).first { $0.pathExtension == "json" }!
    try Data("not-json".utf8).write(to: corruptFile, options: .atomic)
    check("corrupt records are hidden from listing", try corrupt.listPendingRecords(limit: 50).isEmpty)
    let corruptStatus = try corrupt.status()
    check(
      "corruption sets a source-free tombstone status with an opaque warning ID",
      corruptStatus.corrupt && corruptStatus.pending == 0 && corruptStatus.warningId != nil
    )
    check("corrupt record deletion is attempted after tombstoning", !FileManager.default.fileExists(atPath: corruptFile.path))
    check(
      "matching warning acknowledgement clears a repaired corruption tombstone",
      try corrupt.acknowledgeCaptureWarning(id: corruptStatus.warningId!)
        && !corrupt.status().corrupt
        && corrupt.status().warningId == nil
    )

    let corruptManifestStore = store(root: manifestCorruptionRoot)
    try grantLifetimeAndEnable(corruptManifestStore)
    _ = try corruptManifestStore.stage(
      sender: knownSender,
      body: messageBody,
      eventId: eventId(31_000),
      observedAt: fixedClock
    )
    let corruptManifestURL = manifestCorruptionRoot.appendingPathComponent("manifest.plist")
    try Data("not-a-manifest".utf8).write(to: corruptManifestURL, options: .atomic)
    let recoveredManifestStatus = try corruptManifestStore.status()
    check(
      "manifest corruption fails closed with an empty tombstone",
      !recoveredManifestStatus.enabled && recoveredManifestStatus.pending == 0 && recoveredManifestStatus.corrupt
    )
    check("manifest corruption removes source records after tombstoning", try corruptManifestStore.listPendingRecords(limit: 50).isEmpty)

    let regularOrphanStore = store(root: regularOrphanRoot)
    _ = try regularOrphanStore.status()
    let regularOrphanDirectory = regularOrphanRoot.appendingPathComponent("records", isDirectory: true)
    try FileManager.default.createDirectory(at: regularOrphanDirectory, withIntermediateDirectories: true)
    let regularOrphan = regularOrphanDirectory.appendingPathComponent("unpublished-record.json")
    try Data(messageBody.utf8).write(to: regularOrphan, options: .atomic)
    let regularOrphanStatus = try regularOrphanStore.status()
    check(
      "regular orphan publishes corruption status and is deleted",
      regularOrphanStatus.corrupt && !FileManager.default.fileExists(atPath: regularOrphan.path)
    )

    let hiddenOrphanStore = store(root: hiddenOrphanRoot)
    _ = try hiddenOrphanStore.status()
    let hiddenOrphanDirectory = hiddenOrphanRoot.appendingPathComponent("records", isDirectory: true)
    try FileManager.default.createDirectory(at: hiddenOrphanDirectory, withIntermediateDirectories: true)
    let hiddenOrphan = hiddenOrphanDirectory.appendingPathComponent(".atomic-write-remnant")
    try Data(messageBody.utf8).write(to: hiddenOrphan, options: .atomic)
    let hiddenOrphanStatus = try hiddenOrphanStore.status()
    check(
      "hidden orphan publishes corruption status and is deleted",
      hiddenOrphanStatus.corrupt && !FileManager.default.fileExists(atPath: hiddenOrphan.path)
    )

    let deletionFailureStore = store(root: deletionFailureRoot)
    _ = try deletionFailureStore.status()
    let deletionFailureDirectory = deletionFailureRoot.appendingPathComponent("records", isDirectory: true)
    try FileManager.default.createDirectory(at: deletionFailureDirectory, withIntermediateDirectories: true)
    let undeletableOrphan = deletionFailureDirectory.appendingPathComponent(".undeletable-remnant")
    try Data(messageBody.utf8).write(to: undeletableOrphan, options: .atomic)
    try FileManager.default.setAttributes(
      [.posixPermissions: 0o500],
      ofItemAtPath: deletionFailureDirectory.path
    )
    let deletionFailureStatus = try deletionFailureStore.status()
    let sourceFreeTombstone = try Data(
      contentsOf: deletionFailureRoot.appendingPathComponent("manifest.plist")
    )
    check(
      "corrupt tombstone is durable before a failed orphan deletion",
      deletionFailureStatus.corrupt
        && FileManager.default.fileExists(atPath: undeletableOrphan.path)
        && !sourceFreeTombstone.contains(Data(messageBody.utf8))
    )
    try FileManager.default.setAttributes(
      [.posixPermissions: 0o700],
      ofItemAtPath: deletionFailureDirectory.path
    )

    var acknowledgedClock = fixedClock
    let acknowledgedRetry = store(root: acknowledgedRetryRoot, now: { acknowledgedClock })
    try grantLifetimeAndEnable(acknowledgedRetry)
    _ = try acknowledgedRetry.stage(
      sender: knownSender,
      body: messageBody,
      eventId: eventId(32_000),
      observedAt: fixedClock
    )
    try acknowledgedRetry.acknowledgeRecords(ids: [eventId(32_000)])
    let acknowledgedManifest = try Data(
      contentsOf: acknowledgedRetryRoot.appendingPathComponent("manifest.plist")
    )
    let acknowledgedPropertyList = try PropertyListSerialization.propertyList(
      from: acknowledgedManifest,
      format: nil
    ) as? [String: Any]
    let acknowledgedRows = acknowledgedPropertyList?["acknowledged"] as? [String: Any]
    let acknowledgedRow = acknowledgedRows?[eventId(32_000)] as? [String: Any]
    check(
      "acknowledgement stores the canonical SHA-256 digest",
      acknowledgedRow?["digest"] as? String
        == "93a9ddbe6bba3735d27ad973c6d594ec9b7932b2e9aea3678cc010f50aa82e88"
    )
    let identicalAfterAck = try acknowledgedRetry.stage(
      sender: knownSender,
      body: messageBody,
      eventId: eventId(32_000),
      observedAt: fixedClock
    )
    let identicalAfterAckStatus = try acknowledgedRetry.status()
    check(
      "identical retry after acknowledgement is accepted without restaging source",
      identicalAfterAck == .accepted && identicalAfterAckStatus.pending == 0
    )
    let conflictingAfterAck = try acknowledgedRetry.stage(
      sender: knownSender,
      body: messageBody + "-different",
      eventId: eventId(32_000),
      observedAt: fixedClock
    )
    let conflictingAfterAckStatus = try acknowledgedRetry.status()
    check(
      "conflicting reuse after acknowledgement is rejected without restaging source",
      conflictingAfterAck == .invalid && conflictingAfterAckStatus.pending == 0
    )
    check(
      "acknowledged retry metadata retains no source content",
      !acknowledgedManifest.contains(Data(messageBody.utf8))
        && !acknowledgedManifest.contains(Data(knownSender.utf8))
    )
    acknowledgedClock = fixedClock.addingTimeInterval(30 * 24 * 60 * 60 + 1)
    let afterWindow = try acknowledgedRetry.stage(
      sender: knownSender,
      body: messageBody + "-after-window",
      eventId: eventId(32_000),
      observedAt: acknowledgedClock
    )
    let afterWindowStatus = try acknowledgedRetry.status()
    check(
      "acknowledged retry tombstone expires after 30 days",
      afterWindow == .accepted && afterWindowStatus.pending == 1
    )

    try FileManager.default.createDirectory(
      at: partialManifestRoot,
      withIntermediateDirectories: true
    )
    let partialRecords = partialManifestRoot.appendingPathComponent("records", isDirectory: true)
    try FileManager.default.createDirectory(at: partialRecords, withIntermediateDirectories: true)
    let partialSource = partialRecords.appendingPathComponent("source-remnant.json")
    try Data(messageBody.utf8).write(to: partialSource, options: .atomic)
    try FileManager.default.setAttributes([.immutable: true], ofItemAtPath: partialSource.path)
    let partialData = try PropertyListSerialization.data(
      fromPropertyList: ["enabled": true],
      format: .binary,
      options: 0
    )
    try partialData.write(
      to: partialManifestRoot.appendingPathComponent("manifest.plist"),
      options: .atomic
    )
    let partialStatus = try store(root: partialManifestRoot).status()
    let partialTombstone = try PropertyListSerialization.propertyList(
      from: Data(contentsOf: partialManifestRoot.appendingPathComponent("manifest.plist")),
      format: nil
    ) as? [String: Any]
    check(
      "decodable partial manifest fails closed before source deletion",
      !partialStatus.enabled
        && partialStatus.corrupt
        && partialTombstone?["enabled"] as? Bool == false
        && partialTombstone?["corrupt"] as? Bool == true
        && FileManager.default.fileExists(atPath: partialSource.path)
    )
    try FileManager.default.setAttributes([.immutable: false], ofItemAtPath: partialSource.path)

    let unicodeDigestStore = store(root: unicodeDigestRoot)
    try grantLifetimeAndEnable(unicodeDigestStore)
    _ = try unicodeDigestStore.stage(
      sender: knownSender,
      body: messageBody,
      eventId: eventId(33_000),
      observedAt: fixedClock
    )
    try unicodeDigestStore.acknowledgeRecords(ids: [eventId(33_000)])
    let unicodeManifestURL = unicodeDigestRoot.appendingPathComponent("manifest.plist")
    var unicodeManifest = try PropertyListSerialization.propertyList(
      from: Data(contentsOf: unicodeManifestURL),
      format: nil
    ) as! [String: Any]
    var unicodeAcknowledged = unicodeManifest["acknowledged"] as! [String: Any]
    var unicodeAcknowledgement = unicodeAcknowledged[eventId(33_000)] as! [String: Any]
    unicodeAcknowledgement["digest"] = String(repeating: "ａ", count: 64)
    unicodeAcknowledged[eventId(33_000)] = unicodeAcknowledgement
    unicodeManifest["acknowledged"] = unicodeAcknowledged
    let unicodeManifestData = try PropertyListSerialization.data(
      fromPropertyList: unicodeManifest,
      format: .binary,
      options: 0
    )
    try unicodeManifestData.write(to: unicodeManifestURL, options: .atomic)
    let unicodeDigestStatus = try unicodeDigestStore.status()
    check(
      "non-ASCII digest metadata is treated as corrupt",
      !unicodeDigestStatus.enabled && unicodeDigestStatus.corrupt
    )

    let milestones = store(root: milestoneRoot)
    try milestones.recordSetupProof(version: 1, at: fixedClock)
    var milestoneStatus = try milestones.status()
    check(
      "setup proof persists version and timestamp",
      milestoneStatus.setupProofVersion == 1 && milestoneStatus.setupProofAt == fixedClock.timeIntervalSince1970
    )
    try milestones.recordFirstCapturedAt(fixedClock.addingTimeInterval(20))
    try milestones.recordFirstCapturedAt(fixedClock.addingTimeInterval(40))
    try milestones.recordFirstCapturedAt(fixedClock.addingTimeInterval(10))
    milestoneStatus = try milestones.status()
    check(
      "first-captured milestone preserves the earliest value",
      milestoneStatus.firstCapturedAt == fixedClock.addingTimeInterval(10).timeIntervalSince1970
    )

    let erase = store(root: eraseRoot)
    try grantLifetimeAndEnable(erase)
    _ = try erase.setStoreEntitlementLease(
      expiresAt: fixedClock.addingTimeInterval(600),
      lifetime: false,
      verifiedAt: fixedClock.addingTimeInterval(100)
    )
    try erase.recordSetupProof(version: 1, at: fixedClock)
    try erase.recordFirstCapturedAt(fixedClock)
    _ = try erase.stage(
      sender: knownSender,
      body: messageBody,
      eventId: eventId(40_000),
      observedAt: fixedClock
    )
    try erase.eraseAll()
    let erased = try erase.status()
    check(
      "erase leaves only disabled empty state",
      !erased.enabled && !erased.entitled
        && erased.pending == 0 && erased.dropped == 0 && !erased.corrupt
        && erased.setupProofVersion == nil && erased.setupProofAt == nil && erased.firstCapturedAt == nil
    )
    let erasedFiles = try FileManager.default.contentsOfDirectory(
      at: eraseRoot,
      includingPropertiesForKeys: nil
    ).map(\.lastPathComponent).sorted()
    check("erase removes every data artifact except the lock and manifest", erasedFiles == [".lock", "manifest.plist"])
    check(
      "erase prevents an extant automation from recreating data",
      try erase.stage(
        sender: knownSender,
        body: messageBody,
        eventId: eventId(40_001),
        observedAt: fixedClock
      ) == .disabled && erase.status().pending == 0
    )
    check(
      "erase clears the monotonic store revision as well as both grants",
      try erase.setStoreEntitlementLease(
        expiresAt: fixedClock.addingTimeInterval(300),
        lifetime: false,
        verifiedAt: fixedClock
      ) && erase.status().entitled && !erase.status().enabled
    )

    let rootValues = try basicRoot.resourceValues(forKeys: [.isExcludedFromBackupKey])
    check("queue root is excluded from backups", rootValues.isExcludedFromBackup == true)
    let basicManifest = basicRoot.appendingPathComponent("manifest.plist")
    let protection = try FileManager.default.attributesOfItem(atPath: basicManifest.path)[.protectionKey]
      as? FileProtectionType
    check(
      "manifest uses complete-until-first-authentication protection",
      protection == .completeUntilFirstUserAuthentication
    )
    let protectedRecord = orderingRoot
      .appendingPathComponent("records", isDirectory: true)
      .appendingPathComponent(eventId(102) + ".json")
    let recordProtection = try FileManager.default.attributesOfItem(
      atPath: protectedRecord.path
    )[.protectionKey] as? FileProtectionType
    check(
      "records use complete-until-first-authentication protection",
      recordProtection == .completeUntilFirstUserAuthentication
    )

    print("\nNative live capture store: \(passed) passed, \(failed) failed")
    if failed > 0 { Foundation.exit(1) }
  }
}
