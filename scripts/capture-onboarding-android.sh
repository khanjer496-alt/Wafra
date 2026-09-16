#!/usr/bin/env bash
set -u

adb install -r apk/wafra.apk
mkdir -p shots
FAILED=""

for scheme in dark light; do
  echo "::group::$scheme"
  if [ "$scheme" = dark ]; then
    adb shell "cmd uimode night yes"
  else
    adb shell "cmd uimode night no"
  fi

  maestro test \
    -e APP_ID=app.wafra.android \
    -e SHOT_PREFIX="android-$scheme" \
    --format junit --output "shots/android-$scheme.xml" \
    --test-output-dir "shots/maestro-android-$scheme" \
    .maestro/tour.yaml || FAILED="$FAILED $scheme"

  adb exec-out screencap -p > "shots/android-$scheme-99-final-screen.png" || true
  echo "::endgroup::"
done

find shots -path '*takeScreenshot*' -type f -exec cp -f {} shots/ \; || true
find "$HOME/.maestro/tests" -path '*takeScreenshot*' -type f -exec cp -f {} shots/ \; 2>/dev/null || true
find . -maxdepth 1 -type f -name 'android-*' -exec cp -f {} shots/ \; 2>/dev/null || true

EXPECTED=12
COUNT=$(find shots -maxdepth 1 -type f -name 'android-*-0*' | wc -l | tr -d ' ')
echo "collected $COUNT/$EXPECTED onboarding screenshots (failed passes:${FAILED:- none})"
find shots -maxdepth 1 -type f ! -name '*.xml' -exec basename {} \; | sort

# Keep whatever evidence we captured even when one navigation step misses.
# The upload step is `if: always()`, so this message is more useful than
# failing before screenshots can be inspected.
if [ "$COUNT" -lt "$EXPECTED" ]; then
  echo "::warning::only $COUNT of $EXPECTED onboarding screenshots were captured"
fi
