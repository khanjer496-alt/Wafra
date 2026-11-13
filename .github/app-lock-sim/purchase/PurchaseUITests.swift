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
        // Probe: does a session mutation reach the simulator's storekitd? (Apple FB22237318: not via xcodebuild CLI on
        // newer runtimes; the app then talks to the real App Store and shows "Sign in to Apple Account".)
        let sem = DispatchSemaphore(value: 0); var probe = "ok"
        let s0 = session!
        Task.detached { do { try await s0.setSimulatedError(nil, forAPI: .purchase) } catch let e { probe = "\(e)" }; sem.signal() }
        sem.wait()
        note("SKTestSession mutation probe: \(probe); sim runtime: \(ProcessInfo.processInfo.operatingSystemVersionString)")
        // storekitd registers the session under THIS test runner's bundle id, not app.wafra.ios: ask the host to copy
        // the configuration into the app's own Octane folder before the app launches (Apple FB22237318 area).
        try? "go".write(toFile: "\(hsDir)/storekit-sync.request", atomically: true, encoding: .utf8)
        let syncEnd = Date().addingTimeInterval(60)
        while Date() < syncEnd && !FileManager.default.fileExists(atPath: "\(hsDir)/storekit-sync.done") { Thread.sleep(forTimeInterval: 1) }
        note("host StoreKit config sync: \(FileManager.default.fileExists(atPath: "\(hsDir)/storekit-sync.done") ? "done" : "timed out")")
        record("STOREKIT-SESSION", probe == "ok", "mutation probe on \(ProcessInfo.processInfo.operatingSystemVersionString): \(probe)")
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

    /// Cancel a lingering system alert (a StoreKit "Sign in to Apple Account" sheet is a SpringBoard alert that
    /// survives app launches). Cancel, never OK: OK on an empty sign-in sheet raises a second alert.
    func dismissSystemAlerts() {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for _ in 0..<4 {
            let cancel = springboard.alerts.buttons["Cancel"].firstMatch
            if cancel.waitForExistence(timeout: 2) { note("dismissed a system alert via Cancel"); cancel.tap() } else { break }
        }
    }

    /// Onboarding by testID (the sample-data button no longer exists), until the Home surface shows.
    func reachHome() throws {
        let advance = ["onboarding-get-started", "onboarding-name-skip", "onboarding-goal-bills", "onboarding-goals-continue",
                       "onboarding-watch-continue", "onboarding-reminders-not-now", "onboarding-live-continue",
                       "onboarding-sms-explainer-continue", "onboarding-source-manual", "onboarding-complete-manual", "onboarding-complete-continue",
                       "onboarding-pattern-continue", "onboarding-paywall-free"]
        let end = Date().addingTimeInterval(240)
        while Date() < end {
            dismissSystemAlerts()
            if app.buttons["Settings"].firstMatch.exists { return }
            var tapped = false
            // The onboarding paywall lists both plans; its free-path button sits below the fold.
            if el("onboarding-paywall").exists {
                let free = el("onboarding-paywall-free")
                if !(free.exists && free.isHittable) { app.swipeUp(); Thread.sleep(forTimeInterval: 1) }
            }
            for id in advance {
                let e = el(id)
                guard e.exists && e.isHittable else { continue }
                // The goal row is a toggle: tap it only while Continue is still disabled, never twice.
                if id == "onboarding-goal-bills" && el("onboarding-goals-continue").exists && el("onboarding-goals-continue").isEnabled { continue }
                e.tap(); tapped = true; break
            }
            Thread.sleep(forTimeInterval: tapped ? 2 : 3)
        }
        shot("reachHome-timeout")
        throw StepFail("could not reach Home through onboarding within 240s")
    }

    /// Fresh process, past onboarding when asked, on the Pro screen.
    func openPro(onboard: Bool) throws {
        app.launch()
        dismissSystemAlerts()
        if onboard { try reachHome() }
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
    /// After a reinstall the store can answer "Price unavailable" for a moment: tap "Try loading prices again" and wait.
    func retryPrices(_ rowId: String) {
        for _ in 0..<4 {
            if el(rowId).waitForExistence(timeout: 15) { return }
            let b = app.buttons["Try loading prices again"].firstMatch
            if b.exists { note("price list unavailable; tapping Try loading prices again"); b.tap() }
        }
    }
    /// The StoreKit test purchase sheet ("Xcode", plan, price, Subscribe) is system UI that the test session does not
    /// auto-confirm for the app: find its Subscribe button (SpringBoard, StoreKitUIService or the app), tap it, then
    /// answer a follow-up alert. A "Sign in to Apple Account" alert is cancelled, never confirmed with OK.
    func confirmStoreSheet(_ tag: String, timeout: TimeInterval = 45) {
        let hosts = [XCUIApplication(bundleIdentifier: "com.apple.springboard"),
                     XCUIApplication(bundleIdentifier: "com.apple.StoreKitUIService"), app]
        let end = Date().addingTimeInterval(timeout)
        var tapped = false
        while Date() < end && !tapped {
            for host in hosts where host.state != .notRunning {
                let b = host.buttons["Subscribe"].firstMatch
                if b.exists {
                    shot("\(tag)-store-sheet"); note("\(tag): store sheet found in \(host.identifier); tapping Subscribe"); b.tap(); tapped = true; break
                }
            }
            if !tapped { Thread.sleep(forTimeInterval: 1) }
        }
        if !tapped { note("\(tag): no Subscribe button within \(Int(timeout)) s"); return }
        let end2 = Date().addingTimeInterval(25)
        while Date() < end2 {
            for host in hosts where host.state != .notRunning {
                for alert in host.alerts.allElementsBoundByIndex {
                    let label = alert.label
                    shot("\(tag)-after-subscribe-alert")
                    if label.localizedCaseInsensitiveContains("Sign in") {
                        note("\(tag): sign-in alert after Subscribe (\(label.prefix(80))); cancelling")
                        alert.buttons["Cancel"].firstMatch.tap()
                    } else {
                        note("\(tag): alert after Subscribe: \(label.prefix(100)); buttons: \(alert.buttons.allElementsBoundByIndex.map { $0.label })")
                        for name in ["OK", "Done", "Continue"] where alert.buttons[name].exists { alert.buttons[name].tap(); return }
                    }
                }
            }
            Thread.sleep(forTimeInterval: 1)
        }
        note("\(tag): store sheet confirmed, no follow-up alert")
    }
    /// Watch SpringBoard for system alerts after a buy tap without dismissing them: records the alert text and buttons
    /// (Apple's own wording) so a "Sign in to Apple Account" sheet is visible evidence instead of being cancelled.
    func observeAlerts(_ tag: String, seconds: Int) {
        let sb = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        var seen = Set<String>()
        for i in 0..<(seconds / 2) {
            for a in sb.alerts.allElementsBoundByIndex {
                let key = String(a.label.prefix(120)) + " | buttons: " + a.buttons.allElementsBoundByIndex.map { String($0.label.prefix(30)) }.joined(separator: ",")
                if !seen.contains(key) { seen.insert(key); note("\(tag) +\(i * 2)s system alert: \(key)"); shot("\(tag)-alert-\(seen.count)") }
            }
            if i == 3 { shot("\(tag)-after-buy-tap-8s") }
            Thread.sleep(forTimeInterval: 2)
        }
        if seen.isEmpty { note("\(tag): no system alert in \(seconds) s after the buy tap") }
    }
    /// What the store and the screen said when a purchase did not unlock Pro: transactions the StoreKit session recorded,
    /// and any visible text that looks like a purchase result (the Pro screen's notice has no test id).
    func purchaseEvidence() -> String {
        let tx = session.allTransactions().map { $0.productIdentifier }
        let words = ["failed", "unavailable", "pending", "in progress", "Could not", "couldn", "not been", "refus", "cancel", "legal", "error", "try again", "approval"]
        var notices: [String] = []
        for t in app.staticTexts.allElementsBoundByIndex.prefix(200) {
            let l = t.label
            if words.contains(where: { l.localizedCaseInsensitiveContains($0) }) && !notices.contains(l) { notices.append(String(l.prefix(140))) }
            if notices.count >= 8 { break }
        }
        let buttons = app.buttons.allElementsBoundByIndex.prefix(30).map { String($0.label.prefix(60)) }.filter { !$0.isEmpty }
        let alerts = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.allElementsBoundByIndex.map { String($0.label.prefix(100)) }
        var sim = "unknown"
        let s0 = session!; let sem = DispatchSemaphore(value: 0)
        Task.detached { let e = await s0.simulatedError(forAPI: .purchase); sim = e == nil ? "none" : "\(e!)"; sem.signal() }
        _ = sem.wait(timeout: .now() + 10)
        return "simulated purchase error: \(sim); store transactions: \(tx); result-like text: \(notices); buttons: \(buttons); system alerts: \(alerts)"
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

        // P2: buy weekly, Pro unlocks
        step("P2") {
            try need(el("pro-plan-weekly"), "weekly row", 10)
            el("pro-plan-weekly").tap()
            try need(el("pro-buy"), "buy button", 10)
            shot("P2a-before-buying-weekly")
            note("P2 buy tap")
            el("pro-buy").tap()
            confirmStoreSheet("P2")
            do { try waitGone(el("pro-plans"), "plan list after buying weekly", 90) }
            catch { throw StepFail("\(error); \(purchaseEvidence())") }
            shot("P2b-after-buying-weekly-pro-unlocked")
            let tx = session.allTransactions()
            // The app's store client reads the configuration copied into its own folder; this runner's session is a
            // separate registration, so its transaction list is informational only. The proof is the app's own screen.
            return "plan list gone (Pro active, buy sheet confirmed); runner-session transactions (informational): \(tx.count)"
        }

        // P3: delete + reinstall, Restore brings Pro back
        step("P3") {
            try requestHostReinstall(1)
            app.launch()
            dismissSystemAlerts()
            try reachHome()
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
            retryPrices("pro-plan-yearly")
            try need(el("pro-plan-yearly"), "yearly row on the fresh install", 60)
            guard !entitled else { throw StepFail("fresh install is already Pro after clearing the store") }
            el("pro-plan-yearly").tap()
            try need(el("pro-buy"), "buy button", 10)
            shot("P4a-yearly-selected")
            note("P4 buy tap")
            el("pro-buy").tap()
            confirmStoreSheet("P4")
            do { try waitGone(el("pro-plans"), "plan list after buying yearly", 90) }
            catch { throw StepFail("\(error); \(purchaseEvidence())") }
            shot("P4b-after-buying-yearly-pro-on")
            app.terminate()
            try openPro(onboard: false)
            Thread.sleep(forTimeInterval: 6)
            shot("P4c-after-relaunch-pro-still-on")
            guard entitled else { throw StepFail("Pro is off after relaunch") }
            return "yearly bought, Pro on, still on after relaunch"
        }

        // P5: a cancelled purchase leaves Pro off (runs LAST on a fresh, not-entitled install: the simulated cancel must not leak into the buy steps)
        step("P5") {
            session.clearTransactions()
            try requestHostReinstall(3)
            try openPro(onboard: true)
            try simulatePurchaseCancel(true)
            defer { try? simulatePurchaseCancel(false) }
            retryPrices("pro-plan-weekly")
            try need(el("pro-plan-weekly"), "weekly row", 10)
            el("pro-plan-weekly").tap()
            try need(el("pro-buy"), "buy button", 10)
            el("pro-buy").tap()
            let noteShown = el("pro-purchase-note").waitForExistence(timeout: 20)
            let noteText = noteShown ? el("pro-purchase-note").label : "(none)"
            Thread.sleep(forTimeInterval: 4)
            shot("P5-after-cancelled-purchase")
            guard el("pro-buy").exists, el("pro-plans").exists else { throw StepFail("Pro looks unlocked after a cancelled purchase") }
            return "plans and buy button still shown; neutral note shown: \(noteShown) '\(noteText)'; buy button enabled: \(el("pro-buy").isEnabled)"
        }
        try? simulatePurchaseCancel(false)

    }
}
