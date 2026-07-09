import { and, desc, eq, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/client';
import { messengerRecipients, posts } from '../../db/schema';

const postsQuerySchema = z.object({
  pageId: z.string().uuid().optional(),
  source: z.enum(['broadcast', 'schedule', 'api']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const recipientsQuerySchema = z.object({
  pageId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export async function historyRoutes(app: FastifyInstance) {
  app.get('/api/posts', async (req) => {
    const q = postsQuerySchema.parse(req.query);
    const conditions: SQL[] = [];
    if (q.pageId) conditions.push(eq(posts.pageId, q.pageId));
    if (q.source) conditions.push(eq(posts.source, q.source));
    return db
      .select()
      .from(posts)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(posts.createdAt))
      .limit(q.limit);
  });

  app.get('/api/messenger/recipients', async (req) => {
    const q = recipientsQuerySchema.parse(req.query);
    return db
      .select()
      .from(messengerRecipients)
      .where(q.pageId ? eq(messengerRecipients.pageId, q.pageId) : undefined)
      .orderBy(desc(messengerRecipients.lastInteractionAt))
      .limit(q.limit);
  });
}
