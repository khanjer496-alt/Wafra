import XCTest
import StoreKitTest

struct StepFail: Error, CustomStringConvertible {
    let description: String
    init(_ d: String) { description = d }
}

/// App purchase path through Superwall + StoreKit, against a local StoreKit test session (no Apple account).
/// Every step records PASS/FAIL to results and never aborts the next one.
final class PurchaseUITests: XCTestCase {
    let env = ProcessInfo.processInfo.environment
    var shotsDir: String { env["SHOTS_DIR"] ?? "/tmp/purchase-shots" }
    var hsDir: String { env["HANDSHAKE_DIR"] ?? "/tmp/purchase-hs" }
    var session: SKTestSession!
    let app = XCUIApplication(bundleIdentifier: "app.wafra.ios")

    override func setUpWithError() throws {
        continueAfterFailure = true
        try? FileManager.default.createDirectory(atPath: shotsDir, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(atPath: hsDir, withIntermediateDirectories: true)
        let path = env["STOREKIT_CONFIG"] ?? ""
        session = try SKTestSession(contentsOf: URL(fileURLWithPath: path))
        session.resetToDefaultState()
        session.clearTransactions()
        session.disableDialogs = true
        session.locale = Locale(identifier: "en_US")
        session.storefront = "USA"
        note("StoreKit test session created from \(path)")
    }

    // MARK: helpers
    func note(_ s: String) {
        let line = "\(Date()) \(s)\n"
        if let h = FileHandle(forWritingAtPath: shotsDir + "/purchase-notes.log") { h.seekToEndOfFile(); h.write(line.data(using: .utf8)!); try? h.close() }
        else { try? line.write(toFile: shotsDir + "/purchase-notes.log", atomically: true, encoding: .utf8) }
    }
    func shot(_ name: String) {
        let s = XCUIScreen.main.screenshot()
        try? s.pngRepresentation.write(to: URL(fileURLWithPath: "\(shotsDir)/\(name).png"))
        let a = XCTAttachment(screenshot: s); a.lifetime = .keepAlways; add(a)
    }
    func record(_ id: String, _ ok: Bool, _ detail: String) {
        let line = "\(id)\t\(ok ? "PASS" : "FAIL")\t\(detail.replacingOccurrences(of: "\n", with: " "))\n"
        let path = shotsDir + "/purchase-results.tsv"
        if let h = FileHandle(forWritingAtPath: path) { h.seekToEndOfFile(); h.write(line.data(using: .utf8)!); try? h.close() }
        else { try? line.write(toFile: path, atomically: true, encoding: .utf8) }
    }
    func step(_ id: String, _ body: () throws -> String) {
        do { record(id, true, try body()) }
        catch { shot("\(id)-FAILED"); record(id, false, "\(error)") }
    }
    func el(_ id: String) -> XCUIElement { app.descendants(matching: .any).matching(identifier: id).firstMatch }
    func need(_ e: XCUIElement, _ what: String, _ t: TimeInterval = 30) throws {
        if !e.waitForExistence(timeout: t) { throw StepFail("not found within \(Int(t))s: \(what)") }
    }
    func waitGone(_ e: XCUIElement, _ what: String, _ t: TimeInterval) throws {
        let end = Date().addingTimeInterval(t)
        while Date() < end { if !e.exists { return }; Thread.sleep(forTimeInterval: 1) }
        throw StepFail("still present after \(Int(t))s: \(what)")
    }

    /// Fresh process, past onboarding with sample data (first run only), on the Pro screen.
    func openPro(onboard: Bool) throws {
        app.launch()
        if onboard {
            let start = app.buttons["Start with sample data"]
            if start.waitForExistence(timeout: 90) { start.tap() }
        }
        let settings = app.buttons["Settings"].firstMatch
        try need(settings, "Settings button on Home", 90)
        settings.tap()
        let card = el("settings-pro-card")
        try need(card, "settings-pro-card", 20)
        card.tap()
        try need(el("pro-screen"), "pro-screen", 20)
    }
    func requestHostReinstall(_ n: Int) throws {
        app.terminate()
        try? "go".write(toFile: "\(hsDir)/reinstall-\(n).request", atomically: true, encoding: .utf8)
        let end = Date().addingTimeInterval(240)
        while Date() < end {
            if FileManager.default.fileExists(atPath: "\(hsDir)/reinstall-\(n).done") { return }
            Thread.sleep(forTimeInterval: 1)
        }
        throw StepFail("host did not complete reinstall #\(n)")
    }
    /// Makes the store's next purchases fail as "the user cancelled" (nil restores normal behaviour).
    func simulatePurchaseCancel(_ on: Bool) throws {
        let sem = DispatchSemaphore(value: 0)
        var failure: Error?
        let s = session!
        Task.detached {
            do { try await s.setSimulatedError(on ? SKTestFailures.Purchase.generic(.userCancelled) : nil, forAPI: .purchase) }
            catch let e { failure = e }
            sem.signal()
        }
        sem.wait()
        if let failure = failure { throw failure }
    }
    var entitled: Bool { !el("pro-buy").exists && !el("pro-plans").exists }

    // MARK: the flow
    func testPurchaseFlow() throws {
        // P1: /pro lists both plans with prices (fresh install, nothing bought)
        step("P1") {
            try openPro(onboard: true)
            let weekly = el("pro-plan-weekly"), yearly = el("pro-plan-yearly")
            try need(weekly, "weekly plan row", 60); try need(yearly, "yearly plan row", 10)
            shot("P1-pro-lists-both-plans")
            guard weekly.label.contains("4.99") else { throw StepFail("weekly row has no 4.99: '\(weekly.label)'") }
            guard yearly.label.contains("49.99") else { throw StepFail("yearly row has no 49.99: '\(yearly.label)'") }
            return "weekly '\(weekly.label)' / yearly '\(yearly.label)'"
        }

        // P5: a cancelled purchase leaves Pro off (done first: it needs the not-entitled state)
        step("P5") {
            try simulatePurchaseCancel(true)
            defer { try? simulatePurchaseCancel(false) }
            try need(el("pro-plan-weekly"), "weekly row", 10)
            el("pro-plan-weekly").tap()
            try need(el("pro-buy"), "buy button", 10)
            el("pro-buy").tap()
            Thread.sleep(forTimeInterval: 12)
            shot("P5-after-cancelled-purchase")
            guard el("pro-buy").exists, el("pro-plans").exists else { throw StepFail("Pro looks unlocked after a cancelled purchase") }
            guard session.allTransactions().isEmpty else { throw StepFail("a transaction exists after cancel: \(session.allTransactions().count)") }
            return "plans and buy button still shown; 0 transactions"
        }
        try? simulatePurchaseCancel(false)

        // P2: buy weekly, Pro unlocks
        step("P2") {
            try need(el("pro-plan-weekly"), "weekly row", 10)
            el("pro-plan-weekly").tap()
            try need(el("pro-buy"), "buy button", 10)
            shot("P2a-before-buying-weekly")
            el("pro-buy").tap()
            try waitGone(el("pro-plans"), "plan list after buying weekly", 90)
            shot("P2b-after-buying-weekly-pro-unlocked")
            let tx = session.allTransactions()
            guard tx.contains(where: { $0.productIdentifier == "wafra_pro_weekly" }) else { throw StepFail("no weekly transaction in the test session") }
            return "plan list gone (Pro active); store has \(tx.count) weekly transaction(s)"
        }

        // P3: delete + reinstall, Restore brings Pro back
        step("P3") {
            try requestHostReinstall(1)
            app.launch()
            let start = app.buttons["Start with sample data"]
            if start.waitForExistence(timeout: 90) { start.tap() }
            try need(app.buttons["Settings"].firstMatch, "Home after reinstall", 90)
            app.buttons["Settings"].firstMatch.tap()
            try need(el("settings-pro-card"), "settings-pro-card", 20)
            el("settings-pro-card").tap()
            try need(el("pro-screen"), "pro-screen", 20)
            Thread.sleep(forTimeInterval: 6)
            shot("P3a-after-reinstall-before-restore")
            var how = "Pro came back at launch (store already holds the subscription)"
            if !entitled {
                let restore = app.buttons["Restore purchase"].firstMatch
                let alt = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'restore'")).firstMatch
                let b = restore.exists ? restore : alt
                try need(b, "Restore button", 10)
                b.tap()
                try waitGone(el("pro-plans"), "plan list after Restore", 60)
                how = "Pro was off after reinstall; Restore turned it on"
            }
            shot("P3b-after-restore-pro-on")
            return how
        }

        // P4: yearly on a fresh install, then Pro stays on across a relaunch
        step("P4") {
            session.clearTransactions()
            try requestHostReinstall(2)
            try openPro(onboard: true)
            try need(el("pro-plan-yearly"), "yearly row on the fresh install", 60)
            guard !entitled else { throw StepFail("fresh install is already Pro after clearing the store") }
            el("pro-plan-yearly").tap()
            try need(el("pro-buy"), "buy button", 10)
            shot("P4a-yearly-selected")
            el("pro-buy").tap()
            try waitGone(el("pro-plans"), "plan list after buying yearly", 90)
            shot("P4b-after-buying-yearly-pro-on")
            app.terminate()
            try openPro(onboard: false)
            Thread.sleep(forTimeInterval: 6)
            shot("P4c-after-relaunch-pro-still-on")
            guard entitled else { throw StepFail("Pro is off after relaunch") }
            guard session.allTransactions().contains(where: { $0.productIdentifier == "wafra_pro_yearly" }) else { throw StepFail("no yearly transaction") }
            return "yearly bought, Pro on, still on after relaunch"
        }
    }
}
