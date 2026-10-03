import ExpoModulesCore
import Foundation

private func bridgeException(_ error: Error) -> Exception {
  let failure = (error as? WafraOnDeviceAIFailure) ?? .generationFailed
  // Only a fixed code crosses the bridge: never prompt or model text.
  return Exception(name: "WafraOnDeviceAIError", description: failure.code, code: failure.code)
}

/// Advisory platform language model. iOS 26+ with Apple Intelligence uses
/// Apple Foundation Models on device; every earlier OS reports
/// `unsupported-os` and never touches the framework.
public class WafraOnDeviceAIModule: Module {
  private let registry = WafraOnDeviceAIRegistry()

  public func definition() -> ModuleDefinition {
    Name("WafraOnDeviceAI")

    AsyncFunction("getAvailability") { () async -> [String: Any] in
      WafraOnDeviceAIEngine.availability().dictionary
    }

    AsyncFunction("respond") { (
      requestId: String,
      task: String,
      instructions: String,
      prompt: String,
      schemaJson: String,
      maxTokens: Int,
      timeoutMs: Int
    ) async throws -> String in
      guard task == "ask-plan" || task == "categorize" else {
        throw bridgeException(WafraOnDeviceAIFailure.invalidRequest)
      }
      do {
        return try await WafraOnDeviceAIEngine.respond(
          registry: self.registry,
          requestId: requestId,
          instructions: instructions,
          prompt: prompt,
          schemaJson: schemaJson,
          maxTokens: maxTokens,
          timeoutMs: timeoutMs
        )
      } catch {
        throw bridgeException(error)
      }
    }

    AsyncFunction("cancel") { (requestId: String) in
      self.registry.cancel(requestId)
    }

    // Gemini Nano only; Apple manages its model through Settings.
    AsyncFunction("prepare") { () async -> [String: Any] in
      WafraOnDeviceAIEngine.availability().dictionary
    }
  }
}
