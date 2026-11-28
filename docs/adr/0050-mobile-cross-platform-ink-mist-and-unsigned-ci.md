---
status: accepted
---

# 移动端重构为 Android + iOS 跨平台原生应用，并启用无签名 GitHub CI 发布

## 背景

此前 `packages/mobile` 仅包含面向 Android 的早期聊天 MVP（暂停了 GitHub CI 发布），视觉沿用通用蓝色，缺少 iOS 支持、多模态、知识库/MCP/Skill 扩展及多服务器管理能力。项目方无付费 Apple Developer 账号，希望在重构 Android 与 iOS 双端的同时，通过 GitHub Actions 产出可直接安装的 Android APK 与未签名 iOS `.ipa`（供侧载使用）。

## 决策

1. **继续以 Expo SDK 56 + React Native 0.85 为双端载体**：复用 `@aichat/shared`（SSE 解析、CoT 时间轴、品牌主题、LaTeX 归一化、图片限制），新增多服务器隔离持久化、相机/相册/文档上传、模型与扩展管理、Markdown/代码/公式渲染及平板分栏自适应。
2. **UI 对齐 Web 端 Ink & Mist 视觉规范**：在 Figma 建立独立设计文件（`rwYFsmLNiRYjKWSqnFrQY4`），实现浅色雾纸与深色墨绿双模式语义变量，并同步服务端 `/api/settings/branding` 品牌色。
3. **无付费证书 GitHub CI 与 Release 流水线**：
   - Android：当未注入外部 keystore 环境变量时，本地与 CI 自动通过 `keytool` 生成自签名 keystore 产出可直接安装的 Release APK；如后续配置了仓库 Secrets，可无缝切换为长期升级签名。
   - iOS：在 `macos-15` Runner 上以 `CODE_SIGNING_ALLOWED=NO` 编译 `arm64` Release 包并封装 `Payload/*.app` 为未签名 `.ipa`，供 TrollStore / AltStore / SideStore / Sideloadly 等工具侧载。
   - 发布边界：`mobile-ci.yml` 负责 PR/Push Artifact 构建，`mobile-release.yml` 由 `mobile-vX.Y.Z` Tag 触发并校验 Tag 属于 `origin/main` 后统一发布 Release。
