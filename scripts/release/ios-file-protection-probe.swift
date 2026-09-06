import Foundation

// Non-financial temporary test data only. This does not change the app's
// FileProtection requirements or pretend a macOS test is an iOS device test.
let fm = FileManager.default
let root = fm.temporaryDirectory.appendingPathComponent("wafra-protection-probe-\(UUID().uuidString)")
defer { try? fm.removeItem(at: root) }
print("host=macOS; scope=file-protection-capability-only")
do {
  try fm.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.complete, .posixPermissions: 0o700])
  try fm.setAttributes([.protectionKey: FileProtectionType.complete, .posixPermissions: 0o700], ofItemAtPath: root.path)
  let a = try fm.attributesOfItem(atPath: root.path)
  print("directory_is_directory=\(a[.type] as? FileAttributeType == .typeDirectory)")
  print("directory_mode_0700=\((a[.posixPermissions] as? NSNumber)?.intValue == 0o700)")
  print("directory_protection_present=\(a[.protectionKey] != nil)")
  print("directory_protection_complete=\(a[.protectionKey] as? FileProtectionType == .complete)")
  let file = root.appendingPathComponent("synthetic.txt")
  try Data("synthetic".utf8).write(to: file, options: [.atomic, .completeFileProtection])
  try fm.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: file.path)
  let b = try fm.attributesOfItem(atPath: file.path)
  print("file_is_regular=\(b[.type] as? FileAttributeType == .typeRegular)")
  print("file_has_one_link=\((b[.referenceCount] as? NSNumber)?.intValue == 1)")
  print("file_protection_present=\(b[.protectionKey] != nil)")
  print("file_protection_complete=\(b[.protectionKey] as? FileProtectionType == .complete)")
} catch {
  print("probe_operation_failed=true; domain=\((error as NSError).domain); code=\((error as NSError).code)")
}
