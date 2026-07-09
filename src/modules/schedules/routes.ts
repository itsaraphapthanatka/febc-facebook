import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/client';
import { schedules } from '../../db/schema';
import { generatePost } from '../../openai/generator';
import { AppError } from '../../lib/errors';
import { isValidCron, reloadSchedule } from '../../scheduler/scheduler';
import { getScheduleWithRuns, runScheduleOnce } from './service';

const cronField = z.string().refine(isValidCron, { message: 'Invalid cron expression' });

const createSchema = z.object({
  name: z.string().min(1).max(200),
  cronExpression: cronField,
  promptTemplate: z.string().min(1),
  topics: z.array(z.string().min(1)).default([]),
  model: z.string().optional(),
  targetPageIds: z.array(z.string().uuid()).min(1),
  isActive: z.boolean().default(true),
});

const updateSchema = createSchema.partial();

const idParamSchema = z.object({ id: z.string().uuid() });

export async function scheduleRoutes(app: FastifyInstance) {
  app.post('/api/schedules', async (req, reply) => {
    const body = createSchema.parse(req.body);
    const [created] = await db.insert(schedules).values(body).returning();
    await reloadSchedule(created.id);
    return reply.code(201).send(created);
  });

  app.get('/api/schedules', async () => {
    return db.select().from(schedules).orderBy(desc(schedules.createdAt));
  });

  app.get('/api/schedules/:id', async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const schedule = await getScheduleWithRuns(id);
    if (!schedule) throw new AppError('Schedule not found', 404);
    return schedule;
  });

  app.patch('/api/schedules/:id', async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const body = updateSchema.parse(req.body);
    const [updated] = await db
      .update(schedules)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(schedules.id, id))
      .returning();
    if (!updated) throw new AppError('Schedule not found', 404);
    await reloadSchedule(id);
    return updated;
  });

  app.delete('/api/schedules/:id', async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const deleted = await db.delete(schedules).where(eq(schedules.id, id)).returning({ id: schedules.id });
    if (deleted.length === 0) throw new AppError('Schedule not found', 404);
    await reloadSchedule(id);
    return { deleted: true };
  });

  // Trigger a run immediately (testing)
  app.post('/api/schedules/:id/run', async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const [schedule] = await db.select().from(schedules).where(eq(schedules.id, id));
    if (!schedule) throw new AppError('Schedule not found', 404);
    setImmediate(() => {
      runScheduleOnce(id).catch((err) => req.log.error({ err, scheduleId: id }, 'manual run failed'));
    });
    return reply.code(202).send({ triggered: true, scheduleId: id });
  });

  // Generate content with OpenAI without posting
  app.post('/api/schedules/:id/preview', async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const [schedule] = await db.select().from(schedules).where(eq(schedules.id, id));
    if (!schedule) throw new AppError('Schedule not found', 404);
    const topic = schedule.topics.length > 0 ? schedule.topics[0] : null;
    const generated = await generatePost({
      promptTemplate: schedule.promptTemplate,
      topic,
      model: schedule.model,
    });
    return { preview: generated.content, promptUsed: generated.prompt };
  });
}
