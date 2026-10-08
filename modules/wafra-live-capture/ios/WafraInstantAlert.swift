import Foundation
import UserNotifications

/**
 The banner an iPhone user sees when a capture automation hands Wafra a bank
 message, matching Android's InstantAlert.post(): "AED 45.00 · CARREFOUR" with
 the bank and card underneath. The automation itself finishes quietly, so this
 is the only notification Wafra adds for a capture.

 It never stores anything and never blocks capture: the message is already in
 the protected queue before this runs, and any failure here only means no
 banner. It is skipped for credentials, for anything the reader does not
 plainly recognize as a completed movement, when the user turned charge
 alerts off, and when Wafra notifications are not allowed.
 */
@available(iOS 16.0, *)
public enum WafraInstantAlert {
  /// Placeholder senders the store records when the automation exposes none.
  /// They name no bank, so they are never shown.
  private static let placeholderSenders: Set<String> = [
    WafraLiveCaptureStore.automationSender, "Wafra Notification",
  ]

  public static func postIfReadable(sender: String? = nil, body: String) async {
    guard !WafraInstantAlertReader.isSensitive(body),
          let read = WafraInstantAlertReader.read(body),
          (try? WafraLiveCaptureStore.shared.instantAlertsEnabled()) == true
    else { return }

    let center = UNUserNotificationCenter.current()
    let settings = await center.notificationSettings()
    switch settings.authorizationStatus {
    case .authorized, .provisional, .ephemeral:
      break
    default:
      return
    }

    let amount = "\(read.currency) \(read.figure)"
    let titleFormat: String?
    let arguments: [CVarArg]
    switch (read.merchant, read.credit) {
    case let (merchant?, true):
      titleFormat = WafraLiveCaptureResources.string("live.alert.title_credit_named")
      arguments = [amount, merchant]
    case let (merchant?, false):
      titleFormat = WafraLiveCaptureResources.string("live.alert.title_named")
      arguments = [amount, merchant]
    case (nil, true):
      titleFormat = WafraLiveCaptureResources.string("live.alert.title_credit")
      arguments = [amount]
    case (nil, false):
      titleFormat = WafraLiveCaptureResources.string("live.alert.title")
      arguments = [amount]
    }
    guard let titleFormat else { return }

    // The second line names the bank and the card: the two facts that tell
    // the user which card just moved.
    let card = read.last4.flatMap { last4 in
      WafraLiveCaptureResources.string("live.alert.card").map { String(format: $0, last4) }
    }
    let account = [bankName(sender), card].compactMap { $0 }.joined(separator: " ")

    let content = UNMutableNotificationContent()
    content.title = String(format: titleFormat, arguments: arguments)
    content.body = account.isEmpty
      ? (WafraLiveCaptureResources.string("live.alert.fallback") ?? "")
      : account
    content.sound = .default
    content.threadIdentifier = "wafra-instant"
    // One id per message text: a carrier or automation delivering the same
    // alert twice replaces the banner instead of stacking a duplicate.
    let request = UNNotificationRequest(
      identifier: "wafra-instant-\(stableHash(body))", content: content, trigger: nil)
    try? await center.add(request)
  }

  /// The sender id banks use is already their name: "ADCB", "FAB", "HSBC".
  static func bankName(_ sender: String?) -> String? {
    guard let sender else { return nil }
    let trimmed = sender.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty || placeholderSenders.contains(trimmed) { return nil }
    // A numeric sender is a short code, not a name.
    if trimmed.allSatisfy({ $0.isNumber || $0 == "+" || $0 == "-" || $0 == " " }) { return nil }
    return String(trimmed.prefix(16))
  }

  /// FNV-1a over the UTF-8 bytes. Swift's hashValue is randomized per launch,
  /// so it cannot recognize a repeated message across automation runs.
  static func stableHash(_ text: String) -> String {
    var hash: UInt64 = 0xcbf29ce484222325
    for byte in text.utf8 {
      hash ^= UInt64(byte)
      hash = hash &* 0x100000001b3
    }
    return String(hash, radix: 16)
  }
}
