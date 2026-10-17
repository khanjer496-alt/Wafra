import ExpoModulesCore
import Foundation

/// The App Group the widgets and capture extensions share with the app.
private let wafraAppGroup = "group.app.wafra.ios"

/// Places a handed-over file must never be adopted from: Wafra's own data
/// container, its App Group container and its bundle. Those already belong to
/// Wafra, and a file there (an export, a database) is not a statement someone
/// shared.
func wafraIncomingFileForbiddenRoots() -> [URL] {
  var roots = [URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true), Bundle.main.bundleURL]
  if let group = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: wafraAppGroup) {
    roots.append(group)
  }
  return roots
}

/// `<Library/Caches>/IncomingStatements`: Wafra's own folder for adopted
/// copies. Not `Documents/Inbox`, which iOS lets an app read and delete but
/// not write. The statement import's cleanup sweeps this folder too
/// (clearStatementPickerCache), and Caches is never backed up.
func wafraIncomingFileInbox() -> URL? {
  FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
    .appendingPathComponent("IncomingStatements", isDirectory: true)
}

/// "Open in Wafra" for a statement iOS hands over by its original location
/// (Files, iCloud Drive) rather than as an Inbox copy. iOS only.
public class WafraIncomingFileModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WafraIncomingFile")

    // Synchronous so expo-router's redirectSystemPath can use the result at
    // launch. It runs on the JavaScript thread, never the main thread, and
    // waits at most WafraIncomingFilePolicy.timeout. Returns the new
    // `<Library/Caches>/IncomingStatements/<name>` file URL, or null.
    // Nothing is logged.
    Function("adoptExternalDocument") { (value: String) -> String? in
      let policy = WafraIncomingFilePolicy()
      guard WafraIncomingFileAdopter.candidate(value, policy: policy) != nil,
            let inbox = wafraIncomingFileInbox(),
            let url = WafraIncomingFileRegistry.shared.take(value) else { return nil }
      return WafraIncomingFileAdopter.adopt(
        url,
        into: inbox,
        forbiddenRoots: wafraIncomingFileForbiddenRoots(),
        policy: policy
      )?.absoluteString
    }
  }
}
