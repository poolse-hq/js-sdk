#!/usr/bin/env bash
# Compile @poolse/native's Android (Kotlin) code before a release — the
# JS checks never touch it, and 3.6.1 shipped a Kotlin error.
#
#   scripts/android-compile-check.sh [host-app-dir]
#
# The module only builds inside an Expo app, so this clones a prebuilt
# host app (default ../poolse-native, which has android/ and
# node_modules/) copy-on-write into a temp dir, swaps in this checkout's
# packages/native, and runs :poolse-native:compileReleaseKotlin. The host
# app itself is never modified. Needs JDK 17 and the Android SDK
# (JAVA_HOME / ANDROID_HOME; the Homebrew paths are the defaults).
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
host=$(cd "${1:-$root/../poolse-native}" && pwd)
[ -d "$host/android" ] && [ -d "$host/node_modules" ] \
  || { echo "$host needs android/ (expo prebuild) and node_modules/"; exit 2; }
export JAVA_HOME=${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}
export ANDROID_HOME=${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}

work=$(mktemp -d "${TMPDIR:-/tmp}/poolse-android-check.XXXXXX")
trap 'rm -rf "$work"' EXIT
# -c clones on APFS (no extra disk); falls back to a plain copy elsewhere.
cp -cR "$host" "$work/app" 2>/dev/null || cp -R "$host" "$work/app"

(cd "$root/packages/native" && npm pack --silent --pack-destination "$work" >/dev/null)
rm -rf "$work/app/node_modules/@poolse/native"
mkdir -p "$work/app/node_modules/@poolse/native"
tar xzf "$work"/poolse-native-*.tgz -C "$work/app/node_modules/@poolse/native" --strip-components=1

cd "$work/app/android"
echo "sdk.dir=$ANDROID_HOME" > local.properties
if ./gradlew :poolse-native:compileReleaseKotlin --no-daemon -q > "$work/gradle.log" 2>&1; then
  echo "Android compile OK"
else
  grep -E "^e: |FAILURE|What went wrong" -A2 "$work/gradle.log" | head -40
  echo "Android compile FAILED"
  exit 1
fi
