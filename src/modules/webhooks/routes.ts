import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../env';
import { processWebhookBody, verifyWebhookSignature, type WebhookBody } from './service';

const verifyQuerySchema = z.object({
  'hub.mode': z.string().optional(),
  'hub.verify_token': z.string().optional(),
  'hub.challenge': z.string().optional(),
});

export async function webhookRoutes(app: FastifyInstance) {
  // Facebook verification handshake
  app.get(
    '/webhooks/facebook',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const q = verifyQuerySchema.parse(req.query);
      if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === env.FB_WEBHOOK_VERIFY_TOKEN) {
        return reply.type('text/plain').send(q['hub.challenge'] ?? '');
      }
      return reply.code(403).send({ error: 'Verification failed' });
    },
  );

  // Event ingestion — signature over the RAW body, ACK 200 fast, process async
  app.post(
    '/webhooks/facebook',
    {
      config: {
        rawBody: true,
        rateLimit: { max: 300, timeWindow: '1 minute' },
      },
    },
    async (req, reply) => {
      const signature = req.headers['x-hub-signature-256'] as string | undefined;
      const rawBody = (req as unknown as { rawBody?: string | Buffer }).rawBody;
      if (!rawBody || !verifyWebhookSignature(rawBody, signature, env.FB_APP_SECRET)) {
        return reply.code(401).send({ error: 'Invalid signature' });
      }

      const body = req.body as WebhookBody;
      reply.send({ received: true });

      setImmediate(() => {
        processWebhookBody(body).catch((err) => {
          req.log.error({ err }, 'webhook processing failed');
        });
      });
    },
  );
}
