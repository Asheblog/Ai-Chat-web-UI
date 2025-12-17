import { render, screen } from "@testing-library/react"
import { ShareViewer } from "./share-viewer"

// Mock ReasoningPanel to avoid complex dependency chain
jest.mock('@/components/reasoning-panel', () => ({
  ReasoningPanel: ({ expanded, onToggle, toolSummary }: any) => (
    <div data-testid="reasoning-panel" data-expanded={expanded} onClick={onToggle}>
      {toolSummary && <span data-testid="tool-summary">{toolSummary.label}</span>}
    </div>
  ),
}))

describe("ShareViewer", () => {
  it("renders shared messages with simplified header", () => {
    const now = new Date().toISOString()
    render(
      <ShareViewer
        share={{
          id: 1,
          sessionId: 10,
          token: "abc",
          title: "示例分享",
          sessionTitle: "会话A",
          messageCount: 2,
          createdAt: now,
          expiresAt: null,
          revokedAt: null,
          messages: [
            {
              id: 1,
              role: "user",
              content: "请解释一下量子隧穿",
              createdAt: now,
            },
            {
              id: 2,
              role: "assistant",
              content: "量子隧穿是一种在经典力学中无法出现的现象。",
              createdAt: now,
            },
          ],
        }}
        brandText="TestBrand"
      />,
    )

    // Simplified header
    expect(screen.getByText("示例分享")).toBeInTheDocument()
    expect(screen.getByText(/2 条消息/)).toBeInTheDocument()

    // Messages
    expect(screen.getByText("用户")).toBeInTheDocument()
    expect(screen.getByText("AI 助手")).toBeInTheDocument()
    expect(screen.getByText("量子隧穿是一种在经典力学中无法出现的现象。")).toBeInTheDocument()

    // Footer with brand text
    expect(screen.getByText("TestBrand")).toBeInTheDocument()
    expect(screen.getByText(/本页面分享由/)).toBeInTheDocument()
  })

  it("renders reasoning panel for assistant messages with reasoning", () => {
    const now = new Date().toISOString()
    render(
      <ShareViewer
        share={{
          id: 1,
          sessionId: 10,
          token: "abc",
          title: "示例分享",
          sessionTitle: "会话A",
          messageCount: 1,
          createdAt: now,
          expiresAt: null,
          revokedAt: null,
          messages: [
            {
              id: 1,
              role: "assistant",
              content: "这是回答内容",
              reasoning: "这是思维链内容",
              createdAt: now,
            },
          ],
        }}
      />,
    )

    const reasoningPanel = screen.getByTestId("reasoning-panel")
    expect(reasoningPanel).toBeInTheDocument()
    expect(reasoningPanel).toHaveAttribute("data-expanded", "false")
  })

  it("renders tool summary when toolEvents are present", () => {
    const now = new Date().toISOString()
    render(
      <ShareViewer
        share={{
          id: 1,
          sessionId: 10,
          token: "abc",
          title: "工具调用示例",
          sessionTitle: "会话B",
          messageCount: 1,
          createdAt: now,
          expiresAt: null,
          revokedAt: null,
          messages: [
            {
              id: 1,
              role: "assistant",
              content: "搜索完成",
              createdAt: now,
              toolEvents: [
                {
                  id: "t1",
                  sessionId: 10,
                  messageId: 1,
                  tool: "web_search",
                  stage: "result",
                  status: "success",
                  createdAt: Date.now(),
                },
              ],
            } as any,
          ],
        }}
      />,
    )

    expect(screen.getByTestId("tool-summary")).toHaveTextContent("联网搜索 1 次")
  })

  it("uses default brand text when not provided", () => {
    const now = new Date().toISOString()
    render(
      <ShareViewer
        share={{
          id: 1,
          sessionId: 10,
          token: "abc",
          title: "测试",
          sessionTitle: "会话",
          messageCount: 0,
          createdAt: now,
          expiresAt: null,
          revokedAt: null,
          messages: [],
        }}
      />,
    )

    expect(screen.getByText("AIChat")).toBeInTheDocument()
  })
})
