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

/// Only these bundled identities may name an asset; JSON never supplies a file path or URL.
enum WafraLogo {
  static let ids: Set<String> = ["amazon", "netflix", "spotify", "youtube", "apple", "google", "claude", "github", "notion", "discord", "telegram", "dropbox", "osn", "anghami", "audible", "shahid", "chatgpt", "crunchyroll", "disney", "deezer", "playstation", "xbox", "zoom", "du", "etisalat", "dewa", "sewa", "careem", "talabat", "deliveroo", "noon", "uber", "vercel"]
  static let monochrome: Set<String> = ["apple", "github", "notion", "uber", "vercel"]
  static func validated(_ value: String?) -> String? {
    guard let value, ids.contains(value) else { return nil }
    return value
  }
}

struct WafraBill: Hashable {
  let logoId: String?
  let title: String
  let amountMinor: Int64?
  let estimated: Bool
  let dueISO: String
  let due: Date
}

struct WafraSpendingCategory: Hashable {
  let label: String
  let amountMinor: Int64?
}

/// This month as the Spending tab shows it (src/lib/widget-snapshot.ts,
/// WidgetSpending). Optional in version 1: older snapshots carry none, and
/// the Spending widget then asks the person to open Wafra.
struct WafraSpending {
  /// YYYY-MM.
  let monthKey: String
  let totalMinor: Int64?
  /// Largest first, at most six.
  let categories: [WafraSpendingCategory]
  let otherMinor: Int64?

  var month: Int { Int(monthKey.suffix(2)) ?? 1 }

  static let segmentAlphas: [Double] = [0.92, 0.7, 0.5]
  static let restAlpha: Double = 0.24

  /// Share-bar segments in order (each category, then the rest together),
  /// as fractions of the bar with their opacity. Hidden or unknown amounts
  /// give no shares: the bar is then one quiet segment.
  func segments(hidden: Bool) -> [(share: Double, alpha: Double)] {
    let amounts = categories.map(\.amountMinor) + [otherMinor]
    guard !hidden, amounts.allSatisfy({ ($0 ?? -1) >= 0 }) else { return [] }
    let values = amounts.map { $0 ?? 0 }
    var sum: Int64 = 0
    for value in values {
      let next = sum.addingReportingOverflow(value)
      guard !next.overflow else { return [] }
      sum = next.partialValue
    }
    guard sum > 0 else { return [] }
    return values.enumerated().compactMap { index, value in
      guard value > 0 else { return nil }
      let alpha = index < categories.count && index < Self.segmentAlphas.count ? Self.segmentAlphas[index] : Self.restAlpha
      return (Double(value) / Double(sum), alpha)
    }
  }
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
  /// Nil in snapshots written before the Spending widget existed.
  let spending: WafraSpending?

  /// How much of the budgets is used: (limits - left) / limits in 0...1, as
  /// the Lock Screen gauge reads it. Nil without limits or when hidden.
  var budgetFraction: Double? {
    guard !hidden, let total = budgetTotalMinor, total > 0, let left = leftInBudgetsMinor else { return nil }
    return min(1, max(0, Double(total - left) / Double(total)))
  }

  /// Exact seven-day total; partial/hidden/overflowed data cannot invent a total.
  var weekTotalMinor: Int64? {
    guard !hidden, last7Minor.count == 7 else { return nil }
    var total: Int64 = 0
    for amount in last7Minor {
      guard let amount else { return nil }
      let next = total.addingReportingOverflow(amount)
      guard !next.overflow, (-9_007_199_254_740_991...9_007_199_254_740_991).contains(next.partialValue) else { return nil }
      total = next.partialValue
    }
    return total
  }

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
  let logoId: String?
  let title: String?
  let amountMinor: Double?
  let estimated: Bool?
  let dueISO: String?

  enum CodingKeys: String, CodingKey {
    case title, amountMinor, estimated, dueISO, logoId
  }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    logoId = try? c.decodeIfPresent(String.self, forKey: .logoId)
    title = try? c.decodeIfPresent(String.self, forKey: .title)
    amountMinor = (try? c.decodeIfPresent(LenientNumber.self, forKey: .amountMinor))?.value
    estimated = try? c.decodeIfPresent(Bool.self, forKey: .estimated)
    dueISO = try? c.decodeIfPresent(String.self, forKey: .dueISO)
  }
}

private struct RawSpendingCategory: Decodable {
  let label: String?
  let amountMinor: Double?

  enum CodingKeys: String, CodingKey { case label, amountMinor }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    label = try? c.decodeIfPresent(String.self, forKey: .label)
    amountMinor = (try? c.decodeIfPresent(LenientNumber.self, forKey: .amountMinor))?.value
  }
}

private struct RawSpending: Decodable {
  let monthKey: String?
  let totalMinor: Double?
  let categories: [Tolerant<RawSpendingCategory>]?
  let otherMinor: Double?

  enum CodingKeys: String, CodingKey { case monthKey, totalMinor, categories, otherMinor }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    monthKey = try? c.decodeIfPresent(String.self, forKey: .monthKey)
    totalMinor = (try? c.decodeIfPresent(LenientNumber.self, forKey: .totalMinor))?.value
    categories = try? c.decodeIfPresent([Tolerant<RawSpendingCategory>].self, forKey: .categories)
    otherMinor = (try? c.decodeIfPresent(LenientNumber.self, forKey: .otherMinor))?.value
  }

  /// A malformed month is no month.
  func validated(amount: (Double?) -> Int64?) -> WafraSpending? {
    guard let monthKey, monthKey.count == 7, monthKey.utf8.enumerated().allSatisfy({ index, char in
      index == 4 ? char == 45 : (char >= 48 && char <= 57)
    }), let month = Int(monthKey.suffix(2)), (1...12).contains(month) else { return nil }
    let named: [WafraSpendingCategory] = (categories ?? []).compactMap { entry in
      guard let row = entry.value, let label = row.label?.trimmingCharacters(in: .whitespacesAndNewlines),
            !label.isEmpty else { return nil }
      return WafraSpendingCategory(label: String(label.prefix(60)), amountMinor: amount(row.amountMinor))
    }
    return WafraSpending(monthKey: monthKey, totalMinor: amount(totalMinor),
                         categories: Array(named.prefix(6)), otherMinor: amount(otherMinor))
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
  let spending: RawSpending?

  enum CodingKeys: String, CodingKey {
    case version, generatedAt, language, todayISO, currency, exponent
    case amountsSensitive, hidden, todayMinor, todayCount, last7Minor
    case leftInBudgetsMinor, perDayMinor, budgetsOver, budgetTotalMinor, bills, spending
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
    spending = try? c.decodeIfPresent(RawSpending.self, forKey: .spending)
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
        logoId: WafraLogo.validated(bill.logoId),
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
      bills: parsedBills,
      spending: spending?.validated(amount: amount)
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

  /// The due pill: "Today", "Tomorrow", the weekday within the coming week
  /// ("Monday"), then "in 9 days", so a weekday never means next week's. A
  /// day before today keeps its date (e.g. "Mon 15 Sep").
  static func dueLabel(_ due: Date, now: Date, strings: WafraStrings) -> String {
    let calendar = self.calendar
    let today = calendar.startOfDay(for: now)
    let day = calendar.startOfDay(for: due)
    let ahead = calendar.dateComponents([.day], from: today, to: day).day ?? Int.min
    switch ahead {
    case 0: return strings.today
    case 1: return strings.tomorrow
    case 2...6: return formatter(strings.language, template: "EEEE").string(from: due)
    case 7...: return strings.inDays(ahead)
    default: return formatter(strings.language, template: "EEEdMMM").string(from: due)
    }
  }

  /// "September" / "سبتمبر".
  static func monthName(_ month: Int, language: WafraLanguage) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: language == .ar ? "ar@numbers=latn" : "en_US_POSIX")
    // Optional on purpose: an implicitly unwrapped array on Apple platforms.
    let symbols: [String]? = formatter.standaloneMonthSymbols
    let names = symbols ?? []
    let index = min(max(month - 1, 0), 11)
    return index < names.count ? names[index] : String(month)
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

  /// "1,836": whole major units, half up, as the preview and Home's week
  /// columns print them.
  static func whole(_ minor: Int64, exponent: Int) -> String {
    var scale: Int64 = 1
    for _ in 0..<max(0, min(exponent, 4)) { scale *= 10 }
    let magnitude = minor.magnitude
    let whole = (magnitude / UInt64(scale)) + ((magnitude % UInt64(scale)) * 2 >= UInt64(scale) && scale > 1 ? 1 : 0)
    let formatter = NumberFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.numberStyle = .decimal
    formatter.usesGroupingSeparator = true
    formatter.groupingSeparator = ","
    formatter.groupingSize = 3
    let text = formatter.string(from: NSNumber(value: whole)) ?? String(whole)
    return minor < 0 && whole > 0 ? "-" + text : text
  }

  /// What the listed bills add up to, "≈" when any is an estimate. Nil when an
  /// amount is hidden or unknown: a partial sum would understate what is due.
  static func billsTotal(_ bills: [WafraBill], in snapshot: WafraSnapshot) -> String? {
    guard !snapshot.hidden, !bills.isEmpty else { return nil }
    var total: Int64 = 0
    for bill in bills {
      guard let amount = bill.amountMinor else { return nil }
      let next = total.addingReportingOverflow(amount)
      guard !next.overflow else { return nil }
      total = next.partialValue
    }
    guard let text = format(total, currency: snapshot.currency, exponent: snapshot.exponent) else { return nil }
    return isolate(bills.contains(where: \.estimated) ? "≈ " + text : text, snapshot.language)
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
  /// The Arabic article is skipped ("الكهرباء" -> "ك"), as on Android and in
  /// the app's preview.
  static func of(_ title: String) -> String? {
    guard let start = title.firstIndex(where: { $0.isLetter }) else { return nil }
    var letter = title[start]
    let word = title[start...]
    if word.hasPrefix(arabicArticle), let next = word.dropFirst(arabicArticle.count).first, next.isLetter {
      letter = next
    }
    return String(letter).uppercased()
  }

  private static let arabicArticle = "\u{0627}\u{0644}"
}

enum WafraTitle {
  /// A bill title as the widget sets it. A title without a letter (a masked
  /// card such as "•••• 1234") is held left to right inside Arabic, so its
  /// digits and dots do not swap sides.
  static func display(_ title: String, _ language: WafraLanguage) -> String {
    guard language == .ar, WafraInitial.of(title) == nil else { return title }
    return "\u{200E}\(title)\u{200E}"
  }
}

// MARK: - Copy

struct WafraStrings {
  let language: WafraLanguage

  private func pick(_ en: String, _ ar: String) -> String { language == .ar ? ar : en }

  var last7Total: String { pick("Last 7 days", "آخر 7 أيام") }
  var today: String { pick("Today", "اليوم") }
  var tomorrow: String { pick("Tomorrow", "غداً") }
  var comingUp: String { pick("Coming up", "القادم") }
  var nothingComingUp: String { pick("All clear for the next 30 days", "لا مدفوعات مستحقة خلال 30 يومًا") }
  var spendingEmpty: String { pick("No spending yet this month", "لا إنفاق بعد هذا الشهر") }
  func totalDue(_ amount: String) -> String { language == .ar ? "المستحق \(amount)" : "Total due \(amount)" }
  /// "in 9 days" / "بعد 9 أيام" (3–10) / "بعد 16 يومًا" (11 and up), Latin digits.
  func inDays(_ days: Int) -> String {
    guard language == .ar else { return days == 1 ? "in 1 day" : "in \(days) days" }
    return days <= 10 ? "بعد \(days) أيام" : "بعد \(days) يومًا"
  }
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
  var spendingWidgetName: String { pick("Spending this month", "الإنفاق هذا الشهر") }
  var spendingWidgetDescription: String {
    pick("This month’s spending and the categories that take most of it.", "إنفاق هذا الشهر والفئات التي تأخذ معظمه.")
  }
  var lockWidgetName: String { pick("Wafra", "وفرة") }
  var lockWidgetDescription: String {
    pick("Today at a glance. Amounts are hidden while the phone is locked.",
         "اليوم بنظرة سريعة. تُخفى المبالغ عندما يكون الهاتف مقفلاً.")
  }
}
