#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/../../.." && pwd)"
sdk_root="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Library/Android/sdk}}"
platform="$sdk_root/platforms/android-36"
android_jar="$platform/android.jar"
uiautomator_jar="$platform/uiautomator.jar"
test_base_jar="$platform/optional/android.test.base.jar"
d8="$sdk_root/build-tools/36.0.0/d8"
out="$repo_root/artifacts/android-device-20260919/input-helper"

for dependency in "$android_jar" "$uiautomator_jar" "$d8"; do
  if [[ ! -f "$dependency" ]]; then
    printf 'Required SDK 36 file is missing: %s\n' "$dependency" >&2
    exit 1
  fi
done
for tool in javac jar; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'Required JDK tool is missing: %s\n' "$tool" >&2
    exit 1
  fi
done
if ! git -C "$repo_root" check-ignore -q "artifacts/android-device-20260919/input-helper/.build-check"; then
  printf 'Refusing to write helper outputs outside ignored artifacts.\n' >&2
  exit 1
fi

mkdir -p "$out"
build_dir="$(mktemp -d "$out/build.XXXXXX")"
trap 'rm -rf -- "$build_dir"' EXIT
mkdir -p "$build_dir/classes" "$build_dir/dex"

classpath="$android_jar:$uiautomator_jar"
d8_classpath=(--classpath "$uiautomator_jar")
if [[ -f "$test_base_jar" ]]; then
  classpath="$classpath:$test_base_jar"
  d8_classpath+=(--classpath "$test_base_jar")
fi

javac --release 8 -encoding UTF-8 -classpath "$classpath" \
  -d "$build_dir/classes" "$script_dir/WafraTextInput.java"
jar cf "$build_dir/classes.jar" -C "$build_dir/classes" .
"$d8" --release --min-api 24 --lib "$android_jar" "${d8_classpath[@]}" \
  --output "$build_dir/dex" "$build_dir/classes.jar"
test -s "$build_dir/dex/classes.dex"
jar cf "$out/wafra-text-input.jar" -C "$build_dir/dex" classes.dex

printf 'Compiled helper: %s\n' "$out/wafra-text-input.jar"
printf 'Local compilation only. Run the documented device checks separately.\n'
