import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CustomRequestEditor } from '@/components/chat/custom-request-editor'
import type { WelcomeFormProps } from './welcome-form-types'

type WelcomeDialogsProps = Pick<WelcomeFormProps['form'], 'expand' | 'advancedDialog' | 'sessionPromptDialog'> & {
  onOpenExpand: () => void
}

/** 欢迎页的低频弹层：全屏编辑、高级请求定制、会话系统提示词。 */
export function WelcomeDialogs({ expand, advancedDialog, sessionPromptDialog, onOpenExpand }: WelcomeDialogsProps) {
  return (
    <>
      <Dialog open={expand.open} onOpenChange={(open) => (open ? onOpenExpand() : expand.onClose())}>
        <DialogContent className="max-w-[1000px] w-[92vw] h-[80vh] max-h-[85vh] p-0 sm:rounded-2xl overflow-hidden flex flex-col">
          <DialogHeader className="sr-only">
            <DialogTitle>编辑消息</DialogTitle>
            <DialogDescription>在全屏编辑器中修改当前草稿内容</DialogDescription>
          </DialogHeader>
          <div className="p-4 border-b text-sm text-muted-foreground">编辑消息</div>
          <div className="flex-1 min-h-0 p-4">
            <Textarea
              value={expand.draft}
              onChange={(event) => expand.onChange(event.target.value)}
              className="h-full w-full resize-none border rounded-md p-3"
            />
          </div>
          <div className="p-4 border-t flex justify-end gap-2">
            <Button variant="outline" onClick={expand.onClose}>
              取消
            </Button>
            <Button onClick={expand.onApply}>应用</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={advancedDialog.open} onOpenChange={(open) => (!open ? advancedDialog.onClose() : null)}>
        <DialogContent className="max-w-3xl w-full max-h-[85vh] overflow-hidden p-0 sm:rounded-2xl">
          <DialogHeader className="px-5 py-4 border-b">
            <DialogTitle>高级请求定制</DialogTitle>
            <DialogDescription>
              为本次消息添加自定义请求体和请求头。核心字段已锁定，敏感头会被忽略。
            </DialogDescription>
          </DialogHeader>
          <div className="px-5 py-4">
            <CustomRequestEditor
              customHeaders={advancedDialog.customHeaders}
              onAddHeader={advancedDialog.onAddHeader}
              onHeaderChange={advancedDialog.onHeaderChange}
              onRemoveHeader={advancedDialog.onRemoveHeader}
              canAddHeader={advancedDialog.canAddHeader}
              customBody={advancedDialog.customBodyInput}
              onCustomBodyChange={advancedDialog.onCustomBodyChange}
              customBodyError={advancedDialog.customBodyError}
            />
          </div>
          <div className="flex justify-end border-t px-5 py-3">
            <Button variant="secondary" onClick={advancedDialog.onClose}>
              完成
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={sessionPromptDialog.open} onOpenChange={(open) => (!open ? sessionPromptDialog.onClose() : null)}>
        <DialogContent className="max-w-2xl w-full max-h-[80vh] overflow-hidden p-0 sm:rounded-2xl">
          <DialogHeader className="px-5 py-4 border-b">
            <DialogTitle>会话系统提示词</DialogTitle>
            <DialogDescription>
              {sessionPromptDialog.value.trim()
                ? '当前会话将使用该提示词'
                : sessionPromptDialog.placeholder || '留空继承上级或使用默认提示词'}
            </DialogDescription>
          </DialogHeader>
          <div className="px-5 py-4 space-y-3">
            <textarea
              value={sessionPromptDialog.value}
              onChange={(event) => sessionPromptDialog.onChange(event.target.value)}
              rows={6}
              placeholder={sessionPromptDialog.placeholder}
              className="w-full rounded-xl border border-border bg-surface-subtle px-3 py-2 text-sm leading-relaxed  "
            />
            <p className="text-xs text-muted-foreground">
              {'生效顺序：会话 > 个人 > 全局；支持 {day time}（自动替换为服务器当前时间）。留空继承上级，三层均为空时默认使用"今天日期是{day time}"。'}
            </p>
          </div>
          <div className="flex items-center justify-between border-t px-5 py-3">
            <Button variant="ghost" onClick={sessionPromptDialog.onClear}>
              清空
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={sessionPromptDialog.onClose}>
                取消
              </Button>
              <Button onClick={sessionPromptDialog.onConfirm}>确认</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
