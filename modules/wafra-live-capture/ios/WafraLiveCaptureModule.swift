import ExpoModulesCore
import Foundation

private enum WafraLiveCaptureBridgeError: Error {
  case invalidLimit
  case invalidTimestamp
  case invalidEntitlementLease
}

private struct WafraLiveCaptureStatusRecord: Record {
  @Field var enabled: Bool = false
  @Field var entitled: Bool = false
  @Field var pending: Int = 0
  @Field var dropped: Int = 0
  @Field var corrupt: Bool = false
  @Field var warningId: String?
  @Field var setupProofVersion: Int?
  @Field var setupProofAt: Double?
  @Field var firstCapturedAt: Double?
  @Field var lastReceivedAt: Double?
  @Field var lastHandledAt: Double?
}

private func bridgeLimit(_ limit: Double) throws -> Int {
  guard
    limit.isFinite,
    let nativeLimit = Int(exactly: limit),
    (0...WafraLiveCaptureStore.maxBridgeRecords).contains(nativeLimit)
  else {
    throw WafraLiveCaptureBridgeError.invalidLimit
  }
  return nativeLimit
}

private func dateFromEpochMilliseconds(_ milliseconds: Double) throws -> Date {
  guard milliseconds.isFinite else {
    throw WafraLiveCaptureBridgeError.invalidTimestamp
  }
  let seconds = milliseconds / 1_000.0
  guard seconds.isFinite else {
    throw WafraLiveCaptureBridgeError.invalidTimestamp
  }
  return Date(timeIntervalSince1970: seconds)
}

private func leaseDateFromEpochMilliseconds(_ milliseconds: Double?) throws -> Date? {
  guard let milliseconds else { return nil }
  guard milliseconds >= 0 else {
    throw WafraLiveCaptureBridgeError.invalidEntitlementLease
  }
  return try dateFromEpochMilliseconds(milliseconds)
}

private func epochMilliseconds(_ seconds: TimeInterval?) throws -> Double? {
  guard let seconds else { return nil }
  let milliseconds = seconds * 1_000.0
  guard seconds.isFinite, milliseconds.isFinite else {
    throw WafraLiveCaptureBridgeError.invalidTimestamp
  }
  return milliseconds
}

public class WafraLiveCaptureModule: Module {
  private static let queueLocalNotification = Notification.Name(
    WafraLiveCaptureStore.queueChangedNotificationName
  )
  // The callback owns no module pointer and lives for the process lifetime.
  // Darwin notifications also reach an already-running app when an App Intent
  // stages from a different process. They do not launch a closed JS runtime.
  private static let installQueueBridge: Void = {
    CFNotificationCenterAddObserver(
      CFNotificationCenterGetDarwinNotifyCenter(), nil,
      { _, _, _, _, _ in
        NotificationCenter.default.post(name: queueLocalNotification, object: nil)
      },
      WafraLiveCaptureStore.queueChangedNotificationName as CFString,
      nil, .deliverImmediately
    )
  }()
  private let queueObserverLock = NSLock()
  private var queueObserver: NSObjectProtocol?

  private func startQueueObservation() {
    queueObserverLock.lock()
    defer { queueObserverLock.unlock() }
    guard queueObserver == nil else { return }
    _ = Self.installQueueBridge
    queueObserver = NotificationCenter.default.addObserver(
      forName: Self.queueLocalNotification, object: nil, queue: nil
    ) { [weak self] _ in
      self?.sendEvent("onQueueChanged", [:])
    }
    // Close the registration/read race by requesting a fresh disk read once
    // observation is installed. The JS scheduler coalesces this with a burst.
    sendEvent("onQueueChanged", [:])
  }

  private func stopQueueObservation() {
    queueObserverLock.lock()
    defer { queueObserverLock.unlock() }
    if let queueObserver { NotificationCenter.default.removeObserver(queueObserver) }
    queueObserver = nil
  }

  deinit { stopQueueObservation() }

  public func definition() -> ModuleDefinition {
    Name("WafraLiveCapture")
    Constant("queueChangeEventsSupported") { true }
    Events("onQueueChanged")
    OnStartObserving { self.startQueueObservation() }
    OnStopObserving { self.stopQueueObservation() }
    OnDestroy { self.stopQueueObservation() }

    AsyncFunction("setCaptureEnabled") { (enabled: Bool) in
      try WafraLiveCaptureStore.shared.setCaptureEnabled(enabled)
    }

    AsyncFunction("setLocalCaptureEntitlementLease") {
      (expiresAtMilliseconds: Double?, lifetime: Bool) -> Bool in
      guard lifetime == (expiresAtMilliseconds == nil) else {
        throw WafraLiveCaptureBridgeError.invalidEntitlementLease
      }
      return try WafraLiveCaptureStore.shared.setLocalEntitlementLease(
        expiresAt: try leaseDateFromEpochMilliseconds(expiresAtMilliseconds),
        lifetime: lifetime
      )
    }

    AsyncFunction("setStoreCaptureEntitlementLease") {
      (
        expiresAtMilliseconds: Double?,
        lifetime: Bool,
        verifiedAtMilliseconds: Double
      ) -> Bool in
      guard !lifetime || expiresAtMilliseconds == nil else {
        throw WafraLiveCaptureBridgeError.invalidEntitlementLease
      }
      let verifiedAt = try leaseDateFromEpochMilliseconds(verifiedAtMilliseconds)
      guard let verifiedAt else {
        throw WafraLiveCaptureBridgeError.invalidEntitlementLease
      }
      return try WafraLiveCaptureStore.shared.setStoreEntitlementLease(
        expiresAt: try leaseDateFromEpochMilliseconds(expiresAtMilliseconds),
        lifetime: lifetime,
        verifiedAt: verifiedAt
      )
    }

    AsyncFunction("listPendingRecords") { (limit: Double) -> [String] in
      let nativeLimit = try bridgeLimit(limit)
      return try WafraLiveCaptureStore.shared.listPendingRecords(limit: nativeLimit)
    }

    AsyncFunction("acknowledgeRecords") { (ids: [String]) in
      try WafraLiveCaptureStore.shared.acknowledgeRecords(ids: ids)
    }

    AsyncFunction("purgeExpired") { () -> Int in
      try WafraLiveCaptureStore.shared.purgeExpired()
    }

    AsyncFunction("getCaptureStatus") { () -> WafraLiveCaptureStatusRecord in
      let status = try WafraLiveCaptureStore.shared.status()
      var record = WafraLiveCaptureStatusRecord()
      record.enabled = status.enabled
      record.entitled = status.entitled
      record.pending = status.pending
      record.dropped = status.dropped
      record.corrupt = status.corrupt
      record.warningId = status.warningId
      record.setupProofVersion = status.setupProofVersion
      record.setupProofAt = try epochMilliseconds(status.setupProofAt)
      record.firstCapturedAt = try epochMilliseconds(status.firstCapturedAt)
      record.lastReceivedAt = try epochMilliseconds(status.lastReceivedAt)
      record.lastHandledAt = try epochMilliseconds(status.lastHandledAt)
      return record
    }

    AsyncFunction("getAutomationInputProbeAt") { () -> Double? in
      try epochMilliseconds(WafraLiveCaptureStore.shared.automationInputProbeAt())
    }

    AsyncFunction("acknowledgeCaptureWarning") { (warningId: String) -> Bool in
      try WafraLiveCaptureStore.shared.acknowledgeCaptureWarning(id: warningId)
    }

    AsyncFunction("recordFirstCapturedAt") { (observedAt: Double) in
      let date = try dateFromEpochMilliseconds(observedAt)
      try WafraLiveCaptureStore.shared.recordFirstCapturedAt(date)
    }

    AsyncFunction("eraseAll") { () in
      try WafraLiveCaptureStore.shared.eraseAll()
    }
  }
}
