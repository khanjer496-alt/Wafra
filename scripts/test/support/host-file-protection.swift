// Command-line test boundary only. Never include this file in an app target.
// macOS/Simulator do not implement iPhone Data Protection. Model only the
// protection-class metadata, using real inode xattrs so it survives child
// processes, renames and hard links. All bytes, locks, permissions, deletion,
// symlinks and other Foundation attributes still use the actual filesystem.
// This does NOT encrypt files or certify physical-device lock-state behavior.
// The production stores are compiled unchanged and must still reject absent
// or downgraded protection metadata; no guard is disabled in this harness.
#if !os(macOS)
#error("The host file-protection adapter must never compile into an iOS target")
#endif

import Foundation
import Darwin

typealias FileManager = HostHistoryFileManager

final class HostHistoryFileManager: Foundation.FileManager, @unchecked Sendable {
  private static let instance = HostHistoryFileManager()
  private static let attribute = "app.wafra.test-only.file-protection"

  override class var `default`: Foundation.FileManager { instance }

  override func createDirectory(
    at url: URL,
    withIntermediateDirectories createIntermediates: Bool,
    attributes: [FileAttributeKey: Any]? = nil
  ) throws {
    var hostAttributes = attributes
    hostAttributes?.removeValue(forKey: .protectionKey)
    try super.createDirectory(at: url, withIntermediateDirectories: createIntermediates,
                              attributes: hostAttributes)
    if let protection = attributes?[.protectionKey] {
      try setAttributes([.protectionKey: protection], ofItemAtPath: url.path)
    }
  }

  override func setAttributes(_ attributes: [FileAttributeKey: Any], ofItemAtPath path: String) throws {
    var actual = attributes
    let protection = actual.removeValue(forKey: .protectionKey)
    try super.setAttributes(actual, ofItemAtPath: path)
    guard let protection else { return }
    let raw: String
    if let value = protection as? FileProtectionType { raw = value.rawValue }
    else if let value = protection as? String { raw = value }
    else { throw CocoaError(.fileWriteUnknown) }
    let bytes = Array(raw.utf8)
    let result = bytes.withUnsafeBytes {
      Darwin.setxattr(path, Self.attribute, $0.baseAddress, $0.count, 0, XATTR_NOFOLLOW)
    }
    guard result == 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
  }

  override func attributesOfItem(atPath path: String) throws -> [FileAttributeKey: Any] {
    var attributes = try super.attributesOfItem(atPath: path)
    // Missing metadata stays missing, never silently upgraded to `.complete`.
    attributes.removeValue(forKey: .protectionKey)
    let count = Darwin.getxattr(path, Self.attribute, nil, 0, 0, XATTR_NOFOLLOW)
    if count < 0 {
      guard errno == ENOATTR else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
      return attributes
    }
    guard count <= 256 else { throw CocoaError(.fileReadCorruptFile) }
    var bytes = [UInt8](repeating: 0, count: count)
    let read = bytes.withUnsafeMutableBytes {
      Darwin.getxattr(path, Self.attribute, $0.baseAddress, $0.count, 0, XATTR_NOFOLLOW)
    }
    guard read == count, let raw = String(bytes: bytes, encoding: .utf8) else {
      throw CocoaError(.fileReadCorruptFile)
    }
    attributes[.protectionKey] = FileProtectionType(rawValue: raw)
    return attributes
  }
}
