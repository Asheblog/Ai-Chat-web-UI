import { prisma } from '../db';
import type { Connection } from '@prisma/client';

/**
 * 解析 modelId 对应的系统连接与原始模型 ID。
 * 优先查询 model_catalog 缓存，其次回退到 prefix 规则或连接的 modelIds。
 */
export async function resolveModelIdForUser(
  userId: number,
  modelId: string
): Promise<{ connection: Connection; rawModelId: string } | null> {
  const cleanModelId = (modelId || '').trim();
  if (!cleanModelId) return null;

  // 优先查询缓存表
  const cached = await prisma.modelCatalog.findFirst({
    where: { modelId: cleanModelId },
    select: {
      connectionId: true,
      rawId: true,
      connection: true,
    },
  });

  if (cached?.connection && cached.rawId) {
    return {
      connection: cached.connection,
      rawModelId: cached.rawId,
    };
  }

  const connections = await prisma.connection.findMany({
    where: {
      enable: true,
      ownerUserId: null,
    },
  });

  const parseModelIds = (json?: string | null): string[] => {
    if (!json) return [];
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
    } catch {
      return [];
    }
  };

  let fallbackExact: { connection: Connection; rawId: string } | null = null;
  let fallbackFirst: { connection: Connection; rawId: string } | null = null;

  for (const conn of connections) {
    const prefix = (conn.prefixId || '').trim();
    if (prefix && cleanModelId.startsWith(`${prefix}.`)) {
      const rawId = cleanModelId.slice(prefix.length + 1);
      return { connection: conn, rawModelId: rawId };
    }

    if (!prefix) {
      if (!fallbackFirst) {
        fallbackFirst = { connection: conn, rawId: cleanModelId };
      }

      if (!fallbackExact) {
        const ids = parseModelIds(conn.modelIdsJson);
        if (ids.includes(cleanModelId)) {
          fallbackExact = { connection: conn, rawId: cleanModelId };
        }
      }
    }
  }

  const selected = fallbackExact || fallbackFirst;
  if (selected) {
    return {
      connection: selected.connection,
      rawModelId: selected.rawId,
    };
  }

  return null;
}
