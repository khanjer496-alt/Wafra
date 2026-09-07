import Foundation

// Executes the real protected native queue against synthetic local test records.
// No stubbed storage, no user inbox, and no changes to production protection.
@main
struct CaptureReceiptTests {
  static var passed = 0
  static func check(_ name: String, _ condition: @autoclosure () throws -> Bool) throws {
    guard try condition() else { throw Failure.assertion(name) }
    passed += 1; print("✓ \(name)")
  }
  enum Failure: Error { case assertion(String); case injectedDeletion }
  static func main() throws {
    let fm = FileManager.default
    let root = fm.temporaryDirectory.appendingPathComponent("wafra-receipts-\(UUID().uuidString)")
    defer { try? fm.removeItem(at: root) }
    var now = Date(timeIntervalSince1970: 1_787_587_200)
    var deletionFails = false
    let store = WafraLiveCaptureStore(root: root, now: { now }, acknowledgementRemoveItem: { url in
      if deletionFails { throw Failure.injectedDeletion }
      try fm.removeItem(at: url)
    })
    let one = "00000000-0000-4000-8000-000000000001"
    let two = "00000000-0000-4000-8000-000000000002"
    let unknown = "00000000-0000-4000-8000-000000000099"
    let initial = try store.status()
    try check("new queue has no invented receipt times", initial.lastReceivedAt == nil && initial.lastHandledAt == nil)
    try store.recordSetupProof(version: 1, at: now)
    try check("setup proof does not manufacture a received message", try store.status().lastReceivedAt == nil)
    _ = try store.setLocalEntitlementLease(expiresAt: nil, lifetime: true)
    try store.setCaptureEnabled(true)
    let observed = now.addingTimeInterval(-30)
    try check("new synthetic message is accepted", try store.stage(sender: "TEST", body: "synthetic", eventId: one, observedAt: observed) == .accepted)
    let received = now.timeIntervalSince1970
    var status = try store.status()
    try check("receipt records queue write time rather than the SMS date", status.lastReceivedAt == received)
    try check("receipt is not parser qualification", status.firstCapturedAt == nil && status.lastHandledAt == nil && status.pending == 1)
    now.addTimeInterval(10)
    try check("replayed message is idempotent", try store.stage(sender: "TEST", body: "synthetic", eventId: one, observedAt: observed) == .accepted)
    try check("replay does not look like a new received message", try store.status().lastReceivedAt == received)
    try check("invalid message is refused", try store.stage(sender: "", body: "synthetic", eventId: two, observedAt: now) == .invalid)
    try check("invalid message cannot advance the receipt", try store.status().lastReceivedAt == received)
    try store.setCaptureEnabled(false)
    try check("disabled capture refuses message admission", try store.stage(sender: "TEST", body: "synthetic", eventId: two, observedAt: now) == .disabled)
    try check("disabled capture keeps the prior receipt", try store.status().lastReceivedAt == received)
    try store.setCaptureEnabled(true)
    try store.acknowledgeRecords(ids: [])
    try store.acknowledgeRecords(ids: [unknown])
    try check("empty or unknown acknowledgement is not processing", try store.status().lastHandledAt == nil)
    deletionFails = true
    do { try store.acknowledgeRecords(ids: [one]); throw Failure.assertion("failed deletion must throw") }
    catch Failure.injectedDeletion { passed += 1; print("✓ injected deletion failure propagates") }
    status = try store.status()
    try check("failed deletion keeps the pending message and no handled receipt", status.pending == 1 && status.lastHandledAt == nil)
    deletionFails = false
    try store.acknowledgeRecords(ids: [one])
    let handled = now.timeIntervalSince1970
    status = try store.status()
    try check("successful queue acknowledgement records handling time", status.lastHandledAt == handled && status.pending == 0)
    try check("handling is not a fabricated financial transaction", status.firstCapturedAt == nil)
    now.addTimeInterval(10)
    try store.acknowledgeRecords(ids: [one])
    try check("repeated acknowledgement does not advance handling time", try store.status().lastHandledAt == handled)
    _ = try store.stage(sender: "TEST", body: "second", eventId: two, observedAt: now)
    try check("later new message advances receipt", try store.status().lastReceivedAt == now.timeIntervalSince1970)
    let file = root.appendingPathComponent("manifest.plist")
    var plist = try PropertyListSerialization.propertyList(from: Data(contentsOf: file), format: nil) as! [String: Any]
    plist.removeValue(forKey: "lastReceivedAt"); plist.removeValue(forKey: "lastHandledAt")
    try PropertyListSerialization.data(fromPropertyList: plist, format: .binary, options: 0).write(to: file, options: .atomic)
    status = try store.status()
    try check("older manifest preserves pending events and unknown receipt dates", status.pending == 1 && status.lastReceivedAt == nil && status.lastHandledAt == nil && !status.corrupt)
    plist["lastReceivedAt"] = "bad-new-metadata"; plist["lastHandledAt"] = -1
    try PropertyListSerialization.data(fromPropertyList: plist, format: .binary, options: 0).write(to: file, options: .atomic)
    status = try store.status()
    try check("malformed diagnostic fields do not erase or corrupt financial events", status.pending == 1 && status.lastReceivedAt == nil && status.lastHandledAt == nil && !status.corrupt)
    try check("queue can still be read after diagnostic metadata damage", try store.listPendingRecords(limit: 50).count == 1)
    let exported = String(decoding: try JSONEncoder().encode(status), as: UTF8.self)
    try check("status contains no synthetic source body, sender or event IDs", !exported.contains("synthetic") && !exported.contains("TEST") && !exported.contains(two))
    try store.eraseAll()
    status = try store.status()
    try check("erase clears new receipt metadata too", status.lastReceivedAt == nil && status.lastHandledAt == nil && status.pending == 0)
    print("Native capture receipts: \(passed) passed, 0 failed")
  }
}
