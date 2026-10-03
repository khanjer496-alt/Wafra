import Foundation

@available(iOS 16.0, *)
public enum WafraLiveCaptureResources {
  public static func localized(_ key: String) -> LocalizedStringResource {
    LocalizedStringResource(String.LocalizationValue(key))
  }
}

public enum WafraLiveStageResult: String {
  case accepted
  case ignored
  case invalid
  case capacityReached
  case disabled
}

public final class WafraLiveCaptureStore {
  public static let shared = WafraLiveCaptureStore()
  public static let notificationSetupProbeText = "Wafra notification setup check"
  public enum StoreError: Error { case entitlementRequired }
  public func recordNotificationSetupProof(at: Date) throws {}
  public func recordApplePaySetupProof(at: Date) throws {}
  public func stageApplePay(amount: Decimal?, currency: String, merchant: String?, eventId: String, observedAt: Date) throws -> WafraLiveStageResult { .accepted }

  public func recordSetupProof(version: Int, at: Date) throws {}

#if DEBUG
  public func recordAutomationInputProbe(body: String, at: Date) throws -> Bool {
    true
  }
#endif

  public func stageNotification(text: String, eventId: String, observedAt: Date) throws -> WafraLiveStageResult { .accepted }

  public func stage(
    sender: String,
    body: String,
    eventId: String,
    observedAt: Date
  ) throws -> WafraLiveStageResult {
    .accepted
  }

  public func stageAutomationMessage(
    sender: String?,
    body: String?,
    eventId: String?,
    observedAt: Date?
  ) throws -> WafraLiveStageResult {
    .accepted
  }
}
