@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "MOBILE_DIR=%SCRIPT_DIR%.."

pushd "%MOBILE_DIR%" || exit /b 1
call pnpm exec expo prebuild --platform android || exit /b 1

pushd android || exit /b 1
call gradlew.bat :app:assembleRelease || exit /b 1
popd

echo.
echo Installable APK:
echo %CD%\android\app\build\outputs\apk\release\app-release.apk
popd
