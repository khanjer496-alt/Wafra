import ExpoModulesCore
import UIKit

/// Synchronous lifecycle protection: cover before UIKit takes the recents image.
/// Registered at launch so a persisted App Lock preference also protects cold starts.
final class WafraPrivacyCover {
  static let shared = WafraPrivacyCover()
  static let enabledKey = "wafra.appPrivacy.enabled"
  static let hideAmountsKey = "wafra.appPrivacy.hideWidgetAmounts"
  private var covers: [UIView] = []
  private var inactive = UIApplication.shared.applicationState != .active

  static var enabled: Bool { UserDefaults.standard.bool(forKey: Self.enabledKey) }
  static var hidesWidgetAmounts: Bool {
    enabled && (UserDefaults.standard.object(forKey: Self.hideAmountsKey) as? Bool != false)
  }

  func configure(enabled: Bool, hideAmounts: Bool) {
    UserDefaults.standard.set(enabled, forKey: Self.enabledKey)
    UserDefaults.standard.set(hideAmounts, forKey: Self.hideAmountsKey)
    updateCover()
    if Self.hidesWidgetAmounts {
      let defaults = UserDefaults(suiteName: WafraWidgetsModule.appGroup)
      if let raw = defaults?.string(forKey: WafraWidgetsModule.snapshotKey), !Self.acceptsSnapshot(raw) {
        defaults?.removeObject(forKey: WafraWidgetsModule.snapshotKey)
        WafraWidgetsModule.reloadWidgets()
      }
    }
  }

  static func acceptsSnapshot(_ json: String) -> Bool {
    if !hidesWidgetAmounts { return true }
    guard let data = json.data(using: .utf8),
          let snapshot = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return false }
    return snapshot["hidden"] as? Bool == true
  }

  func resignActive() { inactive = true; updateCover() }
  func becomeActive() { inactive = false; updateCover() }

  private func updateCover() {
    for cover in covers { cover.removeFromSuperview() }
    covers.removeAll()
    guard Self.enabled && inactive else { return }
    for scene in UIApplication.shared.connectedScenes {
      guard let windowScene = scene as? UIWindowScene else { continue }
      for window in windowScene.windows where !window.isHidden {
        let cover = UIView(frame: window.bounds)
        cover.backgroundColor = .black
        cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        cover.isAccessibilityElement = true
        cover.accessibilityLabel = "Wafra"
        cover.accessibilityViewIsModal = true
        window.addSubview(cover)
        covers.append(cover)
      }
    }
  }
}

public class WafraPrivacyAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func applicationWillResignActive(_ application: UIApplication) {
    WafraPrivacyCover.shared.resignActive()
  }
  public func applicationDidEnterBackground(_ application: UIApplication) {
    WafraPrivacyCover.shared.resignActive()
  }
  public func applicationDidBecomeActive(_ application: UIApplication) {
    WafraPrivacyCover.shared.becomeActive()
  }
}
