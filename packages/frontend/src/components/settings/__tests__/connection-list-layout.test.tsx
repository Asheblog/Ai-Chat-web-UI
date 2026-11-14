import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SystemConnectionList } from '../system-connections/SystemConnectionList'
import type { SystemConnectionGroup } from '@/services/system-connections'
afterEach(cleanup)
it('连接行长名称前缀标签及URL可换行而不撑开操作区', () => {
 const group: SystemConnectionGroup={id:1,displayName:'中文连接'.repeat(30),connectionIds:[1],provider:'openai',baseUrl:'https://example.com/'+'token'.repeat(80),authType:'bearer',prefixId:'prefix'.repeat(30),tags:[{name:'tag'.repeat(60)}],connectionType:'external',defaultCapabilities:{},apiKeys:[],createdAt:'2026-01-01',updatedAt:'2026-01-01'}
 render(<SystemConnectionList connections={[group]} loading={false} onEdit={vi.fn()} onDelete={vi.fn()} />)
 expect(screen.getByText(group.displayName).className).toContain('[overflow-wrap:anywhere]')
 expect(screen.getByText(group.prefixId!).className).toContain('[overflow-wrap:anywhere]')
 expect(screen.getByText('#'+group.tags[0].name).className).toContain('[overflow-wrap:anywhere]')
 expect(screen.getByRole('button',{name:'编辑'})).toBeInTheDocument()
})
