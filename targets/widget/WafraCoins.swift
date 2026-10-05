import AppIntents
import SwiftUI
import WidgetKit

// The app's 3D coins, drawn with shapes in every widget (docs/design/language-e.md,
// "Coins elsewhere"). Decorative: every coin is hidden from VoiceOver and the
// figure it stands beside is written and spoken as before. The arithmetic is
// WafraCoinMath (WafraSnapshot.swift), mirroring src/lib/widget-coins.ts.

/// Mirrors CoinColors in src/constants/theme.ts; the only coin colours here.
/// scripts/test/repair/widget-coins.test.cjs checks them.
enum WafraCoinPalette {
  static let face = Color(hex: 0xEDC85E)
  static let side = Color(hex: 0xB98F2E)
  static let rim = Color(hex: 0x5E4610)
  static let shine = Color(hex: 0xFFF4CF)
  static let shadow = Color(hex: 0x000000)
}

// MARK: - Motion (iOS 17 widget animations)

/// Changed figures roll their digits when WidgetKit moves to a new timeline
/// entry (iOS 17). Not while redacted (placeholder, Lock Screen privacy) and
/// not with Reduce Motion; hidden or unknown amounts ("—") never animate.
private struct WafraNumericTransition: ViewModifier {
  let value: Double?
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.redactionReasons) private var redaction

  func body(content: Content) -> some View {
    if #available(iOS 17.0, *) {
      if let value, !reduceMotion, redaction.isEmpty {
        content.contentTransition(.numericText(value: value))
      } else {
        content
      }
    } else {
      content
    }
  }
}

/// A coin that is new in this entry drops onto the stack from above (iOS 17).
private struct WafraCoinEntrance: ViewModifier {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.redactionReasons) private var redaction

  func body(content: Content) -> some View {
    if #available(iOS 17.0, *) {
      let entrance: AnyTransition = reduceMotion || !redaction.isEmpty
        ? .identity
        : .push(from: .top).combined(with: .opacity)
      content.transition(entrance)
    } else {
      content
    }
  }
}

extension View {
  func wafraNumericTransition(_ minor: Int64?) -> some View {
    modifier(WafraNumericTransition(value: minor.map { Double($0) }))
  }

  func wafraCoinEntrance() -> some View {
    modifier(WafraCoinEntrance())
  }
}

// MARK: - A flat coin and Today's stack

/// One coin lying flat, seen from a little above: an elliptical face with an
/// inner ring and a highlight, over a short edge (coin-disc.tsx).
struct WafraCoinDisc: View {
  let width: CGFloat

  var body: some View {
    let disc = WafraCoinMath.disc(width: Double(width))
    let face = CGFloat(disc.face)
    let edge = CGFloat(disc.edge)
    ZStack(alignment: .topLeading) {
      // The edge: the lower ellipse and the band joining it to the face.
      Ellipse()
        .fill(WafraCoinPalette.side)
        .overlay(Ellipse().strokeBorder(WafraCoinPalette.rim, lineWidth: 1))
        .frame(width: width, height: face)
        .offset(y: edge)
      Rectangle()
        .fill(WafraCoinPalette.side)
        .overlay(HStack(spacing: 0) {
          Rectangle().fill(WafraCoinPalette.rim).frame(width: 1)
          Spacer(minLength: 0)
          Rectangle().fill(WafraCoinPalette.rim).frame(width: 1)
        })
        .frame(width: width, height: edge)
        .offset(y: face / 2)
      // The face, the ring stamped into it, and its highlight.
      Ellipse()
        .fill(WafraCoinPalette.face)
        .overlay(Ellipse().strokeBorder(WafraCoinPalette.rim, lineWidth: 1))
        .frame(width: width, height: face)
      Ellipse()
        .strokeBorder(WafraCoinPalette.side.opacity(0.55), lineWidth: 1)
        .frame(width: width * 0.7, height: face * 0.7)
        .offset(x: width * 0.15, y: face * 0.15)
      Capsule()
        .fill(WafraCoinPalette.shine.opacity(0.45))
        .frame(width: width * 0.28, height: max(1, face * 0.22))
        .offset(x: width * 0.2, y: face * 0.18)
    }
    .frame(width: width, height: face + edge, alignment: .topLeading)
  }
}

/// Today's coins: one per payment today, at most six, none with none
/// (Home's Today stack). Bottom-anchored, so a payment captured since the
/// last entry is a new coin landing on top while the others stay put.
/// Drawn only where iOS paints the band in full colour: a tinted or clear
/// Home Screen keeps only opacity, which would melt the stack into one block.
struct WafraCoinStack: View {
  let count: Int
  let band: WafraBand

  var body: some View {
    let coins = WafraCoinMath.todayCoins(count)
    let width = CGFloat(WafraCoinMath.todayCoinWidth)
    let disc = WafraCoinMath.disc(width: Double(width))
    let face = CGFloat(disc.face)
    let edge = CGFloat(disc.edge)
    let shadow = max(2, (face * 0.22).rounded())
    let height = face + edge + CGFloat(WafraCoinMath.todayCoinLimit - 1) * edge + shadow
    if coins > 0, !band.isAdapted {
      ZStack(alignment: .bottomLeading) {
        // The soft contact shadow where the stack stands.
        Ellipse()
          .fill(WafraCoinPalette.shadow.opacity(0.18))
          .frame(width: width * 0.92, height: face * 0.7)
          .offset(x: width * 0.04, y: -(shadow / 2))
        ForEach(0..<coins, id: \.self) { index in
          WafraCoinDisc(width: width)
            .offset(y: -(shadow + CGFloat(index) * edge))
            .wafraCoinEntrance()
        }
      }
      .frame(width: width, height: height, alignment: .bottomLeading)
      .accessibilityHidden(true)
    }
  }
}

// MARK: - Spending: coins lying on their side

/// One coin on its side (share-bar.tsx): the far end cap, the body with a
/// sheen, and the face toward the reading start, each outlined in the band's
/// colour so overlapping coins stay apart.
private struct WafraSideCoin: View {
  let width: CGFloat
  let height: CGFloat
  let face: CGFloat
  let fill: Color
  let rim: Color
  /// The face is on the right (right-to-left rows).
  let mirrored: Bool

  var body: some View {
    let length = max(0, width - face)
    let line: CGFloat = 1.5
    ZStack(alignment: .topLeading) {
      Ellipse()
        .fill(fill)
        .overlay(Ellipse().strokeBorder(rim, lineWidth: line))
        .frame(width: face, height: height)
        .offset(x: mirrored ? 0 : width - face)
      Rectangle()
        .fill(fill)
        .overlay(VStack(spacing: 0) {
          Rectangle().fill(rim).frame(height: line)
          Spacer(minLength: 0)
          Rectangle().fill(rim).frame(height: line)
        })
        .frame(width: length, height: height)
        .offset(x: face / 2)
      // A soft highlight along the top: what makes it read as a coin, not a bar.
      Capsule()
        .fill(Color.white.opacity(0.32))
        .frame(width: max(0, width - face * 1.5 - 2), height: 2.5)
        .offset(x: mirrored ? face / 2 + 2 : face, y: height * 0.17)
      Ellipse()
        .fill(fill)
        .overlay(Ellipse().fill(rim.opacity(0.22)))
        .overlay(Ellipse().strokeBorder(rim, lineWidth: line))
        .frame(width: face, height: height)
        .offset(x: mirrored ? width - face : 0)
    }
    .frame(width: width, height: height, alignment: .topLeading)
  }
}

/// The Spending tab's coin row: each category's coin in its own colour, sized
/// by its share (equal when amounts are hidden), the rest as one coin.
struct WafraCoinRow: View {
  let coins: [WafraCoinSpec]
  let rim: Color
  let rtl: Bool

  var body: some View {
    GeometryReader { geometry in
      let available = Double(geometry.size.width)
      let widths = WafraCoinMath.coinWidths(coins.map(\.value), available: available)
      let offsets = WafraCoinMath.coinOffsets(widths, available: available, rtl: rtl)
      ZStack(alignment: .topLeading) {
        ForEach(0..<coins.count, id: \.self) { index in
          WafraSideCoin(
            width: CGFloat(widths[index]), height: geometry.size.height, face: CGFloat(WafraCoinMath.rowFace),
            fill: Color(hex: coins[index].color), rim: rim, mirrored: rtl
          )
          .offset(x: CGFloat(offsets[index]))
        }
      }
      .frame(width: geometry.size.width, height: geometry.size.height, alignment: .topLeading)
    }
    // Positions are computed for the reading direction already.
    .environment(\.layoutDirection, .leftToRight)
    .accessibilityHidden(true)
  }
}

/// Spending's coins where the snapshot carries category colours and iOS
/// paints the band; otherwise the share bar as before (older snapshots, and
/// tinted or clear Home Screens, which keep only opacity).
struct WafraSpendingCoins: View {
  let spending: WafraSpending
  let snapshot: WafraSnapshot
  let band: WafraBand

  var body: some View {
    if !band.isAdapted, let coins = spending.coins(hidden: snapshot.hidden) {
      WafraCoinRow(coins: coins, rim: band.band, rtl: snapshot.language == .ar)
    } else {
      WafraShareBar(segments: spending.segments(hidden: snapshot.hidden), band: band)
    }
  }
}

// MARK: - Coming up: logos on a date strip

/// The next 30 days as a short strip: each listed bill's tile on its date,
/// the next one lifted over a soft shadow (bills-timeline.tsx, at rest).
/// Today sits at the reading start; right to left mirrors.
struct WafraBillStrip: View {
  let bills: [WafraBill]
  let now: Date
  let band: WafraBand
  let rtl: Bool

  var body: some View {
    let tile = CGFloat(WafraCoinMath.stripTile)
    let lift = CGFloat(WafraCoinMath.stripLift)
    let height = CGFloat(WafraCoinMath.stripHeight)
    let lineY = tile + lift + 1
    GeometryReader { geometry in
      let width = Double(geometry.size.width)
      let centers = WafraCoinMath.stripCenters(bills.map { WafraCoinMath.dayOffset(from: now, to: $0.due) }, width: width)
        .map { CGFloat(rtl ? width - $0 : $0) }
      let ticks = [0, 10, 20, 30].map { day -> CGFloat in
        let x = CGFloat(width * WafraCoinMath.pinPosition(day) / 100)
        return rtl ? geometry.size.width - x : x
      }
      ZStack(alignment: .topLeading) {
        Capsule()
          .fill(band.onBand.opacity(0.35))
          .frame(width: geometry.size.width, height: 1.5)
          .offset(y: lineY)
        ForEach(0..<ticks.count, id: \.self) { index in
          Capsule()
            .fill(band.onBand.opacity(0.35))
            .frame(width: 1.5, height: index == 0 ? 6 : 4)
            .offset(x: ticks[index] - 0.75, y: lineY - (index == 0 ? 6 : 4) + 1.5)
        }
        if let first = centers.first {
          Ellipse()
            .fill(WafraCoinPalette.shadow.opacity(0.18))
            .frame(width: tile * 0.8, height: 3)
            .offset(x: first - tile * 0.4, y: lineY - 1)
        }
        // Later bills first, so the lifted next one is drawn over them.
        ForEach(Array(bills.indices.reversed()), id: \.self) { index in
          WafraMerchantTile(title: bills[index].title, logoId: bills[index].logoId, band: band, size: tile)
            .offset(x: centers[index] - tile / 2, y: index == 0 ? 0 : lift)
        }
      }
      .frame(width: geometry.size.width, height: height, alignment: .topLeading)
    }
    .frame(height: height)
    .environment(\.layoutDirection, .leftToRight)
    .accessibilityHidden(true)
  }
}

// MARK: - Lock Screen: a ring of coins

/// The circular Lock Screen widget's gauge as twelve small coins filling
/// clockwise from the top: as many as the gauge's fraction fills
/// (WafraCoinMath.filledCoins), the rest faint. The Lock Screen renders it
/// vibrant, so the coins are drawn in the primary tone with opacity for depth,
/// and the filled ones take the accent where the system tints accessories.
struct WafraCoinRing: View {
  let fraction: Double
  @Environment(\.widgetRenderingMode) private var mode

  var body: some View {
    let total = WafraCoinMath.ringCoins
    let filled = WafraCoinMath.filledCoins(fraction, total: total)
    GeometryReader { geometry in
      let side = min(geometry.size.width, geometry.size.height)
      let coin = max(5, side * 0.13)
      let radius = side / 2 - coin / 2 - 2
      let center = CGPoint(x: geometry.size.width / 2, y: geometry.size.height / 2)
      ZStack {
        ForEach(0..<total, id: \.self) { index in
          let angle = (Double(index) / Double(total)) * 2 * Double.pi - Double.pi / 2
          ringCoin(on: index < filled, size: coin)
            .position(x: center.x + radius * CGFloat(cos(angle)), y: center.y + radius * CGFloat(sin(angle)))
        }
      }
    }
    // Clockwise in both reading directions, like the system gauges.
    .environment(\.layoutDirection, .leftToRight)
    .accessibilityHidden(true)
  }

  @ViewBuilder
  private func ringCoin(on: Bool, size: CGFloat) -> some View {
    let full = mode == .fullColor
    let faceTone = full ? (on ? WafraCoinPalette.face : Color.primary.opacity(0.22)) : Color.primary.opacity(on ? 1 : 0.25)
    let edgeTone = full ? (on ? WafraCoinPalette.side : Color.primary.opacity(0.12)) : Color.primary.opacity(on ? 0.5 : 0.12)
    let coin = ZStack {
      // The edge peeks out below the face: the coin's thickness.
      Circle().fill(edgeTone).offset(y: 1.2)
      Circle().fill(faceTone)
    }
    .frame(width: size, height: size)
    if on {
      coin.widgetAccentable()
    } else {
      coin
    }
  }
}

// MARK: - Today: tap to flip (iOS 17)

/// The control in the Today widget's corner that turns it between today and
/// the last seven days. A Button with an App Intent on iOS 17; earlier
/// systems show the same corner without it. Taps elsewhere still open Wafra
/// (widgetURL).
struct WafraFlipControl<Label: View>: View {
  let face: WafraTodayFace
  let strings: WafraStrings
  @ViewBuilder let label: () -> Label

  var body: some View {
    if #available(iOS 17.0, *) {
      Button(intent: WafraFlipTodayIntent()) {
        label()
          .frame(minWidth: 28, minHeight: 20)
          .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel(face == .today ? strings.showLast7Days : strings.showToday)
    } else {
      label()
    }
  }
}

/// Turns one face out of view and the other in, about the vertical axis.
private struct WafraFlipEffect: ViewModifier {
  let angle: Double

  func body(content: Content) -> some View {
    content
      .rotation3DEffect(.degrees(angle), axis: (x: 0, y: 1, z: 0), perspective: 0.6)
      .opacity(abs(angle) >= 90 ? 0 : 1)
  }
}

/// Today's two faces. WidgetKit animates between the entries before and
/// after a tap: a card flip, or a crossfade with Reduce Motion (and nothing
/// while redacted).
@available(iOS 17.0, *)
struct WafraFlipFaces<Front: View, Back: View>: View {
  let face: WafraTodayFace
  @ViewBuilder let front: () -> Front
  @ViewBuilder let back: () -> Back
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.redactionReasons) private var redaction

  var body: some View {
    ZStack(alignment: .topLeading) {
      if face == .week {
        back()
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
          .transition(flip)
      } else {
        front()
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
          .transition(flip)
      }
    }
  }

  private var flip: AnyTransition {
    guard !reduceMotion else { return .opacity }
    guard redaction.isEmpty else { return .identity }
    return .asymmetric(
      insertion: .modifier(active: WafraFlipEffect(angle: -90), identity: WafraFlipEffect(angle: 0)),
      removal: .modifier(active: WafraFlipEffect(angle: 90), identity: WafraFlipEffect(angle: 0))
    )
  }
}

/// The last seven days as the Today widget's back face: their exact total as
/// the band figure, with the week's bars above it.
struct WafraWeekFace: View {
  let snapshot: WafraSnapshot
  let strings: WafraStrings
  let band: WafraBand

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .center, spacing: 8) {
        Text(strings.last7Total)
          .font(.caption.weight(.medium))
          .foregroundColor(band.onBandSecondary)
          .lineLimit(1)
        Spacer(minLength: 0)
        WafraFlipControl(face: .week, strings: strings) {
          WafraPatternCorner(band: band)
        }
      }
      Spacer(minLength: 4)
      WafraWeekBars(snapshot: snapshot, band: band)
        .frame(height: 30)
      WafraBandFigure(minor: snapshot.weekTotalMinor, snapshot: snapshot, strings: strings, band: band)
        .layoutPriority(1)
        .padding(.top, 6)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}
