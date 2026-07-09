import { graphPost } from './graphClient';

// Tags allow sending outside the 24h window for specific non-promotional use cases only.
export const MESSAGE_TAGS = [
  'CONFIRMED_EVENT_UPDATE',
  'POST_PURCHASE_UPDATE',
  'ACCOUNT_UPDATE',
] as const;

export type MessageTag = (typeof MESSAGE_TAGS)[number];

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
