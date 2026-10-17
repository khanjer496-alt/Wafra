import Darwin
import Foundation

/// Foundation-only core of "Open in Wafra" for a statement iOS hands over by
/// its original location (Files / iCloud Drive) instead of an Inbox copy.
///
/// Nothing here logs: no file name, path or byte ever reaches a log. Every
/// failure is a plain `nil`.
public struct WafraIncomingFilePolicy: Sendable {
  /// Mirrors INCOMING_STATEMENT_EXTENSIONS in src/lib/incoming-statement-file.ts.
  public static let statementExtensions: Set<String> = [
    "pdf", "csv", "tsv", "xlsx", "ofx", "qfx", "qif", "sta", "mt940", "940",
  ]
  /// Above every upload limit the import service advertises (PDF 5 MB today).
  public static let defaultMaxBytes = 10 * 1024 * 1024

  public var allowedExtensions: Set<String>
  public var maxBytes: Int
  /// Upper bound on the whole adoption: the coordinated read (which may
  /// download an iCloud item that is not on the phone yet) plus the copy.
  public var timeout: TimeInterval

  public init(
    allowedExtensions: Set<String> = WafraIncomingFilePolicy.statementExtensions,
    maxBytes: Int = WafraIncomingFilePolicy.defaultMaxBytes,
    timeout: TimeInterval = 8
  ) {
    self.allowedExtensions = allowedExtensions
    self.maxBytes = maxBytes
    self.timeout = timeout
  }
}

public enum WafraIncomingFileAdopter {
  static let maxURLLength = 4096
  static let maxBaseCharacters = 80
  static let maxBaseUTF8Bytes = 180

  // MARK: - Pure validation

  /// The lower-cased statement extension of a file name, or nil.
  static func statementExtension(of name: String, policy: WafraIncomingFilePolicy) -> String? {
    guard !name.hasPrefix("."), let dot = name.lastIndex(of: "."), dot != name.startIndex else { return nil }
    let ext = String(name[name.index(after: dot)...]).lowercased()
    guard !ext.isEmpty, ext.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber) }) else { return nil }
    return policy.allowedExtensions.contains(ext) ? ext : nil
  }

  /// The handed-over URL when it is a plain local file URL naming a
  /// statement, otherwise nil. No file-system access.
  public static func candidate(_ value: String, policy: WafraIncomingFilePolicy) -> URL? {
    guard !value.isEmpty, value.utf8.count <= maxURLLength, value.hasPrefix("file:///") else { return nil }
    // An encoded separator, backslash or control character never names a
    // plain file (the JavaScript Inbox rule refuses the same).
    let lowered = value.lowercased()
    guard !["%2f", "%5c", "%00"].contains(where: { lowered.contains($0) }),
          !value.unicodeScalars.contains(where: { $0.value < 0x20 || $0.value == 0x7f || $0 == "\\" }) else { return nil }
    guard let url = URL(string: value), url.isFileURL,
          url.host == nil || url.host == "" || url.host == "localhost",
          url.query == nil, url.fragment == nil else { return nil }
    let path = url.path
    guard path.hasPrefix("/"),
          !path.unicodeScalars.contains(where: { $0.value < 0x20 || $0.value == 0x7f || $0 == "\\" }) else { return nil }
    let components = path.split(separator: "/", omittingEmptySubsequences: false).dropFirst()
    guard !components.isEmpty, !components.contains(where: { $0.isEmpty || $0 == "." || $0 == ".." }) else { return nil }
    guard statementExtension(of: url.lastPathComponent, policy: policy) != nil else { return nil }
    return url
  }

  /// `/private/var/…` and `/var/…` are the same place on iOS (and `/private/tmp`
  /// on macOS). Compare paths in one spelling.
  static func normalized(_ path: String) -> String {
    let standard = (path as NSString).standardizingPath
    for prefix in ["/private/var/", "/private/tmp/"] where standard.hasPrefix(prefix) {
      return String(standard.dropFirst("/private".count))
    }
    return standard
  }

  /// True when `path` is one of `roots` or inside one of them.
  public static func isInside(_ path: String, roots: [URL]) -> Bool {
    let candidate = normalized(path)
    for root in roots {
      var base = normalized(root.path)
      while base.count > 1 && base.hasSuffix("/") { base.removeLast() }
      if base == "/" || candidate == base || candidate.hasPrefix(base + "/") { return true }
    }
    return false
  }

  /// A safe file name for the Inbox copy that keeps the statement extension:
  /// letters, digits and a few separators survive; anything else (separators,
  /// control and bidi-format characters, `:` `?` `#` `%` …) becomes `_`.
  public static func sanitizedName(_ original: String, policy: WafraIncomingFilePolicy) -> String? {
    guard let ext = statementExtension(of: original, policy: policy) else { return nil }
    let rawBase = String(original.dropLast(ext.count + 1))
    let kept: Set<Character> = [" ", "-", "_", ".", "(", ")", ",", "+", "&"]
    var base = ""
    for character in rawBase {
      let safe = character.unicodeScalars.allSatisfy { scalar in
        switch scalar.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
             .decimalNumber, .letterNumber, .otherNumber, .nonspacingMark, .spacingMark, .enclosingMark:
          return true
        default:
          return false
        }
      }
      base.append(safe || kept.contains(character) ? character : "_")
    }
    base = base.trimmingCharacters(in: CharacterSet(charactersIn: " ._"))
    if base.count > maxBaseCharacters { base = String(base.prefix(maxBaseCharacters)) }
    while base.utf8.count > maxBaseUTF8Bytes { base.removeLast() }
    base = base.trimmingCharacters(in: CharacterSet(charactersIn: " ._"))
    if base.isEmpty { base = "statement" }
    return "\(base).\(ext)"
  }

  // MARK: - Copy

  /// Copy one regular, non-symlink statement file of at most `maxBytes` into
  /// `inbox` under a new unique name. Returns the copy, or nil (and leaves
  /// nothing behind). `source` must already be readable: inside a
  /// coordinated read with security-scoped access, on the phone.
  public static func copyValidated(
    from source: URL,
    displayName: String,
    into inbox: URL,
    forbiddenRoots: [URL],
    policy: WafraIncomingFilePolicy,
    isCancelled: () -> Bool = { false }
  ) -> URL? {
    guard source.isFileURL, !isInside(source.path, roots: forbiddenRoots),
          let name = sanitizedName(displayName, policy: policy),
          statementExtension(of: source.lastPathComponent, policy: policy) != nil else { return nil }
    // The resolved location must stay outside the app's own containers too.
    let resolved = source.resolvingSymlinksInPath().path
    guard !isInside(resolved, roots: forbiddenRoots) else { return nil }

    var linkInfo = stat()
    guard lstat(source.path, &linkInfo) == 0, (linkInfo.st_mode & S_IFMT) == S_IFREG,
          linkInfo.st_size >= 0, Int64(linkInfo.st_size) <= Int64(policy.maxBytes) else { return nil }

    // O_NOFOLLOW refuses a final-component symlink swapped in after lstat;
    // O_NONBLOCK keeps a FIFO from blocking the open (fstat rejects it next).
    let input = open(source.path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
    guard input >= 0 else { return nil }
    defer { close(input) }
    var info = stat()
    guard fstat(input, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG,
          info.st_size >= 0, Int64(info.st_size) <= Int64(policy.maxBytes) else { return nil }

    guard prepareInbox(inbox) else { return nil }
    guard let (output, destination) = createUnique(name: name, in: inbox) else { return nil }
    var keep = false
    defer {
      close(output)
      if !keep { unlink(destination.path) }
    }

    let chunk = 64 * 1024
    var buffer = [UInt8](repeating: 0, count: chunk)
    var total = 0
    while true {
      if isCancelled() { return nil }
      let count = buffer.withUnsafeMutableBytes { read(input, $0.baseAddress, chunk) }
      if count < 0 {
        if errno == EINTR || errno == EAGAIN { continue }
        return nil
      }
      if count == 0 { break }
      total += count
      // The file grew past the cap while it was being read.
      if total > policy.maxBytes { return nil }
      var written = 0
      while written < count {
        let result = buffer.withUnsafeBytes { write(output, $0.baseAddress! + written, count - written) }
        if result < 0 {
          if errno == EINTR { continue }
          return nil
        }
        written += result
      }
    }
    guard total > 0, fsync(output) == 0 else { return nil }
    keep = true
    var copy = destination
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try? copy.setResourceValues(values)
    return destination
  }

  static func prepareInbox(_ inbox: URL) -> Bool {
    var info = stat()
    if lstat(inbox.path, &info) == 0 { return (info.st_mode & S_IFMT) == S_IFDIR }
    do {
      try FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true)
    } catch {
      return false
    }
    return lstat(inbox.path, &info) == 0 && (info.st_mode & S_IFMT) == S_IFDIR
  }

  /// `name`, then `name-1`, `name-2` … created with O_EXCL, so an existing
  /// file is never overwritten and two adoptions never share a copy.
  static func createUnique(name: String, in inbox: URL) -> (Int32, URL)? {
    let ext = (name as NSString).pathExtension
    let base = (name as NSString).deletingPathExtension
    var candidates = [name]
    for index in 1...99 { candidates.append("\(base)-\(index).\(ext)") }
    candidates.append("\(base)-\(UUID().uuidString.prefix(8).lowercased()).\(ext)")
    for candidate in candidates {
      let destination = inbox.appendingPathComponent(candidate, isDirectory: false)
      let fd = open(destination.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
      if fd >= 0 { return (fd, destination) }
      if errno != EEXIST { return nil }
    }
    return nil
  }

  // MARK: - Adoption

  /// Coordinates a read of `url` for `accessor`. Injected so host tests can
  /// model a slow or failing iCloud download.
  public typealias Coordinate = @Sendable (_ url: URL, _ coordinator: NSFileCoordinator, _ accessor: (URL) -> Void) -> Void

  public static let fileCoordinatorRead: Coordinate = { url, coordinator, accessor in
    var error: NSError?
    coordinator.coordinate(readingItemAt: url, options: [], error: &error) { readURL in
      accessor(readURL)
    }
  }

  /// Security-scoped access, a coordinated read and a copy into `inbox`,
  /// bounded by `policy.timeout`. The calling thread waits; the work runs on
  /// a background queue, and a late finish after the deadline deletes its copy.
  public static func adopt(
    _ url: URL,
    into inbox: URL,
    forbiddenRoots: [URL],
    policy: WafraIncomingFilePolicy = WafraIncomingFilePolicy(),
    coordinate: @escaping Coordinate = fileCoordinatorRead
  ) -> URL? {
    guard url.isFileURL, url.absoluteString.hasPrefix("file:///"),
          candidate(url.absoluteString, policy: policy) != nil,
          !isInside(url.path, roots: forbiddenRoots) else { return nil }

    let state = AdoptionState()
    let done = DispatchSemaphore(value: 0)
    let displayName = url.lastPathComponent

    DispatchQueue.global(qos: .userInitiated).async {
      // Access lives exactly as long as this block: started before the read,
      // stopped after the copy (or the failure), on this same thread.
      let accessing = url.startAccessingSecurityScopedResource()
      defer {
        if accessing { url.stopAccessingSecurityScopedResource() }
        done.signal()
      }
      guard !state.isAbandoned else { return }
      coordinate(url, state.coordinator) { readURL in
        guard !state.isAbandoned else { return }
        let copy = copyValidated(
          from: readURL,
          displayName: displayName,
          into: inbox,
          forbiddenRoots: forbiddenRoots,
          policy: policy,
          isCancelled: { state.isAbandoned }
        )
        if let copy, !state.deliver(copy) {
          // The caller already gave up: leave nothing behind.
          unlink(copy.path)
        }
      }
    }

    if done.wait(timeout: .now() + policy.timeout) == .timedOut {
      if let late = state.abandon() { return late }
      // A pending coordination (an iCloud download still waiting) is
      // cancelled; a copy already under way sees `isAbandoned` and stops.
      state.coordinator.cancel()
      return nil
    }
    return state.result
  }
}

/// Shared between the waiting caller and the background read.
/// NSFileCoordinator is thread-safe; `cancel()` is meant to be called from
/// another thread than the one waiting in `coordinate`.
final class AdoptionState: @unchecked Sendable {
  let coordinator = NSFileCoordinator(filePresenter: nil)
  private let lock = NSLock()
  private var abandoned = false
  private var delivered: URL?

  var isAbandoned: Bool {
    lock.lock(); defer { lock.unlock() }
    return abandoned
  }

  var result: URL? {
    lock.lock(); defer { lock.unlock() }
    return delivered
  }

  /// False when the caller has already abandoned the adoption.
  func deliver(_ url: URL) -> Bool {
    lock.lock(); defer { lock.unlock() }
    if abandoned { return false }
    delivered = url
    return true
  }

  /// Marks the adoption abandoned, unless a copy was delivered first.
  func abandon() -> URL? {
    lock.lock(); defer { lock.unlock() }
    if let delivered { return delivered }
    abandoned = true
    return nil
  }
}

/// The file URLs iOS actually opened Wafra with, as the URL objects UIKit
/// delivered. A security-scoped URL carries its sandbox extension on that
/// object: a URL rebuilt from the string JavaScript sees has none. Only URLs
/// recorded here can be adopted, so an arbitrary file:// string cannot.
public final class WafraIncomingFileRegistry: @unchecked Sendable {
  public static let shared = WafraIncomingFileRegistry()
  static let capacity = 4

  private let lock = NSLock()
  private var urls: [URL] = []

  public init() {}

  /// Remember a handed-over statement URL (most recent last, bounded).
  public func record(_ url: URL, policy: WafraIncomingFilePolicy = WafraIncomingFilePolicy()) {
    guard url.isFileURL, WafraIncomingFileAdopter.candidate(url.absoluteString, policy: policy) != nil else { return }
    lock.lock(); defer { lock.unlock() }
    urls.removeAll { Self.same($0, url) }
    urls.append(url)
    if urls.count > Self.capacity { urls.removeFirst(urls.count - Self.capacity) }
  }

  /// The recorded URL object for `value`, removed so it is adopted once.
  public func take(_ value: String) -> URL? {
    guard let wanted = URL(string: value), wanted.isFileURL else { return nil }
    lock.lock(); defer { lock.unlock() }
    guard let index = urls.lastIndex(where: { $0.absoluteString == value || Self.same($0, wanted) }) else { return nil }
    return urls.remove(at: index)
  }

  static func same(_ a: URL, _ b: URL) -> Bool {
    WafraIncomingFileAdopter.normalized(a.path) == WafraIncomingFileAdopter.normalized(b.path)
  }
}
