import Foundation

@main struct HostFileProtectionModelTests {
  static func main() throws {
    let manager = FileManager.default
    let root = manager.temporaryDirectory.appendingPathComponent("wafra-host-model-" + UUID().uuidString)
    try manager.createDirectory(at: root, withIntermediateDirectories: false,
                                attributes: [.posixPermissions: 0o700])
    defer { try? manager.removeItem(at: root) }
    let initialRoot = try manager.attributesOfItem(atPath: root.path)
    precondition(initialRoot[.protectionKey] == nil)
    for protection in [FileProtectionType.complete, .none, .completeUntilFirstUserAuthentication,
                       .completeUnlessOpen] {
      try manager.setAttributes([.protectionKey: protection], ofItemAtPath: root.path)
      let attributes = try manager.attributesOfItem(atPath: root.path)
      precondition(attributes[.protectionKey] as? FileProtectionType == protection)
      precondition((attributes[.posixPermissions] as? NSNumber)?.intValue == 0o700)
    }
    let file = root.appendingPathComponent("fixture")
    try Data("synthetic".utf8).write(to: file)
    let initialFile = try manager.attributesOfItem(atPath: file.path)
    precondition(initialFile[.protectionKey] == nil)
    try manager.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: file.path)
    let renamed = root.appendingPathComponent("renamed")
    try manager.moveItem(at: file, to: renamed)
    let attributes = try manager.attributesOfItem(atPath: renamed.path)
    precondition(attributes[.protectionKey] as? FileProtectionType == .complete)
    precondition((attributes[.size] as? NSNumber)?.intValue == 9)
    precondition((attributes[.referenceCount] as? NSNumber)?.intValue == 1)
    try manager.setAttributes([.protectionKey: FileProtectionType.none], ofItemAtPath: renamed.path)
    let downgraded = try manager.attributesOfItem(atPath: renamed.path)
    precondition(downgraded[.protectionKey] as? FileProtectionType == FileProtectionType.none)
    print("✓ host-only protection model preserves absent, downgraded and renamed metadata and real filesystem attributes")
  }
}
