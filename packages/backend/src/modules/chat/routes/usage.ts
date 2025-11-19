import type { Hono } from 'hono';
import { prisma } from '../../../db';
import { actorMiddleware } from '../../../middleware/auth';
import { Tokenizer } from '../../../utils/tokenizer';
import { resolveContextLimit } from '../../../utils/context-window';
import type { Actor, ApiResponse } from '../../../types';
import { chatService } from '../../../services/chat';

export const registerChatUsageRoutes = (router: Hono) => {
  router.get('/usage', actorMiddleware, async (c) => {
    try {
      const actor = c.get('actor') as Actor | undefined;
      const sessionId = parseInt(c.req.query('sessionId') || '0');
      if (!sessionId || Number.isNaN(sessionId)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid sessionId' }, 400);
      }

      if (!actor) {
        return c.json<ApiResponse>({ success: false, error: 'Actor context missing' }, 401);
      }

      const session = await chatService.findSessionWithConnection(actor, sessionId);
      if (!session) {
        return c.json<ApiResponse>({
          success: true,
          data: {
            totals: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            last_round: null,
            current: { prompt_tokens: 0, context_limit: null, context_remaining: null },
          },
        });
      }

      const [metrics, last] = await Promise.all([
        (prisma as any).usageMetric.findMany({ where: { sessionId } }),
        (prisma as any).usageMetric.findFirst({ where: { sessionId }, orderBy: { createdAt: 'desc' } }),
      ]);

      const totals = metrics.reduce(
        (
          acc: { prompt_tokens: number; completion_tokens: number; total_tokens: number },
          m: any,
        ) => {
          acc.prompt_tokens += Number(m.promptTokens || 0);
          acc.completion_tokens += Number(m.completionTokens || 0);
          acc.total_tokens += Number(m.totalTokens || 0);
          return acc;
        },
        { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      );

      const contextLimit = await resolveContextLimit({
        connectionId: session.connectionId,
        rawModelId: session.modelRawId,
        provider: session.connection?.provider,
      });
      const recentMessages = await prisma.message.findMany({
        where: { sessionId },
        select: { role: true, content: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      const conversation = [...recentMessages].reverse();
      const used = await Tokenizer.countConversationTokens(
        conversation as Array<{ role: string; content: string }>,
      );
      const current = {
        prompt_tokens: used,
        context_limit: contextLimit,
        context_remaining: Math.max(0, contextLimit - used),
      };

      return c.json<ApiResponse>({
        success: true,
        data: {
          totals,
          last_round: last
            ? {
                prompt_tokens: Number((last as any).promptTokens || 0),
                completion_tokens: Number((last as any).completionTokens || 0),
                total_tokens: Number((last as any).totalTokens || 0),
                context_limit: (last as any).contextLimit ?? null,
                createdAt: (last as any).createdAt,
                model: (last as any).model,
                provider: (last as any).provider,
              }
            : null,
          current,
        },
      });
    } catch (error) {
      console.error('Get usage error:', error);
      return c.json<ApiResponse>({ success: false, error: 'Failed to fetch usage' }, 500);
    }
  });

  router.get('/sessions/usage', actorMiddleware, async (c) => {
    try {
      const actor = c.get('actor') as Actor | undefined;
      if (!actor) {
        return c.json<ApiResponse>({ success: false, error: 'Actor context missing' }, 401);
      }

      const whereClause = actor.type === 'user'
        ? { userId: actor.id }
        : { anonymousKey: actor.key };

      const sessions = await prisma.chatSession.findMany({
        where: whereClause,
        select: { id: true },
      });
      const sessionIds = sessions.map((s) => s.id);
      if (!sessionIds.length) {
        return c.json<ApiResponse>({ success: true, data: [] });
      }

      const grouped = await (prisma as any).usageMetric.groupBy({
        by: ['sessionId'],
        where: { sessionId: { in: sessionIds } },
        _sum: {
          promptTokens: true,
          completionTokens: true,
          totalTokens: true,
        },
      });

      const result = grouped.map((g: any) => ({
        sessionId: g.sessionId,
        totals: {
          prompt_tokens: Number(g._sum?.promptTokens || 0),
          completion_tokens: Number(g._sum?.completionTokens || 0),
          total_tokens: Number(g._sum?.totalTokens || 0),
        },
      }));

      return c.json<ApiResponse>({ success: true, data: result });
    } catch (error) {
      console.error('Get sessions usage error:', error);
      return c.json<ApiResponse>({ success: false, error: 'Failed to fetch sessions usage' }, 500);
    }
  });

  router.get('/usage/daily', actorMiddleware, async (c) => {
    try {
      const user = c.get('user') as { id: number } | undefined;
      if (!user || typeof user.id !== 'number') {
        return c.json<ApiResponse>({ success: false, error: 'User context missing' }, { status: 401 });
      }
      const from = c.req.query('from');
      const to = c.req.query('to');
      const sessionIdStr = c.req.query('sessionId');

      const parseYMD = (s: string, endOfDay = false): Date | null => {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
        if (!m) return null;
        const y = Number(m[1]);
        const mo = Number(m[2]) - 1;
        const d = Number(m[3]);
        if (endOfDay) {
          return new Date(y, mo, d, 23, 59, 59, 999);
        }
        return new Date(y, mo, d, 0, 0, 0, 0);
      };

      const now = new Date();
      const defaultFrom = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
      let fromDate = from ? (parseYMD(from, false) || new Date(from)) : defaultFrom;
      let toDate = to ? (parseYMD(to, true) || new Date(to)) : now;
      if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid date range' }, 400);
      }
      if (fromDate > toDate) {
        const tmp = fromDate; fromDate = toDate; toDate = tmp;
      }

      let sessionFilter: any = {};
      if (sessionIdStr) {
        const sessionId = parseInt(sessionIdStr);
        if (!sessionId || Number.isNaN(sessionId)) {
          return c.json<ApiResponse>({ success: false, error: 'Invalid sessionId' }, 400);
        }
        const session = await prisma.chatSession.findUnique({ where: { id: sessionId } });
        if (!session || session.userId !== user.id) {
          return c.json<ApiResponse>({ success: false, error: 'Chat session not found' }, 404);
        }
        sessionFilter.sessionId = sessionId;
      } else {
        const sessions = await prisma.chatSession.findMany({
          where: { userId: user.id },
          select: { id: true },
        });
        sessionFilter.sessionId = { in: sessions.map((s) => s.id) };
      }

      const metrics = await (prisma as any).usageMetric.findMany({
        where: {
          ...sessionFilter,
          createdAt: { gte: fromDate, lte: toDate },
        },
        select: { createdAt: true, promptTokens: true, completionTokens: true, totalTokens: true },
        orderBy: { createdAt: 'asc' },
      });

      const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);
      const dayKey = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

      const byDay = new Map<string, { prompt_tokens: number; completion_tokens: number; total_tokens: number }>();
      for (const m of metrics) {
        const k = dayKey(new Date(m.createdAt));
        const cur = byDay.get(k) || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        cur.prompt_tokens += Number(m.promptTokens || 0);
        cur.completion_tokens += Number(m.completionTokens || 0);
        cur.total_tokens += Number(m.totalTokens || 0);
        byDay.set(k, cur);
      }

      const result = Array.from(byDay.entries()).map(([date, v]) => ({ date, ...v }));
      return c.json<ApiResponse>({
        success: true,
        data: { from: fromDate.toISOString(), to: toDate.toISOString(), rows: result },
      });
    } catch (error) {
      console.error('Get daily usage error:', error);
      return c.json<ApiResponse>({ success: false, error: 'Failed to fetch daily usage' }, 500);
    }
  });
};
