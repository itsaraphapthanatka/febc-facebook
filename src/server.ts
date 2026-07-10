import { createHash, timingSafeEqual } from 'crypto';
import { join } from 'path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import rawBody from 'fastify-raw-body';
import { sql } from 'drizzle-orm';
import { ZodError } from 'zod';
import { db } from './db/client';
import { env } from './env';
import { AppError, FacebookApiError } from './lib/errors';
import { aiRoutes } from './modules/ai/routes';
import { authRoutes } from './modules/auth/routes';
import { broadcastRoutes } from './modules/broadcast/routes';
import { historyRoutes } from './modules/history/routes';
import { pagesRoutes } from './modules/pages/routes';
import { scheduleRoutes } from './modules/schedules/routes';
import { statsRoute } from './modules/stats/routes';
import { webhookRoutes } from './modules/webhooks/routes';

function constantTimeEquals(a: string, b: string): boolean {
  // Hash both sides so length differences don't leak
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: ['req.headers.authorization'],
    },
  });

  await app.register(helmet, {
    global: true,
    // Allow the self-hosted dashboard (external JS/CSS from 'self', inline styles, data/https images)
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc: ["'self'"],
      },
    },
  });
  await app.register(rateLimit, { global: false });

  // Signed cookies (OAuth CSRF state); ENCRYPTION_KEY doubles as the signing secret
  await app.register(fastifyCookie, { secret: env.ENCRYPTION_KEY });

  // Image file uploads (sent directly to Facebook as multipart)
  await app.register(fastifyMultipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  });

  // Serve the dashboard UI (static files) at the root
  await app.register(fastifyStatic, {
    root: join(process.cwd(), 'web'),
    index: ['index.html'],
  });
  await app.register(rawBody, {
    field: 'rawBody',
    global: false,
    encoding: 'utf8',
    runFirst: true,
  });

  // Accept body-less POSTs (e.g. /run, /preview) and unknown content types instead of 415
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body.length > 0 ? body : null);
  });

  // Admin API key guard for /api/*
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (!token || !constantTimeEquals(token, env.ADMIN_API_KEY)) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: 'Validation failed',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: err.message });
    }
    if (err instanceof FacebookApiError) {
      req.log.error({ err }, 'facebook api error');
      return reply.code(502).send({ error: err.message, fbCode: err.fbCode });
    }
    const httpErr = err as { statusCode?: number; message?: string };
    if (typeof httpErr.statusCode === 'number' && httpErr.statusCode < 500) {
      return reply.code(httpErr.statusCode).send({ error: httpErr.message ?? 'Request error' });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: 'Internal server error' });
  });

  app.get('/healthz', async () => {
    await db.execute(sql`SELECT 1`);
    return { ok: true };
  });

  app.register(statsRoute);
  await app.register(authRoutes);
  await app.register(pagesRoutes);
  await app.register(broadcastRoutes);
  await app.register(aiRoutes);
  await app.register(scheduleRoutes);
  await app.register(historyRoutes);
  await app.register(webhookRoutes);

  return app;
}
