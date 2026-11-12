import ExpoModulesCore
import Foundation
#if canImport(WidgetKit)
import WidgetKit
#endif

/// Writes the widget snapshot (src/lib/widget-snapshot.ts) into the shared App
/// Group and asks WidgetKit to redraw. The widget extension (targets/widget)
/// reads only this JSON string; it never sees the ledger.
///
/// Widgets are presentation only: nothing here throws back into JavaScript.
public class WafraWidgetsModule: Module {
  static let appGroup = "group.app.wafra.ios"
  static let snapshotKey = "wafra.widget.snapshot"
  /// A real snapshot is well under 4 KB. Anything far larger is not ours.
  static let maxSnapshotBytes = 64 * 1024
  /// Every snapshot write and erase runs on this one serial queue, so work that
  /// has already reached it runs in order. The queue alone does not order an
  /// erase against a write that Expo has not dispatched to it yet: the
  /// synchronous `clearSnapshot` can run first. The JS bridge
  /// (modules/wafra-widgets/index.ts) closes that gap by erasing again when such
  /// a write lands, and Home's sync chain awaits a write before its own clear.
  private static let queue = DispatchQueue(label: "app.wafra.widgets.snapshot")

  public func definition() -> ModuleDefinition {
    Name("WafraWidgets")

    // Async: the App Group write and WidgetKit's reloadAllTimelines (which
    // re-renders every placed widget) must not run on the JavaScript thread.
    AsyncFunction("setSnapshot") { (json: String) in
      WafraWidgetsModule.queue.sync {
        guard let defaults = UserDefaults(suiteName: WafraWidgetsModule.appGroup) else { return }
        if json.utf8.count > WafraWidgetsModule.maxSnapshotBytes {
          // Never leave an older snapshot on screen in place of one we refused.
          defaults.removeObject(forKey: WafraWidgetsModule.snapshotKey)
        } else {
          defaults.set(json, forKey: WafraWidgetsModule.snapshotKey)
        }
        WafraWidgetsModule.reloadWidgets()
      }
    }

    // Stays synchronous: Erase Everything and Private Mode need the shared copy
    // gone before they return, and it waits behind any write already in flight.
    Function("clearSnapshot") {
      WafraWidgetsModule.queue.sync {
        UserDefaults(suiteName: WafraWidgetsModule.appGroup)?.removeObject(forKey: WafraWidgetsModule.snapshotKey)
        WafraWidgetsModule.reloadWidgets()
      }
    }
  }

  private static func reloadWidgets() {
    #if canImport(WidgetKit)
    if #available(iOS 14.0, *) {
      WidgetCenter.shared.reloadAllTimelines()
    }
    #endif
  }
}
