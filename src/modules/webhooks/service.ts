import { createHmac, timingSafeEqual } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { messengerRecipients, pages, webhookEvents } from '../../db/schema';
import { listConversations } from '../../facebook/messenger';
import { decrypt } from '../../lib/crypto';
import { errorMessage } from '../../lib/errors';

/** Verifies X-Hub-Signature-256 (HMAC-SHA256 of the raw body with the app secret). */
export function verifyWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const received = signatureHeader.slice('sha256='.length);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

interface MessagingEvent {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: { is_echo?: boolean };
}

interface WebhookEntry {
  id?: string;
  time?: number;
  changes?: { field?: string; value?: unknown }[];
  messaging?: MessagingEvent[];
}

export interface WebhookBody {
  object?: string;
  entry?: WebhookEntry[];
}

/** Persists incoming events and harvests messenger sender PSIDs for the broadcast audience. */
export async function processWebhookBody(body: WebhookBody): Promise<void> {
  for (const entry of body.entry ?? []) {
    const fbPageId = entry.id ?? null;
    const field = entry.messaging ? 'messages' : (entry.changes?.[0]?.field ?? null);

    const [event] = await db
      .insert(webhookEvents)
      .values({
        object: body.object ?? null,
        field,
        fbPageId,
        payload: entry as Record<string, unknown>,
      })
      .returning({ id: webhookEvents.id });

    if (entry.messaging && fbPageId) {
      await harvestRecipients(fbPageId, entry.messaging);
    }

    await db
      .update(webhookEvents)
      .set({ processed: true })
      .where(eq(webhookEvents.id, event.id));
  }
}

/** Upserts a recipient, never regressing lastInteractionAt to an older value. */
async function upsertRecipient(pageDbId: string, psid: string, interactedAt: Date): Promise<void> {
  await db
    .insert(messengerRecipients)
    .values({ pageId: pageDbId, psid, lastInteractionAt: interactedAt })
    .onConflictDoUpdate({
      target: [messengerRecipients.pageId, messengerRecipients.psid],
      set: {
        lastInteractionAt: sql`GREATEST(${messengerRecipients.lastInteractionAt}, ${interactedAt.toISOString()}::timestamptz)`,
      },
    });
}

async function harvestRecipients(fbPageId: string, events: MessagingEvent[]): Promise<void> {
  const [page] = await db.select({ id: pages.id }).from(pages).where(eq(pages.fbPageId, fbPageId));
  if (!page) return; // page not connected to this middleware

  for (const m of events) {
    const psid = m.sender?.id;
    // Echo events are the page's own outgoing messages — the sender is the page, not a person.
    if (!psid || psid === fbPageId || m.message?.is_echo) continue;
    await upsertRecipient(page.id, psid, m.timestamp ? new Date(m.timestamp) : new Date());
  }
}

export interface SyncResult {
  pagesSynced: number;
  recipients: number;
  errors: { page: string; error: string }[];
}

/**
 * Backfills messenger_recipients from the Graph Conversations API for every active page.
 * Unlike webhooks (which Facebook only delivers for app-role users while the app is in
 * Development Mode), this captures everyone who has an open conversation with the page.
 */
export async function syncRecipientsFromConversations(): Promise<SyncResult> {
  const activePages = await db.select().from(pages).where(eq(pages.isActive, true));
  const result: SyncResult = { pagesSynced: 0, recipients: 0, errors: [] };

  for (const page of activePages) {
    try {
      const token = decrypt(page.pageAccessTokenEnc);
      const conversations = await listConversations(page.fbPageId, token);
      for (const convo of conversations) {
        const interactedAt = convo.updated_time ? new Date(convo.updated_time) : new Date();
        for (const p of convo.participants?.data ?? []) {
          // The page itself is a participant — skip it; keep the human counterpart(s).
          if (!p.id || p.id === page.fbPageId) continue;
          await upsertRecipient(page.id, p.id, interactedAt);
          result.recipients++;
        }
      }
      result.pagesSynced++;
    } catch (err) {
      result.errors.push({ page: page.name, error: errorMessage(err) });
    }
  }
  return result;
}
