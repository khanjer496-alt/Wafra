// Compiled WITHOUT the host adapter: the actual production guard must fail
// closed when the host filesystem cannot provide complete Data Protection.
import Foundation

@main struct NativeHistoryProtectionProbe {
  static func main() throws {
    let manager = FileManager.default
    let root = manager.temporaryDirectory.appendingPathComponent("wafra-raw-protection-" + UUID().uuidString)
    try manager.createDirectory(at: root, withIntermediateDirectories: false,
                                attributes: [.posixPermissions: 0o700])
    defer { try? manager.removeItem(at: root) }
    // Hosted VMs may reject the setter or return a different class. Neither
    // means the production store may silently admit less-protected records.
    do {
      try manager.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: root.path)
    } catch {
      print("Host Data Protection setter unavailable; testing the production fail-closed path.")
    }
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
      print("✓ unadapted production store correctly refuses unsupported host Data Protection")
    }
    try unconfirmedProtectionHelperChecks()
    if complete {
      print("Host has complete Data Protection: the store-level erase fallback can't be reached here; helper checks above ran.")
      return
    }
    try eraseChecks()
  }

  // Erase may delete a root whose protection cannot be confirmed (the iOS
  // Simulator); reads and writes still refuse it, and it never follows a link.
  private static func eraseChecks() throws {
    let manager = FileManager.default
    func freshRoot(_ label: String) throws -> URL {
      let url = manager.temporaryDirectory.appendingPathComponent("wafra-erase-\(label)-" + UUID().uuidString)
      try manager.createDirectory(at: url, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
      return url
    }
    func seed(_ root: URL, session: String) throws {
      let directory = root.appendingPathComponent(session, isDirectory: true)
      try manager.createDirectory(at: directory, withIntermediateDirectories: false)
      try Data("synthetic".utf8).write(to: directory.appendingPathComponent("chunk-0.json"))
      try Data([1]).write(to: root.appendingPathComponent(".erase-in-progress"))
      try manager.createDirectory(at: root.appendingPathComponent(".invalid-\(UUID().uuidString)"),
                                  withIntermediateDirectories: false)
    }
    func onlyLockLeft(_ root: URL) throws -> Bool {
      try manager.contentsOfDirectory(atPath: root.path).allSatisfy { $0 == ".lock" }
    }

    // Completed store: erase deletes; writes still refuse before and after.
    let completedRoot = try freshRoot("completed")
    defer { try? manager.removeItem(at: completedRoot) }
    let completed = WafraMessageHistoryStore(root: completedRoot)
    try seed(completedRoot, session: "synthetic-erase-0001")
    try completed.eraseAll()
    let completedCleared = try onlyLockLeft(completedRoot)
    precondition(completedCleared, "completed erase left store entries behind")
    print("✓ completed eraseAll deletes a root without confirmed protection")
    do {
      _ = try completed.beginSession(sessionId: "synthetic-after-erase")
      preconditionFailure("completed store wrote into a root without confirmed protection")
    } catch let error as WafraMessageHistoryStore.StoreError {
      precondition(error == .storageFailure, "completed write refused for another reason")
      print("✓ completed writes still refuse a root without confirmed protection")
    }

    // Prepared store: the same delete, and writes still refuse.
    let preparedRoot = try freshRoot("prepared")
    defer { try? manager.removeItem(at: preparedRoot) }
    let prepared = WafraPreparedHistoryStore(root: preparedRoot)
    try seed(preparedRoot, session: "WAFRA-PREPARED-ERASE-0001")
    try prepared.eraseAll()
    let preparedCleared = try onlyLockLeft(preparedRoot)
    precondition(preparedCleared, "prepared erase left store entries behind")
    print("✓ prepared eraseAll deletes a root without confirmed protection")
    do {
      try prepared.prepare(sessionId: "WAFRA-PREPARED-AFTER-0001", found: 1, position: 1,
                           guid: "synthetic-guid", body: "synthetic body", date: Date())
      preconditionFailure("prepared store wrote into a root without confirmed protection")
    } catch let error as WafraPreparedHistoryStore.StoreError {
      precondition(error == .storageFailure, "prepared write refused for another reason")
      print("✓ prepared writes still refuse a root without confirmed protection")
    }

  }
  // The fallback helper itself, on every host: a root explicitly marked
  // FileProtectionType.none is "protection not confirmed" even where the host
  // supports Data Protection. Store-level reachability is covered above only
  // where the host can't confirm protection (CI VMs, the iOS Simulator).
  private static func unconfirmedProtectionHelperChecks() throws {
    let manager = FileManager.default
    func unprotectedRoot(_ label: String) throws -> URL {
      let url = manager.temporaryDirectory.appendingPathComponent("wafra-helper-\(label)-" + UUID().uuidString)
      try manager.createDirectory(at: url, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
      try? manager.setAttributes([.protectionKey: FileProtectionType.none], ofItemAtPath: url.path)
      let protection = try manager.attributesOfItem(atPath: url.path)[.protectionKey] as? FileProtectionType
      precondition(protection != .complete, "could not build an unconfirmed-protection root")
      return url
    }
    let isStoreEntry: (String) -> Bool = { name in
      name == ".erase-in-progress" || name.hasPrefix(".invalid-") || name.hasPrefix("synthetic-")
    }
    func erase(_ root: URL) throws -> Bool {
      try WafraUnconfirmedProtectionErase.eraseIfProtectionUnconfirmed(
        root: root, isStoreEntry: isStoreEntry, removeItem: { try manager.removeItem(at: $0) })
    }

    let root = try unprotectedRoot("delete")
    defer { try? manager.removeItem(at: root) }
    let session = root.appendingPathComponent("synthetic-session-0001", isDirectory: true)
    try manager.createDirectory(at: session, withIntermediateDirectories: false)
    try Data("synthetic".utf8).write(to: session.appendingPathComponent("chunk-0.json"))
    try Data([1]).write(to: root.appendingPathComponent(".erase-in-progress"))
    try manager.createDirectory(at: root.appendingPathComponent(".invalid-\(UUID().uuidString)"), withIntermediateDirectories: false)
    let deleted = try erase(root)
    let left = try manager.contentsOfDirectory(atPath: root.path)
    precondition(deleted && left.allSatisfy { $0 == ".lock" }, "helper did not delete every store entry")
    print("✓ unconfirmed-protection erase deletes every store entry without reading it")

    let outside = try unprotectedRoot("outside")
    defer { try? manager.removeItem(at: outside) }
    let outsideFile = outside.appendingPathComponent("keep.txt")
    try Data("outside".utf8).write(to: outsideFile)
    func refuses(_ label: String, _ setup: (URL) throws -> Void) throws {
      let root = try unprotectedRoot("refuse")
      defer { try? manager.removeItem(at: root) }
      try setup(root)
      let before = try manager.contentsOfDirectory(atPath: root.path).filter { $0 != ".lock" }.sorted()
      let applied = try erase(root)
      let after = try manager.contentsOfDirectory(atPath: root.path).filter { $0 != ".lock" }.sorted()
      precondition(!applied, "erase accepted \(label)")
      precondition(before == after, "\(label): a refused erase still deleted entries")
      precondition(manager.fileExists(atPath: outsideFile.path), "\(label) touched a path outside the root")
      print("✓ erase refuses \(label)")
    }
    try refuses("a symlinked session entry") { root in
      try manager.createSymbolicLink(at: root.appendingPathComponent("synthetic-link-0001"), withDestinationURL: outside)
    }
    try refuses("a symlink inside a session") { root in
      let session = root.appendingPathComponent("synthetic-nested-0001", isDirectory: true)
      try manager.createDirectory(at: session, withIntermediateDirectories: false)
      try manager.createSymbolicLink(at: session.appendingPathComponent("chunk-0.json"), withDestinationURL: outsideFile)
    }
    try refuses("an entry the store never writes") { root in
      try Data("synthetic".utf8).write(to: root.appendingPathComponent("notes.txt"))
      try manager.createDirectory(at: root.appendingPathComponent("synthetic-kept-0001"), withIntermediateDirectories: false)
    }
    let linkedRoot = manager.temporaryDirectory.appendingPathComponent("wafra-helper-linked-root-" + UUID().uuidString)
    try manager.createSymbolicLink(at: linkedRoot, withDestinationURL: outside)
    defer { try? manager.removeItem(at: linkedRoot) }
    let linkedApplied = try erase(linkedRoot)
    precondition(!linkedApplied, "erase accepted a symlinked root")
    precondition(manager.fileExists(atPath: outsideFile.path), "a symlinked root erase touched its target")
    print("✓ erase refuses a symlinked root")

    // A root with confirmed complete protection is not this fallback's to erase.
    let protected = manager.temporaryDirectory.appendingPathComponent("wafra-helper-protected-" + UUID().uuidString)
    try manager.createDirectory(at: protected, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    defer { try? manager.removeItem(at: protected) }
    try? manager.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: protected.path)
    let protectedClass = try manager.attributesOfItem(atPath: protected.path)[.protectionKey] as? FileProtectionType
    if protectedClass == .complete {
      try manager.createDirectory(at: protected.appendingPathComponent("synthetic-protected-0001"), withIntermediateDirectories: false)
      let protectedApplied = try erase(protected)
      precondition(!protectedApplied, "the fallback erased a root with complete protection")
      precondition(manager.fileExists(atPath: protected.appendingPathComponent("synthetic-protected-0001").path),
                   "the fallback deleted from a protected root")
      print("✓ a root with complete protection is left to the normal erase")
    }
  }
}
