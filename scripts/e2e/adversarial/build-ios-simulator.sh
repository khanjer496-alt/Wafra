#!/usr/bin/env bash
set -euo pipefail

DEVICE_ID="${DEVICE_ID:-DFEF9E5D-9BC5-4B05-8CA6-C70A25587292}"
CONFIGURATION="${CONFIGURATION:-Release}"
DERIVED_DATA="${DERIVED_DATA:-/tmp/wafra-ios-simulator}"
ARCH="$(uname -m)"

xcodebuild \
  -workspace ios/Wafra.xcworkspace \
  -scheme Wafra \
  -configuration "$CONFIGURATION" \
  -destination "platform=iOS Simulator,id=$DEVICE_ID" \
  -derivedDataPath "$DERIVED_DATA" \
  ONLY_ACTIVE_ARCH=YES \
  ARCHS="$ARCH" \
  build

APP_PATH="$DERIVED_DATA/Build/Products/${CONFIGURATION}-iphonesimulator/Wafra.app"

# Simulator builds use Xcode's local ad-hoc identity. Do not disable signing:
# an unsigned app cannot use the Keychain that protects Wafra's SQLCipher key.
codesign --verify --strict "$APP_PATH"
printf '%s\n' "$APP_PATH"
