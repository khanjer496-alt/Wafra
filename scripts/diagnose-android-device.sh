#!/usr/bin/env bash
set -euo pipefail

# Read-only, content-free snapshot of a connected Android phone running Wafra.
#
# It deliberately does not query the SMS provider or copy Wafra's private
# database. The first pass answers whether the installed APK, Android grants,
# OEM restricted-access layer, notification listener, foreground activity and
# app process agree. Screen pixels and Wafra-only logcat stay under artifacts/.

PACKAGE_ID="app.wafra.android"
ARTIFACT_ROOT="${WAFRA_ANDROID_DIAGNOSTIC_DIR:-artifacts/android-device-diagnostics}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${ARTIFACT_ROOT}/${STAMP}"

if ! command -v adb >/dev/null 2>&1; then
  echo "adb is not installed" >&2
  exit 2
fi

mapfile_compat() {
  while IFS= read -r line; do
    DEVICE_LINES+=("$line")
  done
}

DEVICE_LINES=()
mapfile_compat < <(adb devices | awk 'NR > 1 && $2 == "device" { print $1 }')
if [[ ${#DEVICE_LINES[@]} -eq 0 ]]; then
  echo "No authorized Android device. Unlock the phone, enable USB debugging, and accept the computer prompt." >&2
  exit 3
fi
if [[ ${#DEVICE_LINES[@]} -gt 1 && -z "${ANDROID_SERIAL:-}" ]]; then
  echo "More than one Android device is attached; set ANDROID_SERIAL to choose one." >&2
  exit 4
fi

DEVICE_SERIAL="${ANDROID_SERIAL:-${DEVICE_LINES[0]}}"
ADB=(adb -s "$DEVICE_SERIAL")
mkdir -p "$OUT_DIR"

safe_shell() {
  "${ADB[@]}" shell "$@" 2>&1 || true
}

MODEL="$(safe_shell getprop ro.product.model | tr -d '\r')"
SDK="$(safe_shell getprop ro.build.version.sdk | tr -d '\r')"
RELEASE="$(safe_shell getprop ro.build.version.release | tr -d '\r')"
MANUFACTURER="$(safe_shell getprop ro.product.manufacturer | tr -d '\r')"

{
  echo "Wafra Android device diagnostic"
  echo "capturedAtUtc=$STAMP"
  echo "manufacturer=$MANUFACTURER"
  echo "model=$MODEL"
  echo "androidRelease=$RELEASE"
  echo "androidSdk=$SDK"
  echo
  echo "== Installed package =="
  safe_shell dumpsys package "$PACKAGE_ID" | awk '
    /versionCode=|versionName=|firstInstallTime=|lastUpdateTime=|installerPackageName=|pkgFlags=|privateFlags=/ { print }
    /android.permission.READ_SMS: granted=|android.permission.RECEIVE_SMS: granted=|android.permission.POST_NOTIFICATIONS: granted=/ { print }
  '
  echo
  echo "== AppOps READ_SMS =="
  safe_shell cmd appops get "$PACKAGE_ID" READ_SMS
  echo
  echo "== Notification listener enabled packages =="
  safe_shell settings get secure enabled_notification_listeners | tr ':' '\n' | sed 's#/.*##' | sort -u
  echo
  echo "== Current foreground activity =="
  safe_shell dumpsys activity activities | awk '/mResumedActivity|topResumedActivity/ { print; exit }'
  echo
  echo "== Wafra process =="
  safe_shell pidof "$PACKAGE_ID"
  echo
  echo "== Release APK private-data access =="
  if "${ADB[@]}" shell run-as "$PACKAGE_ID" true >/dev/null 2>&1; then
    echo "debuggable=yes"
  else
    echo "debuggable=no"
  fi
} > "$OUT_DIR/device-state.txt"

# A screenshot and accessibility tree let us inspect exactly what the user
# sees without installing screen-control software or changing app state.
"${ADB[@]}" exec-out screencap -p > "$OUT_DIR/screen.png"
UI_REMOTE="/sdcard/wafra-ui-${STAMP}.xml"
safe_shell uiautomator dump "$UI_REMOTE" >/dev/null
"${ADB[@]}" exec-out cat "$UI_REMOTE" > "$OUT_DIR/ui.xml" 2>/dev/null || true
safe_shell rm "$UI_REMOTE" >/dev/null

# Filter by the Wafra process. This avoids collecting unrelated apps' logs and
# SMS notification text. The app itself has a no-raw-message logging contract.
PID="$(safe_shell pidof "$PACKAGE_ID" | tr -dc '0-9 ' | awk '{ print $1 }')"
if [[ -n "$PID" ]]; then
  "${ADB[@]}" logcat -d --pid="$PID" -v threadtime > "$OUT_DIR/wafra-logcat.txt" 2>/dev/null || true
else
  : > "$OUT_DIR/wafra-logcat.txt"
fi

echo "$OUT_DIR"
