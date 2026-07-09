import { randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/client';
import { fbUsers, pages } from '../../db/schema';
import {
  buildLoginUrl,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  fetchMe,
  fetchPageAccounts,
} from '../../facebook/oauth';
import { encrypt } from '../../lib/crypto';
import { AppError } from '../../lib/errors';

// Single-instance in-memory CSRF state store (state → expiry epoch ms)
const pendingStates = new Map<string, number>();
const STATE_TTL_MS = 10 * 60 * 1000;

function issueState(): string {
  const now = Date.now();
  for (const [s, exp] of pendingStates) if (exp < now) pendingStates.delete(s);
  const state = randomBytes(16).toString('hex');
  pendingStates.set(state, now + STATE_TTL_MS);
  return state;
}

function consumeState(state: string): boolean {
  const exp = pendingStates.get(state);
  pendingStates.delete(state);
  return exp != null && exp >= Date.now();
}

const callbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

/** Exchanges a long-lived user token for page tokens and upserts fb_user + pages. Returns page summaries. */
export async function syncUserAndPages(longLivedToken: string, expiresIn?: number) {
  const me = await fetchMe(longLivedToken);
  const tokenExpiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;

  const [user] = await db
    .insert(fbUsers)
    .values({
      fbUserId: me.id,
      name: me.name,
      longLivedTokenEnc: encrypt(longLivedToken),
      tokenExpiresAt,
    })
    .onConflictDoUpdate({
      target: fbUsers.fbUserId,
      set: {
        name: me.name,
        longLivedTokenEnc: encrypt(longLivedToken),
        tokenExpiresAt,
        updatedAt: new Date(),
      },
    })
    .returning();

  const accounts = await fetchPageAccounts(longLivedToken);
  const summaries: { id: string; fbPageId: string; name: string }[] = [];
  for (const account of accounts) {
    const [page] = await db
      .insert(pages)
      .values({
        fbPageId: account.id,
        fbUserId: user.id,
        name: account.name,
        category: account.category,
        pageAccessTokenEnc: encrypt(account.access_token),
      })
      .onConflictDoUpdate({
        target: pages.fbPageId,
        set: {
          name: account.name,
          category: account.category,
          pageAccessTokenEnc: encrypt(account.access_token),
          fbUserId: user.id,
          updatedAt: new Date(),
        },
      })
      .returning();
    summaries.push({ id: page.id, fbPageId: page.fbPageId, name: page.name });
  }
  return { user: { id: user.id, fbUserId: user.fbUserId, name: user.name }, pages: summaries };
}

export async function authRoutes(app: FastifyInstance) {
  app.get(
    '/auth/facebook',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (_req, reply) => {
      return reply.redirect(buildLoginUrl(issueState()));
    },
  );

  app.get(
    '/auth/facebook/callback',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const query = callbackQuerySchema.parse(req.query);
      if (query.error) {
        throw new AppError(`Facebook login failed: ${query.error_description ?? query.error}`, 400);
      }
      if (!query.code || !query.state || !consumeState(query.state)) {
        throw new AppError('Invalid or expired OAuth state', 400);
      }

      const shortLived = await exchangeCodeForToken(query.code);
      const longLived = await exchangeForLongLivedToken(shortLived.access_token);
      const result = await syncUserAndPages(longLived.access_token, longLived.expires_in);

      // Return to the dashboard Pages view with a success flag
      return reply.redirect(`/?connected=${result.pages.length}#/pages`);
    },
  );
}

/** Re-fetches /me/accounts for every stored user (used by POST /api/pages/refresh). */
export async function refreshAllUsersPages() {
  const users = await db.select().from(fbUsers);
  const results = [];
  for (const user of users) {
    const { decrypt } = await import('../../lib/crypto');
    const token = decrypt(user.longLivedTokenEnc);
    const synced = await syncUserAndPages(token);
    results.push(synced);
  }
  return results;
}

export async function getUserById(id: string) {
  const [user] = await db.select().from(fbUsers).where(eq(fbUsers.id, id));
  return user ?? null;
}
