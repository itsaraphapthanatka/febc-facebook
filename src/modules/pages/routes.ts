import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/client';
import { fbUsers, pages } from '../../db/schema';
import type { UploadFile } from '../../facebook/graphClient';
import {
  setCoverFromPhotoId,
  setCoverPhoto,
  setProfileFromPhotoId,
  setProfilePicture,
  subscribeApp,
  unsubscribeApp,
  uploadPagePhoto,
} from '../../facebook/pages';
import { decrypt } from '../../lib/crypto';
import { AppError } from '../../lib/errors';
import { isAllowedImage } from '../../lib/uploads';
import { refreshAllUsersPages } from '../auth/routes';

const idParamSchema = z.object({ id: z.string().uuid() });
const imageBodySchema = z.object({ imageUrl: z.string().url() });

// Public shape — token columns must never leave the service
const pageColumns = {
  id: pages.id,
  fbPageId: pages.fbPageId,
  name: pages.name,
  category: pages.category,
  isActive: pages.isActive,
  webhookSubscribed: pages.webhookSubscribed,
  createdAt: pages.createdAt,
  updatedAt: pages.updatedAt,
};

export async function getPageWithToken(id: string) {
  const [page] = await db.select().from(pages).where(eq(pages.id, id));
  if (!page) throw new AppError('Page not found', 404);
  return { ...page, pageAccessToken: decrypt(page.pageAccessTokenEnc) };
}

/** Reads a single uploaded image file from a multipart request. */
async function readImageFile(req: {
  file: () => Promise<{ toBuffer: () => Promise<Buffer>; filename?: string; mimetype: string } | undefined>;
}): Promise<UploadFile> {
  const data = await req.file();
  if (!data) throw new AppError('ไม่พบไฟล์ที่อัปโหลด', 400);
  if (!isAllowedImage(data.mimetype)) {
    throw new AppError('รองรับเฉพาะไฟล์รูปภาพ (jpg, png, gif, webp)', 400);
  }
  const buffer = await data.toBuffer();
  return { buffer, filename: data.filename || 'upload', mimetype: data.mimetype };
}

export async function pagesRoutes(app: FastifyInstance) {
  app.get('/api/pages', async () => {
    return db
      .select({ ...pageColumns, ownerName: fbUsers.name, ownerFbId: fbUsers.fbUserId })
      .from(pages)
      .leftJoin(fbUsers, eq(pages.fbUserId, fbUsers.id))
      .orderBy(desc(pages.createdAt));
  });

  app.get('/api/pages/:id', async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const [page] = await db.select(pageColumns).from(pages).where(eq(pages.id, id));
    if (!page) throw new AppError('Page not found', 404);
    return page;
  });

  app.post('/api/pages/refresh', async () => {
    const results = await refreshAllUsersPages();
    return { refreshed: results.map((r) => ({ user: r.user, pages: r.pages })) };
  });

  app.post('/api/pages/:id/subscribe', async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const page = await getPageWithToken(id);
    await subscribeApp(page.fbPageId, page.pageAccessToken);
    await db
      .update(pages)
      .set({ webhookSubscribed: true, updatedAt: new Date() })
      .where(eq(pages.id, id));
    return { subscribed: true, fields: 'feed,messages' };
  });

  app.delete('/api/pages/:id/subscribe', async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const page = await getPageWithToken(id);
    await unsubscribeApp(page.fbPageId, page.pageAccessToken);
    await db
      .update(pages)
      .set({ webhookSubscribed: false, updatedAt: new Date() })
      .where(eq(pages.id, id));
    return { subscribed: false };
  });

  // Accepts either a multipart file upload or a JSON { imageUrl }
  app.post('/api/pages/:id/cover', async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const page = await getPageWithToken(id);
    if (req.isMultipart()) {
      const file = await readImageFile(req);
      const photo = await uploadPagePhoto(page.fbPageId, page.pageAccessToken, file, { published: false });
      await setCoverFromPhotoId(page.fbPageId, page.pageAccessToken, photo.id);
      return { updated: true, photoId: photo.id };
    }
    const { imageUrl } = imageBodySchema.parse(req.body);
    const photoId = await setCoverPhoto(page.fbPageId, page.pageAccessToken, imageUrl);
    return { updated: true, photoId };
  });

  app.post('/api/pages/:id/profile-picture', async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const page = await getPageWithToken(id);
    if (req.isMultipart()) {
      const file = await readImageFile(req);
      const photo = await uploadPagePhoto(page.fbPageId, page.pageAccessToken, file, { published: false });
      await setProfileFromPhotoId(page.fbPageId, page.pageAccessToken, photo.id);
      return { updated: true, photoId: photo.id };
    }
    const { imageUrl } = imageBodySchema.parse(req.body);
    await setProfilePicture(page.fbPageId, page.pageAccessToken, imageUrl);
    return { updated: true };
  });

  app.patch('/api/pages/:id', async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const body = z.object({ isActive: z.boolean() }).parse(req.body);
    const [updated] = await db
      .update(pages)
      .set({ isActive: body.isActive, updatedAt: new Date() })
      .where(eq(pages.id, id))
      .returning(pageColumns);
    if (!updated) throw new AppError('Page not found', 404);
    return updated;
  });

  app.delete('/api/pages/:id', async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const deleted = await db.delete(pages).where(eq(pages.id, id)).returning({ id: pages.id });
    if (deleted.length === 0) throw new AppError('Page not found', 404);
    return { deleted: true };
  });
}
