---
status: accepted
---

# 桌面端复用已部署的 Web 界面，测试包和签名发布分开

> 正式发布已改为不签名、不公证（缺少签名凭据），见 [ADR 0050](0050-desktop-release-ships-unsigned-artifacts.md)。本文中「两端签名校验通过后才发布」一条随之失效，其余结论不变。

Windows x64 与 Apple Silicon macOS 通过 Electron 加载已部署的 AI Chat 站点。桌面包只实现窗口、连接、恢复与系统集成；聊天、登录和管理继续由 Web 端提供。相比维护一套桌面业务界面，这让站点和客户端独立升级，也无需让客户端保存密码或另取 API Token。

连接检查优先用前端健康接口识别 AI Chat；分流代理把该接口转给后端并返回 404 时，检查同源 `/main` 的页面标识和后端健康状态。探针不携带用户会话、不跟随跳转；地址验证且页面加载成功后才保存。远程页面在没有桌面桥接的沙箱视图中运行，不同站点的 Cookie 独立保存，站内预览沿用同站点会话。普通外链交给系统浏览器。HTTPS 证书验证不能跳过，非回环 HTTP 必须先确认风险。

桌面主窗口保留一行 44 px 的本地标题栏与原生窗口控件，远程站点只占下方视图区。换站、编辑和视图操作从标题栏的「更多」进入；窄窗把当前站点移到菜单里。

PR 和 main 构建不签名的测试包。正式发布由指向 main 已合入提交、且和客户端版本一致的 tag 指定；两端签名校验通过后才发布。桌面测试包由 CI 在拉取请求和 main 更新时构建，不签名也不创建 Release。正式发布由指向 main 已合入提交、且和客户端版本一致的 tag 指定；Windows 安装器与 macOS DMG 需分别通过签名、公证校验后才发布。Android 发布状态见 [ADR 0027](0027-android-release-uses-self-managed-signing-and-tagged-github-releases.md)。
