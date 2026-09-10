const { IOSConfig } = require('@expo/config-plugins');

function localizedMetadata(key) {
  return `LocalizedStringResource(
    "${key}",
    defaultValue: "",
    table: "WafraHistoryIntents",
    bundle: .main
  )`;
}

const intentSource = `import AppIntents
internal import WafraMessageHistory

@available(iOS 26.0, *)
private enum WafraHistoryIntentError: Error, CustomLocalizedStringResourceConvertible {
  case beginFailed
  case stageFailed
  case shortcutStageFailed
  case finishFailed
  case importFailed
  case prepareFailed
  case preparedImportFailed
  case prepareV2Failed
  case prepareV3Failed
  case preparedImportV2Failed
  case discardPreparedV2Failed

  var localizedStringResource: LocalizedStringResource {
    switch self {
    case .beginFailed:
      return WafraMessageHistoryResources.localized("history.begin.error")
    case .stageFailed:
      return WafraMessageHistoryResources.localized("history.stage.error")
    case .shortcutStageFailed:
      return WafraMessageHistoryResources.localized("history.stage_shortcut.error")
    case .finishFailed:
      return WafraMessageHistoryResources.localized("history.finish.error")
    case .importFailed:
      return WafraMessageHistoryResources.localized("history.import.error")
    case .prepareFailed:
      return WafraMessageHistoryResources.localized("history.prepare.error")
    case .preparedImportFailed:
      return WafraMessageHistoryResources.localized("history.import_prepared.error")
    case .prepareV2Failed:
      return WafraMessageHistoryResources.localized("history.prepare_v2.error")
    case .prepareV3Failed:
      return WafraMessageHistoryResources.localized("history.prepare_v2.error")
    case .preparedImportV2Failed:
      return WafraMessageHistoryResources.localized("history.import_prepared_v2.error")
    case .discardPreparedV2Failed:
      return WafraMessageHistoryResources.localized("history.discard_prepared_v2.error")
    }
  }
}

@available(iOS 26.0, *)
struct BeginWafraHistoryImportIntent: AppIntent {
  static let title = ${localizedMetadata('history.begin.title')}
  static let description = IntentDescription(
    ${localizedMetadata('history.begin.description')}
  )
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication
  static let supportedModes: IntentModes = .background

  @Parameter(title: ${localizedMetadata('history.session_id.parameter')})
  var sessionId: String

  func perform() async throws -> some IntentResult & ReturnsValue<String> {
    do {
      return .result(
        value: try WafraMessageHistoryStore.shared.beginSession(sessionId: sessionId)
      )
    } catch {
      throw WafraHistoryIntentError.beginFailed
    }
  }
}

@available(iOS 26.0, *)
struct StageWafraMessageHistoryIntent: AppIntent {
  static let title = ${localizedMetadata('history.stage.title')}
  static let description = IntentDescription(
    ${localizedMetadata('history.stage.description')}
  )
  static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
  static let supportedModes: IntentModes = .background

  @Parameter(title: ${localizedMetadata('history.session_id.parameter')})
  var sessionId: String

  @Parameter(title: ${localizedMetadata('history.authorization.parameter')})
  var authorizationSecret: String

  @Parameter(title: ${localizedMetadata('history.chunk.parameter')})
  var chunkIndex: Int

  @Parameter(title: ${localizedMetadata('history.records.parameter')})
  var records: [String]

  func perform() async throws -> some IntentResult & ReturnsValue<String> {
    do {
      let counts = try WafraMessageHistoryStore.shared.stageChunk(
        sessionId: sessionId,
        authorizationSecret: authorizationSecret,
        chunkIndex: chunkIndex,
        records: records
      )
      let value = "{\\"attempted\\":\\(counts.attempted),\\"accepted\\":\\(counts.accepted),\\"skipped\\":\\(counts.skipped)}"
      return .result(value: value)
    } catch {
      throw WafraHistoryIntentError.stageFailed
    }
  }
}

@available(iOS 26.0, *)
struct StageWafraShortcutHistoryIntent: AppIntent {
  static let title = ${localizedMetadata('history.stage_shortcut.title')}
  static let description = IntentDescription(
    ${localizedMetadata('history.stage_shortcut.description')}
  )
  static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
  static let supportedModes: IntentModes = .background

  @Parameter(title: ${localizedMetadata('history.session_id.parameter')})
  var sessionId: String

  @Parameter(title: ${localizedMetadata('history.authorization.parameter')})
  var authorizationSecret: String

  @Parameter(title: ${localizedMetadata('history.chunk.parameter')})
  var chunkIndex: Int

  @Parameter(title: ${localizedMetadata('history.records.parameter')})
  var records: [String]

  func perform() async throws -> some IntentResult & ReturnsValue<String> {
    do {
      let counts = try WafraMessageHistoryStore.shared.stageShortcutChunk(
        sessionId: sessionId,
        authorizationSecret: authorizationSecret,
        chunkIndex: chunkIndex,
        records: records
      )
      let value = "{\\"attempted\\":\\(counts.attempted),\\"accepted\\":\\(counts.accepted),\\"skipped\\":\\(counts.skipped)}"
      return .result(value: value)
    } catch {
      throw WafraHistoryIntentError.shortcutStageFailed
    }
  }
}

@available(iOS 26.0, *)
struct FinishWafraHistoryImportIntent: AppIntent {
  static let title = ${localizedMetadata('history.finish.title')}
  static let description = IntentDescription(
    ${localizedMetadata('history.finish.description')}
  )
  static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
  static let supportedModes: IntentModes = .background

  @Parameter(title: ${localizedMetadata('history.session_id.parameter')})
  var sessionId: String

  @Parameter(title: ${localizedMetadata('history.authorization.parameter')})
  var authorizationSecret: String

  @Parameter(title: ${localizedMetadata('history.total_chunks.parameter')})
  var totalChunks: Int

  @Parameter(title: ${localizedMetadata('history.found.parameter')})
  var found: Int

  @Parameter(title: ${localizedMetadata('history.attempted.parameter')})
  var attempted: Int

  @Parameter(title: ${localizedMetadata('history.accepted.parameter')})
  var accepted: Int

  @Parameter(title: ${localizedMetadata('history.skipped.parameter')})
  var skipped: Int

  func perform() async throws -> some IntentResult {
    do {
      try WafraMessageHistoryStore.shared.finishSession(
        sessionId: sessionId,
        authorizationSecret: authorizationSecret,
        totalChunks: totalChunks,
        found: found,
        attempted: attempted,
        accepted: accepted,
        skipped: skipped
      )
      return .result()
    } catch {
      throw WafraHistoryIntentError.finishFailed
    }
  }
}

@available(iOS 26.0, *)
struct ImportWafraMessageHistoryIntent: AppIntent {
  static let title = ${localizedMetadata('history.import.title')}
  static let description = IntentDescription(
    ${localizedMetadata('history.import.description')}
  )
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication
  static let supportedModes: IntentModes = .background

  @Parameter(title: ${localizedMetadata('history.session_id.parameter')})
  var sessionId: String

  @Parameter(title: ${localizedMetadata('history.found.parameter')})
  var found: Int

  @Parameter(title: ${localizedMetadata('history.message_guids.parameter')})
  var messageGUIDs: [String]

  @Parameter(title: ${localizedMetadata('history.bodies.parameter')})
  var bodies: [String]

  @Parameter(title: ${localizedMetadata('history.dates.parameter')})
  var dates: [Date]

  func perform() async throws -> some IntentResult {
    do {
      _ = try WafraMessageHistoryImporter.shared.importMessages(
        sessionId: sessionId,
        found: found,
        messageGUIDs: messageGUIDs,
        bodies: bodies,
        dates: dates
      )
      return .result()
    } catch {
      throw WafraHistoryIntentError.importFailed
    }
  }
}

@available(iOS 26.0, *)
struct PrepareWafraHistoryMessageIntent: AppIntent {
  static let title = ${localizedMetadata('history.prepare.title')}
  static let description = IntentDescription(
    ${localizedMetadata('history.prepare.description')}
  )
  static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
  static let supportedModes: IntentModes = .background

  @Parameter(title: ${localizedMetadata('history.session_id.parameter')})
  var sessionId: String

  @Parameter(title: ${localizedMetadata('history.found.parameter')})
  var found: Int

  @Parameter(title: ${localizedMetadata('history.position.parameter')})
  var position: Int

  @Parameter(title: ${localizedMetadata('history.message_guid.parameter')})
  var messageGUID: String?

  @Parameter(title: ${localizedMetadata('history.body.parameter')})
  var body: String?

  @Parameter(title: ${localizedMetadata('history.sender.parameter')})
  var sender: String?

  @Parameter(title: ${localizedMetadata('history.date.parameter')})
  var date: Date?

  func perform() async throws -> some IntentResult {
    do {
      try WafraPreparedHistoryStore.shared.prepare(
        sessionId: sessionId,
        found: found,
        position: position,
        guid: messageGUID,
        body: body,
        sender: sender,
        date: date
      )
      return .result()
    } catch {
      throw WafraHistoryIntentError.prepareFailed
    }
  }
}

@available(iOS 26.0, *)
struct ImportWafraPreparedHistoryIntent: AppIntent {
  static let title = ${localizedMetadata('history.import_prepared.title')}
  static let description = IntentDescription(
    ${localizedMetadata('history.import_prepared.description')}
  )
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication
  static let supportedModes: IntentModes = .background

  @Parameter(title: ${localizedMetadata('history.session_id.parameter')})
  var sessionId: String

  @Parameter(title: ${localizedMetadata('history.found.parameter')})
  var found: Int

  func perform() async throws -> some IntentResult {
    do {
      _ = try WafraMessageHistoryImporter.shared.importPrepared(
        sessionId: sessionId,
        found: found
      )
      return .result()
    } catch {
      throw WafraHistoryIntentError.preparedImportFailed
    }
  }
}

@available(iOS 26.0, *)
struct PrepareWafraHistoryMessageV2Intent: AppIntent {
  static let title = ${localizedMetadata('history.prepare_v2.title')}
  static let description = IntentDescription(
    ${localizedMetadata('history.prepare_v2.description')}
  )
  static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
  static let supportedModes: IntentModes = .background

  @Parameter(title: ${localizedMetadata('history.session_id.parameter')})
  var sessionId: String

  @Parameter(title: ${localizedMetadata('history.position.parameter')})
  var position: Int

  @Parameter(title: ${localizedMetadata('history.range_start.parameter')})
  var rangeStart: Date

  @Parameter(title: ${localizedMetadata('history.range_end.parameter')})
  var rangeEnd: Date

  @Parameter(title: ${localizedMetadata('history.message_guid.parameter')})
  var messageGUID: String?

  @Parameter(title: ${localizedMetadata('history.body.parameter')})
  var body: String?

  @Parameter(title: ${localizedMetadata('history.sender.parameter')})
  var sender: String?

  @Parameter(title: ${localizedMetadata('history.date.parameter')})
  var date: Date?

  func perform() async throws -> some IntentResult {
    do {
      try WafraPreparedHistoryStore.shared.prepareV2(
        sessionId: sessionId,
        position: position,
        rangeStart: rangeStart,
        rangeEnd: rangeEnd,
        guid: messageGUID,
        body: body,
        sender: sender,
        date: date
      )
      return .result()
    } catch {
      throw WafraHistoryIntentError.prepareV2Failed
    }
  }
}

@available(iOS 26.0, *)
struct PrepareWafraHistoryMessageV3Intent: AppIntent {
  static let title = ${localizedMetadata('history.prepare_v2.title')}
  static let description = IntentDescription(
    ${localizedMetadata('history.prepare_v2.description')}
  )
  static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
  static let supportedModes: IntentModes = .background

  @Parameter(title: ${localizedMetadata('history.session_id.parameter')})
  var sessionId: String

  @Parameter(title: ${localizedMetadata('history.position.parameter')})
  var position: Int

  @Parameter(title: ${localizedMetadata('history.message_guid.parameter')})
  var messageGUID: String?

  @Parameter(title: ${localizedMetadata('history.body.parameter')})
  var body: String?

  @Parameter(title: ${localizedMetadata('history.sender.parameter')})
  var sender: String?

  @Parameter(title: ${localizedMetadata('history.date.parameter')})
  var date: Date?

  func perform() async throws -> some IntentResult {
    do {
      try WafraPreparedHistoryStore.shared.prepareV3(
        sessionId: sessionId,
        position: position,
        guid: messageGUID,
        body: body,
        sender: sender,
        date: date
      )
      return .result()
    } catch {
      throw WafraHistoryIntentError.prepareV3Failed
    }
  }
}

@available(iOS 26.0, *)
struct ImportWafraPreparedHistoryV2Intent: AppIntent {
  static let title = ${localizedMetadata('history.import_prepared_v2.title')}
  static let description = IntentDescription(
    ${localizedMetadata('history.import_prepared_v2.description')}
  )
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication
  static let supportedModes: IntentModes = .background

  @Parameter(title: ${localizedMetadata('history.session_id.parameter')})
  var sessionId: String

  func perform() async throws -> some IntentResult {
    do {
      try WafraMessageHistoryImporter.shared.importPreparedV2(sessionId: sessionId)
      return .result()
    } catch {
      throw WafraHistoryIntentError.preparedImportV2Failed
    }
  }
}

@available(iOS 26.0, *)
struct DiscardWafraPreparedHistoryV2Intent: AppIntent {
  static let title = ${localizedMetadata('history.discard_prepared_v2.title')}
  static let description = IntentDescription(
    ${localizedMetadata('history.discard_prepared_v2.description')}
  )
  static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
  static let supportedModes: IntentModes = .background

  @Parameter(title: ${localizedMetadata('history.session_id.parameter')})
  var sessionId: String

  func perform() async throws -> some IntentResult {
    do {
      try WafraPreparedHistoryStore.shared.discardPrepared(sessionId: sessionId)
      return .result()
    } catch {
      throw WafraHistoryIntentError.discardPreparedV2Failed
    }
  }
}
`;

module.exports = function withWafraMessageHistory(config) {
  return IOSConfig.XcodeProjectFile.withBuildSourceFile(config, {
    filePath: 'WafraMessageHistoryIntent.swift',
    contents: intentSource,
    overwrite: true,
  });
};
