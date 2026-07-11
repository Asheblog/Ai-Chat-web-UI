@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
node "%SCRIPT_DIR%build-android-apk.js" release
exit /b %ERRORLEVEL%
