import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockClientGet = vi.fn()
const mockClientPost = vi.fn()
const mockClientPatch = vi.fn()
const mockClientDelete = vi.fn()

vi.mock('@/lib/api', () => ({
  apiHttpClient: {
    get: (...args: any[]) => mockClientGet(...args),
    post: (...args: any[]) => mockClientPost(...args),
    patch: (...args: any[]) => mockClientPatch(...args),
    delete: (...args: any[]) => mockClientDelete(...args),
  },
}))

import { getToolDetail } from '@/features/mcp/api'

describe('mcp api wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getToolDetail 归一化 inputSchemaJson', () => {
    it('inputSchemaJson 存在时解析为 inputSchema', async () => {
      const schema = { type: 'object', properties: { name: { type: 'string' } } }
      mockClientGet.mockResolvedValue({
        data: {
          success: true,
          data: {
            id: 1,
            connectionId: 1,
            originalName: 'test_tool',
            description: 'A test',
            inputSchemaJson: JSON.stringify(schema),
            pinned: false,
            toolSetRevision: 1,
          },
        },
      })

      const res = await getToolDetail(1, 'test_tool')
      expect(res.success).toBe(true)
      expect(res.data?.inputSchema).toEqual(schema)
      expect(mockClientGet).toHaveBeenCalledWith('/mcp/tools/1/test_tool')
    })

    it('inputSchema 已存在时优先使用', async () => {
      const schema = { type: 'object' }
      mockClientGet.mockResolvedValue({
        data: {
          success: true,
          data: {
            id: 1,
            connectionId: 1,
            originalName: 'test_tool',
            description: 'A test',
            inputSchema: schema,
            pinned: false,
          },
        },
      })

      const res = await getToolDetail(1, 'test_tool')
      expect(res.data?.inputSchema).toEqual(schema)
    })

    it('JSON.parse 失败时返回 null', async () => {
      mockClientGet.mockResolvedValue({
        data: {
          success: true,
          data: {
            id: 1,
            connectionId: 1,
            originalName: 'test_tool',
            description: 'A test',
            inputSchemaJson: 'invalid json{{{',
            pinned: false,
          },
        },
      })

      const res = await getToolDetail(1, 'test_tool')
      expect(res.data?.inputSchema).toBeNull()
    })

    it('inputSchemaJson 不存在时返回 null', async () => {
      mockClientGet.mockResolvedValue({
        data: {
          success: true,
          data: {
            id: 1,
            connectionId: 1,
            originalName: 'test_tool',
            description: 'A test',
            pinned: false,
          },
        },
      })

      const res = await getToolDetail(1, 'test_tool')
      expect(res.data?.inputSchema).toBeNull()
    })
  })
})
