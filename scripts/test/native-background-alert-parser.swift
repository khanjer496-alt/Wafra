import Foundation
import CryptoKit

@main
struct NativeBackgroundAlertParserTests {
  private static var passed = 0
  private static var failed = 0
  private static let observedAt = Date(timeIntervalSince1970: 1_791_892_800)
  private static let sourceHash = String(repeating: "a", count: 64)
  private static let body = "Bank alert: Your card ending 1234 was charged AED 24.86 at SAMPLE STORE."

  private static func check(_ name: String, _ condition: Bool) {
    if condition { passed += 1; print("✓ \(name)") }
    else { failed += 1; print("✗ \(name)") }
  }

  private static func context(hash: String = sourceHash, country: String? = "AE",
                              currency: String = "AED", exponent: Int = 2) -> WafraNativeParserContext {
    WafraNativeParserContext(country: country, parserMarket: country == "AE" ? "AE" : country == "SA" ? "SA" : "ZZ",
      ledgerMoney: .init(currency: currency, exponent: exponent), sourceHash: hash)
  }

  private static var result: [String: Any] {
    ["v": 1, "parserVersion": 77, "route": "parsed", "provenance": "launch",
     "notification": ["style": "movement", "family": "purchase", "direction": "debit",
       "amount": ["currency": "AED", "minorUnits": "2486", "exponent": 2],
       "merchant": "SAMPLE STORE", "instrument": ["kind": "card", "last4": "1234"]]]
  }

  private static func json(_ value: Any) throws -> String {
    String(decoding: try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .fragmentsAllowed]), as: UTF8.self)
  }

  private static func fixture(root: URL, script: String, metadataChange: ((inout [String: Any]) -> Void)? = nil)
    throws -> WafraBackgroundAlertParserRuntime {
    let directory = root.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let scriptURL = directory.appendingPathComponent("WafraBackgroundParser.js")
    let metadataURL = directory.appendingPathComponent("WafraBackgroundParser.meta.json")
    let bytes = Data(script.utf8)
    try bytes.write(to: scriptURL)
    var metadata: [String: Any] = ["v": 1, "parserVersion": 77, "sourceHash": sourceHash,
      "bundleSha256": SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined(),
      "moduleCount": 1, "currencies": ["AED": 2, "SAR": 2, "USD": 2, "JOD": 3, "JPY": 0],
      "countries": ["AE", "GB", "JO", "JP", "US"]]
    metadataChange?(&metadata)
    try Data(json(metadata).utf8).write(to: metadataURL)
    return WafraBackgroundAlertParserRuntime(scriptURL: scriptURL, metadataURL: metadataURL)
  }

  private static func fixture(root: URL, output: [String: Any]) throws -> WafraBackgroundAlertParserRuntime {
    try fixture(root: root, script: "globalThis.wafraNativeAlertParse = function () { return \(json(try json(output))); };")
  }

  private static func read(_ runtime: WafraBackgroundAlertParserRuntime, body: String = body,
                           sender: String? = "BANK", context: WafraNativeParserContext = context(),
                           observedDate: Date = observedAt) async -> WafraNativeAlertNotification? {
    await runtime.read(sender: sender, body: body, observedAt: observedDate, context: context)
  }

  static func main() async {
    let scratch = FileManager.default.temporaryDirectory.appendingPathComponent("wafra-parser-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: scratch) }
    do {
      try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
      try await actualResourceChecks()
      try await controlledRuntimeChecks(scratch)
    } catch {
      // Never log input text, bundle snippets or JavaScript exception details.
      check("native runtime setup and resource verification", false)
    }
    print("Native background parser: \(passed) passed, \(failed) failed; host component evidence only.")
    if failed != 0 { exit(1) }
  }

  private static func controlledRuntimeChecks(_ scratch: URL) async throws {
    let valid = try fixture(root: scratch, output: result)
    let first = await read(valid)
    check("valid scalar result is admitted", first?.amount.minorUnits == "2486")
    check("integer two-decimal formatting", first?.formattedAmount == "AED 24.86")
    let observationContract = try fixture(root: scratch, script: """
      globalThis.wafraNativeAlertParse = function (input) {
        var milliseconds = JSON.parse(input).observedAt;
        if (!Number.isSafeInteger(milliseconds) || milliseconds !== 1791892800000) return '{}';
        return \(try json(try json(result)));
      };
      """)
    check("submillisecond observation truncates to safe whole milliseconds", await read(observationContract, observedDate: observedAt.addingTimeInterval(0.00075)) != nil)
    for (label, seconds) in [
      ("nonfinite observation", Double.infinity), ("NaN observation", Double.nan),
      ("overflowing observation", Double.greatestFiniteMagnitude),
      ("out-of-safe-range observation", 9_007_199_254_741.0),
      ("outside JavaScript Date range", 8_640_000_000_001.0),
      ("negative observation", -1.0), ("zero observation", 0.0),
      ("observation truncating to zero", 0.0005)
    ] {
      check("\(label) stays quiet", await read(valid, observedDate: Date(timeIntervalSince1970: seconds)) == nil)
    }
    for (currency, units, exponent, expected) in [
      ("AED", "1", 2, "AED 0.01"), ("JOD", "1", 3, "JOD 0.001"),
      ("JPY", "1", 0, "JPY 1"), ("AED", "9007199254740991", 2, "AED 90071992547409.91")
    ] {
      var output = result
      var notification = output["notification"] as! [String: Any]
      notification["amount"] = ["currency": currency, "minorUnits": units, "exponent": exponent]
      output["notification"] = notification
      let formatted = await read(try fixture(root: scratch, output: output))
      check("source integer formatting preserves \(currency) units \(units)", formatted?.formattedAmount == expected)
    }
    check("missing resource stays quiet", await read(WafraBackgroundAlertParserRuntime(scriptURL: nil, metadataURL: nil)) == nil)
    check("missing source hash stays quiet", await read(valid, context: context(hash: String(repeating: "b", count: 64))) == nil)
    check("ISO metadata rejects unsupported country", await read(valid, context: context(country: "FR")) == nil)
    check("ISO metadata rejects wrong exponent", await read(valid, context: context(currency: "JOD", exponent: 2)) == nil)
    check("country and parser market remain independent valid preferences", await read(valid, context: WafraNativeParserContext(country: "GB", parserMarket: "SA", ledgerMoney: .init(currency: "SAR", exponent: 2), sourceHash: sourceHash)) != nil)
    check("preview leaves oversized body quiet", await read(valid, body: String(repeating: "a", count: 4097)) == nil)
    check("preview bounds sender UTF16", await read(valid, sender: String(repeating: "a", count: 81)) == nil)
    check("pathological long numeric run stays quiet", await read(valid, body: String(repeating: "1", count: 129)) == nil)
    check("pathological repeated input stays quiet", await read(valid, body: String(repeating: "a", count: 1025)) == nil)
    check("missing notification resources stay quiet", WafraLiveCaptureResources.string("live.alert.title") == nil)

    let metadataCases: [(String, (inout [String: Any]) -> Void)] = [
      ("corrupt bundle hash", { $0["bundleSha256"] = String(repeating: "0", count: 64) }),
      ("unsupported metadata version", { $0["v"] = 2 }),
      ("boolean metadata version", { $0["v"] = true }),
      ("too many modules", { $0["moduleCount"] = 65 }),
      ("invalid metadata country", { $0["countries"] = ["AE", "XX"] }),
      ("unsupported metadata exponent", { $0["currencies"] = ["AED": 4] }),
      ("unexpected metadata field", { $0["raw"] = "forbidden" })
    ]
    for (name, change) in metadataCases {
      let script = "globalThis.wafraNativeAlertParse = function () { return \(try json(try json(result))); };"
      check(name, await read(try fixture(root: scratch, script: script, metadataChange: change)) == nil)
    }

    var invalidOutputs: [(String, [String: Any])] = []
    var changed = result; changed["parserVersion"] = 78; invalidOutputs.append(("wrong result parser version", changed))
    changed = result; changed["v"] = true; invalidOutputs.append(("boolean result schema", changed))
    changed = result; changed["raw"] = "forbidden"; invalidOutputs.append(("unexpected result field", changed))
    for (name, field, value) in [
      ("unsafe integer amount", "minorUnits", "9007199254740992" as Any),
      ("zero amount", "minorUnits", "0" as Any),
      ("leading zero amount", "minorUnits", "02486" as Any),
      ("fractional amount", "minorUnits", "24.86" as Any),
      ("numeric amount violates string contract", "minorUnits", 2486 as Any),
      ("wrong amount exponent", "exponent", 3 as Any),
      ("unsupported amount currency", "currency", "ZZZ" as Any)
    ] {
      changed = result
      var notification = changed["notification"] as! [String: Any]
      var amount = notification["amount"] as! [String: Any]
      amount[field] = value; notification["amount"] = amount; changed["notification"] = notification
      invalidOutputs.append((name, changed))
    }
    for (name, field, value) in [
      ("unknown movement family", "family", "repayment" as Any),
      ("wrong movement direction", "direction", "credit" as Any),
      ("unverified movement wording", "style", "review" as Any),
      ("oversized merchant", "merchant", String(repeating: "a", count: 121) as Any),
      ("blank merchant", "merchant", " " as Any),
      ("full account identifier in merchant stays private", "merchant", "ACCOUNT 1234567890123456" as Any),
      ("masked account identifier in merchant stays private", "merchant", "ACCT XX123456" as Any),
      ("mixed masked identifier in merchant stays private", "merchant", "ACCT 12XX34" as Any),
      ("hidden format character in merchant stays private", "merchant", "SAMPLE\u{200B} STORE" as Any),
      ("full instrument number", "instrument", ["kind": "card", "last4": "123456"] as Any),
      ("unrecognized instrument", "instrument", ["kind": "other", "last4": "1234"] as Any),
      ("unexpected payload field", "balance", "50000" as Any)
    ] {
      changed = result
      var notification = changed["notification"] as! [String: Any]
      notification[field] = value; changed["notification"] = notification
      invalidOutputs.append((name, changed))
    }
    for (name, output) in invalidOutputs { check(name, await read(try fixture(root: scratch, output: output)) == nil) }
    var namedOutput = result
    var namedPayload = namedOutput["notification"] as! [String: Any]
    namedPayload["merchant"] = "MARKET 1234"
    namedOutput["notification"] = namedPayload
    let named = await read(try fixture(root: scratch, output: namedOutput))
    check("true named merchant with short digits remains available", named?.merchant == "MARKET 1234")
    check("proven four-digit instrument remains available", named?.instrument?.last4 == "1234")
    check("JSC exception stays quiet", await read(try fixture(root: scratch, script: "throw new Error('private');")) == nil)
    check("non-string result stays quiet", await read(try fixture(root: scratch, script: "globalThis.wafraNativeAlertParse = function () { return 1; };")) == nil)
    check("oversized result stays quiet", await read(try fixture(root: scratch, script: "globalThis.wafraNativeAlertParse = function () { return 'a'.repeat(2049); };")) == nil)

    let freshScript = """
      var calls = 0;
      globalThis.wafraNativeAlertParse = function (input) {
        calls++;
        if (calls !== 1 || [typeof fetch, typeof XMLHttpRequest, typeof process,
          typeof Buffer, typeof require, typeof localStorage, typeof nativeCallSyncHook,
          typeof WafraLiveCaptureStore, typeof console].some(x => x !== 'undefined')) return '{}';
        if (JSON.parse(input).sender !== '') return '{}';
        return \(try json(try json(result)));
      };
      """
    let fresh = try fixture(root: scratch, script: freshScript)
    check("runtime installs no host APIs and normalizes placeholder sender", await read(fresh, sender: "Wafra Automation") != nil)
    check("each call receives a fresh JSC context", await read(fresh, sender: "Wafra Notification") != nil)

    let slow = try fixture(root: scratch, script: """
      globalThis.wafraNativeAlertParse = function () {
        var until = Date.now() + 2050; while (Date.now() < until) {}
        return \(try json(try json(result)));
      };
      """)
    let late = Task { await read(slow) }
    try await Task.sleep(for: .milliseconds(100))
    let started = ProcessInfo.processInfo.systemUptime
    check("busy admission skips without queued parser work", await read(slow) == nil)
    check("busy skip returns promptly", ProcessInfo.processInfo.systemUptime - started < 0.5)
    check("two-second result deadline suppresses late result", await late.value == nil)
    let cancelRuntime = try fixture(root: scratch, script: """
      globalThis.wafraNativeAlertParse = function () {
        var until = Date.now() + 400; while (Date.now() < until) {}
        return \(try json(try json(result)));
      };
      """)
    let cancelStarted = ProcessInfo.processInfo.systemUptime
    let canceled = Task { await read(cancelRuntime) }
    try await Task.sleep(for: .milliseconds(100)); canceled.cancel()
    check("canceled preview stays quiet", await canceled.value == nil)
    check("cancellation does not claim a synchronous execution kill", ProcessInfo.processInfo.systemUptime - cancelStarted >= 0.3)
    check("runtime recovers after late synchronous evaluation", await read(valid) != nil)

    let storeRoot = scratch.appendingPathComponent("queue")
    let store = WafraLiveCaptureStore(root: storeRoot, now: { observedAt }, queueDidChange: {})
    _ = try store.setLocalEntitlementLease(expiresAt: nil, lifetime: true)
    try store.setCaptureEnabled(true)
    try store.setNativeParserContext(try json(["v": 1, "country": "AE", "parserMarket": "AE",
      "ledgerMoney": ["currency": "AED", "exponent": 2], "sourceHash": sourceHash]))
    let receiptBody = "  Bank alert: Your card ending 1234 was charged AED 24.86 at SAMPLE STORE.\n"
    let staged = try store.stage(sender: "BANK", body: receiptBody,
      eventId: "00000000-0000-4000-8000-000000000001", observedAt: observedAt)
    check("receipt stages before preview", staged == .accepted)
    let originalReceipt = try store.listPendingRecords(limit: 10)
    _ = await read(WafraBackgroundAlertParserRuntime(scriptURL: nil, metadataURL: nil), body: receiptBody)
    check("preview resource failure retains original receipt bytes", try store.listPendingRecords(limit: 10) == originalReceipt)
    check("store permits current admitted preview", try store.mayEmitParserPreview(context: context()))
    try store.setInstantAlertsEnabled(false)
    check("emission rechecks alert preference", try !store.mayEmitParserPreview(context: context()))
    try store.setInstantAlertsEnabled(true); try store.setCaptureEnabled(false)
    check("emission rechecks capture consent", try !store.mayEmitParserPreview(context: context()))
    try store.setCaptureEnabled(true)
    check("emission rejects stale context", try !store.mayEmitParserPreview(context: context(hash: String(repeating: "b", count: 64))))
    check("preference changes retain original receipt bytes", try store.listPendingRecords(limit: 10) == originalReceipt)
    var leaseClock = observedAt
    let leased = WafraLiveCaptureStore(root: scratch.appendingPathComponent("leased"), now: { leaseClock }, queueDidChange: {})
    _ = try leased.setLocalEntitlementLease(expiresAt: observedAt.addingTimeInterval(60), lifetime: false)
    try leased.setCaptureEnabled(true)
    try leased.setNativeParserContext(context().serializedJSON())
    check("finite entitlement permits current preview", try leased.mayEmitParserPreview(context: context()))
    leaseClock = observedAt.addingTimeInterval(61)
    check("emission rechecks current entitlement", try !leased.mayEmitParserPreview(context: context()))
  }

  private static func actualResourceChecks() async throws {
    guard CommandLine.arguments.count == 2 else { throw CocoaError(.fileNoSuchFile) }
    let resources = URL(fileURLWithPath: CommandLine.arguments[1])
    let script = resources.appendingPathComponent("WafraBackgroundParser.js")
    let metadata = resources.appendingPathComponent("WafraBackgroundParser.meta.json")
    let object = try JSONSerialization.jsonObject(with: Data(contentsOf: metadata)) as! [String: Any]
    let hash = object["sourceHash"] as! String
    let runtime = WafraBackgroundAlertParserRuntime(scriptURL: script, metadataURL: metadata)
    let domestic = await read(runtime, body: "Purchase of AED 24.86 with Debit Card ending 1234 at SAMPLE STORE.", sender: "ADCB", context: context(hash: hash))
    check("shipping resource preserves domestic source amount", domestic?.formattedAmount == "AED 24.86")
    let submillisecond = observedAt.addingTimeInterval(0.00075)
    let fractionalDomestic = await read(runtime, body: "Purchase of AED 24.86 with Debit Card ending 1234 at SAMPLE STORE.", sender: "ADCB", context: context(hash: hash), observedDate: submillisecond)
    check("shipping parser reads normal submillisecond capture timestamp", fractionalDomestic?.formattedAmount == "AED 24.86")
    check("future alert remains refused with submillisecond observation", await read(runtime, body: "Purchase of AED 24.86 with Debit Card ending 1234 at SAMPLE STORE on 14/10/2026.", sender: "ADCB", context: context(hash: hash), observedDate: submillisecond) == nil)
    let independent = await read(runtime, body: "POS purchase of SAR 125.50 at JARIR BOOKSTORE using Mada Card ending 1234. Available balance SAR 2,500.00.", sender: "ALRAJHI", context: WafraNativeParserContext(country: "GB", parserMarket: "SA", ledgerMoney: .init(currency: "SAR", exponent: 2), sourceHash: hash))
    check("shipping parser accepts independently valid market and country", independent?.formattedAmount == "SAR 125.50")
    let foreign = await read(runtime, body: "Purchase of USD 24.86 with Debit Card ending 1234 at SAMPLE STORE.", sender: "ADCB", context: context(hash: hash))
    check("shipping resource preserves foreign source amount", foreign?.formattedAmount == "USD 24.86")
    let jod = await read(runtime, body: "Purchase of JOD 24.501 with Debit Card ending 1234 at SAMPLE STORE.", sender: "ENBD", context: context(hash: hash))
    check("shipping resource preserves three-decimal source units", jod?.formattedAmount == "JOD 24.501")
    let jpy = await read(runtime, body: "Purchase of JPY 2400 with Debit Card ending 1234 at SAMPLE STORE.", sender: "ENBD", context: context(hash: hash))
    check("shipping resource preserves zero-decimal source units", jpy?.formattedAmount == "JPY 2400")
    let review = await read(runtime, body: "Chase Bank alert: Your card ending 4421 was charged USD 24.86 at NORTH STAR MARKET.", sender: "CHASE", context: context(hash: hash))
    check("missing FX keeps source units in Review", review?.style == "review" && review?.formattedAmount == "USD 24.86")
    let sent = await read(runtime, body: "AED 1,714.50 has been deducted from your account 202XXX55XXX02 for issuance of Telegraphic Transfer. The available balance is AED 6,785.50.", sender: "ENBD", context: context(hash: hash))
    check("shared parser identifies sent transfer", sent?.family == "transfer" && sent?.direction == "debit")
    let received = await read(runtime, body: "AED 1,714.50 has been transferred to your account 202XXX55XXX02. The available balance is AED 8,500.00.", sender: "ENBD", context: context(hash: hash))
    check("shared parser identifies received transfer", received?.family == "transfer" && received?.direction == "credit")
    for (locale, sentText, receivedText, reviewText) in [
      ("en", "AED 1714.50 sent", "AED 1714.50 received", "Bank alert to review: USD 24.86 · NORTH STAR MARKET"),
      ("ar", "أُرسل AED 1714.50", "وصل AED 1714.50", "تنبيه بنكي للمراجعة: USD 24.86 · NORTH STAR MARKET")
    ] {
      let tableData = try Data(contentsOf: resources.appendingPathComponent("\(locale).lproj/WafraIntents.strings"))
      let table = try PropertyListSerialization.propertyList(from: tableData, options: [], format: nil) as! [String: String]
      if let sent { check("\(locale) transfer uses sent wording", WafraInstantAlert.content(for: sent, sender: "ENBD", localize: { table[$0] })?.title == sentText) }
      else { check("\(locale) transfer uses sent wording", false) }
      if let received { check("\(locale) transfer uses received wording", WafraInstantAlert.content(for: received, sender: "ENBD", localize: { table[$0] })?.title == receivedText) }
      else { check("\(locale) transfer uses received wording", false) }
      if let review { check("\(locale) Review uses distinct wording", WafraInstantAlert.content(for: review, sender: "CHASE", localize: { table[$0] })?.title == reviewText) }
      else { check("\(locale) Review uses distinct wording", false) }
    }
    check("shipping resource refuses personal chat", await read(runtime, body: "Hi Ann, I have just spent USD 50.00 at Example Market.", sender: "+12025550190", context: context(hash: hash)) == nil)
    check("shipping resource refuses credentials", await read(runtime, body: "Your OTP for USD 24.86 purchase is 123456. Do not share.", context: context(hash: hash)) == nil)
  }
}
