#!/usr/bin/env bash
# Compile and render the iOS app icon the way the archive does, after
# `expo prebuild --platform ios`. Fails unless:
#   - actool compiles the prebuilt Icon Composer document without errors,
#   - the compiled Assets.car carries a 1024 px rendition (the App Store /
#     TestFlight marketing icon), and
#   - ictool renders it in every appearance (kept as evidence in $OUT).
# Needs Xcode 26.2+ with its iOS simulator runtime (macos-26 runners have it).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-${RUNNER_TEMP:-/tmp}/ios-app-icon}"
rm -rf "$OUT"
mkdir -p "$OUT/compiled" "$OUT/renders"
cd "$ROOT"

node scripts/render-ios-icon-mark.mjs --check

PBXPROJ=$(ls ios/*.xcodeproj/project.pbxproj | head -1)
ICON_NAME=$(grep -m1 -o 'ASSETCATALOG_COMPILER_APPICON_NAME = [^;]*' "$PBXPROJ" | sed 's/.*= //; s/"//g')
test -n "$ICON_NAME"
ICON_DOC=$(find ios -maxdepth 3 -name "$ICON_NAME.icon" -type d | head -1)
if [ -z "$ICON_DOC" ]; then
  echo "::error::prebuild did not place $ICON_NAME.icon in ios/ (found: $(find ios -maxdepth 3 -name '*.icon' | tr '\n' ' '))"
  exit 1
fi
cmp "$ICON_DOC/icon.json" assets/wafra.icon/icon.json
cmp "$ICON_DOC/Assets/wafra-mark.svg" assets/wafra.icon/Assets/wafra-mark.svg
CATALOGS=$(find ios -maxdepth 3 -name '*.xcassets' -type d -not -path '*/Pods/*' | head -1)
echo "App icon: $ICON_NAME from $ICON_DOC (catalog: ${CATALOGS:-none})"

xcrun actool --compile "$OUT/compiled" \
  --platform iphoneos --minimum-deployment-target 15.1 \
  --target-device iphone --target-device ipad \
  --app-icon "$ICON_NAME" --include-all-app-icons \
  --output-partial-info-plist "$OUT/compiled/partial.plist" \
  --output-format human-readable-text --errors --warnings --notices \
  ${CATALOGS:+"$CATALOGS"} "$ICON_DOC" | tee "$OUT/actool.txt"
if grep -q 'com.apple.actool.errors' "$OUT/actool.txt"; then
  echo "::error::actool reported errors compiling $ICON_DOC"
  exit 1
fi
test -f "$OUT/compiled/Assets.car"
ls -la "$OUT/compiled" | tee "$OUT/compiled-files.txt"
xcrun assetutil --info "$OUT/compiled/Assets.car" > "$OUT/assets-info.json"

node - "$OUT/assets-info.json" "$ICON_NAME" <<'NODE'
const fs = require('node:fs');
const [file, name] = process.argv.slice(2);
const entries = JSON.parse(fs.readFileSync(file, 'utf8')).filter(e => e.AssetType);
const icon = entries.filter(e => String(e.Name || '').startsWith(name) || /icon/i.test(String(e.AssetType)));
for (const e of icon) {
  console.log([e.AssetType, e.Name, e.Idiom, e.Appearance, `${e.PixelWidth ?? '-'}x${e.PixelHeight ?? '-'}`, e.Scale, e.RenditionName].map(v => v ?? '-').join(' | '));
}
const large = icon.filter(e => Number(e.PixelWidth) >= 1024 && Number(e.PixelHeight) >= 1024);
if (!large.length) {
  console.error(`::error::Assets.car has no 1024 px rendition of ${name}; TestFlight/App Store would only see the small fallback icon`);
  process.exit(1);
}
console.log(`1024 px renditions: ${large.map(e => `${e.RenditionName || e.Name} (${e.Idiom || 'universal'}${e.Appearance ? ', ' + e.Appearance : ''})`).join('; ')}`);
NODE

ICTOOL="$(xcode-select -p)/usr/bin/ictool"
test -x "$ICTOOL" || ICTOOL="$(xcode-select -p)/../Applications/Icon Composer.app/Contents/Executables/ictool"
for rendition in Default Dark TintedLight TintedDark ClearLight ClearDark; do
  "$ICTOOL" assets/wafra.icon --export-image --output-file "$OUT/renders/$rendition-1024.png" \
    --platform iOS --rendition "$rendition" --width 1024 --height 1024 --scale 1 >/dev/null
  for scale in 2 3; do
    "$ICTOOL" assets/wafra.icon --export-image --output-file "$OUT/renders/$rendition-60@${scale}x.png" \
      --platform iOS --rendition "$rendition" --width 60 --height 60 --scale "$scale" >/dev/null
  done
done
for f in "$OUT"/renders/*.png; do
  test -s "$f"
done
echo "Rendered $(ls "$OUT/renders" | wc -l | tr -d ' ') icon images into $OUT/renders"
