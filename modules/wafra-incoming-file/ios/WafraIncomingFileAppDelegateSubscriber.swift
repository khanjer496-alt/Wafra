import ExpoModulesCore
import Foundation
import UIKit

/// Keeps the URL object UIKit delivers when Wafra is opened with a statement
/// file. A Files / iCloud Drive item arrives as a security-scoped URL whose
/// sandbox extension lives on that object; the string JavaScript later sees
/// cannot regain it. Access is NOT started here: only the adoption the
/// statement redirect asks for starts (and stops) it.
public class WafraIncomingFileAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    if let url = launchOptions?[UIApplication.LaunchOptionsKey.url] as? URL, url.isFileURL {
      WafraIncomingFileRegistry.shared.record(url)
    }
    // Ignored by ExpoAppDelegateSubscriberManager.
    return false
  }

  public func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
    if url.isFileURL { WafraIncomingFileRegistry.shared.record(url) }
    // Never claim the URL: AppDelegate hands it to React Native's linking
    // (and so to redirectSystemPath) only when no subscriber returns true.
    return false
  }
}
