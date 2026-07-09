import { and, count, eq, gt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/client';
import {
  broadcasts,
  messengerRecipients,
  pages,
  posts,
  schedules,
} from '../../db/schema';

/** Overview counters for the dashboard home. */
export async function statsRoute(app: FastifyInstance) {
  app.get('/api/stats', async () => {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [
      [pagesTotal],
      [pagesActive],
      [schedulesTotal],
      [schedulesActive],
      [postsPublished],
      [postsFailed],
      [broadcastsTotal],
      [recipients],
      [recipients24h],
    ] = await Promise.all([
      db.select({ v: count() }).from(pages),
      db.select({ v: count() }).from(pages).where(eq(pages.isActive, true)),
      db.select({ v: count() }).from(schedules),
      db.select({ v: count() }).from(schedules).where(eq(schedules.isActive, true)),
      db.select({ v: count() }).from(posts).where(eq(posts.status, 'published')),
      db.select({ v: count() }).from(posts).where(eq(posts.status, 'failed')),
      db.select({ v: count() }).from(broadcasts),
      db.select({ v: count() }).from(messengerRecipients),
      db
        .select({ v: count() })
        .from(messengerRecipients)
        .where(and(eq(messengerRecipients.optedOut, false), gt(messengerRecipients.lastInteractionAt, cutoff))),
    ]);

    return {
      pages: { total: pagesTotal.v, active: pagesActive.v },
      schedules: { total: schedulesTotal.v, active: schedulesActive.v },
      posts: { published: postsPublished.v, failed: postsFailed.v },
      broadcasts: { total: broadcastsTotal.v },
      messengerRecipients: { total: recipients.v, reachableNow: recipients24h.v },
    };
  });
}
