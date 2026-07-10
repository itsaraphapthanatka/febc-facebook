import { graphGetAll, graphPost, graphPostForm, type UploadFile } from './graphClient';

// Tags allow sending outside the 24h window for specific non-promotional use cases only.
export const MESSAGE_TAGS = [
  'CONFIRMED_EVENT_UPDATE',
  'POST_PURCHASE_UPDATE',
  'ACCOUNT_UPDATE',
] as const;

export type MessageTag = (typeof MESSAGE_TAGS)[number];

export interface Conversation {
  id: string;
  updated_time?: string;
  participants?: { data?: { id?: string; name?: string }[] };
}

/** Lists the page's Messenger conversations (participants + last-updated), following pagination. */
export async function listConversations(fbPageId: string, pageToken: string): Promise<Conversation[]> {
  return graphGetAll<Conversation>(`${fbPageId}/conversations`, pageToken, {
    platform: 'messenger',
    fields: 'participants,updated_time',
  });
}

/** Sends a text message via the Send API. Returns the message id. */
export async function sendTextMessage(
  fbPageId: string,
  pageToken: string,
  psid: string,
  text: string,
  tag?: MessageTag | null,
): Promise<string> {
  const body: Record<string, unknown> = {
    recipient: { id: psid },
    messaging_type: tag ? 'MESSAGE_TAG' : 'RESPONSE',
    message: { text },
  };
  if (tag) body.tag = tag;
  const res = await graphPost<{ message_id: string }>(`${fbPageId}/messages`, pageToken, body);
  return res.message_id;
}

/**
 * Uploads an image to the page's reusable attachment store and returns the
 * attachment_id. Upload once per page, then reference the id in every send —
 * far cheaper than re-uploading the binary for each recipient.
 */
export async function uploadMessengerImage(
  fbPageId: string,
  pageToken: string,
  file: UploadFile,
): Promise<string> {
  const res = await graphPostForm<{ attachment_id: string }>(
    `${fbPageId}/message_attachments`,
    pageToken,
    { message: JSON.stringify({ attachment: { type: 'image', payload: { is_reusable: true } } }) },
    file,
    'filedata',
  );
  return res.attachment_id;
}

/** Same as uploadMessengerImage but from a public image URL (Facebook fetches it). Returns attachment_id. */
export async function uploadMessengerImageByUrl(
  fbPageId: string,
  pageToken: string,
  imageUrl: string,
): Promise<string> {
  const res = await graphPost<{ attachment_id: string }>(
    `${fbPageId}/message_attachments`,
    pageToken,
    { message: { attachment: { type: 'image', payload: { is_reusable: true, url: imageUrl } } } },
  );
  return res.attachment_id;
}

/** Sends an image message via a previously uploaded reusable attachment_id. Returns the message id. */
export async function sendImageMessage(
  fbPageId: string,
  pageToken: string,
  psid: string,
  attachmentId: string,
  tag?: MessageTag | null,
): Promise<string> {
  const body: Record<string, unknown> = {
    recipient: { id: psid },
    messaging_type: tag ? 'MESSAGE_TAG' : 'RESPONSE',
    message: { attachment: { type: 'image', payload: { attachment_id: attachmentId } } },
  };
  if (tag) body.tag = tag;
  const res = await graphPost<{ message_id: string }>(`${fbPageId}/messages`, pageToken, body);
  return res.message_id;
}
