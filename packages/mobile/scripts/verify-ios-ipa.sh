#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

IPA_PATH="${1:-}"
if [ -z "${IPA_PATH}" ] || [ ! -f "${IPA_PATH}" ]; then
  echo "::error::IPA 文件不存在: ${IPA_PATH}"
  exit 1
fi

EXPECTED_BUNDLE_ID="$(node -p "require('${MOBILE_DIR}/app.json').expo.ios.bundleIdentifier")"
EXPECTED_VERSION="$(node -p "require('${MOBILE_DIR}/app.json').expo.version")"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT
unzip -q "${IPA_PATH}" -d "${TMP_DIR}"

APP_DIR="$(find "${TMP_DIR}/Payload" -maxdepth 1 -name '*.app' -print | head -n 1)"
if [ -z "${APP_DIR}" ]; then
  echo "::error::IPA 内缺少 Payload/*.app"
  exit 1
fi

# 未签名发布合约：.app 主 bundle 不应包含 _CodeSignature/CodeResources（存在即说明被签名）。
if [ -e "${APP_DIR}/_CodeSignature/CodeResources" ]; then
  echo "::error::IPA 内 .app 带有代码签名（_CodeSignature/CodeResources 存在），与未签名发布合约不符"
  exit 1
fi

INFO_PLIST="${APP_DIR}/Info.plist"
BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "${INFO_PLIST}")"
SHORT_VER="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "${INFO_PLIST}")"
EXEC_NAME="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "${INFO_PLIST}")"

if [ "${BUNDLE_ID}" != "${EXPECTED_BUNDLE_ID}" ]; then
  echo "::error::Bundle ID 不匹配: ${BUNDLE_ID} != ${EXPECTED_BUNDLE_ID}"
  exit 1
fi

if [ "${SHORT_VER}" != "${EXPECTED_VERSION}" ]; then
  echo "::error::Version 不匹配: ${SHORT_VER} != ${EXPECTED_VERSION}"
  exit 1
fi

ARCHS="$(lipo -archs "${APP_DIR}/MacOS/${EXEC_NAME}" 2>/dev/null || lipo -archs "${APP_DIR}/${EXEC_NAME}")"
case " ${ARCHS} " in
  *" arm64 "*) ;;
  *)
    echo "::error::iOS 产物缺少 arm64 架构: ${ARCHS}"
    exit 1
    ;;
esac

(
  cd "$(dirname "${IPA_PATH}")"
  BASE="$(basename "${IPA_PATH}")"
  shasum -a 256 "${BASE}" > "${BASE}.sha256"
  cat "${BASE}.sha256"
)

echo "Verified unsigned iOS IPA: ${BUNDLE_ID} v${SHORT_VER} (${ARCHS})"
