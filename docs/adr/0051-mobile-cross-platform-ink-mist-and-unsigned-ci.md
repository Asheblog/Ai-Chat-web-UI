---
status: accepted
---

# 移动端重构为 Android + iOS 跨平台原生应用，并启用无签名 GitHub CI 发布

## 背景

此前 `packages/mobile` 仅包含面向 Android 的早期聊天 MVP（暂停了 GitHub CI 发布），视觉沿用通用蓝色，缺少 iOS 支持、多模态、知识库/MCP/Skill 扩展及多服务器管理能力。项目方无付费 Apple Developer 账号，希望在重构 Android 与 iOS 双端的同时，通过 GitHub Actions 产出可直接安装的 Android APK 与未签名 iOS `.ipa`（供侧载使用）。

## 决策

1. **继续以 Expo SDK 56 + React Native 0.85 为双端载体**：复用 `@aichat/shared`（SSE 解析、CoT 时间轴、品牌主题、LaTeX 归一化、图片限制），新增多服务器隔离持久化、相机/相册/文档上传、模型与扩展管理、Markdown/代码/公式渲染及平板分栏自适应。
2. **UI 对齐 Web 端 Ink & Mist 视觉规范**：在 Figma 建立独立设计文件（`rwYFsmLNiRYjKWSqnFrQY4`），实现浅色雾纸与深色墨绿双模式语义变量，并同步服务端 `/api/settings/branding` 品牌色。
3. **恢复移动端 GitHub CI 和 Release，增加无需付费证书的分发路径**：
   - **Android 试装**：四项签名变量都未配置时，`keytool` 生成临时自签名证书，产出可全新安装的 APK。CI 每次生成新证书，无法覆盖升级历史 APK 或上次 CI 的试装包。
   - **Android 覆盖升级**：沿用 [ADR 0027](0027-android-release-uses-self-managed-signing-and-tagged-github-releases.md) 的原证书与递增的 `versionCode`；签名配置不完整时构建失败，正式发布校验原证书指纹。
   - **iOS 侧载**：在 `macos-15` 上以 `CODE_SIGNING_ALLOWED=NO` 编译 `arm64` Release 包并封装 `Payload/*.app`。未签名 IPA 需由侧载工具签名，或由兼容的 TrollStore 设备直接导入。
   - **发布门槛**：`mobile-ci.yml` 构建 PR / `main` 的试装产物；`mobile-release.yml` 只发布版本匹配、提交已进入 `origin/main` 的 `mobile-vX.Y.Z` Tag，不覆盖历史资产。

本决定替代 [ADR 0049](0049-desktop-reuses-hosted-web-and-separates-release.md) 中暂停 Android 自动构建和发布的一条：双端需要可复验的安装产物，试装不再依赖长期证书。原 Android 发布身份、历史产物及桌面发布流程均沿用各自的约定。
