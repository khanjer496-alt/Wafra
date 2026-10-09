import Foundation
import UserNotifications

/**
 Wafra's own notice for a capture automation that reached Wafra while nothing
 could be saved. The automation itself finishes successfully, so Shortcuts
 posts no "Automation failed" banner; this replaces it with one Wafra
 notification, throttled by `WafraLiveCaptureStore.claimCaptureOffNotice()`.
 It carries no Message text and respects the user's notification permission.
 */
@available(iOS 16.0, *)
public enum WafraLiveCaptureNotice {
  /// One identifier, so a later notice replaces the earlier one in Notification Center.
  public static let identifier = "wafra-capture-off"

  public static func postIfDue() async {
    let center = UNUserNotificationCenter.current()
    let settings = await center.notificationSettings()
    switch settings.authorizationStatus {
    case .authorized, .provisional, .ephemeral:
      break
    default:
      return
    }
    guard let reason = try? WafraLiveCaptureStore.shared.claimCaptureOffNotice() else { return }
    let keys: (title: String, body: String)
    switch reason {
    case .off: keys = ("live.notice.off.title", "live.notice.off.body")
    case .paused: keys = ("live.notice.paused.title", "live.notice.paused.body")
    }
    guard
      let title = WafraLiveCaptureResources.string(keys.title),
      let body = WafraLiveCaptureResources.string(keys.body)
    else { return }
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = body
    content.threadIdentifier = identifier
    try? await center.add(UNNotificationRequest(identifier: identifier, content: content, trigger: nil))
  }
}
