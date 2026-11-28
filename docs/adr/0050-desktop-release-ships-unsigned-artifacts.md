---
status: accepted
---

# 桌面正式发布改用未签名产物

桌面正式发布原本要求两端分别通过代码签名与公证校验。维护者既没有 Windows 代码签名证书，也没有加入 Apple Developer Program，`desktop-signing-windows` / `desktop-signing-macos` 两个 Environment 的凭据一直为空；流水线会在 secret 预检步骤直接失败，正式发布这条路径事实上不可用。

决定：正式发布产出未签名的安装包。`desktop-release.yml` 移除两段 secret 预检、Windows 的 Authenticode 校验和 macOS 的签名/公证校验，构建命令与 `desktop-ci.yml` 保持一致——设 `CSC_IDENTITY_AUTO_DISCOVERY=false`，macOS 不再传 `-c.mac.notarize=true`。保留的校验只覆盖产物本身：安装包存在、Windows payload 为 x64 PE、macOS payload 为 arm64、DMG 通过 `hdiutil verify`，以及两个 `.sha256` 校验文件。

两个 Environment 和 7 个 Secret 名称保留在仓库设置里（`desktop-signing-windows`：`WIN_CSC_LINK`、`WIN_CSC_KEY_PASSWORD`；`desktop-signing-macos`：`CSC_LINK`、`CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`）。工作流仍引用这两个 Environment，因此「只有 `desktop-v*` Tag 能部署」的门禁继续生效。

代价：Windows 安装包在 SmartScreen 里显示未知发布者，用户要点「更多信息 → 仍要运行」；macOS 下载的 DMG 带隔离属性，首次启动会被 Gatekeeper 拦下，需在「系统设置 → 隐私与安全性」点「仍要打开」。产物也不再绑定可验证的发布者身份，用户无法用签名区分官方构建与第三方重打包——安装包只应从本仓库 Release 或 Actions 产物获取，并用 Release 附带的 `.sha256` 校验。

恢复签名的做法：配好上表 7 个 Secret，再还原两段预检、`Verify Authenticode signatures`、`Verify signature and notarization`，以及构建步骤里的 secret 注入和 `-c.mac.notarize=true`。改动都落在同一个工作流文件里，是对本次变更的直接回退。

本 ADR 只废止 [ADR 0049](0049-desktop-reuses-hosted-web-and-separates-release.md) 中「两端签名校验通过后才发布」这一条；桌面端复用 Web 界面、测试包与正式发布分开的结论不变。
