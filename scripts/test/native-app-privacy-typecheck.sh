#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$(mktemp -d "${TMPDIR:-/tmp}/wafra-app-privacy.XXXXXX")"
trap 'rm -rf "$out"' EXIT
sdk="$(xcrun --sdk iphonesimulator --show-sdk-path)"
target="$(uname -m)-apple-ios15.1-simulator"
# Only the Expo subscriber/bridge boundary is stubbed. The privacy controller
# itself is typechecked against the installed real UIKit/Foundation SDK.
# This is not a full Expo build, archive check or device lifecycle test.
cat > "$out/ExpoModulesCore.swift" <<'SWIFT'
import UIKit
open class BaseExpoAppDelegateSubscriber: UIResponder {
  public override required init() { super.init() }
}
public protocol ExpoAppDelegateSubscriberProtocol: UIApplicationDelegate {}
public typealias ExpoAppDelegateSubscriber = BaseExpoAppDelegateSubscriber & ExpoAppDelegateSubscriberProtocol
SWIFT
cat > "$out/WidgetBridge.swift" <<'SWIFT'
import Foundation
class WafraWidgetsModule {
  static let appGroup = "group.app.wafra.ios"
  static let snapshotKey = "wafra.widget.snapshot"
  static let queue = DispatchQueue(label: "app.wafra.widgets.snapshot")
  static func reloadWidgets() {}
}
SWIFT
xcrun swiftc -sdk "$sdk" -target "$target" -module-cache-path "$out/cache" \
  -emit-module -module-name ExpoModulesCore "$out/ExpoModulesCore.swift" -emit-module-path "$out/ExpoModulesCore.swiftmodule"
xcrun swiftc -sdk "$sdk" -target "$target" -module-cache-path "$out/cache" -I "$out" \
  -typecheck "$out/WidgetBridge.swift" "$root/modules/wafra-widgets/ios/WafraPrivacyCover.swift"
echo 'iOS privacy controller UIKit typecheck passed (Expo boundary stubbed).'
