import SwiftUI
import WidgetKit

// MARK: - Bands (design language E)

/// A widget wears its tab's band from src/constants/theme.ts (BandPalettes):
/// Today is Home's ink, Coming up is Bills' ochre. Dark mode deepens each band
/// (docs/design/language-e.md). Keep these hexes in step with theme.ts;
/// scripts/test/repair/widget-native-e.test.cjs checks them.
struct WafraBand {
  let band: Color
  let onBand: Color
  let onBandSecondary: Color
  /// The band's own tone, for merchant tiles.
  let tile: Color
  /// Week bars other than today.
  let mark: Color
  /// Mint: today's bar, the one good-news mark.
  let accent: Color

  static func home(_ scheme: ColorScheme) -> WafraBand {
    if scheme == .dark {
      return WafraBand(
        band: Color(hex: 0x0B0A08), onBand: Color(hex: 0xF2EFE8), onBandSecondary: Color(hex: 0x96938E),
        tile: Color(hex: 0x1D1C1A), mark: Color(hex: 0x605F5B), accent: Color(hex: 0x57B894)
      )
    }
    return WafraBand(
      band: Color(hex: 0x16130F), onBand: Color(hex: 0xF4F1EA), onBandSecondary: Color(hex: 0xA09D96),
      tile: Color(hex: 0x282521), mark: Color(hex: 0x64615C), accent: Color(hex: 0x57B894)
    )
  }

  /// Ochre is light: ink text on it. Dark ochre takes light text.
  static func bills(_ scheme: ColorScheme) -> WafraBand {
    if scheme == .dark {
      return WafraBand(
        band: Color(hex: 0x5E4719), onBand: Color(hex: 0xF2EFE8), onBandSecondary: Color(hex: 0xD6CFC1),
        tile: Color(hex: 0x6A542A), mark: Color(hex: 0xA4967A), accent: Color(hex: 0xF2EFE8)
      )
    }
    return WafraBand(
      band: Color(hex: 0xE2B45A), onBand: Color(hex: 0x16130F), onBandSecondary: Color(hex: 0x574727),
      tile: Color(hex: 0xE9CC94), mark: Color(hex: 0x7A6234), accent: Color(hex: 0x16130F)
    )
  }

  /// When iOS does not draw the band (tinted or clear Home Screen, StandBy,
  /// the iPad Lock Screen) the system recolours content to one tone and keeps
  /// only opacity. Solid tiles would then swallow the letters on them and ink
  /// text could vanish on a dark ground, so those renderings use the system's
  /// primary colour with translucent tiles and marks instead.
  func adapted(fullColor: Bool, backgroundShown: Bool) -> WafraBand {
    guard !fullColor || !backgroundShown else { return self }
    return WafraBand(
      band: band,
      onBand: .primary,
      onBandSecondary: Color.primary.opacity(0.72),
      tile: Color.primary.opacity(0.16),
      mark: Color.primary.opacity(0.35),
      accent: fullColor ? accent : .primary
    )
  }
}

/// Resolves a band for the current scheme and rendering, and hands it to the
/// widget's content.
struct WafraBandReader<Content: View>: View {
  let palette: (ColorScheme) -> WafraBand
  @ViewBuilder let content: (WafraBand) -> Content

  var body: some View {
    if #available(iOS 17.0, *) {
      WafraBandReader17(palette: palette, content: content)
    } else {
      WafraBandReader16(palette: palette, content: content)
    }
  }
}

@available(iOS 17.0, *)
private struct WafraBandReader17<Content: View>: View {
  let palette: (ColorScheme) -> WafraBand
  let content: (WafraBand) -> Content
  @Environment(\.colorScheme) private var scheme
  @Environment(\.widgetRenderingMode) private var mode
  @Environment(\.showsWidgetContainerBackground) private var backgroundShown

  var body: some View {
    content(palette(scheme).adapted(fullColor: mode == .fullColor, backgroundShown: backgroundShown))
  }
}

private struct WafraBandReader16<Content: View>: View {
  let palette: (ColorScheme) -> WafraBand
  let content: (WafraBand) -> Content
  @Environment(\.colorScheme) private var scheme
  @Environment(\.widgetRenderingMode) private var mode

  var body: some View {
    content(palette(scheme).adapted(fullColor: mode == .fullColor, backgroundShown: true))
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
  let band: WafraBand

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(title)
        .font(.caption.weight(.semibold))
        .foregroundColor(band.onBandSecondary)
      Spacer(minLength: 0)
      Text(strings.openToUpdate)
        .font(.subheadline.weight(.medium))
        .foregroundColor(band.onBand)
        .lineLimit(3)
        .minimumScaleFactor(0.8)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

// MARK: - Today (systemSmall, ink band)

struct WafraTodayView: View {
  let entry: WafraEntry
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    let strings = entry.strings
    WafraBandReader(palette: WafraBand.home) { band in
      Group {
        if let snapshot = entry.todaySnapshot {
          content(snapshot, strings: strings, band: band)
        } else {
          WafraUpdateNeededView(title: strings.today, strings: strings, band: band)
        }
      }
    }
    .wafraDirection(entry.language)
    .wafraWidgetBackground(WafraBand.home(colorScheme).band)
    .widgetURL(WafraShared.appURL)
  }

  // Week bars from real figures at the top; the one figure that matters sits
  // low on the band, as in the Home header.
  private func content(_ snapshot: WafraSnapshot, strings: WafraStrings, band: WafraBand) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      WafraWeekBars(snapshot: snapshot, band: band)
        .frame(height: 22)
      Spacer(minLength: 6)
      VStack(alignment: .leading, spacing: 0) {
        Text(strings.today)
          .font(.caption.weight(.medium))
          .foregroundColor(band.onBandSecondary)
          .lineLimit(1)
        WafraBandFigure(minor: snapshot.todayMinor, snapshot: snapshot, strings: strings, band: band)
      }
      WafraTodayLine(snapshot: snapshot, strings: strings, band: band)
        .padding(.top, 2)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

/// The band figure: the currency code set smaller, then the number in a
/// semibold system face with tabular digits (never a monospaced face, whose
/// comma spaces out "5 , 480").
struct WafraBandFigure: View {
  let minor: Int64?
  let snapshot: WafraSnapshot
  let strings: WafraStrings
  let band: WafraBand

  var body: some View {
    figure
      .lineLimit(1)
      .minimumScaleFactor(0.45)
      .widgetAccentable()
      .wafraAmount(snapshot)
      .modifier(HiddenAmountLabel(label: parts == nil ? strings.amountHidden : nil))
  }

  private var parts: (currency: String, number: String)? { WafraMoney.parts(minor, in: snapshot) }

  private var figure: Text {
    let numberFont = Font.title.weight(.semibold).monospacedDigit()
    guard let parts else {
      return Text("—").font(numberFont).foregroundColor(band.onBand)
    }
    // Keeps "AED 24.00" in reading order inside Arabic text.
    let mark = snapshot.language == .ar ? "\u{200E}" : ""
    return Text(mark + parts.currency + " ")
      .font(.body.weight(.medium))
      .foregroundColor(band.onBandSecondary)
      + Text(parts.number + mark)
      .font(numberFont)
      .foregroundColor(band.onBand)
  }
}

private struct HiddenAmountLabel: ViewModifier {
  let label: String?

  func body(content: Content) -> some View {
    if let label {
      content.accessibilityLabel(label)
    } else {
      content
    }
  }
}

/// "USD 360.00 left in budgets" when budgets are set, otherwise today's
/// payment count. Only the amount is privacy-sensitive; the words stay.
struct WafraTodayLine: View {
  let snapshot: WafraSnapshot
  let strings: WafraStrings
  let band: WafraBand

  var body: some View {
    Group {
      if let left = snapshot.leftInBudgetsMinor {
        ViewThatFits(in: .horizontal) {
          HStack(spacing: 4) { ordered(left) }
            .fixedSize()
          VStack(alignment: .leading, spacing: 0) { ordered(left) }
        }
      } else {
        Text(strings.payments(snapshot.todayCount))
          .lineLimit(1)
          .minimumScaleFactor(0.8)
      }
    }
    .font(.caption2)
    .foregroundColor(band.onBandSecondary)
  }

  @ViewBuilder
  private func ordered(_ left: Int64) -> some View {
    let words = Text(left < 0 ? strings.overBudgets : strings.leftInBudgets)
    let amount = Text(WafraMoney.format(left < 0 ? -left : left, in: snapshot))
      .font(.caption2.monospacedDigit())
    if strings.amountLeadsBudgetLine {
      amount.lineLimit(1).minimumScaleFactor(0.7).wafraAmount(snapshot)
      words.lineLimit(1).minimumScaleFactor(0.8)
    } else {
      words.lineLimit(1).minimumScaleFactor(0.8)
      amount.lineLimit(1).minimumScaleFactor(0.7).wafraAmount(snapshot)
    }
  }
}

/// "Left USD 120.00", or "Over USD 40.00" when the budgets are exceeded.
/// The Lock Screen's rectangular widget uses it.
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

/// Seven days ending today, oldest first; today in mint. The bar heights
/// reveal relative spending, so they are redacted with the amounts.
struct WafraWeekBars: View {
  let snapshot: WafraSnapshot
  let band: WafraBand

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
            .fill(isToday ? band.accent : band.mark)
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

// MARK: - Coming up (systemMedium, ochre band)

struct WafraComingUpView: View {
  let entry: WafraEntry
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    let strings = entry.strings
    WafraBandReader(palette: WafraBand.bills) { band in
      Group {
        if let snapshot = entry.freshSnapshot {
          content(snapshot, strings: strings, band: band)
        } else {
          WafraUpdateNeededView(title: strings.comingUp, strings: strings, band: band)
        }
      }
    }
    .wafraDirection(entry.language)
    .wafraWidgetBackground(WafraBand.bills(colorScheme).band)
    .widgetURL(WafraShared.appURL)
  }

  private func content(_ snapshot: WafraSnapshot, strings: WafraStrings, band: WafraBand) -> some View {
    let bills = snapshot.upcomingBills(at: entry.date)
    return VStack(alignment: .leading, spacing: 0) {
      Text(strings.comingUp)
        .font(.caption.weight(.semibold))
        .foregroundColor(band.onBand)
        .lineLimit(1)
        .padding(.bottom, 8)
      if bills.isEmpty {
        Spacer(minLength: 0)
        Text(strings.nothingComingUp)
          .font(.subheadline.weight(.medium))
          .foregroundColor(band.onBand)
        Spacer(minLength: 0)
      } else {
        // Three rows where they fit; the smallest phones and the largest
        // text sizes show the first two (or one) instead of clipping.
        ViewThatFits(in: .vertical) {
          rows(bills, snapshot: snapshot, strings: strings, band: band)
          rows(Array(bills.prefix(2)), snapshot: snapshot, strings: strings, band: band)
          rows(Array(bills.prefix(1)), snapshot: snapshot, strings: strings, band: band)
        }
        Spacer(minLength: 0)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }

  private func rows(_ bills: [WafraBill], snapshot: WafraSnapshot, strings: WafraStrings, band: WafraBand) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      ForEach(bills, id: \.self) { bill in
        HStack(spacing: 10) {
          WafraMerchantTile(title: bill.title, band: band)
          VStack(alignment: .leading, spacing: 0) {
            Text(bill.title)
              .font(.footnote.weight(.semibold))
              .foregroundColor(band.onBand)
              .lineLimit(1)
            Text(WafraDates.dueLabel(bill.due, now: entry.date, strings: strings))
              .font(.caption)
              .foregroundColor(band.onBandSecondary)
              .lineLimit(1)
          }
          Spacer(minLength: 6)
          Text(amountText(bill, snapshot: snapshot, strings: strings))
            .font(.footnote.weight(.semibold).monospacedDigit())
            .foregroundColor(band.onBand)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .wafraAmount(snapshot)
            .modifier(HiddenAmountLabel(label: bill.amountMinor == nil || snapshot.hidden ? strings.amountHidden : nil))
        }
        // Children stay separate accessibility elements: combining them would
        // fold the privacy-sensitive amount into one label with the title.
      }
    }
  }

  private func amountText(_ bill: WafraBill, snapshot: WafraSnapshot, strings: WafraStrings) -> String {
    let amount = WafraMoney.format(bill.amountMinor, in: snapshot)
    guard bill.estimated, amount != "—" else { return amount }
    return WafraMoney.isolate(strings.estimatePrefix + amount, snapshot.language)
  }
}

/// The bill's merchant tile: its initial on the band's own tone (the widget
/// has no logo images; the snapshot carries titles only). A title with no
/// letter shows a plain calendar glyph.
struct WafraMerchantTile: View {
  let title: String
  let band: WafraBand

  var body: some View {
    ZStack {
      RoundedRectangle(cornerRadius: 8, style: .continuous)
        .fill(band.tile)
      if let initial = WafraInitial.of(title) {
        Text(initial)
          .font(.system(size: 14, weight: .bold))
          .foregroundColor(band.onBand)
      } else {
        Image(systemName: "calendar")
          .font(.system(size: 13, weight: .semibold))
          .foregroundColor(band.onBand)
      }
    }
    .frame(width: 28, height: 28)
    .widgetAccentable()
    .accessibilityHidden(true)
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
