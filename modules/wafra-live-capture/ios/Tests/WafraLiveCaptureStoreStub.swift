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
  public let lastReceivedAt: TimeInterval?
  public let lastHandledAt: TimeInterval?
  public let notificationSetupProofAt: TimeInterval?
  public let firstNotificationReceivedAt: TimeInterval?
  public let lastNotificationReceivedAt: TimeInterval?
  public let applePayPending: Int
  public let lastApplePayIncompleteAt: TimeInterval?
  public let applePaySetupProofAt: TimeInterval?
  public let firstApplePayReceivedAt: TimeInterval?
  public let lastApplePayReceivedAt: TimeInterval?
}

public final class WafraLiveCaptureStore {
  public static let shared = WafraLiveCaptureStore()
  public static let queueChangedNotificationName = "app.wafra.live-capture.queue-changed.v1"
  public static let maxBridgeRecords = 50
  public static let maxExcludedRecords = 2000

  public private(set) var calls: [String] = []
  public private(set) var listLimits: [Int] = []
  public private(set) var listIncludesNotifications: [Bool] = []
  public private(set) var listIncludesApplePay: [Bool] = []
  public private(set) var listExcluded: [[String]] = []
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
    firstCapturedAt: 987.5,
    lastReceivedAt: 1234.5,
    lastHandledAt: 1244.75,
    notificationSetupProofAt: 1245.125,
    firstNotificationReceivedAt: 1250.25,
    lastNotificationReceivedAt: 1300.5,
    applePayPending: 3,
    lastApplePayIncompleteAt: 1390.5,
    applePaySetupProofAt: 1400.25,
    firstApplePayReceivedAt: 1410.5,
    lastApplePayReceivedAt: 1420.75
  )

  public func reset() {
    calls = []
    listLimits = []
    listIncludesNotifications = []
    listIncludesApplePay = []
    listExcluded = []
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

  public func listPendingRecords(limit: Int, includeNotifications: Bool = true, includeApplePay: Bool = false, excluding: [String] = []) throws -> [String] {
    calls.append("listPendingRecords")
    listLimits.append(limit)
    listExcluded.append(excluding)
    listIncludesNotifications.append(includeNotifications)
    listIncludesApplePay.append(includeApplePay)
    return ["pending:\(limit)"]
  }

  public func listPendingApplePayRecords(limit: Int) throws -> [String] {
    calls.append("listPendingApplePayRecords")
    listLimits.append(limit)
    return ["apple-pay:\(limit)"]
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

/// Resource-only adapter for the native bridge host harness. No financial files.
public enum WafraLiveCaptureResources {
  public static var shortcutAvailable = true
  public static var requestedName: String?
  public static var requestedExtension: String?
  public static let shortcutURL = URL(fileURLWithPath: "/tmp/WafraLiveCaptureResources.bundle/Wafra Notifications v1.shortcut")

  public static let shortcutURLs = [
    "Wafra Notifications v1": shortcutURL,
    "Wafra Apple Pay v1": URL(fileURLWithPath: "/tmp/WafraLiveCaptureResources.bundle/Wafra Apple Pay v1.shortcut"),
    "Wafra Capture v3": URL(fileURLWithPath: "/tmp/WafraLiveCaptureResources.bundle/Wafra Capture v3.shortcut"),
    "Wafra History v8": URL(fileURLWithPath: "/tmp/WafraLiveCaptureResources.bundle/Wafra History v8.shortcut"),
  ]

  public struct ResourceBundle {
    public func url(forResource name: String?, withExtension ext: String?) -> URL? {
      WafraLiveCaptureResources.requestedName = name
      WafraLiveCaptureResources.requestedExtension = ext
      guard WafraLiveCaptureResources.shortcutAvailable, let name, ext == "shortcut" else { return nil }
      return WafraLiveCaptureResources.shortcutURLs[name]
    }
  }

  public static func bundle() -> ResourceBundle { ResourceBundle() }
}
