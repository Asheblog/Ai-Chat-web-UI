---
status: accepted
---

# Android 客户端使用 React Native + Expo

AIChat Android 客户端将作为真实可安装 APK 开发，而不是简单网页壳；首版使用 React Native + Expo 放在 `packages/mobile`，由用户在客户端内配置服务端地址，并通过 Bearer token 调用现有后端 API。该选择优先复用项目现有 TypeScript 生态和后端契约，避免在首版同时引入 Kotlin、Gradle、Jetpack Compose 和完整原生 Android 学习成本；代价是 SSE、Markdown、文件能力等移动端细节需要单独验证和适配。
