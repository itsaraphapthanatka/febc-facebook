import { and, eq, lt } from 'drizzle-orm';
import { db } from '../db/client';
import { pages, posts, scheduleRuns } from '../db/schema';
import { publishPost } from '../facebook/pages';
import { decrypt } from '../lib/crypto';
import { errorMessage, isRetryableError } from '../lib/errors';
import { cleanupOldUploads } from '../lib/uploads';
import { MAX_ATTEMPTS, retryFailedTargets } from '../modules/broadcast/service';

interface SweeperLogger {
  info(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

const STALE_RUN_MS = 30 * 60 * 1000;

/** Periodic recovery pass: retry failed broadcast targets and scheduled posts, fail stale runs. */
export async function runSweeper(log: SweeperLogger): Promise<void> {
  const retriedTargets = await retryFailedTargets();
  const retriedPosts = await retryFailedSchedulePosts();
  const staleRuns = await failStaleRuns();
  // Remove uploaded broadcast images older than 24h (past the retry window)
  const cleanedUploads = await cleanupOldUploads(24 * 60 * 60 * 1000);
  if (retriedTargets || retriedPosts || staleRuns || cleanedUploads) {
    log.info({ retriedTargets, retriedPosts, staleRuns, cleanedUploads }, 'sweeper pass finished');
  }
}

async function retryFailedSchedulePosts(): Promise<number> {
  const failed = await db
    .select()
    .from(posts)
    .where(
      and(eq(posts.source, 'schedule'), eq(posts.status, 'failed'), lt(posts.attempts, MAX_ATTEMPTS)),
    )
    .limit(50);

  for (const post of failed) {
    const [page] = await db.select().from(pages).where(eq(pages.id, post.pageId));
    const attempts = post.attempts + 1;
    if (!page || !page.isActive) {
      await db.update(posts).set({ attempts: MAX_ATTEMPTS }).where(eq(posts.id, post.id));
      continue;
    }
    try {
      const fbPostId = await publishPost(page.fbPageId, decrypt(page.pageAccessTokenEnc), {
        message: post.content,
      });
      await db
        .update(posts)
        .set({ status: 'published', fbPostId, attempts, publishedAt: new Date(), error: null })
        .where(eq(posts.id, post.id));
    } catch (err) {
      await db
        .update(posts)
        .set({
          attempts: isRetryableError(err) ? attempts : MAX_ATTEMPTS,
          error: errorMessage(err),
        })
        .where(eq(posts.id, post.id));
    }
  }
  return failed.length;
}

/** Marks runs stuck in 'running' (e.g. process crashed mid-run) as failed so the overlap guard releases. */
async function failStaleRuns(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_RUN_MS);
  const stale = await db
    .update(scheduleRuns)
    .set({ status: 'failed', error: 'stale run (process interrupted)', finishedAt: new Date() })
    .where(and(eq(scheduleRuns.status, 'running'), lt(scheduleRuns.startedAt, cutoff)))
    .returning({ id: scheduleRuns.id });
  return stale.length;
}
