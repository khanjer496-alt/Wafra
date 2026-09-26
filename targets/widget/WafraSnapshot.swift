import Foundation

// The widget snapshot contract (src/lib/widget-snapshot.ts, version 1).
//
// The widget reads nothing but this JSON from the shared App Group. Decoding is
// tolerant field by field, but validation is strict: a snapshot that is not
// version 1, has an unusable currency, or is too old is never drawn. Amounts
// must be whole minor units; anything else becomes "—" rather than a guess.

enum WafraShared {
  static let appGroup = "group.app.wafra.ios"
  static let snapshotKey = "wafra.widget.snapshot"
  /// Older than this, the widget asks the user to open Wafra instead of
  /// showing figures.
  static let staleAfter: TimeInterval = 36 * 60 * 60
  /// A snapshot stamped further than this in the future means the clock moved;
  /// its age cannot be trusted.
  static let futureTolerance: TimeInterval = 10 * 60
  static let appURL = URL(string: "wafra://")
}

enum WafraLanguage: String {
  case en
  case ar

  static var device: WafraLanguage {
    let first = Locale.preferredLanguages.first?.lowercased() ?? "en"
    return first.hasPrefix("ar") ? .ar : .en
  }
}

struct WafraBill: Hashable {
  let title: String
  let amountMinor: Int64?
  let estimated: Bool
  let dueISO: String
  let due: Date
}

struct WafraSnapshot {
  let generatedAt: Date
  let language: WafraLanguage
  let todayISO: String
  let currency: String
  let exponent: Int
  let amountsSensitive: Bool
  let hidden: Bool
  let todayMinor: Int64?
  let todayCount: Int?
  /// Exactly seven days ending today, oldest first; empty when unusable.
  let last7Minor: [Int64?]
  let leftInBudgetsMinor: Int64?
  let perDayMinor: Int64?
  let budgetsOver: Int
  /// Not in the v1 contract yet. When the app adds it, the circular Lock
  /// Screen widget draws a budget-used gauge; until then it shows the count.
  let budgetTotalMinor: Int64?
  let bills: [WafraBill]

  /// Young enough to draw at `date`.
  func isFresh(at date: Date) -> Bool {
    let age = date.timeIntervalSince(generatedAt)
    return age <= WafraShared.staleAfter && age >= -WafraShared.futureTolerance
  }

  /// "Today" figures belong to the device's current day. After midnight they
  /// are yesterday's and must not be shown as today's.
  func describesToday(at date: Date) -> Bool {
    isFresh(at: date) && todayISO == WafraDates.iso(date)
  }

  /// Bills still due on or after the device's current day, soonest first.
  func upcomingBills(at date: Date, limit: Int = 3) -> [WafraBill] {
    let today = WafraDates.calendar.startOfDay(for: date)
    return bills
      .filter { $0.due >= today }
      .sorted { $0.due < $1.due }
      .prefix(limit)
      .map { $0 }
  }
}

// MARK: - Loading

enum WafraSnapshotStore {
  static func load() -> WafraSnapshot? {
    guard
      let defaults = UserDefaults(suiteName: WafraShared.appGroup),
      let json = defaults.string(forKey: WafraShared.snapshotKey),
      let data = json.data(using: .utf8)
    else { return nil }
    return WafraSnapshot.decode(data)
  }
}

extension WafraSnapshot {
  static func decode(_ data: Data) -> WafraSnapshot? {
    guard let raw = try? JSONDecoder().decode(RawSnapshot.self, from: data) else { return nil }
    return raw.validated()
  }
}

// MARK: - Tolerant decoding

/// A JSON number that may also be null, a string, or missing. Never throws.
private struct LenientNumber: Decodable {
  let value: Double?

  init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    if container.decodeNil() {
      value = nil
    } else {
      value = try? container.decode(Double.self)
    }
  }
}

/// Decodes an element if it can, so one malformed bill does not discard the rest.
private struct Tolerant<T: Decodable>: Decodable {
  let value: T?

  init(from decoder: Decoder) throws {
    value = try? T(from: decoder)
  }
}

private struct RawBill: Decodable {
  let title: String?
  let amountMinor: Double?
  let estimated: Bool?
  let dueISO: String?

  enum CodingKeys: String, CodingKey {
    case title, amountMinor, estimated, dueISO
  }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    title = try? c.decodeIfPresent(String.self, forKey: .title)
    amountMinor = (try? c.decodeIfPresent(LenientNumber.self, forKey: .amountMinor))?.value
    estimated = try? c.decodeIfPresent(Bool.self, forKey: .estimated)
    dueISO = try? c.decodeIfPresent(String.self, forKey: .dueISO)
  }
}

private struct RawSnapshot: Decodable {
  let version: Double?
  let generatedAt: Double?
  let language: String?
  let todayISO: String?
  let currency: String?
  let exponent: Double?
  let amountsSensitive: Bool?
  let hidden: Bool?
  let todayMinor: Double?
  let todayCount: Double?
  let last7Minor: [LenientNumber]?
  let leftInBudgetsMinor: Double?
  let perDayMinor: Double?
  let budgetsOver: Double?
  let budgetTotalMinor: Double?
  let bills: [Tolerant<RawBill>]?

  enum CodingKeys: String, CodingKey {
    case version, generatedAt, language, todayISO, currency, exponent
    case amountsSensitive, hidden, todayMinor, todayCount, last7Minor
    case leftInBudgetsMinor, perDayMinor, budgetsOver, budgetTotalMinor, bills
  }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    version = try? c.decodeIfPresent(Double.self, forKey: .version)
    generatedAt = try? c.decodeIfPresent(Double.self, forKey: .generatedAt)
    language = try? c.decodeIfPresent(String.self, forKey: .language)
    todayISO = try? c.decodeIfPresent(String.self, forKey: .todayISO)
    currency = try? c.decodeIfPresent(String.self, forKey: .currency)
    exponent = try? c.decodeIfPresent(Double.self, forKey: .exponent)
    amountsSensitive = try? c.decodeIfPresent(Bool.self, forKey: .amountsSensitive)
    hidden = try? c.decodeIfPresent(Bool.self, forKey: .hidden)
    todayMinor = (try? c.decodeIfPresent(LenientNumber.self, forKey: .todayMinor))?.value
    todayCount = try? c.decodeIfPresent(Double.self, forKey: .todayCount)
    last7Minor = try? c.decodeIfPresent([LenientNumber].self, forKey: .last7Minor)
    leftInBudgetsMinor = (try? c.decodeIfPresent(LenientNumber.self, forKey: .leftInBudgetsMinor))?.value
    perDayMinor = (try? c.decodeIfPresent(LenientNumber.self, forKey: .perDayMinor))?.value
    budgetsOver = try? c.decodeIfPresent(Double.self, forKey: .budgetsOver)
    budgetTotalMinor = (try? c.decodeIfPresent(LenientNumber.self, forKey: .budgetTotalMinor))?.value
    bills = try? c.decodeIfPresent([Tolerant<RawBill>].self, forKey: .bills)
  }

  func validated() -> WafraSnapshot? {
    guard version == 1 else { return nil }
    guard let generatedAt, generatedAt.isFinite, generatedAt > 0 else { return nil }
    guard let currency, Self.isCurrencyCode(currency) else { return nil }
    guard let exponent = Self.wholeNumber(exponent), (0...4).contains(exponent) else { return nil }
    guard let todayISO, WafraDates.parse(todayISO) != nil else { return nil }

    // Missing privacy flags fall back to the more private reading.
    let hidden = self.hidden ?? true
    let amountsSensitive = self.amountsSensitive ?? true
    let amount: (Double?) -> Int64? = { hidden ? nil : Self.minorUnits($0) }

    var week: [Int64?] = []
    if let last7Minor, last7Minor.count == 7 {
      week = last7Minor.map { amount($0.value) }
    }

    let parsedBills: [WafraBill] = (bills ?? []).compactMap { entry in
      guard
        let bill = entry.value,
        let title = bill.title?.trimmingCharacters(in: .whitespacesAndNewlines),
        !title.isEmpty,
        let dueISO = bill.dueISO,
        let due = WafraDates.parse(dueISO)
      else { return nil }
      return WafraBill(
        title: title,
        amountMinor: amount(bill.amountMinor),
        estimated: bill.estimated ?? false,
        dueISO: dueISO,
        due: due
      )
    }

    let count = Self.wholeNumber(todayCount).flatMap { $0 >= 0 ? $0 : nil }

    return WafraSnapshot(
      generatedAt: Date(timeIntervalSince1970: generatedAt / 1_000),
      language: WafraLanguage(rawValue: language ?? "") ?? .en,
      todayISO: todayISO,
      currency: currency,
      exponent: exponent,
      amountsSensitive: amountsSensitive,
      hidden: hidden,
      todayMinor: amount(todayMinor),
      todayCount: count,
      last7Minor: week,
      leftInBudgetsMinor: amount(leftInBudgetsMinor),
      perDayMinor: amount(perDayMinor),
      budgetsOver: max(0, Self.wholeNumber(budgetsOver) ?? 0),
      budgetTotalMinor: amount(budgetTotalMinor),
      bills: parsedBills
    )
  }

  private static let maxSafeInteger: Double = 9_007_199_254_740_991

  /// Whole minor units only. A fractional or out-of-range value is not an
  /// amount this widget will draw.
  static func minorUnits(_ value: Double?) -> Int64? {
    guard let value, value.isFinite, value.rounded(.towardZero) == value,
          abs(value) <= maxSafeInteger else { return nil }
    return Int64(value)
  }

  static func wholeNumber(_ value: Double?) -> Int? {
    guard let value, value.isFinite, value.rounded(.towardZero) == value,
          abs(value) <= 1_000_000_000 else { return nil }
    return Int(value)
  }

  static func isCurrencyCode(_ code: String) -> Bool {
    code.count == 3 && code.unicodeScalars.allSatisfy { $0.value >= 65 && $0.value <= 90 }
  }
}

// MARK: - Dates

enum WafraDates {
  static var calendar: Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone.current
    calendar.locale = Locale(identifier: "en_US_POSIX")
    return calendar
  }

  /// Local calendar date as YYYY-MM-DD.
  static func iso(_ date: Date) -> String {
    let parts = calendar.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
  }

  /// Strict YYYY-MM-DD to local midnight; rejects impossible dates.
  static func parse(_ iso: String) -> Date? {
    let chars = Array(iso.utf8)
    guard chars.count == 10, chars[4] == 45, chars[7] == 45 else { return nil }
    for (index, char) in chars.enumerated() where index != 4 && index != 7 {
      guard char >= 48 && char <= 57 else { return nil }
    }
    guard
      let year = Int(iso.prefix(4)),
      let month = Int(iso.dropFirst(5).prefix(2)),
      let day = Int(iso.suffix(2)),
      let date = calendar.date(from: DateComponents(year: year, month: month, day: day))
    else { return nil }
    // Round-trip so 2026-02-31 does not quietly become 3 March.
    return self.iso(date) == iso ? calendar.startOfDay(for: date) : nil
  }

  static func startOfNextDay(after date: Date) -> Date? {
    let start = calendar.startOfDay(for: date)
    return calendar.date(byAdding: .day, value: 1, to: start)
  }

  static func formatter(_ language: WafraLanguage, template: String) -> DateFormatter {
    let formatter = DateFormatter()
    formatter.calendar = calendar
    formatter.timeZone = TimeZone.current
    // Latin digits in both languages, matching the amount formatting.
    formatter.locale = Locale(identifier: language == .ar ? "ar@numbers=latn" : "en_US_POSIX")
    formatter.setLocalizedDateFormatFromTemplate(template)
    return formatter
  }

  /// "Today", "Tomorrow", the weekday within the coming week ("Monday"), or
  /// e.g. "Mon 15 Sep" further out, so a weekday never means next week's.
  static func dueLabel(_ due: Date, now: Date, strings: WafraStrings) -> String {
    let calendar = self.calendar
    let today = calendar.startOfDay(for: now)
    let day = calendar.startOfDay(for: due)
    let ahead = calendar.dateComponents([.day], from: today, to: day).day ?? Int.min
    switch ahead {
    case 0: return strings.today
    case 1: return strings.tomorrow
    case 2...6: return formatter(strings.language, template: "EEEE").string(from: due)
    default: return formatter(strings.language, template: "EEEdMMM").string(from: due)
    }
  }

  /// Short weekday, e.g. "Mon".
  static func weekday(_ due: Date, language: WafraLanguage) -> String {
    formatter(language, template: "EEE").string(from: due)
  }
}

// MARK: - Money

enum WafraMoney {
  /// "<CURRENCY> 1,234.56" with exactly `exponent` fraction digits, or "—".
  static func format(_ minor: Int64?, in snapshot: WafraSnapshot) -> String {
    guard !snapshot.hidden, let minor else { return "—" }
    guard let text = format(minor, currency: snapshot.currency, exponent: snapshot.exponent) else { return "—" }
    return isolate(text, snapshot.language)
  }

  /// Just the number, e.g. "15.49", for the one-line Lock Screen widget.
  static func number(_ minor: Int64?, in snapshot: WafraSnapshot) -> String {
    guard !snapshot.hidden, let minor, let text = number(minor, exponent: snapshot.exponent) else { return "—" }
    return isolate(text, snapshot.language)
  }

  /// The currency code and the number apart, so the band figure can set the
  /// code smaller. Nil when the amount is hidden or unusable ("—").
  static func parts(_ minor: Int64?, in snapshot: WafraSnapshot) -> (currency: String, number: String)? {
    guard !snapshot.hidden, let minor, let text = number(minor, exponent: snapshot.exponent) else { return nil }
    return (snapshot.currency, text)
  }

  static func format(_ minor: Int64, currency: String, exponent: Int) -> String? {
    guard let text = number(minor, exponent: exponent) else { return nil }
    return "\(currency) \(text)"
  }

  static func number(_ minor: Int64, exponent: Int) -> String? {
    let value = Decimal(sign: minor < 0 ? .minus : .plus, exponent: -exponent, significand: Decimal(minor.magnitude))
    let formatter = NumberFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.numberStyle = .decimal
    formatter.usesGroupingSeparator = true
    formatter.groupingSeparator = ","
    formatter.groupingSize = 3
    formatter.decimalSeparator = "."
    formatter.minusSign = "-"
    formatter.minimumFractionDigits = exponent
    formatter.maximumFractionDigits = exponent
    formatter.minimumIntegerDigits = 1
    return formatter.string(from: NSDecimalNumber(decimal: value))
  }

  /// Keeps "≈ USD 15.49" in reading order inside Arabic (right-to-left) text.
  static func isolate(_ text: String, _ language: WafraLanguage) -> String {
    language == .ar ? "\u{200E}\(text)\u{200E}" : text
  }
}

// MARK: - Merchant tile

enum WafraInitial {
  /// The first letter of a bill's title for its tile ("DEWA" -> "D"). Nil when
  /// the title has no letter (a masked card such as "•••• 1234"); the tile
  /// then shows a plain glyph rather than a digit that reads like a figure.
  static func of(_ title: String) -> String? {
    guard let letter = title.first(where: { $0.isLetter }) else { return nil }
    return String(letter).uppercased()
  }
}

// MARK: - Copy

struct WafraStrings {
  let language: WafraLanguage

  private func pick(_ en: String, _ ar: String) -> String { language == .ar ? ar : en }

  var today: String { pick("Today", "اليوم") }
  var tomorrow: String { pick("Tomorrow", "غداً") }
  var comingUp: String { pick("Coming up", "القادم") }
  var nothingComingUp: String { pick("Nothing coming up", "لا توجد دفعات قادمة") }
  var left: String { pick("Left", "المتبقي") }
  var over: String { pick("Over", "تجاوز") }
  var openToUpdate: String { pick("Open Wafra to update", "افتح وفرة للتحديث") }
  var estimatePrefix: String { "≈ " }
  /// Spoken in place of "—" when an amount is hidden or unknown.
  var amountHidden: String { pick("Amount hidden", "المبلغ مخفي") }
  /// Words beside the amount in the Today widget. The amount is a separate,
  /// privacy-sensitive view, so these stay readable on the Lock Screen.
  var leftInBudgets: String { pick("left in budgets", "المتبقي في الميزانيات") }
  var overBudgets: String { pick("over budgets", "تجاوز الميزانيات") }
  /// Reading order of amount and words: "USD 360.00 left in budgets" /
  /// "المتبقي في الميزانيات USD 360.00".
  var amountLeadsBudgetLine: Bool { language == .en }

  func payments(_ count: Int?) -> String {
    guard let count else { return "—" }
    if language == .ar {
      switch count {
      case 0: return "لا دفعات بعد"
      case 1: return "دفعة واحدة"
      case 2: return "دفعتان"
      case 3...10: return "\(count) دفعات"
      default: return "\(count) دفعة"
      }
    }
    if count == 0 { return "No payments yet" }
    return count == 1 ? "1 payment" : "\(count) payments"
  }

  // Widget gallery copy follows the device language: there may be no
  // snapshot yet when the gallery opens.
  static var gallery: WafraStrings { WafraStrings(language: WafraLanguage.device) }

  var todayWidgetName: String { pick("Today", "اليوم") }
  var todayWidgetDescription: String {
    pick("Today's spending and the last 7 days.", "إنفاق اليوم وآخر 7 أيام.")
  }
  var comingUpWidgetName: String { pick("Coming up", "القادم") }
  var comingUpWidgetDescription: String {
    pick("The next bills and renewals Wafra knows about.", "الفواتير والتجديدات القادمة المعروفة لوفرة.")
  }
  var lockWidgetName: String { pick("Wafra", "وفرة") }
  var lockWidgetDescription: String {
    pick("Today at a glance. Amounts are hidden while the phone is locked.",
         "اليوم بنظرة سريعة. تُخفى المبالغ عندما يكون الهاتف مقفلاً.")
  }
}
