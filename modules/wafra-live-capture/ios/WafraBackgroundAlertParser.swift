import Foundation
import CoreFoundation
import CryptoKit
import JavaScriptCore

/// The only financial facts permitted to leave the isolated parser. There is
/// no raw message, account identifier, converted amount or ledger ownership.
public struct WafraNativeAlertNotification: Equatable, Sendable {
  public struct Amount: Equatable, Sendable {
    public let currency: String
    public let minorUnits: String
    public let exponent: Int
  }
  public struct Instrument: Equatable, Sendable {
    public let kind: String
    public let last4: String?
  }
  public let style: String
  public let family: String
  public let direction: String
  public let amount: Amount
  public let merchant: String?
  public let instrument: Instrument?

  /// Decimal placement uses the validated integer string, never floating
  /// point or a ledger conversion. Preserve the source's ISO exponent.
  public var formattedAmount: String {
    guard amount.exponent > 0 else { return "\(amount.currency) \(amount.minorUnits)" }
    let digits = String(repeating: "0", count: max(0, amount.exponent + 1 - amount.minorUnits.count)) + amount.minorUnits
    let point = digits.index(digits.endIndex, offsetBy: -amount.exponent)
    return "\(amount.currency) \(digits[..<point]).\(digits[point...])"
  }
}

@available(iOS 16.0, *)
public enum WafraBackgroundAlertParser {
  private static let runtime = WafraBackgroundAlertParserRuntime()

  public static func read(sender: String?, body: String, observedAt: Date,
                          context: WafraNativeParserContext) async -> WafraNativeAlertNotification? {
    await runtime.read(sender: sender, body: body, observedAt: observedAt, context: context)
  }
}

/// Resource URLs can be supplied by another resource owner, including the
/// native component harness. They never become JavaScript host bindings.
@available(iOS 16.0, *)
final class WafraBackgroundAlertParserRuntime: @unchecked Sendable {
  private struct Metadata {
    let parserVersion: Int
    let sourceHash: String
    let bundleSha256: String
    let currencies: [String: Int]
    let countries: Set<String>
  }
  private struct ResourceURLs {
    let script: URL
    let metadata: URL
  }
  private final class Cancellation: @unchecked Sendable {
    private let lock = NSLock()
    private var canceled = false
    func cancel() { lock.lock(); canceled = true; lock.unlock() }
    var isCanceled: Bool { lock.lock(); defer { lock.unlock() }; return canceled }
  }

  private let resourceURLs: ResourceURLs?
  private let resolveBundledResources: Bool
  private let runner = DispatchQueue(label: "app.wafra.background-alert-parser", qos: .utility)
  private let admissionLock = NSLock()
  private var busy = false
  private let resultDeadline: TimeInterval = 2
  private static let safeInteger: UInt64 = 9_007_199_254_740_991
  // Merchant labels must not carry identifiers or hidden Unicode characters
  // through the native DTO boundary, even if a malformed adapter returns one.
  private static let unsafeMerchant = try? NSRegularExpression(pattern: #"[\p{C}]|\d{5,}|[\dXx*·]{6,}"#)

  init() {
    resourceURLs = nil
    resolveBundledResources = true
  }

  init(scriptURL: URL?, metadataURL: URL?) {
    if let scriptURL, let metadataURL { resourceURLs = ResourceURLs(script: scriptURL, metadata: metadataURL) }
    else { resourceURLs = nil }
    resolveBundledResources = false
  }

  func read(sender: String?, body: String, observedAt: Date,
            context: WafraNativeParserContext) async -> WafraNativeAlertNotification? {
    guard !Task.isCancelled, context.isValidBasic,
          !body.isEmpty, body.utf8.count <= 4096,
          (sender?.utf16.count ?? 0) <= 80,
          Self.boundedInput(body), Self.boundedInput(sender ?? ""),
          let observedAtMilliseconds = Self.observationMilliseconds(observedAt),
          admit() else { return nil }
    let started = ProcessInfo.processInfo.systemUptime
    let cancellation = Cancellation()
    return await withTaskCancellationHandler {
      await withCheckedContinuation { continuation in
        runner.async {
          let value: WafraNativeAlertNotification? = autoreleasepool {
            guard !cancellation.isCanceled, self.isTimely(started) else { return nil }
            return self.evaluate(sender: sender, body: body, observedAtMilliseconds: observedAtMilliseconds,
                                 context: context, started: started, cancellation: cancellation)
          }
          // Cancellation/deadline suppress the result only. Public JSC APIs
          // cannot interrupt synchronous execution, so busy stays held until
          // evaluation finishes and its fresh context is released.
          self.releaseAdmission()
          continuation.resume(returning: !cancellation.isCanceled && self.isTimely(started) ? value : nil)
        }
      }
    } onCancel: { cancellation.cancel() }
  }

  private func admit() -> Bool {
    admissionLock.lock(); defer { admissionLock.unlock() }
    guard !busy else { return false }
    busy = true
    return true
  }

  private func releaseAdmission() {
    admissionLock.lock(); busy = false; admissionLock.unlock()
  }

  private func isTimely(_ started: TimeInterval) -> Bool {
    ProcessInfo.processInfo.systemUptime - started < resultDeadline
  }

  private static func observationMilliseconds(_ date: Date) -> Int? {
    let milliseconds = date.timeIntervalSince1970 * 1000
    // Date() carries submillisecond precision. Normalize only the preview
    // input, keeping the protected receipt timestamp and identity untouched.
    guard milliseconds.isFinite, milliseconds > 0,
          milliseconds <= Double(safeInteger), milliseconds <= 8_640_000_000_000_000 else { return nil }
    let wholeMilliseconds = milliseconds.rounded(.towardZero)
    guard wholeMilliseconds >= 1 else { return nil }
    return Int(wholeMilliseconds)
  }

  private func urls() -> ResourceURLs? {
    if !resolveBundledResources { return resourceURLs }
    guard let bundle = WafraLiveCaptureResources.optionalBundle(),
          let script = bundle.url(forResource: "WafraBackgroundParser", withExtension: "js"),
          let metadata = bundle.url(forResource: "WafraBackgroundParser.meta", withExtension: "json")
    else { return nil }
    return ResourceURLs(script: script, metadata: metadata)
  }

  private static func boundedData(_ url: URL, limit: Int) -> Data? {
    guard let values = try? url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey]),
          values.isRegularFile == true, let size = values.fileSize, size > 0, size <= limit,
          let data = try? Data(contentsOf: url), data.count > 0, data.count <= limit else { return nil }
    return data
  }

  private func evaluate(sender: String?, body: String, observedAtMilliseconds: Int, context: WafraNativeParserContext,
                        started: TimeInterval, cancellation: Cancellation) -> WafraNativeAlertNotification? {
    guard let urls = urls(),
          let metadataData = Self.boundedData(urls.metadata, limit: 64 * 1024),
          let metadata = Self.metadata(metadataData), metadata.sourceHash == context.sourceHash,
          Self.valid(context, metadata: metadata),
          let scriptData = Self.boundedData(urls.script, limit: 2 * 1024 * 1024),
          SHA256.hash(data: scriptData).map({ String(format: "%02x", $0) }).joined() == metadata.bundleSha256,
          let script = String(data: scriptData, encoding: .utf8),
          !cancellation.isCanceled, isTimely(started),
          let parser = JSContext() else { return nil }

    // Every admitted call owns a fresh context. Do not install callbacks,
    // console, file/ledger/key/network access, or React Native globals.
    var scriptFailed = false
    parser.exceptionHandler = { _, _ in scriptFailed = true }
    guard !cancellation.isCanceled, isTimely(started) else { return nil }
    // Apple supplies a console object in a fresh JSContext. Remove that
    // native logging surface before any message or parser source enters it.
    guard parser.globalObject.deleteProperty("console"),
          parser.evaluateScript("typeof console === 'undefined'")?.toBool() == true,
          !scriptFailed, !cancellation.isCanceled, isTimely(started) else { return nil }
    parser.evaluateScript(script)
    guard !scriptFailed, !cancellation.isCanceled, isTimely(started),
          let entry = parser.objectForKeyedSubscript("wafraNativeAlertParse"),
          !entry.isUndefined, !entry.isNull,
          let contextJSON = context.serializedJSON(),
          let contextData = contextJSON.data(using: .utf8),
          let contextObject = try? JSONSerialization.jsonObject(with: contextData),
          let inputData = try? JSONSerialization.data(withJSONObject: [
            "v": 1, "context": contextObject, "sender": Self.normalizedSender(sender),
            "body": body, "observedAt": observedAtMilliseconds
          ]), let input = String(data: inputData, encoding: .utf8),
          let result = entry.call(withArguments: [input]), !scriptFailed,
          !cancellation.isCanceled, isTimely(started), result.isString,
          let length = result.forProperty("length")?.toDouble(), length.isFinite, length > 0, length <= 2048,
          let output = result.toString(), output.utf8.count <= 2048,
          let outputData = output.data(using: .utf8) else { return nil }
    return Self.notification(outputData, metadata: metadata)
  }

  private static func normalizedSender(_ sender: String?) -> String {
    let trimmed = (sender ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    return [WafraLiveCaptureStore.automationSender, "Wafra Notification"].contains(trimmed) ? "" : trimmed
  }

  private static func boundedInput(_ text: String) -> Bool {
    var last: Unicode.Scalar?
    var run = 0
    var digitRun = 0
    for scalar in text.unicodeScalars {
      if scalar.value == 0 { return false }
      run = last == scalar ? run + 1 : 1
      last = scalar
      digitRun = CharacterSet.decimalDigits.contains(scalar) ? digitRun + 1 : 0
      if run > 1024 || digitRun > 128 { return false }
    }
    return true
  }

  private static func exactKeys(_ object: [String: Any], _ keys: [String]) -> Bool {
    Set(object.keys) == Set(keys)
  }

  private static func integer(_ value: Any?) -> Int? {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
    let double = number.doubleValue
    guard double.isFinite, double.rounded(.towardZero) == double, double >= 0,
          double <= Double(safeInteger) else { return nil }
    return Int(double)
  }

  private static func ascii(_ text: String, count: Int, range: ClosedRange<UInt8>) -> Bool {
    let bytes = Array(text.utf8)
    return bytes.count == count && bytes.allSatisfy { range.contains($0) }
  }

  private static func digest(_ value: Any?) -> String? {
    guard let value = value as? String, value.utf8.count == 64,
          value.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else { return nil }
    return value
  }

  private static func metadata(_ data: Data) -> Metadata? {
    guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          exactKeys(object, ["v", "parserVersion", "sourceHash", "bundleSha256", "moduleCount", "currencies", "countries"]),
          integer(object["v"]) == 1, let version = integer(object["parserVersion"]), version > 0,
          let source = digest(object["sourceHash"]), let bundle = digest(object["bundleSha256"]),
          let count = integer(object["moduleCount"]), (1...64).contains(count),
          let codes = object["currencies"] as? [String: Any], !codes.isEmpty, codes.count <= 256,
          let countries = object["countries"] as? [String], !countries.isEmpty, countries.count <= 256,
          Set(countries).count == countries.count else { return nil }
    var currencies: [String: Int] = [:]
    for (code, value) in codes {
      guard ascii(code, count: 3, range: 65...90), let exponent = integer(value), [0, 2, 3].contains(exponent) else { return nil }
      currencies[code] = exponent
    }
    let isoCountries = Set(Locale.Region.isoRegions.map(\.identifier))
    guard countries.allSatisfy({ ascii($0, count: 2, range: 65...90) && ($0 == "ZZ" || isoCountries.contains($0)) }) else { return nil }
    return Metadata(parserVersion: version, sourceHash: source, bundleSha256: bundle,
                    currencies: currencies, countries: Set(countries))
  }

  private static func valid(_ context: WafraNativeParserContext, metadata: Metadata) -> Bool {
    guard context.isValidBasic else { return false }
    if let country = context.country, !metadata.countries.contains(country) { return false }
    if let money = context.ledgerMoney { return metadata.currencies[money.currency] == money.exponent }
    return true
  }

  private static func notification(_ data: Data, metadata: Metadata) -> WafraNativeAlertNotification? {
    guard let result = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          exactKeys(result, ["v", "parserVersion", "route", "provenance", "notification"]),
          integer(result["v"]) == 1, integer(result["parserVersion"]) == metadata.parserVersion,
          let route = result["route"] as? String, ["parsed", "review", "ignore"].contains(route),
          let payload = result["notification"] as? [String: Any],
          exactKeys(payload, ["style", "family", "direction", "amount", "merchant", "instrument"]),
          let style = payload["style"] as? String,
          (style == "movement" && route == "parsed" && result["provenance"] as? String == "launch") ||
          (style == "review" && route == "review" && result["provenance"] as? String == "unverified"),
          let family = payload["family"] as? String,
          ["purchase", "transfer", "refund", "cash-withdrawal", "fee", "utility", "recurring-payment", "income"].contains(family),
          let direction = payload["direction"] as? String, ["debit", "credit"].contains(direction),
          family == "transfer" || direction == (["refund", "income"].contains(family) ? "credit" : "debit"),
          let money = payload["amount"] as? [String: Any], exactKeys(money, ["currency", "minorUnits", "exponent"]),
          let currency = money["currency"] as? String, let exponent = integer(money["exponent"]),
          metadata.currencies[currency] == exponent,
          let digits = money["minorUnits"] as? String, (1...16).contains(digits.utf8.count),
          digits.utf8.allSatisfy({ (48...57).contains($0) }), digits.first != "0",
          let units = UInt64(digits), units > 0, units <= safeInteger else { return nil }
    let merchant: String?
    if let value = payload["merchant"] as? String {
      guard !value.isEmpty, value.utf16.count <= 120, value.utf8.count <= 512,
            value == value.trimmingCharacters(in: .whitespacesAndNewlines),
            let unsafeMerchant,
            unsafeMerchant.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)) == nil else { return nil }
      merchant = value
    } else if payload["merchant"] is NSNull { merchant = nil }
    else { return nil }
    let instrument: WafraNativeAlertNotification.Instrument?
    if let value = payload["instrument"] as? [String: Any] {
      guard exactKeys(value, ["kind", "last4"]), let kind = value["kind"] as? String,
            ["card", "account", "wallet"].contains(kind) else { return nil }
      let last4: String?
      if let tail = value["last4"] as? String {
        guard ascii(tail, count: 4, range: 48...57) else { return nil }
        last4 = tail
      } else if value["last4"] is NSNull { last4 = nil }
      else { return nil }
      instrument = .init(kind: kind, last4: last4)
    } else if payload["instrument"] is NSNull { instrument = nil }
    else { return nil }
    return .init(style: style, family: family, direction: direction,
      amount: .init(currency: currency, minorUnits: digits, exponent: exponent), merchant: merchant, instrument: instrument)
  }
}
