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
    var framed: String {
      [guid, body, "TEST", stamp(date)]
        .map { Data($0.utf8).base64EncodedString() }
        .joined(separator: "|")
    }
    /// The build 135 device shape: every Base64 field wrapped at 76 columns
    /// with CRLF, so a long body spans several transport lines.
    var wrappedFramed: String {
      func wrap(_ value: String) -> String {
        var pieces: [String] = []; var rest = Substring(value)
        while !rest.isEmpty { let end = rest.index(rest.startIndex, offsetBy: min(76, rest.count)); pieces.append(String(rest[..<end])); rest = rest[end...] }
        return pieces.joined(separator: "\r\n")
      }
      return [guid, body, "TEST", stamp(date)]
        .map { wrap(Data($0.utf8).base64EncodedString()) }
        .joined(separator: "|")
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

    let transportRows = rows(100)
    let transport = make("transport"); let transportState = try begin(transport, transportRows)
    let transportPage = page(transportRows, transportState)
    let transported = transportPage.map(\.framed).joined(separator: "\n")
    let transportResult: [String: Any]
    do {
      transportResult = try json(transport.stage(sessionId: transportState["sessionId"] as! String,
        authorizationSecret: transportState["authorizationSecret"] as! String,
        revision: transportState["revision"] as! Int, found: transportPage.count, frame: transported))
    } catch { fatalError("transport-noise failed: \(error)") }
    try check("four-field row framing accepts a valid page",
      transportResult["checked"] as! Int > 0)

    let noisy = make("transport-noise"); let noisyState = try begin(noisy, transportRows)
    let noisyPage = page(transportRows, noisyState)
    let noisyFrame = noisyPage.map(\.framed).joined(separator: "\r\n") + "\r\n"
    let noisyResult: [String: Any]
    do {
      noisyResult = try json(noisy.stage(sessionId: noisyState["sessionId"] as! String,
        authorizationSecret: noisyState["authorizationSecret"] as! String,
        revision: noisyState["revision"] as! Int, found: noisyPage.count, frame: noisyFrame))
    } catch { fatalError("transport-CRLF failed: \(error)") }
    try check("CRLF and one trailing newline from Shortcuts do not reject a valid page",
      noisyResult["checked"] as! Int == transportResult["checked"] as! Int)

    let missingGuidRows = rows(100).enumerated().map { index, row in
      index == 10 ? Row(guid: "", date: row.date, body: row.body) : row
    }
    let missingGuid = make("missing-guid"); let missingState = try begin(missingGuid, missingGuidRows)
    let missingPage = page(missingGuidRows, missingState)
    let missingResult: [String: Any]
    do {
      missingResult = try json(missingGuid.stage(sessionId: missingState["sessionId"] as! String,
        authorizationSecret: missingState["authorizationSecret"] as! String,
        revision: missingState["revision"] as! Int, found: missingPage.count,
        frame: missingPage.map(\.framed).joined(separator: "\n")))
    } catch { fatalError("missing-guid failed: \(error)") }
    try check("a row whose MessageEntity GUID is blank does not reject the whole page",
      missingResult["checked"] as! Int > 0)

    // One Message the parser could never use must not block every page behind it.
    let oversizeRows = rows(100).enumerated().map { index, row in
      index == 3 ? Row(guid: row.guid, date: row.date, body: String(repeating: "x", count: 16 * 1_024 + 1)) : row
    }
    let oversize = make("oversize-body"); let oversizeState = try begin(oversize, oversizeRows)
    let oversizePage = page(oversizeRows, oversizeState)
    let oversizeResult: [String: Any]
    do {
      oversizeResult = try json(oversize.stage(sessionId: oversizeState["sessionId"] as! String,
        authorizationSecret: oversizeState["authorizationSecret"] as! String,
        revision: oversizeState["revision"] as! Int, found: oversizePage.count,
        frame: oversizePage.map(\.framed).joined(separator: "\n")))
    } catch { fatalError("oversize-body failed: \(error)") }
    try check("a body over 16 KiB is staged as skipped instead of refusing the page",
      oversizeResult["checked"] as! Int == missingResult["checked"] as! Int && oversizeResult["skipped"] as! Int == 1)
    func refusal(_ name: String, found: Int, frame: String, matches: (Error) -> Bool) throws {
      do {
        _ = try oversize.stage(sessionId: oversizeResult["sessionId"] as! String,
          authorizationSecret: oversizeResult["authorizationSecret"] as! String,
          revision: oversizeResult["revision"] as! Int, found: found, frame: frame)
        fatalError("FAILED: \(name) was accepted")
      } catch {
        try check(name, matches(error))
      }
    }
    let lineShape: (Error) -> Bool = { ($0 as? WafraPagedHistoryStore.FrameRefusal)?.reason.hasPrefix("invalid-input-lines") == true }
    let nextRows = page(oversizeRows, oversizeResult)
    try refusal("a frame with fewer records than the page count names the observed shape",
      found: nextRows.count, frame: nextRows.dropLast().map(\.framed).joined(separator: "\n"), matches: lineShape)
    try refusal("records that run together without any separator are refused, never re-split",
      found: nextRows.count, frame: nextRows.map(\.framed).joined(separator: ""), matches: lineShape)
    var badField = nextRows.map(\.framed); badField[0] = "not*base64|" + badField[0].split(separator: "|").dropFirst().joined(separator: "|")
    try refusal("a field that is not canonical Base64 names that check",
      found: nextRows.count, frame: badField.joined(separator: "\n"), matches: { ($0 as? WafraPagedHistoryStore.Failure) == WafraPagedHistoryStore.Failure.fieldEncoding })
    var badDate = nextRows.map(\.framed)
    badDate[0] = badDate[0].split(separator: "|").dropLast().joined(separator: "|") + "|" + Data("13/09/2026 10:00".utf8).base64EncodedString()
    try refusal("a date outside the producer's instant format names that check",
      found: nextRows.count, frame: badDate.joined(separator: "\n"), matches: {
        guard let reason = ($0 as? WafraPagedHistoryStore.FrameRefusal)?.reason else { return false }
        return reason.hasPrefix("invalid-input-date bytes=") && !reason.contains("13/09/2026")
      })
    try check("named refusals leave the cursor untouched",
      try json(oversize.status()!)["checked"] as! Int == oversizeResult["checked"] as! Int)

    // Build 135 on an iPhone 16 Pro: the first page's Base64 fields arrived
    // wrapped onto several lines, so the line count disagreed with the 51
    // Messages found. Long bodies make every record span lines; the reader
    // must reassemble them by their three separators and reach exactly the
    // cursor the unwrapped frame reaches.
    let longRows = (0..<100).map { Row(guid: "long-\($0)", date: fixedNow.addingTimeInterval(-100 - Double($0) * 0.333),
      body: "Dear Customer, your card ending 1234 was used for AED 1,234.56 at MERCHANT NAME LLC DUBAI on 12/09/2026 21:22. Available limit AED 9,876.54. Call us if this was not you. Ref \($0)") }
    let wrapped = make("wrapped"); let wrappedState = try begin(wrapped, longRows)
    let wrappedPage = page(longRows, wrappedState)
    let wrappedResult: [String: Any]
    do {
      wrappedResult = try json(wrapped.stage(sessionId: wrappedState["sessionId"] as! String,
        authorizationSecret: wrappedState["authorizationSecret"] as! String,
        revision: wrappedState["revision"] as! Int, found: wrappedPage.count,
        frame: wrappedPage.map(\.wrappedFramed).joined(separator: "\r\n") + "\r\n"))
    } catch { fatalError("wrapped-frame failed: \(error)") }
    let flat = make("flat"); let flatState = try begin(flat, longRows)
    let flatResult = try json(flat.stage(sessionId: flatState["sessionId"] as! String,
      authorizationSecret: flatState["authorizationSecret"] as! String,
      revision: flatState["revision"] as! Int, found: wrappedPage.count,
      frame: wrappedPage.map(\.framed).joined(separator: "\n")))
    try check("Base64 fields wrapped across transport lines reassemble to the exact unwrapped cursor",
      wrappedResult["checked"] as! Int == flatResult["checked"] as! Int && wrappedResult["accepted"] as! Int == flatResult["accepted"] as! Int && (wrappedResult["accepted"] as! Int) > 0)

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
    try rejected("a sender column that does not line up is refused, never silently blanked for the page") {
      let next = page(rows(100), col); let (g2, b2, _, d2) = columns(next)
      _ = try columnar.stageColumns(sessionId: col["sessionId"] as! String,
        authorizationSecret: col["authorizationSecret"] as! String, revision: col["revision"] as! Int,
        found: next.count, guids: g2, bodies: b2, senders: "", dates: d2)
    }
    try rejected("a column larger than its records could carry is refused before splitting") {
      _ = try columnar.stageColumns(sessionId: col["sessionId"] as! String,
        authorizationSecret: col["authorizationSecret"] as! String, revision: col["revision"] as! Int,
        found: 1, guids: String(repeating: "g", count: 1_025), bodies: "x", senders: "s", dates: stamp(fixedNow))
    }
    while col["status"] as! String != "complete" {
      let next = page(rows(100), col); let (g2, b2, s2, d2) = columns(next)
      col = try json(columnar.stageColumns(sessionId: col["sessionId"] as! String,
        authorizationSecret: col["authorizationSecret"] as! String, revision: col["revision"] as! Int,
        found: next.count, guids: g2, bodies: b2, senders: s2, dates: d2))
    }
    try check("column framing completes the full source", col["checked"] as! Int == 100)
    let colSession = col["sessionId"] as! String
    let colRecord = try json(columnar.readChunk(sessionId: colSession, chunkIndex: 0)[0])
    try check("column-framed body survives the round trip unchanged", colRecord["text"] as! String == rows(100)[0].body)
    try check("column-framed sender survives the round trip unchanged", colRecord["sender"] as? String == "TEST")

    // Typed-row path (v4): Begin with exact instants, one staged row per
    // Message, one commit per page. No Shortcuts-formatted date text exists.
    let rowSource = rows(120)
    let rowStore = make("rows")
    func beginTyped(_ store: WafraPagedHistoryStore) throws -> [String: Any] {
      try json(store.begin(oldestGUID: rowSource.last!.guid, oldestInstant: rowSource.last!.date,
        newestGUID: rowSource.first!.guid, newestInstant: rowSource.first!.date))
    }
    func stageTyped(_ store: WafraPagedHistoryStore, _ state: [String: Any], _ row: Row, body: String? = nil) throws -> [String: Any] {
      try json(store.stageRow(sessionId: state["sessionId"] as! String,
        authorizationSecret: state["authorizationSecret"] as! String, revision: state["revision"] as! Int,
        guid: row.guid, body: body ?? row.body, sender: "TEST", instant: row.date))
    }
    func commitTyped(_ store: WafraPagedHistoryStore, _ state: [String: Any], found: Int) throws -> [String: Any] {
      try json(store.commitRows(sessionId: state["sessionId"] as! String,
        authorizationSecret: state["authorizationSecret"] as! String, revision: state["revision"] as! Int, found: found))
    }
    try rejected("typed begin refuses boundaries in the wrong order") {
      _ = try make("rows-order").begin(oldestGUID: "a", oldestInstant: fixedNow, newestGUID: "b", newestInstant: fixedNow.addingTimeInterval(-10))
    }
    var rowState = try beginTyped(rowStore)
    try check("typed begin exposes the exact newest instant as the first cursor",
      (rowState["before"] as! String) == stamp(Date(timeIntervalSince1970: floor(rowSource.first!.date.timeIntervalSince1970) + 1)))
    var rowPage = page(rowSource, rowState)
    try rejected("a commit with no staged rows is refused") { _ = try commitTyped(rowStore, rowState, found: rowPage.count) }
    for row in rowPage { _ = try stageTyped(rowStore, rowState, row) }
    let duplicate = try stageTyped(rowStore, rowState, rowPage[0])
    try check("re-staging a row of the same page is ignored, not double counted", duplicate["rows"] as! Int == rowPage.count)
    try rejected("a commit whose Shortcuts count disagrees with the staged rows is refused") {
      _ = try commitTyped(rowStore, rowState, found: rowPage.count - 1)
    }
    try check("a refused commit keeps the staged rows and cursor", try json(rowStore.status()!)["checked"] as! Int == 0)
    let firstRowState = rowState
    rowState = try commitTyped(rowStore, rowState, found: rowPage.count)
    try check("typed rows advance the cursor exactly like a text frame", rowState["revision"] as! Int == 1 && (rowState["checked"] as! Int) > 0)
    let replayed = try commitTyped(rowStore, firstRowState, found: rowPage.count)
    try check("a lost commit acknowledgement is answered with the current cursor without advancing",
      replayed["revision"] as! Int == 1 && replayed["checked"] as! Int == rowState["checked"] as! Int)
    let staleRow = try stageTyped(rowStore, firstRowState, rowPage[0])
    try check("a row for the already committed page is reported stale", staleRow["status"] as! String == "stale")
    rowPage = page(rowSource, rowState)
    let oversized = String(repeating: "x", count: 16 * 1024 + 1)
    _ = try stageTyped(rowStore, rowState, rowPage[0], body: oversized)
    for row in rowPage.dropFirst() { _ = try stageTyped(rowStore, rowState, row) }
    rowState = try commitTyped(rowStore, rowState, found: rowPage.count)
    try check("an oversized body is staged as skipped without refusing the page", (rowState["skipped"] as! Int) >= 1)
    let resumedRows = make("rows")
    let resumedRowState = try beginTyped(resumedRows)
    try check("typed begin resumes the saved cursor", resumedRowState["checked"] as! Int == rowState["checked"] as! Int)
    rowState = resumedRowState
    while rowState["status"] as! String != "complete" {
      rowPage = page(rowSource, rowState)
      for row in rowPage { _ = try stageTyped(resumedRows, rowState, row) }
      rowState = try commitTyped(resumedRows, rowState, found: rowPage.count)
    }
    try check("typed rows complete the full source", rowState["checked"] as! Int == rowSource.count)
    // Apple returns a blank GUID for some real-device rows: the typed path must
    // derive the same local identity `preparedRow` does and keep the page whole.
    let blankSource = rows(60)
    let blankStore = make("rows-blank-guid")
    var blankState = try json(blankStore.begin(oldestGUID: blankSource.last!.guid, oldestInstant: blankSource.last!.date,
      newestGUID: blankSource.first!.guid, newestInstant: blankSource.first!.date))
    var blankPage = page(blankSource, blankState)
    for (index, row) in blankPage.enumerated() {
      _ = try json(blankStore.stageRow(sessionId: blankState["sessionId"] as! String,
        authorizationSecret: blankState["authorizationSecret"] as! String, revision: blankState["revision"] as! Int,
        guid: index == 3 ? "" : row.guid, body: row.body, sender: "TEST", instant: row.date))
    }
    let blankDuplicate = try json(blankStore.stageRow(sessionId: blankState["sessionId"] as! String,
      authorizationSecret: blankState["authorizationSecret"] as! String, revision: blankState["revision"] as! Int,
      guid: "", body: blankPage[3].body, sender: "TEST", instant: blankPage[3].date))
    try check("a re-staged blank-GUID row is recognised by its derived identity", blankDuplicate["rows"] as! Int == blankPage.count)
    blankState = try commitTyped(blankStore, blankState, found: blankPage.count)
    // A full page withholds its final second as overlap, so compare the
    // committed count with what the same page commits when every GUID is set.
    let controlStore = make("rows-control")
    var controlState = try json(controlStore.begin(oldestGUID: blankSource.last!.guid, oldestInstant: blankSource.last!.date,
      newestGUID: blankSource.first!.guid, newestInstant: blankSource.first!.date))
    for row in page(blankSource, controlState) {
      _ = try controlStore.stageRow(sessionId: controlState["sessionId"] as! String,
        authorizationSecret: controlState["authorizationSecret"] as! String, revision: controlState["revision"] as! Int,
        guid: row.guid, body: row.body, sender: "TEST", instant: row.date)
    }
    controlState = try commitTyped(controlStore, controlState, found: page(blankSource, controlState).count)
    try check("a blank-GUID row is staged under a derived identity instead of stalling the page",
      blankState["revision"] as! Int == 1 && blankState["checked"] as! Int == controlState["checked"] as! Int)
    // A row refusal is named on the commit's alert, since the Shortcut only sees the commit.
    blankPage = page(blankSource, blankState)
    for row in blankPage.dropFirst() {
      _ = try blankStore.stageRow(sessionId: blankState["sessionId"] as! String,
        authorizationSecret: blankState["authorizationSecret"] as! String, revision: blankState["revision"] as! Int,
        guid: row.guid, body: row.body, sender: "TEST", instant: row.date)
    }
    try rejected("a row with an invalid date is refused") {
      _ = try blankStore.stageRow(sessionId: blankState["sessionId"] as! String,
        authorizationSecret: blankState["authorizationSecret"] as! String, revision: blankState["revision"] as! Int,
        guid: blankPage[0].guid, body: blankPage[0].body, sender: "TEST", instant: Date(timeIntervalSince1970: -5))
    }
    var namedReason = ""
    do { _ = try commitTyped(blankStore, blankState, found: blankPage.count) }
    catch let refusal as WafraPagedHistoryStore.FrameRefusal { namedReason = refusal.reason }
    try check("the commit refusal names the last row refusal", namedReason.contains("invalid-input-rows") && namedReason.contains("last-row=invalid-input-date"))
    // An interrupted commit cannot leak its rows into the next page: buffers are revision-named.
    let leakStore = make("rows-blank-guid")
    let leakState = try json(leakStore.begin(oldestGUID: blankSource.last!.guid, oldestInstant: blankSource.last!.date,
      newestGUID: blankSource.first!.guid, newestInstant: blankSource.first!.date))
    try check("a new run starts from an empty row buffer",
      try json(leakStore.stageRow(sessionId: leakState["sessionId"] as! String,
        authorizationSecret: leakState["authorizationSecret"] as! String, revision: leakState["revision"] as! Int,
        guid: blankPage[0].guid, body: blankPage[0].body, sender: "TEST", instant: blankPage[0].date))["rows"] as! Int == 1)
    let rowRecord = try json(resumedRows.readChunk(sessionId: rowState["sessionId"] as! String, chunkIndex: 0)[0])
    try check("typed-row body survives the round trip unchanged", rowRecord["text"] as! String == rowSource[0].body)
    // Windowed queries (v6): every response carries `after`, the exclusive lower
    // bound of the next query, at most 90 days behind `before` and never past
    // the oldest anchor. An empty or short window advances the cursor; only a
    // window that reaches the anchor can complete.
    let day: TimeInterval = 86_400
    // 220 rows: a dense recent month, a 400-day silence, then a sparse old year.
    var windowSource: [Row] = (0..<120).map { Row(guid: "recent-\($0)", date: fixedNow.addingTimeInterval(-Double($0) * 3_600), body: "recent \($0)") }
    windowSource += (0..<100).map { Row(guid: "old-\($0)", date: fixedNow.addingTimeInterval(-430 * day - Double($0) * 3 * day), body: "old \($0)") }
    let windowStore = make("windows")
    var windowState = try json(windowStore.begin(oldestGUID: windowSource.last!.guid, oldestInstant: windowSource.last!.date,
      newestGUID: windowSource.first!.guid, newestInstant: windowSource.first!.date))
    func windowPage(_ rows: [Row], _ state: [String: Any]) throws -> [Row] {
      let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
      let before = f.date(from: state["before"] as! String)!
      try check("every continue response carries a window start", state["after"] is String)
      let after = f.date(from: state["after"] as! String)!
      try check("the window never exceeds 90 days", before.timeIntervalSince(after) <= 90 * day + 1)
      return Array(rows.filter { $0.date < before && $0.date > after }.sorted { $0.date > $1.date }.prefix(state["limit"] as! Int))
    }
    var windowsSeen = 0; var emptyWindows = 0
    while windowState["status"] as! String != "complete" {
      let rowsInWindow = try windowPage(windowSource, windowState)
      if rowsInWindow.isEmpty { emptyWindows += 1 }
      for row in rowsInWindow {
        _ = try windowStore.stageRow(sessionId: windowState["sessionId"] as! String,
          authorizationSecret: windowState["authorizationSecret"] as! String, revision: windowState["revision"] as! Int,
          guid: row.guid, body: row.body, sender: "TEST", instant: row.date)
      }
      windowState = try commitTyped(windowStore, windowState, found: rowsInWindow.count)
      windowsSeen += 1
      try check("windowed run stays bounded", windowsSeen < 200)
    }
    try check("windowed run crosses a 400-day silence with empty windows and completes", emptyWindows >= 3 && windowState["checked"] as! Int == windowSource.count)
    try check("a completed windowed session no longer advertises a window", windowState["after"] == nil)
    let windowRecords = try (0..<(try windowStore.completedSession(sessionId: windowState["sessionId"] as! String)!.chunkIndices.count)).flatMap {
      try windowStore.readChunk(sessionId: windowState["sessionId"] as! String, chunkIndex: $0)
    }
    try check("windowed run commits every row exactly once", Set(windowRecords.map { try! json($0)["id"] as! String }).count == windowSource.count && windowRecords.count == windowSource.count)
    // A date-range refusal must name which bound broke and the instants involved
    // (dates only, never text), so one screenshot of the Shortcut's alert settles
    // a device report; the bare code "wrong-date-range" did not (tester iPhone,
    // 20 Sep 2026, 1,285 messages in).
    func rangeDetail(_ name: String, _ operation: () throws -> Void) throws -> String {
      do { try operation() } catch let violation as WafraHistoryCursor.RangeViolation {
        try check("\(name): reason code is unchanged", violation.reason == .wrongDateRange)
        return violation.message
      }
      try check("\(name): a detailed range violation was thrown", false); return ""
    }
    let iso = ISO8601DateFormatter(); iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    do {
      let fresh = make("windows-edge")
      let s = try json(fresh.begin(oldestGUID: windowSource.last!.guid, oldestInstant: windowSource.last!.date,
        newestGUID: windowSource.first!.guid, newestInstant: windowSource.first!.date))
      let edge = iso.date(from: s["after"] as! String)!
      let message = try rangeDetail("row at the window start") {
        _ = try fresh.stageRow(sessionId: s["sessionId"] as! String, authorizationSecret: s["authorizationSecret"] as! String,
          revision: s["revision"] as! Int, guid: windowSource.first!.guid, body: "x", sender: "TEST", instant: windowSource.first!.date)
        _ = try fresh.stageRow(sessionId: s["sessionId"] as! String, authorizationSecret: s["authorizationSecret"] as! String,
          revision: s["revision"] as! Int, guid: "edge", body: "x", sender: "TEST", instant: edge)
        _ = try commitTyped(fresh, s, found: 2)
      }
      try check("a row at the window start names the window start and the row's instant",
        message.hasPrefix("wrong-date-range; ") && message.contains("window start") && message.contains("row 2/2") &&
        message.contains(stamp(edge)) && message.contains("after=" + stamp(edge)) && message.contains("before="))
    }
    do {
      let fresh = make("windows-cursor")
      let s = try json(fresh.begin(oldestGUID: windowSource.last!.guid, oldestInstant: windowSource.last!.date,
        newestGUID: windowSource.first!.guid, newestInstant: windowSource.first!.date))
      let late = iso.date(from: s["before"] as! String)!
      let message = try rangeDetail("row at the cursor") {
        _ = try fresh.stageRow(sessionId: s["sessionId"] as! String, authorizationSecret: s["authorizationSecret"] as! String,
          revision: s["revision"] as! Int, guid: "late", body: "x", sender: "TEST", instant: late)
        _ = try commitTyped(fresh, s, found: 1)
      }
      try check("a row not before the cursor names the cursor and the row's instant",
        message.contains("not before the cursor") && message.contains("row 1/1") && message.contains(stamp(late)))
    }
    try rejected("a row outside the issued window is refused") {
      let fresh = make("windows-outside")
      let s = try json(fresh.begin(oldestGUID: windowSource.last!.guid, oldestInstant: windowSource.last!.date,
        newestGUID: windowSource.first!.guid, newestInstant: windowSource.first!.date))
      _ = try fresh.stageRow(sessionId: s["sessionId"] as! String, authorizationSecret: s["authorizationSecret"] as! String,
        revision: s["revision"] as! Int, guid: "old-5", body: "x", sender: "TEST", instant: windowSource[125].date)
      _ = try commitTyped(fresh, s, found: 1)
    }
    print("\(passed) paging checks passed. Synthetic host tests; Apple Messages queries and iPhone encryption are NOT certified.")
  }
}
