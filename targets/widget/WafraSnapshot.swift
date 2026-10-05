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
  /// The category's own colour (0xRRGGBB), for the coin row. Nil in older
  /// snapshots, which keep the share bar.
  var color: UInt32? = nil
}

/// One coin of the Spending row: its colour and the amount sizing it, or nil
/// for an equal coin (hidden or unknown amounts).
struct WafraCoinSpec: Equatable {
  let color: UInt32
  let value: Int64?
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
  /// The pooled coin's colour (0xRRGGBB); nil in older snapshots.
  var otherColor: UInt32? = nil

  var month: Int { Int(monthKey.suffix(2)) ?? 1 }

  /// The Spending tab's coin row (src/lib/widget-coins.ts widgetSpendingCoins):
  /// each named category in its own colour, then one coin for the rest. Nil
  /// keeps the older share bar (no colours in the snapshot). Hidden or unknown
  /// amounts give one equal coin per named category and no rest coin, so no
  /// coin's size or presence hints at an amount.
  func coins(hidden: Bool) -> [WafraCoinSpec]? {
    guard !categories.isEmpty else { return nil }
    var colors: [UInt32] = []
    for category in categories {
      guard let color = category.color else { return nil }
      colors.append(color)
    }
    let amounts = categories.map(\.amountMinor) + [otherMinor]
    var sum: Int64 = 0
    var known = !hidden && amounts.allSatisfy { ($0 ?? -1) >= 0 }
    if known {
      for amount in amounts {
        let next = sum.addingReportingOverflow(amount ?? 0)
        guard !next.overflow else { known = false; break }
        sum = next.partialValue
      }
    }
    guard known, sum > 0 else { return colors.map { WafraCoinSpec(color: $0, value: nil) } }
    var coins: [WafraCoinSpec] = []
    for (index, category) in categories.enumerated() where (category.amountMinor ?? 0) > 0 {
      coins.append(WafraCoinSpec(color: colors[index], value: category.amountMinor))
    }
    if let rest = otherMinor, rest > 0 {
      guard let otherColor else { return nil }
      coins.append(WafraCoinSpec(color: otherColor, value: rest))
    }
    return coins.isEmpty ? nil : coins
  }

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
  let color: String?

  enum CodingKeys: String, CodingKey { case label, amountMinor, color }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    label = try? c.decodeIfPresent(String.self, forKey: .label)
    amountMinor = (try? c.decodeIfPresent(LenientNumber.self, forKey: .amountMinor))?.value
    color = try? c.decodeIfPresent(String.self, forKey: .color)
  }
}

enum WafraHexColor {
  /// "#RRGGBB" to 0xRRGGBB; anything else is no colour.
  static func parse(_ value: String?) -> UInt32? {
    guard let value, value.utf8.count == 7, value.hasPrefix("#") else { return nil }
    let digits = value.dropFirst()
    // No sign: UInt32(_:radix:) would accept "+FFFFF".
    guard digits.unicodeScalars.allSatisfy({ $0.properties.isASCIIHexDigit }) else { return nil }
    return UInt32(digits, radix: 16)
  }
}

private struct RawSpending: Decodable {
  let monthKey: String?
  let totalMinor: Double?
  let categories: [Tolerant<RawSpendingCategory>]?
  let otherMinor: Double?
  let otherColor: String?

  enum CodingKeys: String, CodingKey { case monthKey, totalMinor, categories, otherMinor, otherColor }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    monthKey = try? c.decodeIfPresent(String.self, forKey: .monthKey)
    totalMinor = (try? c.decodeIfPresent(LenientNumber.self, forKey: .totalMinor))?.value
    categories = try? c.decodeIfPresent([Tolerant<RawSpendingCategory>].self, forKey: .categories)
    otherMinor = (try? c.decodeIfPresent(LenientNumber.self, forKey: .otherMinor))?.value
    otherColor = try? c.decodeIfPresent(String.self, forKey: .otherColor)
  }

  /// A malformed month is no month.
  func validated(amount: (Double?) -> Int64?) -> WafraSpending? {
    guard let monthKey, monthKey.count == 7, monthKey.utf8.enumerated().allSatisfy({ index, char in
      index == 4 ? char == 45 : (char >= 48 && char <= 57)
    }), let month = Int(monthKey.suffix(2)), (1...12).contains(month) else { return nil }
    let named: [WafraSpendingCategory] = (categories ?? []).compactMap { entry in
      guard let row = entry.value, let label = row.label?.trimmingCharacters(in: .whitespacesAndNewlines),
            !label.isEmpty else { return nil }
      return WafraSpendingCategory(label: String(label.prefix(60)), amountMinor: amount(row.amountMinor),
                                   color: WafraHexColor.parse(row.color))
    }
    return WafraSpending(monthKey: monthKey, totalMinor: amount(totalMinor),
                         categories: Array(named.prefix(6)), otherMinor: amount(otherMinor),
                         otherColor: WafraHexColor.parse(otherColor))
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

// MARK: - Coins

/// The arithmetic behind the widgets' coins, mirroring src/lib/widget-coins.ts
/// (and WidgetGraphics.kt on Android). Foundation only, so
/// scripts/test/widget-native/main.swift checks it on macOS.
enum WafraCoinMath {
  /// Today's stack: one coin per payment today, at most six (Home's TODAY_COINS).
  static let todayCoinLimit = 6
  static let todayCoinWidth: Double = 22
  /// The Spending row, share-bar.tsx scaled to the widget's 26pt bar.
  static let rowHeight: Double = 26
  static let rowFace: Double = 10
  static let rowMinWidth: Double = 16
  static let rowOverlap: Double = 5
  /// Coming up's strip: the next 30 days, the next payment lifted.
  static let stripDays = 30
  static let stripTile: Double = 20
  static let stripLift: Double = 6
  static let stripHeight: Double = 30
  /// The circular Lock Screen ring.
  static let ringCoins = 12

  static func todayCoins(_ count: Int?) -> Int {
    guard let count else { return 0 }
    return min(todayCoinLimit, max(0, count))
  }

  /// A flat coin seen from a little above (coin-disc.tsx discGeometry).
  static func disc(width: Double) -> (face: Double, edge: Double) {
    ((width * 0.36).rounded(), max(3, (width * 0.13).rounded()))
  }

  /// Coins of a `total` ring a share fills (src/lib/coin-math.ts filledCoins):
  /// any share shows at least one coin, only a whole share fills the ring.
  static func filledCoins(_ share: Double, total: Int) -> Int {
    let count = max(1, total)
    guard share.isFinite, share > 0 else { return 0 }
    if share >= 1 { return count }
    return min(count - 1, max(1, Int((share * Double(count)).rounded())))
  }

  /// Flex-grow widths with a minimum, each coin overlapping the one before
  /// (share-bar.tsx). Any unknown value makes every coin equal.
  static func coinWidths(_ values: [Int64?], available: Double, minWidth: Double = rowMinWidth, overlap: Double = rowOverlap) -> [Double] {
    let count = values.count
    guard count > 0 else { return [] }
    let span = max(0, available + overlap * Double(count - 1))
    guard values.allSatisfy({ ($0 ?? 0) > 0 }) else {
      return Array(repeating: max(minWidth, span / Double(count)), count: count)
    }
    let weights = values.map { Double($0 ?? 0) }
    var fixed = Array(repeating: false, count: count)
    // Each pass fixes at least one coin at the minimum or returns.
    for _ in 0...count {
      let free = span - minWidth * Double(fixed.filter { $0 }.count)
      var weight = 0.0
      for index in 0..<count where !fixed[index] { weight += weights[index] }
      var changed = false
      for index in 0..<count where !fixed[index] {
        if weight <= 0 || free * weights[index] / weight < minWidth {
          fixed[index] = true
          changed = true
        }
      }
      if !changed {
        return (0..<count).map { fixed[$0] ? minWidth : free * weights[$0] / weight }
      }
      if fixed.allSatisfy({ $0 }) { break }
    }
    return Array(repeating: minWidth, count: count)
  }

  /// Each coin's leading x from the reading start; mirrored for right to left.
  static func coinOffsets(_ widths: [Double], available: Double, overlap: Double = rowOverlap, rtl: Bool) -> [Double] {
    var x = 0.0
    return widths.map { width in
      let at = rtl ? available - x - width : x
      x += width - overlap
      return at
    }
  }

  /// Where a pin sits along the strip, as a share of its width (pin-timeline.tsx).
  static func pinPosition(_ dayOffset: Int, days: Int = stripDays) -> Double {
    let clamped = Double(min(days, max(0, dayOffset)))
    return 3 + 94 * clamped / Double(max(1, days))
  }

  /// Tile centres, soonest first: on their dates, nudged apart so no tile
  /// covers another by more than a third, kept inside the strip.
  static func stripCenters(_ dayOffsets: [Int], width: Double, tile: Double = stripTile, days: Int = stripDays) -> [Double] {
    let gap = tile * 0.7
    let half = tile / 2
    var centers = dayOffsets.map { min(width - half, max(half, width * pinPosition($0, days: days) / 100)) }
    if centers.count > 1 {
      for index in 1..<centers.count { centers[index] = max(centers[index], centers[index - 1] + gap) }
    }
    if let last = centers.indices.last, centers[last] > width - half {
      centers[last] = width - half
      for index in stride(from: last - 1, through: 0, by: -1) { centers[index] = min(centers[index], centers[index + 1] - gap) }
    }
    return centers.map { max(half, $0) }
  }

  /// Whole days from `now`'s day to a due day (already local midnight).
  static func dayOffset(from now: Date, to due: Date) -> Int {
    let calendar = WafraDates.calendar
    return calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: calendar.startOfDay(for: due)).day ?? 0
  }
}

/// Which face the Today widget shows. Tapping its corner (iOS 17, an App
/// Intent in WafraTodayFlip.swift) turns it between today and the last
/// seven days; the choice lives in the App Group so every timeline sees it.
enum WafraTodayFace: String {
  case today
  case week

  static let storageKey = "wafra.widget.todayFace"
  static let widgetKind = "WafraToday"

  var flipped: WafraTodayFace { self == .today ? .week : .today }

  static func stored(in defaults: UserDefaults? = UserDefaults(suiteName: WafraShared.appGroup)) -> WafraTodayFace {
    WafraTodayFace(rawValue: defaults?.string(forKey: storageKey) ?? "") ?? .today
  }

  @discardableResult
  static func toggleStored(in defaults: UserDefaults? = UserDefaults(suiteName: WafraShared.appGroup)) -> WafraTodayFace {
    let next = stored(in: defaults).flipped
    defaults?.set(next.rawValue, forKey: storageKey)
    return next
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
  /// The Today widget's flip control (iOS 17), spoken as what it shows next.
  var showLast7Days: String { pick("Show the last 7 days", "عرض آخر 7 أيام") }
  var showToday: String { pick("Show today", "عرض اليوم") }
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
