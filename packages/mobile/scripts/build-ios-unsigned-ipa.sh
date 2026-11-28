#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
IOS_DIR="${MOBILE_DIR}/ios"
DIST_DIR="${MOBILE_DIR}/dist"

cd "${MOBILE_DIR}"

VERSION="$(node -p "require('./app.json').expo.version")"
export NODE_ENV="production"

echo "=== 1. Expo Prebuild (iOS) ==="
pnpm exec expo prebuild --platform ios --clean

echo "=== 2. CocoaPods Install ==="
(
  cd "${IOS_DIR}"
  pod install --repo-update || pod install
)

WORKSPACE="$(find "${IOS_DIR}" -maxdepth 1 -name '*.xcworkspace' -print | head -n 1)"
if [ -z "${WORKSPACE}" ]; then
  echo "::error::未找到 iOS .xcworkspace"
  exit 1
fi

SCHEME="$(xcodebuild -list -json -workspace "${WORKSPACE}" | node -e "const d = JSON.parse(require('fs').readFileSync(0,'utf8')); const s = d.workspace?.schemes || []; console.log(s.find(x => !x.includes('Tests')) || s[0] || '')")"
if [ -z "${SCHEME}" ]; then
  echo "::error::无法解析 Xcode scheme"
  exit 1
fi

echo "=== 3. Xcode Release Build (Unsigned iphoneos arm64) ==="
BUILD_DIR="${IOS_DIR}/build"
rm -rf "${BUILD_DIR}"
xcodebuild \
  -workspace "${WORKSPACE}" \
  -scheme "${SCHEME}" \
  -configuration Release \
  -sdk iphoneos \
  -arch arm64 \
  -derivedDataPath "${BUILD_DIR}" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  DEVELOPMENT_TEAM="" \
  AD_HOC_CODE_SIGNING_ALLOWED=NO \
  ONLY_ACTIVE_ARCH=NO \
  build

APP_PATH="$(find "${BUILD_DIR}/Build/Products/Release-iphoneos" -maxdepth 1 -name '*.app' -print | head -n 1)"
if [ -z "${APP_PATH}" ]; then
  echo "::error::未生成 Release-iphoneos .app 产物"
  exit 1
fi

echo "=== 4. Package Unsigned IPA ==="
mkdir -p "${DIST_DIR}"
STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "${STAGE_DIR}"' EXIT
mkdir -p "${STAGE_DIR}/Payload"
cp -R "${APP_PATH}" "${STAGE_DIR}/Payload/"

IPA_NAME="aichat-mobile-${VERSION}-ios-unsigned.ipa"
IPA_PATH="${DIST_DIR}/${IPA_NAME}"
rm -f "${IPA_PATH}" "${IPA_PATH}.sha256"
(
  cd "${STAGE_DIR}"
  zip -qry "${IPA_PATH}" Payload
)

echo "=== 5. Verify Unsigned IPA ==="
bash "${SCRIPT_DIR}/verify-ios-ipa.sh" "${IPA_PATH}"

echo "Unsigned IPA ready: ${IPA_PATH}"
