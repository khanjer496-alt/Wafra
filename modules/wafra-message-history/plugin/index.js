const { IOSConfig } = require('@expo/config-plugins');

const intentSource = `import AppIntents
internal import WafraMessageHistory

@available(iOS 26.0, *)
struct StageWafraMessageHistoryIntent: AppIntent {
  static let title: LocalizedStringResource = "Stage Wafra message history"
  static let description = IntentDescription(
    "Stages a user-selected batch of past Messages in protected local storage for Wafra to review."
  )
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication
  static let supportedModes: IntentModes = .background

  @Parameter(title: "Session ID")
  var sessionId: String

  @Parameter(title: "Chunk number")
  var chunkIndex: Int

  @Parameter(
    title: "Message records",
    description: "Versioned JSON records containing body, sender, date, and an opaque message identifier."
  )
  var records: [String]

  func perform() async throws -> some IntentResult & ProvidesDialog {
    do {
      let accepted = records.filter {
        !WafraMessageHistoryStore.isOversizedRecord($0)
      }
      let skipped = records.count - accepted.count
      let count = accepted.isEmpty ? 0 : try WafraMessageHistoryStore.stageChunk(
        sessionId: sessionId,
        chunkIndex: chunkIndex,
        records: accepted
      )
      let skippedText = skipped == 0 ? "" : " Skipped \\(skipped) oversized messages."
      return .result(dialog: "Staged \\(count) message records on this iPhone.\\(skippedText)")
    } catch {
      // Never leave a partial raw-message session after a native limit or
      // disk error. The Shortcut can retry with a smaller date range.
      try? WafraMessageHistoryStore.discardSession(sessionId: sessionId)
      throw error
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
