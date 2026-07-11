# AIChat Mobile

AIChat Mobile 是 AIChat 的 Android 客户端包。当前已完成阶段 8：正式分发准备。

## 当前范围

- `packages/mobile` 是 Expo + React Native TypeScript App。
- App 首次启动时由用户配置 AIChat 服务端根地址。
- 通过 `GET /api/settings/health` 检测服务端可达。
- 使用服务端返回的 Bearer token 调用认证接口。
- 使用 `expo-secure-store` 保存认证 token，并在 App 重启后恢复登录状态。
- token 失效或服务端返回 401 时清理本地 token 并回到登录页。
- 支持会话列表、新建会话、进入聊天页、加载历史消息。
- 支持发送文本消息到 `POST /api/chat/stream`。
- 支持 SSE 流式助手回复、停止生成和基础 Markdown 可读渲染。
- 支持生成可安装 Android APK，并记录安装、服务端配置和真机验收流程。
- Android 键盘弹出时聊天输入区保持可见。
- 流式回复只在用户接近底部时自动跟随；用户上滑阅读时不抢滚动，并提供“最新消息”按钮。
- 发送前网络失败会恢复输入草稿，不保留未被服务端确认的乐观消息。
- 流中断会保留已收到内容并提示下拉刷新同步服务端状态。
- SSE 在最后一行没有换行时仍能正确识别完成事件，减少误报流中断。

当前范围不做图片上传、文件上传、MCP、Skill、知识库、模型选择、会话删除/重命名、复杂 Markdown、管理后台或应用商店上架。

## 环境要求

- Node.js 18 或更高版本。
- pnpm 8 或更高版本。
- Java 17 或更高版本，推荐 JDK 17。
- Linux/WSL 本地构建需要 Linux 版 Android SDK，推荐路径为 `~/.local/share/android-sdk`。
- Android SDK Platform Tools，用于 `adb install` 和真机日志。WSL 中如果只安装了 Windows 版 SDK，可用 `adb.exe` 安装 APK，但不推荐用 Windows SDK 给 Linux Gradle 构建。
- Android 真机开启开发者选项和 USB 调试。

## 安装依赖

在仓库根目录执行：

```bash
pnpm install
```

## 开发启动

在仓库根目录执行：

```bash
pnpm mobile:start
```

然后用 Android 设备上的 Expo Go 扫描终端二维码。

也可以直接尝试打开 Android 设备或模拟器：

```bash
pnpm mobile:android
```

## 正式签名准备

release APK 必须使用长期保存的独立 keystore。仓库禁止提交 `*.keystore`、`*.jks`、密码、token 或签名环境文件。

首次准备密钥时执行：

```bash
pnpm --filter @aichat/mobile android:generate-keystore
```

默认生成到仓库外的 `~/.config/aichat-mobile/signing/`：

- `release.keystore`：长期发布密钥。
- `signing.env`：Linux/WSL 环境变量。
- `signing.cmd`：Windows cmd 环境变量。

生成脚本拒绝覆盖已有密钥。请立即对整个目录做加密离线备份；密钥丢失后无法继续覆盖升级已经分发的 App。

Linux/WSL 构建前加载：

```bash
set -a
source ~/.config/aichat-mobile/signing/signing.env
set +a
```

Windows cmd 构建前加载仓库外的配置：

```cmd
call %USERPROFILE%\.config\aichat-mobile\signing\signing.cmd
```

构建统一读取以下变量，缺少任何一项都会失败，绝不回退 debug keystore：

- `AICHAT_ANDROID_KEYSTORE_PATH`
- `AICHAT_ANDROID_KEYSTORE_PASSWORD`
- `AICHAT_ANDROID_KEY_ALIAS`
- `AICHAT_ANDROID_KEY_PASSWORD`

## 构建 APK

在仓库根目录执行：

```bash
pnpm --filter @aichat/mobile android:build-apk
```

该命令会执行：

1. `expo prebuild --platform android`
2. 将 Gradle wrapper 锁到 `8.14.3`
3. 自动发现 `ANDROID_HOME`/`ANDROID_SDK_ROOT` 或常见 Android SDK 路径
4. 自动发现 `JAVA_HOME` 或常见 JDK 17 路径
5. 使用外部 release keystore 执行 `:app:assembleRelease`
6. 自动验证签名、包名、版本和 SHA-256

APK 产物路径：

```text
packages/mobile/android/app/build/outputs/apk/release/app-release.apk
```

Windows 原生终端也可以在 `packages/mobile` 下执行：

```cmd
scripts\build-android-apk.cmd
```

`packages/mobile/android/` 是 Expo prebuild 生成的本地构建产物，已被仓库 `.gitignore` 忽略。

当前本地生成的 APK 信息：

```text
路径：packages/mobile/android/app/build/outputs/apk/release/app-release.apk
大小：70,832,503 bytes
SHA-256：a4084c6aae23505f0950f87090bb16f59b130dfd81236c3cd71cbf89562a5efb
包名：com.aichat.mobile
版本：0.1.0 (versionCode 1)
签名证书 SHA-256：2de04200f1e2cbc8263f33ecdd0a55cf78a0545d8e129a40edac076eb5c0ac10
```

开发调试 APK 使用显式命令，不会被当作正式产物：

```bash
pnpm --filter @aichat/mobile android:build-debug-apk
```

### 手工验证正式 APK

```bash
pnpm --filter @aichat/mobile android:verify-apk
```

底层等价验证命令：

```bash
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --verbose --print-certs packages/mobile/android/app/build/outputs/apk/release/app-release.apk
"$ANDROID_HOME/build-tools/36.0.0/aapt" dump badging packages/mobile/android/app/build/outputs/apk/release/app-release.apk
sha256sum packages/mobile/android/app/build/outputs/apk/release/app-release.apk
```

Windows SHA-256 命令：

```cmd
certutil -hashfile packages\mobile\android\app\build\outputs\apk\release\app-release.apk SHA256
```

### WSL 本地 SDK 准备

如果 WSL 里没有 Linux 版 Android SDK，可安装到用户目录：

```bash
mkdir -p ~/.local/share/android-sdk/cmdline-tools
curl -L -o /tmp/commandlinetools-linux.zip \
  https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip
unzip -q /tmp/commandlinetools-linux.zip -d /tmp/android-cmdline-tools
rm -rf ~/.local/share/android-sdk/cmdline-tools/latest
mv /tmp/android-cmdline-tools/cmdline-tools ~/.local/share/android-sdk/cmdline-tools/latest
yes | ~/.local/share/android-sdk/cmdline-tools/latest/bin/sdkmanager \
  --sdk_root="$HOME/.local/share/android-sdk" \
  "platform-tools" "platforms;android-36" "build-tools;36.0.0"
```

如果系统没有 JDK 17，可安装到用户目录：

```bash
mkdir -p ~/.local/share/jdks
curl -L -o /tmp/temurin17.tar.gz \
  https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse
rm -rf ~/.local/share/jdks/temurin-17 /tmp/temurin17
mkdir -p /tmp/temurin17
tar -xzf /tmp/temurin17.tar.gz -C /tmp/temurin17 --strip-components=1
mv /tmp/temurin17 ~/.local/share/jdks/temurin-17
```

## GitHub Actions 正式发布

普通 PR 和 push 只触发 `.github/workflows/mobile-ci.yml` 中的测试、类型检查和 Expo 配置检查，不构建正式 APK，也不读取签名密钥。

正式发布由 `.github/workflows/mobile-release.yml` 处理。GitHub `android-release` Environment 必须配置：

- `AICHAT_ANDROID_KEYSTORE_BASE64`
- `AICHAT_ANDROID_KEYSTORE_PASSWORD`
- `AICHAT_ANDROID_KEY_ALIAS`
- `AICHAT_ANDROID_KEY_PASSWORD`

流水线只接受与 `app.json` 的 `expo.version` 一致的 `mobile-v<versionName>` Tag。例如当前版本：

```bash
git tag mobile-v0.1.0
git push origin mobile-v0.1.0
```

流水线会构建并验证正式签名 APK、生成 SHA-256、上传 Actions Artifact、生成构建来源证明，并创建或更新 GitHub Release。手工补发只能选择已经存在且版本匹配的 Tag。

版本唯一来源是 `packages/mobile/app.json`：

- `expo.android.package`：Android applicationId，当前为 `com.aichat.mobile`。
- `expo.version`：`versionName`，当前为 `0.1.0`。
- `expo.android.versionCode`：当前为 `1`。
- `expo.extra.androidReleaseCertificateSha256`：长期发布证书的公开 SHA-256 指纹；本地和 GitHub 构建必须精确匹配。

每次准备新的可安装升级版本都必须递增 `versionCode`；发布语义版本时同时更新 `versionName`，再创建对应 Tag。

## 真机安装

确认电脑能看到真机：

```bash
adb devices
```

安装 APK：

```bash
adb install -r packages/mobile/android/app/build/outputs/apk/release/app-release.apk
```

如果在 WSL 中使用 Windows 版 Android SDK，可直接调用 `adb.exe`：

```bash
'/mnt/e/Program Files/Android/Sdk/platform-tools/adb.exe' install -r packages/mobile/android/app/build/outputs/apk/release/app-release.apk
```

部分设备的 streamed install 可能卡住，可改用 push 后由设备本地安装：

```bash
'/mnt/e/Program Files/Android/Sdk/platform-tools/adb.exe' push packages/mobile/android/app/build/outputs/apk/release/app-release.apk /data/local/tmp/aichat-app-release.apk
'/mnt/e/Program Files/Android/Sdk/platform-tools/adb.exe' shell pm install -r /data/local/tmp/aichat-app-release.apk
```

阶段 6/7 的 APK 使用 debug 签名，与阶段 8 正式签名不兼容。首次迁移必须卸载旧 App 后安装，会清除本地服务端地址和登录 token，但不会删除服务端会话；此后沿用同一 release keystore，即可使用 `adb install -r` 覆盖升级。

## 配置服务端地址

App 内填写 AIChat 后端根地址，例如：

```text
http://192.168.1.20:3001
```

注意事项：

- 不要填写 Web 前端地址，必须填写后端 API 所在地址。
- 真机不能用 `localhost` 访问电脑上的后端；应使用电脑在同一局域网中的 IP。
- 手机和后端机器需要在同一网络内，或后端地址必须能被手机直接访问。
- 当前 APK 已通过 Android manifest 允许访问明文 HTTP，便于局域网调试。
- 使用 USB 连接本机 WSL 后端时，可执行 `adb reverse tcp:8001 tcp:8001`，然后在 App 中填写 `http://127.0.0.1:8001`。

## 无法连接服务端排查

1. 在电脑上确认后端运行并可访问：

```bash
curl http://127.0.0.1:3001/api/settings/health
```

2. 查看电脑局域网 IP：

```bash
hostname -I
```

3. 在手机浏览器访问健康检查地址：

```text
http://<电脑局域网 IP>:3001/api/settings/health
```

4. 如果手机浏览器也打不开，优先检查：

- 后端是否监听在 `0.0.0.0`，而不是只监听 `127.0.0.1`。
- Windows 防火墙或安全软件是否拦截入站端口。
- 手机和电脑是否在同一个局域网或同一个 VPN 路由内。
- 服务端地址是否包含正确协议、IP 和端口。
- 如果使用 USB 反向代理，确认 `adb reverse --list` 中存在目标端口映射。

5. 如果浏览器能打开但 App 报错，使用：

```bash
adb logcat
```

查看 Android 运行日志。

## 阶段 6 真机验收结果

本次验收设备通过 `adb devices` 识别为 `3c730137 device`。测试后端地址为 `http://127.0.0.1:8001`，通过 `adb reverse tcp:8001 tcp:8001` 映射到 WSL 中运行的后端。

1. 通过：APK 可安装并打开。
2. 通过：可配置服务端地址 `http://127.0.0.1:8001`。
3. 通过：测试用户 `apktest` 可登录。
4. 通过：登录后进入会话列表。
5. 通过：可进入已有会话 `APK 真机验收`。
6. 通过：可看到历史消息。
7. 通过：可发送文本消息。
8. 通过：助手回复通过 SSE 持续更新，真机中能看到生成中内容逐步出现。
9. 通过：生成中可点击停止按钮，页面显示 `已停止生成。` 并恢复输入。
10. 通过：标题、列表、加粗和行内代码等基础 Markdown 可读。
11. 通过：更换后端 `JWT_SECRET` 后，已保存 token 失效，下一次认证请求清理本地 token 并回到登录页。
12. 通过：移除 `adb reverse` 模拟网络不可达后，聊天页显示 `无法连接服务端，请确认网络和服务端地址。`，输入区恢复可用，并提供刷新入口。

## 阶段 7 使用与验证

自动检查：

```bash
pnpm --filter @aichat/mobile test
pnpm mobile:type-check
```

阶段 7 新增的流解析测试覆盖：

- 完成事件位于流末尾且没有换行。
- 不完整事件跨字节块保留缓冲。
- 只有部分内容、没有完成事件时仍判定为流中断。

### 阶段 7 真机验收结果

验收设备仍为 `3c730137 device`。新版 release APK 通过 `adb install -r` 覆盖安装；测试使用隔离数据库、专用账号和本地 OpenAI 兼容流式模型桩，不调用真实模型或共享服务端。

1. 通过：新版 APK 可覆盖安装并冷启动，启动日志无 AIChat 崩溃或 React Native 异常。
2. 通过：登录后进入会话列表，已有会话、消息数量和最近回复可见。
3. 通过：进入 `APK 真机验收` 会话并加载历史消息。
4. 通过：发送 `stage7-core-flow` 后，后端收到流式请求，助手内容逐步到达，完成后自动刷新历史。
5. 通过：流式生成期间停止操作可恢复输入状态，页面不会锁死。
6. 通过：Android 软键盘弹出后，聊天输入框从屏幕底部上移到键盘上方，仍可见且可输入。
7. 通过：长历史消息可滚动查看；离开底部时停止强制跟随，并提供 44dp 高的“最新消息”按钮返回底部。
8. 通过：移除 `adb reverse tcp:8001` 后发送消息，页面显示网络错误和刷新入口，原输入草稿被恢复，发送按钮重新可用；恢复 reverse 后可继续使用。
9. 通过：后端轮换测试 JWT 后，下次认证请求返回登录页并清理本地登录态，聊天页未卡死。
10. 通过：release APK 构建、3 项流解析测试、TypeScript 类型检查和 `git diff --check` 均通过。

阶段 7 仍有以下限制：

- “停止生成”的效果取决于服务端和模型供应商对取消请求的响应速度；客户端会立即恢复可操作状态。
- 当前只渲染基础 Markdown；复杂表格、语法高亮和横向代码块工具栏未纳入本阶段。
- 该条是阶段 7 的历史限制；阶段 8 已改为独立 release keystore。

## 类型检查

```bash
pnpm mobile:type-check
```

## 阶段 8 正式分发验收结果

本次使用设备 `3c730137 device`、隔离数据库、专用账号和本地 OpenAI 兼容流式模型桩，不调用真实模型或共享服务端。

1. 通过：正式 APK 使用独立 `AIChat Mobile Release` 证书签名，不再使用 Android debug 证书。
2. 通过：APK 包名为 `com.aichat.mobile`，版本为 `0.1.0 (versionCode 1)`，签名、包名、版本和 SHA-256 自动验证通过。
3. 通过：历史 debug 签名 APK 直接覆盖时返回 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`，与一次性迁移设计一致。
4. 通过：卸载旧包后可安装正式签名 APK，冷启动正常。
5. 通过：可配置服务端、登录、进入会话列表，并加载 `APK 真机验收` 的历史消息。
6. 通过：发送 `stage8-final-stream` 后，助手内容逐步到达并完整显示，输入区恢复可用。
7. 通过：流式生成期间点击停止后显示 `已停止生成。`，页面和输入区不锁死。
8. 通过：移除 `adb reverse tcp:8001` 后显示明确网络错误，原输入草稿恢复，发送按钮重新可用；恢复 reverse 后可继续使用。
9. 通过：轮换隔离后端 JWT 后，下一次认证请求清理 token 并返回登录页，页面未卡死。
10. 通过：使用同一正式签名 APK 执行 `pm install -r` 覆盖安装成功，后续升级签名链路成立。
11. 通过：移动端 5 项测试、TypeScript 类型检查、Expo prebuild 和正式 release 构建通过。

当前限制：

- 尚未创建第一个 `mobile-v0.1.0` Tag，因此 GitHub Release workflow 已配置但未实际触发；避免在阶段验收期间意外发布正式 Release。
- GitHub `android-release` Environment 已保存四项签名 Secrets，但 keystore 仍必须由项目负责人另行做加密离线备份。
- Windows 原生构建脚本已按同一 Node 入口实现，本阶段环境为 WSL，无法把 Windows 原生执行结果冒充为已验证。
- 当前仅分发 APK，不包含 Play Console、AAB 或应用商店上架。
