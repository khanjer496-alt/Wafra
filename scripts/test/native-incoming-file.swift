import Darwin
import Foundation

// Host tests for modules/wafra-incoming-file/ios/WafraIncomingFileAdopter.swift:
// validation, sanitising, unique naming, the size cap, symlinks, directories,
// the bounded wait and the URL registry, against real temporary files.

var failures = 0
var passes = 0

func check(_ condition: @autoclosure () -> Bool, _ message: String, line: Int = #line) {
  if condition() {
    passes += 1
  } else {
    failures += 1
    FileHandle.standardError.write("FAIL line \(line): \(message)\n".data(using: .utf8)!)
  }
}

let fm = FileManager.default
let scratch = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
  .appendingPathComponent("wafra-incoming-file-\(UUID().uuidString)", isDirectory: true)
try! fm.createDirectory(at: scratch, withIntermediateDirectories: true)

let outside = scratch.appendingPathComponent("iCloud Drive/Downloads", isDirectory: true)
let container = scratch.appendingPathComponent("Container", isDirectory: true)
let inbox = container.appendingPathComponent("Library/Caches/IncomingStatements", isDirectory: true)
try! fm.createDirectory(at: outside, withIntermediateDirectories: true)
try! fm.createDirectory(at: container.appendingPathComponent("Documents"), withIntermediateDirectories: true)
let roots = [container]
let policy = WafraIncomingFilePolicy()

@discardableResult
func write(_ name: String, bytes: Int = 64, in directory: URL = outside) -> URL {
  let url = directory.appendingPathComponent(name)
  let data = Data((0..<bytes).map { UInt8($0 % 251) })
  try! data.write(to: url)
  return url
}

func inboxNames() -> [String] {
  ((try? fm.contentsOfDirectory(atPath: inbox.path)) ?? []).sorted()
}

func copy(_ url: URL, policy: WafraIncomingFilePolicy = policy, display: String? = nil) -> URL? {
  WafraIncomingFileAdopter.copyValidated(
    from: url, displayName: display ?? url.lastPathComponent, into: inbox, forbiddenRoots: roots, policy: policy)
}

// MARK: candidate URLs (no file-system access)

for good in ["file:///private/var/mobile/Library/Mobile%20Documents/com~apple~CloudDocs/Downloads/fab-files-test.pdf",
             "file:///var/mobile/x/Card%20Sep.CSV", "file:///a/b.ofx", "file:///a/b.qfx", "file:///a/b.qif",
             "file:///a/b.sta", "file:///a/b.mt940", "file:///a/b.940", "file:///a/b.tsv", "file:///a/b.xlsx",
             "file:///a/%D9%83%D8%B4%D9%81.pdf"] {
  check(WafraIncomingFileAdopter.candidate(good, policy: policy) != nil, "accepts \(good)")
}
for bad in ["https://example.com/a.pdf", "file://evil.example/a.pdf", "file:/a/b.pdf", "file:///a/b.docx",
            "file:///a/b.pdf.exe", "file:///a/b", "file:///a/.pdf", "file:///a/b.pdf?x=1", "file:///a/b.pdf#f",
            "file:///a/../b.pdf", "file:///a/./b.pdf", "file:///a//b.pdf", "file:///a/x%2F..%2F..%2Fb.pdf",
            "file:///a/b.p%64f.", "", "file:///" + String(repeating: "a/", count: 2100) + "b.pdf", "wafra://x.pdf",
            "file:///a/b.xml", "file:///a/b.zip", "file:///a/x%5Cb.pdf", "file:///a/nul%00.pdf", "file:///a/line%0A.pdf",
            "file:///a/x%2fb.pdf"] {
  check(WafraIncomingFileAdopter.candidate(bad, policy: policy) == nil, "refuses \(bad)")
}

// MARK: containment

let home = URL(fileURLWithPath: "/var/mobile/Containers/Data/Application/0A1B", isDirectory: true)
check(WafraIncomingFileAdopter.isInside("/private/var/mobile/Containers/Data/Application/0A1B/Documents/x.pdf", roots: [home]),
      "/private/var spelling is inside /var root")
check(WafraIncomingFileAdopter.isInside("/var/mobile/Containers/Data/Application/0A1B", roots: [home]), "the root itself")
check(!WafraIncomingFileAdopter.isInside("/var/mobile/Containers/Data/Application/0A1BC/x.pdf", roots: [home]),
      "a sibling sharing a prefix is outside")
check(!WafraIncomingFileAdopter.isInside("/private/var/mobile/Library/Mobile Documents/x.pdf", roots: [home]), "iCloud is outside")
check(WafraIncomingFileAdopter.isInside("/anything.pdf", roots: [URL(fileURLWithPath: "/")]), "a / root fails closed")

// MARK: name sanitising

let names: [(String, String?)] = [
  ("Card Sep 2026.PDF", "Card Sep 2026.pdf"),
  ("fab-files-test.pdf", "fab-files-test.pdf"),
  ("كشف حساب.xlsx", "كشف حساب.xlsx"),
  ("a:b?c#d%e*f|g\"h<i>j.csv", "a_b_c_d_e_f_g_h_i_j.csv"),
  ("\u{202E}fdp.exe.ofx", "fdp.exe.ofx"),
  ("tab\there\nnew.qif", "tab_here_new.qif"),
  ("___.pdf", "statement.pdf"),
  ("  .pdf", "statement.pdf"),
  (".hidden.pdf", nil),
  ("statement.docx", nil),
  ("statement", nil),
  ("statement.pdf.exe", nil),
]
for (input, expected) in names {
  let actual = WafraIncomingFileAdopter.sanitizedName(input, policy: policy)
  check(actual == expected, "sanitise \(input.debugDescription) -> \(String(describing: actual)), want \(String(describing: expected))")
}
let long = WafraIncomingFileAdopter.sanitizedName(String(repeating: "ب", count: 300) + ".pdf", policy: policy)!
check(long.hasSuffix(".pdf") && long.utf8.count <= 184 && !long.contains("/"), "a long name is bounded and keeps its extension")

// MARK: copying

let original = write("Card Sep 2026.pdf", bytes: 150_000)
let first = copy(original)
check(first != nil, "a regular statement is copied")
if let first {
  check(first.deletingLastPathComponent().standardizedFileURL.path == inbox.standardizedFileURL.path, "the copy is directly in the adopter folder")
  check(first.lastPathComponent == "Card Sep 2026.pdf", "the copy keeps a readable name")
  check((try? Data(contentsOf: first)) == (try? Data(contentsOf: original)), "the bytes are identical")
  check(fm.fileExists(atPath: original.path), "the original is left where it was")
  let mode = ((try? fm.attributesOfItem(atPath: first.path))?[.posixPermissions] as? NSNumber)?.intValue
  check(mode == 0o600, "the copy is owner-only")
  check((try? first.resourceValues(forKeys: [.isExcludedFromBackupKey]))?.isExcludedFromBackup == true,
        "the copy is excluded from backup")
  check(first.absoluteString.hasPrefix("file:///") && first.absoluteString.hasSuffix("/Library/Caches/IncomingStatements/Card%20Sep%202026.pdf"),
        "the returned URL is a strict, percent-encoded file URL")
}
let second = copy(original)
let third = copy(original)
check(second?.lastPathComponent == "Card Sep 2026-1.pdf", "a second copy gets a unique name")
check(third?.lastPathComponent == "Card Sep 2026-2.pdf", "a third copy gets the next unique name")
check(inboxNames() == ["Card Sep 2026-1.pdf", "Card Sep 2026-2.pdf", "Card Sep 2026.pdf"], "no copy overwrote another")

let weird = write("weird.csv")
check(copy(weird, display: "a:b?c.csv")?.lastPathComponent == "a_b_c.csv", "the copy's name is sanitised")
check(copy(write("upper.OFX"))?.lastPathComponent == "upper.ofx", "the extension is normalised to lower case")

// Disallowed extension: by the source and by the display name.
check(copy(write("notes.docx")) == nil, "a .docx is refused")
check(copy(write("renamed.pdf"), display: "renamed.docx") == nil, "a display name without a statement extension is refused")
check(copy(write("renamed2.docx"), display: "renamed2.pdf") == nil, "a source without a statement extension is refused")

// Size cap, inclusive.
let small = WafraIncomingFilePolicy(maxBytes: 100)
check(copy(write("exact.csv", bytes: 100), policy: small) != nil, "a file at the cap is copied")
let before = inboxNames()
check(copy(write("over.csv", bytes: 101), policy: small) == nil, "a file over the cap is refused")
check(copy(write("empty.csv", bytes: 0)) == nil, "an empty file is refused")
check(inboxNames() == before, "a refused file leaves nothing in Inbox")
check(WafraIncomingFilePolicy.defaultMaxBytes == 10 * 1024 * 1024, "the default cap is 10 MB")

// Symlinks: the file itself, and a parent that resolves into the container.
let target = write("target.pdf")
let link = outside.appendingPathComponent("link.pdf")
try! fm.createSymbolicLink(at: link, withDestinationURL: target)
check(copy(link) == nil, "a symlinked statement is refused")
let secret = write("secret.pdf", in: container.appendingPathComponent("Documents"))
let tunnel = outside.appendingPathComponent("tunnel", isDirectory: true)
try! fm.createSymbolicLink(at: tunnel, withDestinationURL: container.appendingPathComponent("Documents"))
check(copy(tunnel.appendingPathComponent("secret.pdf")) == nil, "a path that resolves into the app container is refused")
check(copy(secret) == nil, "a file inside the app container is refused")
// After open, the descriptor's real location is checked again (a parent
// folder swapped for a symlink after the resolve check is still caught).
let throughTunnel = open(tunnel.appendingPathComponent("secret.pdf").path, O_RDONLY | O_NOFOLLOW)
check(throughTunnel >= 0, "fixture: open through the symlinked parent")
if throughTunnel >= 0 {
  let real = WafraIncomingFileAdopter.openedPath(throughTunnel)
  check(real.map { WafraIncomingFileAdopter.isInside($0, roots: roots) } == true,
        "F_GETPATH reports the container location behind a symlinked parent")
  close(throughTunnel)
}
check(inboxNames() == before, "symlinks and container files leave nothing in Inbox")

// Directories and FIFOs named like statements.
try! fm.createDirectory(at: outside.appendingPathComponent("folder.pdf"), withIntermediateDirectories: false)
check(copy(outside.appendingPathComponent("folder.pdf")) == nil, "a directory is refused")
let fifo = outside.appendingPathComponent("pipe.csv")
check(mkfifo(fifo.path, 0o600) == 0, "fixture fifo")
check(copy(fifo) == nil, "a FIFO is refused without blocking")
check(copy(outside.appendingPathComponent("missing.pdf")) == nil, "a missing file is refused")

// An Inbox that is not a directory fails closed.
let blocked = scratch.appendingPathComponent("Blocked/Documents/Inbox")
try! fm.createDirectory(at: blocked.deletingLastPathComponent(), withIntermediateDirectories: true)
try! Data("x".utf8).write(to: blocked)
check(WafraIncomingFileAdopter.copyValidated(from: original, displayName: "x.pdf", into: blocked,
                                             forbiddenRoots: roots, policy: policy) == nil,
      "an Inbox path that is a file is refused")

// MARK: adoption (coordination and the bounded wait)

let adoptSource = write("adopt me.ofx", bytes: 2048)
let adopted = WafraIncomingFileAdopter.adopt(adoptSource, into: inbox, forbiddenRoots: roots, policy: policy)
check(adopted?.lastPathComponent == "adopt me.ofx", "a real NSFileCoordinator read adopts the file")
check(adopted.map { (try? Data(contentsOf: $0)) == (try? Data(contentsOf: adoptSource)) } == true, "adopted bytes match")

final class Counter: @unchecked Sendable {
  private let lock = NSLock()
  private var value = 0
  func bump() { lock.lock(); value += 1; lock.unlock() }
  var count: Int { lock.lock(); defer { lock.unlock() }; return value }
}

let calls = Counter()
let counting: WafraIncomingFileAdopter.Coordinate = { url, _, accessor in
  calls.bump()
  accessor(url)
}
check(WafraIncomingFileAdopter.adopt(secret, into: inbox, forbiddenRoots: roots, coordinate: counting) == nil,
      "a URL inside the container is refused")
check(WafraIncomingFileAdopter.adopt(write("plain.docx"), into: inbox, forbiddenRoots: roots, coordinate: counting) == nil,
      "a disallowed extension is refused")
check(WafraIncomingFileAdopter.adopt(URL(string: "https://example.com/a.pdf")!, into: inbox, forbiddenRoots: roots,
                                     coordinate: counting) == nil, "a non-file URL is refused")
check(calls.count == 0, "refused URLs are never read")

let failing: WafraIncomingFileAdopter.Coordinate = { _, _, _ in }
check(WafraIncomingFileAdopter.adopt(write("offline.pdf"), into: inbox, forbiddenRoots: roots, coordinate: failing) == nil,
      "a coordinated read that fails (no accessor call) returns nil")

let beforeSlow = inboxNames()
let slow: WafraIncomingFileAdopter.Coordinate = { url, _, accessor in
  Thread.sleep(forTimeInterval: 1.0)
  accessor(url)
}
let started = Date()
let timedOut = WafraIncomingFileAdopter.adopt(write("slow.pdf"), into: inbox, forbiddenRoots: roots,
                                              policy: WafraIncomingFilePolicy(timeout: 0.2), coordinate: slow)
let waited = Date().timeIntervalSince(started)
check(timedOut == nil, "a read slower than the bound returns nil")
check(waited < 0.8, "the caller waited about the bound, not the whole read (\(waited)s)")
Thread.sleep(forTimeInterval: 1.5)
check(inboxNames() == beforeSlow, "a read that finishes after the deadline leaves no copy behind")

// A real coordinator blocked by another writer is cancelled at the deadline.
let contested = write("contested.csv")
let writerHolding = DispatchSemaphore(value: 0)
let releaseWriter = DispatchSemaphore(value: 0)
DispatchQueue.global().async {
  var error: NSError?
  NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: contested, options: [], error: &error) { _ in
    writerHolding.signal()
    _ = releaseWriter.wait(timeout: .now() + 5)
  }
}
writerHolding.wait()
let blockedStart = Date()
let blockedResult = WafraIncomingFileAdopter.adopt(contested, into: inbox, forbiddenRoots: roots,
                                                   policy: WafraIncomingFilePolicy(timeout: 0.3))
check(blockedResult == nil, "a coordinated read that cannot start in time returns nil")
check(Date().timeIntervalSince(blockedStart) < 1.5, "the blocked read is bounded")
releaseWriter.signal()
Thread.sleep(forTimeInterval: 0.5)
check(!inboxNames().contains("contested.csv"), "the cancelled read never copies")

// MARK: registry

let registry = WafraIncomingFileRegistry()
let iCloud = URL(fileURLWithPath: "/private/var/mobile/Library/Mobile Documents/com~apple~CloudDocs/Downloads/fab-files-test.pdf")
registry.record(iCloud)
check(registry.take("file:///var/mobile/Library/Mobile%20Documents/com~apple~CloudDocs/Downloads/other.pdf") == nil,
      "an unrecorded URL is not adoptable")
check(registry.take(iCloud.absoluteString) != nil, "the recorded URL is found by its string")
check(registry.take(iCloud.absoluteString) == nil, "a recorded URL is taken once")
registry.record(iCloud)
check(registry.take("file:///var/mobile/Library/Mobile%20Documents/com~apple~CloudDocs/Downloads/fab-files-test.pdf") != nil,
      "the /var spelling finds the /private/var URL")
registry.record(URL(fileURLWithPath: "/var/mobile/a.docx"))
check(registry.take("file:///var/mobile/a.docx") == nil, "a non-statement URL is never recorded")
registry.record(URL(string: "https://example.com/a.pdf")!)
check(registry.take("https://example.com/a.pdf") == nil, "a web URL is never recorded")
for index in 0..<6 { registry.record(URL(fileURLWithPath: "/var/mobile/f\(index).pdf")) }
check(registry.take("file:///var/mobile/f0.pdf") == nil && registry.take("file:///var/mobile/f1.pdf") == nil,
      "the registry is bounded, oldest first")
check(registry.take("file:///var/mobile/f5.pdf") != nil, "recent URLs are kept")

try? fm.removeItem(at: scratch)
if failures > 0 {
  FileHandle.standardError.write("native-incoming-file: \(failures) failed, \(passes) passed\n".data(using: .utf8)!)
  exit(1)
}
print("native-incoming-file: \(passes) checks passed")
