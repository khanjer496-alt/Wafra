import Foundation

// Checks the iPhone charge-banner reader against the fixture that
// export-instant-alert-fixture.cjs writes from the same generated patterns and
// the shared restatement of InstantAlert.kt. Every corpus message must read
// identically: the same banner, or the same silence.

@main
struct NativeInstantAlertTests {
  private static var passed = 0
  private static var failed = 0

  private static func check(_ name: String, _ condition: Bool) {
    if condition {
      passed += 1
    } else {
      failed += 1
      print("✗ \(name)")
    }
  }

  private static func expected(_ value: Any?) -> WafraInstantAlertReader.Read? {
    guard let row = value as? [String: Any],
          let currency = row["currency"] as? String,
          let figure = row["figure"] as? String,
          let credit = row["credit"] as? Bool
    else { return nil }
    return WafraInstantAlertReader.Read(
      currency: currency,
      figure: figure,
      credit: credit,
      merchant: row["merchant"] as? String,
      last4: row["last4"] as? String
    )
  }

  static func main() throws {
    guard CommandLine.arguments.count == 2 else {
      preconditionFailure("usage: native-instant-alert-tests <fixture.json>")
    }
    let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
    guard let fixture = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          let reads = fixture["reads"] as? [[String: Any]],
          let sensitive = fixture["sensitive"] as? [[String: Any]]
    else { preconditionFailure("malformed instant-alert fixture") }

    check("every generated pattern compiles", WafraInstantAlertReader.isAvailable)
    var banners = 0
    for (index, row) in reads.enumerated() {
      guard let body = row["body"] as? String else { continue }
      let want = expected(row["read"])
      let got = WafraInstantAlertReader.read(body)
      if got != nil { banners += 1 }
      check("message \(index) reads as on Android", got == want)
    }
    check("the corpus produces banners, not silence", banners >= 20)
    for row in sensitive {
      guard let body = row["body"] as? String, let flag = row["sensitive"] as? Bool else { continue }
      check("credential filter agrees for a fixture message", WafraInstantAlertReader.isSensitive(body) == flag)
    }

    print("Native instant alert reader: \(passed) passed, \(failed) failed")
    precondition(failed == 0, "iPhone charge-banner reader disagrees with InstantAlert.kt.")
  }
}
