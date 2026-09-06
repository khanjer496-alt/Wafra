import Foundation

private final class ResourceAnchor: NSObject {}

@available(iOS 16.0, *)
public enum WafraLiveCaptureResources {
  private static let bundleName = "WafraLiveCaptureResources"
  private static let tableName = "WafraIntents"
  private static let missingValue = "__WAFRA_MISSING_INTENT_LOCALIZATION__"

  public static func bundle() -> Bundle {
    let frameworkBundle = Bundle(for: ResourceAnchor.self)
    let bundleURLs = [
      frameworkBundle.url(forResource: bundleName, withExtension: "bundle"),
      Bundle.main.url(forResource: bundleName, withExtension: "bundle"),
    ]

    for url in bundleURLs.compactMap({ $0 }) {
      if let resourceBundle = Bundle(url: url) {
        return resourceBundle
      }
    }
    preconditionFailure("Wafra intent resources are unavailable.")
  }

  public static func localized(_ key: String) -> LocalizedStringResource {
    let bundle = bundle()
    let resolved = bundle.localizedString(
      forKey: key,
      value: missingValue,
      table: tableName
    )
    guard resolved != missingValue else {
      preconditionFailure("Wafra intent localization is unavailable.")
    }
    return LocalizedStringResource(
      String.LocalizationValue(key),
      table: Self.tableName,
      bundle: .atURL(bundle.bundleURL)
    )
  }
}
