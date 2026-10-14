import Foundation
import UserNotifications

/**
 A source-currency preview after a capture automation stages a bank message.
 Financial decisions come from the bundled shared parser. This controls only
 Wafra's notification; Apple independently controls the automation banner.

 It never writes or acknowledges a receipt: the message is already in the
 protected queue before this runs, and any failure here only means no
 banner. Credentials, unavailable parser context/resources and disabled
 capture, entitlement, alerts or OS permissions suppress only the preview.
 */
@available(iOS 16.0, *)
public enum WafraInstantAlert {
  /// Placeholder senders the store records when the automation exposes none.
  /// They name no bank, so they are never shown.
  private static let placeholderSenders: Set<String> = [
    WafraLiveCaptureStore.automationSender, "Wafra Notification",
  ]

  public static func postIfReadable(sender: String? = nil, body: String, observedAt: Date = Date()) async {
    let store = WafraLiveCaptureStore.shared
    guard !WafraInstantAlertReader.isSensitive(body),
          let context = try? store.nativeParserContextSnapshot(),
          (try? store.mayEmitParserPreview(context: context)) == true
    else { return }

    let center = UNUserNotificationCenter.current()
    let settings = await center.notificationSettings()
    switch settings.authorizationStatus {
    case .authorized, .provisional, .ephemeral:
      break
    default:
      return
    }

    guard let read = await WafraBackgroundAlertParser.read(sender: sender, body: body,
            observedAt: observedAt, context: context),
          !Task.isCancelled, let content = content(for: read, sender: sender),
          (try? store.mayEmitParserPreview(context: context)) == true else { return }
    // One id per message text: a carrier or automation delivering the same
    // alert twice replaces the banner instead of stacking a duplicate.
    let request = UNNotificationRequest(
      identifier: "wafra-instant-\(stableHash(body))", content: content, trigger: nil)
    try? await center.add(request)
  }

  static func content(for read: WafraNativeAlertNotification, sender: String?,
                      localize: (String) -> String? = WafraLiveCaptureResources.string) -> UNMutableNotificationContent? {
    let baseKey: String
    if read.style == "review" { baseKey = "live.alert.title_review" }
    else if read.family == "transfer" {
      baseKey = read.direction == "credit" ? "live.alert.title_credit" : "live.alert.title_sent"
    } else if read.family == "refund" { baseKey = "live.alert.title_refund" }
    else if read.family == "cash-withdrawal" { baseKey = "live.alert.title_withdrawal" }
    else if read.direction == "credit" { baseKey = "live.alert.title_credit" }
    else if ["fee", "utility", "recurring-payment"].contains(read.family) { baseKey = "live.alert.title_paid" }
    else { baseKey = "live.alert.title" }
    guard let titleFormat = localize(baseKey + (read.merchant == nil ? "" : "_named")) else { return nil }
    var arguments: [CVarArg] = [read.formattedAmount]
    if let merchant = read.merchant { arguments.append(merchant) }
    let instrument = read.instrument?.last4.flatMap { last4 in
      localize("live.alert.card").map { String(format: $0, last4) }
    }
    let account = [bankName(sender), instrument].compactMap { $0 }.joined(separator: " ")
    let content = UNMutableNotificationContent()
    content.title = String(format: titleFormat, arguments: arguments)
    content.body = account.isEmpty ? (localize("live.alert.fallback") ?? "") : account
    content.sound = .default
    content.threadIdentifier = "wafra-instant"
    return content
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
