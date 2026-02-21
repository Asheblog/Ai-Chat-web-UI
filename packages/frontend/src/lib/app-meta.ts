export const APP_VERSION = 'v2.0.0'

export const PROJECT_URL = 'https://github.com/Asheblog/Ai-Chat-web-UI'

export const APP_COMMIT_BASE_URL = 'https://github.com/Asheblog/aichat/commit'

export const APP_UPDATE_DATE = '2026-02-21'

export const APP_UPDATE_SCOPE = '未推送变更摘要'

export const APP_UPDATE_NOTES = [
  {
    commit: '89eee64',
    summary: '新增 Skill 管理系统，包含数据库模型与前端集成。',
  },
  {
    commit: '7e284df',
    summary: '引入 Skill 插件机制，支持可扩展工具执行。',
  },
  {
    commit: '0fb1217',
    summary: '新增 Skill 执行审计日志能力。',
  },
  {
    commit: 'b036be8',
    summary: '后端新增 db:deploy 脚本并改进数据库初始化错误处理。',
  },
  {
    commit: 'b49dda3',
    summary: '聊天输入区增加 Skill 面板抽屉，支持快速管理。',
  },
  {
    commit: '3f18f4b',
    summary: '修复关闭加号菜单后立即打开 Skill 面板的时序问题。',
  },
  {
    commit: '90ef020',
    summary: '增强内置 Skill 展示，补充标签与描述信息。',
  },
  {
    commit: '025d045',
    summary: '优化设置页中的 Skill 审计日志与绑定管理 UI。',
  },
  {
    commit: '6ce57ca',
    summary: '实现 Skill 存储持久化并完善相关文档。',
  },
] as const
