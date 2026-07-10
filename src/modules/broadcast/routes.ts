import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/client';
import { broadcasts, broadcastTargets } from '../../db/schema';
import { MESSAGE_TAGS, type MessageTag } from '../../facebook/messenger';
import { AppError } from '../../lib/errors';
import { isAllowedImage, saveUpload, uploadExists } from '../../lib/uploads';
import { createFeedBroadcast, createMessengerBroadcast, LOCAL_IMAGE_PREFIX } from './service';

// ISO 8601 timestamp in the future; the client sends new Date(localInput).toISOString().
const scheduledAtField = z
  .string()
  .datetime({ message: 'scheduledAt must be an ISO 8601 timestamp' })
  .refine((s) => new Date(s).getTime() > Date.now(), { message: 'scheduledAt must be in the future' })
  .optional();

const feedBodySchema = z
  .object({
    message: z.string().min(1).max(60000),
    link: z.string().url().optional(),
    imageUrl: z.string().url().optional(),
    pageIds: z.array(z.string().uuid()).min(1),
    scheduledAt: scheduledAtField,
  })
  .refine((b) => !(b.link && b.imageUrl), {
    message: 'Provide either link or imageUrl, not both',
  });

const messengerBodySchema = z.object({
  message: z.string().min(1).max(2000),
  pageIds: z.array(z.string().uuid()).min(1),
  messageTag: z.enum(MESSAGE_TAGS).optional(),
  onlyWithin24h: z.boolean().optional(),
  imageUrl: z.string().url().optional(),
  scheduledAt: scheduledAtField,
});

const idParamSchema = z.object({ id: z.string().uuid() });

const listQuerySchema = z.object({ status: z.enum(['scheduled']).optional() });

// Edit a scheduled broadcast: reschedule (drag/drop or time edit) and/or change the message.
const patchBodySchema = z
  .object({
    scheduledAt: scheduledAtField,
    message: z.string().min(1).max(60000).optional(),
  })
  .refine((b) => b.scheduledAt !== undefined || b.message !== undefined, {
    message: 'Nothing to update',
  });

const feedMultipartSchema = z.object({
  message: z.string().min(1).max(60000),
  pageIds: z.array(z.string().uuid()).min(1),
  scheduledAt: scheduledAtField,
});

const messengerMultipartSchema = z.object({
  message: z.string().min(1).max(2000),
  pageIds: z.array(z.string().uuid()).min(1),
  messageTag: z.enum(MESSAGE_TAGS).optional(),
  onlyWithin24h: z.boolean().optional(),
  scheduledAt: scheduledAtField,
});

/** Turns a validated body's scheduledAt string into the Date the service layer expects. */
function withScheduledDate<T extends { scheduledAt?: string }>(body: T) {
  const { scheduledAt, ...rest } = body;
  return { ...rest, scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined };
}

/** Parses a multipart feed broadcast: message + repeated pageIds fields + one image file. */
async function parseMultipartFeed(req: FastifyRequest) {
  let message = '';
  const pageIds: string[] = [];
  let scheduledAt: string | undefined;
  let savedImage: string | undefined;

  for await (const part of req.parts()) {
    if (part.type === 'file') {
      if (part.fieldname === 'image' && !savedImage) {
        if (!isAllowedImage(part.mimetype)) {
          throw new AppError('รองรับเฉพาะไฟล์รูปภาพ (jpg, png, gif, webp)', 400);
        }
        const buffer = await part.toBuffer();
        savedImage = LOCAL_IMAGE_PREFIX + (await saveUpload(buffer, part.mimetype));
      } else {
        part.file.resume(); // drain ignored files
      }
    } else if (part.fieldname === 'message') {
      message = String(part.value);
    } else if (part.fieldname === 'pageIds') {
      pageIds.push(String(part.value));
    } else if (part.fieldname === 'scheduledAt' && part.value) {
      scheduledAt = String(part.value);
    }
  }

  const parsed = feedMultipartSchema.parse({ message, pageIds, scheduledAt });
  return { ...withScheduledDate(parsed), imageUrl: savedImage };
}

/** Parses a multipart messenger broadcast: message + repeated pageIds + optional tag/flag + one image file. */
async function parseMultipartMessenger(req: FastifyRequest) {
  let message = '';
  const pageIds: string[] = [];
  let messageTag: string | undefined;
  let onlyWithin24h: boolean | undefined;
  let scheduledAt: string | undefined;
  let savedImage: string | undefined;

  for await (const part of req.parts()) {
    if (part.type === 'file') {
      if (part.fieldname === 'image' && !savedImage) {
        if (!isAllowedImage(part.mimetype)) {
          throw new AppError('รองรับเฉพาะไฟล์รูปภาพ (jpg, png, gif, webp)', 400);
        }
        const buffer = await part.toBuffer();
        savedImage = LOCAL_IMAGE_PREFIX + (await saveUpload(buffer, part.mimetype));
      } else {
        part.file.resume(); // drain ignored files
      }
    } else if (part.fieldname === 'message') {
      message = String(part.value);
    } else if (part.fieldname === 'pageIds') {
      pageIds.push(String(part.value));
    } else if (part.fieldname === 'messageTag' && part.value) {
      messageTag = String(part.value);
    } else if (part.fieldname === 'onlyWithin24h') {
      onlyWithin24h = String(part.value) === 'true';
    } else if (part.fieldname === 'scheduledAt' && part.value) {
      scheduledAt = String(part.value);
    }
  }

  const parsed = messengerMultipartSchema.parse({ message, pageIds, messageTag, onlyWithin24h, scheduledAt });
  return { ...withScheduledDate(parsed), imageUrl: savedImage };
}

export async function broadcastRoutes(app: FastifyInstance) {
  app.post('/api/broadcasts/feed', async (req, reply) => {
    const input = req.isMultipart()
      ? await parseMultipartFeed(req)
      : withScheduledDate(feedBodySchema.parse(req.body));
    const result = await createFeedBroadcast(input, req.log);
    return reply.code(202).send(result);
  });

  app.post('/api/broadcasts/messenger', async (req, reply) => {
    const input = req.isMultipart()
      ? await parseMultipartMessenger(req)
      : withScheduledDate(messengerBodySchema.parse(req.body));
    const result = await createMessengerBroadcast(input, req.log);
    return reply.code(202).send(result);
  });

  app.get('/api/broadcasts', async (req) => {
    const { status } = listQuerySchema.parse(req.query);
    if (status === 'scheduled') {
      // Calendar view: all upcoming scheduled broadcasts, soonest first.
      return db
        .select()
        .from(broadcasts)
        .where(eq(broadcasts.status, 'scheduled'))
        .orderBy(broadcasts.scheduledAt)
        .limit(500);
    }
    return db.select().from(broadcasts).orderBy(desc(broadcasts.createdAt)).limit(50);
  });

  app.get('/api/broadcasts/:id', async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const [broadcast] = await db.select().from(broadcasts).where(eq(broadcasts.id, id));
    if (!broadcast) throw new AppError('Broadcast not found', 404);
    const targets = await db
      .select()
      .from(broadcastTargets)
      .where(eq(broadcastTargets.broadcastId, id));
    return { ...broadcast, targets };
  });

  // Resend a past broadcast: create a fresh one from the original's content, sending now.
  app.post('/api/broadcasts/:id/resend', async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const [orig] = await db.select().from(broadcasts).where(eq(broadcasts.id, id));
    if (!orig) throw new AppError('Broadcast not found', 404);
    if (!orig.pageIds || orig.pageIds.length === 0) {
      throw new AppError('Broadcast นี้ไม่มีข้อมูลเพจปลายทาง จึงส่งซ้ำไม่ได้', 400);
    }

    // An uploaded image may have been pruned since the original send — drop it if gone.
    let imageUrl = orig.imageUrl ?? undefined;
    let imageOmitted = false;
    if (imageUrl?.startsWith(LOCAL_IMAGE_PREFIX)) {
      const filename = imageUrl.slice(LOCAL_IMAGE_PREFIX.length);
      if (!(await uploadExists(filename))) {
        imageUrl = undefined;
        imageOmitted = true;
      }
    }

    const result =
      orig.kind === 'feed'
        ? await createFeedBroadcast(
            { message: orig.message, link: orig.link ?? undefined, imageUrl, pageIds: orig.pageIds },
            req.log,
          )
        : await createMessengerBroadcast(
            {
              message: orig.message,
              imageUrl,
              messageTag: (orig.messageTag as MessageTag) ?? undefined,
              onlyWithin24h: orig.onlyWithin24h ?? undefined,
              pageIds: orig.pageIds,
            },
            req.log,
          );

    return reply.code(202).send({ ...result, imageOmitted });
  });

  // Edit a scheduled broadcast (reschedule and/or change message). Only while still 'scheduled'.
  app.patch('/api/broadcasts/:id', async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const body = patchBodySchema.parse(req.body);
    const [broadcast] = await db.select().from(broadcasts).where(eq(broadcasts.id, id));
    if (!broadcast) throw new AppError('Broadcast not found', 404);
    if (broadcast.status !== 'scheduled') {
      throw new AppError('Only scheduled broadcasts can be edited', 400);
    }
    if (broadcast.kind === 'messenger' && body.message && body.message.length > 2000) {
      throw new AppError('ข้อความ Messenger ต้องไม่เกิน 2000 ตัวอักษร', 400);
    }
    const patch: { scheduledAt?: Date; message?: string } = {};
    if (body.scheduledAt) patch.scheduledAt = new Date(body.scheduledAt);
    if (body.message !== undefined) patch.message = body.message;
    const [updated] = await db.update(broadcasts).set(patch).where(eq(broadcasts.id, id)).returning();
    return updated;
  });

  // Cancel a scheduled broadcast before it fires (only while still 'scheduled').
  app.delete('/api/broadcasts/:id', async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const [broadcast] = await db.select().from(broadcasts).where(eq(broadcasts.id, id));
    if (!broadcast) throw new AppError('Broadcast not found', 404);
    if (broadcast.status !== 'scheduled') {
      throw new AppError('Only scheduled broadcasts can be cancelled', 400);
    }
    await db.delete(broadcasts).where(eq(broadcasts.id, id));
    return { cancelled: true };
  });
}
