import { apiClient } from "@/lib/api"
import type { ActorQuota } from "@/types"

export type SystemUserRow = {
  id: number
  username: string
  role: 'ADMIN' | 'USER'
  status: 'PENDING' | 'ACTIVE' | 'DISABLED'
  createdAt: string
  approvedAt: string | null
  approvedById: number | null
  rejectedAt: string | null
  rejectedById: number | null
  rejectionReason: string | null
  _count?: { chatSessions: number; connections: number }
}

export type SystemUsersPageData = {
  users: SystemUserRow[]
  pagination: { page: number; limit: number; total: number; totalPages: number }
}

export type ListUsersParams = {
  page?: number
  limit?: number
  search?: string
  status?: 'PENDING' | 'ACTIVE' | 'DISABLED'
}

export async function listUsers(params?: ListUsersParams): Promise<SystemUsersPageData | null> {
  const response = await apiClient.getUsers(params)
  return response.data ?? null
}

export async function getUserQuota(userId: number): Promise<ActorQuota | null> {
  const response = await apiClient.getUserQuota(userId)
  return response.data?.quota ?? null
}

export async function updateUserQuota(userId: number, payload: { dailyLimit: number | null; resetUsed?: boolean }) {
  const response = await apiClient.updateUserQuota(userId, payload)
  return response.data?.quota ?? null
}

export async function approveUser(userId: number) {
  await apiClient.approveUser(userId)
}

export async function rejectUser(userId: number, reason?: string) {
  await apiClient.rejectUser(userId, reason)
}

export async function updateUserStatus(userId: number, status: 'ACTIVE' | 'DISABLED', reason?: string) {
  await apiClient.updateUserStatus(userId, status, reason)
}

export async function deleteUser(userId: number) {
  await apiClient.deleteUser(userId)
}

export async function updateUserRole(userId: number, role: 'ADMIN' | 'USER') {
  await apiClient.updateUserRole(userId, role)
}
