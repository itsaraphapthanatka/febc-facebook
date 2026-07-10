import cron, { type ScheduledTask } from 'node-cron';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { schedules } from '../db/schema';
import { env } from '../env';
import { dispatchDueBroadcasts } from '../modules/broadcast/service';
import { runScheduleOnce } from '../modules/schedules/service';
import { runSweeper } from './sweeper';

interface SchedulerLogger {
  info(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

const tasks = new Map<string, ScheduledTask>();
let sweeperTask: ScheduledTask | null = null;
let dispatchTask: ScheduledTask | null = null;
let log: SchedulerLogger = { info: () => {}, error: () => {} };

export function isValidCron(expression: string): boolean {
  return cron.validate(expression);
}

function register(scheduleId: string, cronExpression: string): void {
  if (!isValidCron(cronExpression)) {
    log.error({ scheduleId, cronExpression }, 'invalid cron expression, schedule not registered');
    return;
  }
  const task = cron.schedule(
    cronExpression,
    () => {
      runScheduleOnce(scheduleId).catch((err) => log.error({ err, scheduleId }, 'schedule run failed'));
    },
    { timezone: env.SCHEDULER_TIMEZONE },
  );
  tasks.set(scheduleId, task);
}

export async function startScheduler(logger: SchedulerLogger): Promise<void> {
  log = logger;
  const active = await db.select().from(schedules).where(eq(schedules.isActive, true));
  for (const s of active) register(s.id, s.cronExpression);
  log.info({ count: active.length }, 'scheduler started');

  sweeperTask = cron.schedule(
    '*/5 * * * *',
    () => {
      runSweeper(log).catch((err) => log.error({ err }, 'sweeper failed'));
    },
    { timezone: env.SCHEDULER_TIMEZONE },
  );

  // Fire scheduled broadcasts whose time has come (minute granularity).
  dispatchTask = cron.schedule(
    '* * * * *',
    () => {
      dispatchDueBroadcasts(log).catch((err) => log.error({ err }, 'broadcast dispatch failed'));
    },
    { timezone: env.SCHEDULER_TIMEZONE },
  );
  // Catch up on any broadcasts that came due while the process was down.
  dispatchDueBroadcasts(log).catch((err) => log.error({ err }, 'broadcast dispatch failed'));
}

/** Re-syncs one schedule's cron task after a create/update/delete/toggle. */
export async function reloadSchedule(scheduleId: string): Promise<void> {
  tasks.get(scheduleId)?.stop();
  tasks.delete(scheduleId);
  const [s] = await db.select().from(schedules).where(eq(schedules.id, scheduleId));
  if (s && s.isActive) register(s.id, s.cronExpression);
}

export function stopScheduler(): void {
  for (const task of tasks.values()) task.stop();
  tasks.clear();
  sweeperTask?.stop();
  sweeperTask = null;
  dispatchTask?.stop();
  dispatchTask = null;
}
