import { createHmac, timingSafeEqual } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { messengerRecipients, pages, webhookEvents } from '../../db/schema';

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

async function harvestRecipients(fbPageId: string, events: MessagingEvent[]): Promise<void> {
  const [page] = await db.select({ id: pages.id }).from(pages).where(eq(pages.fbPageId, fbPageId));
  if (!page) return; // page not connected to this middleware

  for (const m of events) {
    const psid = m.sender?.id;
    // Echo events are the page's own outgoing messages — the sender is the page, not a person.
    if (!psid || psid === fbPageId || m.message?.is_echo) continue;
    const interactedAt = m.timestamp ? new Date(m.timestamp) : new Date();

    await db
      .insert(messengerRecipients)
      .values({ pageId: page.id, psid, lastInteractionAt: interactedAt })
      .onConflictDoUpdate({
        target: [messengerRecipients.pageId, messengerRecipients.psid],
        set: {
          lastInteractionAt: sql`GREATEST(${messengerRecipients.lastInteractionAt}, ${interactedAt.toISOString()}::timestamptz)`,
        },
      });
  }
}
