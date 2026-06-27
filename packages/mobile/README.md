# AIChat Mobile

AIChat Mobile 是 AIChat 的 Android 客户端包。当前只处于阶段 1：环境和空 Expo App。

## 当前范围

- 新增 `packages/mobile` Expo TypeScript App。
- 接入 pnpm workspace。
- 提供 Android 真机可打开的空首页。

当前阶段不连接后端，不实现服务器地址配置，不实现登录，也不实现聊天。

## 环境要求

- Node.js 18 或更高版本。
- pnpm 8 或更高版本。
- Android 真机安装 Expo Go，或本机配置 Android Emulator。

## 安装依赖

在仓库根目录执行：

```bash
pnpm install
```

## 启动

在仓库根目录执行：

```bash
pnpm mobile:start
```

然后用 Android 设备上的 Expo Go 扫描终端二维码。

也可以直接尝试打开 Android 设备或模拟器：

```bash
pnpm mobile:android
```

## 验证

1. Android 设备能打开 `AIChat Mobile`。
2. 首页显示“空首页已就绪”。
3. 点击“运行检查”后，页面显示最近检查时间。
4. 页面不出现服务器地址、登录或聊天功能。

## 类型检查

```bash
pnpm mobile:type-check
```
