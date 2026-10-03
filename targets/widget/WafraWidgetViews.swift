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
  /// Over budget: the light status-over tint, readable on every dark band.
  var over: Color = Color(hex: 0xE08A70)

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

  /// Spending's clay band, light text in both schemes.
  static func spending(_ scheme: ColorScheme) -> WafraBand {
    if scheme == .dark {
      return WafraBand(
        band: Color(hex: 0x6E2B1E), onBand: Color(hex: 0xF2EFE8), onBandSecondary: Color(hex: 0xD0BCB3),
        tile: Color(hex: 0x793B2E), mark: Color(hex: 0xA98379), accent: Color(hex: 0xF2EFE8)
      )
    }
    return WafraBand(
      band: Color(hex: 0xA4432F), onBand: Color(hex: 0xF4F1EA), onBandSecondary: Color(hex: 0xEBDED5),
      tile: Color(hex: 0x8D3B2A), mark: Color(hex: 0xD5ADA1), accent: Color(hex: 0xF4F1EA)
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
      accent: fullColor ? accent : .primary,
      over: fullColor ? over : .primary
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
    .dynamicTypeSize(...DynamicTypeSize.xxLarge)
    .wafraWidgetBackground(WafraBand.home(colorScheme).band)
    .widgetURL(WafraShared.appURL)
  }

  // The week where it fits (its bars, a pattern corner and the exact
  // seven-day total that labels them); at the largest text sizes the figure
  // and its line alone, as Android does below 152dp.
  private func content(_ snapshot: WafraSnapshot, strings: WafraStrings, band: WafraBand) -> some View {
    ViewThatFits(in: .vertical) {
      layout(snapshot, strings: strings, band: band, week: true)
      layout(snapshot, strings: strings, band: band, week: false)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }

  private func layout(_ snapshot: WafraSnapshot, strings: WafraStrings, band: WafraBand, week: Bool) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      if week {
        // The label with, in the corner, the pattern; then the bars it names
        // and their total in whole units (spoken exactly), which never breaks.
        HStack(alignment: .center, spacing: 8) {
          Text(strings.last7Total)
            .font(.caption)
            .foregroundColor(band.onBandSecondary)
            .lineLimit(1)
          Spacer(minLength: 0)
          WafraPatternCorner(band: band)
        }
        HStack(alignment: .bottom, spacing: 8) {
          WafraWeekBars(snapshot: snapshot, band: band)
            .frame(maxWidth: 96)
            .frame(height: 20)
          Spacer(minLength: 0)
          Text(weekTotal(snapshot))
            .font(.caption.weight(.semibold).monospacedDigit())
            .foregroundColor(band.onBand)
            .lineLimit(1)
            .minimumScaleFactor(0.75)
            .layoutPriority(1)
            .wafraAmount(snapshot)
            .accessibilityLabel(snapshot.weekTotalMinor == nil ? strings.amountHidden : WafraMoney.format(snapshot.weekTotalMinor, in: snapshot))
        }
        .padding(.top, 4)
      }
      Spacer(minLength: 4)
      VStack(alignment: .leading, spacing: 0) {
        Text(strings.today)
          .font(.caption.weight(.medium))
          .foregroundColor(band.onBandSecondary)
          .lineLimit(1)
        WafraBandFigure(minor: snapshot.todayMinor, snapshot: snapshot, strings: strings, band: band)
          .layoutPriority(1)
      }
      if let fraction = snapshot.budgetFraction {
        WafraBudgetBar(fraction: fraction, over: snapshot.budgetsOver > 0, band: band)
          .padding(.top, 2)
          .padding(.bottom, 3)
      }
      WafraTodayLine(snapshot: snapshot, strings: strings, band: band)
        .padding(.top, snapshot.budgetFraction == nil ? 2 : 0)
    }
  }
}

private func weekTotal(_ snapshot: WafraSnapshot) -> String {
  guard !snapshot.hidden, let total = snapshot.weekTotalMinor else { return "—" }
  return WafraMoney.isolate("\(snapshot.currency) \(WafraMoney.whole(total, exponent: snapshot.exponent))", snapshot.language)
}

/// Seven bars, oldest first, on the week's own scale: today in the accent,
/// earlier days in the band's mark tone, and a day with nothing (or any day
/// when amounts are hidden) a thin baseline. Shapes only; the labelled total
/// beside them carries the figure.
struct WafraWeekBars: View {
  let snapshot: WafraSnapshot
  let band: WafraBand

  private var values: [Int64] {
    guard !snapshot.hidden, snapshot.last7Minor.count == 7 else { return Array(repeating: 0, count: 7) }
    return snapshot.last7Minor.map { max(0, $0 ?? 0) }
  }

  var body: some View {
    let days = values
    let peak = days.max() ?? 0
    GeometryReader { geometry in
      HStack(alignment: .bottom, spacing: 3) {
        ForEach(0..<days.count, id: \.self) { index in
          let value = days[index]
          let height: CGFloat = peak > 0 && value > 0
            ? max(4, CGFloat(Double(value) / Double(peak)) * geometry.size.height)
            : 2
          RoundedRectangle(cornerRadius: 2, style: .continuous)
            .fill(index == days.count - 1 && value > 0 ? band.accent : band.mark.opacity(value > 0 ? 1 : 0.6))
            .frame(height: height)
        }
      }
      .frame(maxHeight: .infinity, alignment: .bottom)
    }
    .accessibilityHidden(true)
  }
}

/// Three of the pattern's shapes (src/components/ui/pattern-mosaic.tsx),
/// small, in the band's own tones: a quarter circle, a ring and a dot.
struct WafraPatternCorner: View {
  let band: WafraBand

  var body: some View {
    HStack(alignment: .bottom, spacing: 3) {
      WafraQuarter()
        .fill(band.tile)
        .frame(width: 12, height: 12)
      Circle()
        .strokeBorder(band.mark, lineWidth: 2)
        .frame(width: 10, height: 10)
      Circle()
        .fill(band.accent)
        .frame(width: 5, height: 5)
        .padding(.bottom, 2)
    }
    .accessibilityHidden(true)
  }
}

/// A square whose top leading corner is a full quarter circle.
struct WafraQuarter: Shape {
  func path(in rect: CGRect) -> Path {
    var path = Path()
    path.move(to: CGPoint(x: rect.minX, y: rect.maxY))
    path.addArc(center: CGPoint(x: rect.maxX, y: rect.maxY), radius: min(rect.width, rect.height),
                startAngle: .degrees(180), endAngle: .degrees(270), clockwise: false)
    path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
    path.closeSubpath()
    return path
  }
}

/// How much of the month's budgets is used, from the reading start: the
/// accent, or the over colour once any budget is past its limit.
struct WafraBudgetBar: View {
  let fraction: Double
  let over: Bool
  let band: WafraBand

  var body: some View {
    GeometryReader { geometry in
      ZStack(alignment: .leading) {
        Capsule().fill(band.tile)
        Capsule()
          .fill(over ? band.over : band.accent)
          .frame(width: fraction > 0 ? max(4, geometry.size.width * CGFloat(fraction)) : 0)
      }
    }
    .frame(height: 4)
    .accessibilityHidden(true)
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

// MARK: - Coming up (systemSmall and systemMedium, ochre band)

struct WafraComingUpView: View {
  let entry: WafraEntry
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.widgetFamily) private var family

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
    .dynamicTypeSize(...DynamicTypeSize.xxLarge)
    .wafraWidgetBackground(WafraBand.bills(colorScheme).band)
    .widgetURL(WafraShared.appURL)
  }

  private func content(_ snapshot: WafraSnapshot, strings: WafraStrings, band: WafraBand) -> some View {
    let bills = snapshot.upcomingBills(at: entry.date)
    // The small size lists two bills without amounts, as the design draws it.
    let small = family == .systemSmall
    return Group {
      if bills.isEmpty {
        VStack(alignment: .leading, spacing: 0) {
          header(nil, strings: strings, band: band, snapshot: snapshot)
          Spacer(minLength: 0)
          VStack(spacing: 6) {
            Image(systemName: "calendar")
              .font(.title3.weight(.semibold))
              .foregroundColor(band.onBand)
              .accessibilityHidden(true)
            Text(strings.nothingComingUp)
              .font(.subheadline.weight(.medium))
              .foregroundColor(band.onBand)
              .multilineTextAlignment(.center)
              .minimumScaleFactor(0.8)
          }
          .frame(maxWidth: .infinity)
          Spacer(minLength: 0)
        }
      } else {
        // Three rows where they fit; the smallest phones and the largest
        // text sizes show the first two (or one) instead of clipping. The
        // header's total is always the total of the rows shown.
        ViewThatFits(in: .vertical) {
          if !small {
            listing(bills, snapshot: snapshot, strings: strings, band: band, amounts: true)
          }
          listing(Array(bills.prefix(2)), snapshot: snapshot, strings: strings, band: band, amounts: !small)
          listing(Array(bills.prefix(1)), snapshot: snapshot, strings: strings, band: band, amounts: !small)
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }

  private func listing(_ bills: [WafraBill], snapshot: WafraSnapshot, strings: WafraStrings, band: WafraBand, amounts: Bool) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      header(WafraMoney.billsTotal(bills, in: snapshot), strings: strings, band: band, snapshot: snapshot)
      rows(bills, snapshot: snapshot, strings: strings, band: band, amounts: amounts)
      Spacer(minLength: 0)
    }
  }

  /// "Coming up" and, where it fits, what the listed bills add up to.
  private func header(_ total: String?, strings: WafraStrings, band: WafraBand, snapshot: WafraSnapshot) -> some View {
    let title = Text(strings.comingUp)
      .font(.caption.weight(.semibold))
      .foregroundColor(band.onBand)
      .lineLimit(1)
    return ViewThatFits(in: .horizontal) {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        title
        Spacer(minLength: 0)
        if let total {
          Text(total)
            .font(.caption.weight(.semibold).monospacedDigit())
            .foregroundColor(band.onBand)
            .lineLimit(1)
            .wafraAmount(snapshot)
            .accessibilityLabel(strings.totalDue(total))
        }
      }
      title.frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(.bottom, 8)
  }

  private func rows(_ bills: [WafraBill], snapshot: WafraSnapshot, strings: WafraStrings, band: WafraBand, amounts: Bool) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      ForEach(bills, id: \.self) { bill in
        HStack(spacing: 10) {
          WafraMerchantTile(title: bill.title, logoId: bill.logoId, band: band)
          VStack(alignment: .leading, spacing: 0) {
            Text(WafraTitle.display(bill.title, snapshot.language))
              .font(.footnote.weight(.semibold))
              .foregroundColor(band.onBand)
              .lineLimit(1)
            // The due pill: Today, Tomorrow, a weekday, then "in 9 days".
            Text(WafraDates.dueLabel(bill.due, now: entry.date, strings: strings))
              .font(.caption2.weight(.medium))
              .foregroundColor(band.onBand)
              .lineLimit(1)
              .padding(.horizontal, 6)
              .padding(.vertical, 1)
              .background(Capsule().fill(band.tile))
              .padding(.top, 2)
          }
          Spacer(minLength: 6)
          if amounts {
            Text(amountText(bill, snapshot: snapshot, strings: strings))
              .font(.footnote.weight(.semibold).monospacedDigit())
              .foregroundColor(band.onBand)
              .lineLimit(1)
              .minimumScaleFactor(0.6)
              .layoutPriority(1)
              .wafraAmount(snapshot)
              .modifier(HiddenAmountLabel(label: bill.amountMinor == nil || snapshot.hidden ? strings.amountHidden : nil))
          }
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

/// Offline bundled logo when the snapshot carries an allowlisted identity.
/// Older/unknown identities keep their initial, or a calendar for masked cards.
///
/// In accented (tinted) rendering only the tile and the initial take the
/// accent; a full-colour logo is desaturated rather than flattened into a
/// solid tinted block (iOS 18).
struct WafraMerchantTile: View {
  let title: String
  let logoId: String?
  let band: WafraBand

  var body: some View {
    ZStack {
      RoundedRectangle(cornerRadius: 8, style: .continuous)
        .fill(band.tile)
        .widgetAccentable()
      if let id = WafraLogo.validated(logoId) {
        if WafraLogo.monochrome.contains(id) {
          Image("wafra_logo_" + id)
            .renderingMode(.template)
            .resizable()
            .scaledToFit()
            .frame(width: 22, height: 22)
            .foregroundColor(band.onBand)
        } else {
          WafraFullColorLogo(name: "wafra_logo_" + id)
        }
      } else if let initial = WafraInitial.of(title) {
        Text(initial)
          .font(.system(size: 14, weight: .bold))
          .foregroundColor(band.onBand)
          .widgetAccentable()
      } else {
        Image(systemName: "calendar")
          .font(.system(size: 13, weight: .semibold))
          .foregroundColor(band.onBand)
      }
    }
    .frame(width: 28, height: 28)
    .accessibilityHidden(true)
  }
}

/// A brand's own pixels. Accented rendering (iOS 18 tinted Home Screen)
/// would otherwise draw the whole image as one flat tint.
private struct WafraFullColorLogo: View {
  let name: String

  var body: some View {
    if #available(iOS 18.0, *) {
      Image(name)
        .renderingMode(.original)
        .resizable()
        .widgetAccentedRenderingMode(.accentedDesaturated)
        .scaledToFit()
        .frame(width: 22, height: 22)
    } else {
      Image(name)
        .renderingMode(.original)
        .resizable()
        .scaledToFit()
        .frame(width: 22, height: 22)
    }
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

// MARK: - Spending this month (systemMedium, clay band)

/// This month as the Spending tab shows it: the month and its total, a share
/// bar of the categories (three named in falling strength, the rest quiet)
/// and the three largest with whole-unit amounts. A snapshot written before
/// this widget existed has no month, so the widget asks to open Wafra.
struct WafraSpendingView: View {
  let entry: WafraEntry
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    let strings = entry.strings
    WafraBandReader(palette: WafraBand.spending) { band in
      Group {
        if let snapshot = entry.freshSnapshot, let spending = snapshot.spending {
          content(snapshot, spending: spending, strings: strings, band: band)
        } else {
          WafraUpdateNeededView(title: strings.spendingWidgetName, strings: strings, band: band)
        }
      }
    }
    .wafraDirection(entry.language)
    .dynamicTypeSize(...DynamicTypeSize.xxLarge)
    .wafraWidgetBackground(WafraBand.spending(colorScheme).band)
    .widgetURL(WafraShared.appURL)
  }

  private func content(_ snapshot: WafraSnapshot, spending: WafraSpending, strings: WafraStrings, band: WafraBand) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        Text(WafraDates.monthName(spending.month, language: snapshot.language))
          .font(.footnote.weight(.semibold))
          .foregroundColor(band.onBand)
          .lineLimit(1)
        Spacer(minLength: 0)
        if !snapshot.hidden, !spending.categories.isEmpty, let total = spending.totalMinor {
          Text(WafraMoney.isolate("\(snapshot.currency) \(WafraMoney.whole(total, exponent: snapshot.exponent))", snapshot.language))
            .font(.footnote.weight(.medium).monospacedDigit())
            .foregroundColor(band.onBand)
            .lineLimit(1)
            .wafraAmount(snapshot)
            .accessibilityLabel(WafraMoney.format(total, in: snapshot))
        }
      }
      if spending.categories.isEmpty {
        Spacer(minLength: 0)
        Text(strings.spendingEmpty)
          .font(.subheadline.weight(.medium))
          .foregroundColor(band.onBand)
          .frame(maxWidth: .infinity)
          .multilineTextAlignment(.center)
        Spacer(minLength: 0)
      } else {
        WafraShareBar(segments: spending.segments(hidden: snapshot.hidden), band: band)
          .frame(height: 26)
          .padding(.top, 14)
        HStack(alignment: .firstTextBaseline, spacing: 6) {
          ForEach(Array(spending.categories.prefix(3).enumerated()), id: \.offset) { index, category in
            if index > 0 { Spacer(minLength: 0) }
            HStack(alignment: .firstTextBaseline, spacing: 3) {
              Text(category.label)
                .lineLimit(1)
              if !snapshot.hidden, let amount = category.amountMinor {
                Text(WafraMoney.whole(amount, exponent: snapshot.exponent))
                  .monospacedDigit()
                  .lineLimit(1)
                  .wafraAmount(snapshot)
              }
            }
          }
        }
        .font(.caption)
        .foregroundColor(band.onBand.opacity(0.9))
        .padding(.top, 12)
        Spacer(minLength: 0)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

/// The share bar: rounded segments in the band's text tone at falling
/// opacity. Without shares (hidden amounts) it is one quiet bar.
struct WafraShareBar: View {
  let segments: [(share: Double, alpha: Double)]
  let band: WafraBand

  var body: some View {
    GeometryReader { geometry in
      let parts = segments.isEmpty ? [(share: 1.0, alpha: WafraSpending.restAlpha)] : segments
      let available = max(0, geometry.size.width - 3 * CGFloat(parts.count - 1))
      HStack(spacing: 3) {
        ForEach(0..<parts.count, id: \.self) { index in
          RoundedRectangle(cornerRadius: 6, style: .continuous)
            .fill(band.onBand.opacity(parts[index].alpha))
            .frame(width: max(2, available * CGFloat(parts[index].share)))
        }
      }
    }
    .accessibilityHidden(true)
  }
}
