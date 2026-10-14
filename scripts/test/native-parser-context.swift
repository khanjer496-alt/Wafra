import Foundation

@main
struct NativeParserContextTests {
  static var checks = 0
  static func check(_ label: String, _ condition: Bool) {
    checks += 1; precondition(condition, label)
  }
  static func main() throws {
    let context = WafraNativeParserContext(country: "GB", parserMarket: "SA",
      ledgerMoney: .init(currency: "JOD", exponent: 3), sourceHash: String(repeating: "a", count: 64))
    check("country, parser and money remain independent", context.isValidBasic)
    let json = context.serializedJSON()!
    check("strict JSON roundtrip", WafraNativeParserContext(validatingJSON: json) == context)
    let unknown = WafraNativeParserContext(country: nil, parserMarket: "ZZ", ledgerMoney: nil, sourceHash: context.sourceHash)
    check("explicit null JSON fields survive", WafraNativeParserContext(validatingJSON: unknown.serializedJSON()!) == unknown)
    for invalid in [json.replacingOccurrences(of: "\"v\":1", with: "\"v\":true"),
      json.replacingOccurrences(of: "\"exponent\":3", with: "\"exponent\":1"),
      json.replacingOccurrences(of: "\"country\":\"GB\"", with: "\"country\":\"gB\""),
      json.dropLast() + ",\"body\":\"private\"}", String(repeating: "x", count: 2049)] {
      check("malformed context cannot enter manifest", WafraNativeParserContext(validatingJSON: String(invalid)) == nil)
    }
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("wafra-parser-context-\(UUID())")
    defer { try? FileManager.default.removeItem(at: root) }
    var now = Date()
    let queue = WafraLiveCaptureStore(root: root, now: { now }, queueDidChange: {})
    _ = try queue.setLocalEntitlementLease(expiresAt: now.addingTimeInterval(60), lifetime: false)
    try queue.setCaptureEnabled(true)
    _ = try queue.stage(sender: "ENBD", body: "AED 25.00 has been credited to your account 1234.",
      eventId: UUID().uuidString, observedAt: now)
    let before = try queue.listPendingRecords(limit: 50)
    check("old manifests have no preview context", try queue.nativeParserContextSnapshot() == nil)
    try queue.setNativeParserContext(json)
    check("stored context roundtrip", try queue.nativeParserContextSnapshot() == context)
    check("eligible gate", try queue.mayEmitParserPreview(context: context))
    check("context updates leave exact receipt bytes", try queue.listPendingRecords(limit: 50) == before)
    let changed = WafraNativeParserContext(country: "AE", parserMarket: "AE", ledgerMoney: context.ledgerMoney, sourceHash: context.sourceHash)
    check("changed snapshot cannot authorize old result", try !queue.mayEmitParserPreview(context: changed))
    try queue.setInstantAlertsEnabled(false)
    check("alert opt-out forbids emission", try !queue.mayEmitParserPreview(context: context))
    try queue.setInstantAlertsEnabled(true)
    try queue.setCaptureEnabled(false)
    check("capture opt-out forbids emission", try !queue.mayEmitParserPreview(context: context))
    try queue.setCaptureEnabled(true)
    let manifestURL = root.appendingPathComponent("manifest.plist")
    var manifest = try PropertyListSerialization.propertyList(from: Data(contentsOf: manifestURL), format: nil) as! [String: Any]
    manifest["nativeParserContext"] = ["v": true, "raw": "invalid advisory snapshot"]
    try PropertyListSerialization.data(fromPropertyList: manifest, format: .binary, options: 0).write(to: manifestURL)
    check("bad optional snapshot is unavailable", try queue.nativeParserContextSnapshot() == nil)
    check("bad optional snapshot preserves existing queue", try queue.listPendingRecords(limit: 50) == before)
    check("bad optional snapshot does not disable capture", try queue.status().enabled)
    try queue.setNativeParserContext(json)
    now = now.addingTimeInterval(61)
    check("expired entitlement forbids emission", try !queue.mayEmitParserPreview(context: context))
    now = now.addingTimeInterval(-61)
    try queue.setNativeParserContext("not JSON")
    check("invalid setter clears only advisory context", try queue.nativeParserContextSnapshot() == nil)
    check("invalid setter preserves receipt bytes", try queue.listPendingRecords(limit: 50) == before)
    try queue.eraseAll()
    check("erase clears preview settings", try queue.nativeParserContextSnapshot() == nil)
    print("Native parser context: \(checks) passed")
  }
}
