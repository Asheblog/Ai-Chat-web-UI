import { render, screen } from "@testing-library/react"
import { ShareViewer } from "./share-viewer"

describe("ShareViewer", () => {
  it("renders shared messages for user and assistant", () => {
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
              version: 1,
              reasoningVersion: 0,
            } as any,
            {
              id: 2,
              role: "assistant",
              content: "量子隧穿是一种在经典力学中无法出现的现象。",
              createdAt: now,
              version: 1,
              reasoningVersion: 0,
            } as any,
          ],
        }}
      />,
    )

    expect(screen.getByText("示例分享")).toBeInTheDocument()
    expect(screen.getByText("用户")).toBeInTheDocument()
    expect(screen.getByText("AI")).toBeInTheDocument()
    expect(screen.getByText("量子隧穿是一种在经典力学中无法出现的现象。")).toBeInTheDocument()
  })
})
