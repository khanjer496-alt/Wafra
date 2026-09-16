#!/usr/bin/env bash
set -u

APP_ID=app.wafra.android
mkdir -p shots

adb install -r apk/wafra.apk >/dev/null
adb shell pm clear "$APP_ID" >/dev/null 2>&1 || true
adb shell monkey -p "$APP_ID" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
sleep 8

shot() {
  adb exec-out screencap -p > "shots/$1.png"
}

tap_text() {
  local needle="$1"
  for _ in $(seq 1 20); do
    adb shell uiautomator dump /sdcard/window.xml >/dev/null 2>&1 || true
    adb shell cat /sdcard/window.xml > /tmp/window.xml 2>/dev/null || true
    coords=$(python3 - "$needle" <<'PY'
import re,sys,xml.etree.ElementTree as ET
needle=sys.argv[1].lower()
try:
    root=ET.parse('/tmp/window.xml').getroot()
except Exception:
    raise SystemExit(1)
for n in root.iter('node'):
    hay=' '.join([n.attrib.get('text',''), n.attrib.get('content-desc','')]).lower()
    if needle in hay:
        m=re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', n.attrib.get('bounds',''))
        if m:
            x1,y1,x2,y2=map(int,m.groups())
            print((x1+x2)//2,(y1+y2)//2)
            raise SystemExit(0)
raise SystemExit(1)
PY
) || true
    if [ -n "${coords:-}" ]; then
      adb shell input tap $coords
      sleep 2
      return 0
    fi
    sleep 1
  done
  echo "could not find: $needle" >&2
  return 1
}

shot android-01-welcome
tap_text "Build my money picture" || exit 0
shot android-02-focus
tap_text "Where my money goes" || true
tap_text "Continue" || exit 0
shot android-03-tracking
tap_text "I check my bank apps" || true
shot android-04-tracking-banks
tap_text "Continue" || exit 0
shot android-05-personalized
tap_text "Connect my money" || exit 0
shot android-06-connect

ls -lh shots/*.png
