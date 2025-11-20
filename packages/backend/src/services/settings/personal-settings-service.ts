import type { PrismaClient } from '@prisma/client'
import type { Request } from 'undici'
import { prisma as defaultPrisma } from '../../db'
import {
  replaceProfileImage as defaultReplaceProfileImage,
  resolveProfileImageUrl as defaultResolveProfileImageUrl,
  determineProfileImageBaseUrl as defaultDetermineProfileImageBaseUrl,
} from '../../utils/profile-images'

type Nullable<T> = T | null

export interface PreferredModelInput {
  modelId?: Nullable<string>
  connectionId?: Nullable<number>
  rawId?: Nullable<string>
}

export interface PersonalSettingsPayload {
  context_token_limit?: number
  theme?: 'light' | 'dark'
  preferred_model?: Nullable<PreferredModelInput>
  avatar?: Nullable<{ data: string; mime: string }>
}

export interface PersonalSettingsResult {
  context_token_limit: number
  theme: 'light' | 'dark'
  preferred_model: {
    modelId: string | null
    connectionId: number | null
    rawId: string | null
  }
  avatar_url: string | null
}

export interface PersonalSettingsServiceDeps {
  prisma?: PrismaClient
  replaceProfileImage?: typeof defaultReplaceProfileImage
  resolveProfileImageUrl?: typeof defaultResolveProfileImageUrl
  determineProfileImageBaseUrl?: typeof defaultDetermineProfileImageBaseUrl
  defaultContextLimit?: () => number
}

const DEFAULT_CONTEXT_LIMIT = () =>
  Number.parseInt(process.env.DEFAULT_CONTEXT_TOKEN_LIMIT || '4000', 10) || 4000

export class PersonalSettingsService {
  private prisma: PrismaClient
  private replaceProfileImage: typeof defaultReplaceProfileImage
  private resolveProfileImageUrl: typeof defaultResolveProfileImageUrl
  private determineProfileImageBaseUrl: typeof defaultDetermineProfileImageBaseUrl
  private defaultContextLimit: () => number

  constructor(deps: PersonalSettingsServiceDeps = {}) {
    this.prisma = deps.prisma ?? defaultPrisma
    this.replaceProfileImage = deps.replaceProfileImage ?? defaultReplaceProfileImage
    this.resolveProfileImageUrl = deps.resolveProfileImageUrl ?? defaultResolveProfileImageUrl
    this.determineProfileImageBaseUrl =
      deps.determineProfileImageBaseUrl ?? defaultDetermineProfileImageBaseUrl
    this.defaultContextLimit = deps.defaultContextLimit ?? DEFAULT_CONTEXT_LIMIT
  }

  async getPersonalSettings(params: { userId: number; request: Request }): Promise<PersonalSettingsResult> {
    const record = await this.prisma.user.findUnique({
      where: { id: params.userId },
      select: {
        preferredModelId: true,
        preferredConnectionId: true,
        preferredModelRawId: true,
        avatarPath: true,
      },
    })
    const baseUrl = this.determineProfileImageBaseUrl({ request: params.request })
    return {
      context_token_limit: this.defaultContextLimit(),
      theme: 'light',
      preferred_model: {
        modelId: record?.preferredModelId ?? null,
        connectionId: record?.preferredConnectionId ?? null,
        rawId: record?.preferredModelRawId ?? null,
      },
      avatar_url: this.resolveProfileImageUrl(record?.avatarPath ?? null, baseUrl),
    }
  }

  async updatePersonalSettings(params: {
    userId: number
    payload: PersonalSettingsPayload
    request: Request
  }): Promise<PersonalSettingsResult & { theme?: 'light' | 'dark' }> {
    const currentProfile = await this.prisma.user.findUnique({
      where: { id: params.userId },
      select: {
        preferredModelId: true,
        preferredConnectionId: true,
        preferredModelRawId: true,
        avatarPath: true,
      },
    })

    const updates: Record<string, any> = {}
    let avatarPathResult = currentProfile?.avatarPath ?? null

    if (Object.prototype.hasOwnProperty.call(params.payload, 'preferred_model')) {
      const pref = params.payload.preferred_model || null
      updates.preferredModelId = pref?.modelId ?? null
      updates.preferredConnectionId = pref?.connectionId ?? null
      updates.preferredModelRawId = pref?.rawId ?? null
    }

    if (Object.prototype.hasOwnProperty.call(params.payload, 'avatar')) {
      avatarPathResult = await this.replaceProfileImage(params.payload.avatar ?? null, {
        currentPath: currentProfile?.avatarPath ?? null,
      })
      updates.avatarPath = avatarPathResult
    }

    if (Object.keys(updates).length > 0) {
      await this.prisma.user.update({ where: { id: params.userId }, data: updates })
    }

    const baseUrl = this.determineProfileImageBaseUrl({ request: params.request })

    return {
      context_token_limit:
        params.payload.context_token_limit ?? this.defaultContextLimit(),
      theme: params.payload.theme ?? 'light',
      preferred_model: {
        modelId: updates.preferredModelId ?? currentProfile?.preferredModelId ?? null,
        connectionId:
          updates.preferredConnectionId ?? currentProfile?.preferredConnectionId ?? null,
        rawId: updates.preferredModelRawId ?? currentProfile?.preferredModelRawId ?? null,
      },
      avatar_url: this.resolveProfileImageUrl(avatarPathResult, baseUrl),
    }
  }
}

export const personalSettingsService = new PersonalSettingsService()
