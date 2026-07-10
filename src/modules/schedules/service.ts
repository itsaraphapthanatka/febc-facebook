import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/client';
import { pages, posts, scheduleRuns, schedules } from '../../db/schema';
import { generatePost } from '../../openai/generator';
import { decrypt } from '../../lib/crypto';
import { publishPost, uploadPagePhoto } from '../../facebook/pages';
import { errorMessage, isRetryableError } from '../../lib/errors';
import { mimeFromName, readUpload } from '../../lib/uploads';
import { createMessengerBroadcast, LOCAL_IMAGE_PREFIX } from '../broadcast/service';

/** Publishes a scheduled feed post, attaching the schedule's image (uploaded file or public URL). */
async function publishScheduledPost(
  fbPageId: string,
  token: string,
  message: string,
  imageUrl: string | null,
): Promise<string> {
  if (imageUrl?.startsWith(LOCAL_IMAGE_PREFIX)) {
    const path = imageUrl.slice(LOCAL_IMAGE_PREFIX.length);
    const buffer = await readUpload(path);
    const filename = path.split('/').pop() ?? path;
    const res = await uploadPagePhoto(
      fbPageId,
      token,
      { buffer, filename, mimetype: mimeFromName(filename) },
      { published: true, caption: message },
    );
    return res.post_id ?? res.id;
  }
  return publishPost(fbPageId, token, { message, imageUrl: imageUrl ?? undefined });
}

const GENERATION_RETRY_DELAY_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Round-robin topic selection based on how many runs the schedule already has. */
async function pickTopic(scheduleId: string, topics: string[]): Promise<string | null> {
  if (topics.length === 0) return null;
  const [{ value: runCount }] = await db
    .select({ value: count() })
    .from(scheduleRuns)
    .where(eq(scheduleRuns.scheduleId, scheduleId));
  return topics[runCount % topics.length];
}

async function generateWithRetry(input: {
  promptTemplate: string;
  topic: string | null;
  model: string | null;
}) {
  try {
    return await generatePost(input);
  } catch {
    await sleep(GENERATION_RETRY_DELAY_MS);
    return generatePost(input);
  }
}

/** Executes one schedule run: generate content with OpenAI, post to every target page, record history. */
export async function runScheduleOnce(scheduleId: string): Promise<void> {
  const [schedule] = await db.select().from(schedules).where(eq(schedules.id, scheduleId));
  if (!schedule || !schedule.isActive) return;

  // Overlap guard — one run at a time per schedule (single instance, a DB check suffices)
  const running = await db
    .select({ id: scheduleRuns.id })
    .from(scheduleRuns)
    .where(and(eq(scheduleRuns.scheduleId, scheduleId), eq(scheduleRuns.status, 'running')))
    .limit(1);
  if (running.length > 0) return;

  const topic = await pickTopic(scheduleId, schedule.topics);
  const [run] = await db
    .insert(scheduleRuns)
    .values({ scheduleId, status: 'running' })
    .returning();

  let generated: { content: string; prompt: string };
  try {
    generated = await generateWithRetry({
      promptTemplate: schedule.promptTemplate,
      topic,
      model: schedule.model,
    });
  } catch (err) {
    await db
      .update(scheduleRuns)
      .set({ status: 'failed', error: `generation: ${errorMessage(err)}`, finishedAt: new Date() })
      .where(eq(scheduleRuns.id, run.id));
    await db.update(schedules).set({ lastRunAt: new Date() }).where(eq(schedules.id, scheduleId));
    return;
  }

  const targetPages = await db
    .select()
    .from(pages)
    .where(and(inArray(pages.id, schedule.targetPageIds), eq(pages.isActive, true)));

  let published = 0;
  for (const page of targetPages) {
    try {
      const fbPostId = await publishScheduledPost(
        page.fbPageId,
        decrypt(page.pageAccessTokenEnc),
        generated.content,
        schedule.imageUrl,
      );
      await db.insert(posts).values({
        pageId: page.id,
        fbPostId,
        source: 'schedule',
        sourceId: run.id,
        content: generated.content,
        status: 'published',
        attempts: 1,
        publishedAt: new Date(),
      });
      published++;
    } catch (err) {
      await db.insert(posts).values({
        pageId: page.id,
        source: 'schedule',
        sourceId: run.id,
        content: generated.content,
        status: 'failed',
        error: errorMessage(err),
        attempts: isRetryableError(err) ? 1 : 3,
      });
    }
  }

  // Optionally fan the same content out to Messenger recipients (within the 24h window).
  if (schedule.alsoMessenger && targetPages.length > 0) {
    try {
      await createMessengerBroadcast(
        {
          message: generated.content,
          imageUrl: schedule.imageUrl ?? undefined,
          pageIds: targetPages.map((p) => p.id),
        },
        console,
      );
    } catch (err) {
      // No eligible recipients (or other issues) shouldn't fail the feed run — just note it.
      console.error({ err: errorMessage(err), scheduleId }, 'scheduled messenger send skipped');
    }
  }

  const status =
    targetPages.length > 0 && published === targetPages.length
      ? 'success'
      : published > 0
        ? 'partial'
        : 'failed';
  await db
    .update(scheduleRuns)
    .set({
      status,
      generatedContent: generated.content,
      promptUsed: generated.prompt,
      finishedAt: new Date(),
      error: status === 'failed' ? 'all target pages failed or no active target pages' : null,
    })
    .where(eq(scheduleRuns.id, run.id));
  await db.update(schedules).set({ lastRunAt: new Date() }).where(eq(schedules.id, scheduleId));
}

export async function getScheduleWithRuns(scheduleId: string) {
  const [schedule] = await db.select().from(schedules).where(eq(schedules.id, scheduleId));
  if (!schedule) return null;
  const runs = await db
    .select()
    .from(scheduleRuns)
    .where(eq(scheduleRuns.scheduleId, scheduleId))
    .orderBy(desc(scheduleRuns.startedAt))
    .limit(10);
  return { ...schedule, recentRuns: runs };
}
