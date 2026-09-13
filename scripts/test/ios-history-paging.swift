import Foundation

@main
struct PagedHistoryTests {
  enum Injected: Error { case crash }
  static let fixedNow = Date(timeIntervalSince1970: 1_788_940_800)
  static var passed = 0
  static func check(_ name: String, _ value: @autoclosure () throws -> Bool) throws {
    guard try value() else { fatalError("FAILED: \(name)") }
    passed += 1; print("PASS \(name)")
  }
  static func stamp(_ date: Date) -> String {
    let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f.string(from: date)
  }
  static func json(_ value: String) throws -> [String: Any] {
    try JSONSerialization.jsonObject(with: Data(value.utf8)) as! [String: Any]
  }
  struct Row {
    let guid: String; let date: Date; let body: String
    var encoded: String {
      let data = try! JSONSerialization.data(withJSONObject: ["guid": guid,
        "date": stamp(date), "body": body, "sender": "TEST"], options: [.sortedKeys])
      return data.base64EncodedString()
    }
  }
  static func rows(_ count: Int) -> [Row] {
    (0..<count).map { Row(guid: "synthetic-\($0)",
      date: fixedNow.addingTimeInterval(-100 - Double($0) * 0.333),
      body: "Synthetic only: \"quotes\" \\ newline\nنص تجريبي 😀 \($0)") }
  }
  static func begin(_ store: WafraPagedHistoryStore, _ rows: [Row]) throws -> [String: Any] {
    try json(store.begin(oldestGUID: rows.last!.guid, oldestDate: stamp(rows.last!.date),
      newestGUID: rows.first!.guid, newestDate: stamp(rows.first!.date)))
  }
  static func page(_ rows: [Row], _ state: [String: Any]) -> [Row] {
    let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let before = f.date(from: state["before"] as! String)!
    return Array(rows.filter { $0.date < before }.prefix(state["limit"] as! Int))
  }
  static func send(_ store: WafraPagedHistoryStore, _ state: [String: Any], _ rows: [Row]) throws -> [String: Any] {
    try json(store.stage(sessionId: state["sessionId"] as! String,
      authorizationSecret: state["authorizationSecret"] as! String,
      revision: state["revision"] as! Int, found: rows.count,
      frame: rows.map(\.encoded).joined(separator: "\n")))
  }
  static func rejected(_ name: String, _ operation: () throws -> Void) throws {
    var didThrow = false
    do { try operation() } catch { didThrow = true }
    try check(name, didThrow)
  }
  static func main() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("wafra-paging-tests-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: root) }
    let make: (String) -> WafraPagedHistoryStore = {
      WafraPagedHistoryStore(root: root.appendingPathComponent($0), now: { fixedNow })
    }
    let source = rows(10_001)
    let store = make("large")
    var state = try begin(store, source)
    let first = state
    let firstPage = page(source, state)
    state = try send(store, state, firstPage)
    try rejected("incomplete source cannot be read as filed chunks") {
      _ = try store.readChunk(sessionId: state["sessionId"] as! String, chunkIndex: 0)
    }
    let retry = try send(store, first, firstPage)
    try check("lost acknowledgement retries exactly without advancing twice",
      (retry["revision"] as! Int) == (state["revision"] as! Int))
    let savedCount = state["checked"] as! Int
    try rejected("ignored date filter cannot commit the first page again") {
      _ = try send(store, state, Array(source.prefix(state["limit"] as! Int)))
    }
    try check("rejected query retains saved progress", try json(store.status()!)["checked"] as! Int == savedCount)
    let resumedStore = make("large")
    let oldCapability = state
    state = try begin(resumedStore, source)
    try check("fresh instance resumes the saved cursor", state["checked"] as! Int == savedCount)
    try rejected("resume fences the previous runner capability") {
      _ = try send(resumedStore, oldCapability, page(source, oldCapability))
    }
    while state["status"] as! String != "complete" {
      state = try send(resumedStore, state, page(source, state))
    }
    try check("10,001 records finish without the 2,999/10,000 ceilings", state["checked"] as! Int == source.count)
    let id = state["sessionId"] as! String
    let complete = try resumedStore.completedSession(sessionId: id)!
    try rejected("a completed session cannot read beyond its exact chunk map") {
      _ = try resumedStore.readChunk(sessionId: id, chunkIndex: complete.chunkIndices.count)
    }
    try check("all records reconcile", complete.accepted == source.count && complete.skipped == 0)
    try check("source-free completed recovery returns the actual session", try resumedStore.recoverCompletedSession(startedAfter: fixedNow.addingTimeInterval(-1))?.sessionId == id)
    try check("a newer unrelated handoff does not recover an old completed session", try resumedStore.recoverCompletedSession(startedAfter: fixedNow.addingTimeInterval(1)) == nil)
    var ids = Set<String>(); var returned = 0
    for index in complete.chunkIndices {
      let values = try resumedStore.readChunk(sessionId: id, chunkIndex: index)
      try check("bounded chunk \(index)", values.count <= 50)
      for value in values {
        let row = try json(value)
        guard ids.insert(row["id"] as! String).inserted else { fatalError("duplicate identity") }
        returned += 1
      }
    }
    try check("all 10,001 identities are present exactly once", returned == source.count && ids.count == source.count)
    let firstRecord = try json(resumedStore.readChunk(sessionId: id, chunkIndex: 0)[0])
    try check("Unicode, quoting, backslashes and multiline body preserved", firstRecord["text"] as! String == source[0].body)
    try check("raw GUID is not persisted", !(try Data(contentsOf: root.appendingPathComponent("large/active/head.json"))).contains(Data(source[0].guid.utf8)))
    try resumedStore.discard(sessionId: id)
    try check("confirmed cleanup removes the staged session", try resumedStore.status() == nil)

    let sameSecond = (0..<300).map { Row(guid: "dense-\($0)", date: fixedNow.addingTimeInterval(-100), body: "synthetic") }
      + [Row(guid: "oldest", date: fixedNow.addingTimeInterval(-200), body: "synthetic")]
    let dense = make("dense"); var d = try begin(dense, sameSecond)
    while d["status"] as! String != "complete" { d = try send(dense, d, page(sameSecond, d)) }
    try check("300 messages in one second expand safely without loss", d["checked"] as! Int == 301)
    let excessive = (0..<500).map { Row(guid: "excessive-\($0)", date: fixedNow.addingTimeInterval(-100), body: "synthetic") }
    let blocked = make("blocked"); var b = try begin(blocked, excessive)
    try rejected("terminal dense second is a visible block, never false completion") {
      while b["status"] as! String != "complete" { b = try send(blocked, b, page(excessive, b)) }
    }
    try check("dense block preserves pending state", try json(blocked.status()!)["status"] as! String == "continue")

    let early = make("early"); let e = try begin(early, rows(100))
    try rejected("short/truncated page without the oldest anchor is not EOF") {
      _ = try send(early, e, Array(rows(100).prefix(10)))
    }
    try check("bad short page commits nothing", try json(early.status()!)["checked"] as! Int == 0)

    var crash = true
    let faultRoot = root.appendingPathComponent("fault")
    let faulty = WafraPagedHistoryStore(root: faultRoot, now: { fixedNow }, byteLimit: 72 * 1024 * 1024,
      beforeHeadWrite: { if crash { crash = false; throw Injected.crash } })
    let f = try begin(faulty, rows(100))
    try rejected("injected crash between page and head writes") { _ = try send(faulty, f, page(rows(100), f)) }
    let recovered = WafraPagedHistoryStore(root: faultRoot, now: { fixedNow })
    let recovery = try begin(recovered, rows(100))
    try check("reopen rolls the durable journal forward exactly once", recovery["checked"] as! Int > 0 && recovery["revision"] as! Int == 1)
    let small = WafraPagedHistoryStore(root: root.appendingPathComponent("capacity"), now: { fixedNow },
      byteLimit: 100, beforeHeadWrite: nil)
    let c = try begin(small, rows(100))
    try rejected("capacity fails before any page is committed") { _ = try send(small, c, page(rows(100), c)) }
    try check("capacity preserves the original checkpoint", try json(small.status()!)["checked"] as! Int == 0)
    // Column framing rebuilds the same line frame, so a page staged from
    // joined columns must land on exactly the cursor the row frame reaches.
    let sep = String(WafraPagedHistoryStore.columnSeparator)
    func columns(_ rows: [Row]) -> (String, String, String, String) {
      (rows.map(\.guid).joined(separator: sep), rows.map(\.body).joined(separator: sep),
       rows.map { _ in "TEST" }.joined(separator: sep), rows.map { stamp($0.date) }.joined(separator: sep))
    }
    let columnar = make("columnar"); var col = try begin(columnar, rows(100))
    let firstColumns = page(rows(100), col)
    let (g, bd, sn, dt) = columns(firstColumns)
    col = try json(columnar.stageColumns(sessionId: col["sessionId"] as! String,
      authorizationSecret: col["authorizationSecret"] as! String, revision: col["revision"] as! Int,
      found: firstColumns.count, guids: g, bodies: bd, senders: sn, dates: dt))
    let rowsStore = make("rows-reference"); var ref = try begin(rowsStore, rows(100))
    ref = try send(rowsStore, ref, page(rows(100), ref))
    try check("column framing reaches the same cursor as row framing",
      col["checked"] as! Int == ref["checked"] as! Int && col["revision"] as! Int == ref["revision"] as! Int)
    try rejected("a body containing the column sentinel is refused, never split into extra rows") {
      _ = try columnar.stageColumns(sessionId: col["sessionId"] as! String,
        authorizationSecret: col["authorizationSecret"] as! String, revision: col["revision"] as! Int,
        found: 2, guids: "a\(sep)b", bodies: "x\(sep)y\(sep)z", senders: "s\(sep)s", dates: "\(stamp(fixedNow))\(sep)\(stamp(fixedNow))")
    }
    try check("column refusal leaves the cursor untouched", try json(columnar.status()!)["checked"] as! Int == col["checked"] as! Int)
    while col["status"] as! String != "complete" {
      let next = page(rows(100), col); let (g2, b2, s2, d2) = columns(next)
      col = try json(columnar.stageColumns(sessionId: col["sessionId"] as! String,
        authorizationSecret: col["authorizationSecret"] as! String, revision: col["revision"] as! Int,
        found: next.count, guids: g2, bodies: b2, senders: "", dates: d2))
    }
    try check("column framing with a dropped sender column completes the full source", col["checked"] as! Int == 100)
    let colSession = col["sessionId"] as! String
    let colRecord = try json(columnar.readChunk(sessionId: colSession, chunkIndex: 0)[0])
    try check("column-framed body survives the round trip unchanged", colRecord["text"] as! String == rows(100)[0].body)
    try check("misaligned sender column is dropped rather than misattributed", colRecord["sender"] == nil)
    print("\(passed) paging checks passed. Synthetic host tests; Apple Messages queries and iPhone encryption are NOT certified.")
  }
}
