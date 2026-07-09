import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/client';
import { broadcasts, broadcastTargets } from '../../db/schema';
import { MESSAGE_TAGS } from '../../facebook/messenger';
import { AppError } from '../../lib/errors';
import { isAllowedImage, saveUpload } from '../../lib/uploads';
import { createFeedBroadcast, createMessengerBroadcast, LOCAL_IMAGE_PREFIX } from './service';

const feedBodySchema = z
  .object({
    message: z.string().min(1).max(60000),
    link: z.string().url().optional(),
    imageUrl: z.string().url().optional(),
    pageIds: z.array(z.string().uuid()).min(1),
  })
  .refine((b) => !(b.link && b.imageUrl), {
    message: 'Provide either link or imageUrl, not both',
  });

const messengerBodySchema = z.object({
  message: z.string().min(1).max(2000),
  pageIds: z.array(z.string().uuid()).min(1),
  messageTag: z.enum(MESSAGE_TAGS).optional(),
  onlyWithin24h: z.boolean().optional(),
});

const idParamSchema = z.object({ id: z.string().uuid() });

const feedMultipartSchema = z.object({
  message: z.string().min(1).max(60000),
  pageIds: z.array(z.string().uuid()).min(1),
});

/** Parses a multipart feed broadcast: message + repeated pageIds fields + one image file. */
async function parseMultipartFeed(req: FastifyRequest) {
  let message = '';
  const pageIds: string[] = [];
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
    }
  }

  const parsed = feedMultipartSchema.parse({ message, pageIds });
  return { ...parsed, imageUrl: savedImage };
}

export async function broadcastRoutes(app: FastifyInstance) {
  app.post('/api/broadcasts/feed', async (req, reply) => {
    if (req.isMultipart()) {
      const result = await createFeedBroadcast(await parseMultipartFeed(req), req.log);
      return reply.code(202).send({ ...result, status: 'pending' });
    }
    const body = feedBodySchema.parse(req.body);
    const result = await createFeedBroadcast(body, req.log);
    return reply.code(202).send({ ...result, status: 'pending' });
  });

  app.post('/api/broadcasts/messenger', async (req, reply) => {
    const body = messengerBodySchema.parse(req.body);
    const result = await createMessengerBroadcast(body, req.log);
    return reply.code(202).send({ ...result, status: 'pending' });
  });

  app.get('/api/broadcasts', async () => {
    const rows = await db.select().from(broadcasts).orderBy(desc(broadcasts.createdAt)).limit(50);
    return rows;
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
}
