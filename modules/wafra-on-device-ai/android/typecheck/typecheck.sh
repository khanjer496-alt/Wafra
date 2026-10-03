#!/usr/bin/env bash
# Compiles the Android module sources with the SAME Kotlin compiler version as
# React Native 0.83 (2.1.20) against the real ML Kit GenAI Prompt 1.0.0-beta2
# and genai-common 1.0.0-beta3 class files, with compile-only stand-ins for
# the expo-modules-core DSL and android.os.Build. It proves the ML Kit API
# names/signatures and that Kotlin 2.1.20 can read the library metadata. It
# is not a Gradle/AGP build (CI's Android build covers manifest merging).
#
# Inputs (downloaded by the caller, never committed):
#   KOTLINC=/path/to/kotlinc/bin/kotlinc
#   CLASSPATH_JARS=prompt-classes.jar:common-classes.jar:coroutines.jar:json.jar:listenablefuture.jar
set -euo pipefail
cd "$(dirname "$0")/.."
: "${KOTLINC:?set KOTLINC}" "${CLASSPATH_JARS:?set CLASSPATH_JARS}"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
"$KOTLINC" -language-version 2.1 -jvm-target 17 -classpath "$CLASSPATH_JARS" -d "$OUT" \
  typecheck/*.kt src/main/java/expo/modules/wafraondeviceai/*.kt
echo "kotlin typecheck ok"
