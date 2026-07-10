import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/client';
import { fbUsers, pages } from '../../db/schema';
import { env } from '../../env';
import {
  buildLoginUrl,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  fetchMe,
  fetchPageAccounts,
} from '../../facebook/oauth';
import { encrypt } from '../../lib/crypto';
import { AppError } from '../../lib/errors';

// CSRF state is double-submitted: sent to Facebook as ?state= and stored in a
// signed HttpOnly cookie, so it survives server restarts and multiple instances.
const STATE_COOKIE = 'fb_oauth_state';
const STATE_TTL_SECONDS = 10 * 60;

// When the app is mounted under a path prefix (e.g. BASE_URL=".../facebook"), a
// reverse proxy strips that prefix before the request reaches us — but the browser
// still sees the external path. Cookie Path and redirect targets must therefore use
// the *external* prefix, or the state cookie won't be returned on the callback and
// the post-connect redirect would escape the mount. Empty string when mounted at root.
const MOUNT_PREFIX = new URL(env.BASE_URL).pathname.replace(/\/$/, '');
const STATE_COOKIE_PATH = `${MOUNT_PREFIX}/auth/facebook`;

function statesMatch(a: string, b: string): boolean {
  // Hash both sides so length differences don't leak
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
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
    async (req, reply) => {
      // The state cookie must live on the same host Facebook redirects back to
      // (BASE_URL). If the flow starts elsewhere (e.g. localhost), hop there first.
      const canonicalHost = new URL(env.BASE_URL).host;
      if (req.host !== canonicalHost) {
        req.log.info({ from: req.host, to: canonicalHost }, 'redirecting oauth start to BASE_URL host');
        return reply.redirect(`${env.BASE_URL.replace(/\/$/, '')}/auth/facebook`);
      }
      const state = randomBytes(16).toString('hex');
      reply.setCookie(STATE_COOKIE, state, {
        signed: true,
        httpOnly: true,
        // 'lax' so the cookie is still sent on the top-level redirect back from facebook.com
        sameSite: 'lax',
        secure: env.NODE_ENV === 'production',
        path: STATE_COOKIE_PATH,
        maxAge: STATE_TTL_SECONDS,
      });
      return reply.redirect(buildLoginUrl(state));
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
      const rawCookie = req.cookies[STATE_COOKIE];
      const unsigned = rawCookie ? req.unsignCookie(rawCookie) : null;
      reply.clearCookie(STATE_COOKIE, { path: STATE_COOKIE_PATH });
      const cookieState = unsigned?.valid ? unsigned.value : null;
      if (!query.code || !query.state || !cookieState || !statesMatch(cookieState, query.state)) {
        req.log.warn(
          {
            hasCode: Boolean(query.code),
            hasQueryState: Boolean(query.state),
            hasCookie: rawCookie != null,
            cookieSignatureValid: unsigned?.valid ?? false,
            stateMatches:
              cookieState && query.state ? statesMatch(cookieState, query.state) : false,
          },
          'oauth state validation failed',
        );
        throw new AppError('Invalid or expired OAuth state', 400);
      }

      const shortLived = await exchangeCodeForToken(query.code);
      const longLived = await exchangeForLongLivedToken(shortLived.access_token);
      const result = await syncUserAndPages(longLived.access_token, longLived.expires_in);

      // Return to the dashboard Pages view with a success flag (under the mount prefix)
      return reply.redirect(`${MOUNT_PREFIX}/?connected=${result.pages.length}#/pages`);
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
