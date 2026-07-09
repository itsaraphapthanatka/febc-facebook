import OpenAI from 'openai';
import { env } from '../env';
import { AppError } from '../lib/errors';

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
