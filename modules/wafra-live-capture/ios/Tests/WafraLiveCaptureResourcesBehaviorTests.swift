import Foundation

private let englishValues = [
  "live.setup_proof.title": "Record Wafra capture setup proof",
  "live.setup_proof.error": "Wafra could not record the setup proof.",
  "live.stage.title": "Stage Wafra live message",
  "live.stage.sender.parameter": "Sender",
  "live.stage.message.parameter": "Message",
  "live.stage.event_id.parameter": "Event ID",
  "live.stage.observed_at.parameter": "Observed at",
  "live.stage.error": "Wafra could not stage this message.",
]

private let arabicValues = [
  "live.setup_proof.title": "تسجيل إثبات إعداد الالتقاط في وفرة",
  "live.setup_proof.error": "تعذّر على وفرة تسجيل إثبات الإعداد.",
  "live.stage.title": "حفظ رسالة مباشرة في وفرة",
  "live.stage.sender.parameter": "المرسل",
  "live.stage.message.parameter": "الرسالة",
  "live.stage.event_id.parameter": "معرّف الحدث",
  "live.stage.observed_at.parameter": "وقت الرصد",
  "live.stage.error": "تعذّر على وفرة حفظ هذه الرسالة.",
]

private var passed = 0
private var failed = 0

private func check(_ name: String, _ condition: @autoclosure () -> Bool) {
  if condition() {
    passed += 1
    print("✓ \(name)")
  } else {
    failed += 1
    print("✗ \(name)")
  }
}

private func resolve(_ key: String, localization: String) -> (LocalizedStringResource, String)? {
  let resource = WafraLiveCaptureResources.localized(key)
  let bundle = WafraLiveCaptureResources.bundle()
  guard
    let localizationPath = bundle.path(forResource: localization, ofType: "lproj"),
    let localizationBundle = Bundle(path: localizationPath)
  else {
    return nil
  }
  let value = localizationBundle.localizedString(
    forKey: resource.key,
    value: "__WAFRA_TEST_MISSING_LOCALIZATION__",
    table: resource.table
  )
  return (resource, value)
}

private func usesExpectedBundle(_ resource: LocalizedStringResource?) -> Bool {
  guard
    let resource,
    case let .atURL(url) = resource.bundle
  else {
    return false
  }
  return url == WafraLiveCaptureResources.bundle().bundleURL
}

@main
private struct WafraLiveCaptureResourcesBehaviorTests {
  static func main() {
    let mode = CommandLine.arguments.dropFirst().first ?? "verify"
    if mode == "missing-key" {
      _ = WafraLiveCaptureResources.localized("live.missing.test.key")
      return
    }
    if mode == "missing-bundle" {
      _ = WafraLiveCaptureResources.bundle()
      return
    }
    guard mode == "verify" else {
      preconditionFailure("Unknown resource-test mode.")
    }

    check("resource helper finds the exact CocoaPods bundle",
      WafraLiveCaptureResources.bundle().bundleURL.lastPathComponent ==
        "WafraLiveCaptureResources.bundle")

    for key in englishValues.keys.sorted() {
      let english = resolve(key, localization: "en")
      let arabic = resolve(key, localization: "ar")
      check("resource helper returns the exact key for \(key)", english?.0.key == key)
      check("resource helper binds WafraIntents for \(key)", english?.0.table == "WafraIntents")
      check("resource helper binds the CocoaPods bundle URL for \(key)",
        usesExpectedBundle(english?.0))
      check("resource helper resolves English for \(key)", english?.1 == englishValues[key])
      check("resource helper resolves Arabic for \(key)", arabic?.1 == arabicValues[key])
      check("Arabic differs from the key for \(key)", arabic?.1 != key)
      check("Arabic differs from English for \(key)", arabic?.1 != english?.1)
    }

    print("\nNative live capture resources: \(passed) passed, \(failed) failed")
    precondition(failed == 0, "Native live capture resource behavior failed.")
  }
}
