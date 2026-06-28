#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mobile_dir="$(cd "$script_dir/.." && pwd)"

cd "$mobile_dir"

pnpm exec expo prebuild --platform android

node - "$mobile_dir/android/gradle/wrapper/gradle-wrapper.properties" <<'JS'
const fs = require("node:fs");

const path = process.argv[2];
const content = fs.readFileSync(path, "utf8");
const next = content
  .split(/\r?\n/)
  .map((line) =>
    line.startsWith("distributionUrl=")
      ? "distributionUrl=https\\://services.gradle.org/distributions/gradle-8.14.3-bin.zip"
      : line,
  )
  .join("\n")
  .replace(/\n*$/, "\n");

fs.writeFileSync(path, next, "utf8");
JS

android_sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [[ -z "$android_sdk" ]]; then
  for candidate in \
    "$HOME/.local/share/android-sdk" \
    "/mnt/e/Program Files/Android/Sdk" \
    "/mnt/c/Users/${USER}/AppData/Local/Android/Sdk" \
    "$HOME/Android/Sdk" \
    "$HOME/android-sdk"; do
    if [[ -d "$candidate/platforms" && -d "$candidate/platform-tools" ]]; then
      android_sdk="$candidate"
      break
    fi
  done
fi

if [[ -n "$android_sdk" ]]; then
  escaped_sdk="${android_sdk//\\/\\\\}"
  escaped_sdk="${escaped_sdk//:/\\:}"
  escaped_sdk="${escaped_sdk// /\\ }"
  printf 'sdk.dir=%s\n' "$escaped_sdk" > "$mobile_dir/android/local.properties"
fi

java_home="${JAVA_HOME:-}"
if [[ -z "$java_home" ]]; then
  for candidate in \
    "$HOME/.local/share/jdks/temurin-17" \
    "/usr/lib/jvm/java-17-openjdk-amd64" \
    "/usr/lib/jvm/java-21-openjdk-amd64"; do
    if [[ -x "$candidate/bin/java" ]]; then
      java_home="$candidate"
      break
    fi
  done
fi

cd "$mobile_dir/android"
JAVA_HOME="${java_home:-${JAVA_HOME:-}}" ANDROID_HOME="${android_sdk:-${ANDROID_HOME:-}}" ANDROID_SDK_ROOT="${android_sdk:-${ANDROID_SDK_ROOT:-}}" ./gradlew --no-daemon --no-watch-fs :app:assembleRelease

printf '\nInstallable APK:\n%s\n' "$mobile_dir/android/app/build/outputs/apk/release/app-release.apk"
