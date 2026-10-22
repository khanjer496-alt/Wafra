import Foundation
import JavaScriptCore

// TEST ONLY: a fresh JSContext has no host callbacks, network API, React
// Native runtime, keychain, filesystem API, or ledger adapter. Swift reads the
// bounded synthetic fixture/bundle and writes source-free test results only.
@main
struct NativeParserJavaScriptCoreProbe {
    enum ProbeFailure: Error { case invalidInput, contextUnavailable, scriptFailure, semanticFailure }

    private static var semanticAssertions = 0

    private static func check(_ condition: Bool) throws {
        guard condition else { throw ProbeFailure.semanticFailure }
        semanticAssertions += 1
    }

    private static func equalJSON(_ actual: Any?, _ expected: Any) -> Bool {
        guard let actual else { return false }
        guard let actualData = try? JSONSerialization.data(withJSONObject: actual, options: [.fragmentsAllowed, .sortedKeys]),
              let expectedData = try? JSONSerialization.data(withJSONObject: expected, options: [.fragmentsAllowed, .sortedKeys])
        else { return false }
        return actualData == expectedData
    }

    private static func assertSemantics(_ row: [String: Any], _ result: [String: Any]) throws {
        if row["expected"] is NSNull {
            try check(result["parsed"] is NSNull)
            try check(result["unproven"] is NSNull)
            return
        }
        guard let expected = row["expected"] as? [String: Any],
              let parsed = result["parsed"] as? [String: Any] else { throw ProbeFailure.semanticFailure }
        semanticAssertions += 1
        for (field, value) in expected { try check(equalJSON(parsed[field], value)) }
        let gulf = row["country"] as? String == "AE" || row["country"] as? String == "SA"
        if gulf {
            try check(result["unproven"] is NSNull)
        } else {
            guard let unproven = result["unproven"] as? [String: Any],
                  let inspection = result["inspection"] as? [String: Any],
                  let route = inspection["route"] as? [String: Any],
                  let review = inspection["review"] as? [String: Any]
            else { throw ProbeFailure.semanticFailure }
            semanticAssertions += 1
            for (field, value) in expected { try check(equalJSON(unproven[field], value)) }
            try check((unproven["bestEffort"] as? [String: Any])?["v"] as? Int == 1)
            try check(route["market"] as? String == row["country"] as? String)
            try check(review["status"] as? String == "posted")
            try check(review["direction"] as? String == (expected["type"] as? String == "income" ? "credit" : "debit"))
        }
    }

    static func main() {
        do { try run() }
        catch {
            // Keep source and messages out of logs, even when JSC emits an
            // exception whose message embeds a snippet of the parser source.
            fputs("JavaScriptCore probe failed at input, execution, or semantic validation.\n", stderr)
            exit(1)
        }
    }

    private static func run() throws {
        guard CommandLine.arguments.count == 4 else { throw ProbeFailure.invalidInput }
        let bundleData = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
        let fixtureData = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2]))
        guard bundleData.count <= 2 * 1024 * 1024, fixtureData.count <= 128 * 1024,
              let bundle = String(data: bundleData, encoding: .utf8),
              let rows = try JSONSerialization.jsonObject(with: fixtureData) as? [[String: Any]],
              !rows.isEmpty, rows.count <= 64 else { throw ProbeFailure.invalidInput }
        guard let context = JSContext() else { throw ProbeFailure.contextUnavailable }
        var scriptFailed = false
        context.exceptionHandler = { _, _ in scriptFailed = true }
        let noHost = context.evaluateScript("[typeof fetch, typeof XMLHttpRequest, typeof process, typeof Buffer, typeof require, typeof localStorage, typeof nativeCallSyncHook].every(x => x === 'undefined')")
        try check(noHost?.toBool() == true && !scriptFailed)
        let loadedAt = ProcessInfo.processInfo.systemUptime
        context.evaluateScript(bundle)
        let bundleLoadMs = (ProcessInfo.processInfo.systemUptime - loadedAt) * 1000
        guard !scriptFailed, let probe = context.objectForKeyedSubscript("wafraProbeJson"), !probe.isUndefined else {
            throw ProbeFailure.scriptFailure
        }
        var results: [[String: Any]] = []
        var latencies: [Double] = []
        for row in rows {
            let inputData = try JSONSerialization.data(withJSONObject: row)
            guard let input = String(data: inputData, encoding: .utf8) else { throw ProbeFailure.invalidInput }
            let started = ProcessInfo.processInfo.systemUptime
            let output = probe.call(withArguments: [input])
            latencies.append((ProcessInfo.processInfo.systemUptime - started) * 1000)
            guard !scriptFailed, let text = output?.toString(), let data = text.data(using: .utf8),
                  let result = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            else { throw ProbeFailure.scriptFailure }
            try assertSemantics(row, result)
            results.append(result)
        }
        let sorted = latencies.sorted()
        let result: [String: Any] = [
            "results": results, "semanticAssertions": semanticAssertions,
            "platform": ["runtime": "Apple JavaScriptCore via Swift JSContext", "macOS": ProcessInfo.processInfo.operatingSystemVersionString],
            "latencyMs": ["bundleLoad": bundleLoadMs, "jscTotal": latencies.reduce(0, +),
                "jscFirstCase": latencies[0], "jscMedian": sorted[sorted.count / 2], "jscMax": sorted[sorted.count - 1]]
        ]
        let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
        try data.write(to: URL(fileURLWithPath: CommandLine.arguments[3]), options: [.atomic])
    }
}
