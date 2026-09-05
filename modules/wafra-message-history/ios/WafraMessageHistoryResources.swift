import Foundation

private final class ResourceAnchor: NSObject {}

@available(iOS 16.0, *)
public enum WafraMessageHistoryResources {
  private static let bundleName = "WafraMessageHistoryResources"
  private static let tableName = "WafraHistoryIntents"
  private static let missingValue = "__WAFRA_MISSING_HISTORY_LOCALIZATION__"

  public static func bundle() -> Bundle {
    let frameworkBundle = Bundle(for: ResourceAnchor.self)
    let bundleURLs = [
      frameworkBundle.url(forResource: bundleName, withExtension: "bundle"),
      Bundle.main.url(forResource: bundleName, withExtension: "bundle"),
    ]

    for url in bundleURLs.compactMap({ $0 }) {
      if let bundle = Bundle(url: url) {
        return bundle
      }
    }
    preconditionFailure("Wafra history intent resources are unavailable.")
  }

  public static func localized(
    _ key: StaticString,
    defaultValue: String.LocalizationValue = ""
  ) -> LocalizedStringResource {
    let bundle = bundle(for: key)
    return LocalizedStringResource(
      key,
      defaultValue: defaultValue,
      table: Self.tableName,
      bundle: .atURL(bundle.bundleURL)
    )
  }

  public static func bundle(for key: StaticString) -> Bundle {
    let bundle = bundle()
    let lookupKey = String(describing: key)
    let resolved = bundle.localizedString(
      forKey: lookupKey,
      value: missingValue,
      table: Self.tableName
    )
    guard resolved != missingValue else {
      preconditionFailure("Wafra history intent localization is unavailable.")
    }
    return bundle
  }
}
