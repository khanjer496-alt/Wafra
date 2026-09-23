const { IOSConfig } = require('@expo/config-plugins');

// Included only by the explicit internal-device beta profile.
const intentSource = `import AppIntents
import Foundation
internal import WafraMessageHistory

@available(iOS 26.0, *)
private enum WafraPagedIntentError: Error, CustomLocalizedStringResourceConvertible {
  /// Carries the store's source-free reason code so the Shortcuts error names
  /// the failing check (a blank boundary GUID, an unparseable boundary date).
  case begin(String)
  case cursor
  var localizedStringResource: LocalizedStringResource {
    switch self {
    case .begin(let reason):
      "Wafra could not start or resume this history import (\\(reason)). Open Wafra to check saved progress."
    case .cursor:
      "Wafra could not read the saved history cursor. Open Wafra to check saved progress."
    }
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
    } catch let error as WafraPagedHistoryStore.Failure {
      throw WafraPagedIntentError.begin(error.rawValue)
    } catch let error as WafraHistoryCursor.Failure {
      throw WafraPagedIntentError.begin(error.rawValue)
    } catch {
      throw WafraPagedIntentError.begin("storage-or-device-interruption")
    }
  }
}

@available(iOS 26.0, *)
struct BeginWafraPagedImportV2Intent: AppIntent {
  static let title: LocalizedStringResource = "Begin or resume Wafra history"
  static let description = IntentDescription("Starts a protected local history session or resumes its saved cursor. Boundary dates arrive as typed dates.")
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication
  static let supportedModes: IntentModes = .background
  @Parameter(title: "Oldest Message GUID") var oldestGUID: String
  @Parameter(title: "Oldest Message date") var oldestDate: Date
  @Parameter(title: "Newest Message GUID") var newestGUID: String
  @Parameter(title: "Newest Message date") var newestDate: Date
  func perform() async throws -> some IntentResult & ReturnsValue<String> {
    do {
      return .result(value: try WafraPagedHistoryStore.shared.begin(
        oldestGUID: oldestGUID, oldestInstant: oldestDate,
        newestGUID: newestGUID, newestInstant: newestDate))
    } catch let error as WafraPagedHistoryStore.Failure {
      throw WafraPagedIntentError.begin(error.rawValue)
    } catch let error as WafraHistoryCursor.Failure {
      throw WafraPagedIntentError.begin(error.rawValue)
    } catch {
      throw WafraPagedIntentError.begin("storage-or-device-interruption")
    }
  }
}

@available(iOS 26.0, *)
private func wafraPagedRequest(_ request: String) throws -> (sessionId: String, token: String, revision: Int) {
  guard request.utf8.count <= 16_384,
        WafraMessageHistoryStore.hasUniqueJSONMemberNames(Data(request.utf8)),
        let object = try JSONSerialization.jsonObject(with: Data(request.utf8)) as? [String: Any],
        let sessionId = object["sessionId"] as? String,
        let token = object["authorizationSecret"] as? String,
        let revision = object["revision"] as? Int,
        let number = object["revision"] as? NSNumber,
        String(cString: number.objCType) != "c",
        number.doubleValue == Double(revision), revision >= 0 else {
    throw WafraPagedHistoryStore.Failure.invalidInput
  }
  return (sessionId, token, revision)
}

@available(iOS 26.0, *)
private func wafraPagedBlocked(_ error: Error) throws -> String {
  let reason: String
  if let error = error as? WafraHistoryCursor.Failure { reason = error.rawValue }
  else if let error = error as? WafraHistoryCursor.RangeViolation { reason = error.message }
  else if let error = error as? WafraPagedHistoryStore.Failure { reason = error.rawValue }
  else if let error = error as? WafraPagedHistoryStore.FrameRefusal { reason = error.reason }
  else { reason = "storage-or-device-interruption" }
  let result = try JSONSerialization.data(withJSONObject: ["status": "blocked", "reason": reason], options: [.sortedKeys])
  return String(decoding: result, as: UTF8.self)
}

@available(iOS 26.0, *)
struct StageWafraPagedRowIntent: AppIntent {
  static let title: LocalizedStringResource = "Save one Wafra history message"
  static let description = IntentDescription("Stages one Message of the current bounded page with its exact date. Never reads Messages directly.")
  static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
  static let supportedModes: IntentModes = .background
  @Parameter(title: "Import request") var request: String
  @Parameter(title: "Message GUID") var guid: String
  @Parameter(title: "Message text") var body: String
  @Parameter(title: "Sender") var sender: String
  @Parameter(title: "Message date") var date: Date
  func perform() async throws -> some IntentResult & ReturnsValue<String> {
    do {
      let parsed = try wafraPagedRequest(request)
      return .result(value: try WafraPagedHistoryStore.shared.stageRow(sessionId: parsed.sessionId,
        authorizationSecret: parsed.token, revision: parsed.revision,
        guid: guid, body: body, sender: sender, instant: date))
    } catch {
      return .result(value: try wafraPagedBlocked(error))
    }
  }
}

@available(iOS 26.0, *)
struct CommitWafraPagedPageIntent: AppIntent {
  static let title: LocalizedStringResource = "Save Wafra history page rows"
  static let description = IntentDescription("Checks the rows staged for the current page against the Messages count and saves the page with its next cursor.")
  static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
  static let supportedModes: IntentModes = .background
  @Parameter(title: "Import request") var request: String
  @Parameter(title: "Messages found") var found: Int
  func perform() async throws -> some IntentResult & ReturnsValue<String> {
    do {
      let parsed = try wafraPagedRequest(request)
      return .result(value: try WafraPagedHistoryStore.shared.commitRows(sessionId: parsed.sessionId,
        authorizationSecret: parsed.token, revision: parsed.revision, found: found))
    } catch {
      return .result(value: try wafraPagedBlocked(error))
    }
  }
}

@available(iOS 26.0, *)
struct WafraPagedCursorDateIntent: AppIntent {
  static let title: LocalizedStringResource = "Read Wafra history cursor date"
  static let description = IntentDescription("Returns the protected saved history cursor as a typed date for the Messages query.")
  static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
  static let supportedModes: IntentModes = .background
  @Parameter(title: "Import request") var request: String

  func perform() async throws -> some IntentResult & ReturnsValue<Date> {
    do {
      guard request.utf8.count <= 16_384,
            WafraMessageHistoryStore.hasUniqueJSONMemberNames(Data(request.utf8)),
            let object = try JSONSerialization.jsonObject(with: Data(request.utf8)) as? [String: Any],
            object["status"] as? String == "continue",
            let before = object["before"] as? String,
            before.utf8.count <= 64 else {
        throw WafraPagedIntentError.cursor
      }
      let formatter = ISO8601DateFormatter()
      formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
      guard let value = formatter.date(from: before) else { throw WafraPagedIntentError.cursor }
      return .result(value: value)
    } catch {
      throw WafraPagedIntentError.cursor
    }
  }
}

@available(iOS 26.0, *)
struct WafraPagedWindowStartDateIntent: AppIntent {
  static let title: LocalizedStringResource = "Read Wafra history window start"
  static let description = IntentDescription("Returns the lower bound of the next Messages query as a typed date, so the query never covers the whole inbox.")
  static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
  static let supportedModes: IntentModes = .background
  @Parameter(title: "Import request") var request: String

  func perform() async throws -> some IntentResult & ReturnsValue<Date> {
    do {
      guard request.utf8.count <= 16_384,
            WafraMessageHistoryStore.hasUniqueJSONMemberNames(Data(request.utf8)),
            let object = try JSONSerialization.jsonObject(with: Data(request.utf8)) as? [String: Any],
            object["status"] as? String == "continue",
            let after = object["after"] as? String,
            after.utf8.count <= 64 else {
        throw WafraPagedIntentError.cursor
      }
      let formatter = ISO8601DateFormatter()
      formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
      guard let value = formatter.date(from: after) else { throw WafraPagedIntentError.cursor }
      return .result(value: value)
    } catch {
      throw WafraPagedIntentError.cursor
    }
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
            WafraMessageHistoryStore.hasUniqueJSONMemberNames(Data(request.utf8)),
            let object = try JSONSerialization.jsonObject(with: Data(request.utf8)) as? [String: Any],
            let sessionId = object["sessionId"] as? String,
            let token = object["authorizationSecret"] as? String,
            let revision = object["revision"] as? Int,
            let number = object["revision"] as? NSNumber,
            String(cString: number.objCType) != "c",
            number.doubleValue == Double(revision), revision >= 0 else {
        throw WafraPagedHistoryStore.Failure.invalidInput
      }
      return .result(value: try WafraPagedHistoryStore.shared.stage(sessionId: sessionId,
        authorizationSecret: token, revision: revision, found: found, frame: frame))
    } catch {
      let reason: String
      if let error = error as? WafraHistoryCursor.Failure { reason = error.rawValue }
      else if let error = error as? WafraHistoryCursor.RangeViolation { reason = error.message }
      else if let error = error as? WafraPagedHistoryStore.Failure { reason = error.rawValue }
      else if let error = error as? WafraPagedHistoryStore.FrameRefusal { reason = error.reason }
      else { reason = "storage-or-device-interruption" }
      let result = try JSONSerialization.data(withJSONObject: ["status": "blocked", "reason": reason], options: [.sortedKeys])
      return .result(value: String(decoding: result, as: UTF8.self))
    }
  }
}

@available(iOS 26.0, *)
struct StageWafraPagedColumnsIntent: AppIntent {
  static let title: LocalizedStringResource = "Save Wafra history page columns"
  static let description = IntentDescription("Checks a bounded page delivered as one joined column per field and saves it with its next cursor. Never reads Messages directly.")
  static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
  static let supportedModes: IntentModes = .background
  @Parameter(title: "Import request") var request: String
  @Parameter(title: "Messages found") var found: Int
  @Parameter(title: "Joined message IDs") var guids: String
  @Parameter(title: "Joined message texts") var bodies: String
  @Parameter(title: "Joined senders") var senders: String
  @Parameter(title: "Joined dates") var dates: String
  func perform() async throws -> some IntentResult & ReturnsValue<String> {
    do {
      guard request.utf8.count <= 16_384,
            WafraMessageHistoryStore.hasUniqueJSONMemberNames(Data(request.utf8)),
            let object = try JSONSerialization.jsonObject(with: Data(request.utf8)) as? [String: Any],
            let sessionId = object["sessionId"] as? String,
            let token = object["authorizationSecret"] as? String,
            let revision = object["revision"] as? Int,
            let number = object["revision"] as? NSNumber,
            String(cString: number.objCType) != "c",
            number.doubleValue == Double(revision), revision >= 0 else {
        throw WafraPagedHistoryStore.Failure.invalidInput
      }
      return .result(value: try WafraPagedHistoryStore.shared.stageColumns(sessionId: sessionId,
        authorizationSecret: token, revision: revision, found: found,
        guids: guids, bodies: bodies, senders: senders, dates: dates))
    } catch {
      let reason: String
      if let error = error as? WafraHistoryCursor.Failure { reason = error.rawValue }
      else if let error = error as? WafraHistoryCursor.RangeViolation { reason = error.message }
      else if let error = error as? WafraPagedHistoryStore.Failure { reason = error.rawValue }
      else if let error = error as? WafraPagedHistoryStore.FrameRefusal { reason = error.reason }
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
