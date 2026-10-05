import AppIntents
import WidgetKit

/// Turns the Today widget between today and the last seven days (iOS 17
/// interactive widgets). It runs in the widget extension, stores the face in
/// the App Group (WafraTodayFace) and asks WidgetKit for a new Today timeline;
/// the views animate from the old entry to the new one. It reads and writes
/// nothing else, never opens the app, and is not offered in Shortcuts.
@available(iOS 17.0, *)
struct WafraFlipTodayIntent: AppIntent {
  static let title: LocalizedStringResource = "Flip the Today widget"
  static let isDiscoverable = false

  init() {}

  func perform() async throws -> some IntentResult {
    WafraTodayFace.toggleStored()
    WidgetCenter.shared.reloadTimelines(ofKind: WafraTodayFace.widgetKind)
    return .result()
  }
}
