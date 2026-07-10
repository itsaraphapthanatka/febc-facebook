import OpenAI from 'openai';
import { env } from '../env';
import { AppError, errorMessage } from '../lib/errors';

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      baseURL: env.OPENAI_BASE_URL,
    });
  }
  return client;
}

/** Replaces {{topic}} and {{date}} placeholders in a prompt template. */
export function renderTemplate(
  template: string,
  vars: { topic?: string | null; date?: string },
): string {
  const date =
    vars.date ??
    new Intl.DateTimeFormat('th-TH', {
      dateStyle: 'full',
      timeZone: env.SCHEDULER_TIMEZONE,
    }).format(new Date());
  return template
    .replace(/\{\{\s*topic\s*\}\}/g, vars.topic ?? '')
    .replace(/\{\{\s*date\s*\}\}/g, date);
}

const SYSTEM_PROMPT = [
  'You are a social media copywriter for a Facebook Page.',
  'Write exactly ONE Facebook post based on the brief.',
  'Rules:',
  '- Output only the post text: no surrounding quotes, no markdown, no explanations.',
  '- Write in the same language as the brief.',
  '- Keep it engaging and suitable for a Facebook feed (roughly 1-4 short paragraphs).',
  '- Use emoji and hashtags only if the brief asks for them.',
].join('\n');

export interface GenerateInput {
  promptTemplate: string;
  topic?: string | null;
  model?: string | null;
}

export async function generatePost(input: GenerateInput): Promise<{ content: string; prompt: string }> {
  const prompt = renderTemplate(input.promptTemplate, { topic: input.topic });
  const completion = await getClient().chat.completions.create({
    model: input.model || env.OPENAI_MODEL,
    temperature: 0.8,
    // Reasoning models spend tokens thinking before answering — a small budget yields empty content
    max_tokens: 2000,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
  });
  const content = completion.choices[0]?.message?.content?.trim();
  if (!content) throw new AppError('OpenAI returned empty content', 502);
  return { content, prompt };
}

const COMPOSE_SYSTEM: Record<'feed' | 'messenger', string> = {
  feed: [
    'You are a social media copywriter for a Facebook Page.',
    'Write exactly ONE Facebook post from the brief.',
    '- Output only the post text: no surrounding quotes, no markdown, no explanations.',
    '- Write in the same language as the brief (Thai brief → Thai post).',
    '- Engaging, suitable for a feed (1-4 short paragraphs); use emoji/hashtags only if fitting.',
  ].join('\n'),
  messenger: [
    'You are writing a Facebook Messenger broadcast message to people who follow a Page.',
    'Write exactly ONE short message from the brief.',
    '- Output only the message text: no quotes, no markdown, no explanations.',
    '- Write in the same language as the brief (Thai brief → Thai message).',
    '- Conversational and concise (max ~3 sentences, well under 2000 characters); a couple of emoji are fine.',
  ].join('\n'),
};

/** Free-form "AI help me write" for a broadcast, tuned per channel. */
export async function composeBroadcast(input: {
  brief: string;
  channel: 'feed' | 'messenger';
  model?: string | null;
}): Promise<{ content: string }> {
  const completion = await getClient().chat.completions.create({
    model: input.model || env.OPENAI_MODEL,
    temperature: 0.8,
    max_tokens: 2000,
    messages: [
      { role: 'system', content: COMPOSE_SYSTEM[input.channel] },
      { role: 'user', content: input.brief },
    ],
  });
  const content = completion.choices[0]?.message?.content?.trim();
  if (!content) throw new AppError('AI ไม่ได้คืนข้อความ', 502);
  return { content };
}

/** Generates one image and returns it as raw bytes. Throws a clear error if the endpoint can't. */
export async function generateImage(input: {
  prompt: string;
  model?: string | null;
}): Promise<{ buffer: Buffer; mime: string }> {
  const model = input.model || env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
  let res;
  try {
    // Omit response_format for max compatibility — handle both b64_json and url responses below.
    res = await getClient().images.generate({ model, prompt: input.prompt, size: '1024x1024', n: 1 });
  } catch (err) {
    throw new AppError(
      `สร้างรูปด้วย AI ไม่สำเร็จ — endpoint/โมเดลอาจไม่รองรับการสร้างรูปภาพ (${errorMessage(err)})`,
      502,
    );
  }
  const item = res.data?.[0];
  if (item?.b64_json) {
    return { buffer: Buffer.from(item.b64_json, 'base64'), mime: 'image/png' };
  }
  if (item?.url) {
    const r = await fetch(item.url);
    if (!r.ok) throw new AppError('ดาวน์โหลดรูปที่ AI สร้างไม่สำเร็จ', 502);
    const buffer = Buffer.from(await r.arrayBuffer());
    return { buffer, mime: r.headers.get('content-type') || 'image/png' };
  }
  throw new AppError('AI ไม่ได้คืนรูปภาพ', 502);
}
