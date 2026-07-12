import { graphDelete, graphGet, graphPost, graphPostForm, type UploadFile } from './graphClient';

export interface PublishInput {
  message: string;
  link?: string | null;
  imageUrl?: string | null;
}

/** Publishes to a page; photo posts go to /photos, everything else to /feed. Returns the fb post id. */
export async function publishPost(
  fbPageId: string,
  pageToken: string,
  input: PublishInput,
): Promise<string> {
  if (input.imageUrl) {
    const res = await graphPost<{ id: string; post_id?: string }>(`${fbPageId}/photos`, pageToken, {
      url: input.imageUrl,
      caption: input.message,
    });
    return res.post_id ?? res.id;
  }
  const body: Record<string, unknown> = { message: input.message };
  if (input.link) body.link = input.link;
  const res = await graphPost<{ id: string }>(`${fbPageId}/feed`, pageToken, body);
  return res.id;
}

/** Uploads a photo file to a page. published=false → unpublished (no public change), returns photo id. */
export async function uploadPagePhoto(
  fbPageId: string,
  pageToken: string,
  file: UploadFile,
  opts: { published: boolean; caption?: string },
): Promise<{ id: string; post_id?: string }> {
  const fields: Record<string, string> = { published: String(opts.published) };
  if (opts.caption) fields.caption = opts.caption;
  return graphPostForm<{ id: string; post_id?: string }>(`${fbPageId}/photos`, pageToken, fields, file);
}

/** Sets the page profile picture from an image URL. */
export async function setProfilePicture(
  fbPageId: string,
  pageToken: string,
  pictureUrl: string,
): Promise<void> {
  await graphPost(`${fbPageId}/picture`, pageToken, { picture: pictureUrl });
}

/** Sets the page profile picture from an already-uploaded photo id. */
export async function setProfileFromPhotoId(
  fbPageId: string,
  pageToken: string,
  photoId: string,
): Promise<void> {
  await graphPost(`${fbPageId}/picture`, pageToken, { photo: photoId });
}

/** Sets the page cover photo from an already-uploaded photo id. */
export async function setCoverFromPhotoId(
  fbPageId: string,
  pageToken: string,
  photoId: string,
): Promise<void> {
  await graphPost(`${fbPageId}`, pageToken, { cover: photoId });
}

/**
 * Sets the page cover photo from an image URL.
 * Two steps: upload the photo unpublished, then point the page's `cover` at it.
 * Returns the uploaded photo id.
 */
export async function setCoverPhoto(
  fbPageId: string,
  pageToken: string,
  imageUrl: string,
): Promise<string> {
  const photo = await graphPost<{ id: string }>(`${fbPageId}/photos`, pageToken, {
    url: imageUrl,
    published: false,
  });
  await graphPost(`${fbPageId}`, pageToken, { cover: photo.id });
  return photo.id;
}

export interface PageImages {
  coverUrl: string | null;
  profilePictureUrl: string | null;
}

/** Fetches the page's current cover photo and profile picture URLs. */
export async function fetchPageImages(fbPageId: string, pageToken: string): Promise<PageImages> {
  const res = await graphGet<{
    cover?: { source?: string };
    picture?: { data?: { url?: string } };
  }>(fbPageId, pageToken, {
    fields: 'cover,picture.width(320).height(320)',
  });
  return {
    coverUrl: res.cover?.source ?? null,
    profilePictureUrl: res.picture?.data?.url ?? null,
  };
}

export const WEBHOOK_FIELDS = 'feed,messages';

export async function subscribeApp(fbPageId: string, pageToken: string): Promise<void> {
  await graphPost(`${fbPageId}/subscribed_apps`, pageToken, {
    subscribed_fields: WEBHOOK_FIELDS,
  });
}

export async function unsubscribeApp(fbPageId: string, pageToken: string): Promise<void> {
  await graphDelete(`${fbPageId}/subscribed_apps`, pageToken);
}
