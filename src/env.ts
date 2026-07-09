import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  BASE_URL: z.string().url(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1),

  ADMIN_API_KEY: z.string().min(16, 'ADMIN_API_KEY must be at least 16 characters'),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be 64 hex characters (32 bytes)'),

  FB_APP_ID: z.string().min(1),
  FB_APP_SECRET: z.string().min(1),
  FB_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v23.0'),
  FB_WEBHOOK_VERIFY_TOKEN: z.string().min(8),
  // Facebook Login for Business configuration ID — when set, the OAuth dialog uses
  // config_id instead of raw scopes (required for Business-type apps on current Meta policy)
  FB_LOGIN_CONFIG_ID: z.string().optional(),

  OPENAI_API_KEY: z.string().min(1),
  // Any OpenAI-compatible endpoint (e.g. a self-hosted gateway); empty = api.openai.com
  OPENAI_BASE_URL: z.string().url().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),

  SCHEDULER_TIMEZONE: z.string().default('Asia/Bangkok'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;
