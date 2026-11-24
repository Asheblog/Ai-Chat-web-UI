# AI Chat 桌面客户端

打开客户端，填写你部署的 AI Chat 根地址（例如 `https://chat.example.com`），使用原来的站点账号登录。地址不能带子路径、查询参数或 `/api`。首版支持 Windows x64 和 Apple Silicon Mac。

- **换服务器**：打开「更多 → 更换服务器…」。只有新站点验证并加载成功后，才会替换保存的地址。
- **连不上**：确认浏览器可以打开首页，且反向代理保留前端的 `/api/health`。已有分流代理如果把该路径转给后端并返回 404，客户端会用 `/main` 的页面标识和 `/api/settings/health` 检查兼容性。HTTPS 要使用系统信任的证书；如果浏览器最终打开的是 HTTPS，请直接填 HTTPS 地址。非回环 HTTP 首次连接时需确认风险，成功连接后会记住该地址的选择。

## 下载与本地构建

从 [Desktop CI](https://github.com/Asheblog/Ai-Chat-web-UI/actions/workflows/desktop-ci.yml) 的运行详情下载对应平台的 Artifact，解压后打开安装包。测试包没有正式签名，仅用于验证。Windows 双击 `.exe` 并选择目录；macOS 打开 `.dmg` 后将应用拖到「应用程序」。Windows SmartScreen 或 macOS Gatekeeper 拦截时，优先使用 [GitHub Releases](https://github.com/Asheblog/Ai-Chat-web-UI/releases) 的签名版。

在仓库根目录使用 Node.js 22 LTS（≥22.12）与 pnpm 8.15.0：

```sh
pnpm --filter @aichat/desktop install --frozen-lockfile
pnpm --filter @aichat/desktop test
pnpm --filter @aichat/desktop dev
pnpm --filter @aichat/desktop dist:win  # 在 Windows 构建 x64 NSIS 安装包
pnpm --filter @aichat/desktop dist:mac  # 在 macOS 构建 Apple Silicon DMG
```

安装包输出到 `packages/desktop/dist/`。改图标时更新 [Figma 组件](https://www.figma.com/design/PTSZ16kK9wNhIWi4MUNzwC/?node-id=3-286) 和 [SVG 源图](build/icon.svg)，再运行 `python packages/desktop/build/make-icons.py`（需要 Pillow 和 Chromium 系浏览器）。

## 正式发布

[Desktop Release](../../.github/workflows/desktop-release.yml) 只接受指向 main 已合入提交、且与 [桌面包版本](package.json) 相同的 `desktop-vX.Y.Z` Tag。发布前由维护者配置下列 GitHub Environments；Windows 安装器及其中的应用须通过签名与时间戳校验；macOS 须通过 DMG 完整性、盘内应用签名和公证凭证校验。两端都通过才发布。

| Environment | Secrets |
| --- | --- |
| `desktop-signing-windows` | `WIN_CSC_LINK`（base64 PFX）、`WIN_CSC_KEY_PASSWORD` |
| `desktop-signing-macos` | `CSC_LINK`（base64 Developer ID Application .p12）、`CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` |
