# AIChat Mobile (Android + iOS)

AIChat Mobile 是基于 **Expo SDK 56 + React Native 0.85 + TypeScript** 重构的跨平台原生客户端（支持 Android 与 iOS / iPadOS），视觉设计遵循项目 **Ink & Mist** 浅色雾纸与深色墨绿美学。

- Figma 设计稿：[AIChat Mobile — Ink & Mist UI](https://www.figma.com/design/rwYFsmLNiRYjKWSqnFrQY4)（文档索引见 [mobile-ui-design.md](../../.figma/mobile-ui-design.md)）
- 架构决策：[ADR 0051](../../docs/adr/0051-mobile-cross-platform-ink-mist-and-unsigned-ci.md)

## 核心功能

- **多服务器连接与安全持久化**：支持局域网 HTTP 与公网 HTTPS、`/api/settings/health` 连通性检查、多服务器配置保存与切换，按服务器隔离存储 Bearer Token（`expo-secure-store`）。
- **完整流式对话体验**：模型分组切换（含推理/视觉标签）、可折叠 CoT 思维链与工具时间轴、Rich Markdown（代码块一键复制、LaTeX 公式卡片、横向滚动表格）、长按操作菜单（复制 / 引用回复 / 重新生成 / 系统分享）。
- **多模态与文档上传**：相机拍照与相册多选发图（每条最多 8 张；单张最多 15 MB、单边最多 8192 px，合计最多 60 MB）、文档上传（`/api/documents/upload`）及会话文档管理、AI 生成图片全屏预览/保存相册/系统分享。
- **能力扩展与主题同步**：支持深度思考力度、联网搜索（`web-search`）、知识库绑定、保存会话 Skill 开关与查看 MCP 工具；支持外观切换（跟随系统/浅色/深色）与服务端品牌色同步（`/api/settings/branding`），以及个人设置同步（`/api/settings/personal`）。
- **原生增强**：触觉反馈（`expo-haptics`）、在 Android 的系统分享菜单中接收纯文本；双端也可通过 `aichat://share?text=...` 导入文本。语音输入使用系统键盘听写。

## 本地开发与校验

在仓库根目录执行：

```bash
pnpm install
pnpm --filter @aichat/shared build
pnpm mobile:type-check
pnpm mobile:test
pnpm mobile:start
```

## 无付费证书构建

### Android APK（免付费自签名）

要在没有旧版的设备上试装，不必配置 GitHub Secrets 或商业证书。请先准备 JDK 17、Android SDK 36（Build Tools 36.0.0）、NDK 27.1.12297006 和 CMake 3.22.1，再运行：

```bash
pnpm --filter @aichat/mobile android:build-apk
```

产物路径：`packages/mobile/android/app/build/outputs/apk/release/app-release.apk`。四项签名变量全部留空时，CI 每次生成临时证书；不同运行的试装 APK 不能互相覆盖，也不能覆盖[历史 APK](https://github.com/Asheblog/Ai-Chat-web-UI/releases/tag/mobile-v0.1.0)。卸载旧包会清除本机保存的服务端配置和登录状态。

要覆盖升级历史正式版，请保留原发布 keystore 并递增 `packages/mobile/app.json` 中的 `expo.android.versionCode`。本地构建配置 `AICHAT_ANDROID_KEYSTORE_PATH`、`AICHAT_ANDROID_KEYSTORE_PASSWORD`、`AICHAT_ANDROID_KEY_ALIAS` 和 `AICHAT_ANDROID_KEY_PASSWORD`；本地设置 `AICHAT_REQUIRE_PINNED_CERT=1` 可强制验证原证书。CI 在 `android-release` 环境用 `AICHAT_ANDROID_KEYSTORE_BASE64` 替代本地的路径变量，另外三项名称相同。只配置部分变量会失败；使用外部密钥的 Release 必须通过原证书指纹校验。

### iOS 未签名 `.ipa`（供侧载安装）

在 macOS（含 Xcode 与 CocoaPods）环境执行：

```bash
pnpm --filter @aichat/mobile ios:build-unsigned-ipa
```

该脚本会通过 `CODE_SIGNING_ALLOWED=NO` 编译 `iphoneos` (`arm64`) Release `.app` 并打包为 `packages/mobile/dist/aichat-mobile-<version>-ios-unsigned.ipa`。

安装方式（无需 \$99 Apple Developer 账号）：
- **TrollStore（巨魔）**：在受支持的设备和 iOS 版本上导入 `.ipa`。
- **AltStore / SideStore / Sideloadly / 爱思助手**：使用个人免费 Apple ID 本地签名并侧载到 iPhone / iPad。

## GitHub Actions CI & Release

- **`.github/workflows/mobile-ci.yml`**：PR / push `main`（或手动触发）自动运行类型检查、单元测试、Expo 配置校验，并分别在 `ubuntu-24.04` 构建 Android APK、在 `macos-15` 构建 iOS 未签名 `.ipa` 上传为 Artifacts。
- **`.github/workflows/mobile-release.yml`**：推送 `mobile-v<version>` Tag（例如 `mobile-v1.0.0`，须与 `packages/mobile/app.json` 及 `packages/mobile/package.json` 版本一致且已合入 `main`），自动构建并发布包含 `.apk`、`-ios-unsigned.ipa` 与 `.sha256` 的 GitHub Release。
