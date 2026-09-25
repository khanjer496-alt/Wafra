import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

/// Failure codes surfaced to JavaScript. None carries prompt or response text.
enum WafraOnDeviceAIFailure: Error, Equatable {
  case unavailable
  case invalidRequest
  case timeout
  case cancelled
  case busy
  case refused
  case unsupportedLanguage
  case tooLarge
  case generationFailed

  var code: String {
    switch self {
    case .unavailable: return "ERR_ON_DEVICE_AI_UNAVAILABLE"
    case .invalidRequest: return "ERR_ON_DEVICE_AI_INVALID_REQUEST"
    case .timeout: return "ERR_ON_DEVICE_AI_TIMEOUT"
    case .cancelled: return "ERR_ON_DEVICE_AI_CANCELLED"
    case .busy: return "ERR_ON_DEVICE_AI_BUSY"
    case .refused: return "ERR_ON_DEVICE_AI_REFUSED"
    case .unsupportedLanguage: return "ERR_ON_DEVICE_AI_UNSUPPORTED_LANGUAGE"
    case .tooLarge: return "ERR_ON_DEVICE_AI_TOO_LARGE"
    case .generationFailed: return "ERR_ON_DEVICE_AI_GENERATION_FAILED"
    }
  }
}

/// One output property: either a closed list of string choices or a short free string.
struct WafraClosedField: Equatable, Sendable {
  let name: String
  let description: String?
  let choices: [String]?
  let maxLength: Int?
}

/// The closed output shape JavaScript asks for. Parsed defensively because it
/// crosses the bridge; an invalid schema is a programming error, not model output.
struct WafraClosedSchema: Equatable, Sendable {
  let name: String
  let fields: [WafraClosedField]

  static let maxFields = 16
  static let maxChoices = 64

  static func parse(_ json: String) throws -> WafraClosedSchema {
    guard json.utf8.count <= 16_384,
          let data = json.data(using: .utf8),
          let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let name = root["name"] as? String, isIdentifier(name),
          let rawFields = root["fields"] as? [[String: Any]],
          (1...maxFields).contains(rawFields.count)
    else { throw WafraOnDeviceAIFailure.invalidRequest }
    var seen = Set<String>()
    var fields: [WafraClosedField] = []
    for raw in rawFields {
      guard let fieldName = raw["name"] as? String, isIdentifier(fieldName), seen.insert(fieldName).inserted
      else { throw WafraOnDeviceAIFailure.invalidRequest }
      let description = raw["description"] as? String
      if let description, description.count > 400 { throw WafraOnDeviceAIFailure.invalidRequest }
      let choices = raw["choices"] as? [String]
      let maxLength = raw["maxLength"] as? Int
      if let choices {
        guard maxLength == nil, (1...maxChoices).contains(choices.count), Set(choices).count == choices.count,
              choices.allSatisfy({ !$0.isEmpty && $0.count <= 64 })
        else { throw WafraOnDeviceAIFailure.invalidRequest }
      } else {
        guard let maxLength, (1...200).contains(maxLength) else { throw WafraOnDeviceAIFailure.invalidRequest }
      }
      fields.append(WafraClosedField(name: fieldName, description: description, choices: choices, maxLength: maxLength))
    }
    return WafraClosedSchema(name: name, fields: fields)
  }

  private static func isIdentifier(_ value: String) -> Bool {
    guard let first = value.unicodeScalars.first, value.count <= 40,
          CharacterSet.letters.contains(first) else { return false }
    return value.unicodeScalars.allSatisfy { scalar in
      scalar.isASCII && (CharacterSet.alphanumerics.contains(scalar) || scalar == "_")
    }
  }
}

struct WafraOnDeviceAIAvailability: Equatable {
  let status: String
  let provider: String?
  let languages: [String]?

  /// Absent keys mean null in JavaScript; no optional values cross the bridge.
  var dictionary: [String: Any] {
    var result: [String: Any] = ["status": status, "canPrepare": false]
    if let provider { result["provider"] = provider }
    if let languages { result["languages"] = languages }
    return result
  }

  static let unsupportedOS = WafraOnDeviceAIAvailability(status: "unsupported-os", provider: nil, languages: nil)
}

/// A single in-flight generation. The first of result, timeout and cancel wins;
/// the continuation is resumed exactly once and the work task is cancelled so
/// a slow model never holds a JavaScript promise open.
final class WafraOnDeviceAIRequest: @unchecked Sendable {
  private let lock = NSLock()
  private var continuation: CheckedContinuation<String, Error>?
  private var work: Task<Void, Never>?
  private var timer: Task<Void, Never>?
  private var finished = false

  func attach(_ continuation: CheckedContinuation<String, Error>) {
    lock.lock()
    defer { lock.unlock() }
    if finished {
      continuation.resume(throwing: WafraOnDeviceAIFailure.cancelled)
    } else {
      self.continuation = continuation
    }
  }

  func setWork(_ task: Task<Void, Never>) {
    lock.lock()
    let alreadyFinished = finished
    if !alreadyFinished { work = task }
    lock.unlock()
    if alreadyFinished { task.cancel() }
  }

  func setTimer(_ task: Task<Void, Never>) {
    lock.lock()
    let alreadyFinished = finished
    if !alreadyFinished { timer = task }
    lock.unlock()
    if alreadyFinished { task.cancel() }
  }

  @discardableResult
  func finish(_ result: Result<String, Error>) -> Bool {
    lock.lock()
    guard !finished else { lock.unlock(); return false }
    finished = true
    let continuation = self.continuation
    let work = self.work
    let timer = self.timer
    self.continuation = nil
    self.work = nil
    self.timer = nil
    lock.unlock()
    continuation?.resume(with: result)
    timer?.cancel()
    if case .failure = result { work?.cancel() }
    return true
  }
}

final class WafraOnDeviceAIRegistry: @unchecked Sendable {
  private let lock = NSLock()
  private var requests: [String: WafraOnDeviceAIRequest] = [:]

  /// One generation at a time: both platform runtimes reject or serialize
  /// concurrent requests, and Wafra's uses are interactive and short.
  func begin(_ id: String) throws -> WafraOnDeviceAIRequest {
    lock.lock()
    defer { lock.unlock() }
    guard !id.isEmpty, id.count <= 64 else { throw WafraOnDeviceAIFailure.invalidRequest }
    guard requests.isEmpty else { throw WafraOnDeviceAIFailure.busy }
    let request = WafraOnDeviceAIRequest()
    requests[id] = request
    return request
  }

  func end(_ id: String) {
    lock.lock()
    requests[id] = nil
    lock.unlock()
  }

  func cancel(_ id: String) {
    lock.lock()
    let request = requests[id]
    lock.unlock()
    request?.finish(.failure(WafraOnDeviceAIFailure.cancelled))
  }
}

enum WafraOnDeviceAIEngine {
  static let maxPromptCharacters = 6_000

  static func availability() -> WafraOnDeviceAIAvailability {
    #if canImport(FoundationModels)
    if #available(iOS 26.0, *) {
      return WafraAppleFoundationModels.availability()
    }
    #endif
    return .unsupportedOS
  }

  static func respond(
    registry: WafraOnDeviceAIRegistry,
    requestId: String,
    instructions: String,
    prompt: String,
    schemaJson: String,
    maxTokens: Int,
    timeoutMs: Int
  ) async throws -> String {
    guard !prompt.isEmpty, prompt.count <= maxPromptCharacters, instructions.count <= maxPromptCharacters,
          (16...1_024).contains(maxTokens), (500...60_000).contains(timeoutMs)
    else { throw WafraOnDeviceAIFailure.invalidRequest }
    let schema = try WafraClosedSchema.parse(schemaJson)
    let request = try registry.begin(requestId)
    // Frees the slot when JavaScript gets its answer. A cancelled/timed-out
    // Apple generation that ignores cancellation may briefly overlap the next
    // request; each request uses its own LanguageModelSession, so that is safe.
    defer { registry.end(requestId) }
    return try await withCheckedThrowingContinuation { continuation in
      request.attach(continuation)
      let work = Task {
        do {
          let output = try await generate(instructions: instructions, prompt: prompt, schema: schema, maxTokens: maxTokens)
          request.finish(.success(output))
        } catch {
          request.finish(.failure(error))
        }
      }
      request.setWork(work)
      request.setTimer(Task {
        // Task.sleep throws on cancellation, so a finished request never times out.
        guard (try? await Task.sleep(nanoseconds: UInt64(timeoutMs) * 1_000_000)) != nil else { return }
        request.finish(.failure(WafraOnDeviceAIFailure.timeout))
      })
    }
  }

  private static func generate(
    instructions: String,
    prompt: String,
    schema: WafraClosedSchema,
    maxTokens: Int
  ) async throws -> String {
    #if canImport(FoundationModels)
    if #available(iOS 26.0, *) {
      return try await WafraAppleFoundationModels.respond(
        instructions: instructions, prompt: prompt, schema: schema, maxTokens: maxTokens)
    }
    #endif
    throw WafraOnDeviceAIFailure.unavailable
  }
}

#if canImport(FoundationModels)
@available(iOS 26.0, *)
enum WafraAppleFoundationModels {
  static let provider = "apple-foundation-models"

  static func availability() -> WafraOnDeviceAIAvailability {
    let model = SystemLanguageModel.default
    switch model.availability {
    case .available:
      return WafraOnDeviceAIAvailability(status: "available", provider: provider, languages: languageCodes(model))
    case .unavailable(let reason):
      let status: String
      switch reason {
      case .deviceNotEligible: status = "device-not-eligible"
      case .appleIntelligenceNotEnabled: status = "not-enabled"
      case .modelNotReady: status = "model-not-ready"
      @unknown default: status = "unavailable"
      }
      return WafraOnDeviceAIAvailability(status: status, provider: provider, languages: nil)
    }
  }

  /// Language codes such as "en" or "ar" that the system model reports.
  static func languageCodes(_ model: SystemLanguageModel) -> [String] {
    Array(Set(model.supportedLanguages.compactMap { $0.languageCode?.identifier.lowercased() })).sorted()
  }

  /// Guided generation: the decoder can only emit the closed choices, so the
  /// result is always a well-formed object of the requested shape. JavaScript
  /// still validates it before any use.
  static func generationSchema(_ schema: WafraClosedSchema) throws -> GenerationSchema {
    let properties = schema.fields.map { field -> DynamicGenerationSchema.Property in
      let fieldSchema: DynamicGenerationSchema
      if let choices = field.choices {
        fieldSchema = DynamicGenerationSchema(
          name: "\(schema.name)_\(field.name)", description: field.description, anyOf: choices)
      } else {
        fieldSchema = DynamicGenerationSchema(type: String.self)
      }
      return DynamicGenerationSchema.Property(
        name: field.name, description: field.description, schema: fieldSchema, isOptional: false)
    }
    let root = DynamicGenerationSchema(name: schema.name, description: nil, properties: properties)
    return try GenerationSchema(root: root, dependencies: [])
  }

  static func respond(
    instructions: String,
    prompt: String,
    schema: WafraClosedSchema,
    maxTokens: Int
  ) async throws -> String {
    let model = SystemLanguageModel.default
    guard model.isAvailable else { throw WafraOnDeviceAIFailure.unavailable }
    let generationSchema: GenerationSchema
    do {
      generationSchema = try self.generationSchema(schema)
    } catch {
      throw WafraOnDeviceAIFailure.invalidRequest
    }
    // A fresh session per request: no transcript (and so no earlier question)
    // is carried into the next generation.
    let session = LanguageModelSession(model: model, tools: [], instructions: instructions)
    let options = GenerationOptions(sampling: .greedy, temperature: nil, maximumResponseTokens: maxTokens)
    do {
      let response = try await session.respond(
        to: prompt, schema: generationSchema, includeSchemaInPrompt: true, options: options)
      return response.content.jsonString
    } catch let error as LanguageModelSession.GenerationError {
      throw map(error)
    } catch is CancellationError {
      throw WafraOnDeviceAIFailure.cancelled
    }
  }

  static func map(_ error: LanguageModelSession.GenerationError) -> WafraOnDeviceAIFailure {
    switch error {
    case .guardrailViolation, .refusal: return .refused
    case .unsupportedLanguageOrLocale: return .unsupportedLanguage
    case .exceededContextWindowSize: return .tooLarge
    case .rateLimited, .concurrentRequests: return .busy
    case .assetsUnavailable: return .unavailable
    default: return .generationFailed
    }
  }
}
#endif
