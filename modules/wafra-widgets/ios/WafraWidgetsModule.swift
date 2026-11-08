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

  public func definition() -> ModuleDefinition {
    Name("WafraWidgets")

    AsyncFunction("setAppPrivacy") { (enabled: Bool, hideAmounts: Bool) in
      WafraPrivacyCover.shared.configure(enabled: enabled, hideAmounts: hideAmounts)
    }.runOnQueue(.main)

    Function("setSnapshot") { (json: String) -> Bool in
      guard let defaults = UserDefaults(suiteName: WafraWidgetsModule.appGroup) else { return false }
      if json.utf8.count > WafraWidgetsModule.maxSnapshotBytes ||
          !WafraPrivacyCover.acceptsSnapshot(json) {
        // Never leave an older snapshot on screen in place of one we refused.
        defaults.removeObject(forKey: WafraWidgetsModule.snapshotKey)
        WafraWidgetsModule.reloadWidgets()
        return false
      } else {
        defaults.set(json, forKey: WafraWidgetsModule.snapshotKey)
      }
      WafraWidgetsModule.reloadWidgets()
      return true
    }

    Function("clearSnapshot") {
      UserDefaults(suiteName: WafraWidgetsModule.appGroup)?.removeObject(forKey: WafraWidgetsModule.snapshotKey)
      WafraWidgetsModule.reloadWidgets()
    }
  }

  static func reloadWidgets() {
    #if canImport(WidgetKit)
    if #available(iOS 14.0, *) {
      WidgetCenter.shared.reloadAllTimelines()
    }
    #endif
  }
}
