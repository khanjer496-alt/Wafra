import ExpoModulesCore
import Foundation

private var passed = 0
private var failed = 0

private func check(_ name: String, _ condition: @autoclosure () -> Bool) {
  if condition() {
    passed += 1
    print("✓ \(name)")
  } else {
    failed += 1
    print("✗ \(name)")
  }
}

private func recordField<Value>(_ record: Any, _ name: String, as: Value.Type) -> Value? {
  let field = Mirror(reflecting: record).children.first { $0.label == "_\(name)" }
  return (field?.value as? TestFieldValue)?.testValue as? Value
}

private func invoke<Result>(_ name: String, _ arguments: [Any] = [], as: Result.Type) throws -> Result {
  guard let result = try TestAsyncFunctionRegistry.invoke(name, arguments) as? Result else {
    throw TestAsyncFunctionRegistryError.invalidArguments
  }
  return result
}

private func rejects(_ name: String, _ arguments: [Any]) -> Bool {
  do {
    _ = try TestAsyncFunctionRegistry.invoke(name, arguments)
    return false
  } catch {
    return true
  }
}

@main
private struct WafraLiveCaptureBridgeBehaviorTests {
  static func main() throws {
    TestAsyncFunctionRegistry.reset()
    WafraLiveCaptureStore.shared.reset()
    WafraLiveCaptureModule().definition()

    check("bridge registers the exact native module name",
      TestAsyncFunctionRegistry.moduleName == "WafraLiveCapture")
    check("bridge registers exactly the eleven public functions",
      TestAsyncFunctionRegistry.functions.keys.sorted() == [
        "acknowledgeCaptureWarning",
        "acknowledgeRecords",
        "eraseAll",
        "getAutomationInputProbeAt",
        "getCaptureStatus",
        "listPendingRecords",
        "purgeExpired",
        "recordFirstCapturedAt",
        "setCaptureEnabled",
        "setLocalCaptureEntitlementLease",
        "setStoreCaptureEntitlementLease",
      ])

    let localLeaseApplied = try invoke(
      "setLocalCaptureEntitlementLease",
      [1_800_000.0, false],
      as: Bool.self
    )
    check("finite local lease converts milliseconds to exact seconds",
      localLeaseApplied
        && WafraLiveCaptureStore.shared.localLeaseCalls.last?.0?.timeIntervalSince1970 == 1_800
        && WafraLiveCaptureStore.shared.localLeaseCalls.last?.1 == false)
    let founderApplied = try invoke(
      "setLocalCaptureEntitlementLease",
      [Optional<Double>.none as Any, true],
      as: Bool.self
    )
    check("founder lifetime reaches the store without an invented expiry",
      founderApplied
        && WafraLiveCaptureStore.shared.localLeaseCalls.last?.0 == nil
        && WafraLiveCaptureStore.shared.localLeaseCalls.last?.1 == true)

    let storeLeaseApplied = try invoke(
      "setStoreCaptureEntitlementLease",
      [2_400_000.0, false, 1_200_000.0],
      as: Bool.self
    )
    check("store lease maps expiry and verification milliseconds exactly",
      storeLeaseApplied
        && WafraLiveCaptureStore.shared.storeLeaseCalls.last?.0?.timeIntervalSince1970 == 2_400
        && WafraLiveCaptureStore.shared.storeLeaseCalls.last?.1 == false
        && WafraLiveCaptureStore.shared.storeLeaseCalls.last?.2.timeIntervalSince1970 == 1_200)
    let storeLeaseCleared = try invoke(
      "setStoreCaptureEntitlementLease",
      [Optional<Double>.none as Any, false, 1_300_000.0],
      as: Bool.self
    )
    check("inactive store snapshot reaches the store as an explicit clear",
      storeLeaseCleared
        && WafraLiveCaptureStore.shared.storeLeaseCalls.last?.0 == nil
        && WafraLiveCaptureStore.shared.storeLeaseCalls.last?.1 == false)

    _ = try TestAsyncFunctionRegistry.invoke("setCaptureEnabled", [true])
    check("setCaptureEnabled reaches the store with its argument",
      WafraLiveCaptureStore.shared.calls.last == "setCaptureEnabled:true")

    let rows = try invoke("listPendingRecords", [7.0], as: [String].self)
    check("listPendingRecords returns the store result", rows == ["pending:7"])
    check("listPendingRecords reaches the store with the exact integer limit",
      WafraLiveCaptureStore.shared.listLimits == [7])

    let ids = [
      "00000000-0000-0000-0000-000000000001",
      "00000000-0000-0000-0000-000000000002",
    ]
    _ = try TestAsyncFunctionRegistry.invoke("acknowledgeRecords", [ids])
    check("acknowledgeRecords reaches the store with every ID",
      WafraLiveCaptureStore.shared.calls.last == "acknowledgeRecords:\(ids.joined(separator: ","))")

    let purged = try invoke("purgeExpired", as: Int.self)
    check("purgeExpired returns the store count", purged == 23)
    check("purgeExpired reaches the store",
      WafraLiveCaptureStore.shared.calls.last == "purgeExpired")

    let status = try TestAsyncFunctionRegistry.invoke("getCaptureStatus")
    check("getCaptureStatus reaches the store",
      WafraLiveCaptureStore.shared.calls.last == "status")
    check("status maps enabled", recordField(status, "enabled", as: Bool.self) == true)
    check("status maps source-free effective entitlement",
      recordField(status, "entitled", as: Bool.self) == true)
    check("status maps pending", recordField(status, "pending", as: Int.self) == 13)
    check("status maps dropped", recordField(status, "dropped", as: Int.self) == 4)
    check("status maps corrupt", recordField(status, "corrupt", as: Bool.self) == true)
    check("status maps the opaque warning ID",
      recordField(status, "warningId", as: String.self)
        == "00000000-0000-0000-0000-000000000009")
    check("status maps setup proof version",
      recordField(status, "setupProofVersion", as: Int.self) == 9)
    check("status converts setup proof seconds to milliseconds without swapping",
      recordField(status, "setupProofAt", as: Double.self) == 123_250)
    check("status converts first-captured seconds to milliseconds without swapping",
      recordField(status, "firstCapturedAt", as: Double.self) == 987_500)

    let automationInputProbeAt = try invoke("getAutomationInputProbeAt", as: Double.self)
    check("automation-input probe time converts seconds to milliseconds exactly",
      automationInputProbeAt == 246_750)
    check("getAutomationInputProbeAt reaches the store",
      WafraLiveCaptureStore.shared.calls.last == "automationInputProbeAt")

    let warningId = "00000000-0000-0000-0000-000000000009"
    let acknowledged = try invoke("acknowledgeCaptureWarning", [warningId], as: Bool.self)
    check("acknowledgeCaptureWarning returns the compare-and-clear result", acknowledged)
    check("acknowledgeCaptureWarning reaches the store with the exact opaque ID",
      WafraLiveCaptureStore.shared.calls.last == "acknowledgeCaptureWarning:\(warningId)")

    _ = try TestAsyncFunctionRegistry.invoke("recordFirstCapturedAt", [1_234_000.0])
    let capturedSeconds = WafraLiveCaptureStore.shared.firstCapturedDates.last?.timeIntervalSince1970
    check("recordFirstCapturedAt converts milliseconds to exact epoch seconds",
      capturedSeconds == 1_234.0)
    check("recordFirstCapturedAt reaches the store exactly once",
      WafraLiveCaptureStore.shared.firstCapturedDates.count == 1)

    _ = try TestAsyncFunctionRegistry.invoke("eraseAll")
    check("eraseAll reaches the store", WafraLiveCaptureStore.shared.calls.last == "eraseAll")

    _ = try TestAsyncFunctionRegistry.invoke("listPendingRecords", [0.0])
    _ = try TestAsyncFunctionRegistry.invoke("listPendingRecords", [50.0])
    check("listPendingRecords accepts both bridge boundaries",
      WafraLiveCaptureStore.shared.listLimits == [7, 0, 50])

    let limitCallsBeforeInvalidInput = WafraLiveCaptureStore.shared.listLimits.count
    let invalidLimits = [
      -1.0,
      50.5,
      51.0,
      Double.nan,
      Double.infinity,
      -Double.infinity,
    ]
    for (index, limit) in invalidLimits.enumerated() {
      check("listPendingRecords rejects invalid limit case \(index + 1) before the store",
        rejects("listPendingRecords", [limit]))
    }
    check("invalid list limits never call the store",
      WafraLiveCaptureStore.shared.listLimits.count == limitCallsBeforeInvalidInput)

    let timestampCallsBeforeInvalidInput = WafraLiveCaptureStore.shared.firstCapturedDates.count
    let invalidTimestamps = [Double.nan, Double.infinity, -Double.infinity]
    for (index, timestamp) in invalidTimestamps.enumerated() {
      check("recordFirstCapturedAt rejects non-finite timestamp case \(index + 1)",
        rejects("recordFirstCapturedAt", [timestamp]))
    }
    check("invalid timestamps never call the store",
      WafraLiveCaptureStore.shared.firstCapturedDates.count == timestampCallsBeforeInvalidInput)

    let localCallsBeforeInvalidInput = WafraLiveCaptureStore.shared.localLeaseCalls.count
    for (index, arguments) in [
      [Optional<Double>.none as Any, false as Any],
      [0.0 as Any, true as Any],
      [Double.nan as Any, false as Any],
      [-1.0 as Any, false as Any],
    ].enumerated() {
      check("local entitlement lease rejects invalid shape case \(index + 1)",
        rejects("setLocalCaptureEntitlementLease", arguments))
    }
    check("invalid local lease inputs never call the store",
      WafraLiveCaptureStore.shared.localLeaseCalls.count == localCallsBeforeInvalidInput)

    let storeCallsBeforeInvalidInput = WafraLiveCaptureStore.shared.storeLeaseCalls.count
    for (index, arguments) in [
      [0.0 as Any, true as Any, 1_000.0 as Any],
      [Double.infinity as Any, false as Any, 1_000.0 as Any],
      [1_000.0 as Any, false as Any, Double.nan as Any],
      [Optional<Double>.none as Any, false as Any, -1.0 as Any],
    ].enumerated() {
      check("store entitlement lease rejects invalid shape case \(index + 1)",
        rejects("setStoreCaptureEntitlementLease", arguments))
    }
    check("invalid store lease inputs never call the store",
      WafraLiveCaptureStore.shared.storeLeaseCalls.count == storeCallsBeforeInvalidInput)

    print("\nNative live capture bridge: \(passed) passed, \(failed) failed")
    precondition(failed == 0, "Native live capture bridge behavior failed.")
  }
}
