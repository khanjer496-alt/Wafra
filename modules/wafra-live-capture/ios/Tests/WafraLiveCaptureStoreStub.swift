import Foundation

public struct WafraLiveCaptureStatus {
  public let enabled: Bool
  public let entitled: Bool
  public let pending: Int
  public let dropped: Int
  public let corrupt: Bool
  public let warningId: String?
  public let setupProofVersion: Int?
  public let setupProofAt: TimeInterval?
  public let firstCapturedAt: TimeInterval?
}

public final class WafraLiveCaptureStore {
  public static let shared = WafraLiveCaptureStore()
  public static let maxBridgeRecords = 50

  public private(set) var calls: [String] = []
  public private(set) var listLimits: [Int] = []
  public private(set) var firstCapturedDates: [Date] = []
  public private(set) var localLeaseCalls: [(Date?, Bool)] = []
  public private(set) var storeLeaseCalls: [(Date?, Bool, Date)] = []
  public var automationInputProbeAtResult: TimeInterval? = 246.75

  public var statusResult = WafraLiveCaptureStatus(
    enabled: true,
    entitled: true,
    pending: 13,
    dropped: 4,
    corrupt: true,
    warningId: "00000000-0000-0000-0000-000000000009",
    setupProofVersion: 9,
    setupProofAt: 123.25,
    firstCapturedAt: 987.5
  )

  public func reset() {
    calls = []
    listLimits = []
    firstCapturedDates = []
    localLeaseCalls = []
    storeLeaseCalls = []
  }

  public func setLocalEntitlementLease(expiresAt: Date?, lifetime: Bool) throws -> Bool {
    calls.append("setLocalEntitlementLease")
    localLeaseCalls.append((expiresAt, lifetime))
    return true
  }

  public func setStoreEntitlementLease(
    expiresAt: Date?,
    lifetime: Bool,
    verifiedAt: Date
  ) throws -> Bool {
    calls.append("setStoreEntitlementLease")
    storeLeaseCalls.append((expiresAt, lifetime, verifiedAt))
    return true
  }

  public func setCaptureEnabled(_ enabled: Bool) throws {
    calls.append("setCaptureEnabled:\(enabled)")
  }

  public func listPendingRecords(limit: Int) throws -> [String] {
    calls.append("listPendingRecords")
    listLimits.append(limit)
    return ["pending:\(limit)"]
  }

  public func acknowledgeRecords(ids: [String]) throws {
    calls.append("acknowledgeRecords:\(ids.joined(separator: ","))")
  }

  public func purgeExpired() throws -> Int {
    calls.append("purgeExpired")
    return 23
  }

  public func status() throws -> WafraLiveCaptureStatus {
    calls.append("status")
    return statusResult
  }

  public func automationInputProbeAt() throws -> TimeInterval? {
    calls.append("automationInputProbeAt")
    return automationInputProbeAtResult
  }

  public func acknowledgeCaptureWarning(id: String) throws -> Bool {
    calls.append("acknowledgeCaptureWarning:\(id)")
    return id == statusResult.warningId
  }

  public func recordFirstCapturedAt(_ date: Date) throws {
    calls.append("recordFirstCapturedAt")
    firstCapturedDates.append(date)
  }

  public func eraseAll() throws {
    calls.append("eraseAll")
  }
}
