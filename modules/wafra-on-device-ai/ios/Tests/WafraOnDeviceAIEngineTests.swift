// Host-run behaviour checks for the engine (macOS 26 SDK, same FoundationModels
// API as iOS 26). Run with Tests/run-engine-tests.sh. When the Mac itself has
// Apple Intelligence enabled, the last check performs one real guided
// generation against the closed category schema; otherwise it reports the
// availability status and skips that step.
import Foundation

@main
struct WafraOnDeviceAIEngineTests {
  static var failures = 0

  static func check(_ condition: Bool, _ message: String) {
    if condition { print("ok - \(message)") } else { failures += 1; print("FAIL - \(message)") }
  }

  static func main() async {
    // Closed schema parsing.
    let valid = #"{"name":"CategoryChoice","fields":[{"name":"category","description":"d","choices":["groceries","unsure"]},{"name":"merchant","maxLength":80}]}"#
    let parsed = try? WafraClosedSchema.parse(valid)
    check(parsed?.fields.count == 2 && parsed?.fields[0].choices == ["groceries", "unsure"], "valid closed schema parses in order")
    for invalid in [
      #"{"name":"X","fields":[]}"#,
      #"{"name":"1bad","fields":[{"name":"a","choices":["x"]}]}"#,
      #"{"name":"X","fields":[{"name":"a","choices":["x","x"]}]}"#,
      #"{"name":"X","fields":[{"name":"a"}]}"#,
      #"{"name":"X","fields":[{"name":"a","maxLength":900}]}"#,
      #"{"name":"X","fields":[{"name":"a","choices":["x"],"maxLength":3}]}"#,
      #"{"name":"X","fields":[{"name":"a","choices":["x"]},{"name":"a","choices":["y"]}]}"#,
      #"not json"#,
    ] {
      check((try? WafraClosedSchema.parse(invalid)) == nil, "rejects invalid schema \(invalid.prefix(40))")
    }

    // Request lifecycle: exactly-once resolution, busy, cancel.
    let registry = WafraOnDeviceAIRegistry()
    let first = try? registry.begin("a")
    check(first != nil, "first request admitted")
    check((try? registry.begin("b")) == nil, "concurrent request is refused as busy")
    registry.end("a")
    check((try? registry.begin("c")) != nil, "slot is released after end")
    registry.end("c")

    let request = WafraOnDeviceAIRequest()
    let outcome: String = await withCheckedContinuation { done in
      Task {
        do {
          let value: String = try await withCheckedThrowingContinuation { continuation in
            request.attach(continuation)
          }
          done.resume(returning: value)
        } catch {
          done.resume(returning: (error as? WafraOnDeviceAIFailure)?.code ?? "other")
        }
      }
      Task {
        try? await Task.sleep(nanoseconds: 20_000_000)
        _ = request.finish(.failure(WafraOnDeviceAIFailure.timeout))
        _ = request.finish(.success("late"))
      }
    }
    check(outcome == "ERR_ON_DEVICE_AI_TIMEOUT", "first finisher wins and later results are dropped")

    let invalidInput = await capture {
      try await WafraOnDeviceAIEngine.respond(registry: registry, requestId: "x", instructions: "", prompt: "",
        schemaJson: valid, maxTokens: 64, timeoutMs: 1_000)
    }
    check(invalidInput == "ERR_ON_DEVICE_AI_INVALID_REQUEST", "empty prompt is rejected before the model")

    let availability = WafraOnDeviceAIEngine.availability()
    print("# host availability: \(availability.status) languages=\(availability.languages ?? [])")
    if availability.status == "available" {
      let start = Date()
      let result = await capture {
        try await WafraOnDeviceAIEngine.respond(
          registry: registry, requestId: "live",
          instructions: "Pick the spending category for the merchant name. Answer unsure when the name does not say what is sold.",
          prompt: "Merchant: CARREFOUR HYPERMARKET",
          schemaJson: #"{"name":"CategoryChoice","fields":[{"name":"category","choices":["groceries","dining","transport","shopping","unsure"]}]}"#,
          maxTokens: 64, timeoutMs: 30_000)
      }
      print("# live output (\(Int(Date().timeIntervalSince(start) * 1000)) ms): \(result)")
      if let data = result.data(using: .utf8),
         let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
         let category = object["category"] as? String {
        check(["groceries", "dining", "transport", "shopping", "unsure"].contains(category) && object.count == 1,
              "guided generation returns exactly one closed choice")
      } else {
        check(false, "guided generation returned a JSON object")
      }
      let cancelled = await captureCancelled(registry: registry)
      check(cancelled == "ERR_ON_DEVICE_AI_CANCELLED", "cancel resolves an in-flight generation immediately")
    } else {
      print("# skip live generation: model status \(availability.status)")
    }
    print(failures == 0 ? "engine tests passed" : "engine tests FAILED: \(failures)")
    exit(failures == 0 ? 0 : 1)
  }

  static func capture(_ work: () async throws -> String) async -> String {
    do { return try await work() } catch { return (error as? WafraOnDeviceAIFailure)?.code ?? "\(error)" }
  }

  static func captureCancelled(registry: WafraOnDeviceAIRegistry) async -> String {
    Task {
      try? await Task.sleep(nanoseconds: 5_000_000)
      registry.cancel("cancel-me")
    }
    return await capture {
      try await WafraOnDeviceAIEngine.respond(
        registry: registry, requestId: "cancel-me", instructions: "Write a long answer.",
        prompt: "Describe every category.",
        schemaJson: #"{"name":"Essay","fields":[{"name":"text","maxLength":200}]}"#,
        maxTokens: 1_000, timeoutMs: 30_000)
    }
  }
}
