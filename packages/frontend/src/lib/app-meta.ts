export const APP_VERSION = 'v2.1.0'

export const PROJECT_URL = 'https://github.com/Asheblog/Ai-Chat-web-UI'

export const APP_COMMIT_BASE_URL = 'https://github.com/Asheblog/aichat/commit'

export const APP_UPDATE_DATE = '2026-03-02'

export const APP_UPDATE_SCOPE = 'origin/main 最近 8 条推送提交'

export const APP_UPDATE_NOTES = [
  {
    commit: 'c2756b4',
    summary: '新增自动读取网页能力，支持错误码与 HTTP 状态分类处理并同步前端展示。',
  },
  {
    commit: '568559b',
    summary: '实现聊天上下文压缩能力，补充数据库迁移、接口与配置项。',
  },
  {
    commit: '77e028b',
    summary: '更新侧边栏会话分组逻辑，新增会话置顶支持。',
  },
  {
    commit: 'ed68417',
    summary: 'Battle 服务与前端新增 tool call 事件处理与展示。',
  },
  {
    commit: '5808b31',
    summary: '统一 tool call 事件结构，标准化为 normalized tool_call payload。',
  },
  {
    commit: '86e3857',
    summary: '增强响应式设计并修复 matchMedia 兼容性问题，优化按钮样式与交互。',
  },
  {
    commit: '73c62ef',
    summary: '优化聊天输入区 UI 与交互，改进附件菜单和多端输入体验。',
  },
  {
    commit: '1b3203e',
    summary: '新增提示词模板、会话知识库选择及分享消息分页能力。',
  },
] as const
