import Foundation

@main
struct NativeLiveCaptureAdmissionTests {
  static func main() throws {
    let mode = CommandLine.arguments[1]
    precondition(mode == "preview" || mode == "credential")
    let credentialBroken = mode == "credential"
    let bank = "Card ending 1234 was used for JOD 15.251. Never share your OTP."
    let otp = "Verification code: 123 456 for AED 25.00 purchase."
    precondition(WafraInstantAlertReader.isAvailable == credentialBroken)
    precondition(WafraInstantAlertReader.isSensitive(bank) == credentialBroken)
    precondition(WafraInstantAlertReader.isSensitive(otp))

    let root = FileManager.default.temporaryDirectory.appendingPathComponent("wafra-admission-\(UUID())")
    defer { try? FileManager.default.removeItem(at: root) }
    let now = Date()
    let queue = WafraLiveCaptureStore(root: root, now: { now }, queueDidChange: {})
    _ = try queue.setLocalEntitlementLease(expiresAt: nil, lifetime: true)
    try queue.setCaptureEnabled(true)
    let result = try queue.stage(sender: "EmiratesNBD", body: bank,
      eventId: UUID().uuidString, observedAt: now)
    precondition(result == (credentialBroken ? .ignored : .accepted))
    let rows = try queue.listPendingRecords(limit: 50)
    precondition(rows.count == (credentialBroken ? 0 : 1))
    let ignored = try queue.stage(sender: "EmiratesNBD", body: otp,
      eventId: UUID().uuidString, observedAt: now)
    precondition(ignored == .ignored)
    let remaining = try queue.listPendingRecords(limit: 50)
    precondition(remaining == rows)
    print("Native admission \(mode) failure: 7 passed")
  }
}
