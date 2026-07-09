import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const fbUsers = pgTable('fb_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  fbUserId: text('fb_user_id').notNull().unique(),
  name: text('name'),
  longLivedTokenEnc: text('long_lived_token_enc').notNull(),
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const pages = pgTable('pages', {
  id: uuid('id').primaryKey().defaultRandom(),
  fbPageId: text('fb_page_id').notNull().unique(),
  fbUserId: uuid('fb_user_id')
    .notNull()
    .references(() => fbUsers.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  category: text('category'),
  pageAccessTokenEnc: text('page_access_token_enc').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  webhookSubscribed: boolean('webhook_subscribed').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type BroadcastKind = 'feed' | 'messenger';
export type BroadcastStatus = 'pending' | 'running' | 'completed' | 'partial' | 'failed';

export const broadcasts = pgTable('broadcasts', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind').$type<BroadcastKind>().notNull(),
  message: text('message').notNull(),
  link: text('link'),
  imageUrl: text('image_url'),
  messageTag: text('message_tag'),
  status: text('status').$type<BroadcastStatus>().notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type TargetStatus = 'pending' | 'sent' | 'failed';

export const broadcastTargets = pgTable('broadcast_targets', {
  id: uuid('id').primaryKey().defaultRandom(),
  broadcastId: uuid('broadcast_id')
    .notNull()
    .references(() => broadcasts.id, { onDelete: 'cascade' }),
  pageId: uuid('page_id')
    .notNull()
    .references(() => pages.id, { onDelete: 'cascade' }),
  recipientPsid: text('recipient_psid'),
  status: text('status').$type<TargetStatus>().notNull().default('pending'),
  fbPostId: text('fb_post_id'),
  error: text('error'),
  attempts: integer('attempts').notNull().default(0),
  sentAt: timestamp('sent_at', { withTimezone: true }),
});

export const schedules = pgTable('schedules', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  cronExpression: text('cron_expression').notNull(),
  promptTemplate: text('prompt_template').notNull(),
  topics: jsonb('topics').$type<string[]>().notNull().default([]),
  model: text('model'),
  targetPageIds: uuid('target_page_ids').array().notNull(),
  isActive: boolean('is_active').notNull().default(true),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type RunStatus = 'running' | 'success' | 'partial' | 'failed';

export const scheduleRuns = pgTable('schedule_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  scheduleId: uuid('schedule_id')
    .notNull()
    .references(() => schedules.id, { onDelete: 'cascade' }),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  status: text('status').$type<RunStatus>().notNull().default('running'),
  generatedContent: text('generated_content'),
  promptUsed: text('prompt_used'),
  error: text('error'),
});

export type PostSource = 'broadcast' | 'schedule' | 'api';
export type PostStatus = 'published' | 'failed';

export const posts = pgTable('posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  pageId: uuid('page_id')
    .notNull()
    .references(() => pages.id, { onDelete: 'cascade' }),
  fbPostId: text('fb_post_id'),
  source: text('source').$type<PostSource>().notNull(),
  sourceId: uuid('source_id'),
  content: text('content').notNull(),
  status: text('status').$type<PostStatus>().notNull(),
  error: text('error'),
  attempts: integer('attempts').notNull().default(0),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const messengerRecipients = pgTable(
  'messenger_recipients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    psid: text('psid').notNull(),
    lastInteractionAt: timestamp('last_interaction_at', { withTimezone: true }).notNull(),
    optedOut: boolean('opted_out').notNull().default(false),
  },
  (t) => [uniqueIndex('messenger_recipients_page_psid_idx').on(t.pageId, t.psid)],
);

export const webhookEvents = pgTable('webhook_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  object: text('object'),
  field: text('field'),
  fbPageId: text('fb_page_id'),
  payload: jsonb('payload').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processed: boolean('processed').notNull().default(false),
});
