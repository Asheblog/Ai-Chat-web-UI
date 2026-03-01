import { Hono } from "hono"
import { registerChatCompressionRoutes } from "../compression"

const mockEnsureSessionAccess = jest.fn()
const mockUpdateGroupExpanded = jest.fn()
const mockCancelGroup = jest.fn()
const mockExtendAnonymousSession = jest.fn(async () => {})

jest.mock("../../../../middleware/auth", () => ({
  actorMiddleware: async (c: any, next: any) => {
    c.set("actor", {
      type: "user",
      id: 1,
      role: "USER",
      status: "ACTIVE",
      username: "tester",
      identifier: "user:1",
    })
    await next()
  },
}))

jest.mock("../../../../services/chat", () => ({
  chatService: {
    ensureSessionAccess: (...args: any[]) => mockEnsureSessionAccess(...args),
  },
  ChatServiceError: class ChatServiceError extends Error {
    statusCode: number

    constructor(message: string, statusCode = 400) {
      super(message)
      this.name = "ChatServiceError"
      this.statusCode = statusCode
    }
  },
}))

jest.mock("../../chat-common", () => ({
  extendAnonymousSession: (...args: any[]) => mockExtendAnonymousSession(...args),
}))

jest.mock("../../services/conversation-compression-service", () => ({
  conversationCompressionService: {
    updateGroupExpanded: (...args: any[]) => mockUpdateGroupExpanded(...args),
    cancelGroup: (...args: any[]) => mockCancelGroup(...args),
  },
}))

describe("compression routes", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEnsureSessionAccess.mockResolvedValue(undefined)
  })

  it("updates compression group expanded state", async () => {
    mockUpdateGroupExpanded.mockResolvedValue(true)

    const app = new Hono()
    registerChatCompressionRoutes(app)

    const res = await app.request("http://localhost/sessions/9/compression/21", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expanded: true }),
    })

    expect(res.status).toBe(200)
    expect(mockUpdateGroupExpanded).toHaveBeenCalledWith({
      sessionId: 9,
      groupId: 21,
      expanded: true,
    })
    expect(mockExtendAnonymousSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      9,
    )
  })

  it("returns 404 when compression group does not exist", async () => {
    mockUpdateGroupExpanded.mockResolvedValue(false)

    const app = new Hono()
    registerChatCompressionRoutes(app)

    const res = await app.request("http://localhost/sessions/9/compression/404", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expanded: false }),
    })

    expect(res.status).toBe(404)
  })

  it("cancels compression group and returns released count", async () => {
    mockCancelGroup.mockResolvedValue({ cancelled: true, releasedCount: 5 })

    const app = new Hono()
    registerChatCompressionRoutes(app)

    const res = await app.request("http://localhost/sessions/9/compression/21/cancel", {
      method: "POST",
    })

    expect(res.status).toBe(200)
    expect(mockCancelGroup).toHaveBeenCalledWith({
      sessionId: 9,
      groupId: 21,
    })

    const json = (await res.json()) as any
    expect(json?.data?.releasedCount).toBe(5)
  })
})
