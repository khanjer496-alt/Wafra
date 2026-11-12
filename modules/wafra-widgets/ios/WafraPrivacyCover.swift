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

  private init() {
    // UIApplication lifecycle notifications are posted under both the classic
    // UIApplicationDelegate lifecycle and the UIScene lifecycle, whereas the
    // delegate callbacks below are not delivered once scenes are adopted. Observe
    // both; the cover is idempotent, so a callback plus its notification is harmless.
    let center = NotificationCenter.default
    center.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: nil) { [weak self] _ in
      self?.resignActive()
    }
    center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil) { [weak self] _ in
      self?.resignActive()
    }
    center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: nil) { [weak self] _ in
      self?.becomeActive()
    }
  }

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
  /// didFinishLaunching is delivered under both lifecycles. Touching the controller here
  /// registers its notification observers at launch, before any scene or JS exists, so a
  /// persisted App Lock preference protects the very first app-switcher snapshot.
  public func application(_ application: UIApplication,
                          didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    _ = WafraPrivacyCover.shared
    return true
  }
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
