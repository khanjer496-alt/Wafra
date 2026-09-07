// Compiled WITHOUT the host adapter: the actual production guard must fail
// closed when the host filesystem cannot provide complete Data Protection.
import Foundation

@main struct NativeHistoryProtectionProbe {
  static func main() throws {
    let manager = FileManager.default
    let root = manager.temporaryDirectory.appendingPathComponent("wafra-raw-protection-" + UUID().uuidString)
    try manager.createDirectory(at: root, withIntermediateDirectories: false,
                                attributes: [.protectionKey: FileProtectionType.complete,
                                             .posixPermissions: 0o700])
    defer { try? manager.removeItem(at: root) }
    try manager.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: root.path)
    let attributes = try manager.attributesOfItem(atPath: root.path)
    let complete = attributes[.protectionKey] as? FileProtectionType == .complete
    let store = WafraMessageHistoryStore(root: root)
    do {
      _ = try store.beginSession(sessionId: "synthetic-host-probe")
      precondition(complete, "Production store accepted a filesystem without complete protection")
      print("✓ unadapted store accepted actual complete protection")
    } catch let error as WafraMessageHistoryStore.StoreError {
      precondition(!complete && error == .storageFailure,
                   "Production store failed for a reason other than unsupported host protection")
      print("Production guard correctly refused unsupported host Data Protection. Select a compatible CI runner; never weaken the guard.")
      Foundation.exit(1)
    }
  }
}
