import { apiHttpClient } from '@/lib/api'
import type {
  ActorContextDTO,
  ApiResponse,
  AuthResponse,
  RegisterResponse,
  User,
} from '@/types'

const client = apiHttpClient

export const login = async (username: string, password: string) => {
  const response = await client.post<ApiResponse<AuthResponse>>('/auth/login', {
    username,
    password,
  })
  const { data } = response.data
  if (!data) {
    throw new Error('Invalid login response')
  }
  return data
}

export const register = async (username: string, password: string) => {
  const response = await client.post<ApiResponse<RegisterResponse>>('/auth/register', {
    username,
    password,
  })
  const { data } = response.data
  if (!data) {
    throw new Error('Invalid register response')
  }
  return data
}

export const getCurrentUser = async () => {
  const response = await client.get<ApiResponse<User>>('/auth/me')
  return response.data.data!
}

export const getActorContext = async () => {
  const response = await client.get<ApiResponse<ActorContextDTO>>('/auth/actor')
  return response.data.data!
}

export const logout = async () => {
  try {
    await client.post('/auth/logout')
  } catch {
    // ignore
  }
  if (typeof window !== 'undefined') {
    window.location.href = '/auth/login'
  }
}

export const changePassword = async (currentPassword: string, newPassword: string) => {
  const response = await client.put<ApiResponse<any>>('/auth/password', {
    currentPassword,
    newPassword,
  })
  return response.data
}
