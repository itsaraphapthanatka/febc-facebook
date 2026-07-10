import { and, eq, gt, inArray, lt, lte } from 'drizzle-orm';
import { db } from '../../db/client';
import {
  broadcasts,
  broadcastTargets,
  messengerRecipients,
  pages,
  posts,
} from '../../db/schema';
import {
  sendImageMessage,
  sendTextMessage,
  uploadMessengerImage,
  uploadMessengerImageByUrl,
  type MessageTag,
} from '../../facebook/messenger';
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

/** True when the timestamp is set and still in the future (so the broadcast should be deferred). */
function isFuture(when?: Date): boolean {
  return !!when && when.getTime() > Date.now();
}

/** Inserts feed targets (one per active page) for an existing broadcast row. Returns the count. */
async function materializeFeedTargets(broadcast: BroadcastRow): Promise<number> {
  const targetPages = await db
    .select({ id: pages.id })
    .from(pages)
    .where(and(inArray(pages.id, broadcast.pageIds ?? []), eq(pages.isActive, true)));
  if (targetPages.length > 0) {
    await db
      .insert(broadcastTargets)
      .values(targetPages.map((p) => ({ broadcastId: broadcast.id, pageId: p.id })));
  }
  return targetPages.length;
}

/** Resolves whether sends are restricted to the 24h window, given tag + flag. */
function resolveWithin24h(messageTag: string | null, onlyWithin24h: boolean | null): boolean {
  // Without a message tag, Facebook only allows sends within 24h of the user's last message.
  return messageTag ? (onlyWithin24h ?? false) : true;
}

/** Inserts messenger targets (eligible recipients across the broadcast's pages) for an existing row. */
async function materializeMessengerTargets(broadcast: BroadcastRow): Promise<number> {
  const within24h = resolveWithin24h(broadcast.messageTag, broadcast.onlyWithin24h);
  const targetPages = await db
    .select({ id: pages.id })
    .from(pages)
    .where(and(inArray(pages.id, broadcast.pageIds ?? []), eq(pages.isActive, true)));

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

  if (targets.length > 0) {
    await db
      .insert(broadcastTargets)
      .values(targets.map((t) => ({ broadcastId: broadcast.id, ...t })));
  }
  return targets.length;
}

export interface FeedBroadcastInput {
  message: string;
  link?: string;
  imageUrl?: string;
  pageIds: string[];
  /** When set to a future time, the broadcast is stored and dispatched then instead of immediately. */
  scheduledAt?: Date;
}

export async function createFeedBroadcast(input: FeedBroadcastInput, logger: BroadcastLogger) {
  const targetPages = await loadActivePages(input.pageIds); // validate up front for both paths
  const scheduled = isFuture(input.scheduledAt);

  const [broadcast] = await db
    .insert(broadcasts)
    .values({
      kind: 'feed',
      message: input.message,
      link: input.link,
      imageUrl: input.imageUrl,
      pageIds: input.pageIds,
      status: scheduled ? 'scheduled' : 'pending',
      scheduledAt: scheduled ? input.scheduledAt : null,
    })
    .returning();

  if (scheduled) {
    return { broadcastId: broadcast.id, status: 'scheduled' as const, scheduledAt: broadcast.scheduledAt };
  }

  await db
    .insert(broadcastTargets)
    .values(targetPages.map((p) => ({ broadcastId: broadcast.id, pageId: p.id })));
  kickOffProcessing(broadcast.id, logger);
  return { broadcastId: broadcast.id, status: 'pending' as const, targetCount: targetPages.length };
}

export interface MessengerBroadcastInput {
  message: string;
  pageIds: string[];
  messageTag?: MessageTag;
  onlyWithin24h?: boolean;
  /** Optional image: `local:<file>` for an upload, or a public https URL. Sent as a second bubble. */
  imageUrl?: string;
  /** When set to a future time, the broadcast is stored and dispatched then instead of immediately. */
  scheduledAt?: Date;
}

export async function createMessengerBroadcast(input: MessengerBroadcastInput, logger: BroadcastLogger) {
  await loadActivePages(input.pageIds); // validate the pages exist/active up front
  const scheduled = isFuture(input.scheduledAt);

  const [broadcast] = await db
    .insert(broadcasts)
    .values({
      kind: 'messenger',
      message: input.message,
      messageTag: input.messageTag,
      imageUrl: input.imageUrl,
      pageIds: input.pageIds,
      onlyWithin24h: input.onlyWithin24h ?? null,
      status: scheduled ? 'scheduled' : 'pending',
      scheduledAt: scheduled ? input.scheduledAt : null,
    })
    .returning();

  if (scheduled) {
    // Recipients are resolved at dispatch, so the 24h window reflects the send time, not now.
    return { broadcastId: broadcast.id, status: 'scheduled' as const, scheduledAt: broadcast.scheduledAt };
  }

  const count = await materializeMessengerTargets(broadcast);
  if (count === 0) {
    await db.delete(broadcasts).where(eq(broadcasts.id, broadcast.id));
    const within24h = resolveWithin24h(input.messageTag ?? null, input.onlyWithin24h ?? null);
    throw new AppError(
      within24h
        ? 'No eligible recipients within the 24h messaging window'
        : 'No recipients found for the given pages',
      400,
    );
  }

  kickOffProcessing(broadcast.id, logger);
  return { broadcastId: broadcast.id, status: 'pending' as const, targetCount: count };
}

export interface BroadcastLogger {
  error(obj: unknown, msg?: string): void;
}

/**
 * Dispatches scheduled broadcasts whose time has arrived: claims each atomically (so overlapping
 * ticks can't double-send), materializes its targets now, then kicks off processing. Called each minute.
 */
export async function dispatchDueBroadcasts(logger: BroadcastLogger): Promise<number> {
  const due = await db
    .select()
    .from(broadcasts)
    .where(and(eq(broadcasts.status, 'scheduled'), lte(broadcasts.scheduledAt, new Date())))
    .limit(20);

  let dispatched = 0;
  for (const broadcast of due) {
    // Claim: flip scheduled → pending only if still scheduled. Losing the race → someone else has it.
    const claimed = await db
      .update(broadcasts)
      .set({ status: 'pending' })
      .where(and(eq(broadcasts.id, broadcast.id), eq(broadcasts.status, 'scheduled')))
      .returning({ id: broadcasts.id });
    if (claimed.length === 0) continue;

    try {
      const count =
        broadcast.kind === 'feed'
          ? await materializeFeedTargets(broadcast)
          : await materializeMessengerTargets(broadcast);
      if (count === 0) {
        await db.update(broadcasts).set({ status: 'failed' }).where(eq(broadcasts.id, broadcast.id));
        logger.error({ broadcastId: broadcast.id }, 'scheduled broadcast had no targets at dispatch');
        continue;
      }
      dispatched++;
      kickOffProcessing(broadcast.id, logger);
    } catch (err) {
      await db.update(broadcasts).set({ status: 'failed' }).where(eq(broadcasts.id, broadcast.id));
      logger.error({ err, broadcastId: broadcast.id }, 'scheduled broadcast dispatch failed');
    }
  }
  return dispatched;
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

  const attachmentCache = new Map<string, string>();
  for (const target of targets) {
    await sendToTarget(broadcast, target, attachmentCache);
    await sleep(FANOUT_DELAY_MS);
  }

  await finalizeBroadcastStatus(broadcastId);
}

type BroadcastRow = typeof broadcasts.$inferSelect;
type TargetRow = typeof broadcastTargets.$inferSelect;

/**
 * Resolves the reusable Messenger attachment_id for this broadcast's image on this page,
 * uploading it once and caching by broadcast+page so repeat recipients reuse the same id.
 */
async function resolveMessengerAttachment(
  broadcast: BroadcastRow,
  pageDbId: string,
  fbPageId: string,
  token: string,
  cache: Map<string, string>,
): Promise<string> {
  const key = `${broadcast.id}:${pageDbId}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const imageUrl = broadcast.imageUrl as string;
  let attachmentId: string;
  if (imageUrl.startsWith(LOCAL_IMAGE_PREFIX)) {
    const filename = imageUrl.slice(LOCAL_IMAGE_PREFIX.length);
    const buffer = await readUpload(filename);
    attachmentId = await uploadMessengerImage(fbPageId, token, {
      buffer,
      filename,
      mimetype: mimeFromName(filename),
    });
  } else {
    attachmentId = await uploadMessengerImageByUrl(fbPageId, token, imageUrl);
  }
  cache.set(key, attachmentId);
  return attachmentId;
}

export async function sendToTarget(
  broadcast: BroadcastRow,
  target: TargetRow,
  attachmentCache: Map<string, string> = new Map(),
): Promise<void> {
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
      const tag = broadcast.messageTag as MessageTag | null;
      fbId = await sendTextMessage(page.fbPageId, token, target.recipientPsid, broadcast.message, tag);
      // The Send API can't combine text and an image in one bubble — send the image as a follow-up.
      if (broadcast.imageUrl) {
        const attachmentId = await resolveMessengerAttachment(
          broadcast,
          page.id,
          page.fbPageId,
          token,
          attachmentCache,
        );
        await sendImageMessage(page.fbPageId, token, target.recipientPsid, attachmentId, tag);
      }
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

  const attachmentCache = new Map<string, string>();
  for (const target of failed) {
    const broadcast = byId.get(target.broadcastId);
    if (!broadcast) continue;
    await sendToTarget(broadcast, target, attachmentCache);
    await sleep(FANOUT_DELAY_MS);
  }
  for (const id of broadcastIds) await finalizeBroadcastStatus(id);
  return failed.length;
}
