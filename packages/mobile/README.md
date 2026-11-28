# AIChat Mobile (Android + iOS)

AIChat Mobile 是基于 **Expo SDK 56 + React Native 0.85 + TypeScript** 重构的跨平台原生客户端（支持 Android 与 iOS / iPadOS），视觉设计遵循项目 **Ink & Mist** 浅色雾纸与深色墨绿美学。

- Figma 设计稿：[AIChat Mobile — Ink & Mist UI](https://www.figma.com/design/rwYFsmLNiRYjKWSqnFrQY4)（文档索引见 [mobile-ui-design.md](../../.figma/mobile-ui-design.md)）
- 架构决策：[ADR 0050](../../docs/adr/0050-mobile-cross-platform-ink-mist-and-unsigned-ci.md)

## 核心功能

- **多服务器连接与安全持久化**：支持局域网 HTTP 与公网 HTTPS、`/api/settings/health` 连通性检查、多服务器配置保存与切换，按服务器隔离存储 Bearer Token（`expo-secure-store`）。
- **完整流式对话体验**：模型分组切换（含推理/视觉标签）、可折叠 CoT 思维链与工具时间轴、Rich Markdown（代码块一键复制、LaTeX 公式卡片、横向滚动表格）、长按操作菜单（复制 / 引用回复 / 重新生成 / 系统分享）。
- **多模态与文档上传**：相机拍照与相册多选发图、文档上传（`/api/documents/upload`）及会话文档管理、AI 生成图片全屏预览/保存相册/系统分享。
- **能力扩展与主题同步**：支持深度思考力度、联网搜索（`web-search`）、知识库绑定、会话 Skill 与 MCP 工具展示；支持外观切换（跟随系统/浅色/深色）与服务端品牌色同步（`/api/settings/branding`），以及个人设置同步（`/api/settings/personal`）。
- **原生增强**：触觉反馈（`expo-haptics`）、Deep Link 分享文本导入（`aichat://share?text=...`）及 Android `ACTION_SEND` 接收、键盘语音听写提示桥接。

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

无需配置任何商业签名或 GitHub Secrets；若未提供 `AICHAT_ANDROID_KEYSTORE_*` 环境变量，构建脚本会自动生成本地自签名 keystore 并产出可直接安装的 Release APK：

```bash
pnpm --filter @aichat/mobile android:build-apk
```

产物路径：`packages/mobile/android/app/build/outputs/apk/release/app-release.apk`。

### iOS 未签名 `.ipa`（供侧载安装）

在 macOS（含 Xcode 与 CocoaPods）环境执行：

```bash
pnpm --filter @aichat/mobile ios:build-unsigned-ipa
```

该脚本会通过 `CODE_SIGNING_ALLOWED=NO` 编译 `iphoneos` (`arm64`) Release `.app` 并打包为 `packages/mobile/dist/aichat-mobile-<version>-ios-unsigned.ipa`。

安装方式（无需 \$99 Apple Developer 账号）：
- **TrollStore（巨魔）**：直接导入 `.ipa` 永久安装。
- **AltStore / SideStore / Sideloadly / 爱思助手**：使用个人免费 Apple ID 本地签名并侧载到 iPhone / iPad。

## GitHub Actions CI & Release

- **`.github/workflows/mobile-ci.yml`**：PR / push `main`（或手动触发）自动运行类型检查、单元测试、Expo 配置校验，并分别在 `ubuntu-24.04` 构建 Android APK、在 `macos-15` 构建 iOS 未签名 `.ipa` 上传为 Artifacts。
- **`.github/workflows/mobile-release.yml`**：推送 `mobile-v<version>` Tag（例如 `mobile-v1.0.0`，须与 `packages/mobile/app.json` 及 `packages/mobile/package.json` 版本一致且已合入 `main`），自动构建并发布包含 `.apk`、`-ios-unsigned.ipa` 与 `.sha256` 的 GitHub Release。
