import SwiftUI
import WidgetKit

// Wafra widgets. Each reads only the App Group snapshot written by
// modules/wafra-widgets; the app reloads every timeline when it writes a new
// one, so the timeline itself only needs to notice midnight and staleness.

@main
struct WafraWidgetBundle: WidgetBundle {
  var body: some Widget {
    WafraTodayWidget()
    WafraComingUpWidget()
    WafraLockScreenWidget()
  }
}

// MARK: - Provider

struct WafraProvider: TimelineProvider {
  func placeholder(in context: Context) -> WafraEntry {
    WafraEntry(date: Date(), snapshot: nil, isPlaceholder: true)
  }

  func getSnapshot(in context: Context, completion: @escaping (WafraEntry) -> Void) {
    completion(WafraEntry(date: Date(), snapshot: WafraSnapshotStore.load(), isPlaceholder: false))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<WafraEntry>) -> Void) {
    let now = Date()
    let snapshot = WafraSnapshotStore.load()
    let refresh = now.addingTimeInterval(60 * 60)

    // Redraw exactly when "today" stops being today and when the snapshot
    // turns stale, so neither can linger on screen until the next refresh.
    var dates: [Date] = [now]
    if let midnight = WafraDates.startOfNextDay(after: now), midnight < refresh {
      dates.append(midnight)
    }
    if let snapshot {
      let staleAt = snapshot.generatedAt.addingTimeInterval(WafraShared.staleAfter + 1)
      if staleAt > now, staleAt < refresh { dates.append(staleAt) }
    }
    let entries = dates.sorted().map { WafraEntry(date: $0, snapshot: snapshot, isPlaceholder: false) }
    completion(Timeline(entries: entries, policy: .after(refresh)))
  }
}

// MARK: - Widgets

struct WafraTodayWidget: Widget {
  let kind = "WafraToday"

  var body: some WidgetConfiguration {
    let strings = WafraStrings.gallery
    return StaticConfiguration(kind: kind, provider: WafraProvider()) { entry in
      WafraTodayView(entry: entry)
        .redacted(reason: entry.isPlaceholder ? .placeholder : [])
    }
    .configurationDisplayName(strings.todayWidgetName)
    .description(strings.todayWidgetDescription)
    .supportedFamilies([.systemSmall])
  }
}

struct WafraComingUpWidget: Widget {
  let kind = "WafraComingUp"

  var body: some WidgetConfiguration {
    let strings = WafraStrings.gallery
    return StaticConfiguration(kind: kind, provider: WafraProvider()) { entry in
      WafraComingUpView(entry: entry)
        .redacted(reason: entry.isPlaceholder ? .placeholder : [])
    }
    .configurationDisplayName(strings.comingUpWidgetName)
    .description(strings.comingUpWidgetDescription)
    .supportedFamilies([.systemMedium])
  }
}

struct WafraLockScreenWidget: Widget {
  let kind = "WafraLockScreen"

  var body: some WidgetConfiguration {
    let strings = WafraStrings.gallery
    return StaticConfiguration(kind: kind, provider: WafraProvider()) { entry in
      WafraLockScreenView(entry: entry)
        .redacted(reason: entry.isPlaceholder ? .placeholder : [])
    }
    .configurationDisplayName(strings.lockWidgetName)
    .description(strings.lockWidgetDescription)
    .supportedFamilies([.accessoryRectangular, .accessoryInline, .accessoryCircular])
  }
}
