/**
 * dev 下载示例文件的真实字节。
 *
 * 这两个文件只服务验收：内容由夹具生成，标题里写明"示例"，文件名与大小来自
 * DEV_ARTIFACT_FILES，避免出现指向生产接口的假链接。
 */
import { completedCase } from './completed-case'
import type { DevArtifactSlug } from './primitives'

const collectedHits = (): Array<{ title: string; url: string }> => {
  const seen = new Map<string, { title: string; url: string }>()
  for (const event of completedCase.toolEvents) {
    for (const hit of event.hits ?? []) {
      if (!seen.has(hit.url)) seen.set(hit.url, { title: hit.title, url: hit.url })
    }
  }
  return Array.from(seen.values())
}

const hitTotal = completedCase.toolEvents.reduce((sum, event) => sum + (event.hits?.length ?? 0), 0)

const markdown = (): string => {
  const sources = collectedHits()
  return [
    '# 今日中国新闻要点整理（dev 示例文件）',
    '',
    '> 这是过程工作区验收页的示例产物，内容来自页面夹具，不是实时新闻。',
    '',
    '## 01 政策与民生',
    '',
    '公共服务事项本周集中调整，办理渠道同步迁移到线上，过渡期保留线下窗口。',
    '',
    '## 02 经济与产业',
    '',
    '已发布数据与机构解读分开呈现；同比与环比口径不同，不做直接比较。',
    '',
    '## 03 政策与公共服务',
    '',
    '科研政策原文附件中的纸质材料条款与"全程线上"表述存在出入，已标为待核对。',
    '',
    '## 附：来源清单',
    '',
    ...sources.map((source, index) => `${index + 1}. [${source.title}](${source.url})`),
    '',
    `共 ${hitTotal} 条引用命中，去重后 ${sources.length} 个来源。`,
    '',
  ].join('\n')
}

const sourcesJson = (): string => {
  const sources = collectedHits()
  return JSON.stringify(
    {
      note: 'dev 验收示例文件，不是真实检索结果',
      hitsTotal: hitTotal,
      uniqueTotal: sources.length,
      sources,
    },
    null,
    2,
  )
}

export const buildDevArtifactContent = (slug: DevArtifactSlug): string =>
  slug === 'news-summary.md' ? markdown() : sourcesJson()
