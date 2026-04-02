'use client'

import { useMemo } from 'react'
import { DetailDrawer, type BattleAttemptDetail } from '../ui/DetailDrawer'
import { SingleModelBattleHero } from './SingleModelBattleHero'
import { SingleModelBattleOverview } from './SingleModelBattleOverview'
import { SingleModelBattleConfigPanel } from './SingleModelBattleConfigPanel'
import { SingleModelQuestionWorkspace } from './SingleModelQuestionWorkspace'
import { SingleModelBattleMonitorPanel } from './SingleModelBattleMonitorPanel'
import { SingleModelBattleResultsPanel } from './SingleModelBattleResultsPanel'
import { SingleModelBattleHistoryPanel } from './SingleModelBattleHistoryPanel'
import { buildQuestionViews, buildSelectedDetail, buildSelectedNodeKey, computeStability } from './single-model-derived'
import { useSingleModelBattleController } from './useSingleModelBattleController'

export function SingleModelMultiQuestionPageClient() {
  const controller = useSingleModelBattleController()

  const questionViews = useMemo(
    () => buildQuestionViews({
      questions: controller.questions,
      results: controller.results,
      liveAttempts: controller.liveAttempts,
    }),
    [controller.questions, controller.results, controller.liveAttempts],
  )

  const selectedNodeKey = useMemo(
    () => buildSelectedNodeKey(controller.selectedAttempt),
    [controller.selectedAttempt],
  )

  const selectedDetail = useMemo<BattleAttemptDetail | null>(
    () => buildSelectedDetail({
      selectedAttempt: controller.selectedAttempt,
      questions: controller.questions,
      selectedModel: controller.selectedModel,
      results: controller.results,
      liveAttempts: controller.liveAttempts,
    }),
    [controller.selectedAttempt, controller.questions, controller.selectedModel, controller.results, controller.liveAttempts],
  )

  const computedStability = useMemo(() => computeStability(questionViews), [questionViews])

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-[hsl(var(--background-alt))/0.32]">
      <div className="mx-auto w-full max-w-[1440px] space-y-6 px-4 py-6 md:px-6 xl:px-8">
        <SingleModelBattleHero
          runId={controller.runId}
          runStatus={controller.runStatus}
          isRunning={controller.isRunning}
          sharing={controller.sharing}
          shareLink={controller.shareLink}
          copiedShareLink={controller.copiedShareLink}
          sourceRunId={controller.sourceRunId}
          error={controller.error}
          onStart={() => void controller.handleStart()}
          onCancel={() => void controller.handleCancel()}
          onNewTask={controller.handleNewTask}
          onShare={() => void controller.handleShare()}
          onCopyShareLink={() => void controller.handleCopyShareLink()}
        />

        <SingleModelBattleOverview
          selectedModelLabel={controller.selectedModelLabel}
          selectedJudgeLabel={controller.selectedJudgeLabel}
          questions={controller.questions}
          questionViews={questionViews}
          runStatus={controller.runStatus}
          summary={controller.summary}
          computedStability={computedStability}
        />

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.18fr)_minmax(360px,0.82fr)] xl:items-start">
          <div className="space-y-6">
            <SingleModelBattleConfigPanel
              modelKey={controller.modelKey}
              judgeKey={controller.judgeKey}
              judgeThreshold={controller.judgeThreshold}
              maxConcurrency={controller.maxConcurrency}
              isRunning={controller.isRunning}
              selectedModelLabel={controller.selectedModelLabel}
              selectedJudgeLabel={controller.selectedJudgeLabel}
              onModelChange={(model) => controller.setModelKey(`${model.connectionId != null ? String(model.connectionId) : 'global'}:${model.rawId ?? model.id}`)}
              onJudgeChange={(model) => controller.setJudgeKey(`${model.connectionId != null ? String(model.connectionId) : 'global'}:${model.rawId ?? model.id}`)}
              onJudgeThresholdChange={controller.setJudgeThreshold}
              onMaxConcurrencyChange={controller.setMaxConcurrency}
            />

            <SingleModelQuestionWorkspace
              questions={controller.questions}
              isRunning={controller.isRunning}
              onAddQuestion={controller.addQuestion}
              onRemoveQuestion={controller.removeQuestion}
              onUpdateQuestion={controller.updateQuestion}
            />

            <SingleModelBattleHistoryPanel
              history={controller.history}
              expanded={controller.historyExpanded}
              historyLoading={controller.historyLoading}
              historyLoadingRunId={controller.historyLoadingRunId}
              isRunning={controller.isRunning}
              onToggleExpanded={() => controller.setHistoryExpanded((current) => !current)}
              onRefresh={() => void controller.refreshHistory()}
              onViewRun={(targetRunId) => void controller.handleLoadHistory(targetRunId, false)}
              onReuseRun={(targetRunId) => void controller.handleLoadHistory(targetRunId, true)}
            />
          </div>

          <div className="space-y-6 xl:sticky xl:top-6">
            <SingleModelBattleMonitorPanel
              runId={controller.runId}
              runStatus={controller.runStatus}
              error={controller.error}
              questionViews={questionViews}
            />

            <SingleModelBattleResultsPanel
              runId={controller.runId}
              isRunning={controller.isRunning}
              summary={controller.summary}
              computedStability={computedStability}
              questionViews={questionViews}
              selectedNodeKey={selectedNodeKey}
              onNodeClick={(questionIndex, attemptIndex) => controller.setSelectedAttempt({ questionIndex, attemptIndex })}
            />
          </div>
        </div>
      </div>

      <DetailDrawer
        open={selectedDetail !== null}
        onOpenChange={(open) => {
          if (!open) controller.setSelectedAttempt(null)
        }}
        detail={selectedDetail}
        isRunning={controller.isRunning}
      />
    </div>
  )
}
