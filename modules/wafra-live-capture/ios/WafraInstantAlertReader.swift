import Foundation

/**
 The iPhone counterpart of InstantAlert.read() on Android: decide whether a
 bank message plainly says money moved, and pull out what the banner shows.

 It exists for the same reason the Kotlin one does. A Shortcuts automation
 runs Wafra's App Intent with no JavaScript engine, so the real parser is not
 available when the message lands. NOTHING HERE IS EVER STORED: the ledger row
 is always the TypeScript parser's, produced later from the same queued text.
 This is a preview, and its failure is deliberately one-sided: unless the
 message plainly states a completed movement, it returns nil and no banner is
 shown. The patterns are generated from InstantAlert.kt and
 SensitiveMessageFilter.kt (WafraInstantAlertPatterns.generated.swift); only
 the control flow below is restated, and it mirrors InstantAlert.read() and
 InstantAlert.merchant() line for line.
 */
public enum WafraInstantAlertReader {
  public struct Read: Equatable {
    public let currency: String
    public let figure: String
    public let credit: Bool
    public let merchant: String?
    public let last4: String?
  }

  private struct Compiled {
    let unsafeTransaction: NSRegularExpression
    let purchasePrefix: NSRegularExpression
    let promoFooter: NSRegularExpression
    let refuse: NSRegularExpression
    let credit: NSRegularExpression
    let debit: NSRegularExpression
    let amount: NSRegularExpression
    let last4: NSRegularExpression
    let merchant: NSRegularExpression
    let paymentMerchant: NSRegularExpression
    let bankWord: NSRegularExpression
    let credential: NSRegularExpression
  }

  // A pattern that fails to compile disables the banner entirely rather than
  // reading with a partial rule set.
  private static let compiled: Compiled? = {
    func re(_ pattern: String) throws -> NSRegularExpression {
      try NSRegularExpression(pattern: pattern, options: [.caseInsensitive])
    }
    typealias P = WafraInstantAlertPatterns
    return try? Compiled(
      unsafeTransaction: re(P.unsafeTransaction),
      purchasePrefix: re(P.purchasePrefix),
      promoFooter: re(P.promoFooter),
      refuse: re(P.refuse),
      credit: re(P.credit),
      debit: re(P.debit),
      amount: re(P.amount),
      last4: re(P.last4),
      merchant: re(P.merchant),
      paymentMerchant: re(P.paymentMerchant),
      bankWord: re(P.bankWord),
      credential: re(P.credential)
    )
  }()

  public static var isAvailable: Bool { compiled != nil }

  /// SensitiveMessageFilter.shouldReject: credentials never reach a banner.
  public static func isSensitive(_ body: String) -> Bool {
    guard let compiled else { return true }
    return contains(compiled.credential, body)
  }

  /// Nil when the message is not plainly a completed transaction.
  public static func read(_ body: String) -> Read? {
    guard let p = compiled else { return nil }
    if contains(p.unsafeTransaction, body) { return nil }
    let text = contains(p.purchasePrefix, body)
      ? p.promoFooter.stringByReplacingMatches(
        in: body, range: NSRange(body.startIndex..., in: body), withTemplate: "")
      : body
    if contains(p.refuse, text) { return nil }

    let credit = contains(p.credit, text)
    if !credit && !contains(p.debit, text) { return nil }

    guard let amount = p.amount.firstMatch(in: text, range: NSRange(text.startIndex..., in: text))
    else { return nil }
    // Groups 1/2 are "AED 150.00", groups 3/4 are "150.00 درهم".
    let code = nonEmpty(group(amount, 1, in: text)) ?? group(amount, 4, in: text)
    let figure = nonEmpty(group(amount, 2, in: text)) ?? group(amount, 3, in: text)
    // A redacted figure is not a figure.
    if figure.contains(where: { $0 == "·" || $0 == "*" || $0 == "X" || $0 == "x" }) { return nil }
    if !figure.unicodeScalars.contains(where: { CharacterSet.decimalDigits.contains($0) }) { return nil }

    return Read(
      currency: code.uppercased(),
      figure: figure,
      credit: credit,
      merchant: merchant(text, p),
      last4: p.last4.firstMatch(in: text, range: NSRange(text.startIndex..., in: text))
        .map { group($0, 1, in: text) }
    )
  }

  private static func merchant(_ body: String, _ p: Compiled) -> String? {
    let range = NSRange(body.startIndex..., in: body)
    guard let match = p.paymentMerchant.firstMatch(in: body, range: range)
      ?? p.merchant.firstMatch(in: body, range: range)
    else { return nil }
    var name = group(match, 1, in: body).trimmingCharacters(in: .whitespacesAndNewlines)
    while let last = name.last, last == "," || last == "." || last == "-" || last == " " {
      name.removeLast()
    }
    // Kotlin measures String.length in UTF-16 units.
    let length = name.utf16.count
    if length < 3 || length > 28 { return nil }
    if !name.contains(where: { $0.isLetter }) { return nil }
    let firstWord = name.split(separator: " ", maxSplits: 1, omittingEmptySubsequences: false)
      .first.map(String.init) ?? name
    if fullyMatches(p.bankWord, firstWord) { return nil }
    return name
  }

  private static func contains(_ regex: NSRegularExpression, _ text: String) -> Bool {
    regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
  }

  private static func fullyMatches(_ regex: NSRegularExpression, _ text: String) -> Bool {
    let whole = NSRange(text.startIndex..., in: text)
    return regex.firstMatch(in: text, options: [.anchored], range: whole)?.range == whole
  }

  private static func group(_ match: NSTextCheckingResult, _ index: Int, in text: String) -> String {
    guard index < match.numberOfRanges,
          let range = Range(match.range(at: index), in: text) else { return "" }
    return String(text[range])
  }

  private static func nonEmpty(_ value: String) -> String? { value.isEmpty ? nil : value }
}
