'use client'

import { useMemo } from 'react'
import { BattleShareViewer } from '@/components/share/battle-share-viewer'
import type { BattleShare } from '@/types'
import type { PreviewCase } from './preview-cases'

/**
 * 真实 Battle 分享消费方：BattleShareViewer 内含模型卡片、统计表与 DetailDrawer。
 * 两个模型各 2 次尝试，输出与耗时完全不同，用于验证"切换模型不串记录"。
 */
export function BattleConsumer({ previewCase }: { previewCase: PreviewCase }) {
  const share = useMemo<BattleShare>(() => {
    const createdAt = previewCase.entryProps.meta.createdAt
    const prompt = { text: '比较两种模型对中国新闻的整理方式。', images: [] }
    const expectedAnswer = { text: '按政策、经济、社会三条线整理，并各自标注来源。', images: [] }
    return {
      id: 9_001,
      battleRunId: 4_501,
      token: 'dev-preview-battle-token',
      title: '两种模型整理中国新闻（dev 夹具）',
      createdAt,
      expiresAt: null,
      revokedAt: null,
      payload: {
        title: '两种模型整理中国新闻（dev 夹具）',
        mode: 'multi_model',
        prompt,
        expectedAnswer,
        judge: { modelId: 'judge-model', modelLabel: 'judge-model', threshold: 0.7 },
        status: 'completed',
        progress: {
          totalAttempts: 4,
          completedAttempts: 4,
          runningAttempts: 0,
          pendingAttempts: 0,
          successAttempts: 3,
          failedAttempts: 1,
        },
        models: [
          { modelId: 'deepseek-v4.1-flash', modelLabel: 'deepseek-v4.1-flash', connectionId: 3, rawId: 'deepseek-v4.1-flash' },
          { modelId: 'gpt-4.1-mini', modelLabel: 'gpt-4.1-mini', connectionId: 5, rawId: 'gpt-4.1-mini' },
        ],
        summary: {
          totalModels: 2,
          runsPerModel: 2,
          passK: 2,
          judgeThreshold: 0.7,
          passModelCount: 2,
          accuracy: 0.5,
          mode: 'multi_model',
          modelStats: [
            { modelId: 'deepseek-v4.1-flash', connectionId: 3, rawId: 'deepseek-v4.1-flash', passAtK: true, passCount: 1, accuracy: 0.5, judgedCount: 2, totalAttempts: 2, judgeErrorCount: 0 },
            { modelId: 'gpt-4.1-mini', connectionId: 5, rawId: 'gpt-4.1-mini', passAtK: true, passCount: 1, accuracy: 0.5, judgedCount: 1, totalAttempts: 2, judgeErrorCount: 1 },
          ],
        },
        results: [
          {
            questionIndex: 0,
            modelId: 'deepseek-v4.1-flash',
            modelLabel: 'deepseek-v4.1-flash',
            connectionId: 3,
            rawId: 'deepseek-v4.1-flash',
            attemptIndex: 1,
            output: '## 模型 A · 第一次\n\n政策与民生：公共服务事项本周集中调整，办理渠道迁移到线上。\n\n经济与产业：数据已发布，机构解读口径不同。\n\n社会：多地气温回升，出行提示同步更新。',
            reasoning: '模型 A 的可见推理：先按三条线分组，再补来源。',
            durationMs: 18_400,
            error: null,
            usage: { total_tokens: 1_240 },
            judgeStatus: 'success',
            judgeError: null,
            judgePass: true,
            judgeScore: 0.86,
            judgeReason: '覆盖三条主线且有来源标注。',
            judgeFallbackUsed: false,
          },
          {
            questionIndex: 0,
            modelId: 'deepseek-v4.1-flash',
            modelLabel: 'deepseek-v4.1-flash',
            connectionId: 3,
            rawId: 'deepseek-v4.1-flash',
            attemptIndex: 2,
            output: '## 模型 A · 第二次\n\n政策：调整窗口与过渡期并存。\n\n经济：只写已发布数据。\n\n社会：未覆盖，留空。',
            reasoning: '模型 A 第二次的推理：时间不够，省略社会部分。',
            durationMs: 12_900,
            error: null,
            usage: { total_tokens: 860 },
            judgeStatus: 'success',
            judgeError: null,
            judgePass: false,
            judgeScore: 0.64,
            judgeReason: '缺少社会一条主线。',
            judgeFallbackUsed: false,
          },
          {
            questionIndex: 0,
            modelId: 'gpt-4.1-mini',
            modelLabel: 'gpt-4.1-mini',
            connectionId: 5,
            rawId: 'gpt-4.1-mini',
            attemptIndex: 1,
            output: '## 模型 B · 第一次\n\n我按政策、经济、社会三条线整理，并在每条后面给出引用编号［1］［2］［3］。\n\n差异：模型 B 更倾向于先给结论再列依据。',
            reasoning: '模型 B 的可见推理：先给结论，再补依据。',
            durationMs: 24_100,
            error: null,
            usage: { total_tokens: 1_580 },
            judgeStatus: 'success',
            judgeError: null,
            judgePass: true,
            judgeScore: 0.91,
            judgeReason: '结构清晰、引用齐全。',
            judgeFallbackUsed: false,
          },
          {
            questionIndex: 0,
            modelId: 'gpt-4.1-mini',
            modelLabel: 'gpt-4.1-mini',
            connectionId: 5,
            rawId: 'gpt-4.1-mini',
            attemptIndex: 2,
            output: '',
            reasoning: '',
            durationMs: null,
            error: 'provider timeout after 60000ms',
            usage: {},
            judgeStatus: 'error',
            judgeError: 'provider timeout',
            judgePass: null,
            judgeScore: null,
            judgeReason: null,
            judgeFallbackUsed: false,
          },
        ],
        createdAt,
      },
    }
  }, [previewCase])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-preview-consumer="battle-share-viewer">
      <BattleShareViewer share={share} brandText="AIChat · dev 夹具" />
    </div>
  )
}
