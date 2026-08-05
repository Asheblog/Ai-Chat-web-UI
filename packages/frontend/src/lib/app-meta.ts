export const APP_HEAD_COMMIT = 'a283de0'

/** 最新提交时间（本地时区，分钟精度） */
export const APP_HEAD_COMMIT_AT = '2026-08-05 14:22'

/**
 * 系统版本标识：提交时间 + 短 commit。
 * 用于关于页、health 等展示；不再使用 semver。
 */
export const APP_VERSION = `${APP_HEAD_COMMIT_AT} · ${APP_HEAD_COMMIT}`

export const PROJECT_NAME = 'AIChat'

export const PROJECT_URL = 'https://github.com/Asheblog/Ai-Chat-web-UI'

/** 侧栏页脚展示用短地址（无协议） */
export const PROJECT_HOST_PATH = 'github.com/Asheblog/Ai-Chat-web-UI'

export const APP_COMMIT_BASE_URL = 'https://github.com/Asheblog/Ai-Chat-web-UI/commit'

export const APP_UPDATE_DATE = '2026-08-05'

export const APP_UPDATE_SCOPE = 'origin/main 最近 8 条推送提交'

export const APP_UPDATE_NOTES = [
  {
    commit: 'a283de0',
    summary: '移除多选消息分享工具栏中的冗余入口。',
  },
  {
    commit: '78ea8dd',
    summary: '恢复对话栏最大宽度，并去掉登录/注册页重复的品牌标题。',
  },
  {
    commit: 'd790972',
    summary: '扁平化 Claude 风格画布，统一暖色背景与流式消息排版。',
  },
  {
    commit: '14ec31a',
    summary: '修复刷新后 CoT 进行中正文被截断、不再继续增长的问题。',
  },
  {
    commit: '13cd105',
    summary: '统一 Claude 风格设计令牌，并支持管理员覆盖品牌主题色。',
  },
  {
    commit: 'f4f600e',
    summary: '修复 CoT 打字机在流式分片时回退闪烁。',
  },
  {
    commit: '17c6e0f',
    summary: '恢复四端共用的交错深度思考与工具步骤时间线。',
  },
  {
    commit: '8118eae',
    summary: '忽略本地 .zcode 草稿，并将已落地的图片转写方案归档。',
  },
] as const
