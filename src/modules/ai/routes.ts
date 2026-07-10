import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { composeBroadcast, generateImage } from '../../openai/generator';

const composeSchema = z.object({
  brief: z.string().min(1).max(2000),
  channel: z.enum(['feed', 'messenger']).default('feed'),
  model: z.string().optional(),
});

const imageSchema = z.object({
  prompt: z.string().min(1).max(1000),
  model: z.string().optional(),
});

export async function aiRoutes(app: FastifyInstance) {
  // AI writing assistant for broadcast copy.
  app.post('/api/ai/compose', async (req) => {
    const body = composeSchema.parse(req.body);
    return composeBroadcast(body);
  });

  // AI image generation — returns a data URL the client drops straight into the image picker.
  app.post('/api/ai/image', async (req) => {
    const { prompt, model } = imageSchema.parse(req.body);
    const { buffer, mime } = await generateImage({ prompt, model });
    return { dataUrl: `data:${mime};base64,${buffer.toString('base64')}` };
  });
}
