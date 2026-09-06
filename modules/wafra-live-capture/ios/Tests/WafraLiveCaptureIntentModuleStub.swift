import Foundation

@available(iOS 16.0, *)
public enum WafraLiveCaptureResources {
  public static func localized(_ key: String) -> LocalizedStringResource {
    LocalizedStringResource(String.LocalizationValue(key))
  }
}

public enum WafraLiveStageResult: String {
  case accepted
}

public final class WafraLiveCaptureStore {
  public static let shared = WafraLiveCaptureStore()

  public func recordSetupProof(version: Int, at: Date) throws {}

#if DEBUG
  public func recordAutomationInputProbe(body: String, at: Date) throws -> Bool {
    true
  }
#endif

  public func stage(
    sender: String,
    body: String,
    eventId: String,
    observedAt: Date
  ) throws -> WafraLiveStageResult {
    .accepted
  }
}
