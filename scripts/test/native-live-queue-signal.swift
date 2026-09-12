import ExpoModulesCore
import Foundation

// Real store/file protection and Darwin delivery between two host processes.
// This does not test Shortcuts, an iPhone's background policy or locked SMS.
@main
struct NativeQueueSignalTests {
  enum Failure: Error { case assertion(String) }
  static var passed = 0
  static let now = Date(timeIntervalSince1970: 1_787_587_200)
  static let id = "00000000-0000-4000-8000-000000000001"
  static func check(_ name: String, _ condition: @autoclosure () throws -> Bool) throws {
    guard try condition() else { throw Failure.assertion(name) }
    passed += 1; print("✓ \(name)")
  }
  static func stage(_ store: WafraLiveCaptureStore, eventId: String = id, body: String = "synthetic body") throws -> WafraLiveStageResult {
    try store.stage(sender: "SYNTHETIC", body: body, eventId: eventId, observedAt: now)
  }
  static func enable(_ store: WafraLiveCaptureStore) throws {
    _ = try store.setLocalEntitlementLease(expiresAt: nil, lifetime: true)
    try store.setCaptureEnabled(true)
  }
  static func serviceRunLoop() {
    RunLoop.current.run(until: Date().addingTimeInterval(0.15))
  }
  static func main() throws {
    if CommandLine.arguments.count == 3 && CommandLine.arguments[1] == "--stage" {
      let root = URL(fileURLWithPath: CommandLine.arguments[2])
      _ = try stage(WafraLiveCaptureStore(root: root, now: { now }))
      return
    }
    let fm = FileManager.default
    let root = fm.temporaryDirectory.appendingPathComponent("wafra-queue-signal-\(UUID().uuidString)")
    let crossProcessRoot = fm.temporaryDirectory.appendingPathComponent("wafra-queue-cross-process-\(UUID().uuidString)")
    defer {
      try? fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: root.path)
      try? fm.removeItem(at: root); try? fm.removeItem(at: crossProcessRoot)
    }
    var notifications = 0, pendingAtNotification = -1, failManifestWrite = false
    let reader = WafraLiveCaptureStore(root: root, now: { now })
    let store = WafraLiveCaptureStore(root: root, now: {
      if failManifestWrite {
        // Applied after the manifest was read. Existing record directory stays
        // writable, so only the subsequent atomic manifest commit must fail.
        try! fm.setAttributes([.posixPermissions: 0o500], ofItemAtPath: root.path)
      }
      return now
    }, queueDidChange: {
      notifications += 1
      // A fresh instance rereads actual disk. Calling it here also proves the
      // signal runs outside the store's non-reentrant serialization/file lock.
      pendingAtNotification = (try? reader.listPendingRecords(limit: 50).count) ?? -1
    })
    try check("disabled stage emits no wakeup", try stage(store) == .disabled && notifications == 0)
    try enable(store)
    try check("invalid stage emits no wakeup", try stage(store, body: "") == .invalid && notifications == 0)
    try check("accepted stage emits only after durable bytes are readable", try stage(store) == .accepted && notifications == 1 && pendingAtNotification == 1)
    try check("identical pending replay does not emit another wakeup", try stage(store) == .accepted && notifications == 1)
    try check("conflicting retry emits no wakeup", try stage(store, body: "different") == .invalid && notifications == 1)
    try store.acknowledgeRecords(ids: [id])
    try check("acknowledged replay does not emit another wakeup", try stage(store) == .accepted && notifications == 1)
    failManifestWrite = true
    var storageFailed = false
    do { _ = try stage(store, eventId: "00000000-0000-4000-8000-000000000002") }
    catch { storageFailed = true }
    failManifestWrite = false
    try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: root.path)
    try check("failed manifest commit emits no wakeup", storageFailed && notifications == 1)
    try check("failed commit removes uncommitted source and preserves empty queue", try reader.listPendingRecords(limit: 50).isEmpty)

    let module = WafraLiveCaptureModule()
    module.definition()
    try check("bridge advertises supported queue event", TestEventRegistry.constants["queueChangeEventsSupported"] as? Bool == true && TestEventRegistry.names == ["onQueueChanged"])
    TestEventRegistry.start?()
    try check("subscription requests an initial reconciliation", TestEventRegistry.emitted.count == 1)
    TestEventRegistry.start?()
    try check("repeated native observation setup is idempotent", TestEventRegistry.emitted.count == 1)
    let sharedStore = WafraLiveCaptureStore(root: crossProcessRoot, now: { now })
    try enable(sharedStore)
    let child = Process()
    child.executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
    child.arguments = ["--stage", crossProcessRoot.path]
    child.standardOutput = FileHandle.nullDevice; child.standardError = FileHandle.nullDevice
    try child.run(); child.waitUntilExit()
    let deadline = Date().addingTimeInterval(2)
    while TestEventRegistry.emitted.count == 1 && Date() < deadline { serviceRunLoop() }
    try check("another process's durable stage reaches an observing app bridge", child.terminationStatus == 0 && TestEventRegistry.emitted.count >= 2)
    try check("events contain no record data or metadata", TestEventRegistry.emitted.allSatisfy { $0.0 == "onQueueChanged" && $0.1.isEmpty })
    TestEventRegistry.stop?()
    let countAtStop = TestEventRegistry.emitted.count
    _ = try stage(sharedStore, eventId: "00000000-0000-4000-8000-000000000003")
    serviceRunLoop()
    try check("last-listener removal stops bridge delivery", TestEventRegistry.emitted.count == countAtStop)
    TestEventRegistry.start?()
    try check("resubscription reconciles an event missed while stopped", TestEventRegistry.emitted.count == countAtStop + 1)
    TestEventRegistry.destroy?()
    _ = try stage(sharedStore, eventId: "00000000-0000-4000-8000-000000000004")
    serviceRunLoop()
    try check("module destruction unregisters local delivery", TestEventRegistry.emitted.count == countAtStop + 1)
    print("Native queue signal: \(passed) passed, 0 failed; host processes only")
  }
}
