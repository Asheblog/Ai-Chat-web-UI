# AIChat Mobile

AIChat Mobile 是 AIChat 的 Android 客户端包。当前处于阶段 6：APK 打包。

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

当前阶段不做图片上传、文件上传、MCP、Skill、知识库、模型选择、会话删除/重命名、复杂 Markdown、UI 打磨或管理后台。

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

## 构建 APK

在仓库根目录执行：

```bash
pnpm --filter @aichat/mobile android:build-apk
```

该命令会执行：

1. `expo prebuild --platform android`
2. 将 Gradle wrapper 锁到 `8.14.3`
3. 自动优先使用 `~/.local/share/android-sdk`
4. 自动优先使用 `~/.local/share/jdks/temurin-17`
5. `android/gradlew --no-daemon --no-watch-fs :app:assembleRelease`

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
大小：68M
SHA-256：63eef7c32136834a35772663424210062ed60f47a602aadd1a89325f0948dfff
```

### 签名说明

当前阶段 6 产物是可安装、可验收的本地 release APK。Expo prebuild 生成的 Android 工程默认用 debug keystore 签名 release build：

```gradle
release {
  signingConfig signingConfigs.debug
}
```

这适合本地真机安装验证，不适合作为正式分发或上架签名。正式分发建议后续使用 EAS Build 或配置独立 release keystore。

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

## 正式 Release 推荐方式

当前仓库不提交 Android release keystore，也不把签名密钥写入源码仓库。因此正式分发不应直接使用 debug keystore 签名的本地 APK。

如需要可分发 release APK，推荐使用 EAS Build 的 APK profile：

```bash
pnpm --filter @aichat/mobile exec eas build --platform android --profile preview-apk
```

`packages/mobile/eas.json` 已提供：

- `preview-apk`：生成可直接安装的 APK。
- `debug-apk`：通过 EAS 执行 `:app:assembleDebug`。
- `production`：生成 Android App Bundle，适合后续上架或正式签名流程。

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

如果设备已经安装过签名不同的同包名应用，先在手机上卸载旧的 `AIChat Mobile`，再重新安装。

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

## 类型检查

```bash
pnpm mobile:type-check
```
