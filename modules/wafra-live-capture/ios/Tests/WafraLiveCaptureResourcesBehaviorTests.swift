import Foundation

private let englishValues = [
  "live.apple_pay.title": "Capture Apple Pay purchase",
  "live.apple_pay.amount.parameter": "Wallet amount",
  "live.apple_pay.merchant.parameter": "Merchant",
  "live.apple_pay.invalid": "Wafra could not read this Wallet amount. Connect the Wallet Amount value and merchant to this action, then try again.",
  "live.apple_pay.error": "Wafra could not save this Apple Pay event. Open Wafra and check Capture status.",
  "live.apple_pay.setup.title": "Check Wafra Apple Pay setup",
  "live.apple_pay.setup.error": "Wafra could not verify Apple Pay setup. Open Wafra and check Capture status.",

  "live.setup_v3.title": "Record Wafra Capture v3 setup proof",
  "live.notification.title": "Capture bank notification",
  "live.notification.text.parameter": "Notification text",
  "live.setup_proof.title": "Record Wafra capture setup proof",
  "live.setup_proof.error": "Wafra could not record the setup proof.",
  "live.automation_input_probe.title": "Probe Wafra automation input",
  "live.automation_input_probe.message.parameter": "Incoming message",
  "live.automation_input_probe.error": "Wafra could not record the automation input probe.",
  "live.stage.title": "Stage Wafra live message",
  "live.stage.sender.parameter": "Sender",
  "live.stage.message.parameter": "Message",
  "live.stage.event_id.parameter": "Event ID",
  "live.stage.observed_at.parameter": "Observed at",
  "live.stage.error": "Wafra could not stage this message.",
]

private let arabicValues = [
  "live.apple_pay.title": "التقاط عملية Apple Pay",
  "live.apple_pay.amount.parameter": "مبلغ المحفظة",
  "live.apple_pay.merchant.parameter": "التاجر",
  "live.apple_pay.invalid": "تعذّر على وفرة قراءة مبلغ المحفظة. اربط مبلغ المحفظة والتاجر بهذا الإجراء ثم حاول مرة أخرى.",
  "live.apple_pay.error": "تعذّر على وفرة حفظ حدث Apple Pay. افتح وفرة وتحقق من حالة الالتقاط.",
  "live.apple_pay.setup.title": "التحقق من إعداد Apple Pay في وفرة",
  "live.apple_pay.setup.error": "تعذّر على وفرة التحقق من إعداد Apple Pay. افتح وفرة وتحقق من حالة الالتقاط.",

  "live.setup_v3.title": "تسجيل إثبات إعداد التقاط وفرة الإصدار 3",
  "live.notification.title": "التقاط إشعار بنكي",
  "live.notification.text.parameter": "نص الإشعار",
  "live.setup_proof.title": "تسجيل إثبات إعداد الالتقاط في وفرة",
  "live.setup_proof.error": "تعذّر على وفرة تسجيل إثبات الإعداد.",
  "live.automation_input_probe.title": "اختبار إدخال أتمتة رسائل وفرة",
  "live.automation_input_probe.message.parameter": "الرسالة الواردة",
  "live.automation_input_probe.error": "تعذّر على وفرة تسجيل اختبار إدخال الأتمتة.",
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

    let shortcutURL = WafraLiveCaptureResources.bundle().url(
      forResource: "Wafra Notifications v1", withExtension: "shortcut")
    check("resource bundle includes the installable notification Shortcut",
      shortcutURL?.isFileURL == true && shortcutURL?.lastPathComponent == "Wafra Notifications v1.shortcut")
    let shortcutBytes = shortcutURL.flatMap { try? Data(contentsOf: $0) }
    check("bundled notification Shortcut is the signed AEA asset",
      shortcutBytes?.count == 22747 && shortcutBytes?.prefix(4) == Data("AEA1".utf8))

    for (name, byteCount) in [("Wafra Capture v3", 26756), ("Wafra History v8", 47954), ("Wafra Apple Pay v1", 22481)] {
      let assetURL = WafraLiveCaptureResources.bundle().url(forResource: name, withExtension: "shortcut")
      check("resource bundle resolves the exact \(name) Shortcut file",
        assetURL?.isFileURL == true && assetURL?.lastPathComponent == "\(name).shortcut")
      let assetBytes = assetURL.flatMap { try? Data(contentsOf: $0) }
      check("bundled \(name) is the signed candidate AEA asset",
        assetBytes?.count == byteCount && assetBytes?.prefix(4) == Data("AEA1".utf8))
    }

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
