const { IOSConfig } = require('@expo/config-plugins');

// Included only by the explicit internal-device beta profile.
const intentSource = `import AppIntents
import Foundation
internal import WafraMessageHistory

@available(iOS 26.0, *)
private enum WafraPagedIntentError: Error, CustomLocalizedStringResourceConvertible {
  case begin
  var localizedStringResource: LocalizedStringResource {
    "Wafra could not start or resume this history import. Open the history beta screen to check saved progress."
  }
}

@available(iOS 26.0, *)
struct BeginWafraPagedImportIntent: AppIntent {
  static let title: LocalizedStringResource = "Begin or resume Wafra history beta"
  static let description = IntentDescription("Starts a protected local history session or resumes its saved cursor.")
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication
  static let supportedModes: IntentModes = .background
  @Parameter(title: "Oldest Message GUID") var oldestGUID: String
  @Parameter(title: "Oldest Message date") var oldestDate: String
  @Parameter(title: "Newest Message GUID") var newestGUID: String
  @Parameter(title: "Newest Message date") var newestDate: String
  func perform() async throws -> some IntentResult & ReturnsValue<String> {
    do {
      return .result(value: try WafraPagedHistoryStore.shared.begin(
        oldestGUID: oldestGUID, oldestDate: oldestDate,
        newestGUID: newestGUID, newestDate: newestDate))
    } catch { throw WafraPagedIntentError.begin }
  }
}

@available(iOS 26.0, *)
struct StageWafraPagedImportIntent: AppIntent {
  static let title: LocalizedStringResource = "Save Wafra history page"
  static let description = IntentDescription("Checks a bounded page and saves it with its next cursor. Never reads Messages directly.")
  static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
  static let supportedModes: IntentModes = .background
  @Parameter(title: "Import request") var request: String
  @Parameter(title: "Messages found") var found: Int
  @Parameter(title: "Encoded records") var frame: String
  func perform() async throws -> some IntentResult & ReturnsValue<String> {
    do {
      guard request.utf8.count <= 16_384,
            let object = try JSONSerialization.jsonObject(with: Data(request.utf8)) as? [String: Any],
            let sessionId = object["sessionId"] as? String,
            let token = object["authorizationSecret"] as? String,
            let revision = object["revision"] as? Int else {
        throw WafraPagedHistoryStore.Failure.invalidInput
      }
      return .result(value: try WafraPagedHistoryStore.shared.stage(sessionId: sessionId,
        authorizationSecret: token, revision: revision, found: found, frame: frame))
    } catch {
      let reason: String
      if let error = error as? WafraHistoryCursor.Failure { reason = error.rawValue }
      else if let error = error as? WafraPagedHistoryStore.Failure { reason = error.rawValue }
      else { reason = "storage-or-device-interruption" }
      let result = try JSONSerialization.data(withJSONObject: ["status": "blocked", "reason": reason], options: [.sortedKeys])
      return .result(value: String(decoding: result, as: UTF8.self))
    }
  }
}
`;

function withWafraPagedImport(config) {
  return IOSConfig.XcodeProjectFile.withBuildSourceFile(config, {
    filePath: 'WafraPagedImportIntents.swift', contents: intentSource, overwrite: true,
  });
}
module.exports = withWafraPagedImport;
module.exports.intentSource = intentSource;
