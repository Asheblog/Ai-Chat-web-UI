import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { vi } from "vitest"
import { ShareDialog } from "./share-dialog"
import { useChatStore } from "@/store/chat-store"
import { createChatShare } from "@/features/share/api"

vi.mock("@/features/share/api", () => ({
  createChatShare: vi.fn(),
}))

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}))

const mockCreateShare = () => {
  const spy = createChatShare as ReturnType<typeof vi.fn>
  spy.mockResolvedValue({
    success: true,
    data: {
      id: 1,
      sessionId: 42,
      token: "token-abc",
      title: "测试分享",
      sessionTitle: "测试会话",
      messageCount: 1,
      messages: [],
      createdAt: new Date().toISOString(),
    },
  })
  return spy
}

describe("ShareDialog", () => {
  beforeEach(() => {
    useChatStore.setState((state) => ({
      ...state,
      messageMetas: [
        {
          id: 1,
          sessionId: 42,
          role: "assistant",
          createdAt: "2024-01-01T00:00:00.000Z",
        } as any,
        {
          id: 2,
          sessionId: 42,
          role: "user",
          createdAt: "2024-01-01T00:01:00.000Z",
        } as any,
      ],
    }))
  })

  it("submits selected messages with title and default expiry", async () => {
    const createSpy = mockCreateShare()

    render(
      <ShareDialog
        sessionId={42}
        sessionTitle="测试会话"
        selectedMessageIds={[2, 1]}
        open
        onOpenChange={() => {}}
      />,
    )

    const titleInput = screen.getByPlaceholderText("给分享链接起个名字")
    fireEvent.change(titleInput, { target: { value: "发布链接" } })
    fireEvent.click(screen.getByText("生成分享链接"))

    await waitFor(() => expect(createSpy).toHaveBeenCalled())
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "发布链接",
        sessionId: 42,
        messageIds: [1, 2],
        expiresInHours: 72,
      }),
    )
  })

  it("disables submit button when no selection", () => {
    render(
      <ShareDialog
        sessionId={42}
        sessionTitle="测试会话"
        selectedMessageIds={[]}
        open
        onOpenChange={() => {}}
      />,
    )

    expect(screen.getByText("生成分享链接")).toBeDisabled()
    expect(screen.getByText("暂无选中内容，请在聊天界面勾选要分享的消息。")).toBeInTheDocument()
  })
})
