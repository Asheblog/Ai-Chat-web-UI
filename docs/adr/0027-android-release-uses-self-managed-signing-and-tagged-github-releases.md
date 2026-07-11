---
status: accepted
---

# Android 正式发布使用自持签名与 Tag 驱动的 GitHub Release

AIChat Mobile 使用仓库外长期保存的独立 release keystore 作为唯一移动端发布身份，本地构建通过环境变量注入，GitHub Actions 通过 `android-release` Environment Secrets 注入同一密钥；普通 push 和 PR 只运行无密钥质量检查，只有与 `app.json` 版本一致的 `mobile-v<versionName>` Tag 才构建、验证并发布正式 APK。该方案在不依赖 EAS 或应用商店的前提下提供可重复、可交接的 GitHub Releases 分发链路；代价是项目负责人必须离线备份 keystore，首次从历史 debug 签名迁移时需要卸载旧 App，此后每次发布必须递增 `versionCode` 并沿用同一签名身份。
