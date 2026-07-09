import { and, eq, gt, inArray, lt } from 'drizzle-orm';
import { db } from '../../db/client';
import {
  broadcasts,
  broadcastTargets,
  messengerRecipients,
  pages,
  posts,
} from '../../db/schema';
import { sendTextMessage, type MessageTag } from '../../facebook/messenger';
import { publishPost, uploadPagePhoto } from '../../facebook/pages';
import { decrypt } from '../../lib/crypto';
import { AppError, errorMessage, isRetryableError } from '../../lib/errors';
import { mimeFromName, readUpload } from '../../lib/uploads';

/** Marker stored in broadcasts.imageUrl for an uploaded (local) image file. */
export const LOCAL_IMAGE_PREFIX = 'local:';

export const MAX_ATTEMPTS = 3;
const FANOUT_DELAY_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadActivePages(pageIds: string[]) {
  const rows = await db
    .select()
    .from(pages)
    .where(and(inArray(pages.id, pageIds), eq(pages.isActive, true)));
  if (rows.length === 0) throw new AppError('No active connected pages match the given pageIds', 400);
  return rows;
}

export interface FeedBroadcastInput {
  message: string;
  link?: string;
  imageUrl?: string;
  pageIds: string[];
}

export async function createFeedBroadcast(input: FeedBroadcastInput, logger: BroadcastLogger) {
  const targetPages = await loadActivePages(input.pageIds);

  const [broadcast] = await db
    .insert(broadcasts)
    .values({
      kind: 'feed',
      message: input.message,
      link: input.link,
      imageUrl: input.imageUrl,
    })
    .returning();

  await db
    .insert(broadcastTargets)
    .values(targetPages.map((p) => ({ broadcastId: broadcast.id, pageId: p.id })));

  kickOffProcessing(broadcast.id, logger);
  return { broadcastId: broadcast.id, targetCount: targetPages.length };
}

export interface MessengerBroadcastInput {
  message: string;
  pageIds: string[];
  messageTag?: MessageTag;
  onlyWithin24h?: boolean;
}

export async function createMessengerBroadcast(input: MessengerBroadcastInput, logger: BroadcastLogger) {
  // Without a message tag, Facebook only allows sends within 24h of the user's last message.
  const within24h = input.messageTag ? (input.onlyWithin24h ?? false) : true;
  const targetPages = await loadActivePages(input.pageIds);

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const targets: { pageId: string; recipientPsid: string }[] = [];
  for (const page of targetPages) {
    const conditions = [
      eq(messengerRecipients.pageId, page.id),
      eq(messengerRecipients.optedOut, false),
    ];
    if (within24h) conditions.push(gt(messengerRecipients.lastInteractionAt, cutoff));
    const recipients = await db
      .select({ psid: messengerRecipients.psid })
      .from(messengerRecipients)
      .where(and(...conditions));
    targets.push(...recipients.map((r) => ({ pageId: page.id, recipientPsid: r.psid })));
  }

  if (targets.length === 0) {
    throw new AppError(
      within24h
        ? 'No eligible recipients within the 24h messaging window'
        : 'No recipients found for the given pages',
      400,
    );
  }

  const [broadcast] = await db
    .insert(broadcasts)
    .values({
      kind: 'messenger',
      message: input.message,
      messageTag: input.messageTag,
    })
    .returning();

  await db
    .insert(broadcastTargets)
    .values(targets.map((t) => ({ broadcastId: broadcast.id, ...t })));

  kickOffProcessing(broadcast.id, logger);
  return { broadcastId: broadcast.id, targetCount: targets.length };
}

export interface BroadcastLogger {
  error(obj: unknown, msg?: string): void;
}

function kickOffProcessing(broadcastId: string, logger: BroadcastLogger): void {
  setImmediate(() => {
    processBroadcast(broadcastId).catch((err) => {
      logger.error({ err, broadcastId }, 'broadcast processing failed');
    });
  });
}

export async function processBroadcast(broadcastId: string): Promise<void> {
  const [broadcast] = await db.select().from(broadcasts).where(eq(broadcasts.id, broadcastId));
  if (!broadcast) return;

  await db.update(broadcasts).set({ status: 'running' }).where(eq(broadcasts.id, broadcastId));

  const targets = await db
    .select()
    .from(broadcastTargets)
    .where(and(eq(broadcastTargets.broadcastId, broadcastId), eq(broadcastTargets.status, 'pending')));

  for (const target of targets) {
    await sendToTarget(broadcast, target);
    await sleep(FANOUT_DELAY_MS);
  }

  await finalizeBroadcastStatus(broadcastId);
}

type BroadcastRow = typeof broadcasts.$inferSelect;
type TargetRow = typeof broadcastTargets.$inferSelect;

export async function sendToTarget(broadcast: BroadcastRow, target: TargetRow): Promise<void> {
  const [page] = await db.select().from(pages).where(eq(pages.id, target.pageId));
  const attempts = target.attempts + 1;

  if (!page || !page.isActive) {
    await db
      .update(broadcastTargets)
      .set({ status: 'failed', error: 'Page not found or inactive', attempts: MAX_ATTEMPTS })
      .where(eq(broadcastTargets.id, target.id));
    return;
  }

  try {
    const token = decrypt(page.pageAccessTokenEnc);
    let fbId: string;
    if (broadcast.kind === 'messenger') {
      if (!target.recipientPsid) throw new AppError('Missing recipient PSID', 500);
      fbId = await sendTextMessage(
        page.fbPageId,
        token,
        target.recipientPsid,
        broadcast.message,
        broadcast.messageTag as MessageTag | null,
      );
    } else if (broadcast.imageUrl?.startsWith(LOCAL_IMAGE_PREFIX)) {
      // Uploaded image: read the temp file and send the binary to this page
      const filename = broadcast.imageUrl.slice(LOCAL_IMAGE_PREFIX.length);
      const buffer = await readUpload(filename);
      const res = await uploadPagePhoto(
        page.fbPageId,
        token,
        { buffer, filename, mimetype: mimeFromName(filename) },
        { published: true, caption: broadcast.message },
      );
      fbId = res.post_id ?? res.id;
      await db.insert(posts).values({
        pageId: page.id,
        fbPostId: fbId,
        source: 'broadcast',
        sourceId: broadcast.id,
        content: broadcast.message,
        status: 'published',
        attempts,
        publishedAt: new Date(),
      });
    } else {
      fbId = await publishPost(page.fbPageId, token, {
        message: broadcast.message,
        link: broadcast.link,
        imageUrl: broadcast.imageUrl,
      });
      await db.insert(posts).values({
        pageId: page.id,
        fbPostId: fbId,
        source: 'broadcast',
        sourceId: broadcast.id,
        content: broadcast.message,
        status: 'published',
        attempts,
        publishedAt: new Date(),
      });
    }
    await db
      .update(broadcastTargets)
      .set({ status: 'sent', fbPostId: fbId, attempts, sentAt: new Date(), error: null })
      .where(eq(broadcastTargets.id, target.id));
  } catch (err) {
    // Non-retryable errors (dead token, permission, outside window) are maxed out so the sweeper skips them.
    const finalAttempts = isRetryableError(err) ? attempts : MAX_ATTEMPTS;
    await db
      .update(broadcastTargets)
      .set({ status: 'failed', error: errorMessage(err), attempts: finalAttempts })
      .where(eq(broadcastTargets.id, target.id));
  }
}

export async function finalizeBroadcastStatus(broadcastId: string): Promise<void> {
  const targets = await db
    .select({ status: broadcastTargets.status })
    .from(broadcastTargets)
    .where(eq(broadcastTargets.broadcastId, broadcastId));

  const sent = targets.filter((t) => t.status === 'sent').length;
  const status =
    sent === targets.length ? 'completed' : sent > 0 ? 'partial' : 'failed';
  await db.update(broadcasts).set({ status }).where(eq(broadcasts.id, broadcastId));
}

/** Retries failed targets that still have attempts left; used by the sweeper cron. */
export async function retryFailedTargets(): Promise<number> {
  const failed = await db
    .select()
    .from(broadcastTargets)
    .where(and(eq(broadcastTargets.status, 'failed'), lt(broadcastTargets.attempts, MAX_ATTEMPTS)))
    .limit(50);
  if (failed.length === 0) return 0;

  const broadcastIds = [...new Set(failed.map((t) => t.broadcastId))];
  const rows = await db.select().from(broadcasts).where(inArray(broadcasts.id, broadcastIds));
  const byId = new Map(rows.map((b) => [b.id, b]));

  for (const target of failed) {
    const broadcast = byId.get(target.broadcastId);
    if (!broadcast) continue;
    await sendToTarget(broadcast, target);
    await sleep(FANOUT_DELAY_MS);
  }
  for (const id of broadcastIds) await finalizeBroadcastStatus(id);
  return failed.length;
}
