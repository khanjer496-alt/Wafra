import SwiftUI
import WidgetKit

// MARK: - Palette

struct WafraPalette {
  let background: Color
  let surface: Color
  let ink: Color
  let secondary: Color
  let accent: Color

  init(_ scheme: ColorScheme) {
    if scheme == .dark {
      background = Color(hex: 0x1C1A16)
      surface = Color(hex: 0x26231E)
      ink = Color(hex: 0xF2EFE8)
      secondary = Color(hex: 0xA9A29A)
      accent = Color(hex: 0x57B894)
    } else {
      background = Color(hex: 0xF4F1EA)
      surface = Color(hex: 0xFBF9F4)
      ink = Color(hex: 0x16130F)
      secondary = Color(hex: 0x57524A)
      accent = Color(hex: 0x1F6B52)
    }
  }
}

extension Color {
  init(hex: UInt32) {
    self.init(
      .sRGB,
      red: Double((hex >> 16) & 0xFF) / 255,
      green: Double((hex >> 8) & 0xFF) / 255,
      blue: Double(hex & 0xFF) / 255,
      opacity: 1
    )
  }
}

// MARK: - Shared modifiers

extension View {
  /// iOS 17+ requires containerBackground; earlier systems draw the
  /// background and margins themselves.
  @ViewBuilder
  func wafraWidgetBackground(_ color: Color) -> some View {
    if #available(iOS 17.0, *) {
      self.containerBackground(for: .widget) { color }
    } else {
      self
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(color)
    }
  }

  /// Lock Screen widgets take the system's vibrant material.
  @ViewBuilder
  func wafraAccessoryBackground() -> some View {
    if #available(iOS 17.0, *) {
      self.containerBackground(for: .widget) { Color.clear }
    } else {
      self
    }
  }

  /// Redacted by iOS while the device is locked (Lock Screen, StandBy).
  func wafraAmount(_ snapshot: WafraSnapshot) -> some View {
    privacySensitive(snapshot.amountsSensitive)
  }

  func wafraDirection(_ language: WafraLanguage) -> some View {
    environment(\.layoutDirection, language == .ar ? .rightToLeft : .leftToRight)
  }
}

// MARK: - Entry

struct WafraEntry: TimelineEntry {
  let date: Date
  let snapshot: WafraSnapshot?
  let isPlaceholder: Bool

  var language: WafraLanguage { snapshot?.language ?? WafraLanguage.device }
  var strings: WafraStrings { WafraStrings(language: language) }

  /// A snapshot whose "today" figures are current at this entry's date.
  var todaySnapshot: WafraSnapshot? {
    guard let snapshot, snapshot.describesToday(at: date) else { return nil }
    return snapshot
  }

  /// A snapshot young enough for its bills to be shown.
  var freshSnapshot: WafraSnapshot? {
    guard let snapshot, snapshot.isFresh(at: date) else { return nil }
    return snapshot
  }
}

// MARK: - Stale / missing

struct WafraUpdateNeededView: View {
  let title: String
  let strings: WafraStrings
  let palette: WafraPalette

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(title)
        .font(.caption.weight(.semibold))
        .foregroundColor(palette.secondary)
      Spacer(minLength: 0)
      Text(strings.openToUpdate)
        .font(.subheadline.weight(.medium))
        .foregroundColor(palette.ink)
        .lineLimit(3)
        .minimumScaleFactor(0.8)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

// MARK: - Today (systemSmall)

struct WafraTodayView: View {
  let entry: WafraEntry
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    let palette = WafraPalette(colorScheme)
    let strings = entry.strings
    Group {
      if let snapshot = entry.todaySnapshot {
        content(snapshot, strings: strings, palette: palette)
      } else {
        WafraUpdateNeededView(title: strings.today, strings: strings, palette: palette)
      }
    }
    .wafraDirection(entry.language)
    .wafraWidgetBackground(palette.background)
    .widgetURL(WafraShared.appURL)
  }

  private func content(_ snapshot: WafraSnapshot, strings: WafraStrings, palette: WafraPalette) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(strings.today)
        .font(.caption.weight(.semibold))
        .foregroundColor(palette.secondary)
      Text(WafraMoney.format(snapshot.todayMinor, in: snapshot))
        .font(.title3.weight(.semibold))
        .foregroundColor(palette.ink)
        .lineLimit(1)
        .minimumScaleFactor(0.5)
        .wafraAmount(snapshot)
      Text(strings.payments(snapshot.todayCount))
        .font(.caption2)
        .foregroundColor(palette.secondary)
        .lineLimit(1)
      Spacer(minLength: 4)
      WafraWeekBars(snapshot: snapshot, palette: palette)
        .frame(height: 26)
      if let left = snapshot.leftInBudgetsMinor {
        WafraLeftLine(left: left, snapshot: snapshot, strings: strings)
          .font(.caption2)
          .foregroundColor(palette.secondary)
          .padding(.top, 4)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

/// "Left USD 120.00", or "Over USD 40.00" when the budgets are exceeded.
struct WafraLeftLine: View {
  let left: Int64
  let snapshot: WafraSnapshot
  let strings: WafraStrings

  var body: some View {
    HStack(spacing: 4) {
      Text(left < 0 ? strings.over : strings.left)
      Text(WafraMoney.format(left < 0 ? -left : left, in: snapshot))
        .lineLimit(1)
        .minimumScaleFactor(0.6)
        .wafraAmount(snapshot)
    }
    .lineLimit(1)
  }
}

/// Seven days ending today, oldest first; today in the accent colour. The bar
/// heights reveal relative spending, so they are redacted with the amounts.
struct WafraWeekBars: View {
  let snapshot: WafraSnapshot
  let palette: WafraPalette

  var body: some View {
    let days = snapshot.last7Minor
    let known = days.compactMap { $0 }.map { max(0, $0) }
    let peak = known.max() ?? 0
    GeometryReader { proxy in
      HStack(alignment: .bottom, spacing: 4) {
        ForEach(0..<7, id: \.self) { index in
          let value = index < days.count ? days[index] : nil
          let isToday = index == 6
          RoundedRectangle(cornerRadius: 2, style: .continuous)
            .fill(isToday ? palette.accent : palette.secondary.opacity(0.35))
            .frame(height: barHeight(value, peak: peak, full: proxy.size.height))
            .frame(maxWidth: .infinity)
            .modifier(AccentableIf(isToday))
        }
      }
      .frame(maxHeight: .infinity, alignment: .bottom)
    }
    .wafraAmount(snapshot)
    .accessibilityHidden(true)
  }

  private func barHeight(_ value: Int64?, peak: Int64, full: CGFloat) -> CGFloat {
    let floor: CGFloat = 2
    guard let value, value > 0, peak > 0 else { return floor }
    let ratio = CGFloat(Double(value) / Double(peak))
    return max(floor, full * ratio)
  }
}

private struct AccentableIf: ViewModifier {
  let enabled: Bool
  init(_ enabled: Bool) { self.enabled = enabled }

  func body(content: Content) -> some View {
    content.widgetAccentable(enabled)
  }
}

// MARK: - Coming up (systemMedium)

struct WafraComingUpView: View {
  let entry: WafraEntry
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    let palette = WafraPalette(colorScheme)
    let strings = entry.strings
    Group {
      if let snapshot = entry.freshSnapshot {
        content(snapshot, strings: strings, palette: palette)
      } else {
        WafraUpdateNeededView(title: strings.comingUp, strings: strings, palette: palette)
      }
    }
    .wafraDirection(entry.language)
    .wafraWidgetBackground(palette.background)
    .widgetURL(WafraShared.appURL)
  }

  private func content(_ snapshot: WafraSnapshot, strings: WafraStrings, palette: WafraPalette) -> some View {
    let bills = snapshot.upcomingBills(at: entry.date)
    return VStack(alignment: .leading, spacing: 6) {
      Text(strings.comingUp)
        .font(.caption.weight(.semibold))
        .foregroundColor(palette.secondary)
      if bills.isEmpty {
        Spacer(minLength: 0)
        Text(strings.nothingComingUp)
          .font(.subheadline)
          .foregroundColor(palette.ink)
        Spacer(minLength: 0)
      } else {
        ForEach(bills, id: \.self) { bill in
          HStack(alignment: .firstTextBaseline, spacing: 8) {
            VStack(alignment: .leading, spacing: 0) {
              Text(bill.title)
                .font(.subheadline.weight(.medium))
                .foregroundColor(palette.ink)
                .lineLimit(1)
              Text(WafraDates.dueLabel(bill.due, now: entry.date, strings: strings))
                .font(.caption2)
                .foregroundColor(palette.secondary)
                .lineLimit(1)
            }
            Spacer(minLength: 4)
            Text(amountText(bill, snapshot: snapshot, strings: strings))
              .font(.subheadline.weight(.semibold))
              .foregroundColor(palette.ink)
              .lineLimit(1)
              .minimumScaleFactor(0.6)
              .wafraAmount(snapshot)
          }
        }
        Spacer(minLength: 0)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }

  private func amountText(_ bill: WafraBill, snapshot: WafraSnapshot, strings: WafraStrings) -> String {
    let amount = WafraMoney.format(bill.amountMinor, in: snapshot)
    guard bill.estimated, amount != "—" else { return amount }
    return WafraMoney.isolate(strings.estimatePrefix + amount, snapshot.language)
  }
}

// MARK: - Lock Screen (accessory families)

struct WafraLockScreenView: View {
  let entry: WafraEntry
  @Environment(\.widgetFamily) private var family

  var body: some View {
    Group {
      switch family {
      case .accessoryInline:
        inline
      case .accessoryCircular:
        circular
      default:
        rectangular
      }
    }
    .wafraDirection(entry.language)
    .wafraAccessoryBackground()
    .widgetURL(WafraShared.appURL)
  }

  private var strings: WafraStrings { entry.strings }

  // Today amount and "Left <amount>".
  @ViewBuilder
  private var rectangular: some View {
    if let snapshot = entry.todaySnapshot {
      VStack(alignment: .leading, spacing: 1) {
        Text(strings.today)
          .font(.caption.weight(.semibold))
          .widgetAccentable()
        Text(WafraMoney.format(snapshot.todayMinor, in: snapshot))
          .font(.headline)
          .lineLimit(1)
          .minimumScaleFactor(0.6)
          .wafraAmount(snapshot)
        if let left = snapshot.leftInBudgetsMinor {
          WafraLeftLine(left: left, snapshot: snapshot, strings: strings)
            .font(.caption)
        } else {
          Text(strings.payments(snapshot.todayCount))
            .font(.caption)
            .lineLimit(1)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    } else {
      VStack(alignment: .leading, spacing: 1) {
        Text(strings.today)
          .font(.caption.weight(.semibold))
          .widgetAccentable()
        Text(strings.openToUpdate)
          .font(.caption)
          .lineLimit(2)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  // Next bill, e.g. "Netflix Mon". The inline family draws a single line of
  // text that cannot redact only part of itself, and it lives on the Lock
  // Screen, so the amount is written only when amounts are not sensitive.
  @ViewBuilder
  private var inline: some View {
    if let snapshot = entry.freshSnapshot, let bill = snapshot.upcomingBills(at: entry.date, limit: 1).first {
      Text(inlineText(bill, snapshot: snapshot))
    } else if entry.freshSnapshot != nil {
      Text(strings.nothingComingUp)
    } else {
      Text(strings.openToUpdate)
    }
  }

  private func inlineText(_ bill: WafraBill, snapshot: WafraSnapshot) -> String {
    let due = WafraDates.calendar.startOfDay(for: entry.date) == bill.due
      ? strings.today
      : WafraDates.weekday(bill.due, language: snapshot.language)
    var parts = [bill.title, due]
    if !snapshot.amountsSensitive, !snapshot.hidden, bill.amountMinor != nil {
      let number = WafraMoney.number(bill.amountMinor, in: snapshot)
      parts.append(bill.estimated ? strings.estimatePrefix + number : number)
    }
    return parts.joined(separator: " ")
  }

  // Budget used when the total is known; otherwise today's payment count.
  @ViewBuilder
  private var circular: some View {
    ZStack {
      AccessoryWidgetBackground()
      if let snapshot = entry.todaySnapshot {
        if let fraction = budgetUsed(snapshot) {
          Gauge(value: fraction) {
            Text(strings.left)
          } currentValueLabel: {
            Text("\(Int((fraction * 100).rounded()))%")
          }
          .gaugeStyle(.accessoryCircularCapacity)
          .wafraAmount(snapshot)
        } else {
          VStack(spacing: 0) {
            Text(snapshot.todayCount.map(String.init) ?? "—")
              .font(.title3.weight(.semibold))
              .minimumScaleFactor(0.6)
            Text(strings.today)
              .font(.caption2)
              .lineLimit(1)
              .minimumScaleFactor(0.6)
          }
          .padding(4)
        }
      } else {
        Image(systemName: "arrow.clockwise")
          .font(.title3)
          .accessibilityLabel(strings.openToUpdate)
      }
    }
  }

  private func budgetUsed(_ snapshot: WafraSnapshot) -> Double? {
    guard let total = snapshot.budgetTotalMinor, total > 0,
          let left = snapshot.leftInBudgetsMinor else { return nil }
    let used = Double(total - left) / Double(total)
    return min(1, max(0, used))
  }
}
