---
status: accepted
---

# 连接组是模型连接的一等身份

原先按 API Key 行存储连接，并在 UI 层用端点签名聚合、以最小行 ID 充当组身份；增删 Key 会删除行，导致代表 ID 漂移，且同组多 Key 会在模型目录与选择器中复制同名模型。现改为引入稳定的 Connection Group：端点配置与显示名挂在组上，Key 降为组内凭据，Model Catalog 与会话/偏好绑定改挂组主键。拒绝「只改 UI 拼文案」和「仅加 displayName 仍用最小 Key ID」——两者都无法消除身份漂移与目录重复。
